import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildRegistry } from '@repo/core'
import {
  EMPTY_BLOG_CATALOG,
  blogFeedPath,
  blogModule,
  provideBlogContent,
  resolveBlogCatalog,
  type BlogCatalog,
} from '@repo/module-blog'
import { parseFeed } from '@rowanmanning/feed-parser'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { localeRouting } from '../apps/web/lib/locale-routing'
import { DEFAULT_OG_IMAGE } from '../apps/web/lib/og-image'
import { availableModules, requiredModules } from '../config/features'
import { appLocales, defaultLocale } from '../config/i18n'
import { dispatchAllowingRateLimit } from './fixtures/rate-limit'

/**
 * Le blog, **là où il traverse les packages**.
 *
 * Les règles pures vivent et se prouvent dans le module — le frontmatter dans
 * `domain/`, la liste et la locale dans `application/`, le dossier dans
 * `infrastructure/`. Ce fichier-ci pose les trois questions que le module ne
 * peut pas poser tout seul :
 *
 * 1. **les deux écrans refusent-ils quand le module n'est pas monté ?** Le
 *    catalogue est *injecté*, donc les deux états sont éprouvés dans la même
 *    exécution, quelle que soit la configuration du dépôt ;
 * 2. **que déclarent-ils aux moteurs ?** Les balises méta et Open Graph d'un
 *    article viennent de son frontmatter, et rien d'autre ;
 * 3. **le point de composition sert-il les bonnes locales ?** Celles de
 *    `localeRouting`, jamais celles de l'application — la confusion que
 *    `config/i18n.ts:5-7` documente.
 *
 * Les doublures remplacent le **contexte de requête** (le traducteur) et la
 * **configuration injectée** (le catalogue), jamais une règle.
 */

const requestLocale = vi.hoisted(() => ({ value: '' }))

vi.mock('../apps/web/lib/i18n', async () => {
  const { buildRegistry } = await import('@repo/core')
  const { createTranslator } = await import('next-intl')
  const { localeRouting: routing } = await import('../apps/web/lib/locale-routing')
  const { pseudoRequestConfig } = await import('./fixtures/pseudo-locale')
  const { availableModules: modules } = await import('../config/features')
  const { appLocales: locales, defaultLocale: locale } = await import('../config/i18n')

  // Le catalogue de l'annuaire complet : ce fichier injecte le blog pour
  // éprouver ses deux états, y compris dans un dépôt qui le coupe. Avec le
  // catalogue de la configuration courante, le rendu lèverait sur une clé
  // absente et le test échouerait pour une autre raison que celle qu'il porte.
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
        path: (pathname: string) => routing.publicPath(pathname, active),
      })
    },
  }
})

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

const ARTICLE = {
  // Le slug d'un article **réellement livré** : la page charge son corps par
  // un `import()` que le bundler a compilé, et un slug inventé n'y existerait
  // pas.
  slug: 'un-test-vert-qui-ne-verifie-rien',
  locale: defaultLocale,
  title: 'Un test vert qui ne vérifie rien',
  description: 'Comment un prédicat satisfait par un seul module devient un nom écrit en dur.',
  date: '2026-02-28',
  author: 'Olivier Mattei',
  tags: ['ingénierie', 'coulisses'],
} as const

/** Un article qui n'existe **que** dans l'autre langue. */
const OTHER_LOCALE = appLocales.find((locale) => locale !== defaultLocale) ?? defaultLocale

/**
 * Un article de la langue servie, **seul à porter son tag**.
 *
 * C'est ce qui rend un filtre observable : sans lui, tous les articles de la
 * locale portent les mêmes tags, et une liste filtrée est indiscernable d'une
 * liste qui ne l'est pas.
 */
const TAGGED = {
  ...ARTICLE,
  slug: 'seul-sous-son-tag',
  title: 'Seul sous son tag',
  tags: ['exclusif'],
} as const

const MOUNTED: BlogCatalog = resolveBlogCatalog({
  articles: [
    ARTICLE,
    TAGGED,
    { ...ARTICLE, locale: OTHER_LOCALE },
    // Traduit dans l'autre langue, et dans elle seule.
    { ...ARTICLE, slug: 'seulement-ailleurs', locale: OTHER_LOCALE },
  ],
  pageSize: 6,
})

