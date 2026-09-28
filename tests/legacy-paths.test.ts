import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildRegistry, carriesLocalePrefix } from '@repo/core'
import { ACCOUNT_SCREEN_PATH, PROFILE_SCREEN_PATH } from '@repo/module-auth'
import { BILLING_SCREEN_PATH } from '@repo/module-billing'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import { warmUpTargets } from '../e2e/support/warm-up'
import { LEGACY_SCREEN_PATHS, legacyScreenTarget } from '../apps/web/lib/legacy-paths'
import { localeRouting } from '../apps/web/lib/locale-routing'
import { moduleRegistry } from '../apps/web/lib/module-registry'
import { proxy } from '../apps/web/proxy'
import { availableModules, requiredModules } from '../config/features'
import { appLocales } from '../config/i18n'

/**
 * **Les anciens chemins d'écran** (s62a, ADR 075).
 *
 * Un écran déplacé laisse une adresse dans des favoris, des emails déjà
 * envoyés, des retours de paiement en vol. La table de
 * `apps/web/lib/legacy-paths.ts` est la **seule** source des 308, lue par le
 * proxy sur le chemin interne ; ce fichier prouve trois choses :
 *
 * 1. chaque chemin de l'inventaire figé de s61 (`fixtures/legacy-screen-paths.json`)
 *    est **servi** par un fichier de l'arborescence ou **redirigé** par la table ;
 * 2. le proxy répond 308 vers une **constante**, requête et langue conservées,
 *    et rien de la requête ne choisit la cible ;
 * 3. une entrée dont l'écran n'est pas servi dans la configuration (module
 *    coupé) ne redirige pas.
 */

const LEGACY_FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/legacy-screen-paths.json', import.meta.url), 'utf8'),
) as { readonly paths: readonly string[] }

/** La langue que le proxy retient pour une requête sans cookie, en `accept-language: fr`. */
const LOCALE = localeRouting.resolve({ pathname: '/', cookieLocale: null, acceptLanguage: 'fr' })

const proxied = (url: string) =>
  proxy(new NextRequest(new URL(url, 'https://example.test'), { headers: { 'accept-language': 'fr' } }))

describe('l’inventaire figé de la zone Application', () => {
  it('sert ou redirige chaque ancien chemin', async () => {
    const served = await warmUpTargets()

    // L'anti-vacuité : l'inventaire n'est pas vide, et la table non plus.
    expect(LEGACY_FIXTURE.paths.length).toBeGreaterThan(0)
    expect(Object.keys(LEGACY_SCREEN_PATHS).length).toBeGreaterThan(0)

    const lost = LEGACY_FIXTURE.paths.filter(
      (path) => !served.includes(path) && LEGACY_SCREEN_PATHS[path] === undefined,
    )

    expect(lost, 'ni servi ni redirigé').toEqual([])
  })

  it('redirige chaque entrée de la table vers un écran servi, et jamais un chemin servi', async () => {
    const served = await warmUpTargets()

    for (const [legacy, { target }] of Object.entries(LEGACY_SCREEN_PATHS)) {
      expect(served, `${legacy} → ${target}`).toContain(target)
      // Un ancien chemin encore servi par un fichier serait masqué par le 308.
      expect(served, legacy).not.toContain(legacy)
      expect(carriesLocalePrefix(legacy), legacy).toBe(true)
    }
  })
})

