import { qualifyMessageKey } from '@repo/core'

/** L'identifiant du module, écrit une fois et lu partout ailleurs. */
export const BLOG_MODULE_ID = 'blog'

/**
 * Une clé du module, qualifiée comme le registre le fera.
 *
 * Les composants appellent cette fonction avec une clé **écrite en toutes
 * lettres**, jamais un gabarit : `tests/i18n.test.ts` balaie les littéraux de
 * la surface de rendu, et une clé composée (`` `list.${état}.title` ``) lui
 * serait invisible — l'écran tomberait alors en 500 sans qu'aucune commande ne
 * l'ait dit avant.
 */
export const blogKey = (key: string): string => qualifyMessageKey(BLOG_MODULE_ID, key)

/**
 * **Toutes** les clés du module, nommées ici et nulle part ailleurs.
 *
 * Les composants lisent `BLOG_KEYS.listTitle`, jamais `blogKey('list.title')` :
 * `tests/i18n.test.ts` balaie les littéraux des `.tsx` et les confronte au
 * catalogue **qualifié**. Un littéral non qualifié écrit dans un composant y
 * apparaîtrait comme une clé inexistante — c'est la raison pour laquelle
 * `marketing` procède déjà ainsi.
 *
 * Ce que cette table garantit, et ce qu'elle ne garantit pas : une clé écrite
 * ici et absente du catalogue **lève au rendu** (le traducteur ne se replie
 * jamais sur le chemin de la clé, s09), donc `tests/rendered-text.test.ts`, qui
 * rend les deux écrans, rougit. Elle ne dit rien d'une clé du catalogue que
 * personne n'utilise.
 */
export const BLOG_KEYS = {
  navigation: blogKey('navigation.blog'),
  listTitle: blogKey('list.title'),
  listDescription: blogKey('list.description'),
  tagsLabel: blogKey('list.tags.label'),
  tagsAll: blogKey('list.tags.all'),
  emptyTitle: blogKey('list.empty.title'),
  emptyDescription: blogKey('list.empty.description'),
  emptyAction: blogKey('list.empty.action'),
  emptyTagTitle: blogKey('list.emptyTag.title'),
  emptyTagDescription: blogKey('list.emptyTag.description'),
  emptyTagAction: blogKey('list.emptyTag.action'),
  paginationLabel: blogKey('pagination.label'),
  paginationPrevious: blogKey('pagination.previous'),
  paginationNext: blogKey('pagination.next'),
  paginationPage: blogKey('pagination.page'),
  articleBack: blogKey('article.back'),
  articleBackToList: blogKey('article.backToList'),
  articleTagsLabel: blogKey('article.tags.label'),
  articleAuthorLabel: blogKey('article.author.label'),
} as const
