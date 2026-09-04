import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { InvalidArticleError, parseArticle, type BlogArticle } from '../domain/article'

/**
 * La lecture du dossier des articles — la seule porte du module vers le disque.
 *
 * Elle est ici et pas dans `application/` parce que c'est de
 * l'infrastructure : un accès à une ressource extérieure, exactement comme un
 * repository Drizzle. La règle qu'elle applique, elle, vit dans `domain/`.
 *
 * **Elle ne compile aucun MDX.** Le corps des articles est compilé par le
 * bundler de Next (ADR 053) ; ce fichier ne lit que l'en-tête, parce que la
 * liste doit exister sans charger le corps de chaque article.
 */
export interface ReadArticleDirectoryInput {
  /** Le dossier racine du contenu : il contient un sous-dossier par locale. */
  readonly directory: string
  /**
   * Les locales **servies**, dans l'ordre où elles doivent apparaître.
   *
   * Elles viennent de `localeRouting` : module `i18n` coupé, il n'y en a
   * qu'une, et les articles des autres langues restent sur le disque sans être
   * servis.
   */
  readonly locales: readonly string[]
  /**
   * Les locales **de l'application** (`config/i18n.ts`).
   *
   * Elles ne servent qu'à une chose, et c'est le piège que le commentaire de
   * `config/i18n.ts` documente : distinguer un dossier légitimement non servi
   * (`en` quand `i18n` est coupé) d'un dossier que **personne** ne servira
   * jamais (`de`). Le premier est ignoré, le second est refusé en le nommant.
   * Sans cette distinction, un auteur écrirait dans un dossier que rien
   * n'affiche, et rien ne le lui dirait.
   */
  readonly knownLocales: readonly string[]
}

const ARTICLE_EXTENSION = '.mdx'

/** Un slug d'article : ce qui peut devenir un segment d'URL sans être encodé. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

const entriesOf = (directory: string): readonly import('node:fs').Dirent[] => {
  try {
    return readdirSync(directory, { withFileTypes: true })
  } catch {
    // Un dossier absent n'est pas une panne : c'est une langue, ou un dépôt,
    // où personne n'a encore publié.
    return []
  }
}

export function readArticleDirectory({
  directory,
  locales,
  knownLocales,
}: ReadArticleDirectoryInput): readonly BlogArticle[] {
  for (const entry of entriesOf(directory)) {
    if (entry.isDirectory() && !knownLocales.includes(entry.name)) {
      throw new InvalidArticleError(
        `Dossier d’articles refusé — ${join(directory, entry.name)} : « ${entry.name} » n’est ` +
          `pas une locale de l’application (${knownLocales.join(', ')}). Les articles qu’il ` +
          'contient ne seraient jamais servis.',
      )
    }
  }

  const found: BlogArticle[] = []

  for (const locale of locales) {
    const localeDirectory = join(directory, locale)
    const articles: BlogArticle[] = []

    for (const entry of entriesOf(localeDirectory)) {
      if (!entry.isFile() || !entry.name.endsWith(ARTICLE_EXTENSION)) {
        continue
      }

      const filePath = join(localeDirectory, entry.name)
      const slug = entry.name.slice(0, -ARTICLE_EXTENSION.length)

      if (!SLUG.test(slug)) {
        throw new InvalidArticleError(
          `Article refusé — ${filePath} : le nom du fichier porte le chemin de l’article, il ` +
            'doit donc être en kebab-case (minuscules, chiffres, tirets simples).',
        )
      }

      articles.push(
        parseArticle({ source: readFileSync(filePath, 'utf8'), filePath, slug, locale }),
      )
    }

    // Du plus récent au plus ancien. Le slug départage deux articles du même
    // jour ; ce second critère n'est éprouvé par aucun cas, et il faut le
    // savoir : `readdirSync` rend déjà les noms triés sur les systèmes de
    // fichiers essayés ici, donc aucune fixture ne peut le mettre en défaut.
    // Le tri par date, lui, est mesuré — la fixture range les noms à l'envers
    // des dates.
    articles.sort((left, right) => right.date.localeCompare(left.date) || left.slug.localeCompare(right.slug))
    found.push(...articles)
  }

  return found
}
