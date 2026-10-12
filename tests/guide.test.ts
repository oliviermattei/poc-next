import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { BUILD_ENV_KEYS, ENV_KEYS } from '@repo/config'

import { cardHref, FEATURE_GRID } from '../apps/guide/lib/feature-grid'
import { i18n } from '../apps/guide/lib/i18n'
import type { Lang } from '../apps/guide/lib/i18n'
import { PLACEHOLDER_MARKER } from '../apps/guide/lib/placeholder'
import { availableModules } from '../config/features'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Les pages du Guide (ADR 083), une arborescence pour toutes les langues. */
const CONTENT = 'apps/guide/content/docs'

/**
 * Les langues du Guide, lues dans sa configuration (`apps/guide/lib/i18n.ts`),
 * jamais recopiées : celle qui fait foi, et ses traductions.
 */
const LANGUAGES: readonly Lang[] = i18n.languages
const DEFAULT_LANGUAGE: Lang = i18n.defaultLanguage
const TRANSLATIONS = LANGUAGES.filter((lang) => lang !== DEFAULT_LANGUAGE)

/**
 * Le suffixe d'un fichier dans une langue — l'analyseur `dot` de Fumadocs :
 * la langue par défaut n'en a pas (`installer.mdx`), une traduction porte le
 * sien (`installer.en.mdx`, `meta.en.json`).
 */
const suffixOf = (lang: Lang): string => (lang === DEFAULT_LANGUAGE ? '' : `.${lang}`)

/**
 * Les planchers des balayages : un dossier déplacé ou une expression qui ne
 * lit plus rien rendrait sinon chaque comparaison vraie sur rien. Ce sont des
 * minimums, pas des comptes : le plan les dépasse largement.
 */
const PAGE_FLOOR = 50
const META_FLOOR = 5
const CARD_LINK_FLOOR = 4
const GRID_DOMAIN_FLOOR = 10
const GRID_CARD_FLOOR = 40

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

/** Le slug d'une page et sa langue, lus sur son nom de fichier. */
const pageOf = (file: string): { slug: string; lang: Lang } | null => {
  if (!file.endsWith('.mdx')) {
    return null
  }

  const stem = file.slice(0, -'.mdx'.length)
  const lang = TRANSLATIONS.find((translation) => stem.endsWith(`.${translation}`))

  return lang
    ? { slug: stem.slice(0, -`.${lang}`.length), lang }
    : { slug: stem, lang: DEFAULT_LANGUAGE }
}

const pageFiles = (): string[] => contentFiles().filter((file) => pageOf(file) !== null)

const pages = (lang: Lang): string[] =>
  contentFiles()
    .map(pageOf)
    .filter((page): page is { slug: string; lang: Lang } => page?.lang === lang)
    .map(({ slug }) => slug)
    .sort()

/** Le texte de chaque page d'une langue, par chemin relatif à `CONTENT`. */
const pagesIn = (lang: Lang): { file: string; text: string }[] =>
  contentFiles()
    .filter((file) => pageOf(file)?.lang === lang)
    .map((file) => ({ file, text: read(CONTENT, file) }))

/** Les dossiers qui portent un fichier d'ordre et de titre dans une langue. */
const metaFiles = (lang: Lang): string[] =>
  contentFiles()
    .filter((file) => file === `meta${suffixOf(lang)}.json` || file.endsWith(`/meta${suffixOf(lang)}.json`))
    .map((file) => file.slice(0, -`meta${suffixOf(lang)}.json`.length))
    .sort()

type Meta = { title?: string; pages?: string[] }

const metaOf = (directory: string, lang: Lang): Meta =>
  JSON.parse(read(CONTENT, `${directory}meta${suffixOf(lang)}.json`)) as Meta

/**
 * Les entrées d'une liste `pages` qui désignent une page ou un dossier :
 * un séparateur (`---Démarrer---`) porte un libellé traduit, il n'a pas de
 * slug à comparer.
 */
