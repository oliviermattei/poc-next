import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildRegistry, dispatchModuleRequest, resolveEnabledModules } from '@repo/core'
import {
  createDatabaseClient,
  listDatabaseTables,
  migrationsTableFor,
  planModuleMigrations,
  runModuleMigrations,
} from '@repo/db'
import { sql } from 'drizzle-orm'
import { configureAuth, resetAuthService } from '@repo/module-auth'
import {
  CONTACT_PATH,
  EMPTY_MARKETING_SITE,
  legalPath,
  marketingMessageKeys,
  marketingModule,
  resolveMarketingSite,
  robotsAllows,
  type MarketingSite,
  type RobotsPolicy,
} from '@repo/module-marketing'
import {
  configureMarketing,
  createDrizzlePublicSubscriptions,
  createDrizzleSubmissionThrottle,
  marketingRoutePath,
  resetMarketingService,
} from '@repo/module-marketing'
import {
  ContactView,
  LegalDocumentView,
  MarketingHome,
} from '@repo/module-marketing/presentation'
import { createRecordingMailer } from '@repo/mailer-testing'
import { NextIntlClientProvider } from 'next-intl'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { localeRouting } from '../apps/web/lib/locale-routing'
import { moduleRegistry } from '../apps/web/lib/module-registry'
import { marketingSite } from '../apps/web/lib/marketing'
import { flatMessagesFor } from '../apps/web/lib/messages'
import { availableModules } from '../config/features'
import { appLocales } from '../config/i18n'
import { marketingConfiguration } from '../config/marketing'
import { databaseUrl, isDatabaseReachable } from './fixtures/database'
import { markerFor, pseudoRequestConfig } from './fixtures/pseudo-locale'
import { ANONYMOUS, SIGNED_IN, type ViewerFixture } from './fixtures/screen-viewer'

/**
 * Le **câblage** du site public — ce que la règle seule ne peut pas dire.
 *
 * Les règles pures vivent et se prouvent dans le module
 * (`packages/modules/marketing/src/application/marketing-site.test.ts`). Ce
 * fichier-ci pose les quatre questions qui traversent les packages :
 *
 * 1. le registre : couper le module retire-t-il réellement sa navigation et ses
 *    traductions ?
 * 2. les catalogues : toute clé que `config/marketing.ts` exige est-elle livrée,
 *    dans chaque locale du projet ? C'est le filet des clés **composées**, que
 *    le balayage statique de `tests/i18n.test.ts` ne voit pas ;
 * 3. l'écran : la racine sert-elle l'accueil public, le tableau de bord ou une
 *    redirection, selon ce qu'elle a devant elle ?
 * 4. la base : un visiteur anonyme provoque-t-il une requête SQL ?
 *
 * Les doublures remplacent le **contexte de requête** (session, traducteur) et
 * la **configuration injectée** (le site), jamais une règle : les écrans, les
 * composants du design system et le registre sont les vrais.
 */

/**
 * L'appelant courant, tenu **hors du registre de modules**.
 *
 * `vi.hoisted` place ce conteneur dans le fichier de test, que
 * `vi.resetModules()` ne réinitialise pas. Passer par la fixture partagée ne
 * marchait pas : chaque réinitialisation en recrée une instance, et la valeur
 * écrite atterrissait sur une autre que celle que la doublure lit — mesuré, le
 * cas « visiteur connecté » rendait la page publique.
 */
const viewer = vi.hoisted(() => ({ value: null as unknown }))

/**
 * La langue de la requête en cours, tenue hors du registre pour la même raison
 * que l'appelant : un même fichier éprouve les métadonnées d'une page légale
 * dans **chaque** langue servie, et une canonique commune aux deux est
 * précisément le défaut à attraper.
 */
const requestLocale = vi.hoisted(() => ({ value: '' }))

vi.mock('../apps/web/lib/auth', async () => {
  const { authRoutePath, safeRedirectPath } = await import('@repo/module-auth')

  return {
    authRoutePath,
    safeRedirectPath,
    currentViewer: () => Promise.resolve(viewer.value),
    currentSessions: () => Promise.resolve([]),
  }
})

vi.mock('../apps/web/lib/i18n', async () => {
  const { buildRegistry } = await import('@repo/core')
  const { createTranslator } = await import('next-intl')
  const { localeRouting } = await import('../apps/web/lib/locale-routing')
  const { pseudoRequestConfig } = await import('./fixtures/pseudo-locale')
  const { availableModules: modules } = await import('../config/features')
  const { appLocales: locales, defaultLocale: locale } = await import('../config/i18n')

  // Le catalogue de **l'annuaire complet**, et non des modules activés : ce
  // fichier injecte le site public pour éprouver les deux états, y compris dans
  // un dépôt qui coupe le module. Avec le catalogue de la configuration
  // courante, le rendu lèverait sur une clé absente et le test échouerait pour
  // une autre raison que celle qu'il porte.
  const registry = buildRegistry({
    available: [...modules],
    enabled: modules.map((module) => module.id),
    locales: [...locales],
  })

  return {
    appIntl: () => {
      const active = requestLocale.value === '' ? locale : requestLocale.value

      return Promise.resolve({
        locale: active,
        t: createTranslator(pseudoRequestConfig(active, registry)),
        path: (pathname: string) => localeRouting.publicPath(pathname, active),
      })
    },
  }
})

/** Le site tel que la configuration livrée le décrit, quel que soit l'état du dépôt. */
const shippedSite = resolveMarketingSite(marketingConfiguration)

/**
 * Rend un écran avec un site **injecté**, et rend ce qui en est sorti.
 *
 * L'injection est ce qui permet d'éprouver les deux états — site public présent
 * et absent — **dans la même exécution**, quelle que soit la configuration du
 * dépôt. Un test qui n'exercerait la branche « module coupé » que lorsque le
 * dépôt le coupe ne prouverait rien le reste du temps.
 *
 * `redirect()` et `notFound()` de Next signalent par une exception portant un
 * `digest` : la vraie bibliothèque est utilisée, et c'est son signal qui est lu.
 */
interface ScreenOutcome {
  readonly html: string
  readonly digest: string | null
}

/**
 * Le fournisseur de messages **côté client**, autour de l'arbre rendu.
 *
 * Depuis s11, l'accueil et l'écran de contact portent un composant client qui
 * appelle `useTranslations` — le formulaire public, qui vit dans
 * `apps/web/app/public-form.tsx` parce qu'un module n'a pas le droit d'appeler
 * `fetch`. Sans ce fournisseur, ce n'est pas le comportement mesuré ici qui
 * échoue, c'est le rendu lui-même. Le catalogue est celui de l'annuaire
 * **complet**, pour la même raison que la doublure de `lib/i18n` : ce fichier
 * éprouve les deux états du module.
 */
