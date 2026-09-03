import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildRegistry,
  dispatchModuleRequest,
  MODULE_ROUTE_PREFIX,
  resolveEnabledModules,
  routeIsRateLimited,
  type ModuleRegistry,
  type RegistryRoute,
  type RouteRateLimitGuard,
} from '@repo/core'
import { createDatabaseClient, migrationsTableFor, planModuleMigrations, runModuleMigrations } from '@repo/db'
import { TWO_FACTOR_CHALLENGE_COOKIES } from '@repo/module-auth'
import { createSharedCheckoutThrottle } from '@repo/module-billing'
import { createSharedSubmissionThrottle } from '@repo/module-marketing'
import {
  assertPoliciesCoverRoutes,
  createDrizzleRateLimiter,
  createRouteRateLimitGuard,
  exceedsRateLimit,
  parseRateLimitPolicies,
  rateLimitModule,
} from '@repo/module-rate-limit'
import type { RateLimiter, RateLimitLogger } from '@repo/ports'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { authRefusalOf } from '../apps/web/app/auth-form'
import { retryAfterMinutes } from '../apps/web/app/refusal-message'
import { twoFactorRefusalOf } from '../apps/web/app/two-factor/two-factor-form'
import { availableModules, enabledModules, requiredModules } from '../config/features'
import { appLocales } from '../config/i18n'
import {
  captcha,
  contentSecurityPolicySources,
  rateLimitPolicies,
} from '../config/security'
import { databaseUrl, isDatabaseReachable } from './fixtures/database'
import {
  createMemoryRateLimiter,
  recordingRateLimitLog,
  unavailableRateLimiter,
} from './fixtures/rate-limit'

/**
 * **La limitation de débit** (s28) — ce qui traverse les packages.
 *
 * La règle pure vit à côté d'elle-même
 * (`packages/modules/rate-limit/src/domain/rate-limit-rules.test.ts`). Ce
 * fichier-ci prouve ce qu'aucun test unitaire ne peut prouver : que le compteur
 * est réellement partagé entre deux instances contre un même PostgreSQL, que le
 * répartiteur refuse, que **tous** les points d'entrée publics sont couverts, et
 * qu'aucune variable d'environnement ne peut l'éteindre.
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * Toutes les sources de production du dépôt — `packages/`, `apps/`, `config/` —
 * hors tests, hors `node_modules`, hors artefacts générés.
 *
 * Elles servent aux balayages ci-dessous, qui **comptent ce qu'ils ont lu** :
 * un balayage vide passerait pour une raison qui n'en est pas une (s26).
 */
const productionSources = (): readonly { path: string; source: string }[] => {
  const files: { path: string; source: string }[] = []

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.next' || entry === '.turbo') {
        continue
      }

      const full = join(directory, entry)

      if (statSync(full).isDirectory()) {
        walk(full)

        continue
      }

      if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) {
        continue
      }

      if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) {
        continue
      }

      files.push({ path: relative(REPO_ROOT, full), source: readFileSync(full, 'utf8') })
    }
  }

  walk(join(REPO_ROOT, 'packages'))
  walk(join(REPO_ROOT, 'apps'))
  walk(join(REPO_ROOT, 'config'))

  return files
}
const databaseReachable = await isDatabaseReachable()

describe.skipIf(!databaseReachable)(
  'le compteur, sur une base réelle : deux instances, un seul seau',
  () => {
    /** Le schéma de la sonde. Créé, mesuré, détruit : il ne survit pas à la suite. */
    const PROBE_SCHEMA = 'rate_limit_probe'
    const PROBE_JOURNAL = `${migrationsTableFor(rateLimitModule.id)}_probe`

    const probeUrl = (): string => {
      const url = new URL(databaseUrl)

      url.searchParams.set('options', `-c search_path=${PROBE_SCHEMA}`)

      return url.toString()
    }

    let admin: ReturnType<typeof createDatabaseClient>
    /**
     * **Deux connexions distinctes**, et c'est tout le sujet du critère 7.
     *
     * Un compteur en mémoire de processus passerait un test à une seule
     * connexion : chaque instance aurait son propre compte, chacune resterait
     * sous le seuil, et la protection n'existerait qu'en apparence dès la
     * seconde instance déployée. Deux pools séparés sont ce que deux conteneurs
     * derrière un répartiteur de charge ont de commun : la base, et rien d'autre.
     */
    let first: ReturnType<typeof createDatabaseClient>
    let second: ReturnType<typeof createDatabaseClient>

    beforeAll(async () => {
      admin = createDatabaseClient({ connectionString: databaseUrl, maxConnections: 1 })

      await admin.db.execute(sql`drop schema if exists ${sql.identifier(PROBE_SCHEMA)} cascade`)
      await admin.db.execute(sql`create schema ${sql.identifier(PROBE_SCHEMA)}`)
      await admin.db.execute(sql`create schema if not exists drizzle`)
      await admin.db.execute(sql`drop table if exists drizzle.${sql.identifier(PROBE_JOURNAL)}`)

      first = createDatabaseClient({ connectionString: probeUrl(), maxConnections: 1 })
      second = createDatabaseClient({ connectionString: probeUrl(), maxConnections: 1 })

      await runModuleMigrations({
        db: first.db,
        plan: planModuleMigrations({
          modules: resolveEnabledModules({
            available: [rateLimitModule],
            enabled: [rateLimitModule.id],
          }),
          repoRoot: REPO_ROOT,
        }).map((step) => ({ ...step, migrationsTable: PROBE_JOURNAL })),
      })
    })

    afterAll(async () => {
      await first.close()
      await second.close()
      await admin.db.execute(sql`drop schema if exists ${sql.identifier(PROBE_SCHEMA)} cascade`)
      await admin.db.execute(sql`drop table if exists drizzle.${sql.identifier(PROBE_JOURNAL)}`)
      await admin.close()
    })

    beforeEach(async () => {
      await first.db.execute(sql`truncate table rate_limit_window`)
    })

    it('fait avancer le même compte depuis deux instances distinctes', async () => {
      const now = new Date('2026-09-03T10:00:10.000Z')
      const limiterA = createDrizzleRateLimiter({ db: first.db })
      const limiterB = createDrizzleRateLimiter({ db: second.db })
      const bucket = { key: '/auth/sign-in:client:203.0.113.7', max: 3, windowSeconds: 60 }

      const one = await limiterA.consume({ buckets: [bucket], now })
      const two = await limiterB.consume({ buckets: [bucket], now })
      const three = await limiterA.consume({ buckets: [bucket], now })
      const four = await limiterB.consume({ buckets: [bucket], now })

      expect([one, two, three, four].every((result) => result.ok)).toBe(true)
      expect(one.ok && one.buckets[0]?.hits).toBe(1)
      expect(two.ok && two.buckets[0]?.hits).toBe(2)
      expect(three.ok && three.buckets[0]?.hits).toBe(3)
      // Le quatrième passage dépasse le seuil de trois : le compte a bien
      // traversé les deux instances. Un compteur en mémoire en serait à deux.
      expect(four.ok && four.buckets[0]?.exceeded).toBe(true)
    })

    it('ne stocke aucune adresse en clair : la clé est un condensat', async () => {
      const now = new Date('2026-09-03T10:00:10.000Z')

      await createDrizzleRateLimiter({ db: first.db }).consume({
        buckets: [{ key: '/auth/sign-in:subject:victime@example.test', max: 5, windowSeconds: 60 }],
        now,
      })

      const rows = await first.db.execute<{ bucket: string }>(
        sql`select bucket from rate_limit_window`,
      )

      expect(rows.rows).toHaveLength(1)
      expect(rows.rows[0]?.bucket).not.toContain('victime')
      expect(rows.rows[0]?.bucket).not.toContain('example.test')
      expect(rows.rows[0]?.bucket).toMatch(/^[0-9a-f]{64}$/)
    })

    it('repart à un quand la fenêtre a tourné, et balaie les fenêtres closes', async () => {
      const bucket = { key: '/auth/sign-in:client:203.0.113.9', max: 10, windowSeconds: 60 }
      const limiter = createDrizzleRateLimiter({ db: first.db })

      await limiter.consume({ buckets: [bucket], now: new Date('2026-09-03T10:00:10.000Z') })
      const next = await limiter.consume({
        buckets: [bucket],
        now: new Date('2026-09-03T10:01:10.000Z'),
      })

      expect(next.ok && next.buckets[0]?.hits).toBe(1)

      // Une purge se prouve en l'exécutant (`docs/reliability.md` §1).
      const swept = await limiter.sweep(new Date('2026-09-03T10:01:00.000Z'))

      expect(swept).toEqual({ ok: true, removed: 0 })

      const later = await limiter.sweep(new Date('2026-09-03T10:02:00.000Z'))

      expect(later).toEqual({ ok: true, removed: 1 })
    })

    /**
     * **Le balayage n'efface que des fenêtres réellement closes** — constat C1
     * de la revue, reproduit ici avant d'être corrigé.
     *
     * La table est **partagée** depuis s28 : `marketing` la balaie avec sa
     * fenêtre de 600 s, `billing` avec la sienne, et les seaux par compte visé
     * durent 3600 s. Tant que `sweep` a signifié « efface tout ce qui est
     * antérieur à cet instant », le balayage d'un module effaçait les seaux
     * horaires **encore ouverts** des autres routes.
     *
     * Ce n'était pas théorique : le balayage de `marketing` part dès la
     * **première** soumission de chaque fenêtre de 600 s, et la limitation
     * s'exécute avant toute validation — un POST vide suffisait. « 5 par heure »
     * devenait « 5 par dix minutes » pour la réinitialisation de mot de passe,
     * le magic link et l'invitation.
     */
    it('n’efface pas un seau horaire encore ouvert quand un module balaie sa fenêtre de dix minutes', async () => {
      const limiter = createDrizzleRateLimiter({ db: first.db })
      const hourly = {
        key: '/auth/request-password-reset:subject:victime@example.test',
        max: 5,
        windowSeconds: 3_600,
      }

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await limiter.consume({ buckets: [hourly], now: new Date('2026-09-03T10:00:10.000Z') })
      }

      const sixth = await limiter.consume({
        buckets: [hourly],
        now: new Date('2026-09-03T10:05:00.000Z'),
      })

      expect(sixth.ok && sixth.buckets[0]?.exceeded).toBe(true)

      // Le balayage que `marketing` déclenche à la première soumission de sa
      // fenêtre de 600 s. Il ne doit **rien** trouver à effacer : la fenêtre du
      // seau horaire se ferme à 11:00.
      const swept = await limiter.sweep(new Date('2026-09-03T10:20:00.000Z'))

      expect(swept).toEqual({ ok: true, removed: 0 })

      // Et le compteur n'a pas été remis à zéro : la 7ᵉ tentative reste refusée.
      const seventh = await limiter.consume({
        buckets: [hourly],
        now: new Date('2026-09-03T10:21:00.000Z'),
      })

      expect(seventh.ok && seventh.buckets[0]?.exceeded).toBe(true)
    })

    it('efface le seau court dont la fenêtre est close, dans le même passage', async () => {
      // La contrepartie : le balayage doit continuer de récupérer ce qui est
      // réellement clos, sans quoi la table ne se vide jamais (constat F1 de la
      // revue de s11).
      const limiter = createDrizzleRateLimiter({ db: first.db })

      await limiter.consume({
        buckets: [
          { key: '/marketing/contact:client:203.0.113.5', max: 5, windowSeconds: 600 },
          { key: '/auth/sign-up/email:subject:quelquun@example.test', max: 5, windowSeconds: 3_600 },
        ],
        now: new Date('2026-09-03T10:00:10.000Z'),
      })

      // À 10:20, la fenêtre de 600 s ouverte à 10:00 est close ; celle de
      // 3600 s ne l'est pas.
      expect(await limiter.sweep(new Date('2026-09-03T10:20:00.000Z'))).toEqual({
        ok: true,
        removed: 1,
      })

      const rows = await first.db.execute<{ count: number }>(
        sql`select count(*)::int as count from rate_limit_window`,
      )

      expect(Number(rows.rows[0]?.count ?? 0)).toBe(1)
    })

    it('rend un échec — et ne lève pas — quand le magasin ne répond pas', async () => {
      // Le magasin **est** la base de l'application. Ce que le répartiteur fait
      // de cet échec est une décision écrite (ADR 050) : il refuse.
      const unreachable = createDatabaseClient({
        connectionString: 'postgresql://absent:absent@127.0.0.1:1/absent',
        connectionTimeoutMillis: 500,
        maxConnections: 1,
      })

      try {
        const result = await createDrizzleRateLimiter({
          db: unreachable.db,
          timeoutMs: 1_000,
        }).consume({
          buckets: [{ key: '/auth/sign-in:client:1.2.3.4', max: 5, windowSeconds: 60 }],
          now: new Date(),
        })

        expect(result.ok).toBe(false)
        expect(!result.ok && result.error.code).toBe('store_unavailable')
        // Le message est assaini : ni chaîne de connexion, ni clé de seau.
        expect(!result.ok && result.error.message).not.toContain('absent:absent')
      } finally {
        await unreachable.close()
      }
    })
  },
)

