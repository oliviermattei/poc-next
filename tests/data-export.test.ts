import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  auditDataCategoryCoverage,
  buildDataExportArchive,
  buildRegistry,
  dispatchModuleJob,
  exportModules,
  MODULE_ROUTE_PREFIX,
  purgeModules,
  type AnyModuleDefinition,
  type DataCategoryException,
  type ModuleSession,
  type RouteRateLimitGuard,
} from '@repo/core'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDatabase } from '@repo/db'
import { sql } from 'drizzle-orm'
import { createRecordingMailer, type RecordingMailer } from '@repo/mailer-testing'
import {
  authUser,
  configureAuth,
  createDataExportTokenSigner,
  createDrizzleDataExportRepository,
  dataExportArchiveSchema,
  DATA_EXPORT_DOWNLOAD_PATH,
  DATA_EXPORT_JOB,
  DATA_EXPORT_LINK_TTL_SECONDS,
  DATA_EXPORT_SWEEP_MIN_AGE_SECONDS,
  requireAuthService,
  resetAuthService,
} from '@repo/module-auth'
import type { JobEmission, Jobs } from '@repo/ports'
import { provideStorage, resetStorageService } from '@repo/module-storage'
import { createLocalDiskStorage } from '@repo/storage-testing'

import { appAuth } from '../apps/web/lib/auth'
import { moduleRegistry } from '../apps/web/lib/module-registry'
import { prepareModuleServices } from '../apps/web/lib/module-services'
import {
  organizationMember,
  requireOrganizationsService,
} from '@repo/module-organizations'

import { organizations } from '../apps/web/lib/organizations'
import { databaseUrl, isDatabaseReachable } from './fixtures/database'
import { dispatchAllowingRateLimit, refuseAllRateLimit } from './fixtures/rate-limit'

const databaseReachable = await isDatabaseReachable()

/**
 * **Le harnais déclare ce dont il a besoin, jamais le `.env` d'un poste**
 * (`AGENTS.md`), et ce fichier l'a appris en cassant la CI.
 *
 * Ce qu'il monte n'est pas une fonction pure : `appAuth()` et
 * `prepareModuleServices()` construisent les points de composition de
 * l'application, donc `resolveAuthConfig(getEnv())`, le mailer et les
 * fournisseurs externes. Un poste dont le `.env` porte `AUTH_SECRET` et
 * `APP_URL` complète le reste en silence ; le job de tests unitaires ne pose
 * que `DATABASE_URL`, `EMAIL_LOCAL_CAPTURE` et `PAYMENTS_LOCAL_MODE`, et douze
 * cas de ce fichier tombaient sur « Authentification non configurée ».
 *
 * **Chaque valeur est déclarée en entier**, y compris celles qui valent vide :
 * un cas qui n'annonce que sa propre variable ne passe que là où un fichier
 * complète les autres (précédent de `tests/admin.test.ts`, revue de s06, G1).
 * `DATABASE_URL` vient de la suite, pas d'une constante — c'est la base que la
 * recette a préparée.
 *
 * **Ni `vi.resetModules()`, ni import dynamique**, contrairement au précédent :
 * `getEnv()` ne mémorise rien (`packages/config/src/env.ts`), et rien n'est lu
 * à l'import — mesuré, l'échec tombe dans un `beforeAll`, jamais au chargement.
 * Réinitialiser les modules après des imports statiques laisserait ce fichier
 * tenir des instances que plus personne d'autre ne verrait.
 *
 * La commande qui le vérifie n'est **pas** `pnpm test` sur un poste : c'est
 * `pnpm test` **sans le fichier `.env`**, `DATABASE_URL` fournie comme le job la
 * fournit (P25bis). Désarmer les variables du shell ne reproduit rien —
 * `loadRootEnv()` les relit dans le fichier.
 */
beforeAll(() => {
  vi.stubEnv('DATABASE_URL', databaseUrl)
  vi.stubEnv('AUTH_SECRET', 'x'.repeat(40))
  vi.stubEnv('APP_URL', 'http://localhost:3000')
  vi.stubEnv('RESEND_API_KEY', '')
  vi.stubEnv('EMAIL_FROM', '')
  vi.stubEnv('EMAIL_LOCAL_CAPTURE', '1')
  vi.stubEnv('STORAGE_S3_BUCKET', '')
  vi.stubEnv('STORAGE_S3_REGION', '')
  vi.stubEnv('STORAGE_S3_ACCESS_KEY_ID', '')
  vi.stubEnv('STORAGE_S3_SECRET_ACCESS_KEY', '')
  vi.stubEnv('STORAGE_LOCAL_DIRECTORY', '.storage')
  vi.stubEnv('STRIPE_SECRET_KEY', '')
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', '')
  vi.stubEnv('PAYMENTS_LOCAL_MODE', '1')
  vi.stubEnv('INNGEST_EVENT_KEY', '')
  vi.stubEnv('INNGEST_SIGNING_KEY', '')
  vi.stubEnv('INNGEST_BASE_URL', '')
  vi.stubEnv('JOBS_LOCAL_RUNNER', '1')
  // Les quatre fournisseurs externes, vides : une paire incomplète arrête le
  // démarrage en nommant la variable absente, et ce fichier n'en monte aucun.
  vi.stubEnv('GITHUB_CLIENT_ID', '')
  vi.stubEnv('GITHUB_CLIENT_SECRET', '')
  vi.stubEnv('GOOGLE_CLIENT_ID', '')
  vi.stubEnv('GOOGLE_CLIENT_SECRET', '')
  vi.stubEnv('SUPERADMIN_EMAIL', '')
})

afterAll(() => {
  vi.unstubAllEnvs()
})

/**
 * L'export des données d'un périmètre (s35).
 *
 * `exportModules` était le **troisième contrat que le socle déclarait et que
 * rien n'appelait** — après la clé `jobs` (s33) et `purgeModules` (s34). Ce
 * fichier est ce qui la branche, et il porte les mesures qui décident de la
 * story : l'échec d'un module ne rend pas une archive amputée, une demande déjà
 * en cours n'en déclenche pas une seconde, le lien signé expire côté serveur, et
 * chaque catégorie de données déclarée est soit exportée, soit exceptée avec sa
 * raison.
 */

const moduleFixture = (
  id: string,
  overrides: Partial<AnyModuleDefinition> = {},
): AnyModuleDefinition => ({
  id,
  requires: [],
  schema: {},
  migrations: null,
  routes: [],
  navigation: [],
  publicUrls: () => [],
  messages: { fr: {}, en: {} },
  emails: [],
  webhooks: [],
  jobs: [],
  dataCategories: [],
  retention: {},
  purge: () => Promise.resolve(),
  export: () => Promise.resolve({}),
  ...overrides,
})