const withMessages = (tree: unknown) => {
  const registry = buildRegistry({
    available: [...availableModules],
    enabled: availableModules.map((module) => module.id),
    locales: [...appLocales],
  })
  const config = pseudoRequestConfig(localeRouting.defaultLocale, registry)

  return createElement(NextIntlClientProvider, {
    locale: localeRouting.defaultLocale,
    messages: config.messages,
    timeZone: 'UTC',
    onError: config.onError,
    getMessageFallback: config.getMessageFallback,
    children: tree as never,
  })
}

const renderWithSite = async (
  site: MarketingSite,
  caller: ViewerFixture,
  screen: (module: Record<string, unknown>) => Promise<unknown>,
  path: string,
): Promise<ScreenOutcome> => {
  vi.resetModules()
  vi.doMock('../apps/web/lib/marketing', () => ({ marketingSite: site }))

  viewer.value = caller

  const imported = (await import(path)) as Record<string, unknown>

  try {
    const tree = await screen(imported)

    return { html: renderToStaticMarkup(withMessages(tree)), digest: null }
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest

    if (typeof digest !== 'string') {
      throw error
    }

    return { html: '', digest }
  } finally {
    vi.doUnmock('../apps/web/lib/marketing')
  }
}

const renderRoot = (site: MarketingSite, caller: ViewerFixture): Promise<ScreenOutcome> =>
  renderWithSite(
    site,
    caller,
    async (module) => await (module.default as () => Promise<unknown>)(),
    '../apps/web/app/page',
  )

/** Ce qu'une page légale déclare aux moteurs, dans la langue de la requête. */
interface LegalMetadata {
  readonly alternates?: { readonly canonical?: unknown }
}

const legalMetadata = async (
  site: MarketingSite,
  document: string,
  locale: string,
): Promise<LegalMetadata> => {
  vi.resetModules()
  vi.doMock('../apps/web/lib/marketing', () => ({ marketingSite: site }))
  requestLocale.value = locale

  try {
    const imported = (await import('../apps/web/app/legal/[document]/page')) as {
      generateMetadata: (props: { params: Promise<unknown> }) => Promise<LegalMetadata>
    }

    return await imported.generateMetadata({ params: Promise.resolve({ document }) })
  } finally {
    requestLocale.value = ''
    vi.doUnmock('../apps/web/lib/marketing')
  }
}

const renderLegal = (site: MarketingSite, document: string): Promise<ScreenOutcome> =>
  renderWithSite(
    site,
    ANONYMOUS,
    async (module) =>
      await (module.default as (props: { params: Promise<unknown> }) => Promise<unknown>)({
        params: Promise.resolve({ document }),
      }),
    '../apps/web/app/legal/[document]/page',
  )

/* ------------------------------------------------------------------------- *
 * Les chemins que l'application sert réellement, lus sur le disque.
 *
 * Le `robots.txt` ne peut pas être jugé sur la liste qu'on lui a donnée — c'est
 * ce qui a laissé passer un `Allow: /fr` ouvrant `/fr/reset-password?token=…`.
 * Il est donc confronté aux écrans **existants**, et un écran ajouté par une
 * story suivante entre dans la mesure sans qu'on l'y inscrive.
 * ------------------------------------------------------------------------- */

const SCREEN_ROOT = fileURLToPath(new URL('../apps/web/app', import.meta.url))

const pageFilesUnder = (directory: string): readonly string[] => {
  const found: string[] = []

  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const entry = join(current, name)

      if (statSync(entry).isDirectory()) {
        walk(entry)
      } else if (name === 'page.tsx') {
        found.push(relative(SCREEN_ROOT, entry))
      }
    }
  }

  walk(directory)

  return found.sort()
}

/**
 * Les chemins internes à sonder : un par écran, les segments dynamiques
 * remplacés par un slug **déclaré** et par un slug inconnu, plus les URL
 * sensibles telles qu'un robot les rencontrerait, chaîne de requête comprise.
 */
const probePaths = (site: MarketingSite): readonly string[] => {
  const slugs = [...site.legalDocuments.map((document) => document.slug), 'inconnu']

  const expand = (segments: readonly string[]): readonly string[] => {
    const index = segments.findIndex((segment) => segment.startsWith('['))

    if (index === -1) {
      return [`/${segments.join('/')}`.replace(/^\/$/, '/')]
    }

    return slugs.flatMap((slug) =>
      expand([...segments.slice(0, index), slug, ...segments.slice(index + 1)]),
    )
  }

  const routes = pageFilesUnder(SCREEN_ROOT).flatMap((file) => {
    const segments = file.split('/').slice(0, -1)

    return segments.length === 0 ? ['/'] : expand(segments)
  })

  return [...new Set([...routes, '/reset-password?token=jeton-de-reinitialisation'])]
}

/** Une directive de `robots.txt`, telle que Next l'accepte : une valeur ou une liste. */
type RobotsDirective = string | string[] | undefined

interface ServedRobots {
  readonly rules:
    | { userAgent?: RobotsDirective; allow?: RobotsDirective; disallow?: RobotsDirective }
    | readonly { userAgent?: RobotsDirective; allow?: RobotsDirective; disallow?: RobotsDirective }[]
  readonly sitemap?: RobotsDirective
}

/** La politique telle que Next la rendra, relue dans la forme du module. */
const robotsPolicyOf = (served: ServedRobots): RobotsPolicy => {
  const list = (value: RobotsDirective): string[] =>
    value === undefined ? [] : Array.isArray(value) ? [...value] : [value]

  const groups = Array.isArray(served.rules) ? served.rules : [served.rules]

  return {
    rules: {
      userAgent: '*',
      allow: groups.flatMap((group) => list(group.allow)),
      disallow: groups.flatMap((group) => list(group.disallow)),
    },
    ...(served.sitemap === undefined ? {} : { sitemap: list(served.sitemap).join(' ') }),
  }
}

/* ------------------------------------------------------------------------- */

describe('le point de composition du site public', () => {
  it('n’expose un site que lorsque le module est activé', () => {
    // Vrai dans les **deux** états du dépôt, et c'est ce qui rend le
    // basculement observable : l'attente est dérivée du registre, jamais
    // recopiée. Rendre le site sans regarder le registre fait rougir cette
    // ligne dès que le module est coupé.
    const enabled = moduleRegistry.moduleIds.includes(marketingModule.id)

    expect(marketingSite.sections.length > 0).toBe(enabled)
    expect(marketingSite.publicPaths.length > 0).toBe(enabled)
    expect(marketingSite.legalDocuments.length > 0).toBe(enabled)
  })
})

/** Les chemins montés des deux formulaires, dérivés du module et jamais recopiés. */
const MARKETING_FORM_PATHS = [
  marketingRoutePath('contact'),
  marketingRoutePath('newsletter'),
] as const

