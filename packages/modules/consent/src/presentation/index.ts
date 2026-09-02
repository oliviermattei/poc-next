/**
 * La couche `presentation` du module, exposée par un **second point d'entrée**
 * (`@repo/module-consent/presentation`).
 *
 * Elle n'est pas dans le barril principal, et c'est une contrainte mesurée :
 * `config/features.ts` importe le contrat du module, et ce fichier est lu par
 * `pnpm db:generate` comme par `pnpm ks`, dont les compilateurs ne connaissent
 * pas le JSX (ADR 024). Seule l'application importe ce point d'entrée.
 */
export { ConsentBanner, type ConsentBannerProps } from './consent-banner'
export { ConsentPreferences, type ConsentPreferencesProps } from './consent-preferences'
export { ConsentScripts, type ConsentScriptsProps } from './consent-scripts'
export { ConsentSettingsCard, type ConsentSettingsCardProps } from './consent-settings-card'
export type { ConsentIntl } from './consent-intl'