const slugEntries = (meta: Meta): string[] =>
  (meta.pages ?? []).filter((entry) => !/^---.*---$/.test(entry))

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Le terme apparaît-il comme un mot entier dans le texte, casse ignorée ? */
const names = (text: string, term: string): boolean =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, 'iu').test(text)

/** Le fichier qui sert une URL du Guide, `null` si aucune page ne lui répond. */
const pageFileFor = (url: string): string | null => {
  const match = new RegExp(
    `^\\/(${LANGUAGES.map(escapeRegExp).join('|')})(?:\\/([^#?]*?))?\\/?(?:[#?].*)?$`,
  ).exec(url)

  if (!match) {
    return null
  }

  const suffix = `${suffixOf(match[1] as Lang)}.mdx`
  const slug = match[2] ?? ''
  const candidates =
    slug === '' ? [`index${suffix}`] : [`${slug}${suffix}`, `${slug}/index${suffix}`]

  return candidates.find((candidate) => existsSync(join(REPO_ROOT, CONTENT, candidate))) ?? null
}

/** Le texte MDX sans ses blocs de code : un exemple dans un bloc n'est pas du contenu. */
const proseOf = (mdx: string): string => mdx.replace(/^```[\s\S]*?^```/gm, '')

/** La cible de chaque lien Markdown `[…](…)` d'une page. */
const markdownLinksIn = (mdx: string): string[] =>
  [...proseOf(mdx).matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1] ?? '')

/** La cible de chaque attribut `href="…"` d'une page — les cartes (`<Card href>`). */
const hrefLinksIn = (mdx: string): string[] =>
  [...proseOf(mdx).matchAll(/\bhref=["']([^"']+)["']/g)].map((match) => match[1] ?? '')