describe('le module marketing coupé', () => {
  /**
   * Une configuration où `marketing` est exclu **par le test** : les assertions
   * portent sur l'exclusion, pas sur l'état de `config/features.ts`.
   */
  const withoutMarketing = buildRegistry({
    available: [...availableModules],
    enabled: ['auth'],
    locales: [...appLocales],
  })

  it('déclare pourtant bien une entrée de navigation', () => {
    // Sans cette garde, tout ce qui suit serait un tour de passe-passe : un
    // module qui ne déclare rien n'expose rien.
    expect(marketingModule.navigation.length).toBeGreaterThan(0)
  })

  it('ne laisse aucune entrée de navigation', () => {
    expect(withoutMarketing.navigation.map((entry) => entry.moduleId)).not.toContain(
      marketingModule.id,
    )
  })

  it('ne laisse aucune traduction dans le catalogue de l’application', () => {
    const keys = Object.values(withoutMarketing.messages).flatMap((catalog) =>
      Object.keys(catalog),
    )

    expect(keys.filter((key) => key.startsWith(`${marketingModule.id}.`))).toEqual([])
  })

  it('déclare pourtant bien des tables et des migrations', () => {
    // La garde d'inertie du cas de base réelle qui suit : un module qui ne
    // déclarerait rien ne poserait rien, et « aucune table » ne prouverait
    // rien. Depuis s11 il déclare, et c'est la configuration qui décide.
    expect(Object.keys(marketingModule.schema)).not.toEqual([])
    expect(marketingModule.migrations).not.toBeNull()
  })

  it('ne sert aucune route de formulaire : le répartiteur répond comme sur un chemin inventé', async () => {
    // Critère 4 de s11. La comparaison porte sur **le statut et le corps** : un
    // 404 « spécial module coupé » dirait qu'il y a quelque chose à cet
    // endroit. Ce qui est mesuré, c'est l'indiscernabilité.
    const invented = await dispatchModuleRequest(
      withoutMarketing,
      new Request('https://app.test/api/modules/marketing/chemin-invente', { method: 'POST' }),
    )

    for (const path of MARKETING_FORM_PATHS) {
      const response = await dispatchModuleRequest(
        withoutMarketing,
        new Request(`https://app.test${path}`, { method: 'POST' }),
      )

      expect(response.status, path).toBe(invented.status)
      expect(await response.text(), path).toBe(await invented.clone().text())
    }
  })

  it('déclare pourtant bien ces routes, publiques', () => {
    // La garde d'inertie du cas ci-dessus : un module qui ne déclarerait aucune
    // route rendrait « aucune route servie » vrai sans rien prouver.
    expect(marketingModule.routes.map((route) => route.method)).toEqual(['POST', 'POST'])

    for (const route of marketingModule.routes) {
      expect(route.protection, route.path).toEqual({ level: 'public' })
    }
  })

  it('ne sert aucune page publique : la racine redirige vers la connexion', async () => {
    const outcome = await renderRoot(EMPTY_MARKETING_SITE, ANONYMOUS)

    expect(outcome.html).toBe('')
    expect(outcome.digest).toContain('NEXT_REDIRECT')
    expect(outcome.digest).toContain('/sign-in')
  })

  it('ne sert aucune page légale, pas même celles que la configuration nomme', async () => {
    for (const document of shippedSite.legalDocuments) {
      const outcome = await renderLegal(EMPTY_MARKETING_SITE, document.slug)

      expect(outcome.digest, document.slug).toContain('404')
    }
  })

  it('ne référence rien dans le plan de site', async () => {
    vi.stubEnv('APP_URL', 'https://app.test')
    vi.resetModules()
    vi.doMock('../apps/web/lib/marketing', () => ({ marketingSite: EMPTY_MARKETING_SITE }))

    const { default: sitemap } = await import('../apps/web/app/sitemap')
    const { default: robots } = await import('../apps/web/app/robots')

    expect(sitemap()).toEqual([])
    // Et rien n'annonce un plan de site vide : ce serait publier une adresse
    // qui ne référence rien.
    expect(robots().sitemap).toBeUndefined()
    expect(robots().rules).toEqual({ userAgent: '*', disallow: ['/'] })

    vi.doUnmock('../apps/web/lib/marketing')
    vi.unstubAllEnvs()
  })
})