describe('le proxy répond 308 vers la cible de la table', () => {
  it('conserve la requête et respecte la langue, sans détour par la redirection de langue', () => {
    const response = proxied('/account?x=1')

    expect(response.status).toBe(308)
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe(
      localeRouting.publicPath(ACCOUNT_SCREEN_PATH, LOCALE),
    )
    expect(new URL(response.headers.get('location') ?? '').search).toBe('?x=1')
    // La réponse passe par le socle d'en-têtes comme toutes les autres.
    expect(response.headers.get('content-security-policy')).not.toBeNull()
  })

  it('ramène l’ancien écran Compte, d’où qu’on vienne, sur la rubrique Profil en un seul saut', () => {
    // s62b : `/app/settings/account` (s62a) a disparu en deux rubriques, et
    // `/account` (s61) ne passe pas par lui — un 308 vers un autre 308 serait
    // un saut de plus pour chaque favori.
    for (const legacy of ['/account', '/app/settings/account']) {
      const response = proxied(`${localeRouting.publicPath(legacy, LOCALE)}?x=1`)
      const location = new URL(response.headers.get('location') ?? '')

      expect(response.status, legacy).toBe(308)
      expect(location.pathname, legacy).toBe(localeRouting.publicPath(PROFILE_SCREEN_PATH, LOCALE))
      expect(location.search, legacy).toBe('?x=1')
    }
  })

  it('lit la table sur le chemin interne, préfixe de langue retiré puis remis', () => {
    for (const [legacy, target] of Object.entries(legacyEntriesServedHere())) {
      for (const locale of localeRouting.locales) {
        const response = proxied(localeRouting.publicPath(legacy, locale))

        expect(response.status, `${locale} ${legacy}`).toBe(308)
        expect(new URL(response.headers.get('location') ?? '').pathname).toBe(
          localeRouting.publicPath(target, locale),
        )
      }
    }
  })

  it('ne tire jamais la cible de la requête', () => {
    for (const url of [
      '/account?next=https://evil.test/',
      '/account?next=//evil.test',
      '/account?target=/sign-in',
      '/account/../sign-in',
    ]) {
      const response = proxied(url)

      if (response.status !== 308) continue

      const location = new URL(response.headers.get('location') ?? '')

      expect(location.origin, url).toBe('https://example.test')
      expect(location.pathname, url).toBe(localeRouting.publicPath(ACCOUNT_SCREEN_PATH, LOCALE))
    }
  })

  it('laisse passer ce qui n’est pas dans la table', () => {
    for (const url of ['/account/other', '/app', '/api/modules/organizations/create']) {
      expect(proxied(localeRouting.publicPath(url, LOCALE)).status, url).not.toBe(308)
    }
  })
})

/** Les entrées de la table que la configuration en vigueur sert réellement. */
const legacyEntriesServedHere = (): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.keys(LEGACY_SCREEN_PATHS).flatMap((legacy) => {
      const target = legacyScreenTarget(legacy, moduleRegistry)

      return target === null ? [] : [[legacy, target]]
    }),
  )

describe('une entrée dont le module est coupé ne redirige pas', () => {
  // Le socle : seuls les modules requis. Le compte reste ; l'organisation, la
  // facturation, les notifications, l'intégration et la démonstration partent —
  // leur écran répond 404, et leur ancien chemin aussi (ADR 077).
  const socle = buildRegistry({
    available: availableModules,
    enabled: requiredModules,
    required: requiredModules,
    locales: [...appLocales],
  })

  it('ne redirige que vers un écran que la configuration annonce', () => {
    const redirected = Object.keys(LEGACY_SCREEN_PATHS).filter(
      (legacy) => legacyScreenTarget(legacy, socle) !== null,
    )
    const dropped = Object.keys(LEGACY_SCREEN_PATHS).filter(
      (legacy) => legacyScreenTarget(legacy, socle) === null,
    )

    // Les deux moitiés, sans quoi le cas serait vert sur une table vide ou sur
    // une fonction qui ne rend jamais rien.
    expect(redirected).toContain('/account')
    expect(dropped.length).toBeGreaterThan(0)

    for (const legacy of dropped) {
      expect(socle.moduleIds, legacy).not.toContain(LEGACY_SCREEN_PATHS[legacy]?.module)
    }
  })

  it('nomme dans chaque ligne un module que l’annuaire connaît', () => {
    // Une faute de frappe (`'demo'` pour `'demo-enabled'`) ne serait dans aucun
    // registre : l'ancien chemin répondrait 404 à jamais, en silence.
    const known = availableModules.map((module) => module.id as string)

    for (const [legacy, { module }] of Object.entries(LEGACY_SCREEN_PATHS)) {
      expect(known, legacy).toContain(module)
    }
  })

  it('suit la configuration en vigueur dans le proxy', () => {
    for (const legacy of Object.keys(LEGACY_SCREEN_PATHS)) {
      const response = proxied(localeRouting.publicPath(legacy, LOCALE))
      const served = legacyScreenTarget(legacy, moduleRegistry) !== null

      expect(response.status === 308, legacy).toBe(served)
    }
  })
})

/**
 * **Aucun ancien chemin écrit en littéral** dans le code livré (s62a).
 *
 * Les anciens chemins répondent encore — par un 308 —, si bien qu'un lien, une
 * redirection 303 ou un retour de paiement resté sur l'un d'eux marche **en
 * faisant un saut de plus**, et qu'aucun parcours ne rougit. C'est ce qui a
 * laissé `${appUrl}/billing` dans les retours Stripe à côté de la constante de
 * l'écran. Ce filet lit les **littéraux** — chaînes, gabarits, attributs JSX —
 * par l'analyseur de TypeScript, jamais les commentaires, qui ont le droit de
 * raconter l'histoire d'un chemin.
 *
 * Balayés : `apps/web` et les six modules qui servent ces écrans, tests
 * exclus. Seule la table les écrit, c'est son rôle.
 */
