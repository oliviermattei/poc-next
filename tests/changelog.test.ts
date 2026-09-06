import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildRegistry, defineModule, type AnyModuleDefinition } from '@repo/core'
import {
  CHANGELOG_CATEGORIES,
  CHANGELOG_PATH,
  EMPTY_CHANGELOG_CATALOG,
  changelogFeedPath,
  changelogListView,
  changelogMessageKeys,
  changelogModule,
  provideChangelogContent,
  resolveChangelogCatalog,
  type ChangelogCatalog,
  type ChangelogEntry,
} from '@repo/module-changelog'
import { ChangelogList } from '@repo/module-changelog/presentation'
import { parseFeed } from '@rowanmanning/feed-parser'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { moduleFooterLinks } from '../apps/web/lib/footer'
import { localeRouting } from '../apps/web/lib/locale-routing'
import { availableModules, requiredModules } from '../config/features'
import { appLocales, defaultLocale } from '../config/i18n'
import { dispatchAllowingRateLimit } from './fixtures/rate-limit'

/**
 * Les nouveautés, **là où elles traversent les packages**.
 *
 * Les règles pures vivent et se prouvent dans le module : le frontmatter et
 * l'ordre des versions dans
 * `packages/modules/changelog/src/domain/changelog-entry.test.ts`, la surface de
 * navigation dans `packages/core/src/protection.test.ts`, le constructeur de
 * flux dans `packages/core/src/syndication.test.ts`. Ce fichier-ci pose les
 * quatre questions que le module ne peut pas poser tout seul :
 *
 * 1. **le flux servi est-il analysable comme un flux ?** Il est passé, tel que
 *    le répartiteur le rend, à `@rowanmanning/feed-parser` ;
 * 2. **que devient-il quand le module est coupé ?** La route n'est dans aucune
 *    table de routage, et la réponse doit être celle d'un chemin inventé ;
 * 3. **le pied de page se dérive-t-il du registre ?** C'est la question que
 *    `consentFooterLinks` posait mal — un import nommé dans sept fichiers ;
 * 4. **les entrées entrent-elles dans le plan de site**, et seulement dans les
 *    langues où elles existent ?
 *
 * **Ce que la mesure du flux prouve, et ce qu'elle ne prouve pas.** L'analyseur
 * se décrit lui-même comme *resilient* : il lève sur un document qui n'est pas
 * un flux, et il accepte un `<channel>` sans titre, sans lien ni description —
 * `tests/blog.test.ts` en porte la mesure. Il établit donc « **analysable**
 * comme flux », jamais « valide au sens d'un validateur ». Le critère 3 de la
 * story dit « valide » ; le dépôt n'embarque aucun validateur, et ce mot n'est
 * donc écrit nulle part ici.
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

const entry = (over: Partial<ChangelogEntry> = {}): ChangelogEntry => ({
  slug: 'flux-des-nouveautes',
  locale: defaultLocale,
  version: '1.1',
  date: '2026-02-18',
  category: 'added',
  title: 'Un flux RSS des nouveautés',
  description: 'Les nouvelles versions se suivent depuis un agrégateur.',
  ...over,
})

/** Une entrée dont le titre porte `&`, `<` et des guillemets — le prix de l'échappement. */
const HOSTILE = entry({
  slug: 'titre-hostile',
  version: '10.0',
  date: '2026-03-02',
  title: 'Nouveautés & « pièges » : <script> compris',
  description: 'Une description avec un & et un <chevron>.',
})

const OTHER_LOCALE = appLocales.find((locale) => locale !== defaultLocale) ?? defaultLocale

const provideCatalog = (catalog: ChangelogCatalog): void => {
  provideChangelogContent(() => ({
    catalog,
    locales: [...localeRouting.locales],
    defaultLocale: localeRouting.defaultLocale,
    url: (pathname, locale) =>
      `https://app.test${pathname.startsWith('/api') ? pathname : localeRouting.publicPath(pathname, locale)}`,
  }))
}

const registryOf = (enabled: readonly string[], extra: readonly AnyModuleDefinition[] = []) =>
  buildRegistry({
    available: [...availableModules, ...extra],
    enabled: [...requiredModules, 'i18n', ...enabled],
    required: [...requiredModules],
    locales: [...appLocales],
  })

const servedFeed = async (
  registry: ReturnType<typeof buildRegistry>,
  query = '',
): Promise<Response> =>
  await dispatchAllowingRateLimit(
    registry,
    new Request(`https://app.test${changelogFeedPath()}${query}`, { method: 'GET' }),
  )

