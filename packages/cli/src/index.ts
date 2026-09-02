/**
 * Le moteur de `ks`, importable (s41, ADR 040).
 *
 * `bin.ts` reste le **seul** point de composition : le seul fichier qui lit
 * `config/features.ts`, lance un sous-processus, ou touche au terminal. Ce
 * baril n'exporte rien de tout ça — il exporte les fonctions à environnement
 * injecté et les fonctions pures que `bin.ts` orchestre, pour que le module
 * `mcp-server` (la seconde façade) les orchestre à son tour, sans en
 * réécrire aucune.
 *
 * Avant s41, ce paquet n'avait délibérément aucun point d'entrée importable :
 * la seule façade était la commande. La story exige que le serveur MCP
 * « réutilise la logique du CLI de s05 », jamais une seconde implémentation —
 * ce baril est ce que ça prend, rien de plus. Voir `docs/decisions/040-*.md`
 * pour l'option rejetée (extraire un nouveau paquet `@repo/module-engine`).
 */
export {
  runList,
  runToggle,
  renderModuleList,
  ToggleRefusedError,
  type PendingMigrations,
  type ToggleEnvironment,
  type ToggleOutcome,
  type ToggleRequest,
} from './commands'
export { missingRequirements, planToggle, type TogglePlan, type ToggleInput } from './toggle'
export { describeModules, type ModuleSummary, type ModuleSummarySource } from './modules'
export {
  readEnabledModules,
  writeEnabledModules,
  FeaturesFileError,
  type EnabledModulesEdit,
} from './features-file'
export { applyToggle, ArtifactSnapshotError, RegenerationFailedError } from './apply'
export { planScaffold, ScaffoldRefusedError, type ScaffoldPlan } from './scaffold'
export { scaffoldFiles, type ScaffoldFile } from './scaffold-files'
export {
  applyScaffold,
  ScaffoldDirectoryExistsError,
  ScaffoldWriteError,
  type ApplyScaffoldOptions,
} from './apply-scaffold'
export { assertRepositoryClean, DirtyRepositoryError } from './git-guard'
