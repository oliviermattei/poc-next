/**
 * La couche `presentation` du module, exposée par un **second point d'entrée**
 * (`@repo/module-docs/presentation`, ADR 024).
 *
 * Elle n'est pas dans le barril principal : `config/features.ts` importe le
 * contrat, et ce fichier est lu par `pnpm db:generate` comme par `pnpm ks`,
 * dont les compilateurs ne connaissent pas le JSX. Réexporter un `.tsx` depuis
 * le barril principal fait échouer `pnpm typecheck` de `@repo/db` sur
 * « `--jsx` is not set ».
 *
 * **L'échelle de prose n'est pas ici** (ADR 055) : elle vit dans `@repo/ui`.
 * Ce module n'en dérive qu'une variante — la même table, avec les ancres que
 * son sommaire attend.
 */
export { DocsPageView, type DocsPageViewProps } from './docs-page-view'
export { DocsMobileSidebar, type DocsMobileSidebarProps } from './docs-mobile-sidebar'
export { DocsSidebar, type DocsSidebarProps } from './docs-sidebar'
export { DocsToc, type DocsTocProps } from './docs-toc'
export { docsProseComponents } from './docs-prose'
export type { DocsIntl } from './docs-intl'
