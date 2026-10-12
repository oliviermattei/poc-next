import { defineI18n } from 'fumadocs-core/i18n'

/**
 * Le français fait foi, l'anglais est traduit, et chaque URL porte sa langue
 * (`/fr/…`, `/en/…`) : l'export statique ne sert aucun proxy qui pourrait la
 * deviner. Pas de repli d'une langue sur l'autre (`fallbackLanguage: null`) —
 * une page manquante en anglais doit se voir, pas s'afficher en français ;
 * `tests/guide.test.ts` refuse d'ailleurs qu'elle manque.
 *
 * **La seule déclaration des langues du Guide** : le type `Lang`, les liens de
 * la racine et de la page 404, et la liste que lit `tests/guide.test.ts` en
 * dérivent. Une langue ajoutée ici force sa traduction partout ailleurs.
 */
export const i18n = defineI18n({
  defaultLanguage: 'fr',
  languages: ['fr', 'en'],
  hideLocale: 'never',
  fallbackLanguage: null,
})

/** Une langue du Guide, dérivée de `i18n.languages`. */
export type Lang = (typeof i18n.languages)[number]

/** Un texte écrit dans chaque langue du Guide. */
export type Localized = Record<Lang, string>

/** Un libellé identique dans toutes les langues — un nom propre (`Stripe`). */
export const same = (label: string): Localized =>
  Object.fromEntries(i18n.languages.map((lang) => [lang, label])) as Localized