describe('le flux des nouveautés', () => {
  it('est un flux qu’un analyseur de flux lit, et il porte les entrées', async () => {
    provideCatalog(resolveChangelogCatalog({ entries: [entry(), HOSTILE] }))

    const response = await servedFeed(registryOf(['changelog']))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/rss+xml')

    // L'analyseur **lève** sur un document qui n'est pas un flux : c'est ce qui
    // remplace une assertion maison sur le texte produit, et c'est aussi tout
    // ce qu'il établit.
    const feed = parseFeed(await response.text())

    // Le titre vient du catalogue **du module**, pas de celui de l'application :
    // celui-ci disparaît avec le module, et `pnpm test:minimal-profile` le coupe.
    expect(feed.title).toBe(changelogModule.messages[defaultLocale]?.['list.title'])
    expect(feed.items.map((item) => item.title)).toEqual([HOSTILE.title, entry().title])

    // **Chaque entrée a son adresse**, l'ancre de la page : un `guid` commun
    // ferait dédoublonner le flux par un lecteur, qui n'en afficherait qu'une.
    expect(feed.items.map((item) => item.url)).toEqual([
      `https://app.test${localeRouting.publicPath(CHANGELOG_PATH, defaultLocale)}#${HOSTILE.slug}`,
      `https://app.test${localeRouting.publicPath(CHANGELOG_PATH, defaultLocale)}#${entry().slug}`,
    ])

    // Une note de version n'est signée de personne : elle appartient à une
    // version du produit, pas à un auteur.
    expect(await (await servedFeed(registryOf(['changelog']))).text()).not.toContain('<dc:creator>')
  })

  it('ne sert que la langue demandée, et retombe sur celle du site sinon', async () => {
    const elsewhere = entry({ slug: 'seulement-ailleurs', locale: OTHER_LOCALE })

    provideCatalog(resolveChangelogCatalog({ entries: [entry(), elsewhere] }))

    const registry = registryOf(['changelog'])
    const slugsOf = async (query: string) =>
      parseFeed(await (await servedFeed(registry, query)).text()).items.map((item) =>
        (item.url ?? '').split('#').at(-1),
      )

    // Une langue que l'application ne **sert** pas n'entre ni dans le document,
    // ni dans les URL : elle est ignorée, pas crue (`docs/security.md` §4).
    expect(await slugsOf('?locale=../../etc')).toEqual([entry().slug])

    // L'attente est **dérivée des langues servies** : module `i18n` coupé,
    // l'application n'en sert qu'une et la seconde retombe sur le flux du site.
    expect(await slugsOf(`?locale=${OTHER_LOCALE}`)).toEqual(
      localeRouting.locales.includes(OTHER_LOCALE) ? [elsewhere.slug] : [entry().slug],
    )
  })

  it('répond 404 quand le module est coupé, comme sur un chemin inventé', async () => {
    provideCatalog(EMPTY_CHANGELOG_CATALOG)

    const registry = registryOf([])
    const invented = await dispatchAllowingRateLimit(
      registry,
      new Request('https://app.test/api/modules/changelog/chemin-invente', { method: 'GET' }),
    )
    const response = await servedFeed(registry)

    expect(response.status).toBe(invented.status)
    expect(await response.text()).toBe(await invented.clone().text())

    // Garde d'inertie : le module **déclare** bien cette route, et publique.
    expect(changelogModule.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'GET /changelog/feed.xml',
    ])
    expect(changelogModule.routes[0]?.protection).toEqual({ level: 'public' })
  })
})

describe('la page et le flux, tenus ensemble', () => {
  /** L'écran rendu tel qu'un visiteur le reçoit, sans démarrer l'application. */
  const listMarkup = (catalog: ChangelogCatalog, locale: string): string =>
    renderToStaticMarkup(
      createElement(ChangelogList, {
        view: changelogListView(catalog, { locale }),
        intl: { t: (key: string) => key, path: (pathname: string) => pathname },
      }),
    )

  it('pose sur chaque entrée l’ancre exacte que le flux publie, dans l’ordre du domaine', async () => {
    // Deux entrées d'une **même version** dont la date et la catégorie
    // s'opposent : la plus récente est un retrait, la plus ancienne un ajout.
    // Une présentation qui retrierait par catégorie les inverserait, et c'est ce
    // que ce cas refuse — l'ordre est une règle du domaine, l'écran ne le
    // rejoue pas.
    const recente = entry({ slug: 'la-plus-recente', date: '2026-02-20', category: 'removed' })
    const ancienne = entry({ slug: 'la-plus-ancienne', date: '2026-02-18', category: 'added' })
    const catalog = resolveChangelogCatalog({ entries: [ancienne, recente, HOSTILE] })

    provideCatalog(catalog)

    const markup = listMarkup(catalog, defaultLocale)
    const anchors = [...markup.matchAll(/<article[^>]*\sid="([^"]+)"/g)].map((match) => match[1])

    expect(anchors).toEqual([HOSTILE.slug, recente.slug, ancienne.slug])

    // **Le lien du flux et l'ancre de la page ne sont pas liés par l'intention.**
    // Chaque `guid` vaut `…/changelog#<slug>` : une ancre absente ou renommée
    // ferait pointer tout le flux au sommet de la page, et le lecteur qui suit
    // le lien de la troisième entrée lirait la première.
    const fragments = parseFeed(await (await servedFeed(registryOf(['changelog']))).text()).items.map(
      (item) => (item.url ?? '').split('#').at(-1),
    )

    expect(fragments.length).toBeGreaterThan(1)
    expect([...fragments].sort()).toEqual([...anchors].sort())
  })
})

