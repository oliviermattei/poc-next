import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DocsPageView, docsProseComponents } from '@repo/module-docs/presentation'

import {
  DOCS_PATH,
  EMPTY_DOCS_CATALOG,
  InvalidDocsPageError,
  docsNavigationTree,
  docsPagePath,
  docsPageView,
  docsPublicUrls,
  documentHeadings,
  provideDocsContent,
  readDocsDirectory,
  resetDocsContent,
  resolveDocsCatalog,
} from '@repo/module-docs'

/**
 * Le câblage de la documentation : ce qui ne veut rien dire sans le disque, le
 * registre ou le point de composition de l'application.
 *
 * Les règles, elles, sont éprouvées dans le module — `domain/docs-page.test.ts`
 * pour le frontmatter et les titres, `application/docs-catalog.test.ts` pour
 * l'arbre et le repli. Ce fichier porte **la lecture du dossier** (elle n'a de
 * sens qu'avec un vrai système de fichiers) et le contenu réellement livré.
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const CONTENT = join(REPO_ROOT, 'content/docs')

const LOCALES = ['fr', 'en'] as const

const tree = (directory: string, locales: readonly string[] = LOCALES) =>
  readDocsDirectory({ directory, locales, knownLocales: [...LOCALES] })

/** Un dossier de documentation jetable, écrit fichier par fichier. */
const scratch = (files: Readonly<Record<string, string>>): string => {
  const root = mkdtempSync(join(tmpdir(), 'docs-'))

  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)

    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }

  return root
}

const PAGE = (title: string, order: number) =>
  `---\ntitle: ${title}\ndescription: ${title}\norder: ${order}\n---\n\n## Un titre\n`

describe('la lecture du dossier de documentation', () => {
  it('lit les sections et les pages de chaque langue servie', () => {
    const { pages, sections } = tree(
      scratch({
        'fr/guide/section.json': '{"title": "Guide", "order": 1}',
        'fr/guide/a.mdx': PAGE('A', 1),
        'en/guide/section.json': '{"title": "Handbook", "order": 1}',
        'en/guide/a.mdx': PAGE('A', 1),
      }),
    )

    expect(sections.map((section) => [section.locale, section.title])).toEqual([
      ['fr', 'Guide'],
      ['en', 'Handbook'],
    ])
    expect(pages.map((page) => `${page.locale}:${page.section}/${page.slug}`)).toEqual([
      'fr:guide/a',
      'en:guide/a',
    ])
  })

  it('ignore une langue que l’application ne sert pas, sans la refuser', () => {
    // `en` quand le module `i18n` est coupé : les pages restent sur le disque
    // sans être servies. C'est le piège que `config/i18n.ts:5-7` documente.
    const { pages } = tree(
      scratch({
        'fr/guide/section.json': '{"title": "Guide", "order": 1}',
        'fr/guide/a.mdx': PAGE('A', 1),
        'en/guide/section.json': '{"title": "Handbook", "order": 1}',
        'en/guide/a.mdx': PAGE('A', 1),
      }),
      ['fr'],
    )

    expect(pages.map((page) => page.locale)).toEqual(['fr'])
  })

  it('refuse un dossier que personne ne servira jamais, en le nommant', () => {
    expect(() =>
      tree(scratch({ 'de/guide/section.json': '{"title": "Handbuch", "order": 1}' })),
    ).toThrow(/de/)
  })

  it('refuse une page posée à la racine d’une langue', () => {
    // Elle n'appartiendrait à aucune section : ni place dans la navigation, ni
    // fil d'Ariane, et son URL ne se distinguerait pas de celle d'une section.
    expect(() => tree(scratch({ 'fr/orpheline.mdx': PAGE('Orpheline', 1) }))).toThrow(
      /orpheline\.mdx/,
    )
  })

  it('refuse un nom de section ou de page qui ne peut pas devenir une URL', () => {
    expect(() =>
      tree(scratch({ 'fr/Prise En Main/section.json': '{"title": "x", "order": 1}' })),
    ).toThrow(InvalidDocsPageError)
    expect(() =>
      tree(
        scratch({
          'fr/guide/section.json': '{"title": "Guide", "order": 1}',
          'fr/guide/Une Page.mdx': PAGE('x', 1),
        }),
      ),
    ).toThrow(/Une Page\.mdx/)
  })

  it('nomme le fichier fautif quand un frontmatter est cassé', () => {
    // C'est ce qui fait échouer `pnpm build` de façon actionnable : le
    // catalogue est lu au chargement du point de composition.
    expect(() =>
      tree(
        scratch({
          'fr/guide/section.json': '{"title": "Guide", "order": 1}',
          'fr/guide/cassee.mdx': '---\ntitle: Sans ordre\ndescription: x\n---\n',
        }),
      ),
    ).toThrow(/cassee\.mdx/)
  })

  it('rend un dossier absent comme une documentation vide, pas comme une panne', () => {
    expect(tree(join(tmpdir(), 'docs-inexistant')).pages).toEqual([])
  })
})

