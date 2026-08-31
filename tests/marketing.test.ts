import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildRegistry } from '@repo/core'
import { createDatabaseClient } from '@repo/db'
import { configureAuth, resetAuthService } from '@repo/module-auth'
import {
  EMPTY_MARKETING_SITE,
  legalPath,
  marketingMessageKeys,
  marketingModule,
  resolveMarketingSite,
  robotsAllows,
  type MarketingSite,
  type RobotsPolicy,
} from '@repo/module-marketing'
import { LegalDocumentView, MarketingHome } from '@repo/module-marketing/presentation'
import { createRecordingMailer } from '@repo/mailer-testing'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { localeRouting } from '../apps/web/lib/locale-routing'
import { moduleRegistry } from '../apps/web/lib/module-registry'
import { marketingSite } from '../apps/web/lib/marketing'
import { flatMessagesFor } from '../apps/web/lib/messages'
import { availableModules } from '../config/features'
import { appLocales } from '../config/i18n'
import { marketingConfiguration } from '../config/marketing'
import { databaseUrl, isDatabaseReachable } from './fixtures/database'
import { markerFor } from './fixtures/pseudo-locale'
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

    return { html: renderToStaticMarkup(tree as never), digest: null }
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

  it('ne pose ni table ni migration, sur une base vierge comme ailleurs', () => {
    // Le critère « aucune migration appliquée » est ici vrai **par
    // construction** : ce module ne déclare aucun schéma en s10. Il est écrit
    // pour que l'ajout d'une table en s11 fasse rougir cette ligne, et non
    // pour faire croire qu'une garde le tient.
    expect(marketingModule.schema).toEqual({})
    expect(marketingModule.migrations).toBeNull()
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

    renderToStaticMarkup(createElement(MarketingHome, { site: shippedSite, intl }))

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
