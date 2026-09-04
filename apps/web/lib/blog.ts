import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  EMPTY_BLOG_CATALOG,
  blogModule,
  readArticleDirectory,
  resolveBlogCatalog,
  type BlogCatalog,
} from '@repo/module-blog'

import { appLocales } from '../../../config/i18n'
import { localeRouting } from './locale-routing'
import { moduleRegistry } from './module-registry'

/**
 * Le point de composition du blog — le même modèle que `lib/marketing.ts`
 * (quel site public) et `lib/locale-routing.ts` (quelle forme d'URL).
 *
 * C'est **le seul fichier de l'application** qui connaisse `@repo/module-blog`,
 * et le seul qui regarde si ce module est monté. Ailleurs — les deux écrans —
 * on lit `blogCatalog`, dont la **forme est la même dans les deux états** :
 * `index` vaut `null` quand le module est coupé, et les deux pages répondent
 * alors 404. Aucune ligne d'écran ne nomme un module.
 *
 * | | module activé | module coupé |
 * |---|---|---|
 * | `/blog` | la liste, paginée et filtrable | 404 |
 * | `/blog/<slug>` | l'article, s'il existe dans cette langue | 404 |
 * | entrée de navigation | « Blog » | absente, avec le module |
 */

/**
 * Le dossier des articles, résolu depuis le répertoire d'appel.
 *
 * **Deux répertoires d'appel existent, et c'est mesuré** : Next travaille dans
 * `apps/web` (`next dev`, `next build`, et `.next/standalone/apps/web` pour la
 * sortie autonome), Vitest à la racine du dépôt. Une seule des deux formes
 * suffirait à l'un et laisserait l'autre lire un dossier vide — c'est-à-dire un
 * blog silencieusement sans article, ce qu'aucune commande ne signalerait.
 *
 * Les deux candidats sont donc **écrits**, et l'absence des deux **lève en les
 * nommant** plutôt que de rendre une liste vide.
 */
const CONTENT_CANDIDATES = ['content/blog', '../../content/blog'] as const

const contentDirectory = (): string => {
  const candidates = CONTENT_CANDIDATES.map((candidate) => resolve(process.cwd(), candidate))
  const found = candidates.find((candidate) => existsSync(candidate))

  if (found === undefined) {
    throw new Error(
      `Dossier des articles introuvable depuis ${process.cwd()} : aucun de ${candidates.join(', ')} n’existe.`,
    )
  }

  return found
}

/**
 * Le nombre d'articles par page.
 *
 * Six : deux lignes complètes de la grille à partir de `lg` (trois colonnes),
 * trois lignes à `md`. Une valeur qui ne remplit pas une ligne laisse un trou
 * visible en bas de grille.
 */
const PAGE_SIZE = 6

/**
 * Le catalogue lu **une fois**, au chargement du module.
 *
 * C'est aussi ce qui fait tenir le critère 2 : un frontmatter invalide lève
 * ici, donc pendant `pnpm build`, en nommant le fichier fautif. Une lecture
 * paresseuse ne ferait échouer que la première requête, en production.
 */
export const blogCatalog: BlogCatalog = moduleRegistry.moduleIds.includes(blogModule.id)
  ? resolveBlogCatalog({
      articles: readArticleDirectory({
        directory: contentDirectory(),
        // Les locales **servies** : une seule quand le module `i18n` est coupé,
        // et l'application sert alors tout dans la langue par défaut.
        locales: localeRouting.locales,
        // Les locales **de l'application**, qui ne servent qu'à refuser un
        // dossier que personne ne servira jamais (`config/i18n.ts:5-7`).
        knownLocales: [...appLocales],
      }),
      pageSize: PAGE_SIZE,
    })
  : EMPTY_BLOG_CATALOG
