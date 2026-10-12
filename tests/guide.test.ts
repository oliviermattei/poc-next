import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { cardHref, FEATURE_GRID } from '../apps/guide/lib/feature-grid'
import { PLACEHOLDER_MARKER } from '../apps/guide/lib/placeholder'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Les pages du Guide (ADR 083), une arborescence pour les deux langues. */
const CONTENT = 'apps/guide/content/docs'

const read = (...segments: string[]): string =>
  readFileSync(join(REPO_ROOT, ...segments), 'utf8')

/** Les fichiers sous `CONTENT`, chemins relatifs à lui, dérivés du disque. */
const contentFiles = (directory = join(REPO_ROOT, CONTENT)): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)

    return entry.isDirectory()
      ? contentFiles(path)
      : [relative(join(REPO_ROOT, CONTENT), path).split('\\').join('/')]
  })

type Lang = 'fr' | 'en'

/**
 * Le slug d'une page et sa langue, lus sur son nom de fichier : le français
 * fait foi et n'a pas de suffixe (`installer.mdx`), l'anglais porte `.en`
 * (`installer.en.mdx`) — l'analyseur `dot` de Fumadocs.
 */
const pageOf = (file: string): { slug: string; lang: Lang } | null => {
  const match = /^(.+?)(\.en)?\.mdx$/.exec(file)

  return match ? { slug: match[1] ?? '', lang: match[2] ? 'en' : 'fr' } : null
}

const pages = (lang: Lang): string[] =>
  contentFiles()
    .map(pageOf)
    .filter((page): page is { slug: string; lang: Lang } => page?.lang === lang)
    .map(({ slug }) => slug)
    .sort()

/** Les fichiers d'ordre et de titre d'un dossier : `meta.json` et `meta.en.json`. */
const metaFiles = (lang: Lang): string[] =>
  contentFiles()
    .filter((file) => (lang === 'fr' ? /(^|\/)meta\.json$/ : /(^|\/)meta\.en\.json$/).test(file))
    .map((file) => file.replace(/meta(\.en)?\.json$/, ''))
    .sort()

type Meta = { title?: string; pages?: string[] }

const metaOf = (directory: string, lang: Lang): Meta =>
  JSON.parse(read(CONTENT, `${directory}meta${lang === 'en' ? '.en' : ''}.json`)) as Meta

/**
 * Les entrées d'une liste `pages` qui désignent une page ou un dossier :
 * un séparateur (`---Démarrer---`) porte un libellé traduit, il n'a pas de
 * slug à comparer.
 */
const slugEntries = (meta: Meta): string[] =>
  (meta.pages ?? []).filter((entry) => !/^---.*---$/.test(entry))

/**
 * Le plan du Guide compte plus de cinquante pages ; le plancher refuse un
 * balayage vide — un dossier déplacé rendrait sinon chaque comparaison vraie
 * sur rien.
 */
const PAGE_FLOOR = 50