/** Un lien qui sort du Guide : il n'a pas de page à trouver ici. */
const isExternal = (link: string): boolean => /^(?:[a-z]+:|#)/i.test(link)

describe('le Guide existe dans chaque langue, page pour page', () => {
  it('lit les langues dans la configuration du Guide', () => {
    expect(LANGUAGES).toContain(DEFAULT_LANGUAGE)
    expect(TRANSLATIONS.length).toBeGreaterThanOrEqual(1)
  })

  it('chaque page de la langue qui fait foi a sa traduction au même slug', () => {
    const original = pages(DEFAULT_LANGUAGE)

    expect(original.length).toBeGreaterThanOrEqual(PAGE_FLOOR)

    for (const lang of TRANSLATIONS) {
      const missing = original.filter((slug) => !pages(lang).includes(slug))
      expect(missing, `pages sans traduction « ${lang} » : ${missing.join(', ')}`).toEqual([])
    }
  })

  it('chaque traduction a son original au même slug', () => {
    for (const lang of TRANSLATIONS) {
      const translated = pages(lang)

      expect(translated.length).toBeGreaterThanOrEqual(PAGE_FLOOR)

      const missing = translated.filter((slug) => !pages(DEFAULT_LANGUAGE).includes(slug))
      expect(missing, `pages « ${lang} » sans original : ${missing.join(', ')}`).toEqual([])
    }
  })

  it('chaque dossier porte son fichier d’ordre dans chaque langue', () => {
    const original = metaFiles(DEFAULT_LANGUAGE)

    expect(original.length).toBeGreaterThanOrEqual(META_FLOOR)

    for (const lang of TRANSLATIONS) {
      expect(metaFiles(lang), `meta${suffixOf(lang)}.json`).toEqual(original)
    }
  })

  it('toutes les langues ordonnent les mêmes pages, dans le même ordre', () => {
    const directories = metaFiles(DEFAULT_LANGUAGE)

    expect(directories.length).toBeGreaterThanOrEqual(META_FLOOR)

    for (const directory of directories) {
      const original = slugEntries(metaOf(directory, DEFAULT_LANGUAGE))

      expect(original.length, `${directory || '(racine)'}meta.json ne liste aucune page`).toBeGreaterThan(0)

      for (const lang of TRANSLATIONS) {
        expect(slugEntries(metaOf(directory, lang)), `${directory}meta${suffixOf(lang)}.json`).toEqual(
          original,
        )
      }
    }
  })

  /**
   * Avec `pages`, Fumadocs masque ce qui n'y figure pas : une page absente de
   * la liste existe sans que personne puisse y naviguer, et une entrée sans
   * fichier ne mène nulle part.
   */
  it('chaque dossier liste chacune de ses pages et de ses sous-dossiers, et rien d’autre', () => {
    const files = contentFiles()
    const directories = metaFiles(DEFAULT_LANGUAGE)

    expect(directories.length).toBeGreaterThanOrEqual(META_FLOOR)

    for (const directory of directories) {
      const listed = [...slugEntries(metaOf(directory, DEFAULT_LANGUAGE))].sort()
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

              return page?.lang === DEFAULT_LANGUAGE ? [page.slug] : []
            }),
        ),
      ].sort()

      expect(listed, `${directory || '(racine)'}meta.json`).toEqual(present)
    }
  })

  /**
   * Une page en attente se reconnaît à `PLACEHOLDER_MARKER` (#203) : toutes
   * sont rédigées, aucune ne doit plus la porter. Le mot-clé de la marque est
   * lu sur la constante, jamais recopié — et cherché seul, pour qu'une
   * variante écrite à la main (une espace de plus) ne passe pas entre les mailles.
   */
  it('aucune page ne porte plus la marque de page en attente', () => {
    const keyword = /[A-Z][A-Z-]+[A-Z]/.exec(PLACEHOLDER_MARKER)?.[0] ?? ''
    const files = pageFiles()

    expect(keyword.length).toBeGreaterThanOrEqual(5)
    expect(files.length).toBeGreaterThanOrEqual(LANGUAGES.length * PAGE_FLOOR)

    const waiting = files.filter((file) => read(CONTENT, file).includes(keyword))
    expect(waiting, `pages encore en attente : ${waiting.join(', ')}`).toEqual([])
  })

  it('chaque page déclare un titre et une description dans chaque langue', () => {
    const files = pageFiles()

    expect(files.length).toBeGreaterThanOrEqual(LANGUAGES.length * PAGE_FLOOR)

    for (const file of files) {
      const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(read(CONTENT, file))?.[1] ?? ''

      expect(frontmatter, `${file} n'a pas de titre`).toMatch(/^title: \S/m)
      expect(frontmatter, `${file} n'a pas de description`).toMatch(/^description: \S/m)
    }
  })
})

/**
 * La table des modules livrés (`fonctionnalites/index`) : une ligne par
 * module, son identifiant `entre accents graves` en première cellule et le
 * lien vers sa page en dernière.
 */