const registryOf = (modules: readonly AnyModuleDefinition[]) =>
  buildRegistry({
    available: [...modules],
    enabled: modules.map((module) => module.id),
    locales: ['fr', 'en'],
  })

describe('exportModules : une archive partielle est un échec, pas une archive', () => {
  it('rend les charges de chaque module activé quand tous répondent', async () => {
    const registry = registryOf([
      moduleFixture('alpha', { export: () => Promise.resolve({ notes: [1] }) }),
      moduleFixture('beta', { export: () => Promise.resolve({ items: [] }) }),
    ])

    const outcome = await exportModules(registry, { kind: 'user', userId: 'u-1' })

    expect(outcome.ok).toBe(true)
    expect(outcome.ok ? outcome.payloads : null).toEqual({
      alpha: { notes: [1] },
      beta: { items: [] },
    })
  })

  it('refuse en nommant le module qui a échoué, plutôt que de rendre le reste', async () => {
    const served: string[] = []
    const registry = registryOf([
      moduleFixture('alpha', {
        export: async () => {
          served.push('alpha')

          return { notes: [] }
        },
      }),
      moduleFixture('beta', {
        export: () => Promise.reject(new Error('la base a refusé')),
      }),
      moduleFixture('gamma', {
        export: async () => {
          served.push('gamma')

          return { items: [] }
        },
      }),
    ])

    const outcome = await exportModules(registry, { kind: 'user', userId: 'u-1' })

    expect(outcome.ok).toBe(false)

    if (outcome.ok) {
      return
    }

    // Le module est **nommé** : sans lui, la personne qui exerce sa portabilité
    // ne peut pas savoir ce qui manque à ce qu'on lui a remis.
    expect(outcome.failed).toBe('beta')
    expect(outcome.message).toContain('la base a refusé')
    // Ce qui avait été collecté avant l'échec est nommé, jamais servi comme
    // archive : c'est la trace, pas la livraison.
    expect(outcome.exported).toEqual(['alpha'])
    // Et l'itération s'arrête : rien ne sert de lire la suite d'une archive
    // qu'on ne livrera pas.
    expect(served).toEqual(['alpha'])
  })
})

/**
 * Un compte réel, inséré directement.
 *
 * L'archive d'un périmètre qui n'existe pas ne prouve rien du critère 1 :
 * `marketing` rend `{}` faute d'adresse à laquelle rattacher une inscription, et
 * ce vide-là est **juste**. Ce qui doit être mesuré est l'archive d'une personne
 * qui existe.
 */
const anAccount = async (): Promise<string> => {
  const userId = `s35-${randomUUID()}`

  await getDatabase().db.insert(authUser).values({
    id: userId,
    name: 'Compte de s35',
    email: `${userId}@example.test`,
  })

  return userId
}

describe.runIf(databaseReachable)('le plancher du critère 1 : l’archive n’est pas vide', () => {
  beforeAll(async () => {
    // Ce que les modules attendent avant qu'une de leurs routes — ou leur
    // export — ne soit servie. Sans cet appel, chaque module persistant lève
    // « n'est pas configuré », et l'archive serait un refus, pas une archive.
    prepareModuleServices()
    // `auth` échappe à `prepareModuleServices` : le répartiteur le construit par
    // accident, en appelant son `resolveSession` à chaque requête. Un export
    // n'est pas une requête — sans cette ligne, le premier module de l'archive
    // refuse en disant qu'il n'est pas configuré.
    appAuth()

    /**
     * **Le stockage, branché sur un disque plutôt que sur un seau.**
     *
     * La CI ne configure aucun stockage — ni seau S3, ni
     * `STORAGE_LOCAL_DIRECTORY` — et le point de composition de l'application
     * refuse alors de servir, en nommant les variables. Ce qui est remplacé ici
     * est le **fournisseur**, jamais le module : les cas d'usage, le dépôt
     * Drizzle et l'export du contrat sont ceux du produit.
     */
    resetStorageService()
    const directory = await mkdtemp(join(tmpdir(), 'ks-s35-'))
    const local = createLocalDiskStorage({ directory })

    provideStorage(() => ({
      db: getDatabase().db,
      storage: local.storage,
      readableScopes: async (userId) => [{ kind: 'user', id: userId }],
      ownerOf: async (userId) => ({ kind: 'user', id: userId }),
    }))
  })

  afterAll(async () => {
    // Les comptes de cette suite, et eux seuls. Le reste suit par cascade.
    await getDatabase().db.execute(sql`delete from auth_user where email like 's35-%'`)
  })

  it('appelle l’export de chaque module activé, et aucun autre', async () => {
    const outcome = await buildDataExportArchive(moduleRegistry, {
      kind: 'user',
      userId: await anAccount(),
    })

    expect(outcome.ok ? 'ok' : `${outcome.failed}: ${outcome.message}`).toBe('ok')

    if (!outcome.ok) {
      return
    }

    expect(outcome.archive.modules.map((entry) => entry.id)).toEqual([...moduleRegistry.moduleIds])
  })

  it('n’a aucun module qui détient des tables sans dire ce qu’elles contiennent', () => {
    /**
     * **Le plancher du critère 1, dérivé de l'ensemble activé.**
     *
     * Un plancher à « au moins un module déclare une catégorie » n'attrape que
     * l'effondrement total : cinq des six modules déclarants pourraient cesser
     * de déclarer sans que rien ne rougisse. Un nombre écrit ici ne marcherait
     * pas non plus — le profil minimal n'active pas les mêmes modules.
     *
     * Ce qui se dérive, en revanche, c'est **qui détient des tables**. Un module
     * qui en possède détient quelque chose ; s'il ne déclare aucune catégorie de
     * données, c'est soit qu'il n'y met rien de personnel, soit qu'il l'a
     * oublié — et la seconde issue est invisible sans ce cas. Le garde d'accord
     * (ADR 063) prend le relais ensuite, catégorie par catégorie.
     *
     * Les deux exceptions sont **nommées avec leur raison**, comme celles de la
     * table d'exceptions, et chacune est écrite dans le module qui la porte.
     *
     * **Ce que ces deux raisons disent exactement**, parce que le mot compte :
     * la colonne ne porte **aucune valeur directement identifiante** et n'est
     * pas réversible — c'est un condensat, on ne la déchiffre pas. Elle n'est
     * pas *anonyme* pour autant : l'entrée est de faible entropie — une adresse
     * email, une adresse IP —, donc un **candidat se confirme** en le hachant et
     * en regardant si la ligne existe. C'est de la **pseudonymisation**, et
     * quelqu'un finira par s'appuyer sur cette phrase pour une réponse RGPD. Ce
     * qui justifie l'exception n'est donc pas « personne ne peut savoir », mais
     * « la table ne révèle personne à qui la lit, et il n'existe aucune requête
     * qui en tire une liste de personnes ».
     */
    const holdsNoPersonalData: Readonly<Record<string, string>> = {
      jobs: '`job_run.run` est un condensat de la clé d’idempotence (voir son schéma)',
      'rate-limit': '`rate_limit_window.bucket` est un condensat du seau (voir son schéma)',
    }

    const holders = moduleRegistry.modules.filter(
      (module) => Object.keys(module.schema).length > 0,
    )

    // Sans ce plancher-ci, un registre sans aucune table rendrait le balayage
    // vide et le cas vert — le défaut mesuré deux fois sur ce dépôt.
    expect(holders.length).toBeGreaterThan(0)

    const silent = holders
      .filter((module) => module.dataCategories.length === 0)
      .map((module) => module.id)
      .filter((id) => !(id in holdsNoPersonalData))

    expect(silent).toEqual([])

    /**
     * **La garde de péremption, celle qui manquait à cette table-ci** (ADR 063
     * la porte pour l'autre). Une exception dont le module s'est mis à déclarer
     * une catégorie a cessé d'être vraie : elle doit partir, sans quoi elle
     * dispense en silence un module qui n'en a plus besoin.
     *
     * Un module que ce registre n'active pas est **dormant**, pas périmé — même
     * raison qu'à côté : `pnpm test:minimal-profile` coupe `jobs`.
     */
    const enabled = new Map(moduleRegistry.modules.map((module) => [module.id, module] as const))
    const stale = Object.keys(holdsNoPersonalData).filter(
      (id) => (enabled.get(id)?.dataCategories.length ?? 0) > 0,
    )

    expect(stale).toEqual([])
  })
})