/**
 * Le registre réel du dépôt, avec un gestionnaire **compté** à la place de
 * chaque vrai.
 *
 * Ce qui porte le défaut recherché est la **déclaration** — le chemin, la
 * protection, la politique et le champ du compte visé — et elle n'est pas
 * touchée. Le gestionnaire, lui, appellerait la bibliothèque
 * d'authentification et sa base : le remplacer permet en plus de mesurer ce qui
 * compte autant que le refus, à savoir que **le refus ne l'atteint jamais**.
 */
const countingRegistry = (): { registry: ModuleRegistry; handled: () => number } => {
  const real = buildRegistry({
    available: [...availableModules],
    enabled: [...enabledModules],
    required: [...requiredModules],
    locales: [...appLocales],
  })

  let handled = 0

  return {
    registry: {
      ...real,
      routes: real.routes.map((route) => ({
        ...route,
        handler: () => {
          handled += 1

          return Response.json({ ok: true })
        },
      })),
    },
    handled: () => handled,
  }
}

const guardWith = (
  limiter: RateLimiter,
  log: RateLimitLogger = () => {},
  now: () => Date = () => new Date('2026-09-03T10:00:10.000Z'),
): RouteRateLimitGuard =>
  createRouteRateLimitGuard({
    limiter,
    policies: parseRateLimitPolicies(rateLimitPolicies),
    now,
    log,
  })

