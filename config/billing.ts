import type { BillingOffer } from '@repo/module-billing'

/**
 * Les offres du projet — **le fichier que le propriétaire édite**.
 *
 * Une seule déclaration, et c'est le premier critère de s19 : la page de tarifs
 * (s22), le checkout et l'écran de facturation liront tous ce tableau. Deux
 * listes divergeraient, et la première à diverger serait celle qui encaisse.
 *
 * Ce fichier **déclare**, il n'exécute rien — comme `config/features.ts`. Le
 * compilateur tient la forme (`satisfies`), et
 * `parseBillingCatalogue` tient ce que le compilateur ne peut pas tenir :
 * les règles croisées (un abonnement a une périodicité, un achat unique n'en a
 * pas), l'unicité des identifiants et celle des prix. Elle est appelée au
 * **démarrage** par `apps/web/next.config.ts` : une offre malformée arrête le
 * processus avant la première requête, en la nommant.
 *
 * **`priceId` est ce qui fait foi.** `amount` et `currency` ne servent qu'à
 * l'affichage : ce qui est facturé est le prix chez le fournisseur, et rien ne
 * lit ces deux champs pour encaisser. Les remplacer par les prix de votre
 * compte Stripe est le seul geste à faire pour vendre autre chose.
 *
 * En **mode local** (`PAYMENTS_LOCAL_MODE=1`), les `priceId` ne sont envoyés
 * nulle part : la simulation ne parle à personne. Les valeurs livrées ci-dessous
 * sont donc des exemples, pas des identifiants réels.
 *
 * **À savoir avant de vendre** : le tunnel de paiement exige JavaScript. Le
 * bouton « Souscrire » passe par `fetch` puis par une navigation pilotée par
 * script, et un `<noscript>` l'annonce. C'est le prix d'une politique de
 * sécurité du contenu sans une seule origine tierce (ADR 027) : ouvrir le
 * checkout par une soumission de formulaire demanderait d'ajouter
 * `checkout.stripe.com` et `billing.stripe.com` à `config/security.ts`.
 */
export const billingOffers = [
  {
    id: 'pro-monthly',
    mode: 'subscription',
    priceId: 'price_pro_monthly',
    amount: 2900,
    currency: 'eur',
    interval: 'month',
    trialDays: 14,
    perSeat: false,
  },
  {
    id: 'pro-yearly',
    mode: 'subscription',
    priceId: 'price_pro_yearly',
    amount: 29_000,
    currency: 'eur',
    interval: 'year',
    trialDays: 14,
    perSeat: false,
  },
  /**
   * **L'achat unique** (s20) — `mode: 'one_time'`, donc ni périodicité ni
   * période d'essai : le catalogue refuse les deux au démarrage pour ce mode.
   *
   * Il ne s'agit pas d'un abonnement déguisé : il n'expire pas, il ne se
   * renouvelle pas, et un périmètre ne peut le posséder qu'une fois (ADR 038).
   * Le supprimer d'ici est la manière de ne pas vendre à l'unité.
   */
  {
    id: 'lifetime',
    mode: 'one_time',
    priceId: 'price_lifetime',
    amount: 49_000,
    currency: 'eur',
    interval: null,
    trialDays: null,
    perSeat: false,
  },
] as const satisfies readonly BillingOffer[]