interface Metadata {
  readonly title?: unknown
  readonly description?: unknown
  readonly keywords?: unknown
  readonly authors?: unknown
  readonly openGraph?: Record<string, unknown>
  readonly alternates?: { readonly canonical?: unknown }
}

const withCatalog = async <T,>(
  catalog: BlogCatalog,
  locale: string,
  use: (page: Record<string, unknown>) => Promise<T>,
  path: string,
): Promise<T> => {
  vi.resetModules()
  vi.doMock('../apps/web/lib/blog', () => ({ blogCatalog: catalog }))
  requestLocale.value = locale

  try {
    return await use((await import(path)) as Record<string, unknown>)
  } finally {
    requestLocale.value = ''
    vi.doUnmock('../apps/web/lib/blog')
  }
}

/** Le refus signalé par Next, ou `null` quand l'écran a rendu. */
const digestOf = async (run: () => Promise<unknown>): Promise<string | null> => {
  try {
    await run()

    return null
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest

    if (typeof digest !== 'string') {
      throw error
    }

    return digest
  }
}

const NOT_FOUND = 'NEXT_HTTP_ERROR_FALLBACK;404'

const articlePageDigest = (catalog: BlogCatalog, slug: string, locale = defaultLocale) =>
  withCatalog(
    catalog,
    locale,
    (page) =>
      digestOf(() =>
        (page.default as (props: { params: Promise<unknown> }) => Promise<unknown>)({
          params: Promise.resolve({ slug }),
        }),
      ),
    '../apps/web/app/blog/[slug]/page',
  )

/** La liste **rendue**, pour lire ce que le visiteur obtient de ses paramètres. */
const listPageMarkup = (
  catalog: BlogCatalog,
  searchParams: Record<string, string | string[] | undefined>,
) =>
  withCatalog(
    catalog,
    defaultLocale,
    async (page) =>
      renderToStaticMarkup(
        await (
          page.default as (props: {
            searchParams: Promise<unknown>
          }) => Promise<ReactElement>
        )({ searchParams: Promise.resolve(searchParams) }),
      ),
    '../apps/web/app/blog/page',
  )

const listPageDigest = (catalog: BlogCatalog) =>
  withCatalog(
    catalog,
    defaultLocale,
    (page) =>
      digestOf(() =>
        (page.default as (props: { searchParams: Promise<unknown> }) => Promise<unknown>)({
          searchParams: Promise.resolve({}),
        }),
      ),
    '../apps/web/app/blog/page',
  )

const articleMetadata = (catalog: BlogCatalog, slug: string, locale = defaultLocale) =>
  withCatalog(
    catalog,
    locale,
    (page) =>
      (page.generateMetadata as (props: { params: Promise<unknown> }) => Promise<Metadata>)({
        params: Promise.resolve({ slug }),
      }),
    '../apps/web/app/blog/[slug]/page',
  )

describe('les écrans du blog refusent quand le module n’est pas monté', () => {
  it('sert la liste quand il l’est', async () => {
    expect(await listPageDigest(MOUNTED)).toBeNull()
  })

  it('répond 404 sur la liste quand il ne l’est pas', async () => {
    expect(await listPageDigest(EMPTY_BLOG_CATALOG)).toContain(NOT_FOUND)
  })

  it('sert un article quand il l’est', async () => {
    expect(await articlePageDigest(MOUNTED, ARTICLE.slug)).toBeNull()
  })

  it('répond 404 sur un article quand il ne l’est pas', async () => {
    expect(await articlePageDigest(EMPTY_BLOG_CATALOG, ARTICLE.slug)).toContain(NOT_FOUND)
  })

  it('répond 404 sur un slug qu’aucun article ne porte', async () => {
    expect(await articlePageDigest(MOUNTED, 'inconnu')).toContain(NOT_FOUND)
  })

  it('répond 404 sur un slug malformé, sans le chercher', async () => {
    // Zod à la frontière : ce qui n'a pas la forme d'un slug n'atteint jamais
    // la recherche dans le catalogue.
    expect(await articlePageDigest(MOUNTED, '../../etc/passwd')).toContain(NOT_FOUND)
  })

  it('répond 404 sur un article qui n’existe pas dans la langue demandée', async () => {
    // La moitié « article » du critère i18n : on ne sert jamais la version
    // d'une autre langue à la place de celle qui manque.
    expect(await articlePageDigest(MOUNTED, 'seulement-ailleurs', defaultLocale)).toContain(
      NOT_FOUND,
    )
  })
})