/**
 * **Les exceptions d'export, écrites ici et nulle part ailleurs.**
 *
 * Une catégorie de données déclarée au contrat est **soit exportée, soit
 * exceptée avec sa raison**. Cette table est la seconde branche, et chaque
 * entrée est une décision — pas un moyen de rendre la suite verte.
 *
 * Pourquoi ici et non dans une seizième clé du contrat : une clé de plus
 * obligerait à rouvrir les seize modules déjà écrits pour y déclarer `{}`, et
 * la question qu'elle porterait — « pourquoi cette donnée ne sort-elle pas ? »
 * — n'a de réponse qu'au cas par cas. La règle reste **exécutable** : c'est
 * `pnpm test` qui échoue, en nommant le module et la catégorie (ADR 063).
 */
const DATA_CATEGORY_EXCEPTIONS: readonly DataCategoryException[] = [
  {
    moduleId: 'admin',
    category: 'grant-authorship',
    reason:
      'La catégorie ne désigne pas le rôle du bénéficiaire — celui-ci part par ' +
      'cascade et n’a pas de catégorie — mais `admin_platform_role.granted_by` : ' +
      'l’empreinte de l’auteur du geste, portée par la ligne d’un tiers. ' +
      'L’exporter à l’auteur lui remettrait « voici les rôles que vous avez ' +
      'attribués à ces personnes-là », c’est-à-dire des identifiants de comptes ' +
      'qui ne sont pas les siens ; l’exporter au bénéficiaire ne lui apprendrait ' +
      'rien de lui-même, qui sait déjà quel rôle il détient. C’est la lecture qui ' +
      'a fait choisir `anonymize` plutôt que `erase` en s34 : ce qui part est le ' +
      'lien, pas la donnée.',
  },
]

describe.runIf(databaseReachable)(
  'l’accord entre `dataCategories`, `purge` et `export`',
  () => {
    it('ne laisse aucune catégorie déclarée hors de l’archive sans raison écrite', async () => {
      const outcome = await buildDataExportArchive(moduleRegistry, {
        kind: 'user',
        userId: await anAccount(),
      })

      expect(outcome.ok).toBe(true)

      if (!outcome.ok) {
        return
      }

      expect(
        auditDataCategoryCoverage({
          archive: outcome.archive,
          exceptions: DATA_CATEGORY_EXCEPTIONS,
        }),
      ).toEqual([])
    })
  },
)

describe('le garde d’accord, éprouvé sur ses trois refus', () => {
  const archiveOf = (
    modules: readonly { id: string; dataCategories: string[]; payload: Record<string, unknown> }[],
  ) => ({
    formatVersion: 1,
    generatedAt: '2026-09-06T00:00:00.000Z',
    scope: { kind: 'user' as const, id: 'u-1' },
    modules,
  })

  it('constate une catégorie déclarée que l’export ne rend pas', () => {
    const findings = auditDataCategoryCoverage({
      archive: archiveOf([{ id: 'admin', dataCategories: ['grant-authorship'], payload: {} }]),
      exceptions: [],
    })

    expect(findings).toEqual([
      { kind: 'not-exported', moduleId: 'admin', categories: ['grant-authorship'] },
    ])
  })

  it('accepte la même catégorie quand une exception porte sa raison', () => {
    const findings = auditDataCategoryCoverage({
      archive: archiveOf([{ id: 'admin', dataCategories: ['grant-authorship'], payload: {} }]),
      exceptions: [
        {
          moduleId: 'admin',
          category: 'grant-authorship',
          reason: 'la ligne appartient au bénéficiaire, l’auteur du geste est un tiers',
        },
      ],
    })

    expect(findings).toEqual([])
  })

  it('refuse une exception sans raison écrite : une exception tacite n’en est pas une', () => {
    const findings = auditDataCategoryCoverage({
      archive: archiveOf([{ id: 'admin', dataCategories: ['grant-authorship'], payload: {} }]),
      exceptions: [{ moduleId: 'admin', category: 'grant-authorship', reason: '  ' }],
    })

    expect(findings).toContainEqual({
      kind: 'unexplained-exception',
      moduleId: 'admin',
      category: 'grant-authorship',
    })
  })

  it('ne constate rien d’une exception dont le module n’est pas activé', () => {
    /**
     * **Chaque configuration est un produit livrable**, et celle-ci l'a prouvé :
     * `pnpm test:minimal-profile` coupe `admin`, l'archive n'a alors aucune
     * entrée pour lui, et l'exception d'`admin` était constatée « périmée ».
     * Elle ne l'est pas — elle est **dormante** : le module qu'elle nomme n'est
     * pas dans ce registre, donc il n'y a rien à accorder.
     *
     * Ce que ce choix coûte, et il faut le savoir : une exception qui nommerait
     * un module **supprimé du dépôt** ne serait jamais constatée. La garde
     * porte sur l'accord entre un registre et sa table, pas sur l'existence des
     * modules.
     */
    const findings = auditDataCategoryCoverage({
      archive: archiveOf([{ id: 'auth', dataCategories: [], payload: { account: null } }]),
      exceptions: [{ moduleId: 'admin', category: 'grant-authorship', reason: 'raison' }],
    })

    expect(findings).toEqual([])
  })

  it('constate une exception qui ne correspond plus à aucune catégorie déclarée', () => {
    const findings = auditDataCategoryCoverage({
      archive: archiveOf([{ id: 'admin', dataCategories: [], payload: {} }]),
      exceptions: [{ moduleId: 'admin', category: 'grant-authorship', reason: 'raison' }],
    })

    expect(findings).toEqual([
      { kind: 'stale-exception', moduleId: 'admin', category: 'grant-authorship' },
    ])
  })
})