describe('le catalogue de traductions du module', () => {
  it('livre chaque clé que le code compose, dans toutes les locales du projet', () => {
    // Les libellés de catégorie sont **composés** (`category.<id>`) : le
    // balayage statique de `tests/i18n.test.ts` ne les voit pas, et la revue de
    // s31 a mesuré qu'une cinquième catégorie sans clé y laissait 102 cas verts.
    // `changelogMessageKeys()` était exportée et consommée par rien : c'est ce
    // cas-ci qui en fait une garantie, comme `tests/consent.test.ts` le fait
    // pour son homologue.
    const required = changelogMessageKeys()

    // Garde contre le balayage vide, **dérivée** : une clé par catégorie, plus
    // celles de l'écran.
    expect(required.length).toBeGreaterThan(CHANGELOG_CATEGORIES.length)

    for (const locale of appLocales) {
      const catalogue = changelogModule.messages[locale] ?? {}

      for (const key of required) {
        expect(
          catalogue[key.replace(`${changelogModule.id}.`, '')],
          `${locale} → ${key}`,
        ).toBeDefined()
      }
    }
  })
})

describe('ce que les nouveautés donnent à indexer', () => {
  const context = { locales: [...appLocales], defaultLocale }

  it('n’annonce rien quand le catalogue n’est pas monté, fût-il plein', () => {
    provideCatalog(EMPTY_CHANGELOG_CATALOG)
    expect(changelogModule.publicUrls(context)).toEqual([])

    // **La décision se lit sur `index`, jamais sur le nombre d'entrées**, et
    // c'est le second catalogue qui le prouve : sur le premier, la garde
    // suivante — « aucune entrée servie » — rend `[]` de toute façon, si bien
    // que neutraliser celle-ci laissait le cas vert (revue de s31). Une
    // mutation verte veut dire que le test est faux, pas que le code est juste.
    //
    // Aucun constructeur du module ne produit ce second catalogue —
    // `resolveChangelogCatalog` pose toujours un index. Il énonce ce que la
    // garde tient : un point de composition qui aurait lu le disque sans monter
    // la page n'annoncerait rien pour autant, plutôt que de publier une URL qui
    // répond 404.
    provideCatalog({ entries: [entry()], index: null })
    expect(changelogModule.publicUrls(context)).toEqual([])
  })

  it('annonce la page, dans les seules langues où une entrée existe', () => {
    provideCatalog(
      resolveChangelogCatalog({
        entries: [entry({ date: '2026-02-18' }), HOSTILE],
      }),
    )

    expect(changelogModule.publicUrls(context)).toEqual([
      {
        path: CHANGELOG_PATH,
        // Seulement la langue par défaut : les deux entrées y vivent, et
        // annoncer l'autre référencerait une page qui n'a rien à montrer.
        locales: [defaultLocale],
        // La plus récente des entrées : c'est la dernière fois que **cette
        // page** a changé.
        lastModified: HOSTILE.date,
      },
    ])

    // Une seule URL, jamais une par entrée : elles vivent toutes sur la même
    // page, et publier une adresse par entrée annoncerait des 404.
    provideCatalog(
      resolveChangelogCatalog({ entries: [entry(), entry({ slug: 'autre', version: '1.0' })] }),
    )
    expect(changelogModule.publicUrls(context)).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------------- *
 * Le pied de page, dérivé du registre (s31).
 *
 * C'est la tâche qui paye au module suivant : `consentFooterLinks` était
 * importé nommément par sept fichiers de `apps/web/app`, et le changelog en
 * aurait fait un second nom aux sept mêmes endroits.
 * ------------------------------------------------------------------------- */

const footerModule = (id: string, href: string): AnyModuleDefinition =>
  defineModule({
    id,
    requires: [],
    schema: {},
    migrations: null,
    routes: [],
    navigation: [
      {
        id: 'lien',
        href,
        labelKey: 'footer.link',
        order: 0,
        protection: { level: 'public' },
        surface: 'footer',
      },
    ],
    publicUrls: () => [],
    messages: Object.fromEntries(
      appLocales.map((locale) => [locale, { 'footer.link': `Lien ${id}` }]),
    ),
    emails: [],
    webhooks: [],
    jobs: [],
    dataCategories: [],
    retention: {},
    purge: async () => {},
    export: async () => ({}),
  })

/** Un traducteur témoin : il rend la clé qu'on lui donne, marquée. */
const label = (key: string): string => `traduit(${key})`

describe('les liens du pied de page public', () => {
  it('viennent des modules activés, et disparaissent avec eux', () => {
    const huitieme = footerModule('module-de-plus', '/module-de-plus')

    const avec = moduleFooterLinks(
      registryOf(['changelog', 'consent', huitieme.id], [huitieme]),
      null,
      label,
    )
    const sans = moduleFooterLinks(registryOf(['consent', huitieme.id], [huitieme]), null, label)

    // Le module ajouté **n'a demandé aucune modification d'écran** : il a
    // déclaré une entrée de surface « footer », et il est là.
    expect(avec.map((link) => link.href)).toContain('/module-de-plus')
    expect(avec.map((link) => link.href)).toContain(CHANGELOG_PATH)

    // Coupé, il disparaît sans condition : le registre ne l'agrège pas.
    expect(sans.map((link) => link.href)).not.toContain(CHANGELOG_PATH)
    expect(sans.map((link) => link.href)).toContain('/module-de-plus')

    // Le libellé passe par le traducteur, avec la clé **qualifiée du module** :
    // c'est le registre qui la préfixe, et un lien dont le texte serait la clé
    // nue serait un défaut visible à l'écran.
    expect(avec.map((link) => link.label)).toContain(`traduit(${huitieme.id}.footer.link)`)
  })

  it('ne remonte pas les entrées de la barre latérale', () => {
    // Un lien de service au rang des fonctionnalités du produit serait une
    // régression d'écran : la règle est dans `@repo/core`, ce cas est le témoin
    // qu'elle est **appelée** ici.
    const registry = registryOf(['blog', 'changelog'])
    const hrefs = moduleFooterLinks(registry, null, label).map((link) => link.href)

    expect(hrefs).not.toContain('/blog')
    // Garde d'inertie : la surface « footer » du même registre, elle, est là.
    expect(hrefs).toContain(CHANGELOG_PATH)
  })
})

/* ------------------------------------------------------------------------- *
 * Le balayage : aucune page n'écrit un lien de pied de page à la main.
 * ------------------------------------------------------------------------- */

const APP_ROOT = join(REPO_ROOT, 'apps/web/app')

const filesUnder = (directory: string): readonly string[] =>
  readdirSync(directory).flatMap((name) => {
    const full = join(directory, name)

    return statSync(full).isDirectory() ? filesUnder(full) : [full]
  })

/** Les `footerLinks=` et `extraLinks=` écrits dans les écrans, avec leur fichier. */
const footerPropUsages = (): readonly { readonly file: string; readonly expression: string }[] =>
  filesUnder(APP_ROOT)
    .filter((file) => file.endsWith('.tsx'))
    .flatMap((file) => {
      const source = readFileSync(file, 'utf8')

      return [...source.matchAll(/(?:footerLinks|extraLinks)=\{([^}]*)\}/g)].map((match) => ({
        file: file.slice(REPO_ROOT.length),
        expression: (match[1] ?? '').trim(),
      }))
    })

describe('les écrans ne nomment aucun module pour leur pied de page', () => {
  it('passent tous la **même** expression, dérivée du registre', () => {
    const usages = footerPropUsages()

    // Garde contre le balayage vide : sans occurrence, tout ce qui suit serait
    // vrai sur rien — le mode d'échec que ce dépôt a rencontré trois fois.
    expect(usages.length).toBeGreaterThan(1)

    const distinctes = [...new Set(usages.map((usage) => usage.expression))]

    // **Une seule expression, dans tous les écrans.** Un module de plus qui
    // voudrait un lien ici en ajouterait une seconde, aux mêmes endroits : c'est
    // exactement ce que cette story a supprimé, et ce cas est ce qui empêche de
    // le réintroduire.
    expect(distinctes, usages.map((usage) => `${usage.file} → ${usage.expression}`).join(' ; ')).toEqual(
      ['publicFooterLinks(t)'],
    )

    // Et **aucun identifiant de module** dans cette expression : la liste des
    // identifiants est dérivée de l'annuaire, jamais recopiée.
    for (const module of availableModules) {
      expect(distinctes[0] ?? '', module.id).not.toContain(module.id)
    }
  })

  it('importent cette expression du seul point de composition qui la dérive', () => {
    const usages = footerPropUsages()

    for (const usage of usages) {
      const source = readFileSync(join(REPO_ROOT, usage.file), 'utf8')

      expect(source, usage.file).toMatch(
        /import \{ publicFooterLinks \} from '(?:\.\.\/)*lib\/footer'/,
      )
    }
  })
})
