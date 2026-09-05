import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

/**
 * Une page de documentation, telle que le reste du module la manipule.
 *
 * `section`, `slug` et `locale` ne viennent **pas** du frontmatter : ils
 * viennent de l'emplacement du fichier
 * (`content/docs/<locale>/<section>/<slug>.mdx`), exactement comme pour un
 * article (s29). Les locales balayées sont celles de **l'application**
 * (`config/i18n.ts`), transmises par le point de composition — jamais celles
 * que ce module déclare au contrat ; `config/i18n.ts:5-7` documente la
 * confusion inverse, qui a déjà coûté un défaut au dépôt.
 *
 * La différence avec le blog est ailleurs, et elle est **inversée** : un article
 * sans traduction disparaît de sa langue, une page de documentation est servie
 * dans la locale par défaut avec une mention. C'est `application/docs-catalog`
 * qui porte cette règle ; ce fichier ne connaît qu'un fichier à la fois.
 */
export interface DocsPage {
  /** Le slug de la section, c'est-à-dire le nom du dossier qui contient la page. */
  readonly section: string
  readonly slug: string
  readonly locale: string
  readonly title: string
  readonly description: string
  /** Rang de la page dans sa section. Deux pages du même rang sont départagées par leur slug. */
  readonly order: number
  /** Les titres du corps, dans l'ordre du document. */
  readonly headings: readonly DocsHeading[]
}

/** Un titre du corps, et l'ancre par laquelle le sommaire le rejoint. */
export interface DocsHeading {
  readonly depth: 2 | 3
  readonly text: string
  readonly id: string
}

/** Ce qu'un dossier de section déclare de lui-même : son titre, et son rang. */
export interface DocsSection {
  readonly section: string
  readonly locale: string
  readonly title: string
  readonly order: number
}

/**
 * Le refus d'une page ou d'une section, **nommant le fichier**.
 *
 * Le frontmatter est lu à l'amorçage, donc pendant `pnpm build` : un message qui
 * dirait seulement « champ requis » obligerait l'auteur à ouvrir les pages une
 * par une.
 */
export class InvalidDocsPageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidDocsPageError'
  }
}

const refuse = (filePath: string, reason: string): never => {
  throw new InvalidDocsPageError(`Documentation refusée — ${filePath} : ${reason}`)
}

/**
 * Le frontmatter d'une page, au complet et **fermé**.
 *
 * `strict()` refuse une clé inconnue, et c'est le cas qui compte le plus : une
 * faute de frappe (`titre:` pour `title:`) sur un schéma ouvert produirait une
 * page dont le titre manque, sans que rien ne le dise.
 */
const pageFrontmatterSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().min(1),
    order: z.number().int(),
  })
  .strict()

/** Le type que le frontmatter déclare — dérivé du schéma, jamais recopié. */
export type DocsPageFrontmatter = z.infer<typeof pageFrontmatterSchema>

/** Le manifeste d'une section, au complet et fermé, pour la même raison. */
const sectionSchema = z.object({ title: z.string().min(1), order: z.number().int() }).strict()

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/

export interface ParseDocsPageInput {
  /** Le contenu brut du fichier `.mdx`, frontmatter compris. */
  readonly source: string
  /** Le chemin du fichier, tel qu'il sera **nommé** dans le refus. */
  readonly filePath: string
  readonly section: string
  readonly slug: string
  readonly locale: string
}

/**
 * Valide le frontmatter d'une page et rend la page, titres du corps compris.
 *
 * Pure : elle ne lit aucun fichier, ne connaît ni Next, ni MDX. Le corps ne la
 * traverse que sous forme de texte — il est compilé par le bundler (ADR 053), et
 * cette fonction n'en tire que la table des titres.
 */
export function parseDocsPage({
  source,
  filePath,
  section,
  slug,
  locale,
}: ParseDocsPageInput): DocsPage {
  const matched = FRONTMATTER.exec(source)

  if (matched === null) {
    return refuse(filePath, 'aucun bloc de frontmatter « --- » en tête du fichier')
  }

  let raw: unknown

  try {
    raw = parseYaml(matched[1] ?? '')
  } catch (error) {
    return refuse(filePath, `frontmatter YAML illisible : ${(error as Error).message}`)
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return refuse(filePath, 'le frontmatter doit être un ensemble de clés')
  }

  const parsed = pageFrontmatterSchema.safeParse(raw)

  if (!parsed.success) {
    return refuse(filePath, issuesOf(parsed.error))
  }

  const headings = documentHeadings(source.slice(matched[0].length))
  const duplicated = headings
    .map((heading) => heading.id)
    .find((id, index, ids) => ids.indexOf(id) !== index)

  if (duplicated !== undefined) {
    return refuse(
      filePath,
      `deux titres produisent la même ancre « #${duplicated} ». Le second serait ` +
        'inatteignable, et le sommaire pointerait vers le premier.',
    )
  }

  return { section, slug, locale, ...parsed.data, headings }
}

const issuesOf = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `« ${issue.path.join('.') || '(racine)'} » ${issue.message}`)
    .join(' ; ')

export interface ParseDocsSectionInput {
  readonly source: string
  readonly filePath: string
  readonly section: string
  readonly locale: string
}

/**
 * Valide le manifeste d'une section (`section.json`) et rend la section.
 *
 * Le titre d'une section est **traduit**, donc il vit à côté des pages de sa
 * langue et pas dans le catalogue de messages du module : une section ajoutée
 * est un dossier déposé, sans inscription ailleurs.
 */