describe.runIf(databaseReachable)('la revendication d’une demande en cours (critère 7)', () => {
  beforeAll(async () => {
    // **Préchauffage du pool.** `node-postgres` ouvre ses connexions une par
    // une, à la demande : sans cela, deux revendications lancées ensemble se
    // sérialisent le temps que la seconde connexion s'ouvre, et le cas
    // « deux clics simultanés » reste vert même sans verrou — c'est la mesure
    // qui a coûté un constat critique à s34.
    await Promise.all([1, 2, 3, 4, 5].map(async () => await getDatabase().db.execute(sql`select 1`)))
  })

  const pendingRows = async (scopeId: string): Promise<number> => {
    const counted = await getDatabase().db.execute<{ count: number }>(
      sql`select count(*)::int as count from auth_data_export_request where scope_id = ${scopeId}`,
    )

    return Number(counted.rows[0]?.count ?? 0)
  }

  it('deux demandes simultanées sur le même périmètre n’en créent qu’une, à chaque course', async () => {
    /**
     * **Cinq courses, parce qu'une seule ne prouve rien d'un entrelacement.**
     *
     * C'est la leçon de s16 puis de s34 : le cas séquentiel passe même sans
     * verrou — le second appelant voit l'état commis par le premier —, et une
     * seule course peut se sérialiser par hasard. Ce qui refuse ici est le
     * décompte fait **sous** le verrou consultatif, dans la même transaction
     * que l'insertion.
     */
    for (let race = 0; race < 5; race += 1) {
      const userId = await anAccount()
      const repository = createDrizzleDataExportRepository({ db: getDatabase().db })
      const scope = { kind: 'user', userId } as const

      const outcomes = await Promise.all([
        repository.claim({ id: `${userId}-a`, scope, requestedBy: userId, at: new Date() }),
        repository.claim({ id: `${userId}-b`, scope, requestedBy: userId, at: new Date() }),
      ])

      // Exactement une revendication : un verrou qui refuserait les deux
      // fermerait la fenêtre en bloquant le produit.
      expect([...outcomes].sort(), `course ${race}`).toEqual(['already-pending', 'claimed'])
      expect(await pendingRows(userId), `course ${race}`).toBe(1)
    }
  })

  it('une nouvelle demande redevient possible quand la précédente est servie', async () => {
    const userId = await anAccount()
    const repository = createDrizzleDataExportRepository({ db: getDatabase().db })
    const scope = { kind: 'user', userId } as const
    const first = `${userId}-1`

    expect(await repository.claim({ id: first, scope, requestedBy: userId, at: new Date() })).toBe(
      'claimed',
    )
    await repository.markReady({
      id: first,
      tokenDigest: 'empreinte',
      expiresAt: new Date(Date.now() + 60_000),
      archive: { formatVersion: 1 },
      at: new Date(),
    })

    expect(
      await repository.claim({ id: `${userId}-2`, scope, requestedBy: userId, at: new Date() }),
    ).toBe('claimed')
  })

  it('n’empêche pas la demande d’un autre périmètre', async () => {
    const userId = await anAccount()
    const other = await anAccount()
    const repository = createDrizzleDataExportRepository({ db: getDatabase().db })

    expect(
      await repository.claim({
        id: `${userId}-x`,
        scope: { kind: 'user', userId },
        requestedBy: userId,
        at: new Date(),
      }),
    ).toBe('claimed')
    expect(
      await repository.claim({
        id: `${other}-x`,
        scope: { kind: 'user', userId: other },
        requestedBy: other,
        at: new Date(),
      }),
    ).toBe('claimed')
  })
})

/**
 * La demande, l'archive, le lien et son expiration — **par les routes**.
 *
 * Ce bloc monte le module avec ce que le point de composition lui donne en
 * production (l'archive du registre réel, la décision d'appartenance, le port
 * de tâches) et passe par `dispatchModuleRequest`, c'est-à-dire par le même
 * chemin qu'une requête de l'application. Ce qui est doublé est le
 * **fournisseur** — le mailer, l'ordonnanceur —, jamais la règle.
 */
