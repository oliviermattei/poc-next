/**
 * La couche `presentation` du module, exposée par un **second point d'entrée**
 * (`@repo/module-billing/presentation`).
 *
 * Elle n'est pas dans le barril principal, et c'est une contrainte mesurée
 * (ADR 024) : `config/features.ts` importe le contrat du module, et ce fichier
 * est lu par `pnpm db:generate` comme par `pnpm ks`, dont les compilateurs ne
 * connaissent pas le JSX. Réexporter un `.tsx` depuis le barril principal fait
 * échouer `pnpm typecheck` de `@repo/db` sur « `--jsx` is not set ».
 *
 * Seule l'application importe ce point d'entrée.
 */
export { BillingScreen, type BillingScreenProps } from './billing-screen'
export type { BillingIntl } from './billing-intl'