describe('les paramètres de la liste sont lus séparément', () => {
  it('garde le tag demandé quand le numéro de page est malformé', async () => {
    // Les deux paramètres sont **indépendants** : un `?page=` illisible retombe
    // sur la page 1, il n'emporte pas le filtre avec lui. Validés ensemble, le
    // visiteur qui suit un lien périmé voit la liste complète sans un mot,
    // c'est-à-dire un filtre qui disparaît en silence.
    const html = await listPageMarkup(MOUNTED, { tag: 'exclusif', page: 'abc' })

    expect(html).toContain(TAGGED.title)
    expect(html).not.toContain(ARTICLE.title)
  })

  it('retombe sur la liste complète quand le tag seul est malformé', async () => {
    // La symétrique : un tag vide n'est pas un tag, et il ne doit pas produire
    // l'état « aucun article dans ce tag ».
    const html = await listPageMarkup(MOUNTED, { tag: '', page: '1' })

    expect(html).toContain(TAGGED.title)
    expect(html).toContain(ARTICLE.title)
  })
})

describe('ce qu’un article déclare aux moteurs', () => {
  it('reprend son frontmatter, et rien d’autre', async () => {
    const metadata = await articleMetadata(MOUNTED, ARTICLE.slug)

    expect(metadata.title).toBe(ARTICLE.title)
    expect(metadata.description).toBe(ARTICLE.description)
    expect(metadata.authors).toEqual([{ name: ARTICLE.author }])
    expect(metadata.keywords).toEqual([...ARTICLE.tags])
    expect(metadata.openGraph).toMatchObject({
      title: ARTICLE.title,
      description: ARTICLE.description,
      type: 'article',
      locale: defaultLocale,
      publishedTime: ARTICLE.date,
      authors: [ARTICLE.author],
      tags: [...ARTICLE.tags],
    })
  })

  it('déclare l’image de partage par défaut quand l’article n’en fournit pas', async () => {
    // Critère 3. L'image est **servie par l'application** : aucune origine
    // n'entre dans la politique de sécurité du contenu (`docs/security.md` §1).
    const metadata = await articleMetadata(MOUNTED, ARTICLE.slug)

    expect(metadata.openGraph?.images).toEqual([DEFAULT_OG_IMAGE])
  })

  it('déclare la sienne quand l’article en fournit une', async () => {
    const illustrated = resolveBlogCatalog({
      articles: [{ ...ARTICLE, slug: 'illustre', image: '/blog/illustre.png' }],
      pageSize: 6,
    })

    expect((await articleMetadata(illustrated, 'illustre')).openGraph?.images).toEqual([
      '/blog/illustre.png',
    ])
  })

  it('porte la canonique de la langue servie, jamais une commune aux deux', async () => {
    const canonicalIn = async (locale: string) =>
      (await articleMetadata(MOUNTED, ARTICLE.slug, locale)).alternates?.canonical

    // Deux langues, deux URL. Une valeur commune fusionnerait les deux versions
    // pour un moteur — le défaut que s10 a déjà fermé sur les pages légales.
    const served = localeRouting.locales

    for (const locale of served) {
      expect(await canonicalIn(locale)).toBe(
        localeRouting.publicPath(`/blog/${ARTICLE.slug}`, locale),
      )
    }

    if (served.length > 1) {
      expect(await canonicalIn(served[0] ?? '')).not.toBe(await canonicalIn(served[1] ?? ''))
    }
  })

  it('ne déclare rien d’un article qui n’existe pas', async () => {
    // Ni titre, ni description : une page 404 qui annoncerait un titre
    // divulguerait l'existence de ce qu'elle refuse.
    expect(await articleMetadata(MOUNTED, 'inconnu')).toEqual({})
    expect(await articleMetadata(EMPTY_BLOG_CATALOG, ARTICLE.slug)).toEqual({})
  })
})

describe('la liste annonce son flux', () => {
  it('déclare le flux de la langue servie, jamais celui d’une autre', async () => {
    const metadataIn = async (locale: string) =>
      (await withCatalog(
        MOUNTED,
        locale,
        (page) => (page.generateMetadata as () => Promise<Metadata>)(),
        '../apps/web/app/blog/page',
      )) as Metadata & { alternates?: { types?: Record<string, unknown> } }

    expect((await metadataIn(defaultLocale)).alternates?.types).toEqual({
      'application/rss+xml': blogFeedPath(),
    })
    expect((await metadataIn(OTHER_LOCALE)).alternates?.types).toEqual({
      'application/rss+xml': `${blogFeedPath()}?locale=${OTHER_LOCALE}`,
    })
  })
})

