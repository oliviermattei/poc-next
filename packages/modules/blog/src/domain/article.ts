import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

/**
 * Un article, tel que le reste du module le manipule.
 *
 * `slug` et `locale` ne viennent **pas** du frontmatter : ils viennent de
 * l'emplacement du fichier (`content/blog/<locale>/<slug>.mdx`). C'est la
 * réponse écrite à la question ouverte de la recherche — « le fichier est-il par
 * locale, ou le frontmatter porte-t-il ses locales ? ». Deux raisons, et la
 * seconde est celle qui décide :
 *
 * 1. un article sans traduction est alors un **fichier absent** : il n'y a rien
 *    à déclarer, donc rien à oublier ;
 * 2. les locales balayées sont celles de **l'application** (`config/i18n.ts`),
 *    transmises par le point de composition — jamais celles que ce module
 *    déclare au contrat. `config/i18n.ts:5-7` documente la confusion inverse,
 *    qui a déjà coûté un défaut au dépôt (des templates d'email contrôlés
 *    contre les locales du module). Un frontmatter portant ses locales aurait
 *    remis cette décision dans chaque fichier de contenu.
 */
export interface BlogArticle {
  readonly slug: string
  readonly locale: string
  readonly title: string
  readonly description: string
  /** Date de publication, `YYYY-MM-DD`. Comparée telle quelle : ce format se trie. */
  readonly date: string
  readonly author: string
  readonly tags: readonly string[]
}

/**
 * Le refus d'un article, **nommant le fichier**.
 *
 * C'est le critère 2 de la story, et il n'est pas décoratif : le frontmatter est
 * lu à l'amorçage, donc pendant `pnpm build`. Un message qui dirait seulement
 * « champ requis » obligerait l'auteur à ouvrir les articles un par un.
 */
export class InvalidArticleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidArticleError'
  }
}

/**
 * Une date de calendrier réelle, en `YYYY-MM-DD`.
 *
 * Le format seul ne suffit pas : `2026-02-30` le respecte et n'existe pas.
 * L'aller-retour par `Date` est ce qui départage les deux — une date normalisée
 * qui ne se réécrit pas à l'identique est une date que personne n'a voulue.
 */
const isoDate = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }

  const parsed = new Date(`${value}T00:00:00Z`)

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'attendu : une date de calendrier réelle au format AAAA-MM-JJ')

/**
 * Le frontmatter, au complet et **fermé**.
 *
 * `strict()` refuse une clé inconnue, et c'est le cas qui compte le plus : une
 * faute de frappe (`titre:` pour `title:`) sur un schéma ouvert produirait un
 * article dont le titre manque, sans que rien ne le dise. Avec, elle est un
 * refus nommé.
 */
const frontmatterSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().min(1),
    date: isoDate,
    author: z.string().min(1),
    tags: z.array(z.string().min(1)),
  })
  .strict()

/** Le type que le frontmatter déclare — dérivé du schéma, jamais recopié. */
export type BlogArticleFrontmatter = z.infer<typeof frontmatterSchema>

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/

const refuse = (filePath: string, reason: string): never => {
  throw new InvalidArticleError(`Article refusé — ${filePath} : ${reason}`)
}

export interface ParseArticleInput {
  /** Le contenu brut du fichier `.mdx`, frontmatter compris. */
  readonly source: string
  /** Le chemin du fichier, tel qu'il sera **nommé** dans le refus. */
  readonly filePath: string
  readonly slug: string
  readonly locale: string
}

/**
 * Valide le frontmatter d'un article et rend l'article.
 *
 * Pure : elle ne lit aucun fichier, ne connaît ni Next, ni MDX. Le corps de
 * l'article ne la traverse jamais — il est compilé par le bundler (ADR 053), et
 * cette fonction n'en voit que la présence.
 */
export function parseArticle({ source, filePath, slug, locale }: ParseArticleInput): BlogArticle {
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

  const parsed = frontmatterSchema.safeParse(raw)

  if (!parsed.success) {
    return refuse(
      filePath,
      parsed.error.issues
        .map((issue) => `« ${issue.path.join('.') || '(racine)'} » ${issue.message}`)
        .join(' ; '),
    )
  }

  return { slug, locale, ...parsed.data }
}

/**
 * La date d'un article, dans la langue de l'article.
 *
 * Elle est formatée ici, et pas par l'appelant : la locale de l'article est une
 * propriété de l'article, pas de la requête. Un article anglais lu depuis une
 * page française porte sa propre date, pas une date traduite.
 *
 * `timeZone: 'UTC'` : la date est un jour de calendrier, pas un instant. Sans
 * elle, un serveur à l'ouest de Greenwich rendrait la veille.
 */
export function formatArticleDate(article: BlogArticle): string {
  return new Intl.DateTimeFormat(article.locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${article.date}T00:00:00Z`),
  )
}
