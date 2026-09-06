/**
 * Le module « docs » : la documentation du produit, écrite en MDX.
 *
 * Ce baril porte le **contrat**, `domain` et `application` — jamais un `.tsx`
 * (ADR 024). `config/features.ts` importe ce fichier, et il est lu par
 * `pnpm db:generate` comme par `pnpm ks`, dont les compilateurs ne connaissent
 * pas le JSX. Les composants sont exposés par `@repo/module-docs/presentation`.
 */
export {
  DOCS_PATH,
  EMPTY_DOCS_CATALOG,
  docsNavigationTree,
  docsPagePath,
  docsPageView,
  firstDocsPage,
  resolveDocsCatalog,
  type DocsCatalog,
  type DocsIndex,
  type DocsNavigationPage,
  type DocsNavigationSection,
  type DocsPageQuery,
  type DocsPageResolution,
  type ResolveDocsCatalogInput,
} from './application/docs-catalog'
export {
  DOCS_SEARCH_INDEX_MAX_BYTES,
  DocsSearchIndexTooLargeError,
  docsSearchIndex,
  searchDocsIndex,
  type DocsSearchEntry,
} from './application/docs-search'
export {
  InvalidDocsPageError,
  documentHeadings,
  documentLinks,
  documentText,
  headingAnchor,
  parseDocsPage,
  parseDocsSection,
  type DocsHeading,
  type DocsPage,
  type DocsPageFrontmatter,
  type DocsSection,
} from './domain/docs-page'
export { DOCS_KEYS, DOCS_MODULE_ID, docsKey } from './domain/message-keys'
export {
  DocsContentNotProvidedError,
  docsPublicUrls,
  provideDocsContent,
  requireDocsContent,
  resetDocsContent,
  type DocsContent,
} from './infrastructure/docs-content'
export {
  readDocsDirectory,
  type DocsDirectoryContent,
  type ReadDocsDirectoryInput,
} from './infrastructure/docs-directory'
export { docsModule } from './module'
