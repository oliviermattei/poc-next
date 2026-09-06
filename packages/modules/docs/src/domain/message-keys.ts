import { qualifyMessageKey } from '@repo/core'

/** L'identifiant du module, écrit une fois et lu partout ailleurs. */
export const DOCS_MODULE_ID = 'docs'

/**
 * Une clé du module, qualifiée comme le registre le fera.
 *
 * Les composants appellent cette fonction avec une clé **écrite en toutes
 * lettres**, jamais un gabarit : `tests/i18n.test.ts` balaie les littéraux de la
 * surface de rendu, et une clé composée lui serait invisible — l'écran tomberait
 * alors en 500 sans qu'aucune commande ne l'ait dit avant.
 */
export const docsKey = (key: string): string => qualifyMessageKey(DOCS_MODULE_ID, key)

/**
 * **Toutes** les clés du module, nommées ici et nulle part ailleurs.
 *
 * Ce que cette table garantit : une clé écrite ici et absente du catalogue
 * **lève au rendu** (le traducteur ne se replie jamais sur le chemin de la clé,
 * s09), donc `tests/rendered-text.test.ts`, qui rend les écrans, rougit. Elle ne
 * dit rien d'une clé du catalogue que personne n'utilise.
 *
 * Ce que la documentation ne met **pas** ici : les titres de ses sections et de
 * ses pages. Ils vivent dans le contenu, à côté des pages de leur langue — une
 * section ajoutée est un dossier déposé, sans inscription ailleurs.
 */
export const DOCS_KEYS = {
  navigation: docsKey('navigation.docs'),
  sidebarLabel: docsKey('sidebar.label'),
  sidebarOpen: docsKey('sidebar.open'),
  sidebarClose: docsKey('sidebar.close'),
  breadcrumbLabel: docsKey('breadcrumb.label'),
  breadcrumbHome: docsKey('breadcrumb.home'),
  tocLabel: docsKey('toc.label'),
  tocTitle: docsKey('toc.title'),
  untranslatedTitle: docsKey('untranslated.title'),
  untranslatedDescription: docsKey('untranslated.description'),
  searchOpen: docsKey('search.open'),
  searchTitle: docsKey('search.title'),
  searchDescription: docsKey('search.description'),
  searchPlaceholder: docsKey('search.placeholder'),
  searchEmpty: docsKey('search.empty'),
  searchResults: docsKey('search.results'),
  searchClose: docsKey('search.close'),
  searchUntranslated: docsKey('search.untranslated'),
  emptyTitle: docsKey('empty.title'),
  emptyDescription: docsKey('empty.description'),
  emptyAction: docsKey('empty.action'),
} as const
