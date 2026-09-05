import { defineModule } from '@repo/core'

import { BILLING_MODULE_ID } from './domain/message-keys'
import { requireBillingService } from './infrastructure/billing-runtime'
import enMessages from './messages/en.json' with { type: 'json' }
import frMessages from './messages/fr.json' with { type: 'json' }
import { billingNavigation, createBillingRoutes } from './presentation/billing-routes'
import { billingSchema } from './schema'

/**
 * Le contrat du module `billing`, rempli — les quinze clés.
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
  /**
   * Aucune URL publique : ce module ne publie pas de page indexable (s53).
   *
   * Déclaré vide, jamais omis — le compilateur refuse l'omission
   * (`tests/fixtures/typing/missing-public-urls.ts`).
   */
  publicUrls: () => [],
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
  //
  // **`guest-checkout` est une catégorie à part** (s24, ADR 047), et pas un
  // doublon de `billing-customer` : ce sont les mêmes lignes, ce n'est pas le
  // même cycle de vie. Une ligne invitée est écrite **avant** tout paiement,
  // pour un visiteur qui n'a pas de compte, et elle ne porte qu'un identifiant
  // opaque et un identifiant de client chez le fournisseur.
  //
  // Ce que sa politique `erase` recouvre **exactement**, dit plutôt que
  // sous-entendu :
  //
  // - une ligne **promue** — le paiement a abouti, le webhook lui a donné un
  //   compte — est effacée par `purge(user:<id>)`, comme n'importe quelle ligne
  //   `billing-customer`, et ses abonnements et achats suivent par la cascade.
  //   C'est le cas mesuré par `tests/billing.test.ts` ;
  // - une ligne **abandonnée** — le visiteur a fermé le tunnel — n'est effacée
  //   par rien, et c'est la conséquence assumée de l'ADR 047 : aucun périmètre
  //   ne la nomme, donc aucune purge ne peut l'atteindre. Elle n'est ni un
  //   compte ni un droit d'accès (critère 5), et écrire une commande de
  //   nettoyage serait un chemin destructeur dont le PRD ne veut pas
  //   (`eject`, au cimetière). Il n'en existe pas, et il ne doit pas en
  //   exister.
  dataCategories: ['billing-customer', 'guest-checkout', 'subscription', 'purchase'],
  retention: {
    'billing-customer': 'erase',
    'guest-checkout': 'erase',
    subscription: 'erase',
    purchase: 'erase',
  },
  purge: (scope) => requireBillingService().useCases.purge(scope),
  export: (scope) => requireBillingService().useCases.export(scope),
})