describe('le contenu livré', () => {
  it('n’est servi que dans les langues que l’application sert', async () => {
    // Le point de composition passe `localeRouting.locales`, pas `appLocales` :
    // module `i18n` coupé, l'application n'en sert qu'une, et les articles des
    // autres langues restent sur le disque sans être servis. **Ce cas ne mord
    // que dans cette configuration-là** — les deux listes sont identiques
    // quand `i18n` est activé, et c'est `pnpm test:socle` qui l'exécute.
    const { blogCatalog } = await import('../apps/web/lib/blog')

    for (const article of blogCatalog.articles) {
      expect(localeRouting.locales, article.slug).toContain(article.locale)
    }
  })

  it('est lu, validé et non vide — ou absent avec le module', async () => {
    // La lecture a lieu au chargement du point de composition : un frontmatter
    // invalide lève là, donc pendant `pnpm build`. Ce cas la rejoue, et la
    // garde d'inertie interdit qu'un dossier vide le rende vrai sur rien.
    //
    // L'attente est **dérivée de l'état du module**, jamais concédée : coupé,
    // le catalogue doit être vide ; monté, il doit porter des articles. Une
    // attente unique serait fausse dans l'une des deux configurations, et
    // `pnpm test:minimal-profile` coupe précisément ce module.
    const { blogCatalog } = await import('../apps/web/lib/blog')

    if (blogCatalog.index === null) {
      expect(blogCatalog.articles).toEqual([])

      return
    }

    expect(blogCatalog.articles.length).toBeGreaterThan(0)
  })
})

describe('le blog n’injecte jamais de balisage brut', () => {
  const sourcesUnder = (directory: string): readonly string[] => {
    const found: string[] = []

    const walk = (current: string): void => {
      for (const name of readdirSync(current)) {
        if (name === 'node_modules' || name === '.turbo') {
          continue
        }

        const path = join(current, name)

        if (statSync(path).isDirectory()) {
          walk(path)
        } else if (/\.tsx?$/.test(path)) {
          found.push(path)
        }
      }
    }

    walk(join(REPO_ROOT, directory))

    return found
  }

  /** Le module, plus les fichiers de l'application qui rendent son contenu. */
  const SOURCES = [
    ...sourcesUnder('packages/modules/blog/src'),
    ...sourcesUnder('apps/web/app/blog'),
    join(REPO_ROOT, 'apps/web/lib/blog.ts'),
    join(REPO_ROOT, 'apps/web/lib/blog-body.tsx'),
  ]

  it('balaie réellement ces fichiers, faute de quoi ce cas ne vérifie rien', () => {
    expect(SOURCES.length).toBeGreaterThan(8)
  })

  it('n’emploie `dangerouslySetInnerHTML` nulle part', () => {
    // Le précédent est écrit dans
    // `packages/modules/marketing/src/presentation/legal-document.tsx` : « un
    // document qui aurait besoin de mise en forme riche est une décision de
    // story, pas un contournement ». s29 est cette décision, et elle consiste à
    // choisir la famille qui n'en a pas besoin (ADR 053) — pas à lever
    // l'interdit.
    // Les commentaires sont retirés avant le balayage : ce fichier-ci et les
    // règles du module **nomment** l'interdit, et un balayage naïf compterait
    // la règle comme sa violation.
    const withoutComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1')

    const offenders = SOURCES.filter((file) =>
      withoutComments(readFileSync(file, 'utf8')).includes('dangerouslySetInnerHTML'),
    ).map((file) => file.slice(REPO_ROOT.length))

    expect(offenders, offenders.join(', ')).toEqual([])
  })
})