describe.runIf(databaseReachable)('l’export de bout en bout', () => {
  const APP_URL = 'http://localhost:3000'
  const TEST_SECRET = 'secret-de-test-uniquement-0123456789abcdef'

  let mailer: RecordingMailer
  let emissions: JobEmission[] = []
  let permission: 'allowed' | 'refused' | 'unknown' = 'allowed'
  let clock = new Date('2026-09-06T10:00:00.000Z')

  /**
   * **Le port de tâches, module `jobs` activé** : il met en file et n'exécute
   * pas. Ce qui est enregistré est l'émission, pas la tâche.
   */
  const queueingJobs: Jobs = {
    emit: async (emission) => {
      emissions.push(emission)

      return { ok: true, id: `${emission.job}:${emission.key}` }
    },
  }

  /**
   * **Le port de tâches, module `jobs` coupé** — le repli d'`apps/web/lib/jobs.ts`,
   * repris ici dans sa forme : l'émission s'exécute dans la requête appelante,
   * une seule tentative, par le répartiteur du socle et la tâche déclarée au
   * contrat. Rien n'est doublé de la tâche elle-même.
   */
  const synchronousJobs: Jobs = {
    emit: async (emission) => {
      emissions.push(emission)

      const outcome = await dispatchModuleJob({
        registry: moduleRegistry,
        emission,
        log: () => {},
        retry: { maxAttempts: 1, baseMs: 0, maxMs: 0 },
        now: () => clock,
      })

      return outcome.ok
        ? { ok: true, id: `${emission.job}:${emission.key}` }
        : { ok: false, error: outcome.error }
    },
  }

  /** Un port qui refuse : le fournisseur est injoignable. */
  const refusingJobs: Jobs = {
    emit: async () => ({
      ok: false,
      error: { code: 'provider_unavailable', message: 'file injoignable' },
    }),
  }

  const configureTestAuth = (options: { readonly jobs?: Jobs } = {}): void => {
    configureAuth({
      db: getDatabase().db,
      mailer,
      secret: TEST_SECRET,
      appUrl: APP_URL,
      now: () => clock,
      log: () => {},
      // Par défaut, le régime « module `jobs` coupé » : l'archive est prête à la
      // fin de la requête, ce qui rend les cas de lien lisibles sans détour.
      jobs: options.jobs ?? synchronousJobs,
      dataExport: {
        collectArchive: async (scope) => await buildDataExportArchive(moduleRegistry, scope),
        authorizeOrganization: async () => permission,
      },
    })
  }

  const post = async (
    body: unknown,
    session: ModuleSession | null,
  ): Promise<Response> =>
    await dispatchAllowingRateLimit(
      moduleRegistry,
      new Request(`${APP_URL}${MODULE_ROUTE_PREFIX}/auth/data-export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { resolveSession: async () => session },
    )

  const download = async (
    token: string,
    options: { readonly rateLimit?: RouteRateLimitGuard } = {},
  ): Promise<Response> =>
    await dispatchAllowingRateLimit(
      moduleRegistry,
      new Request(
        `${APP_URL}${MODULE_ROUTE_PREFIX}${DATA_EXPORT_DOWNLOAD_PATH}?token=${encodeURIComponent(token)}`,
      ),
      options.rateLimit === undefined ? {} : { rateLimit: options.rateLimit },
    )

  /** Le lien envoyé par email, tel que la personne le reçoit. */
  const linkOf = (): string => {
    const sent = mailer.sent.at(-1)

    if (sent === undefined) {
      throw new Error('aucun email d’export n’est parti')
    }

    return String(sent.data['url'])
  }

  const tokenOf = (): string => new URL(linkOf()).searchParams.get('token') ?? ''

  const requestRows = async (scopeId: string): Promise<number> => {
    const counted = await getDatabase().db.execute<{ count: number }>(
      sql`select count(*)::int as count from auth_data_export_request where scope_id = ${scopeId}`,
    )

    return Number(counted.rows[0]?.count ?? -1)
  }

  const storedRow = async (
    scopeId: string,
  ): Promise<{ archive: unknown; token_digest: string | null; expires_at: Date | null }> => {
    const rows = await getDatabase().db.execute<{
      archive: unknown
      token_digest: string | null
      expires_at: Date | null
    }>(
      sql`select archive, token_digest, expires_at from auth_data_export_request where scope_id = ${scopeId} limit 1`,
    )

    const row = rows.rows[0]

    if (row === undefined) {
      throw new Error(`aucune demande pour « ${scopeId} »`)
    }

    return row
  }

  beforeAll(async () => {
    prepareModuleServices()
    resetStorageService()
    const directory = await mkdtemp(join(tmpdir(), 'ks-s35-routes-'))
    const local = createLocalDiskStorage({ directory })

    provideStorage(() => ({
      db: getDatabase().db,
      storage: local.storage,
      readableScopes: async (userId) => [{ kind: 'user', id: userId }],
      ownerOf: async (userId) => ({ kind: 'user', id: userId }),
    }))

    mailer = createRecordingMailer()
    configureTestAuth()
  })

  afterAll(async () => {
    resetAuthService()
    await getDatabase().db.execute(sql`delete from auth_user where email like 's35-%'`)
  })

  beforeEach(() => {
    mailer.reset()
    emissions = []
    permission = 'allowed'
    clock = new Date('2026-09-06T10:00:00.000Z')
  })

  it('construit une archive qui valide contre le schéma documenté (critère 6)', async () => {
    const userId = await anAccount()

    configureTestAuth()

    expect((await post({ scope: 'user' }, { userId, roles: [] })).status).toBe(202)

    const response = await download(tokenOf())

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('attachment')

    // **L'archive produite**, validée contre le schéma — pas une forme décrite
    // à côté du code. C'est le critère 6, et c'est ce qui rend le schéma
    // exécutable plutôt que documentaire.
    const parsed = dataExportArchiveSchema.safeParse(await response.json())

    expect(parsed.error?.issues ?? []).toEqual([])
    expect(parsed.success).toBe(true)
    expect(parsed.data?.modules.map((entry) => entry.id)).toEqual([...moduleRegistry.moduleIds])
    expect(parsed.data?.scope).toEqual({ kind: 'user', id: userId })
  })

  it('refuse une seconde demande tant que la première est en cours (critère 7)', async () => {
    const userId = await anAccount()

    configureTestAuth({ jobs: queueingJobs })

    const session = { userId, roles: [] }

    expect((await post({ scope: 'user' }, session)).status).toBe(202)

    const second = await post({ scope: 'user' }, session)

    expect(second.status).toBe(409)
    await expect(second.json()).resolves.toEqual({ error: 'already_pending' })
  })

  it('n’expose l’archive qu’à un lien signé par nous', async () => {
    const userId = await anAccount()

    configureTestAuth()
    await post({ scope: 'user' }, { userId, roles: [] })

    const token = tokenOf()
    const [requestId] = token.split('.')

    // Signature réécrite, identifiant de demande **réel** : refusé, et
    // indiscernable d'une demande inconnue — ni le code, ni le corps ne disent
    // que cet identifiant existe.
    expect((await download(`${requestId}.signature-inventee`)).status).toBe(400)
    // Jeton sans signature du tout.
    expect((await download(requestId ?? '')).status).toBe(400)
    // Et le vrai jeton, lui, sert.
    expect((await download(token)).status).toBe(200)
  })

  it('refuse de servir une archive qui ne correspond pas au schéma documenté', async () => {
    /**
     * **Le schéma est une garde de production, pas une description.**
     *
     * Le critère 6 demande qu'un test valide l'archive produite ; ce cas mesure
     * l'autre moitié, celle qui compte le jour où quelque chose tourne mal :
     * ce qui sort de la base est validé **avant** d'être remis, et une archive
     * dont la forme a dérivé n'est pas servie. Sans lui, le `safeParse` de la
     * route pourrait disparaître sans qu'aucun cas ne rougisse — l'archive que
     * le produit écrit étant toujours conforme.
     */
    const userId = await anAccount()
    const repository = createDrizzleDataExportRepository({ db: getDatabase().db })
    const signer = createDataExportTokenSigner(TEST_SECRET)
    const requestId = `dex_malformed_${randomUUID()}`

    configureTestAuth()

    expect(
      await repository.claim({
        id: requestId,
        scope: { kind: 'user', userId },
        requestedBy: userId,
        at: clock,
      }),
    ).toBe('claimed')

    const token = signer.issue(requestId)

    await repository.markReady({
      id: requestId,
      tokenDigest: signer.digest(token),
      expiresAt: new Date(clock.getTime() + 60_000),
      // Une archive d'une autre version de format : signée, non expirée, et
      // pourtant hors du schéma documenté.
      archive: { formatVersion: 99, modules: [] },
      at: clock,
    })

    const response = await download(token)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'malformed_archive' })
  })

  it('ne répond jamais 404 : elle est déclarée, donc elle existe', async () => {
    /**
     * **Une route publique d'un module activé est montée, donc elle existe.**
     *
     * `e2e/modules.spec.ts` balaie toute route publique du registre et exige
     * qu'elle ne réponde pas 404 — la garantie générique « une route déclarée
     * est une route servie ». Elle a attrapé ce défaut ici, comme elle l'avait
     * attrapé en s33 sur la route de rappel du module de tâches : un jeton
     * absent faisait répondre « cet endroit n'existe pas », ce qui est faux et
     * envoie chercher un défaut de routage.
     *
     * Le cas est **ici et pas seulement dans le navigateur**, et c'est la leçon
     * de s33 : une garantie que seule la CI peut vérifier est une garantie qui
     * casse en CI.
     *
     * **Et les deux refus sont indiscernables** : un jeton absent et une
     * signature fausse rendent le même code et le même corps. Les distinguer
     * dirait à qui essaie s'il a trouvé un identifiant de demande réel.
     */
    const withoutToken = await dispatchAllowingRateLimit(
      moduleRegistry,
      new Request(`${APP_URL}${MODULE_ROUTE_PREFIX}${DATA_EXPORT_DOWNLOAD_PATH}`),
    )
    const forged = await download('dex_inexistante.signature-inventee')

    expect(withoutToken.status).not.toBe(404)
    expect(withoutToken.status).toBe(forged.status)
    await expect(withoutToken.json()).resolves.toEqual(await forged.json())
  })

  it('ne touche pas la base tant que la signature n’est pas vérifiée', async () => {
    /**
     * **La propriété du socle §4, mesurée plutôt qu'affirmée.**
     *
     * « Signature vérifiée avant tout effet » ne se prouve pas en observant un
     * 404 : mesuré, retirer la comparaison de signature laissait les
     * vingt-cinq cas au vert — l'empreinte du jeton refusait à sa place, mais
     * **après** une lecture en base. Ce qui est compté ici est donc la lecture
     * elle-même : un jeton forgé ne doit faire travailler personne, et ne peut
     * pas servir à énumérer des identifiants de demandes.
     */
    const userId = await anAccount()
    const reads: string[] = []
    const real = createDrizzleDataExportRepository({ db: getDatabase().db })

    configureAuth({
      db: getDatabase().db,
      mailer,
      secret: TEST_SECRET,
      appUrl: APP_URL,
      now: () => clock,
      log: () => {},
      jobs: synchronousJobs,
      dataExport: {
        collectArchive: async (scope) => await buildDataExportArchive(moduleRegistry, scope),
        authorizeOrganization: async () => 'allowed',
        requests: {
          ...real,
          findById: async (id) => {
            reads.push(id)

            return await real.findById(id)
          },
        },
      },
    })

    await post({ scope: 'user' }, { userId, roles: [] })

    const token = tokenOf()
    const [requestId] = token.split('.')

    reads.length = 0

    expect((await download(`${requestId}.signature-inventee`)).status).toBe(400)
    expect(reads).toEqual([])

    // Contrôle positif : le vrai jeton, lui, lit — sans quoi ce cas serait vert
    // sur une route qui ne fait jamais rien.
    expect((await download(token)).status).toBe(200)
    expect(reads).toEqual([requestId])

    resetAuthService()
    configureTestAuth()
  })

  it('limite aussi la demande, qui est authentifiée mais coûteuse', async () => {
    /**
     * **Une session n'est pas une limite** — la phrase est celle du
     * téléversement (`config/security.ts`, politique `upload`), et elle vaut
     * ici davantage : chaque passage parcourt l'export de **tous** les modules
     * activés, écrit une copie complète des données personnelles en base et
     * envoie un email. La revendication ne suffit pas à borner la boucle, une
     * demande servie ne refusant plus la suivante.
     *
     * `routeIsRateLimited` est dérivé du registre : une route non publique n'est
     * comptée que si elle le **déclare**. Ce cas mesure la déclaration.
     */
    const userId = await anAccount()

    configureTestAuth()

    const response = await dispatchAllowingRateLimit(
      moduleRegistry,
      new Request(`${APP_URL}${MODULE_ROUTE_PREFIX}/auth/data-export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'user' }),
      }),
      { resolveSession: async () => ({ userId, roles: [] }), rateLimit: refuseAllRateLimit },
    )

    expect(response.status).toBe(429)
    // Et rien n'a été fait : un refus qui aurait quand même construit l'archive
    // ne serait pas un refus.
    expect(mailer.sent).toEqual([])
    expect(await requestRows(userId)).toBe(0)
  })

  it('est limité en débit par le répartiteur, comme toute route publique', async () => {
    const userId = await anAccount()

    configureTestAuth()
    await post({ scope: 'user' }, { userId, roles: [] })

    // Le téléchargement est **public** : la limitation est dérivée du registre,
    // pas déclarée par la route (ADR 050). Un garde qui refuse suffit à le
    // montrer — la limitation elle-même est éprouvée ailleurs.
    const response = await download(tokenOf(), { rateLimit: refuseAllRateLimit })

    expect(response.status).toBe(429)
  })

  it('cesse de télécharger passé l’échéance, et oublie l’archive (critères 4 et 6)', async () => {
    const userId = await anAccount()

    configureTestAuth()
    await post({ scope: 'user' }, { userId, roles: [] })

    const token = tokenOf()

    expect((await download(token)).status).toBe(200)

    // **L'horloge du serveur avance**, rien d'autre : l'échéance n'est ni dans
    // l'URL, ni dans le jeton — la réécrire est hors de portée de l'appelant.
    clock = new Date(clock.getTime() + (DATA_EXPORT_LINK_TTL_SECONDS + 1) * 1000)

    expect((await download(token)).status).toBe(410)

    // Et l'archive n'est pas seulement irrécupérable : elle est effacée. Une
    // donnée personnelle en transit qui n'est plus téléchargeable n'a plus de
    // raison d'être conservée.
    await requireAuthService().useCases.dataExport?.sweepDataExports()

    expect((await storedRow(userId)).archive).toBeNull()
    expect((await download(token)).status).toBe(410)
  })

  it('oublie les archives échues sans ordonnanceur, à la demande suivante', async () => {
    /**
     * **Le régime sans module de tâches, et c'est une configuration livrable.**
     *
     * `config/profiles.ts` coupe `jobs`. Dans cet état, l'ordonnanceur n'existe
     * pas : la seule exécution de la tâche est celle que le repli déclenche
     * dans la requête, et elle porte toujours un `requestId` — donc la branche
     * de balayage n'est **jamais** atteinte. Mesuré par la revue : archive
     * échue, `status = ready`, et une copie JSON complète des données de la
     * personne restée en base.
     *
     * L'oubli ne peut donc pas dépendre d'un module optionnel. Il a lieu à la
     * **demande suivante**, quel que soit son périmètre — l'effacement porte sur
     * toutes les archives échues, pas sur celles du demandeur.
     */
    const owner = await anAccount()
    const other = await anAccount()

    configureTestAuth()
    await post({ scope: 'user' }, { userId: owner, roles: [] })
    await post({ scope: 'user' }, { userId: other, roles: [] })

    expect((await storedRow(owner)).archive).not.toBeNull()
    expect((await storedRow(other)).archive).not.toBeNull()

    clock = new Date(clock.getTime() + (DATA_EXPORT_LINK_TTL_SECONDS + 1) * 1000)

    // Une demande d'un **tiers**, sans qu'aucun ordonnanceur n'ait tourné.
    await post({ scope: 'user' }, { userId: await anAccount(), roles: [] })

    expect((await storedRow(owner)).archive).toBeNull()
    expect((await storedRow(other)).archive).toBeNull()
  })

  it('n’écrit l’archive nulle part ailleurs que dans la base, et la purge l’emporte', async () => {
    const userId = await anAccount()

    configureTestAuth()
    await post({ scope: 'user' }, { userId, roles: [] })

    // **Où vit l'archive** (tâche 6 du plan) : dans la ligne de la demande,
    // c'est-à-dire dans la base de l'application. C'est ce qui la fait hériter
    // de la purge du compte — un seau d'objets n'a pas de clé étrangère.
    expect((await storedRow(userId)).archive).not.toBeNull()

    await purgeModules(moduleRegistry, { kind: 'user', userId })

    expect(await requestRows(userId)).toBe(0)
  })

  it('emporte aussi l’archive d’une organisation supprimée', async () => {
    /**
     * **Le cas que la cascade ne couvre pas**, et c'est le seul qui mesure
     * quelque chose.
     *
     * `requested_by` est en cascade vers `auth_user` : l'archive d'un **compte**
     * effacé part sans que personne l'ait demandé. Le périmètre d'une
     * **organisation**, lui, ne porte aucune clé étrangère — `auth` ne
     * référence pas un module qu'il ne requiert pas (ADR 018) —, et rien ne
     * l'emporterait sans la purge explicite du contrat. Mesuré : sans elle,
     * l'archive complète d'une organisation supprimée reste en base.
     */
    const userId = await anAccount()
    const organizationId = `s35-org-${randomUUID()}`

    configureTestAuth()

    expect(
      (await post({ scope: 'organization', organizationId }, { userId, roles: [] })).status,
    ).toBe(202)
    expect(await requestRows(organizationId)).toBe(1)

    await purgeModules(moduleRegistry, { kind: 'organization', organizationId })

    expect(await requestRows(organizationId)).toBe(0)
  })

  it('réserve l’export d’une organisation, et ne confirme pas celle d’autrui (critère 5)', async () => {
    const userId = await anAccount()
    const session = { userId, roles: [] }

    configureTestAuth()

    permission = 'unknown'
    // **404 et non 403** : l'existence de l'organisation d'autrui ne se
    // confirme pas (`docs/security.md` §3).
    expect((await post({ scope: 'organization', organizationId: 'org-1' }, session)).status).toBe(
      404,
    )

    permission = 'refused'
    // Membre, mais la matrice lui refuse l'action : il sait déjà que
    // l'organisation existe, donc 403.
    expect((await post({ scope: 'organization', organizationId: 'org-1' }, session)).status).toBe(
      403,
    )

    permission = 'allowed'
    expect((await post({ scope: 'organization', organizationId: 'org-1' }, session)).status).toBe(
      202,
    )
  })

  it('refuse une demande sans session, et un périmètre mal formé', async () => {
    configureTestAuth()

    expect((await post({ scope: 'user' }, null)).status).toBe(401)

    const userId = await anAccount()

    expect((await post({ scope: 'organisation' }, { userId, roles: [] })).status).toBe(400)
    expect((await post({ scope: 'organization' }, { userId, roles: [] })).status).toBe(400)
  })

  it('construit hors de la requête quand la file la prend (critère 2)', async () => {
    const userId = await anAccount()

    configureTestAuth({ jobs: queueingJobs })

    expect((await post({ scope: 'user' }, { userId, roles: [] })).status).toBe(202)

    // Rien n'est parti : la construction n'a pas eu lieu dans la requête.
    expect(mailer.sent).toEqual([])
    expect(emissions).toHaveLength(1)
    expect(emissions[0]?.job).toBe(`auth.${DATA_EXPORT_JOB}`)
    // Des **références**, jamais une donnée personnelle (`docs/security.md` §5).
    expect(Object.values(emissions[0]?.data ?? {})).not.toContain(userId)

    // La tâche déclarée au contrat, exécutée par le répartiteur du socle.
    const outcome = await dispatchModuleJob({
      registry: moduleRegistry,
      emission: emissions[0] as JobEmission,
      log: () => {},
      retry: { maxAttempts: 1, baseMs: 0, maxMs: 0 },
      now: () => clock,
    })

    expect(outcome.ok).toBe(true)
    expect(mailer.sent).toHaveLength(1)
    expect((await download(tokenOf())).status).toBe(200)
  })

  it('construit dans la requête quand le module de tâches est coupé (critère 2)', async () => {
    const userId = await anAccount()

    // Le repli du point de composition, dans sa forme : l'émission s'exécute
    // dans la requête appelante. Le module ne connaît pas la différence — il
    // émet la même tâche, avec la même charge utile.
    configureTestAuth({ jobs: synchronousJobs })

    expect((await post({ scope: 'user' }, { userId, roles: [] })).status).toBe(202)

    expect(emissions).toHaveLength(1)
    expect(mailer.sent).toHaveLength(1)
    expect((await download(tokenOf())).status).toBe(200)
  })

  it('ne reprend une demande en cours qu’après un délai, jamais pendant son exécution', async () => {
    /**
     * **Le balayage et l'exécution du fournisseur peuvent se croiser.**
     *
     * Les deux clés d'idempotence diffèrent — le balayage est déclenché par
     * l'ordonnanceur, l'émission porte l'identifiant de la demande —, donc le
     * registre d'exécutions ne les déduplique pas. Mesuré sur deux
     * constructions concurrentes de la même demande : **deux emails partent**,
     * portant le **même** lien (le jeton dérive de l'identifiant de la demande,
     * il n'est pas tiré au hasard) et ce lien **fonctionne** — l'empreinte
     * stockée par le gagnant est celle du jeton des deux. Le défaut est donc un
     * doublon d'email et un parcours d'export payé deux fois, pas un lien mort.
     *
     * Le seuil d'âge ferme la fenêtre : le balayage ne reprend que ce qui est en
     * cours depuis plus longtemps qu'une période d'ordonnancement, c'est-à-dire
     * ce qui est réellement resté en plan.
     */
    const userId = await anAccount()

    configureTestAuth({ jobs: queueingJobs })

    expect((await post({ scope: 'user' }, { userId, roles: [] })).status).toBe(202)
    expect(mailer.sent).toEqual([])

    const dataExport = requireAuthService().useCases.dataExport

    /**
     * **L'horloge avance d'une minute avant le balayage**, et c'est ce qui rend
     * ce cas mesurable : avec une horloge figée, `requestedAt < maintenant` est
     * faux par égalité stricte, et retirer le seuil ne changerait rien —
     * mesuré, la mutation revenait verte. Une minute après, la demande est bien
     * « antérieure à maintenant » sans être vieille.
     */
    clock = new Date(clock.getTime() + 60 * 1000)

    // Le balayage tombe pendant que le fournisseur exécute encore : il passe son
    // tour.
    expect((await dataExport?.sweepDataExports())?.rebuilt).toBe(0)
    expect(mailer.sent).toEqual([])

    // Passé le seuil, la demande est manifestement restée en plan : reprise.
    clock = new Date(clock.getTime() + (DATA_EXPORT_SWEEP_MIN_AGE_SECONDS + 60) * 1000)

    expect((await dataExport?.sweepDataExports())?.rebuilt).toBe(1)
    expect(mailer.sent).toHaveLength(1)
  })

  it('refuse la demande quand la file la refuse, et la laisse rejouable', async () => {
    const userId = await anAccount()

    configureTestAuth({ jobs: refusingJobs })

    const response = await post({ scope: 'user' }, { userId, roles: [] })

    // **503, pas 202** : rien ne construira l'archive, et un accusé de
    // réception pour un travail que personne ne fera serait un mensonge. C'est
    // la décision de s34 sur le même port.
    expect(response.status).toBe(503)
    expect(mailer.sent).toEqual([])

    // Et le périmètre n'est pas resté bloqué derrière une demande en cours :
    // sans cela, le critère 7 refuserait toutes les suivantes.
    configureTestAuth()

    expect((await post({ scope: 'user' }, { userId, roles: [] })).status).toBe(202)
  })

  it('ne livre pas d’archive amputée quand un module refuse, et nomme le module', async () => {
    const userId = await anAccount()

    configureAuth({
      db: getDatabase().db,
      mailer,
      secret: TEST_SECRET,
      appUrl: APP_URL,
      now: () => clock,
      log: () => {},
      jobs: synchronousJobs,
      dataExport: {
        collectArchive: async () => ({
          ok: false,
          failed: 'billing',
          message: 'la base a refusé',
          exported: ['auth'],
        }),
        authorizeOrganization: async () => 'allowed',
      },
    })

    expect((await post({ scope: 'user' }, { userId, roles: [] })).status).toBe(202)

    // Aucun lien n'est parti : une archive amputée n'est pas une archive.
    expect(mailer.sent).toEqual([])

    const rows = await getDatabase().db.execute<{ status: string; failed_module_id: string | null }>(
      sql`select status, failed_module_id from auth_data_export_request where scope_id = ${userId}`,
    )

    expect(rows.rows[0]?.status).toBe('failed')
    expect(rows.rows[0]?.failed_module_id).toBe('billing')

    // Et la demande est **rejouable** : l'échec n'a pas laissé un périmètre
    // bloqué par une demande en cours qui n'aboutira jamais.
    configureTestAuth()

    expect((await post({ scope: 'user' }, { userId, roles: [] })).status).toBe(202)

    resetAuthService()
    configureTestAuth()
  })
})