describe('le module marketing activé', () => {
  it('sert l’accueil public à un visiteur sans session', async () => {
    const outcome = await renderRoot(shippedSite, ANONYMOUS)

    expect(outcome.digest).toBeNull()

    // Chaque section déclarée est là, et son titre vient du catalogue.
    for (const section of shippedSite.sections) {
      expect(outcome.html, section.id).toContain(
        markerFor(`marketing.section.${section.id}.title`),
      )
    }

    // Et le pied de page mène aux mentions légales — le point d'accès que le
    // critère 2 exige. Le lien passe par la forme publique de la locale : le
    // même scénario vaut donc dans les deux états du module `i18n`.
    for (const document of shippedSite.legalDocuments) {
      const href = localeRouting.publicPath(legalPath(document.slug), localeRouting.defaultLocale)

      expect(outcome.html, document.slug).toContain(`href="${href}"`)
      expect(outcome.html, document.slug).toContain(
        markerFor(`marketing.legal.${document.slug}.title`),
      )
    }
  })

  it('mène au contact même quand aucun document légal n’est déclaré', async () => {
    // Le pied de page ne s'affichait qu'en présence d'un document légal : un
    // projet qui les retirait servait `/contact`, l'annonçait dans son plan de
    // site, et n'y menait de nulle part (constat F9 de la revue de s11).
    const withoutLegal: MarketingSite = { ...shippedSite, legalDocuments: [] }
    const href = localeRouting.publicPath(CONTACT_PATH, localeRouting.defaultLocale)

    const outcome = await renderRoot(withoutLegal, ANONYMOUS)

    expect(outcome.digest).toBeNull()
    expect(outcome.html).toContain(`href="${href}"`)
    expect(outcome.html).toContain(markerFor('marketing.contact.title'))
  })

  it('affiche les sections dans l’ordre de la configuration', async () => {
    const reversed: MarketingSite = {
      ...shippedSite,
      sections: [...shippedSite.sections].reverse(),
    }

    const positionsOf = (html: string): readonly number[] =>
      shippedSite.sections.map((section) =>
        html.indexOf(markerFor(`marketing.section.${section.id}.title`)),
      )

    const straight = positionsOf((await renderRoot(shippedSite, ANONYMOUS)).html)
    const backwards = positionsOf((await renderRoot(reversed, ANONYMOUS)).html)

    expect([...straight].sort((left, right) => left - right)).toEqual(straight)
    expect([...backwards].sort((left, right) => right - left)).toEqual(backwards)
  })

  it('sert le tableau de bord à un visiteur connecté, jamais la page publique', async () => {
    const outcome = await renderRoot(shippedSite, SIGNED_IN)

    expect(outcome.digest).toBeNull()
    expect(outcome.html).toContain(markerFor('app.dashboard.title'))
    expect(outcome.html).not.toContain(markerFor('marketing.section.hero.title'))
  })

  it('sert une page légale déclarée, et 404 sur tout autre chemin', async () => {
    const known = shippedSite.legalDocuments[0]?.slug ?? ''
    const served = await renderLegal(shippedSite, known)

    expect(served.digest).toBeNull()
    expect(served.html).toContain(markerFor(`marketing.legal.${known}.title`))

    for (const unknown of ['inconnu', 'PRIVACY', '../secret']) {
      expect((await renderLegal(shippedSite, unknown)).digest, unknown).toContain('404')
    }
  })

  it('référence chaque page publique dans le plan de site, et n’autorise qu’elles', async () => {
    vi.stubEnv('APP_URL', 'https://app.test/')

    vi.resetModules()
    vi.doMock('../apps/web/lib/marketing', () => ({ marketingSite: shippedSite }))

    const { localeRouting } = await import('../apps/web/lib/locale-routing')
    const { default: sitemap } = await import('../apps/web/app/sitemap')
    const { default: robots } = await import('../apps/web/app/robots')

    const entries = sitemap()

    expect(entries.map((entry) => entry.url)).toEqual(
      shippedSite.publicPaths.map((pathname) => {
        const published = localeRouting.publicPath(pathname, localeRouting.defaultLocale)

        // La barre finale d'APP_URL est normalisée : deux écritures de la même
        // page seraient deux URL pour un moteur.
        return `https://app.test${published === '/' ? '' : published}`
      }),
    )

    // Une variante par langue servie, et pas une de plus.
    for (const entry of entries) {
      expect(Object.keys(entry.alternates?.languages ?? {}).sort()).toEqual(
        [...localeRouting.locales].sort(),
      )
    }

    const policy = robotsPolicyOf(robots())

    expect(policy.sitemap).toBe('https://app.test/sitemap.xml')
    expect(policy.rules.disallow).toEqual(['/'])

    // Ce que le `robots.txt` autorise est confronté à **chaque écran du
    // disque**, dans chaque langue servie, et lu comme un robot le lit. Un
    // écran ajouté à l'application entre donc dans cette mesure sans que
    // personne n'y pense — et du mauvais côté tant qu'il n'est pas public.
    const published = new Set(
      shippedSite.publicPaths.flatMap((pathname) =>
        localeRouting.locales.map((locale) => localeRouting.publicPath(pathname, locale)),
      ),
    )

    const probes = probePaths(shippedSite)
    let opened = 0
    let closed = 0

    for (const probe of probes) {
      for (const locale of localeRouting.locales) {
        const url = localeRouting.publicPath(probe, locale)
        const expected = published.has(url)

        expect(robotsAllows(policy, url), url).toBe(expected)

        if (expected) {
          opened += 1
        } else {
          closed += 1
        }
      }
    }

    // Garde contre l'inertie : un balayage qui ne trouverait aucun écran, ou
    // qui n'en trouverait que des publics, rendrait la boucle ci-dessus vraie
    // sans rien mesurer.
    expect(probes).toContain('/account')
    expect(opened).toBeGreaterThan(0)
    expect(closed).toBeGreaterThan(0)

    vi.doUnmock('../apps/web/lib/marketing')
    vi.unstubAllEnvs()
  })

  it('déclare une canonique par langue, et jamais une URL qui redirige', async () => {
    const slug = shippedSite.legalDocuments[0]?.slug ?? ''
    const canonicals = new Map<string, unknown>()

    for (const locale of localeRouting.locales) {
      const metadata = await legalMetadata(shippedSite, slug, locale)

      canonicals.set(locale, metadata.alternates?.canonical)
    }

    // La canonique est l'URL **servie** : un chemin non préfixé répond 307 vers
    // la langue négociée, et se désigner soi-même par une redirection revient à
    // ne rien désigner.
    for (const [locale, canonical] of canonicals) {
      expect(canonical, locale).toBe(localeRouting.publicPath(legalPath(slug), locale))
    }

    // Une par langue, et **distinctes** : une canonique commune fusionnerait les
    // deux versions pour un moteur, ce que les `hreflang` du plan de site
    // contredisent.
    expect(new Set(canonicals.values()).size).toBe(localeRouting.locales.length)
  })
})

describe('les catalogues du site public', () => {
  /** L'annuaire complet, pas les modules activés : la garde vaut dans les deux états. */
  const everyModule = buildRegistry({
    available: [...availableModules],
    enabled: availableModules.map((module) => module.id),
    locales: [...appLocales],
  })

  it('livre chaque clé que `config/marketing.ts` exige, dans chaque locale', () => {
    const keys = marketingMessageKeys(shippedSite)

    // Garde contre l'inertie : « toutes les clés existent » serait vrai sur
    // zéro clé, c'est-à-dire sur une configuration vide.
    expect(keys.length).toBeGreaterThan(30)

    for (const locale of appLocales) {
      const catalog = flatMessagesFor(locale, everyModule)
      const missing = keys.filter((key) => catalog[key] === undefined)

      expect(missing, `locale ${locale}`).toEqual([])
    }
  })

  it('exige exactement ce que les écrans demandent, ni plus ni moins', () => {
    // La garde qui manquait, et la mutation qui l'a exigée : retirer les clés
    // des éléments de `marketingMessageKeys` laissait « toutes les clés
    // existent » vert — un filet plus étroit que son nom. Ici, les écrans sont
    // rendus avec un traducteur qui **ne connaît que les clés déclarées** et
    // refuse toute autre. La dérivation et la présentation ne peuvent donc plus
    // diverger : l'une trop étroite, le rendu lève ; l'autre trop large, le
    // décompte ci-dessous ne bouge pas mais la garde de catalogue rougit.
    const declared = new Set(marketingMessageKeys(shippedSite))
    const asked: string[] = []

    const intl = {
      t: (key: string): string => {
        asked.push(key)

        if (!declared.has(key)) {
          throw new Error(`Clé demandée par un écran mais non déclarée : « ${key} ».`)
        }

        return markerFor(key)
      },
      path: (pathname: string): string => pathname,
    }

    renderToStaticMarkup(
      createElement(MarketingHome, { site: shippedSite, intl, newsletterForm: null }),
    )
    // s11 : l'écran de contact demande ses propres clés, et elles sont fixes —
    // aucune section ne les amène. Sans ce rendu, en ajouter une au catalogue
    // sans l'afficher passerait inaperçu.
    renderToStaticMarkup(createElement(ContactView, { site: shippedSite, intl, form: null }))

    for (const document of shippedSite.legalDocuments) {
      renderToStaticMarkup(createElement(LegalDocumentView, { site: shippedSite, document, intl }))
    }

    // Garde contre l'inertie : un rendu vide ne demanderait rien.
    expect(new Set(asked).size).toBeGreaterThan(30)
  })

  it('n’en exige aucune quand il n’y a pas de site', () => {
    expect(marketingMessageKeys(EMPTY_MARKETING_SITE)).toEqual([])
  })

  it('annonce comme modèle tout texte livré qui se présente comme un fait', () => {
    // Ce n'est pas une garde de formulation : un propriétaire qui déploie tel
    // quel publierait une politique de confidentialité qui a l'air complète et
    // de **faux avis clients**. Les deux appartiennent à la même famille — du
    // contenu inventé livré par le socle —, et le module en fait sa règle
    // (`packages/modules/marketing/AGENTS.md`). L'ensemble surveillé est
    // dérivé de la configuration : un témoignage ou une section légale ajoutée
    // y entre sans qu'on l'inscrive.
    const notice: Record<string, string> = { fr: 'Modèle à adapter', en: 'Template to adapt' }

    const invented = [
      ...shippedSite.legalDocuments.flatMap((document) =>
        document.sections.map(
          (section) => `marketing.legal.${document.slug}.section.${section}.body`,
        ),
      ),
      ...shippedSite.sections
        .filter((section) => section.kind === 'testimonials')
        .flatMap((section) =>
          section.items.map((item) => `marketing.section.${section.id}.item.${item}.body`),
        ),
    ]

    // Garde contre l'inertie : la configuration livrée déclare des témoignages
    // **et** des sections légales ; une liste vide rendrait la boucle vraie.
    expect(invented.length).toBeGreaterThan(shippedSite.legalDocuments.length)

    for (const locale of appLocales) {
      const marker = notice[locale]

      // Une langue ajoutée au projet doit dire ici comment elle marque un
      // modèle, faute de quoi cette garde la survolerait en silence.
      expect(marker, `locale ${locale}`).toBeDefined()

      const catalog = flatMessagesFor(locale, everyModule)

      for (const key of invented) {
        expect(String(catalog[key]), `${key} / ${locale}`).toContain(marker)
      }
    }
  })

  it('traduit le libellé de navigation du module dans chaque locale', () => {
    for (const entry of marketingModule.navigation) {
      for (const locale of appLocales) {
        expect(marketingModule.messages[locale]?.[entry.labelKey], `${entry.id} / ${locale}`).toBeDefined()
      }
    }
  })
})

