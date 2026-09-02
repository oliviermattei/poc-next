import { qualifyMessageKey } from '@repo/core'

import {
  CONSENT_MODULE_ID,
  type ConsentCategory,
  type ConsentStatus,
} from './consent-category'

/**
 * **Toutes** les clés de traduction du module, dérivées ici et nulle part
 * ailleurs.
 *
 * Deux clés sont **composées** — le titre et la description d'une catégorie,
 * l'état d'une décision — donc invisibles au balayage statique de
 * `tests/i18n.test.ts`. Elles passent par des fonctions nommées plutôt que par
 * un gabarit écrit dans un `.tsx` : c'est la leçon de s10, où un
 * `` `section.${id}.title` `` produisait neuf faux positifs du détecteur de
 * texte en dur.
 */

/** Une clé du module, qualifiée comme le registre le fera. */
export const consentKey = (key: string): string => qualifyMessageKey(CONSENT_MODULE_ID, key)

export const BANNER_LABEL_KEY = consentKey('banner.label')
export const BANNER_TITLE_KEY = consentKey('banner.title')
export const BANNER_DESCRIPTION_KEY = consentKey('banner.description')
export const BANNER_ACCEPT_KEY = consentKey('banner.acceptAll')
export const BANNER_REFUSE_KEY = consentKey('banner.refuseAll')
export const BANNER_CUSTOMIZE_KEY = consentKey('banner.customize')

export const SCREEN_TITLE_KEY = consentKey('screen.title')
export const SCREEN_DESCRIPTION_KEY = consentKey('screen.description')

export const PREFERENCES_TITLE_KEY = consentKey('preferences.title')
export const PREFERENCES_DESCRIPTION_KEY = consentKey('preferences.description')
export const PREFERENCES_SAVE_KEY = consentKey('preferences.save')

export const EMPTY_TITLE_KEY = consentKey('empty.title')
export const EMPTY_DESCRIPTION_KEY = consentKey('empty.description')

export const SETTINGS_TITLE_KEY = consentKey('settings.title')
export const SETTINGS_DESCRIPTION_KEY = consentKey('settings.description')
export const SETTINGS_ACTION_KEY = consentKey('settings.action')

/** Le libellé du lien du pied de page public, fourni par l'application. */
export const FOOTER_LINK_KEY = consentKey('footer.link')

/** Le titre et l'explication d'une catégorie — une **finalité**, pas un fournisseur. */
export const categoryTitleKey = (category: ConsentCategory): string =>
  consentKey(`category.${category}.title`)

export const categoryDescriptionKey = (category: ConsentCategory): string =>
  consentKey(`category.${category}.description`)

/**
 * L'état enregistré d'une catégorie.
 *
 * C'est un **libellé de statut**, pas une décoration : il distingue « accepté »,
 * « refusé » et « en attente », et c'est le seul retour visible après un
 * enregistrement.
 */
export const statusLabelKey = (status: ConsentStatus): string =>
  consentKey(`status.${status}`)

/**
 * Toutes les clés que ce module exige d'un catalogue, énumérées.
 *
 * `tests/i18n.test.ts` compare les catalogues clé par clé dans chaque locale ;
 * cette liste est ce qui rend les clés **composées** visibles à cette
 * comparaison.
 */
export const consentMessageKeys = (
  categories: readonly ConsentCategory[],
  statuses: readonly ConsentStatus[],
): readonly string[] => [
  BANNER_LABEL_KEY,
  BANNER_TITLE_KEY,
  BANNER_DESCRIPTION_KEY,
  BANNER_ACCEPT_KEY,
  BANNER_REFUSE_KEY,
  BANNER_CUSTOMIZE_KEY,
  SCREEN_TITLE_KEY,
  SCREEN_DESCRIPTION_KEY,
  PREFERENCES_TITLE_KEY,
  PREFERENCES_DESCRIPTION_KEY,
  PREFERENCES_SAVE_KEY,
  EMPTY_TITLE_KEY,
  EMPTY_DESCRIPTION_KEY,
  SETTINGS_TITLE_KEY,
  SETTINGS_DESCRIPTION_KEY,
  SETTINGS_ACTION_KEY,
  FOOTER_LINK_KEY,
  ...categories.flatMap((category) => [
    categoryTitleKey(category),
    categoryDescriptionKey(category),
  ]),
  ...statuses.map((status) => statusLabelKey(status)),
]