const signInRequest = (client: string, email: string): Request =>
  new Request(`https://app.test${MODULE_ROUTE_PREFIX}/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': client },
    body: JSON.stringify({ email, password: 'mot-de-passe-quelconque' }),
  })

describe('la double limitation : le bourrage d’identifiants distribué', () => {
  /**
   * **Le test qui porte la story.**
   *
   * Il simule la **distribution**, pas la répétition : dix mille adresses
   * distinctes, un essai chacune, contre le même compte. Un test qui frapperait
   * cent fois depuis la même adresse serait vert contre un code qui ne protège
   * rien — c'est exactement le piège que le plan nomme, et la moitié des
   * implémentations réelles y tombe.
   */
  const DISTRIBUTED_ATTEMPTS = 10_000

  it('bloque dix mille adresses distinctes qui visent le même compte', async () => {
    const { registry, handled } = countingRegistry()
    const rateLimit = guardWith(createMemoryRateLimiter())
    const statuses: number[] = []

    for (let attempt = 0; attempt < DISTRIBUTED_ATTEMPTS; attempt += 1) {
      const response = await dispatchModuleRequest(
        registry,
        signInRequest(`198.51.${Math.floor(attempt / 250)}.${attempt % 250}`, 'victime@example.test'),
        { rateLimit },
      )

      statuses.push(response.status)
    }

    const refused = statuses.filter((status) => status === 429).length
    const allowed = statuses.filter((status) => status !== 429).length
    const policy = parseRateLimitPolicies(rateLimitPolicies).signIn

    // Chaque adresse reste sous *son* seuil : seul le seau par compte visé
    // arrête l'attaque, et il l'arrête au seuil configuré.
    expect(policy?.maxPerSubject).not.toBeNull()
    expect(allowed).toBe(policy?.maxPerSubject)
    expect(refused).toBe(DISTRIBUTED_ATTEMPTS - (policy?.maxPerSubject ?? 0))

    // Un refus qui atteint quand même le gestionnaire n'est pas un refus : il
    // aurait déjà coûté une lecture de compte et une vérification de mot de passe.
    expect(handled()).toBe(allowed)
  })

  it('ne fait pas tomber les autres comptes avec celui qui est visé', async () => {
    // Le seau par compte est aussi une arme : sans cette propriété, saturer le
    // compte de quelqu'un l'empêcherait de se connecter. C'est le prix assumé
    // — mais il ne doit peser que sur le compte visé.
    const { registry } = countingRegistry()
    const rateLimit = guardWith(createMemoryRateLimiter())

    for (let attempt = 0; attempt < 200; attempt += 1) {
      await dispatchModuleRequest(
        registry,
        signInRequest(`203.0.113.${attempt % 250}`, 'victime@example.test'),
        { rateLimit },
      )
    }

    const other = await dispatchModuleRequest(
      registry,
      signInRequest('203.0.113.9', 'quelqu-un-dautre@example.test'),
      { rateLimit },
    )

    expect(other.status).not.toBe(429)
  })

  it('compte une adresse inconnue comme une autre', async () => {
    // Ne pas compter une adresse sans compte apprendrait à l'attaquant
    // lesquelles existent — l'énumération inversée que `docs/security.md` §3
    // refuse, la même règle qui rend « compte inconnu » et « mot de passe
    // erroné » indiscernables.
    const { registry } = countingRegistry()
    const rateLimit = guardWith(createMemoryRateLimiter())
    const policy = parseRateLimitPolicies(rateLimitPolicies).signIn
    const attempts = (policy?.maxPerSubject ?? 0) + 1
    const statuses: number[] = []

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const response = await dispatchModuleRequest(
        registry,
        signInRequest(`192.0.2.${attempt}`, 'personne@nulle-part.test'),
        { rateLimit },
      )

      statuses.push(response.status)
    }

    expect(statuses.at(-1)).toBe(429)
  })

  it('limite aussi le martèlement d’une seule adresse, plus tôt', async () => {
    const { registry } = countingRegistry()
    const rateLimit = guardWith(createMemoryRateLimiter())
    const policy = parseRateLimitPolicies(rateLimitPolicies).signIn
    const statuses: number[] = []

    for (let attempt = 0; attempt <= (policy?.maxPerClient ?? 0); attempt += 1) {
      const response = await dispatchModuleRequest(
        registry,
        signInRequest('203.0.113.42', `cible-${attempt}@example.test`),
        { rateLimit },
      )

      statuses.push(response.status)
    }

    expect(statuses.filter((status) => status === 429)).toHaveLength(1)
  })
})

describe('la récupération du magasin ne dépend d’aucun module optionnel', () => {
  /**
   * **Constat M1 de la revue** : avant ce correctif, `sweep` n'avait que deux
   * appelants de production, tous deux dans des modules **optionnels**
   * (`marketing`, `billing`). Coupez-les — deux configurations livrables — et
   * `rate_limit_window` n'était jamais récupérée, alors que la clé de ligne
   * dérive d'un en-tête que l'appelant écrit : n'importe quel anonyme y insérait
   * un nombre illimité de lignes permanentes. C'est le constat F1 de la revue de
   * s11, réintroduit sur 31 points d'entrée au lieu de 2.
   *
   * Le garde balaie donc lui-même, et il est sur le chemin de **toute** route
   * limitée : il n'y a plus de configuration où personne ne récupère.
   */
  const sweepingGuard = (): {
    readonly guard: RouteRateLimitGuard
    readonly sweptAt: readonly Date[]
    setNow: (instant: Date) => void
  } => {
    const sweptAt: Date[] = []
    let current = new Date('2026-09-03T10:00:00.000Z')
    const memory = createMemoryRateLimiter()

    return {
      sweptAt,
      setNow: (instant) => {
        current = instant
      },
      guard: createRouteRateLimitGuard({
        limiter: {
          consume: memory.consume,
          sweep: async (instant) => {
            sweptAt.push(instant)

            return await memory.sweep(instant)
          },
        },
        policies: parseRateLimitPolicies(rateLimitPolicies),
        now: () => current,
        log: () => {},
      }),
    }
  }

  it('balaie depuis le garde, sans qu’aucun module optionnel ne soit activé', async () => {
    const { registry } = countingRegistry()
    const { guard, sweptAt } = sweepingGuard()

    await dispatchModuleRequest(registry, signInRequest('203.0.113.1', 'a@example.test'), {
      rateLimit: guard,
    })

    expect(sweptAt).toHaveLength(1)
  })

  it('ne balaie qu’une fois par intervalle : ce n’est pas une écriture par requête', async () => {
    // Le balayage est une suppression indexée ; la payer à chaque requête
    // publique coûterait une instruction de plus pour ne rien trouver.
    const { registry } = countingRegistry()
    const { guard, sweptAt, setNow } = sweepingGuard()

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await dispatchModuleRequest(
        registry,
        signInRequest(`203.0.113.${attempt}`, `a-${attempt}@example.test`),
        { rateLimit: guard },
      )
    }

    expect(sweptAt).toHaveLength(1)

    // Un intervalle plus tard, il repart.
    setNow(new Date('2026-09-03T10:20:00.000Z'))
    await dispatchModuleRequest(registry, signInRequest('203.0.113.99', 'b@example.test'), {
      rateLimit: guard,
    })

    expect(sweptAt).toHaveLength(2)
    // Et il balaie à l'**instant présent**, jamais à une borne inventée : c'est
    // ce qui laisse les seaux longs encore ouverts tranquilles (constat C1).
    expect(sweptAt[1]?.toISOString()).toBe('2026-09-03T10:20:00.000Z')
  })

  it('déclare aussi une tâche planifiée, pour l’ordonnanceur de s33', async () => {
    // Le balayage opportuniste suffit tant que du trafic arrive ; une
    // application au repos n'en produit pas. La tâche déclarée est ce que
    // l'ordonnanceur prendra, et le contrat la porte déjà.
    const job = rateLimitModule.jobs.find((candidate) => candidate.id === 'sweep-closed-windows')

    expect(job).toBeDefined()
    expect(job?.schedule).toMatch(/\S/)
  })
})

describe('la vérification de double authentification', () => {
  /**
   * **Constat M2 de la revue** : `config/security.ts` affirmait que le seuil
   * empêchait de parcourir le million de codes à six chiffres, alors que
   * `twoFactor` n'avait **que** le seau d'appelant — donc rien, pour qui fait
   * tourner `x-forwarded-for`. La route est publique à dessein (le défi n'a pas
   * encore de session) et son corps ne porte que `code` : il n'y avait aucune
   * cible à compter.
   *
   * Le cookie de défi est la cible : **posé et signé par le serveur**, il ne se
   * fabrique pas. C'est lui, et non l'en-tête, que le seau par compte suit.
   */
  const verifyRequest = (client: string, cookie: string): Request =>
    new Request(`https://app.test${MODULE_ROUTE_PREFIX}/auth/two-factor/verify-totp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': client, cookie },
      body: JSON.stringify({ code: '123456' }),
    })

  const realChallenge = (value: string): string => `__Secure-better-auth.two_factor=${value}`

  it('bloque l’énumération des codes menée depuis autant d’adresses que d’essais', async () => {
    const { registry, handled } = countingRegistry()
    const rateLimit = guardWith(createMemoryRateLimiter())
    const policy = parseRateLimitPolicies(rateLimitPolicies).twoFactor
    const statuses: number[] = []

    expect(policy?.maxPerSubject).not.toBeNull()

    for (let attempt = 0; attempt <= (policy?.maxPerSubject ?? 0); attempt += 1) {
      const response = await dispatchModuleRequest(
        registry,
        // Une adresse par essai : le seau d'appelant ne rencontre jamais son
        // seuil, et c'est bien celui du défi qui refuse.
        verifyRequest(`198.51.100.${attempt}`, realChallenge('defi-de-la-victime')),
        { rateLimit },
      )

      statuses.push(response.status)
    }

    expect(statuses.filter((status) => status === 429)).toHaveLength(1)
    expect(statuses.at(-1)).toBe(429)
    // Le refus n'atteint pas le gestionnaire : il ne coûte aucune vérification
    // de code, ni aucune lecture de code de secours.
    expect(handled()).toBe(policy?.maxPerSubject)
  })

  it('ne fait pas tomber le défi de quelqu’un d’autre', async () => {
    const { registry } = countingRegistry()
    const rateLimit = guardWith(createMemoryRateLimiter())
    const policy = parseRateLimitPolicies(rateLimitPolicies).twoFactor

    for (let attempt = 0; attempt <= (policy?.maxPerSubject ?? 0); attempt += 1) {
      await dispatchModuleRequest(
        registry,
        verifyRequest('203.0.113.1', realChallenge('defi-victime')),
        { rateLimit },
      )
    }

    const other = await dispatchModuleRequest(
      registry,
      verifyRequest('203.0.113.1', realChallenge('defi-de-quelquun-dautre')),
      { rateLimit },
    )

    expect(other.status).not.toBe(429)
  })

  /**
   * **Le contournement par leurre, mesuré puis fermé** (constat C1 de la
   * re-revue).
   *
   * L'en-tête `Cookie` est écrit intégralement par l'appelant. Tant que la
   * lecture se faisait par **suffixe**, un `two_factor=<compteur>` posé en tête
   * suffisait : le limiteur comptait le leurre qui tourne, la bibliothèque
   * validait le vrai défi, et les six chiffres redevenaient énumérables sans
   * borne. Mesuré alors : 200 tentatives, 0 refus.
   */
  it('n’est pas dupée par un leurre posé en tête de l’en-tête Cookie', async () => {
    const { registry } = countingRegistry()
    const rateLimit = guardWith(createMemoryRateLimiter())
    const policy = parseRateLimitPolicies(rateLimitPolicies).twoFactor
    const statuses: number[] = []

    for (let attempt = 0; attempt <= (policy?.maxPerSubject ?? 0); attempt += 1) {
      const response = await dispatchModuleRequest(
        registry,
        verifyRequest(
          `198.51.100.${attempt}`,
          // Le leurre **d'abord**, et sa valeur tourne à chaque essai : c'est
          // exactement ce que la re-revue a joué contre l'application démarrée.
          `two_factor=leurre-${attempt}; ${realChallenge('defi-de-la-victime')}`,
        ),
        { rateLimit },
      )

      statuses.push(response.status)
    }

    expect(statuses.filter((status) => status === 429)).toHaveLength(1)
    expect(statuses.at(-1)).toBe(429)
  })

  /**
   * **Le même défi, ré-encodé** (constat M1 de la troisième revue).
   *
   * Le nom lu était le bon ; la **valeur** ne l'était pas. La bibliothèque lit
   * `parsedCookies.get(nom)`, et cette table
   * (`better-call@1.4.0/dist/cookies.mjs:19-40`) retire les guillemets
   * encadrants puis applique `decodeURIComponent` dès qu'il y a un `%`. Le
   * limiteur, lui, prenait la sous-chaîne brute : l'appelant, qui écrit
   * l'en-tête `Cookie` en entier, scindait son propre seau à volonté en
   * ré-encodant un caractère de plus à chaque essai. Mesuré alors contre
   * l'application démarrée : quinze encodages du même défi → 401×15, la même
   * valeur brute → 401×10 puis 429×5.
   */
  it('n’est pas dupée par un ré-encodage du même défi', async () => {
    const { registry, handled } = countingRegistry()
    const rateLimit = guardWith(createMemoryRateLimiter())
    const policy = parseRateLimitPolicies(rateLimitPolicies).twoFactor
    const challenge = 'defi-de-la-victime'
    const statuses: number[] = []

    /** Le même défi, avec un caractère de plus écrit en `%XX` à chaque essai. */
    const encodedAt = (index: number): string =>
      [...challenge]
        .map((character, position) =>
          position <= index
            ? `%${character.charCodeAt(0).toString(16).toUpperCase()}`
            : character,
        )
        .join('')

    expect(challenge.length).toBeGreaterThan(policy?.maxPerSubject ?? 0)

    for (let attempt = 0; attempt <= (policy?.maxPerSubject ?? 0); attempt += 1) {
      const response = await dispatchModuleRequest(
        registry,
        // Une adresse par essai **et** un encodage par essai : ni le seau
        // d'appelant ni un encodage ne se répètent. Seule la valeur que le
        // serveur lira se répète — et c'est elle qui doit refuser.
        verifyRequest(`198.51.100.${attempt}`, realChallenge(encodedAt(attempt))),
        { rateLimit },
      )

      statuses.push(response.status)
    }

    expect(statuses.filter((status) => status === 429)).toHaveLength(1)
    expect(statuses.at(-1)).toBe(429)
    expect(handled()).toBe(policy?.maxPerSubject)
  })

  it('refuse d’emblée quand deux cookies de défi déclarés sont présents', async () => {
    // La bibliothèque n'en lit qu'un, et lequel dépend de sa configuration.
    // Deviner rouvrirait le contournement dans la moitié des déploiements ; un
    // navigateur légitime n'envoie jamais les deux.
    const { registry, handled } = countingRegistry()
    const response = await dispatchModuleRequest(
      registry,
      verifyRequest(
        '203.0.113.1',
        'better-auth.two_factor=leurre; __Secure-better-auth.two_factor=le-vrai',
      ),
      { rateLimit: guardWith(createMemoryRateLimiter()) },
    )

    expect(response.status).toBe(429)
    expect(handled()).toBe(0)
  })

  /**
   * **Le seuil doit pouvoir mordre le premier** (constat M1 de la troisième
   * revue).
   *
   * `maxPerSubject: 10` était écrit au-dessus du plafond que la bibliothèque
   * s'impose déjà par défi : `beginAttempt(5)` sur le chemin `isSignIn`
   * (`dist/plugins/two-factor/totp/index.mjs`, idem pour les codes de secours),
   * qui **détruit le défi** au cinquième essai
   * (`dist/plugins/two-factor/verify-two-factor.mjs`). Sur un défi authentique,
   * le seau de s28 ne pouvait donc jamais refuser le premier : la garantie
   * écrite en cinq endroits était tenue par une dépendance, en silence.
   *
   * Le plafond est **dérivé de la bibliothèque installée**, jamais recopié : un
   * saut de version qui le déplace fait rougir ce cas au lieu de laisser la
   * phrase vieillir.
   */
  it('reste sous le plafond par défi de la bibliothèque, dérivé de la bibliothèque', () => {
    const libraryRoot = join(REPO_ROOT, 'packages/modules/auth/node_modules/better-auth')
    const version = (
      JSON.parse(readFileSync(join(libraryRoot, 'package.json'), 'utf8')) as { version: string }
    ).version
    const verificationPaths = [
      'dist/plugins/two-factor/totp/index.mjs',
      'dist/plugins/two-factor/backup-codes/index.mjs',
    ]
    const caps = verificationPaths.flatMap((path) =>
      [...readFileSync(join(libraryRoot, path), 'utf8').matchAll(/beginAttempt\((\d+)\)/g)].map(
        (match) => Number(match[1]),
      ),
    )

    // Un balayage vide passerait pour une raison qui n'en est pas une (s26) :
    // les deux chemins de vérification doivent avoir été lus, et chacun ne
    // déclare qu'un plafond.
    expect(caps).toHaveLength(verificationPaths.length)

    const policy = rateLimitPolicies.twoFactor

    expect(policy.maxPerSubject).not.toBeNull()
    expect(policy.maxPerSubject ?? 0).toBeLessThan(Math.min(...caps))
    // Le fichier que lit l'exploitant nomme la version mesurée. Sans cela, la
    // phrase « le second filet est celui de la bibliothèque » survivrait à la
    // version qui l'a rendue fausse.
    expect(readFileSync(join(REPO_ROOT, 'config/security.ts'), 'utf8')).toContain(
      `better-auth@${version}`,
    )
  })

  /**
   * **Constat m1 de la quatrième revue** : `packages/modules/rate-limit/AGENTS.md`
   * écrivait « **deux** plafonds bornent l'énumération 2FA ». Il y en a un
   * troisième, sur un **autre axe** — le verrouillage de compte de la
   * bibliothèque, en travers des défis et des facteurs —, et il est le plus
   * serré pour une attaque suivie sur un compte. La ronde 3 l'avait nommé ; le
   * correctif de la ronde 4 l'a perdu.
   *
   * Le compte n'est plus une phrase : les trois valeurs sont **dérivées de la
   * bibliothèque installée**, le fait que ce dépôt ne les configure pas est
   * assertionné, et le fichier de règles doit les nommer. Une version qui les
   * déplace, une configuration qui les remplace ou une phrase qui les oublie
   * rougit ici.
   *
   * Ce que ce cas ne prouve pas, et qui reste écrit tel quel : que le
   * verrouillage ait été **exercé**. Personne n'a encore brûlé dix
   * vérifications fausses sur un compte authentique — c'est le geste humain que
   * la revue réclame depuis quatre rondes.
   */
  it('nomme le troisième plafond, celui du verrouillage de compte de la bibliothèque', () => {
    const libraryRoot = join(REPO_ROOT, 'packages/modules/auth/node_modules/better-auth')
    const verification = readFileSync(
      join(libraryRoot, 'dist/plugins/two-factor/verify-two-factor.mjs'),
      'utf8',
    )
    const defaults =
      /enabled:\s*lockout\?\.enabled\s*\?\?\s*(true|false),\s*maxFailedAttempts:\s*lockout\?\.maxFailedAttempts\s*\?\?\s*(\d+),\s*durationMs:\s*\(lockout\?\.durationSeconds\s*\?\?\s*(\d+)\)/.exec(
        verification,
      )

    // Un balayage vide passerait pour une raison qui n'en est pas une (s26).
    expect(defaults, 'resolveAccountLockoutConfig introuvable').not.toBeNull()

    const [, enabled = '', maxFailedAttempts = '', durationSeconds = ''] = defaults ?? []

    // Le verrouillage est appliqué sur les deux facteurs, et **à la connexion
    // seulement** : c'est ce qui en fait un axe distinct des deux autres.
    for (const factor of ['totp', 'backup-codes']) {
      const source = readFileSync(
        join(libraryRoot, `dist/plugins/two-factor/${factor}/index.mjs`),
        'utf8',
      )

      expect(source, factor).toContain('if (isSignIn) await assertTwoFactorNotLocked(')
      expect(source, factor).toContain('if (isSignIn) await recordTwoFactorFailure(')
    }

    // Ces défauts ne s'appliquent que parce que ce dépôt ne les remplace pas.
    // Le jour où il configure `accountLockout`, la phrase du fichier de règles
    // devient fausse — et ce cas le dit.
    expect(
      readFileSync(
        join(REPO_ROOT, 'packages/modules/auth/src/infrastructure/better-auth-service.ts'),
        'utf8',
      ),
    ).not.toMatch(/accountLockout/)
    expect(enabled).toBe('true')

    const rules = readFileSync(
      join(REPO_ROOT, 'packages/modules/rate-limit/AGENTS.md'),
      'utf8',
    )

    expect(rules).toContain('accountLockout')
    expect(rules).toContain(`${maxFailedAttempts} vérifications`)
    expect(rules).toContain(`${durationSeconds} s`)
  })

  it('n’invente pas le nom du cookie : la configuration d’auth ne le renomme pas', () => {
    /**
     * `TWO_FACTOR_CHALLENGE_COOKIES` suppose le préfixe par défaut de la
     * bibliothèque. Si ce dépôt configurait `advanced.cookiePrefix` ou
     * `advanced.cookies.two_factor.name`, le nom réel changerait et le seau ne
     * compterait plus rien — en silence. Voici la commande qui échoue.
     */
    const service = readFileSync(
      join(REPO_ROOT, 'packages/modules/auth/src/infrastructure/better-auth-service.ts'),
      'utf8',
    )

    expect(service).not.toMatch(/cookiePrefix/)
    expect(service).not.toMatch(/two_factor\s*:\s*\{[^}]*name/)
    expect(TWO_FACTOR_CHALLENGE_COOKIES).toEqual([
      '__Secure-better-auth.two_factor',
      'better-auth.two_factor',
    ])
  })
})