/* ------------------------------------------------------------------------- *
 * La mesure qui tient le quatrième critère : « les pages marketing s'affichent
 * sans session et n'émettent aucune requête base de données au rendu ».
 *
 * Elle se fait en deux endroits, parce qu'il y a deux façons d'émettre une
 * requête :
 *
 * 1. **pendant le rendu** — les pages publiques et le shell sont réellement
 *    exécutés, et tout `pg` du processus est compté. C'est ce qui manquait : la
 *    revue a ajouté un vrai `createDatabaseClient(…).pool.query('select 1')`
 *    dans `app/page.tsx` et la suite est restée verte, parce que le cas qui
 *    portait ce nom ne rendait aucune page ;
 * 2. **pendant la résolution de session** — le vrai service d'authentification,
 *    sans cookie puis avec un cookie forgé, contre une vraie base.
 * ------------------------------------------------------------------------- */

/**
 * Toute requête émise par **n'importe quel** pool du processus, comptée à
 * l'appel.
 *
 * L'instrument est posé sur les prototypes de `pg`, et c'est la seule position
 * qui tienne : un compteur posé sur une connexion créée par le test ne voit
 * rien de ce qu'un écran ouvre pour son compte — et c'est exactement ce que la
 * mutation de la revue faisait.
 */
type PostgresCall = (...args: unknown[]) => unknown

interface PoolPrototype {
  query: PostgresCall
  connect: PostgresCall
}

/** Une adresse qui n'écoute rien : ce compteur n'a besoin d'aucune base. */
const UNREACHABLE_DATABASE = 'postgres://compteur@127.0.0.1:1/aucune'

/**
 * Le prototype des pools de `pg`, atteint **par le client du dépôt** et non par
 * un import de `pg` — que la racine ne déclare pas, et qu'elle n'a pas à
 * déclarer pour compter ce que son propre client émet.
 */
const poolPrototype = (): PoolPrototype => {
  const probe = createDatabaseClient({ connectionString: UNREACHABLE_DATABASE })
  const prototype = Object.getPrototypeOf(probe.pool) as PoolPrototype

  void probe.close()

  return prototype
}

const instrumentPostgres = (): { readonly seen: string[]; readonly restore: () => void } => {
  const seen: string[] = []
  const prototype = poolPrototype()
  const original = { query: prototype.query, connect: prototype.connect }

  const record =
    (label: string, call: PostgresCall): PostgresCall =>
    function (this: unknown, ...args: unknown[]) {
      const first = args[0] as { text?: string } | string | undefined

      seen.push(`${label} ${typeof first === 'object' ? (first.text ?? '') : (first ?? '')}`)

      return call.apply(this, args)
    }

  prototype.query = record('pool.query', original.query)
  prototype.connect = record('pool.connect', original.connect)

  return {
    seen,
    restore: () => {
      prototype.query = original.query
      prototype.connect = original.connect
    },
  }
}

describe('le rendu des pages publiques', () => {
  it('n’émet aucune requête base de données, écrans et shell exécutés', async () => {
    const postgres = instrumentPostgres()
    const slug = shippedSite.legalDocuments[0]?.slug ?? ''

    try {
      // Le shell, qui entoure tous les écrans…
      vi.resetModules()
      const { AppShell } = await import('../apps/web/app/app-shell')

      await AppShell({ children: null })

      // …puis les trois issues publiques, réellement rendues.
      expect((await renderRoot(shippedSite, ANONYMOUS)).html).not.toBe('')
      expect((await renderRoot(EMPTY_MARKETING_SITE, ANONYMOUS)).digest).toContain('NEXT_REDIRECT')
      expect((await renderLegal(shippedSite, slug)).html).not.toBe('')

      expect(postgres.seen).toEqual([])

      // Garde contre l'inertie, et contre le piège du compteur débranché : le
      // registre de modules est réinitialisé entre chaque rendu, donc
      // l'instrument doit survivre à `vi.resetModules()` — c'est la condition
      // pour qu'il voie une base ouverte **par un écran**.
      vi.resetModules()

      const { createDatabaseClient: freshClient } = await import('@repo/db')
      const connection = freshClient({ connectionString: UNREACHABLE_DATABASE })

      await connection.pool.query('select 1').catch(() => undefined)

      expect(postgres.seen.filter((call) => call.includes('select 1'))).toHaveLength(1)
    } finally {
      postgres.restore()
    }
  })
})

/* ------------------------------------------------------------------------- */

/**
 * Le pool, vu comme deux fonctions à compter.
 *
 * Une interface plutôt qu'un index signature : `Record<string, …>` rend chaque
 * accès potentiellement absent, et le compilateur refuse alors de les appeler.
 */
interface CountablePool {
  query: (...args: unknown[]) => unknown
  connect: (...args: unknown[]) => unknown
}

const databaseReachable = await isDatabaseReachable()