const moduleTableOf = (mdx: string): Map<string, string> =>
  new Map(
    [...mdx.matchAll(/^\| `([^`]+)` \|.*\]\((\/[^)\s]+)\)\s*\|\s*$/gm)].map(
      (match) => [match[1] ?? '', match[2] ?? ''] as const,
    ),
  )

/**
 * L'exhaustivité du Guide est mesurée, pas affirmée (#203) : chaque liste est
 * dérivée du code — registre, schéma d'environnement, dossier `config/`,
 * scripts de la racine —, jamais recopiée, et l'échec nomme ce qui manque.
 * Chaque langue est mesurée : une traduction n'est pas dispensée d'exhaustivité.
 */
describe('le Guide nomme tout ce que le code livre', () => {
  it('lit la table des modules : identifiant en première cellule, page en dernière', () => {
    const table = moduleTableOf(
      [
        '| Identifiant | Ce qu’il apporte | Page |',
        '|---|---|---|',
        '| `docs` | la documentation, sous `/docs` | [Documentation](/fr/fonctionnalites/documentation-produit) |',
        '| un `jobs` cité en passant | — | [Ailleurs](/fr/ailleurs) |',
      ].join('\n'),
    )

    expect([...table]).toEqual([['docs', '/fr/fonctionnalites/documentation-produit']])
  })

  /**
   * Un identifiant court (`docs`, `jobs`, `i18n`) se trouve partout entre
   * accents graves — `/docs`, un dossier, une commande. Il est donc cherché
   * là où il désigne le module et rien d'autre : sa ligne dans la table des
   * modules, puis la page vers laquelle cette ligne mène.
   */
  it('chaque module de l’annuaire a sa ligne dans la table des modules, et sa page le nomme', () => {
    const ids = availableModules.map((module) => module.id)

    expect(ids.length).toBeGreaterThanOrEqual(15)

    for (const lang of LANGUAGES) {
      const table = moduleTableOf(read(CONTENT, `fonctionnalites/index${suffixOf(lang)}.mdx`))

      expect(table.size, `table des modules (${lang})`).toBeGreaterThanOrEqual(ids.length)

      const faults = ids.flatMap((id) => {
        const link = table.get(id)

        if (link === undefined) {
          return [`${id} : aucune ligne`]
        }

        const file = link.startsWith(`/${lang}/`) ? pageFileFor(link) : null

        if (file === null) {
          return [`${id} : ${link} ne mène à aucune page « ${lang} »`]
        }

        return read(CONTENT, file).includes(`\`${id}\``) ? [] : [`${id} : ${file} ne le nomme pas`]
      })
      expect(faults, `modules mal décrits (${lang}) :\n${faults.join('\n')}`).toEqual([])
    }
  })

  /**
   * Les clés du schéma d'environnement et celles de la garde de build : ce
   * que l'application lit. La page des variables les nomme toutes, `entre
   * accents graves`, dans chaque langue, pour qu'une variable ajoutée au
   * schéma force sa ligne.
   */
  it('chaque variable lue par l’application est nommée dans la page des variables', () => {
    const keys = [...ENV_KEYS, ...BUILD_ENV_KEYS]

    expect(ENV_KEYS.length).toBeGreaterThanOrEqual(30)
    expect(BUILD_ENV_KEYS.length).toBeGreaterThanOrEqual(1)

    for (const lang of LANGUAGES) {
      const page = read(CONTENT, `configurer/variables-d-environnement${suffixOf(lang)}.mdx`)
      const missing = keys.filter((key) => !page.includes(`\`${key}\``))

      expect(missing, `variables absentes de la page des variables (${lang}) : ${missing.join(', ')}`).toEqual(
        [],
      )
    }
  })

  /** `config/` est ce que le propriétaire édite : chacun de ses fichiers a sa page. */
  it('chaque fichier de `config/` est nommé dans une page de chaque langue', () => {
    const files = readdirSync(join(REPO_ROOT, 'config'), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)

    expect(files.length).toBeGreaterThanOrEqual(6)

    for (const lang of LANGUAGES) {
      const texts = pagesIn(lang)

      expect(texts.length).toBeGreaterThanOrEqual(PAGE_FLOOR)

      const missing = files.filter((name) => !texts.some(({ text }) => names(text, name)))
      expect(missing, `fichiers de config/ qu'aucune page « ${lang} » ne nomme : ${missing.join(', ')}`).toEqual(
        [],
      )
    }
  })

  /**
   * Les scripts de `package.json` à la racine sont les commandes que le
   * propriétaire lance : la page des commandes les nomme tous, sous la forme
   * qu'il tape (`pnpm <script>` ou `pnpm run <script>`). Un nom suivi de `:`
   * ou d'un tiret est un autre script — `pnpm test` n'est pas `pnpm test:e2e`.
   */
  it('chaque script de la racine est nommé dans la page des commandes', () => {
    const scripts = Object.keys(
      (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts,
    )

    expect(scripts.length).toBeGreaterThanOrEqual(10)

    for (const lang of LANGUAGES) {
      const page = read(CONTENT, `reference/commandes${suffixOf(lang)}.mdx`)
      const missing = scripts.filter(
        (script) => !new RegExp(`\\bpnpm (?:run )?${escapeRegExp(script)}(?![\\w:-])`).test(page),
      )

      expect(missing, `scripts absents de la page des commandes (${lang}) : ${missing.join(', ')}`).toEqual(
        [],
      )
    }
  })
})

