/**
 * La couche `presentation` du module, exposée par un **second point d'entrée**
 * (`@repo/module-blog/presentation`, ADR 024).
 *
 * Elle n'est pas dans le barril principal : `config/features.ts` importe le
 * contrat, et ce fichier est lu par `pnpm db:generate` comme par `pnpm ks`,
 * dont les compilateurs ne connaissent pas le JSX. Réexporter un `.tsx` depuis
 * le barril principal fait échouer `pnpm typecheck` de `@repo/db` sur
 * « `--jsx` is not set ».
 */
export { BlogArticleView, type BlogArticleViewProps } from './article-view'
export { BlogList, type BlogListProps } from './blog-list'
export type { BlogIntl } from './blog-intl'
export { PROSE_CLASSNAME, proseComponents } from './prose'
