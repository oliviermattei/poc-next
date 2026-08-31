/**
 * La couche `presentation` du module, exposée par un **second point d'entrée**
 * (`@repo/module-marketing/presentation`).
 *
 * Elle n'est pas dans le barril principal, et c'est une contrainte mesurée, pas
 * une préférence : `config/features.ts` importe le contrat du module, et ce
 * fichier est lu par `pnpm db:generate` comme par `pnpm ks`, dont les
 * compilateurs ne connaissent pas le JSX. Réexporter un `.tsx` depuis le barril
 * principal faisait échouer `pnpm typecheck` de `@repo/db` sur
 * « `--jsx` is not set » — c'est-à-dire qu'un module à composants aurait obligé
 * chaque outil du dépôt à savoir compiler du JSX.
 *
 * Seule l'application importe ce point d'entrée ; le reste du dépôt n'en a pas
 * connaissance.
 */
export { ContactView, type ContactViewProps } from './contact-view'
export { LegalDocumentView, type LegalDocumentViewProps } from './legal-document'
export { MarketingFooter, type MarketingFooterProps } from './marketing-footer'
export { MarketingHome, type MarketingHomeProps } from './marketing-home'
export type { MarketingIntl } from './marketing-intl'
