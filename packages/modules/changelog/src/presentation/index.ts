/**
 * La couche `presentation` du module, exposée par un **second point d'entrée**
 * (`@repo/module-changelog/presentation`, ADR 024).
 *
 * Elle n'est pas dans le barril principal : `config/features.ts` importe le
 * contrat, et ce fichier est lu par `pnpm db:generate` comme par `pnpm ks`, dont
 * les compilateurs ne connaissent pas le JSX. Réexporter un `.tsx` depuis le
 * barril principal fait échouer `pnpm typecheck` de `@repo/db` sur
 * « `--jsx` is not set ».
 */
export { ChangelogList, type ChangelogListProps } from './changelog-list'
export type { ChangelogIntl } from './changelog-intl'