describe('le refus lui-même', () => {
  it('répond 429 avec un Retry-After qui suit la fenêtre réelle', async () => {
    const { registry } = countingRegistry()
    const policy = parseRateLimitPolicies(rateLimitPolicies).signIn
    // À quarante secondes du début d'une fenêtre de 300 : il en reste 260.
    const now = new Date('2026-09-03T10:00:40.000Z')
    const rateLimit = guardWith(createMemoryRateLimiter(), () => {}, () => now)
    let last: Response | undefined

    for (let attempt = 0; attempt <= (policy?.maxPerClient ?? 0); attempt += 1) {
      last = await dispatchModuleRequest(
        registry,
        signInRequest('203.0.113.77', `cible-${attempt}@example.test`),
        { rateLimit },
      )
    }

    expect(last?.status).toBe(429)
    // Un `Retry-After` figé à la durée de la fenêtre mentirait de 40 secondes,
    // et le client honnête qui le croit se ferait refuser une seconde fois.
    expect(last?.headers.get('retry-after')).toBe('260')
    expect(Number(last?.headers.get('retry-after'))).toBeLessThan(policy?.windowSeconds ?? 0)
  })

  it('journalise le dépassement avec l’IP et la route, et rien d’autre', async () => {
    const { registry } = countingRegistry()
    const journal = recordingRateLimitLog()
    const rateLimit = guardWith(createMemoryRateLimiter(), journal.log)
    const policy = parseRateLimitPolicies(rateLimitPolicies).signIn

    for (let attempt = 0; attempt <= (policy?.maxPerSubject ?? 0); attempt += 1) {
      await dispatchModuleRequest(
        registry,
        signInRequest(`192.0.2.${attempt}`, 'victime@example.test'),
        { rateLimit },
      )
    }

    const exceeded = journal.records.filter((record) => record.event === 'rate_limit.exceeded')

    expect(exceeded).toHaveLength(1)
    expect(exceeded[0]).toMatchObject({
      route: '/auth/sign-in/email',
      method: 'POST',
      client: `192.0.2.${policy?.maxPerSubject}`,
      bucket: 'subject',
    })
    // Le journal ne condense pas — le critère 6 demande l'IP —, mais il ne
    // porte ni mot de passe, ni compte visé : `bucket` dit lequel des deux
    // seaux a refusé, jamais sa valeur.
    expect(JSON.stringify(exceeded[0])).not.toContain('mot-de-passe')
    expect(JSON.stringify(exceeded[0])).not.toContain('victime@example.test')
  })

  it('refuse quand le magasin est indisponible, et ne laisse rien passer', async () => {
    /**
     * **Exception assumée au socle de fiabilité** (ADR 050). « Un tiers absent
     * dégrade, il ne casse pas » — mais ce magasin est la base de
     * l'application : si elle est absente, la connexion ne fonctionne pas
     * davantage, les sessions y vivent. Refuser ne coûte aucune disponibilité
     * réelle ; laisser passer ferait disparaître la protection exactement au
     * moment où l'application est fragile.
     */
    const { registry, handled } = countingRegistry()
    const journal = recordingRateLimitLog()
    const response = await dispatchModuleRequest(
      registry,
      signInRequest('203.0.113.1', 'victime@example.test'),
      { rateLimit: guardWith(unavailableRateLimiter, journal.log) },
    )

    expect(response.status).toBe(429)
    expect(handled()).toBe(0)
    expect(journal.records.map((record) => record.event)).toEqual([
      'rate_limit.store_unavailable',
    ])
  })

  it('refuse quand aucun garde n’est branché : le répartiteur est fail-closed', async () => {
    // Un oubli de câblage au point de composition doit être immédiatement
    // visible, pas silencieusement permissif. Le défaut inverse ferait d'un
    // oubli une absence totale de limitation, en production comprise.
    const { registry, handled } = countingRegistry()
    const response = await dispatchModuleRequest(
      registry,
      signInRequest('203.0.113.1', 'victime@example.test'),
    )

    expect(response.status).toBe(429)
    expect(handled()).toBe(0)
  })

  it('ne consomme rien pour un chemin qui n’existe pas : 404 avant le compteur', async () => {
    const { registry } = countingRegistry()
    const journal = recordingRateLimitLog()
    let consumed = 0
    const limiter = createMemoryRateLimiter()
    const counting: RateLimiter = {
      consume: async (input) => {
        consumed += 1

        return await limiter.consume(input)
      },
      sweep: limiter.sweep,
    }

    const response = await dispatchModuleRequest(
      registry,
      new Request(`https://app.test${MODULE_ROUTE_PREFIX}/chemin/invente`, { method: 'POST' }),
      { rateLimit: guardWith(counting, journal.log) },
    )

    expect(response.status).toBe(404)
    // Sinon n'importe quelle URL inventée écrirait une ligne dans le magasin :
    // le compteur deviendrait lui-même une surface d'attaque.
    expect(consumed).toBe(0)
  })
})