describe('le Guide existe dans les deux langues, page pour page', () => {
  it('chaque page française a sa page anglaise au même slug', () => {
    const french = pages('fr')

    expect(french.length).toBeGreaterThanOrEqual(PAGE_FLOOR)

    const missing = french.filter((slug) => !pages('en').includes(slug))
    expect(missing, `pages sans traduction anglaise : ${missing.join(', ')}`).toEqual([])
  })

  it('chaque page anglaise a sa page française au même slug', () => {
    const english = pages('en')

    expect(english.length).toBeGreaterThanOrEqual(PAGE_FLOOR)

    const missing = english.filter((slug) => !pages('fr').includes(slug))
    expect(missing, `pages anglaises sans original français : ${missing.join(', ')}`).toEqual([])
  })

  it('chaque dossier porte son `meta.json` et son `meta.en.json`', () => {
    const french = metaFiles('fr')

    // La racine et les six parties du plan.
    expect(french.length).toBeGreaterThanOrEqual(7)
    expect(metaFiles('en')).toEqual(french)
  })

  it('les deux langues ordonnent les mêmes pages, dans le même ordre', () => {
    for (const directory of metaFiles('fr')) {
      const french = slugEntries(metaOf(directory, 'fr'))

      expect(french.length, `${directory || '(racine)'}meta.json ne liste aucune page`).toBeGreaterThan(0)
      expect(slugEntries(metaOf(directory, 'en')), `${directory}meta.en.json`).toEqual(french)
    }
  })

  /**
   * Avec `pages`, Fumadocs masque ce qui n'y figure pas : une page absente de
   * la liste existe sans que personne puisse y naviguer, et une entrée sans
   * fichier ne mène nulle part.
   */
  it('chaque dossier liste chacune de ses pages et de ses sous-dossiers, et rien d’autre', () => {
    const files = contentFiles()

    for (const directory of metaFiles('fr')) {
      const listed = [...slugEntries(metaOf(directory, 'fr'))].sort()
      const present = [
        ...new Set(
          files
            .filter((file) => file.startsWith(directory))
            .map((file) => file.slice(directory.length))
            .flatMap((rest) => {
              const [head, ...tail] = rest.split('/')

              if (tail.length > 0) {
                return [head ?? '']
              }

              const page = pageOf(rest)

              return page?.lang === 'fr' ? [page.slug] : []
            }),
        ),
      ].sort()

      expect(listed, `${directory || '(racine)'}meta.json`).toEqual(present)
    }
  })

  /**
   * Une page en attente se reconnaît à une seule chaîne, `PLACEHOLDER_MARKER`.
   * Une variante écrite à la main (une espace de plus, un tiret de moins)
   * échapperait au test qui refusera un jour les pages encore en attente.
   */
  it('une page en attente porte la marque exacte, et une seule fois', () => {
    const waiting = contentFiles()
      .filter((file) => pageOf(file) !== null)
      .filter((file) => read(CONTENT, file).includes('PAGE-EN-ATTENTE'))

    // Les pages de contenu restent à rédiger quand ce cas est écrit.
    expect(waiting.length).toBeGreaterThanOrEqual(1)

    const malformed = waiting.filter(
      (file) => read(CONTENT, file).split(PLACEHOLDER_MARKER).length !== 2,
    )
    expect(malformed, `marque d'attente mal écrite : ${malformed.join(', ')}`).toEqual([])
  })

  it('chaque page déclare un titre et une description dans chaque langue', () => {
    for (const file of contentFiles().filter((path) => pageOf(path) !== null)) {
      const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(read(CONTENT, file))?.[1] ?? ''

      expect(frontmatter, `${file} n'a pas de titre`).toMatch(/^title: \S/m)
      expect(frontmatter, `${file} n'a pas de description`).toMatch(/^description: \S/m)
    }
  })
})