/* ------------------------------------------------------------------------- *
 * Le flux RSS (s53).
 *
 * Il est servi par une **route du module**, donc par le répartiteur : c'est ce
 * qui rend « module coupé, aucun flux » dérivé plutôt que conditionnel. Ce que
 * ce bloc mesure et qu'aucune assertion maison ne pourrait prouver : que le
 * document est **analysé par un analyseur de flux tiers**
 * (`@rowanmanning/feed-parser`), y compris sur un titre portant `&`, `<` et des
 * guillemets — l'échappement est la seule chose qu'une bibliothèque de
 * génération ferait à notre place.
 *
 * **Ce n'est pas une validation**, et un cas plus bas le mesure : l'analyseur se
 * dit *resilient*, il lève sur un non-flux mais accepte un `<channel>` sans
 * titre ni lien ni description. La conformité au format se lit dans la
 * spécification — c'est par là qu'est passé `dc:creator`.
 * ------------------------------------------------------------------------- */

const HOSTILE = {
  ...ARTICLE,
  slug: 'titre-hostile',
  title: 'Tests & « pièges » : <script> compris',
  description: 'Une description avec un & et un <chevron>.',
  date: '2026-03-02',
} as const

const feedRequest = (query = ''): Request =>
  new Request(`https://app.test${blogFeedPath()}${query}`, { method: 'GET' })

/** Le contenu que le point de composition fournirait, sans disque ni `APP_URL`. */
const provideCatalog = (catalog: BlogCatalog): void => {
  provideBlogContent(() => ({
    catalog,
    locales: [...localeRouting.locales],
    defaultLocale: localeRouting.defaultLocale,
    url: (pathname, locale) =>
      `https://app.test${pathname.startsWith('/api') ? pathname : localeRouting.publicPath(pathname, locale)}`,
  }))
}

const feedRegistry = (enabled: readonly string[]) =>
  buildRegistry({
    available: [...availableModules],
    enabled: [...requiredModules, 'i18n', ...enabled],
    required: [...requiredModules],
    locales: [...appLocales],
  })

const servedFeed = async (
  registry: ReturnType<typeof buildRegistry>,
  query = '',
): Promise<Response> => await dispatchAllowingRateLimit(registry, feedRequest(query))