/**
 * Le catalogue **entier**, modules non activés compris.
 *
 * Compter sur le seul registre livré laisserait hors du balayage les points
 * d'entrée d'un module que ce dépôt n'active pas — `demo-disabled` aujourd'hui,
 * n'importe lequel demain. Une couverture qui dépend de la configuration n'est
 * pas une couverture.
 */
const catalogueRoutes = (): readonly RegistryRoute[] =>
  buildRegistry({
    available: [...availableModules],
    enabled: availableModules.map((module) => module.id),
    required: [...requiredModules],
    locales: [...appLocales],
  }).routes

describe('la convergence des points d’entrée', () => {
  /**
   * **Le compte, pas l'échantillon** — s26 a établi le motif : un balayage vide
   * passe pour une bonne raison qui n'en est pas une.
   *
   * Ces planchers ne disent pas ce qui existe, ils disent **ce qui a été
   * mesuré** le 3 septembre 2026, sur le catalogue entier : 26 routes publiques
   * (`auth` 19, `billing` 2, `consent` 1, `marketing` 2, `demo-enabled` 1,
   * `demo-disabled` 1) et 5 routes authentifiées que le critère 2 nomme
   * (invitation, relance d'invitation, et les trois du téléversement). La
   * recherche annonçait 28 publiques dont 18 sur `auth` : elle comptait les
   * occurrences de `level: 'public'`, entrées de navigation comprises. Le
   * registre est la mesure.
   *
   * Ils rougissent si des points d'entrée **disparaissent** du balayage — c'est
   * exactement ce qu'on veut savoir.
   */
  const PUBLIC_ROUTES_MEASURED = 26
  const LIMITED_ROUTES_MEASURED = 31

  it('limite toutes les routes publiques du catalogue, sans en nommer une seule', () => {
    const routes = catalogueRoutes()
    const publicRoutes = routes.filter((route) => route.protection.level === 'public')
    const uncovered = publicRoutes.filter((route) => !routeIsRateLimited(route))

    expect(publicRoutes.length).toBeGreaterThanOrEqual(PUBLIC_ROUTES_MEASURED)
    expect(uncovered.map((route) => `${route.method} ${route.path}`)).toEqual([])
    expect(routes.filter((route) => routeIsRateLimited(route)).length).toBeGreaterThanOrEqual(
      LIMITED_ROUTES_MEASURED,
    )
  })

  it('couvre chacun des huit points d’entrée que le critère 2 nomme', () => {
    // Le critère les énumère ; ce test les retrouve **dans le registre** et
    // vérifie que chacun est limité. Un chemin qui disparaîtrait du registre
    // fait rougir la ligne qui le cherche, pas seulement celle qui le limite.
    const routes = catalogueRoutes()
    const limited = new Set(
      routes.filter((route) => routeIsRateLimited(route)).map((route) => route.path),
    )

    const named: readonly (readonly [string, string])[] = [
      ['inscription', '/auth/sign-up/email'],
      ['réinitialisation de mot de passe', '/auth/request-password-reset'],
      ['magic link', '/auth/sign-in/magic-link'],
      ['vérification de double authentification', '/auth/two-factor/verify-totp'],
      ['invitation', '/organizations/invite'],
      ['formulaire public', '/marketing/contact'],
      ['téléversement', '/storage/avatar/presign'],
      ['checkout anonyme', '/billing/guest-checkout'],
      ['connexion', '/auth/sign-in/email'],
    ]

    for (const [label, path] of named) {
      expect(routes.map((route) => route.path), label).toContain(path)
      expect(limited.has(path), label).toBe(true)
    }

    expect(named).toHaveLength(9)
  })

  it('ne nomme aucune politique que config/security.ts ignore', () => {
    // Symétrique d'`assertGatesCoverRoutes` : une faute de frappe produirait une
    // route servie sans limite, et rien ne rougirait.
    expect(() =>
      assertPoliciesCoverRoutes({
        policies: parseRateLimitPolicies(rateLimitPolicies),
        routes: catalogueRoutes(),
      }),
    ).not.toThrow()
  })

  /**
   * **Le tiers qui ne peut pas réessayer indéfiniment n'est jamais le premier
   * refusé** (constat m3 de la troisième revue).
   *
   * `/billing/webhook` est publique, donc limitée par le seau de l'appelant.
   * Hors d'un proxy de confiance qui écrase `x-forwarded-for`, Stripe et un
   * inondateur anonyme tombent dans le **même** seau `unknown` : une inondation
   * peut pousser les livraisons du fournisseur en 429. La décision est écrite
   * dans `config/security.ts` et dans `docs/deployment.md` — cela dégrade au
   * lieu de casser, et la vraie réponse est le relais, pas un seuil. Ce que ce
   * cas garde, c'est la moitié qu'une commande peut tenir : la politique du
   * webhook est **la plus large de toutes**, en passages par minute.
   *
   * Ce qu'il ne prouve pas, et il faut le dire : qu'une inondation réelle laisse
   * passer les livraisons. Rien ici ne mesure cela — aucun Stripe réel n'a
   * rejoué de rafale contre ce dépôt.
   */
  it('donne au webhook le seau le plus large de toutes les politiques', () => {
    const perMinute = (policy: { windowSeconds: number; maxPerClient: number }): number =>
      (policy.maxPerClient / policy.windowSeconds) * 60
    const others = Object.entries(rateLimitPolicies).filter(([name]) => name !== 'webhook')

    // Un balayage vide passerait pour une raison qui n'en est pas une (s26).
    expect(others.length).toBeGreaterThan(5)

    for (const [name, policy] of others) {
      expect(
        perMinute(rateLimitPolicies.webhook),
        `la politique ${name} est plus large que celle du webhook`,
      ).toBeGreaterThan(perMinute(policy))
    }
  })

  it('n’enregistre rien pour un module coupé, et ne casse pas le démarrage', () => {
    // Critère 3, dérivé du registre : la route d'un module non activé n'est
    // dans aucune table, donc il n'y a rien à ne pas limiter.
    const withoutBilling = buildRegistry({
      available: [...availableModules],
      enabled: enabledModules.filter((id) => id !== 'billing'),
      required: [...requiredModules],
      locales: [...appLocales],
    })

    expect(withoutBilling.routes.map((route) => route.path)).not.toContain(
      '/billing/guest-checkout',
    )
    expect(
      withoutBilling.routes.filter((route) => route.rateLimit?.policy === 'guestCheckout'),
    ).toEqual([])
    expect(() =>
      assertPoliciesCoverRoutes({
        policies: parseRateLimitPolicies(rateLimitPolicies),
        routes: withoutBilling.routes,
      }),
    ).not.toThrow()
  })
})

