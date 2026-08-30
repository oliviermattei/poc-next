import type { AnyModuleDefinition, ModuleIdOf } from '@repo/core'
import { demoDisabledModule } from '@repo/module-demo-disabled'
import { demoEnabledModule } from '@repo/module-demo-enabled'

/**
 * Les modules du projet — le fichier que le propriétaire édite.
 *
 * Deux listes, et la distinction est tout le mécanisme :
 *
 * - `availableModules` est l'**annuaire** : les modules que ce dépôt contient.
 *   Y ajouter une ligne est ce que fait l'installation d'un module.
 * - `enabledModules` est la **configuration** : ceux qui sont activés. C'est la
 *   seule ligne qu'on édite pour activer ou couper une fonctionnalité, et le
 *   CLI de s05 n'éditera que celle-là.
 *
 * Un identifiant inconnu ne compile pas : `satisfies` confronte la liste à
 * l'union des identifiants de l'annuaire. C'est une garantie du **compilateur**,
 * pas une validation au démarrage, et la différence n'est pas cosmétique — une
 * liste typée `string[]` accepterait `'billng'` jusqu'au premier déploiement.
 *
 * Ce que ce fichier ne fait pas : construire le registre. Il déclare, `@repo/core`
 * valide et agrège. Un fichier de configuration qui exécute quelque chose n'est
 * plus une configuration.
 */
export const availableModules = [
  demoEnabledModule,
  demoDisabledModule,
] as const satisfies readonly AnyModuleDefinition[]

/** L'union des identifiants connus, dérivée de l'annuaire — jamais recopiée. */
export type AvailableModuleId = ModuleIdOf<typeof availableModules>

/**
 * Les modules activés.
 *
 * `demo-disabled` est volontairement absent : c'est lui qui prouve en continu
 * qu'un module non activé n'expose ni route, ni entrée de navigation, et que ni
 * sa purge ni son export ne sont appelés.
 */
export const enabledModules = ['demo-enabled'] as const satisfies readonly AvailableModuleId[]
