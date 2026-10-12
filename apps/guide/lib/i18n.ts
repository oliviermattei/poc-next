import { defineI18n } from 'fumadocs-core/i18n'

/**
 * Le français fait foi, l'anglais est traduit, et chaque URL porte sa langue
 * (`/fr/…`, `/en/…`) : l'export statique ne sert aucun proxy qui pourrait la
 * deviner. Pas de repli d'une langue sur l'autre (`fallbackLanguage: null`) —
 * une page manquante en anglais doit se voir, pas s'afficher en français ;
 * `tests/guide.test.ts` refuse d'ailleurs qu'elle manque.
 */
export const i18n = defineI18n({
  defaultLanguage: 'fr',
  languages: ['fr', 'en'],
  hideLocale: 'never',
  fallbackLanguage: null,
})