/**
 * **Aucune variable d'environnement ne désactive la limitation** (critère 8).
 *
 * Ce dépôt a payé deux fois la leçon inverse cette session : `SKIP_ENV_VALIDATION`
 * traversant un clone (s26), puis manquant de traverser une image (s27). Une
 * variable qui éteint une protection **est** une porte, et la vérifier vaut
 * mieux que l'affirmer.
 *
 * Le balayage porte sur les fichiers qui **pourraient** en lire une : le module
 * de limitation, son point de composition, et le fichier de configuration des
 * seuils. Il compte ce qu'il a lu — s26 a établi qu'un balayage vide passe pour
 * une raison qui n'en est pas une.
 */
describe('aucune échappatoire par variable d’environnement', () => {
  const sourceOf = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8')

  /**
   * **Le balayage est dérivé, pas énuméré** — constat m1 de la revue.
   *
   * La première version listait onze chemins à la main, et la revue l'a mise en
   * défaut : un fichier **neuf** portant une échappatoire laissait la suite et
   * `pnpm lint` verts. Le chemin de la limitation se dérive maintenant du
   * disque, si bien qu'un fichier ajouté au module y entre sans que personne y
   * pense.
   */
  const limiterPath = (path: string): boolean =>
    path.startsWith(`packages${sep}modules${sep}rate-limit${sep}`) ||
    path === join('apps', 'web', 'lib', 'rate-limit.ts') ||
    path === join('config', 'security.ts') ||
    path === join('packages', 'core', 'src', 'registry.ts') ||
    /shared-(submission|checkout)-throttle\.ts$/.test(path)

  it('ne lit aucune variable sur le chemin de la limitation, dérivé du disque', () => {
    const swept = productionSources().filter((file) => limiterPath(file.path))

    // `process.env` et `getEnv()` sont les deux seules portes d'entrée d'une
    // variable dans ce dépôt : la règle transverse interdit la première hors du
    // module de configuration, et la seconde est ce module.
    const offenders = swept.filter((file) => /process\.env|getEnv\(|NODE_ENV/.test(file.source))

    // Le compte est **dérivé** : il grandit quand le module grandit. Le
    // plancher dit seulement que le balayage n'est pas vide (leçon de s26).
    expect(swept.length).toBeGreaterThanOrEqual(11)
    expect(offenders.map((file) => file.path)).toEqual([])
  })

  it('ne nomme nulle part un interrupteur de limitation, dans tout le dépôt', () => {
    /**
     * La seconde moitié, et celle que la revue a prouvée manquante : une
     * échappatoire posée **ailleurs** que sur le chemin ci-dessus. Le balayage
     * porte donc sur **toutes** les sources de production, et cherche
     * l'identifiant plutôt que le fichier.
     */
    const sources = productionSources()
    const offenders = sources.filter((file) =>
      /(DISABLE|SKIP|BYPASS|NO)_?(RATE|LIMIT|THROTTLE|CAPTCHA)/i.test(file.source),
    )

    expect(sources.length).toBeGreaterThan(200)
    expect(offenders.map((file) => file.path)).toEqual([])
  })

  it('ne déclare aucune variable de limitation dans le schéma d’environnement', () => {
    // La seconde moitié : même sans lecture ici, une variable **déclarée**
    // ailleurs serait un levier qu'un futur agent brancherait.
    const env = sourceOf('packages/config/src/env.ts')
    const example = sourceOf('.env.example')
    const forbidden = /RATE_LIMIT|RATELIMIT|THROTTLE|DISABLE_LIMIT|SKIP_RATE|CAPTCHA/i

    expect(env).not.toMatch(forbidden)
    expect(example).not.toMatch(forbidden)
  })

  it('n’offre aucun drapeau de désactivation dans la configuration des seuils', () => {
    const source = sourceOf('config/security.ts')

    // Ni drapeau, ni valeur sentinelle : un seuil nul est **refusé**, pas
    // interprété comme « aucune limite ». Le cas de `rate-limit-rules.test.ts`
    // le mesure ; celui-ci refuse la porte avant qu'elle n'existe.
    expect(source).not.toMatch(/enabled:\s*(true|false)\s*,?\s*\/\/.*limit/i)
    expect(source).not.toMatch(/rateLimitEnabled|disableRateLimit|rateLimit:\s*false/)
  })
})

/**
 * **Les deux anciennes tables : abandonnées, jamais supprimées** (ADR 050).
 *
 * `docs/reliability.md` impose de cesser d'écrire **avant** de supprimer, et s27
 * a mesuré qu'un déploiement compose détruit le conteneur en service avant de
 * migrer : supprimer dans la même livraison casserait la version encore en
 * ligne, qui écrit toujours dans l'ancienne table. Le commentaire du schéma de
 * s24 disait pourtant « s28 devra la supprimer » — c'est cette consigne-là que
 * la recherche a écartée, et voici la règle exécutable qui la remplace.
 */
describe('les deux compteurs remplacés', () => {
  const SOURCES = [
    'packages/modules/marketing/src/schema.ts',
    'packages/modules/billing/src/schema.ts',
  ] as const

  it('déclare toujours les deux tables : les supprimer casserait la version en ligne', () => {
    const marketing = readFileSync(join(REPO_ROOT, SOURCES[0]), 'utf8')
    const billing = readFileSync(join(REPO_ROOT, SOURCES[1]), 'utf8')

    expect(marketing).toContain("pgTable(\n  'public_form_throttle'")
    expect(billing).toContain("pgTable(\n  'billing_checkout_throttle'")
  })

  it('ne porte plus nulle part la consigne que l’ADR 050 refuse', () => {
    /**
     * **Constat M3 de la revue** : cinq fichiers disaient encore « s28
     * supprimera la table », dont un qui renvoyait à une fonction que ce diff
     * supprime. La recherche avait nommé ce piège mot pour mot, l'ADR 050 lui
     * consacre un paragraphe — et rien ne le vérifiait. Voici la commande.
     *
     * **Une seule citation est tolérée, à la lettre près** : l'en-tête de
     * `billing/src/schema.ts` cite l'ancienne consigne pour dire qu'elle n'a pas
     * été suivie. Retirer *toute* paire de guillemets s'abusait en une ligne —
     * la re-revue l'a montré avec « … » suivi d'un « Faites-le. » hors citation
     * (constat m1). L'exception est donc la chaîne exacte, et rien d'autre.
     */
    const ALLOWED_QUOTATION = '« s28 devra la supprimer »'
    const withoutQuotes = (source: string): string => source.replaceAll(ALLOWED_QUOTATION, '')
    const sources = productionSources()
    const offenders = sources.filter((file) =>
      // La consigne dangereuse est **celle qui fait supprimer une table**, pas
      // toute phrase au futur : « le verrouillage progressif de s28 devrait… »
      // parle d'autre chose et doit rester lisible.
      /s28[^.]{0,120}supprim(er|era)/is.test(withoutQuotes(file.source)),
    )

    expect(sources.length).toBeGreaterThan(200)
    expect(offenders.map((file) => file.path)).toEqual([])

    // L'exception n'est pas décorative : elle doit exister, une fois, là où on
    // l'attend. Si elle disparaît, c'est cette ligne qui le dit — pas un
    // balayage qui deviendrait vert pour la mauvaise raison.
    expect(
      sources.filter((file) => file.source.includes(ALLOWED_QUOTATION)).map((file) => file.path),
    ).toEqual(['packages/modules/billing/src/schema.ts'])
  })

  it('ne les écrit plus depuis aucun paquet', () => {
    // Le balayage porte sur les sources de production, pas sur les tests : ce
    // qui compte est qu'aucun chemin servi n'y insère plus rien.
    const written = productionSources().filter((file) =>
      /\.(insert|update)\(\s*(publicFormThrottle|billingCheckoutThrottle)/.test(file.source),
    )

    expect(productionSources().length).toBeGreaterThan(200)
    expect(written.map((file) => file.path)).toEqual([])
  })
})

/**
 * **Le captcha : optionnel, coupé, et sans emprise sur le formulaire**
 * (critère 5).
 *
 * La règle d'activation — activé, son origine doit être déclarée dans la
 * politique de sécurité du contenu, sinon le démarrage refuse — est éprouvée là
 * où elle vit (`packages/modules/rate-limit/src/domain/rate-limit-rules.test.ts`).
 * Ce qui se mesure ici est l'autre moitié : **coupé, il n'est nulle part**.
 */
describe('les deux modules qui gardent leur règle', () => {
  /**
   * **Constat m4 de la revue** : « un magasin muet refuse » était écrit dans les
   * deux adaptateurs de module et vérifié par aucune commande — mettre leur
   * constante de refus à zéro laissait toute la suite verte. C'est le mode de
   * défaillance que le dépôt nomme, sur un chemin de sécurité.
   *
   * `marketing` et `billing` gardent leur **règle** (deux seaux, dont un qui
   * dégrade) mais comptent à travers le port. Quand le port échoue, leur compteur
   * doit rendre un nombre qui dépasse **tout** seuil, sans quoi un magasin en
   * panne ouvrirait le formulaire et le tunnel invité.
   */
  it('refusent tous les deux quand le magasin ne répond pas', async () => {
    const submission = createSharedSubmissionThrottle({
      limiter: unavailableRateLimiter,
      windowSeconds: 600,
    })
    const checkout = createSharedCheckoutThrottle({
      limiter: unavailableRateLimiter,
      windowSeconds: 600,
    })

    const windowStart = new Date('2026-09-03T10:00:00.000Z')
    const submissionHits = await submission.hit({
      bucket: { key: 'contact:client:1.2.3.4', max: 5 },
      windowStart,
    })
    const checkoutHits = await checkout.hit({
      bucket: 'guest-checkout:all',
      max: 50,
      windowStart,
    })

    // Le compte rendu doit dépasser n'importe quel seuil que la configuration
    // pourrait porter, pas seulement celui d'aujourd'hui.
    expect(submissionHits).toBeGreaterThan(Number.MAX_SAFE_INTEGER / 2)
    expect(checkoutHits).toBeGreaterThan(Number.MAX_SAFE_INTEGER / 2)
    expect(exceedsRateLimit(submissionHits, 5)).toBe(true)
    expect(exceedsRateLimit(checkoutHits, 50)).toBe(true)
  })

  it('ne prétendent pas avoir effacé quoi que ce soit quand le magasin est muet', async () => {
    // Une purge se prouve en l'exécutant : un balayage en échec qui rendrait un
    // nombre positif ferait croire à une récupération qui n'a pas eu lieu.
    const submission = createSharedSubmissionThrottle({
      limiter: unavailableRateLimiter,
      windowSeconds: 600,
    })

    expect(await submission.sweep(new Date('2026-09-03T10:00:00.000Z'))).toBe(0)
  })
})

describe('le captcha, dans l’état livré', () => {
  it('est coupé, et n’a réclamé aucune origine tierce', () => {
    // L'ADR 027 refuse les origines tierces par défaut. Un captcha livré activé
    // aurait imposé la sienne à toute installation.
    expect(captcha.enabled).toBe(false)
    expect(contentSecurityPolicySources.frame).toEqual([])
    expect(contentSecurityPolicySources.script).toEqual([])
  })

  it('laisse cinq routes Next hors du répartiteur, et le compte est assertionné', () => {
    /**
     * **Constat m3 de la re-revue** : « exception nommée : `/api/health` » se
     * lisait comme exhaustif alors que six fichiers de route vivent hors du
     * répartiteur. Le compte est dérivé du disque ; une sixième route non
     * limitée force la décision au lieu d'hériter du silence.
     *
     * Les raisons de chacune sont dans `docs/security.md` §7 — ce cas garde le
     * **compte**, pas la prose : une liste recopiée serait rouge à chaque ajout
     * légitime et aveugle au reste.
     */
    const apiRoutes = productionSources()
      .filter((file) => file.path.startsWith(join('apps', 'web', 'app', 'api')))
      .filter((file) => file.path.endsWith(`${sep}route.ts`))
    const dispatcher = apiRoutes.filter((file) => file.source.includes('dispatchModuleRequest('))

    // Le répartiteur, plus les cinq qui ne passent pas par lui.
    expect(apiRoutes).toHaveLength(6)
    // Deux fichiers appellent le répartiteur : son point de montage, et le
    // simulateur de checkout local qui fait passer ses webhooks par lui.
    // L'assertion dit exactement cela — elle disait « au moins un », c'est-à-dire
    // moins que son propre commentaire (nit de la troisième revue).
    expect(dispatcher.map((file) => file.path)).toHaveLength(2)
  })

  it('n’est une dépendance d’aucun chemin de soumission publique', () => {
    /**
     * « Désactivé, les formulaires restent pleinement fonctionnels » : la
     * manière la plus sûre de le tenir est qu'**aucun module** ne le mentionne.
     * Le balayage porte sur les modules — c'est là que vivent les soumissions —
     * et il compte ce qu'il a lu (s26 : un balayage vide passe pour une raison
     * qui n'en est pas une).
     *
     * Trois fichiers d'application le nomment légitimement et sont donc hors
     * balayage : `config/security.ts` le déclare, `apps/web/lib/rate-limit.ts`
     * le valide, `apps/web/lib/startup.ts` appelle cette validation, et
     * `apps/web/lib/security-headers.ts` en parle dans un commentaire de
     * `frame-src`. Aucun n'est sur le chemin d'une soumission.
     */
    const modules = productionSources().filter(
      (file) =>
        file.path.startsWith('packages/modules/') &&
        !file.path.startsWith('packages/modules/rate-limit/'),
    )
    const mentions = modules.filter((file) => /captcha/i.test(file.source))

    expect(modules.length).toBeGreaterThan(100)
    expect(mentions.map((file) => file.path)).toEqual([])
  })
})

/* ------------------------------------------------------------------------- *
 * **Ce que l'utilisateur lit d'un 429** (constat M1 de la troisième revue).
 *
 * Le répartiteur refuse **avant** le gestionnaire : `twoFactorRefusal` n'est
 * jamais appelé, et les deux formulaires d'authentification repliaient donc le
 * refus de débit sur « Ce code n'est pas valide » et « Demande invalide.
 * Vérifiez les informations saisies. ». Quelqu'un dont le code est **juste**
 * lisait qu'il est faux, et se voyait implicitement invité à recommencer —
 * exactement ce qu'une limitation demande de ne pas faire.
 *
 * La classe de refus `throttled` existe depuis s11 dans
 * `apps/web/app/public-form.tsx` ; elle est **étendue** aux deux formulaires
 * d'authentification, pas réinventée. Le délai affiché vient de l'en-tête
 * `Retry-After` que le serveur a écrit, jamais d'un calcul du navigateur.
 *
 * Ce que ces cas ne prouvent pas, et qui est tenu par une autre commande : que
 * l'écran l'affiche réellement. `e2e/rate-limiting.spec.ts` rend les deux
 * formulaires dans un navigateur et lit l'alerte.
 * ------------------------------------------------------------------------- */

describe('le refus de débit, tel que le formulaire le classe', () => {
  const refusedWith = (retryAfter: string | null): Response =>
    new Response(null, {
      status: 429,
      headers: retryAfter === null ? {} : { 'retry-after': retryAfter },
    })

  it('tire l’attente de l’en-tête du serveur, jamais d’un calcul local', () => {
    // Arrondi **au-dessus** : une attente annoncée trop courte fait réessayer
    // trop tôt, c'est-à-dire se faire refuser une seconde fois.
    expect(retryAfterMinutes(refusedWith('87'))).toBe(2)
    expect(retryAfterMinutes(refusedWith('300'))).toBe(5)
    expect(retryAfterMinutes(refusedWith('1'))).toBe(1)
    expect(retryAfterMinutes(refusedWith('3542'))).toBe(60)
  })

  it('n’annonce aucune attente quand l’en-tête est absent ou illisible', () => {
    // `Retry-After` accepte aussi une date HTTP dans la norme ; ce dépôt n'en
    // écrit jamais, et une valeur qu'on ne sait pas lire ne doit pas devenir
    // « NaN minutes » à l'écran.
    for (const header of [null, '', 'plus tard', '0', '-1', 'Wed, 21 Oct 2026 07:28:00 GMT']) {
      expect(retryAfterMinutes(refusedWith(header)), `retry-after: ${header}`).toBeNull()
    }
  })

  it('ne dit pas à un compte légitime que sa demande est invalide', () => {
    expect(authRefusalOf(429, 2)).toEqual({ key: 'app.auth.error.throttledIn', minutes: 2 })
    expect(authRefusalOf(429, null)).toEqual({ key: 'app.auth.error.throttled', minutes: null })

    // Les autres classes n'ont pas bougé : 401 dit toujours la même chose,
    // qu'il s'agisse d'un compte inconnu ou d'un mot de passe faux.
    expect(authRefusalOf(401, null).key).toBe('app.auth.error.unauthorized')
    expect(authRefusalOf(502, null).key).toBe('app.auth.error.mail')
    expect(authRefusalOf(400, null).key).toBe('app.auth.error.invalid')
  })

  it('ne dit pas à un code juste qu’il est faux', () => {
    expect(twoFactorRefusalOf(429, 'invalid', 3)).toEqual({
      key: 'app.twoFactor.error.throttledIn',
      minutes: 3,
    })
    expect(twoFactorRefusalOf(429, 'invalid', null)).toEqual({
      key: 'app.twoFactor.error.throttled',
      minutes: null,
    })

    // Les trois classes de s13 restent celles de s13.
    expect(twoFactorRefusalOf(401, 'restart', null).key).toBe('app.twoFactor.error.restart')
    expect(twoFactorRefusalOf(401, 'used', null).key).toBe('app.twoFactor.error.used')
    expect(twoFactorRefusalOf(401, 'code-inconnu', null).key).toBe('app.twoFactor.error.invalid')
  })
})