describe.skipIf(!databaseReachable)('la résolution de session d’un visiteur anonyme', () => {
  it('n’émet aucune requête SQL pour un visiteur sans session', async () => {
    const connection = createDatabaseClient({ connectionString: databaseUrl })
    const pool = connection.pool as unknown as CountablePool
    const queries: string[] = []
    const query = pool.query.bind(connection.pool)
    const connect = pool.connect.bind(connection.pool)

    pool.query = (...args: unknown[]) => {
      queries.push(String((args[0] as { text?: string })?.text ?? args[0]))

      return query(...args)
    }
    pool.connect = (...args: unknown[]) => {
      queries.push('connect')

      return connect(...args)
    }

    resetAuthService()

    const auth = configureAuth({
      db: connection.db,
      mailer: createRecordingMailer(),
      secret: 'secret-de-test-uniquement-0123456789abcdef',
      appUrl: 'http://localhost:3000',
    })

    try {
      // Sans cookie, puis avec un cookie de session forgé : dans les deux cas
      // la signature est refusée avant tout accès à la base.
      expect(await auth.resolveSession(new Request('http://localhost:3000/'))).toBeNull()
      expect(
        await auth.resolveSession(
          new Request('http://localhost:3000/', {
            headers: { cookie: 'better-auth.session_token=forge' },
          }),
        ),
      ).toBeNull()

      expect(queries).toEqual([])
    } finally {
      resetAuthService()
      await connection.close()
    }
  })

  it('mesure réellement quelque chose : une lecture de base fait monter le compteur', async () => {
    // La garde contre l'inertie du cas précédent. Un compteur qui n'attrape
    // rien rendrait « aucune requête » vrai sur un instrument débranché.
    const connection = createDatabaseClient({ connectionString: databaseUrl })
    const pool = connection.pool as unknown as CountablePool
    const queries: string[] = []
    const query = pool.query.bind(connection.pool)

    pool.query = (...args: unknown[]) => {
      queries.push(String((args[0] as { text?: string })?.text ?? args[0]))

      return query(...args)
    }

    try {
      await (pool.query as (text: string) => Promise<unknown>)('select 1')

      expect(queries).toHaveLength(1)
    } finally {
      await connection.close()
    }
  })
})

/**
 * **Les tables du site public sur une base réelle** — le quatrième critère de
 * s11, mesuré dans `information_schema` et non dans les fichiers de migration.
 *
 * Lire le SQL versionné ne dirait rien d'une table créée par un import
 * transitif ou par un schéma monolithique oublié ; c'est le raisonnement de
 * `packages/db/src/introspect.ts`, repris ici pour le seul module `marketing`.
 *
 * **Tout se passe dans un schéma à part**, créé au début et détruit à la fin.
 * La première écriture de cette suite supprimait les tables du module dans
 * `public`, sur la base de développement partagée, et les reposait en
 * `afterAll` : une exécution interrompue, ou un `pnpm test:e2e` lancé en
 * parallèle, laissait la base sans ces tables (constat F9 de la revue). Le
 * `search_path` de la connexion pointe donc sur `marketing_probe` — les
 * migrations, les repositories et les routes y écrivent sans le savoir — et le
 * journal de migration porte un nom propre à la sonde, sans quoi la suite
 * effacerait celui du dépôt. `public` n'est jamais touché.
 */