describe('aucun lien du Guide ne mène nulle part', () => {
  it('lit un lien sous ses deux formes, et ignore les blocs de code', () => {
    expect(markdownLinksIn('voir [ici](/fr/a) et <Card href="/fr/b" />')).toEqual(['/fr/a'])
    expect(hrefLinksIn('voir [ici](/fr/a) et <Card href="/fr/b" />')).toEqual(['/fr/b'])
    expect(markdownLinksIn('```md\n[exemple](/fr/rien)\n```\n')).toEqual([])
  })

  it('résout une URL vers la page qui la sert, dans sa langue', () => {
    expect(pageFileFor('/fr')).toBe('index.mdx')
    expect(pageFileFor('/en/')).toBe('index.en.mdx')
    expect(pageFileFor('/fr/demarrer/installer/#prerequis')).toBe('demarrer/installer.mdx')
    expect(pageFileFor('/en/fonctionnalites')).toBe('fonctionnalites/index.en.mdx')
    expect(pageFileFor('/fr/nulle-part')).toBeNull()
    expect(pageFileFor('/de/demarrer/installer')).toBeNull()
  })

  /**
   * Les deux formes sont comptées à part, chacune avec son plancher : une
   * expression qui ne lirait plus les cartes passerait sinon inaperçue sous
   * les centaines de liens Markdown.
   */
  it('chaque lien interne d’une page mène à une page existante, dans la langue de la page', () => {
    const files = pageFiles()
    const linksOf = (extract: (mdx: string) => string[]) =>
      files.flatMap((file) =>
        extract(read(CONTENT, file))
          .filter((link) => !isExternal(link))
          .map((link) => ({ file, link, lang: pageOf(file)?.lang })),
      )
    const markdown = linksOf(markdownLinksIn)
    const cards = linksOf(hrefLinksIn)

    // En moyenne, au moins un lien Markdown par page.
    expect(markdown.length).toBeGreaterThanOrEqual(files.length)

    for (const lang of LANGUAGES) {
      expect(
        cards.filter((card) => card.lang === lang).length,
        `cartes de la langue « ${lang} »`,
      ).toBeGreaterThanOrEqual(CARD_LINK_FLOOR)
    }

    const dead = [...markdown, ...cards]
      .filter(({ link, lang }) => !link.startsWith(`/${lang}/`) || pageFileFor(link) === null)
      .map(({ file, link }) => `${file} → ${link}`)
    expect(dead, `liens sans page (ou vers une autre langue) :\n${dead.join('\n')}`).toEqual([])
  })

  it('chaque carte de la grille mène à une page existante, dans chaque langue', () => {
    const cards = FEATURE_GRID.flatMap((domain) =>
      domain.items.map((item) => ({ domain: domain.title[DEFAULT_LANGUAGE], item })),
    )

    expect(FEATURE_GRID.length).toBeGreaterThanOrEqual(GRID_DOMAIN_FLOOR)
    expect(cards.length).toBeGreaterThanOrEqual(GRID_CARD_FLOOR)

    const dead = cards.flatMap(({ domain, item }) =>
      LANGUAGES.map((lang) => cardHref(item, lang))
        .filter((href) => pageFileFor(href) === null)
        .map((href) => `${domain} / ${item.label[DEFAULT_LANGUAGE]} → ${href}`),
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

    expect(soon.length).toBeGreaterThanOrEqual(1)

    const unsourced = soon
      .filter((item) => !('issue' in item) || !Number.isInteger(item.issue) || item.issue <= 0)
      .map((item) => item.label.fr)
    expect(unsourced, `« Bientôt » sans issue : ${unsourced.join(', ')}`).toEqual([])
  })

  it('aucune carte ne nomme un élément du cimetière de `docs/prd.md`', () => {
    // Un titre de section renommé rendrait sinon la vérification vraie sur rien.
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