describe('la documentation livrée avec le dépôt', () => {
  const catalog = resolveDocsCatalog({ ...tree(CONTENT), defaultLocale: 'fr' })

  it('porte au moins deux sections, sans que rien ne les inscrive', () => {
    // Le critère 1 : l'arborescence **est** la navigation. Une seule section
    // rendrait l'ordre des sections invérifiable.
    expect(docsNavigationTree(catalog, 'fr').length).toBeGreaterThanOrEqual(2)
  })

  it('porte une page non traduite, sans laquelle l’état « repli » n’existe nulle part', () => {
    // Cet état est le seul écran de la story qu'aucun test unitaire ne décrit,
    // et il n'est atteignable que s'il existe une page de ce genre dans le
    // contenu livré. Un contenu entièrement traduit rendrait le parcours vert
    // en ne traversant jamais le repli.
    const french = catalog.pages.filter((page) => page.locale === 'fr')
    const english = new Set(
      catalog.pages
        .filter((page) => page.locale === 'en')
        .map((page) => `${page.section}/${page.slug}`),
    )

    expect(french.some((page) => !english.has(`${page.section}/${page.slug}`))).toBe(true)
  })

  it('ne laisse aucun `loading.tsx` sur le chemin de la documentation', () => {
    /*
     * Mesuré en s29 sur trois placements : la coquille est vidée avant que la
     * page ne décide, si bien qu'un `notFound()` arrive en **HTTP 200**. Le 404
     * est une règle du socle de sécurité (`docs/security.md` §3), et une page
     * de documentation inexistante doit le rendre.
     *
     * La liste est **dérivée** de l'arbre versionné, jamais écrite : un
     * `loading.tsx` déposé demain sous `app/` fait rougir cette ligne.
     */
    const files = execFileSync('git', ['ls-files', '--', 'apps/web/app'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((path) => path.endsWith('/loading.tsx'))

    expect(files).toEqual([])
  })

  it('dérive le chemin d’une page de sa place dans l’arbre', () => {
    const first = docsNavigationTree(catalog, 'fr')[0]?.pages[0]

    expect(first?.href).toBe(docsPagePath(first?.section ?? '', first?.slug ?? ''))
    expect(first?.href.startsWith(`${DOCS_PATH}/`)).toBe(true)
  })
})

/* ------------------------------------------------------------------------- *
 * L'écran, rendu.
 *
 * Ce qui se prouve ici est ce qu'un test de composant ne peut pas prouver
 * ailleurs : que le **sommaire dérivé de la source** et les **ancres posées au
 * rendu** désignent les mêmes fragments. Ce sont deux passes différentes, sur
 * deux représentations différentes de la même page, et rien à l'écran ne
 * signale leur désaccord — un `href="#inconnu"` ne casse pas, il ne fait rien.
 * ------------------------------------------------------------------------- */

const catalog = resolveDocsCatalog({ ...tree(CONTENT), defaultLocale: 'fr' })
const shipped = docsNavigationTree(catalog, 'fr')

/** Un traducteur qui rend sa clé : ce fichier ne juge pas les textes, `tests/rendered-text.test.ts` le fait. */
const intl = { t: (key: string) => key, path: (pathname: string) => pathname }

const renderPage = async (locale: string, section: string, slug: string): Promise<string> => {
  const resolved = docsPageView(catalog, { locale, section, slug })

  if (resolved === null) {
    throw new Error(`Page absente de l’arbre : ${section}/${slug}`)
  }

  const loaded = (await import(
    `../content/docs/${resolved.page.locale}/${resolved.page.section}/${resolved.page.slug}.mdx`
  )) as { readonly default: (props: { readonly components?: unknown }) => ReactNode }

  return renderToStaticMarkup(
    DocsPageView({
      tree: docsNavigationTree(catalog, locale),
      page: resolved.page,
      translated: resolved.translated,
      intl,
      children: loaded.default({ components: docsProseComponents }),
    }) as ReactElement,
  )
}

describe('la page rendue', () => {
  const FIRST = shipped[0]?.pages[0]

  it('pointe chaque entrée de sommaire vers une ancre que la page rend vraiment', async () => {
    /*
     * **Le point où tout peut être faux, et il l'a été.** Le sommaire est dérivé
     * de la **source** Markdown ; les `id` sont posés au **rendu**, sur un arbre
     * où le balisage en ligne a disparu. Un titre portant du code en ligne au
     * milieu donnait « a-b-c » d'un côté et « abc » de l'autre, et rien à
     * l'écran ne le disait — un fragment inconnu ne casse pas, il ne fait rien.
     *
     * **Toutes** les pages livrées, pas seulement la première : la divergence
     * dépend de ce que chaque page écrit dans ses titres.
     */
    let anchors = 0

    for (const section of shipped) {
      for (const entry of section.pages) {
        const html = await renderPage('fr', entry.section, entry.slug)
        const found = [...html.matchAll(/href="#([^"]+)"/g)].map((match) => match[1] ?? '')
        const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1] ?? ''))

        anchors += found.length
        expect(found.filter((anchor) => !ids.has(anchor)), entry.href).toEqual([])
      }
    }

    // Garde contre l'inertie : des pages sans titre rendraient la boucle vraie
    // sur zéro ancre, et c'est exactement l'état qu'on veut interdire.
    expect(anchors).toBeGreaterThan(5)
  })

  it('ne pose d’ancre que sur les niveaux dont le sommaire dérive', () => {
    /*
     * **Le niveau 1 n'a pas d'ancre, et les deux passes doivent s'accorder
     * là-dessus.** `documentHeadings` ignore `#` — le titre de la page est celui
     * du frontmatter —, si bien qu'aucune entrée de sommaire ne nomme jamais
     * l'ancre d'un `#`. Tant que le rendu en posait une quand même, un corps
     * portant `# Options` et `### Options` livrait **deux fois** `id="options"`
     * dans le DOM, et le lien du sommaire tombait sur le premier — celui qu'il
     * ne nomme pas. Le refus de `parseDocsPage`, lui, ne voit pas ce cas :
     * il compte les ancres du sommaire, où le `#` ne figure pas.
     */
    const headings = documentHeadings('# Options\n\n### Options\n')
    const html = renderToStaticMarkup(
      createElement(
        'div',
        null,
        createElement(docsProseComponents.h1, { children: 'Options' }),
        createElement(docsProseComponents.h3, { children: 'Options' }),
      ),
    )
    const anchored = [...html.matchAll(/<(h[1-6])\b[^>]*\bid="([^"]+)"/g)].map(
      (match) => `${match[1] ?? ''}#${match[2] ?? ''}`,
    )

    expect(headings.map((heading) => heading.id)).toEqual(['options'])
    expect(anchored).toEqual(['h3#options'])
  })

  it('marque la page servie dans la navigation latérale, et une seule', async () => {
    const html = await renderPage('fr', FIRST?.section ?? '', FIRST?.slug ?? '')
    /*
     * `aria-current="page"` porte la distinction pour une aide technique : la
     * couleur ne lui dit rien, et s49 a de toute façon écarté les couleurs
     * sémantiques. **Sur les liens seulement** : le fil d'Ariane en porte un
     * aussi, sur un `<span>`, et c'est correct — deux conteneurs différents,
     * une position courante dans chacun.
     *
     * Une seule, et sur la bonne : une comparaison sur le seul slug en
     * marquerait deux le jour où deux sections porteront une page du même nom.
     */
    const current = [...html.matchAll(/<a\b[^>]*>/g)]
      .map((match) => match[0])
      .filter((tag) => tag.includes('aria-current="page"'))

    expect(current).toHaveLength(1)
    expect(current[0]).toContain(`href="${FIRST?.href ?? ''}"`)
  })

  it('rend l’arbre entier, pas seulement la section servie', async () => {
    const html = await renderPage('fr', FIRST?.section ?? '', FIRST?.slug ?? '')

    for (const section of shipped) {
      expect(html, section.title).toContain(section.title)
    }
  })

  it('porte la mention quand la page n’est pas traduite, et rien quand elle l’est', async () => {
    /*
     * **L'inverse du blog**, mesuré sur le rendu et pas seulement sur la
     * décision : un article non traduit disparaît, une page de documentation
     * est servie avec sa mention. Le cas « traduite » est là pour que la
     * mention ne soit pas simplement toujours affichée — sans lui, un composant
     * qui l'imprimerait sans condition passerait.
     */
    const untranslated = catalog.pages.find(
      (page) =>
        page.locale === 'fr' &&
        !catalog.pages.some(
          (other) =>
            other.locale === 'en' &&
            other.section === page.section &&
            other.slug === page.slug,
        ),
    )
    const translated = catalog.pages.find(
      (page) =>
        page.locale === 'fr' &&
        catalog.pages.some(
          (other) =>
            other.locale === 'en' && other.section === page.section && other.slug === page.slug,
        ),
    )

    expect(untranslated, 'une page non traduite dans le contenu livré').toBeDefined()
    expect(translated, 'une page traduite dans le contenu livré').toBeDefined()

    const fallback = await renderPage('en', untranslated?.section ?? '', untranslated?.slug ?? '')
    const direct = await renderPage('en', translated?.section ?? '', translated?.slug ?? '')

    expect(fallback).toContain('docs.untranslated.title')
    expect(direct).not.toContain('docs.untranslated.title')
    // Le corps servi est bien celui de la langue par défaut, et il le dit à la
    // synthèse vocale : sans `lang`, un texte français serait prononcé avec la
    // phonétique anglaise.
    expect(fallback).toContain('lang="fr"')
  })
})

describe('ce que la documentation donne à indexer', () => {
  const contribute = (mounted: boolean) => {
    provideDocsContent(() => ({ catalog: mounted ? catalog : EMPTY_DOCS_CATALOG }))

    try {
      return docsPublicUrls({ locales: ['fr', 'en'], defaultLocale: 'fr' })
    } finally {
      resetDocsContent()
    }
  }

  it('annonce la documentation et chacune de ses pages', () => {
    const urls = contribute(true)
    const expected = shipped.flatMap((section) =>
      section.pages.map((page) => docsPagePath(page.section, page.slug)),
    )

    expect(urls.map((url) => url.path)).toEqual([DOCS_PATH, ...expected])
  })

  it('annonce chaque page dans **toutes** les langues servies — l’inverse du blog', () => {
    /*
     * Un article traduit dans une seule langue n'est annoncé que dans celle-là :
     * publier l'autre URL référencerait une page qui répond 404. Une page de
     * documentation non traduite **répond**, elle : l'omettre priverait un
     * moteur d'une URL qui existe.
     */
    expect(contribute(true).every((url) => url.locales.length === 2)).toBe(true)
  })

  it('n’annonce rien quand le module est coupé', () => {
    expect(contribute(false)).toEqual([])
  })
})
