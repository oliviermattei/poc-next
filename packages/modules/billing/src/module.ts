import { defineModule } from '@repo/core'

import { BILLING_MODULE_ID } from './domain/message-keys'
import { requireBillingService } from './infrastructure/billing-runtime'
import enMessages from './messages/en.json' with { type: 'json' }
import frMessages from './messages/fr.json' with { type: 'json' }
import { billingNavigation, createBillingRoutes } from './presentation/billing-routes'
import { billingSchema } from './schema'

/**
 * Le contrat du module `billing`, rempli — les quatorze clés.
 *
 * Le point de composition du module — le seul fichier qui connaisse les quatre
 * couches — vit ici, hors des couches, comme dans tout module de ce dépôt.
 *
 * Les cas d'usage ne sont **pas** construits à l'import : ce fichier est chargé
 * par `config/billing.ts` et `config/features.ts`, donc par `pnpm ks list` et
 * par `pnpm db:generate`, qui n'ont ni base ni fournisseur de paiement. Les
 * routes reçoivent un **accès différé** au service
 * (`requireBillingService`), posé par le point de composition de l'application
 * (`apps/web/lib/billing.ts`).
 *
 * **`requires: []`, et c'est une décision** (ADR 034). Un abonnement appartient
 * tantôt à une organisation, tantôt à un compte, selon la configuration :
 * déclarer `organizations` en requis rendrait la facturation impossible sans
 * multi-tenant, et déclarer `auth` n'aiderait pas — le périmètre n'est pas
 * toujours un compte. Aucune clé étrangère ne sort donc de ce module, et ADR 018
 * est respecté par construction.
 *
 * **`webhooks: []` alors que ce module reçoit un webhook** : le contrat déclare
 * des gestionnaires que **le registre** appellerait, et rien n'appelle encore ce
 * registre-là — `tests/module-registry.test.ts` le vérifie, et rougira dès qu'un
 * gestionnaire de webhook sera appelé dans `apps/web` ou dans
 * `packages/core/src`. La
 * signature de Stripe doit être vérifiée sur les **octets bruts** de la requête,
 * ce que `WebhookEvent` (`id`, `type`, `payload`) ne porte pas : passer par ce
 * contrat obligerait à parser avant de vérifier, c'est-à-dire à faire
 * exactement ce que `docs/security.md` §4 interdit. Le webhook est donc une
 * **route déclarée**, publique, et sa garde est la signature. Un module coupé
 * n'a alors ni route ni webhook, ce qui est la propriété recherchée.
 */
export const billingModule = defineModule({
  id: BILLING_MODULE_ID,
  requires: [],
  schema: billingSchema,
  migrations: 'packages/modules/billing/migrations',
  routes: createBillingRoutes(requireBillingService),
  navigation: billingNavigation,
  messages: { fr: frMessages, en: enMessages },
  emails: [],
  webhooks: [],
  jobs: [],
  // Le rattachement d'un périmètre à un client du fournisseur, et l'abonnement
  // qui en découle. Ce sont des données personnelles : elles désignent une
  // personne ou son organisation chez un tiers. **Effacées**, jamais
  // anonymisées — un rattachement anonyme ne veut rien dire, et l'identifiant
  // *est* la donnée.
  //
  // **L'achat unique est une catégorie à part entière** (constat m9 de la
  // seconde revue de s20) : le module en stocke, l'export les rend et la purge
  // les efface par la cascade. La donnée était bien traitée ; c'est
  // l'inventaire qui mentait, et c'est lui que liront s34 et s35 —
  // `retention` n'est contrainte que par ce que cette liste déclare.
  //
  // Le journal d'événements n'est pas une catégorie : il ne porte que des
  // identifiants d'événements du fournisseur, sans lien avec un compte, et
  // l'effacer rouvrirait le rejeu d'événements déjà traités. Le journal des
  // remboursements est de la même nature, et échappe à la purge pour la même
  // raison.
  dataCategories: ['billing-customer', 'subscription', 'purchase'],
  retention: { 'billing-customer': 'erase', subscription: 'erase', purchase: 'erase' },
  purge: (scope) => requireBillingService().useCases.purge(scope),
  export: (scope) => requireBillingService().useCases.export(scope),
})