describe('aucun ancien chemin n’est écrit en littéral', () => {
  const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
  const ROOTS = [
    'apps/web',
    'packages/modules/auth/src',
    'packages/modules/organizations/src',
    'packages/modules/billing/src',
    'packages/modules/notifications/src',
    'packages/modules/onboarding/src',
    'packages/modules/demo-enabled/src',
  ]
  const ALLOWED = new Set(['apps/web/lib/legacy-paths.ts'])
  const LEGACY_SEGMENTS = Object.keys(LEGACY_SCREEN_PATHS).map((path) => path.slice(1))
  // Un ancien chemin **entier** — suivi de rien, d'une requête ou d'un fragment —,
  // précédé du début du fragment ou d'autre chose qu'un caractère de chemin :
  // `/api/modules/billing/checkout` et `https://x/billing-y` ne sont pas visés.
  const LEGACY = new RegExp(
    `(?:^|[^A-Za-z0-9_./-])/(?:${LEGACY_SEGMENTS.join('|')})(?=$|[?#])`,
  )

  const sourcesUnder = (directory: string): string[] =>
    readdirSync(directory).flatMap((name) => {
      const path = join(directory, name)

      if (statSync(path).isDirectory()) {
        return ['node_modules', '.next', 'dist'].includes(name) ? [] : sourcesUnder(path)
      }

      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
    })

  /**
   * Le texte de chaque littéral du fichier, morceaux de gabarit compris.
   *
   * L'analyseur est celui de `pnpm lint`, résolu depuis `@repo/eslint-config`
   * qui le déclare : le paquet `typescript` de la racine est la version
   * native, sans API JavaScript (ADR 011).
   */
  const parser = (
    createRequire(join(REPO_ROOT, 'tooling/eslint/package.json'))('typescript-eslint') as {
      readonly parser: {
        parseForESLint: (code: string, options: Record<string, unknown>) => { ast: unknown }
      }
    }
  ).parser

  const literalsOf = (file: string): string[] => {
    const { ast } = parser.parseForESLint(readFileSync(file, 'utf8'), {
      jsx: file.endsWith('.tsx'),
      range: false,
      loc: false,
    })
    const found: string[] = []
    const visit = (node: unknown): void => {
      if (node === null || typeof node !== 'object') return
      if (Array.isArray(node)) {
        node.forEach(visit)

        return
      }

      const record = node as { type?: string; value?: unknown; parent?: unknown }

      if (record.type === 'Literal' && typeof record.value === 'string') found.push(record.value)
      if (record.type === 'TemplateElement') {
        found.push((record.value as { cooked?: string | null }).cooked ?? '')
      }

      for (const [key, child] of Object.entries(record)) {
        if (key !== 'parent') visit(child)
      }
    }

    visit(ast)

    return found
  }

  it('ne trouve un ancien chemin que dans la table', () => {
    const files = ROOTS.flatMap((root) => sourcesUnder(join(REPO_ROOT, root)))
    // L'anti-vacuité : le balayage lit bien l'application et les modules.
    expect(files.length).toBeGreaterThan(100)

    const offenders = files
      .filter((file) => !ALLOWED.has(relative(REPO_ROOT, file)))
      .flatMap((file) =>
        literalsOf(file)
          .filter((text) => LEGACY.test(text))
          .map((text) => `${relative(REPO_ROOT, file)} : « ${text} »`),
      )

    expect(offenders).toEqual([])
  })

  it('reconnaît un ancien chemin sous toutes ses formes, et pas un voisin', () => {
    // Le filet éprouvé sur des formes écrites, pour qu'un motif trop étroit ne
    // rende pas le cas précédent vert sur rien.
    for (const text of ['/account', '/billing?checkout=success', '/organizations#x']) {
      expect(LEGACY.test(text), text).toBe(true)
    }

    for (const text of ['/billing/checkout', '/api/modules/billing', '/accounts', 'app/account']) {
      expect(LEGACY.test(text), text).toBe(false)
    }

    expect(literalsOf(join(REPO_ROOT, 'packages/modules/billing/src/domain/screen-path.ts'))).toContain(
      BILLING_SCREEN_PATH,
    )
  })
})