/** Le fichier qui sert une URL du Guide, `null` si aucune page ne lui répond. */
const pageFileFor = (url: string): string | null => {
  const match = /^\/(fr|en)(?:\/([^#?]*?))?\/?(?:[#?].*)?$/.exec(url)

  if (!match) {
    return null
  }

  const suffix = match[1] === 'en' ? '.en.mdx' : '.mdx'
  const slug = match[2] ?? ''
  const candidates =
    slug === '' ? [`index${suffix}`] : [`${slug}${suffix}`, `${slug}/index${suffix}`]

  return candidates.find((candidate) => existsSync(join(REPO_ROOT, CONTENT, candidate))) ?? null
}

/**
 * Les liens d'une page MDX : la cible d'un lien Markdown `[…](…)` et d'un
 * attribut `href="…"`. Les blocs de code sont retirés d'abord : un exemple
 * de lien dans un bloc n'est pas un lien.
 */
const linksIn = (mdx: string): string[] => {
  const prose = mdx.replace(/^```[\s\S]*?^```/gm, '')

  return [
    ...[...prose.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1] ?? ''),
    ...[...prose.matchAll(/\bhref=["']([^"']+)["']/g)].map((match) => match[1] ?? ''),
  ]
}

/** Un lien qui sort du Guide : il n'a pas de page à trouver ici. */
const isExternal = (link: string): boolean => /^(?:[a-z]+:|#)/i.test(link)

describe('aucun lien du Guide ne mène nulle part', () => {
  it('lit un lien sous ses deux formes, et ignore les blocs de code', () => {
    expect(linksIn('voir [ici](/fr/a) et <Card href="/fr/b" />')).toEqual(['/fr/a', '/fr/b'])
    expect(linksIn('```md\n[exemple](/fr/rien)\n```\n')).toEqual([])
  })

  it('résout une URL vers la page qui la sert, dans sa langue', () => {
    expect(pageFileFor('/fr')).toBe('index.mdx')
    expect(pageFileFor('/en/')).toBe('index.en.mdx')
    expect(pageFileFor('/fr/demarrer/installer/#prerequis')).toBe('demarrer/installer.mdx')
    expect(pageFileFor('/en/fonctionnalites')).toBe('fonctionnalites/index.en.mdx')
    expect(pageFileFor('/fr/nulle-part')).toBeNull()
    expect(pageFileFor('/de/demarrer/installer')).toBeNull()
  })

  it('chaque lien interne d’une page mène à une page existante, dans la langue de la page', () => {
    const links = contentFiles()
      .filter((file) => pageOf(file) !== null)
      .flatMap((file) =>
        linksIn(read(CONTENT, file))
          .filter((link) => !isExternal(link))
          .map((link) => ({ file, link, lang: pageOf(file)?.lang })),
      )

    // L'accueil renvoie au moins vers l'installation et la documentation
    // produit, dans chaque langue : sans eux, l'expression ne lit plus rien.
    expect(links.length).toBeGreaterThanOrEqual(4)

    const dead = links
      .filter(({ link, lang }) => !link.startsWith(`/${lang}/`) || pageFileFor(link) === null)
      .map(({ file, link }) => `${file} → ${link}`)
    expect(dead, `liens sans page (ou vers l'autre langue) :\n${dead.join('\n')}`).toEqual([])
  })

  it('chaque carte de la grille mène à une page existante, dans les deux langues', () => {
    const cards = FEATURE_GRID.flatMap((domain) =>
      domain.items.map((item) => ({ domain: domain.title.fr, item })),
    )

    // Le plan de la grille compte seize domaines et plus de cinquante cartes.
    expect(FEATURE_GRID.length).toBeGreaterThanOrEqual(16)
    expect(cards.length).toBeGreaterThanOrEqual(50)

    const dead = cards.flatMap(({ domain, item }) =>
      (['fr', 'en'] as const)
        .map((lang) => cardHref(item, lang))
        .filter((href) => pageFileFor(href) === null)
        .map((href) => `${domain} / ${item.label.fr} → ${href}`),
    )
    expect(dead, `cartes sans page :\n${dead.join('\n')}`).toEqual([])
  })
})

type GraveyardEntry = { title: string; terms: string[] }

/**
 * Les éléments du cimetière de `docs/prd.md`, lus puce par puce : le titre en
 * gras de chaque exclusion, ce qu'il cite entre accents graves, et les noms
 * courts qu'elle énumère — entre parenthèses (`(LemonSqueezy, Polar, …)`) ou
 * après deux-points (`: chatbot, adapters LLM, …`). Une énumération
 * s'arrête à la fin de sa phrase ; ses éléments se coupent sur `,`, `/` et
 * `+`. Ne sont gardés que les noms d'au plus trois mots : une phrase de
 * description (« suppression définitive du code ») n'est pas un nom qu'une
 * carte pourrait porter.
 */
const graveyardOf = (prd: string): GraveyardEntry[] => {
  const start = prd.indexOf('(graveyard)')
  const section = prd.slice(start, prd.indexOf('\n### ', start))

  return [...section.matchAll(/^- \*\*(.+?)\*\*(.*)$/gm)].map((match) => {
    const rawTitle = match[1] ?? ''
    const rest = match[2] ?? ''
    const title = rawTitle.replace(/\s*\(.*?\)/g, '').replace(/[.`]/g, '').trim()
    const listed = [
      ...[...rawTitle.matchAll(/\((.+?)\)/g)].map((inner) => inner[1] ?? ''),
      /^\s*\((.+?)\)/.exec(rest)?.[1] ?? '',
      /^\s*:\s*(.+?)(?:\.\s|\.$|$)/.exec(rest)?.[1] ?? '',
    ]
    const names = [title, ...listed]
      .flatMap((list) => list.split(/[,/+]/))
      .map((name) =>
        name
          .replace(/…/g, '')
          .replace(/^\s*pas de \S+ /, '')
          .trim(),
      )
      .filter((name) => name.length >= 3 && name.split(/\s+/).length <= 3)

    return {
      title,
      terms: [...new Set([...names, ...[...rawTitle.matchAll(/`([^`]+)`/g)].map((code) => code[1] ?? '')])],
    }
  })
}

/** Le terme apparaît-il comme un mot entier dans le texte, casse ignorée ? */
const names = (text: string, term: string): boolean =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`,
    'iu',
  ).test(text)

/**
 * Une exclusion qui porte sur nos **implémentations** (« Secondes
 * implémentations d'adapters ») n'interdit pas le badge Compatible : il dit
 * précisément qu'aucune implémentation de notre part n'existe, et que le
 * service passe par l'interface standard d'un adaptateur livré (MinIO par
 * l'adaptateur S3). Elle interdit Intégré et Bientôt, qui en promettent une.
 */
const excludesImplementationOnly = (entry: GraveyardEntry): boolean =>
  /implémentations?/i.test(entry.title)

describe('la grille est honnête', () => {
  const graveyard = graveyardOf(read('docs/prd.md'))

  it('lit chaque exclusion du cimetière et les noms qu’elle énumère', () => {
    const fixture = [
      '### Explicitly NOT replicated (graveyard)',
      '- **CLI `eject`** (suppression définitive du code, des deps et des tables). Réévaluable.',
      '- **Module AI in-app** : chatbot, adapters LLM, streaming. Seul Supastarter.',
      '- **Multi-ORM** : pas de variante Prisma, pas de variante Nuxt/Vue, pas de monorepo Bun + Elysia. Une stack.',
      '- **Facturation à l’usage (metered/usage-based).** Le seat billing reste.',
      '- **Secondes implémentations d’adapters** (SMTP, MinIO, trigger.dev…). L’interface est livrée.',
      '',
      '### The angle',
    ].join('\n')

    expect(graveyardOf(fixture)).toEqual([
      { title: 'CLI eject', terms: ['CLI eject', 'eject'] },
      { title: 'Module AI in-app', terms: ['Module AI in-app', 'chatbot', 'adapters LLM', 'streaming'] },
      { title: 'Multi-ORM', terms: ['Multi-ORM', 'Prisma', 'Nuxt', 'Vue', 'Bun', 'Elysia'] },
      { title: 'Facturation à l’usage', terms: ['Facturation à l’usage', 'metered', 'usage-based'] },
      {
        title: 'Secondes implémentations d’adapters',
        terms: ['Secondes implémentations d’adapters', 'SMTP', 'MinIO', 'trigger.dev'],
      },
    ])
  })

  it('reconnaît un nom entier, jamais une partie de mot', () => {
    expect(names('Polar et Stripe', 'polar')).toBe(true)
    expect(names('Bipolar', 'Polar')).toBe(false)
    expect(names('trigger.dev', 'trigger.dev')).toBe(true)
    expect(names('triggerXdev', 'trigger.dev')).toBe(false)
  })

  it('chaque carte « Bientôt » cite l’issue qui la suit', () => {
    const soon = FEATURE_GRID.flatMap((domain) => domain.items).filter(
      (item) => item.badge === 'soon',
    )

    // Trois éléments prévus à ce jour : captcha, widget de retour, roadmap.
    expect(soon.length).toBeGreaterThanOrEqual(1)

    const unsourced = soon
      .filter((item) => !('issue' in item) || !Number.isInteger(item.issue) || item.issue <= 0)
      .map((item) => item.label.fr)
    expect(unsourced, `« Bientôt » sans issue : ${unsourced.join(', ')}`).toEqual([])
  })

  it('aucune carte ne nomme un élément du cimetière de `docs/prd.md`', () => {
    // Le cimetière compte une douzaine d'exclusions ; un titre de section
    // renommé rendrait sinon la vérification vraie sur rien.
    expect(graveyard.length).toBeGreaterThanOrEqual(10)
    expect(graveyard.flatMap((entry) => entry.terms).length).toBeGreaterThanOrEqual(25)

    const offending = FEATURE_GRID.flatMap((domain) =>
      domain.items.flatMap((item) =>
        graveyard
          .filter((entry) => !(item.badge === 'compatible' && excludesImplementationOnly(entry)))
          .flatMap((entry) =>
            entry.terms
              .filter((term) =>
                [item.label.fr, item.label.en, item.note?.fr ?? '', item.note?.en ?? ''].some(
                  (text) => names(text, term),
                ),
              )
              .map((term) => `${domain.title.fr} / ${item.label.fr} nomme « ${term} » (${entry.title})`),
          ),
      ),
    )
    expect(offending, `cartes qui nomment le cimetière :\n${offending.join('\n')}`).toEqual([])
  })
})