export function parseDocsSection({
  source,
  filePath,
  section,
  locale,
}: ParseDocsSectionInput): DocsSection {
  let raw: unknown

  try {
    raw = JSON.parse(source)
  } catch (error) {
    return refuse(filePath, `manifeste JSON illisible : ${(error as Error).message}`)
  }

  const parsed = sectionSchema.safeParse(raw)

  if (!parsed.success) {
    return refuse(filePath, issuesOf(parsed.error))
  }

  return { section, locale, ...parsed.data }
}

/**
 * L'ancre d'un titre, dérivée de son texte.
 *
 * Les accents sont décomposés puis retirés (`NFD`), la ponctuation devient un
 * tiret : `#prerequis-node-20` reste lisible dans la barre d'adresse, là où un
 * fragment encodé (`#Pr%C3%A9requis`) ne l'est plus.
 *
 * **Un texte sans caractère utilisable rend quand même une ancre** : un `id`
 * vide n'est pas une ancre, `#` ramène en haut de la page et le sommaire
 * mentirait.
 */
export function headingAnchor(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug === '' ? 'titre' : slug
}

const HEADING = /^(#{2,3})\s+(.+?)\s*#*\s*$/
const FENCE = /^\s*(```|~~~)/

/**
 * Le texte d'un titre **tel qu'il s'affichera**, son balisage en ligne retiré.
 *
 * Deux raisons, et la première est celle qu'on voit. Sans ce retrait, le
 * sommaire affiche ses accents graves — « Le contrat de \`module\` », constaté au
 * navigateur.
 *
 * La seconde est plus étroite qu'il n'y paraît, et elle est mesurée : l'ancre du
 * sommaire est dérivée de la **source** quand l'`id` du titre est dérivé du
 * **rendu**, où le balisage a disparu. `headingAnchor` réduisant toute
 * ponctuation à un tiret puis fusionnant, un balisage **séparé par des espaces**
 * donne la même ancre des deux côtés, retiré ou non ; la divergence n'apparaît
 * que quand le balisage **touche un mot** — `` `ModuleRoute`s `` vaut
 * « moduleroute-s » depuis la source et « moduleroutes » depuis le rendu. Deux
 * fragments, un lien mort, et rien à l'écran pour le dire : un fragment inconnu
 * ne casse pas, il ne fait rien. `docs-page.test.ts` porte ce cas-là, et il est
 * le seul à rougir quand ce retrait disparaît.
 *
 * **Ce qui est retiré, et rien de plus** : le libellé d'un lien, le gras,
 * l'italique et le code en ligne. Une image ou un balisage plus riche dans un
 * titre divergeraient encore, et `tests/docs.test.ts` — qui confronte les
 * ancres du sommaire aux `id` réellement rendus — rougirait en le disant.
 */
const inlineText = (markdown: string): string =>
  markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(?<![*\w])\*([^*]+)\*(?![*\w])/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim()

/**
 * Les titres de niveau 2 et 3 d'un corps Markdown, dans l'ordre du document.
 *
 * **Le niveau 1 est ignoré** : le titre de la page est celui du frontmatter, et
 * la vue le rend en `<h1>`. Un `#` en tête de corps produirait un second `h1`,
 * ce qu'aucun lecteur d'écran ne sait interpréter — c'est déjà la raison pour
 * laquelle l'échelle de prose rend `h1` en `<h2>`. **Elle ne lui pose pas
 * d'ancre non plus**, et les deux vont ensemble : une ancre qu'aucune entrée de
 * sommaire ne nomme ne peut que doubler celle d'un `##` de même texte.
 *
 * **Les blocs de code sont sautés.** Un `# commentaire` dans un extrait de shell
 * est la faute la plus probable, et elle produirait une entrée de sommaire vers
 * un fragment que la page ne rend pas.
 *
 * **Les ancres ne sont pas dédoublonnées ici, et c'est délibéré** :
 * `parseDocsPage` refuse la page qui en produirait deux identiques. Le sommaire
 * est dérivé de cette source, les `id` sont posés au rendu par
 * `createProseComponents`, et les deux passes ne comptent pas les occurrences
 * de la même façon — suffixer d'un seul côté donnerait un lien qui ne mène nulle
 * part, ce qu'aucun écran ne signale (un fragment inconnu ne fait rien).
 *
 * Ce refus ne tient que si les deux passes portent sur les **mêmes niveaux** :
 * il compte ce que cette fonction rend, donc `##` et `###` seulement. Une ancre
 * posée au rendu sur un niveau qu'elle ignore échapperait au compte — c'était le
 * cas de `h1` jusqu'à la revue de s30.
 */
export function documentHeadings(body: string): readonly DocsHeading[] {
  const headings: DocsHeading[] = []
  let fence: string | null = null

  for (const line of body.split('\n')) {
    const fenced = FENCE.exec(line)

    if (fenced !== null) {
      const marker = fenced[1] ?? ''

      fence = fence === null ? marker : fence === marker ? null : fence

      continue
    }

    if (fence !== null) {
      continue
    }

    const matched = HEADING.exec(line)

    if (matched === null) {
      continue
    }

    const text = inlineText(matched[2] ?? '')

    headings.push({ depth: (matched[1] ?? '').length as 2 | 3, text, id: headingAnchor(text) })
  }

  return headings
}
