import { qualifyMessageKey } from '@repo/core'

import { CHANGELOG_CATEGORIES, type ChangelogCategory } from './changelog-entry'

/**
 * **Toutes** les clés de traduction du module, dérivées ici et nulle part
 * ailleurs.
 *
 * Les libellés de catégorie sont **composés** (`category.<id>`), donc invisibles
 * au balayage statique de `tests/i18n.test.ts` : ils passent par une fonction
 * nommée, sont énumérés plus bas et cette énumération est **confrontée aux
 * catalogues** par `tests/changelog.test.ts`, comme le module `consent` le fait
 * pour les siens. C'est la leçon de s10, où un gabarit écrit dans un `.tsx`
 * produisait neuf faux positifs du détecteur de texte en dur.
 */
export const CHANGELOG_MODULE_ID = 'changelog'

/** Une clé du module, qualifiée comme le registre le fera. */
export const changelogKey = (key: string): string =>
  qualifyMessageKey(CHANGELOG_MODULE_ID, key)

export const CHANGELOG_KEYS = {
  listTitle: changelogKey('list.title'),
  listDescription: changelogKey('list.description'),
  emptyTitle: changelogKey('empty.title'),
  emptyDescription: changelogKey('empty.description'),
  /** Le libellé du lien du pied de page public, rendu depuis le registre (s31). */
  footerLink: changelogKey('footer.link'),
  /** « Version <n> » — le titre d'un groupe, où le numéro est une donnée. */
  release: changelogKey('release.title'),
} as const

/** Le libellé d'une catégorie — une **nature de changement**, traduite. */
export const categoryLabelKey = (category: ChangelogCategory): string =>
  changelogKey(`category.${category}`)

/**
 * Toutes les clés que ce module exige d'un catalogue, énumérées.
 *
 * **Elle est consommée**, et c'est ce qui la rend utile : `tests/changelog.test.ts`
 * (« le catalogue de traductions du module ») confronte cette liste aux
 * catalogues du module dans chaque locale du projet. Sans ce consommateur, la
 * liste était une déclaration que personne ne lisait — la revue de s31 a mesuré
 * qu'une cinquième catégorie sans traduction ne faisait alors rougir aucune
 * commande, `tests/i18n.test.ts` compris : son balayage est statique, et une
 * clé composée (`category.<id>`) lui est invisible.
 */
export const changelogMessageKeys = (): readonly string[] => [
  ...Object.values(CHANGELOG_KEYS),
  ...CHANGELOG_CATEGORIES.map((category) => categoryLabelKey(category)),
]