describe.skipIf(!databaseReachable)('les tables du site public, sur une base réelle', () => {
  /** Le schéma de la sonde. Créé, mesuré, détruit : il ne survit pas à la suite. */
  const PROBE_SCHEMA = 'marketing_probe'
  /**
   * Le journal de la sonde, **à côté** de celui du dépôt et non à sa place.
   *
   * Il reste dans le schéma `drizzle`, comme tous les journaux, mais sous un
   * nom à lui : la suite peut le détruire sans que `pnpm db:migrate` croie ses
   * migrations à rejouer sur des tables déjà posées.
   */
  const PROBE_JOURNAL = `${migrationsTableFor(marketingModule.id)}_probe`

  const probeUrl = (): string => {
    const url = new URL(databaseUrl)

    url.searchParams.set('options', `-c search_path=${PROBE_SCHEMA}`)

    return url.toString()
  }

  /** La connexion sur la base telle qu'elle est : elle crée et détruit le schéma. */
  let admin: ReturnType<typeof createDatabaseClient>
  /** La connexion de la sonde : tout ce qu'elle écrit va dans `PROBE_SCHEMA`. */
  let connection: ReturnType<typeof createDatabaseClient>

  const MARKETING_TABLES = ['contact_message', 'public_form_throttle', 'public_subscription']

  const planFor = (enabled: readonly string[]) =>
    planModuleMigrations({
      modules: resolveEnabledModules({ available: [marketingModule], enabled }),
      repoRoot: fileURLToPath(new URL('..', import.meta.url)),
    }).map((step) => ({ ...step, migrationsTable: PROBE_JOURNAL }))

  const tablesOfProbe = async (): Promise<readonly string[]> =>
    await listDatabaseTables({ db: connection.db, schemaName: PROBE_SCHEMA })

  beforeAll(async () => {
    admin = createDatabaseClient({ connectionString: databaseUrl, maxConnections: 1 })

    await admin.db.execute(sql`drop schema if exists ${sql.identifier(PROBE_SCHEMA)} cascade`)
    await admin.db.execute(sql`create schema ${sql.identifier(PROBE_SCHEMA)}`)
    await admin.db.execute(sql`create schema if not exists drizzle`)
    await admin.db.execute(sql`drop table if exists drizzle.${sql.identifier(PROBE_JOURNAL)}`)

    connection = createDatabaseClient({ connectionString: probeUrl(), maxConnections: 1 })
  })

  afterAll(async () => {
    await connection.close()
    await admin.db.execute(sql`drop schema if exists ${sql.identifier(PROBE_SCHEMA)} cascade`)
    await admin.db.execute(sql`drop table if exists drizzle.${sql.identifier(PROBE_JOURNAL)}`)
    await admin.close()
  })

  it('n’en pose aucune quand le module n’est pas activé', async () => {
    const outcomes = await runModuleMigrations({ db: connection.db, plan: planFor([]) })
    const tables = await tablesOfProbe()

    expect(outcomes).toEqual([])

    for (const table of MARKETING_TABLES) {
      expect(tables, table).not.toContain(table)
    }
  })

  it('pose les trois, et rien de plus, quand il l’est', async () => {
    const outcomes = await runModuleMigrations({
      db: connection.db,
      plan: planFor([marketingModule.id]),
    })

    expect(outcomes).toEqual([{ moduleId: marketingModule.id, applied: true, count: 2 }])

    expect([...(await tablesOfProbe())].sort()).toEqual([...MARKETING_TABLES].sort())
  })

  it('rejouée, la migration n’a plus rien à appliquer', async () => {
    // `docs/reliability.md` §1 : « idempotent » se prouve en exécutant deux
    // fois et en constatant un seul effet, jamais dans un commentaire.
    await runModuleMigrations({ db: connection.db, plan: planFor([marketingModule.id]) })
    const second = await runModuleMigrations({
      db: connection.db,
      plan: planFor([marketingModule.id]),
    })

    expect(second).toEqual([{ moduleId: marketingModule.id, applied: false, count: 0 }])
    expect(await tablesOfProbe()).toContain('public_subscription')
  })

  it('refuse deux fois la même adresse pour la même source, par la contrainte', async () => {
    // La propriété qui porte le critère 2 : elle est **en base**. Une
    // vérification préalable laisserait passer deux soumissions simultanées
    // (`docs/reliability.md` §1).
    await runModuleMigrations({ db: connection.db, plan: planFor([marketingModule.id]) })

    const insert = (id: string) =>
      connection.db.execute(
        sql`insert into public_subscription (id, email, source, locale)
            values (${id}, 'doublon@example.test', 'newsletter', 'fr')`,
      )

    await insert('sub-1')
    await expect(insert('sub-2')).rejects.toThrow()

    const rows = await connection.db.execute<{ count: number }>(
      sql`select count(*)::int as count from public_subscription
          where email = 'doublon@example.test'`,
    )

    expect(Number(rows.rows[0]?.count ?? 0)).toBe(1)

    // La même adresse sur une **autre** source reste permise : c'est cette
    // colonne qui laisse s42 réutiliser la table.
    await connection.db.execute(
      sql`insert into public_subscription (id, email, source, locale)
          values ('sub-3', 'doublon@example.test', 'waitlist', 'fr')`,
    )

    await connection.db.execute(sql`delete from public_subscription`)
  })

  describe('les repositories du module, contre la base', () => {
    it('n’inscrit qu’une fois, même sur deux soumissions **simultanées**', async () => {
      // `docs/reliability.md` §1 : « clé d'idempotence ou contrainte d'unicité,
      // jamais une simple vérification préalable — elle laisse une fenêtre de
      // concurrence ». Les deux insertions partent ensemble, sans await entre
      // elles : une implémentation qui lirait avant d'écrire laisserait passer
      // les deux.
      await runModuleMigrations({ db: connection.db, plan: planFor([marketingModule.id]) })

      const repository = createDrizzlePublicSubscriptions(connection.db)
      const attempt = (id: string) =>
        repository.subscribe({
          id,
          email: 'course@example.test',
          source: 'newsletter',
          locale: 'fr',
        })

      const results = await Promise.all([attempt('race-1'), attempt('race-2')])

      expect(results.filter((result) => result !== null)).toHaveLength(1)
      expect(await repository.listByEmail('course@example.test')).toHaveLength(1)

      expect(await repository.deleteByEmail('course@example.test')).toBe(1)
      expect(await repository.listByEmail('course@example.test')).toEqual([])
    })

    it('compte les soumissions d’une fenêtre, et repart à un dans la suivante', async () => {
      await runModuleMigrations({ db: connection.db, plan: planFor([marketingModule.id]) })

      const throttle = createDrizzleSubmissionThrottle(connection.db)
      const bucket = { key: 'contact:client:1.2.3.4', max: 3 }
      const first = new Date('2026-08-31T10:00:00.000Z')
      const second = new Date('2026-08-31T10:10:00.000Z')

      expect(await throttle.hit({ bucket, windowStart: first })).toBe(1)
      expect(await throttle.hit({ bucket, windowStart: first })).toBe(2)
      // Fenêtre suivante : le compteur repart, il ne s'additionne pas.
      expect(await throttle.hit({ bucket, windowStart: second })).toBe(1)

      // Deux seaux ne se mélangent pas.
      expect(
        await throttle.hit({ bucket: { key: 'contact:all', max: 9 }, windowStart: second }),
      ).toBe(1)

      const stored = await connection.db.execute<{ bucket: string }>(
        sql`select bucket from public_form_throttle`,
      )

      // **Aucune adresse en clair dans la table** : la clé est condensée avant
      // d'être écrite (`docs/research/s11-public-forms.md` §6.4).
      for (const row of stored.rows) {
        expect(row.bucket).not.toContain('1.2.3.4')
        expect(row.bucket).not.toContain('contact')
      }

      await connection.db.execute(sql`delete from public_form_throttle`)
    })

    it('n’accumule pas les seaux : ceux d’une fenêtre close sont effacés', async () => {
      /**
       * **La croissance de la table, mesurée puis refermée** (constat F1).
       *
       * Un seau par identifiant d'appelant, et l'identifiant vient d'un en-tête
       * que le client écrit : 500 identifiants distincts donnaient 500 lignes,
       * et rien ne les reprenait. L'effacement se **prouve en l'exécutant**
       * (`docs/reliability.md` §1), pas en le déclarant dans un commentaire —
       * c'est exactement l'affirmation que le module portait et qui était fausse.
       */
      await runModuleMigrations({ db: connection.db, plan: planFor([marketingModule.id]) })
      await connection.db.execute(sql`delete from public_form_throttle`)

      const throttle = createDrizzleSubmissionThrottle(connection.db)
      const closed = new Date('2026-08-31T09:00:00.000Z')
      const current = new Date('2026-08-31T09:10:00.000Z')

      const rowCount = async (): Promise<number> => {
        const counted = await connection.db.execute<{ count: number }>(
          sql`select count(*)::int as count from public_form_throttle`,
        )

        return Number(counted.rows[0]?.count ?? 0)
      }

      await Promise.all(
        Array.from({ length: 500 }, async (_unused, index) =>
          await throttle.hit({
            bucket: { key: `newsletter:client:198.51.100.${index}`, max: 5 },
            windowStart: closed,
          }),
        ),
      )

      expect(await rowCount()).toBe(500)

      // Un seau de la fenêtre **en cours** : il ne doit pas être emporté.
      await throttle.hit({ bucket: { key: 'newsletter:all', max: 200 }, windowStart: current })

      expect(await throttle.sweep(current)).toBe(500)
      expect(await rowCount()).toBe(1)

      await connection.db.execute(sql`delete from public_form_throttle`)
    })
  })

  /**
   * **Les routes servies par le répartiteur**, de bout en bout : requête HTTP →
   * route du module → cas d'usage → base réelle → doublure d'enregistrement du
   * mailer. Rien n'est remplacé que le **réseau** du fournisseur d'emails.
   */
  describe('les routes des formulaires publics, servies', () => {
    const withMarketing = buildRegistry({
      available: [...availableModules],
      enabled: ['auth', 'marketing'],
      locales: [...appLocales],
    })

    const mailer = createRecordingMailer()

    const post = async (path: string, body: unknown): Promise<Response> =>
      await dispatchModuleRequest(
        withMarketing,
        new Request(`https://app.test${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
          body: JSON.stringify(body),
        }),
      )

    beforeAll(async () => {
      await runModuleMigrations({ db: connection.db, plan: planFor([marketingModule.id]) })

      configureMarketing({
        db: connection.db,
        mailer,
        forms: marketingConfiguration.forms,
        locales: [...appLocales],
        defaultLocale: appLocales[0],
        emailOfScope: (scope) =>
          Promise.resolve(scope.kind === 'user' ? 'contrat@example.test' : null),
        // Séquentiel et déterministe : la suite peut alors exiger un identifiant
        // précis sans dépendre d'un UUID.
        generateId: (() => {
          let index = 0

          return () => `sub-route-${(index += 1)}`
        })(),
        // Attendu ici : la suite veut observer l'email, pas courir contre lui.
        runInBackground: (task) => {
          void task
        },
      })
    })

    afterAll(async () => {
      resetMarketingService()
      await connection.db.execute(sql`delete from public_subscription`)
      await connection.db.execute(sql`delete from public_form_throttle`)
    })

    it('répond **exactement pareil** à une adresse nouvelle, connue ou malformée', async () => {
      // C'est la mesure du §7 : un formulaire qui répondrait différemment
      // dirait qui est déjà inscrit. La comparaison porte sur le statut, le
      // corps et le type de contenu — trois façons de laisser fuiter le cas.
      const bodies = [
        { email: 'route-nouvelle@example.test' },
        { email: 'route-nouvelle@example.test' },
        { email: 'pas-une-adresse' },
      ]

      const responses = await Promise.all(
        bodies.map(async (body) => {
          const response = await post(marketingRoutePath('newsletter'), body)

          return {
            status: response.status,
            type: response.headers.get('content-type'),
            body: await response.text(),
          }
        }),
      )

      expect(responses[1]).toEqual(responses[0])
      expect(responses[2]).toEqual(responses[0])
      expect(responses[0]?.status).toBe(200)
    })

    it('nomme le champ fautif du contact, et refuse de servir un chemin voisin', async () => {
      const refused = await post(marketingRoutePath('contact'), {
        name: 'Visiteur',
        email: 'pas-une-adresse',
        message: 'Bonjour',
      })

      expect(refused.status).toBe(400)
      expect(await refused.json()).toEqual({ status: 'invalid', field: 'email' })

      // Ce qui n'est pas déclaré n'existe pas : le répartiteur ne devine pas un
      // chemin voisin.
      const unknown = await post(`${marketingRoutePath('contact')}/envoyer`, {})

      expect(unknown.status).toBe(404)
    })

    it('refuse au-delà du seuil, en 429, et n’écrit plus rien', async () => {
      // Les cas précédents ont déjà rempli le seau de cet appelant : la
      // fenêtre est remise à zéro pour que ce cas mesure le seuil, et non ce
      // qu'il reste du seuil.
      await connection.db.execute(sql`delete from public_form_throttle`)

      const { maxPerClient } = marketingConfiguration.forms.rateLimit
      const statuses: number[] = []

      for (let index = 0; index <= maxPerClient; index += 1) {
        const response = await post(marketingRoutePath('newsletter'), {
          email: `seuil-${index}@example.test`,
        })

        statuses.push(response.status)
      }

      expect(statuses.slice(0, maxPerClient)).toEqual(Array(maxPerClient).fill(200))
      expect(statuses.at(-1)).toBe(429)

      const rows = await connection.db.execute<{ count: number }>(
        sql`select count(*)::int as count from public_subscription
            where email like 'seuil-%'`,
      )

      expect(Number(rows.rows[0]?.count ?? 0)).toBe(maxPerClient)
    })

    it('exporte puis efface une inscription **par le contrat du module**', async () => {
      // Ce sont `marketingModule.export` et `marketingModule.purge` qui sont
      // appelés, pas les cas d'usage : c'est ce chemin-là que le registre
      // empruntera en s34/s35, et il peut être débranché sans que les cas
      // d'usage ne bougent.
      await connection.db.execute(sql`delete from public_form_throttle`)
      await post(marketingRoutePath('newsletter'), { email: 'contrat@example.test' })

      const scope = { kind: 'user', userId: 'u-contrat' } as const

      expect(await marketingModule.export(scope)).toEqual({
        subscriptions: [
          {
            source: marketingConfiguration.forms.newsletterSource,
            locale: appLocales[0],
            createdAt: expect.any(Date),
          },
        ],
        messages: [],
      })

      await marketingModule.purge(scope)

      expect(await marketingModule.export(scope)).toEqual({ subscriptions: [], messages: [] })
    })
  })
})

/**
 * Les emails du module, et **la seule règle qui les protège d'une injection
 * d'en-tête**.
 *
 * `@repo/emails` interpole le sujet avec la **même** fonction que le corps, qui
 * n'échappe rien (`packages/emails/src/interpolate.ts`) — l'échappement, lui,
 * vient de React Email et ne s'applique qu'au corps. Un sujet portant un
 * marqueur ferait donc transiter une saisie de visiteur par un champ d'en-tête.
 * La règle est dérivée des templates réellement déclarés : en ajouter un avec
 * `{quelque-chose}` dans son sujet fait rougir `pnpm test`.
 */
describe('les emails du site public', () => {
  it('ne laisse aucun marqueur dans un sujet, dans aucune locale', () => {
    const subjects = marketingModule.emails.flatMap((template) =>
      Object.entries(template.locales).map(([locale, content]) => ({
        where: `${template.id}/${locale}`,
        subject: content.subject,
      })),
    )

    // Garde d'inertie : un module sans email rendrait la boucle vraie sans rien
    // mesurer.
    expect(subjects.length).toBeGreaterThanOrEqual(appLocales.length * 2)

    for (const { where, subject } of subjects) {
      expect(subject, where).not.toMatch(/\{[a-zA-Z0-9_]+\}/)
    }
  })
})

/**
 * **La garde 404 de l'écran de contact, dans les deux états du dépôt.**
 *
 * Elle n'était mesurée que par `tests/rendered-text.test.ts`, dont l'attente est
 * dérivée de la configuration : module activé — la configuration livrée — la
 * retirer ne faisait rien rougir (constat F4 de la revue de s11). Le point de
 * composition est donc remplacé ici pour poser l'état « site public sans
 * formulaires », quel que soit ce que `config/features.ts` dit par ailleurs.
 */
describe('l’écran de contact, site public sans formulaires', () => {
  afterAll(() => {
    vi.doUnmock('../apps/web/lib/marketing')
    vi.resetModules()
  })

  it('refuse de se rendre, dans les deux configurations du dépôt', async () => {
    vi.resetModules()
    vi.doMock('../apps/web/lib/marketing', () => ({
      marketingSite: EMPTY_MARKETING_SITE,
      marketingFormsAvailable: false,
    }))

    const { default: ContactPage } = await import('../apps/web/app/contact/page')

    await expect(ContactPage()).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK;404'),
    })
  })
})