/**
 * **La règle d'appartenance, éprouvée sur de vraies organisations.**
 *
 * Le bloc précédent éprouve la **traduction** de la décision en réponse HTTP —
 * 404, 403, 202 — avec la décision injectée. Celui-ci éprouve la décision
 * elle-même, là où elle est prise : `lib/organizations.ts`, qui lit la matrice
 * du module qui possède les rôles au lieu de la rejouer. La matrice, elle, est
 * énumérée une fois, dans `organization-rules.test.ts`.
 */
describe.runIf(databaseReachable && organizations.available)(
  'qui peut exporter une organisation',
  () => {
    beforeAll(() => {
      prepareModuleServices()
      appAuth()
    })

    afterAll(async () => {
      await getDatabase().db.execute(sql`delete from auth_user where email like 's35-%'`)
    })

    const withRole = async (
      organizationId: string,
      role: string,
    ): Promise<string> => {
      const userId = await anAccount()

      await getDatabase().db.insert(organizationMember).values({
        id: `mbr_${userId}`,
        organizationId,
        userId,
        role,
      })

      return userId
    }

    it('accorde au propriétaire, refuse au membre, et ignore l’étranger', async () => {
      const founder = await anAccount()
      const created = await requireOrganizationsService().useCases.createOrganization({
        userId: founder,
        body: { name: 'Acme s35', slug: `acme-s35-${Date.now()}` },
      })

      expect(created.status).toBe('ok')

      const organizationId = await organizations.activeOrganizationId(founder)

      expect(organizationId).not.toBeNull()

      const member = await withRole(organizationId ?? '', 'member')
      const admin = await withRole(organizationId ?? '', 'admin')
      const stranger = await anAccount()

      const permissionOf = async (userId: string) =>
        await organizations.exportPermission({ userId, organizationId: organizationId ?? '' })

      expect(await permissionOf(founder)).toBe('allowed')
      // Un `admin` administre l'organisation ; il n'en emporte pas la copie
      // complète des données de tous ses membres.
      expect(await permissionOf(admin)).toBe('refused')
      expect(await permissionOf(member)).toBe('refused')
      // **404 et non 403** en bout de chaîne : l'étranger n'apprend pas que
      // cette organisation existe (`docs/security.md` §3).
      expect(await permissionOf(stranger)).toBe('unknown')
    })
  },
)
