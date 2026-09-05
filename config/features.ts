import type { AnyModuleDefinition, ModuleIdOf } from '@repo/core'
import { authModule } from '@repo/module-auth'
import { billingModule } from '@repo/module-billing'
import { blogModule } from '@repo/module-blog'
import { consentModule } from '@repo/module-consent'
import { docsModule } from '@repo/module-docs'
import { demoDisabledModule } from '@repo/module-demo-disabled'
import { demoEnabledModule } from '@repo/module-demo-enabled'
import { i18nModule } from '@repo/module-i18n'
import { marketingModule } from '@repo/module-marketing'
import { mcpServerModule } from '@repo/module-mcp-server'
import { organizationsModule } from '@repo/module-organizations'
import { rateLimitModule } from '@repo/module-rate-limit'
import { storageModule } from '@repo/module-storage'

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
  authModule,
  billingModule,
  blogModule,
  consentModule,
  docsModule,
  i18nModule,
  marketingModule,
  mcpServerModule,
  organizationsModule,
  rateLimitModule,
  storageModule,
  demoEnabledModule,
  demoDisabledModule,
] as const satisfies readonly AnyModuleDefinition[]

/** L'union des identifiants connus, dérivée de l'annuaire — jamais recopiée. */
export type AvailableModuleId = ModuleIdOf<typeof availableModules>

/**
 * Le **socle non désactivable** (ADR 021).
 *
 * Sans compte, il n'y a pas de SaaS : les invitations, la suppression de compte
 * et l'export en dépendent, et les écrans d'authentification vivent dans
 * `apps/web`, donc ils continueraient d'être servis en postant vers des routes
 * qui répondraient 404.
 *
 * Cette liste est une **règle exécutable**, pas une phrase : `resolveEnabledModules`
 * la reçoit et refuse en nommant le module, exactement comme un requis manquant.
 * `ks toggle auth` s'arrête donc avant d'écrire quoi que ce soit. La version
 * précédente de ce commentaire affirmait que « le retirer ferait échouer la
 * validation des modules qui le requièrent » — c'était faux : aucun module ne
 * déclarait `requires: ['auth']`, et cinq parcours end-to-end tombaient dans
 * cet état sans que rien ne le refuse.
 *
 * Y ajouter un identifiant est une décision de produit, pas une commodité :
 * c'est retirer à l'utilisateur du boilerplate le droit de couper ce module.
 */
export const requiredModules = ['auth', 'rate-limit'] as const satisfies readonly AvailableModuleId[]

/**
 * Les modules activés.
 *
 * `demo-disabled` est volontairement absent : c'est lui qui prouve en continu
 * qu'un module non activé n'expose ni route, ni entrée de navigation, et que ni
 * sa purge ni son export ne sont appelés.
 */
export const enabledModules = [
  'auth',
  'billing',
  'blog',
  'consent',
  'docs',
  'i18n',
  'marketing',
  'mcp-server',
  'organizations',
  'rate-limit',
  'storage',
  'demo-enabled',
] as const satisfies readonly AvailableModuleId[]