describe('le flux du blog', () => {
  it('est un flux que lit un analyseur de flux, et il porte les articles', async () => {
    provideCatalog(
      resolveBlogCatalog({ articles: [ARTICLE, HOSTILE, TAGGED], pageSize: 6 }),
    )

    const response = await servedFeed(feedRegistry(['blog']))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/rss+xml')

    // La validation est faite par une bibliothèque tierce : elle **lève** sur
    // un document qui n'est pas un flux, et c'est ce qui remplace une
    // assertion maison sur le texte produit.
    const feed = parseFeed(await response.text())

    // Le titre vient du catalogue **du module**, pas de celui de l'application :
    // celui-ci disparaît avec le module, et `pnpm test:minimal-profile` le coupe.
    expect(feed.title).toBe(blogModule.messages[defaultLocale]?.['list.title'])
    expect(feed.items.map((item) => item.title)).toEqual([
      // Du plus récent au plus ancien : un lecteur affiche le document tel
      // qu'il le reçoit.
      HOSTILE.title,
      ARTICLE.title,
      TAGGED.title,
    ])

    const [first] = feed.items

    expect(first?.url).toBe(
      `https://app.test${localeRouting.publicPath(`/blog/${HOSTILE.slug}`, defaultLocale)}`,
    )
    expect(first?.description).toBe(HOSTILE.description)
    expect(first?.published?.toISOString().slice(0, 10)).toBe(HOSTILE.date)
  })

  it('ne sert que la langue demandée, et retombe sur celle du site sinon', async () => {
    const other = { ...ARTICLE, slug: 'seulement-ailleurs', locale: OTHER_LOCALE }

    provideCatalog(resolveBlogCatalog({ articles: [ARTICLE, other], pageSize: 6 }))

    const registry = feedRegistry(['blog'])
    const urlsOf = async (query: string) =>
      parseFeed(await (await servedFeed(registry, query)).text()).items.map((item) => item.url)
    const absolute = (slug: string, locale: string) =>
      `https://app.test${localeRouting.publicPath(`/blog/${slug}`, locale)}`

    // Une langue que l'application ne **sert** pas n'entre ni dans le document,
    // ni dans les URL : elle est ignorée, pas crue.
    expect(await urlsOf('?locale=../../etc')).toEqual([absolute(ARTICLE.slug, defaultLocale)])

    // L'attente est **dérivée des langues servies** : module `i18n` coupé,
    // l'application n'en sert qu'une et la seconde retombe elle aussi sur le
    // flux du site. C'est la configuration de `pnpm test:minimal-profile`.
    expect(await urlsOf(`?locale=${OTHER_LOCALE}`)).toEqual(
      localeRouting.locales.includes(OTHER_LOCALE)
        ? [absolute(other.slug, OTHER_LOCALE)]
        : [absolute(ARTICLE.slug, defaultLocale)],
    )
  })

  it('ne contribue aucune URL quand le catalogue n’est pas monté', () => {
    // La garde qui **reste** dans le module, et le cas qui la fait mordre : un
    // registre construit avec le blog activé au-dessus d'un dépôt qui le coupe
    // — ce que `pnpm test:socle` et `pnpm test:minimal-profile` produisent —
    // demanderait sa contribution avec un catalogue vide. Sans la garde, il
    // annoncerait `/blog`, c'est-à-dire une page qui répond 404.
    const context = { locales: [...appLocales], defaultLocale }

    provideCatalog(EMPTY_BLOG_CATALOG)
    expect(blogModule.publicUrls(context)).toEqual([])

    // Garde d'inertie : monté, il contribue bel et bien.
    provideCatalog(resolveBlogCatalog({ articles: [ARTICLE], pageSize: 6 }))
    expect(blogModule.publicUrls(context).map((url) => url.path)).toEqual([
      '/blog',
      `/blog/${ARTICLE.slug}`,
    ])
  })

  it('nomme l’auteur en `dc:creator`, jamais dans un `<author>` sans adresse', async () => {
    provideCatalog(resolveBlogCatalog({ articles: [ARTICLE], pageSize: 6 }))

    const body = await (await servedFeed(feedRegistry(['blog']))).text()

    // RSS 2.0 définit `<item><author>` comme **l'adresse email** de l'auteur
    // (`<author>lawyer@boyer.net (Lawyer Boyer)</author>`) : un nom nu y vaut
    // `InvalidContact` au validateur de flux du W3C. Le frontmatter porte un nom
    // d'affichage, jamais une adresse, et le format prévu pour ça est
    // `dc:creator` du Dublin Core — dont l'espace de noms doit être **déclaré**,
    // sans quoi le préfixe ne veut rien dire.
    expect(body).toContain('xmlns:dc="http://purl.org/dc/elements/1.1/"')
    expect(body).toContain(`<dc:creator>${ARTICLE.author}</dc:creator>`)
    expect(body).not.toContain('<author>')

    // Et le document reste un flux que l'analyseur lit, auteur compris.
    expect(parseFeed(body).items.map((item) => item.authors.map((who) => who.name))).toEqual([
      [ARTICLE.author],
    ])
  })

  /**
   * **Ce que l'analyseur prouve, et ce qu'il ne prouve pas.**
   *
   * `@rowanmanning/feed-parser` se décrit lui-même comme *resilient* : il
   * **lève** sur un document qui n'est pas un flux, et il **accepte** des
   * documents qu'un validateur refuserait. Ce cas fixe les deux bords, faute de
   * quoi « analysé par un analyseur tiers » se relirait un jour comme « validé
   * par un validateur » — ce qu'aucune commande de ce dépôt ne vérifie.
   */
  it('mesure la limite de l’analyseur : il rejette un non-flux, il ne valide pas', () => {
    for (const notAFeed of ['<p>bonjour</p>', 'du texte brut', '<rss version="2.0"></rss>']) {
      expect(() => parseFeed(notAFeed), notAFeed).toThrow()
    }

    // Un flux vide de tout ce que RSS 2.0 exige — ni titre, ni lien, ni
    // description, et un article sans rien qu'un identifiant — passe.
    expect(() =>
      parseFeed(
        '<rss version="2.0"><channel><item><guid>x</guid></item></channel></rss>',
      ),
    ).not.toThrow()
  })

  it('répond 404 quand le module est coupé, comme sur un chemin inventé', async () => {
    provideCatalog(EMPTY_BLOG_CATALOG)

    const registry = feedRegistry([])
    const invented = await dispatchAllowingRateLimit(
      registry,
      new Request('https://app.test/api/modules/blog/chemin-invente', { method: 'GET' }),
    )
    const response = await servedFeed(registry)

    expect(response.status).toBe(invented.status)
    expect(await response.text()).toBe(await invented.clone().text())

    // Garde d'inertie : le module **déclare** bien cette route, publique.
    expect(blogModule.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'GET /blog/feed.xml',
    ])
  })
})
