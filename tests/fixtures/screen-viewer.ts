import type {
  DescribedPasskey,
  DescribedSession,
  DescribedSignInMethod,
} from '@repo/module-auth'
import type { BillingView } from '@repo/module-billing'
import { permissionsOf } from '@repo/module-organizations'
import { initialsOf } from '@repo/ui'

/**
 * L'appelant que voient les écrans pendant le rendu de `tests/rendered-text.test.ts`.
 *
 * C'est la base de données et le contexte de requête qui sont remplacés ici,
 * jamais une règle : les écrans, les composants du design system et les
 * traductions rendus sont les vrais. Les valeurs sont **des données**, et le
 * test les énumère pour les distinguer d'un texte écrit en dur — un nom, une
 * adresse, une IP et un agent utilisateur s'affichent tels quels et ne viennent
 * d'aucun catalogue.
 */
export interface ViewerFixture {
  readonly session: { readonly userId: string; readonly roles: readonly string[] } | null
  readonly account: {
    readonly userId: string
    readonly name: string
    readonly email: string
    readonly emailVerified: boolean
  } | null
}

export const FIXTURE_NAME = 'Alice Martin'
export const FIXTURE_EMAIL = 'alice@example.test'
export const FIXTURE_IP = '203.0.113.4'
export const FIXTURE_USER_AGENT = 'Mozilla/5.0 (Macintosh)'
export const FIXTURE_SESSION_CREATED_AT = new Date('2026-01-15T09:30:00Z')

export const SIGNED_IN: ViewerFixture = {
  session: { userId: 'usr_1', roles: [] },
  account: {
    userId: 'usr_1',
    name: FIXTURE_NAME,
    email: FIXTURE_EMAIL,
    emailVerified: true,
  },
}

export const ANONYMOUS: ViewerFixture = { session: null, account: null }

/**
 * L'avatar que voient le shell et l'écran de compte pendant ce rendu (s18).
 *
 * Il est **présent**, et ce n'est pas de la générosité : `null`, la carte
 * rendrait le repli sur les initiales et le bouton « Retirer » ne serait pas
 * rendu du tout — deux branches passeraient sous le filet sans être vues. Les
 * initiales, elles, sont observables dans les deux cas : le menu de compte du
 * shell les rend derrière l'image.
 */
export const FIXTURE_AVATAR = {
  fileId: 'file_1',
  contentType: 'image/png' as const,
  version: '1788000000000',
}

/**
 * Les initiales du nom de la fixture, **dérivées** et non recopiées.
 *
 * C'est une donnée affichée qui ne vient d'aucun catalogue, au même titre que
 * le nom dont elles sortent. Les écrire en dur ici ferait de « AM » une
 * constante que la fonction pourrait cesser de produire sans que rien ne le
 * dise.
 */
export const FIXTURE_INITIALS = initialsOf(FIXTURE_NAME)

/**
 * Les organisations que voit l'écran de s15 pendant ce rendu.
 *
 * Ce sont **des données** : un nom et un identifiant public s'affichent tels
 * quels et ne viennent d'aucun catalogue. Le test les énumère pour les
 * distinguer d'un texte écrit en dur.
 */
export const FIXTURE_ORGANIZATION_NAME = 'Studio Martin'
export const FIXTURE_ORGANIZATION_SLUG = 'studio-martin'

/**
 * Les adresses affichées par les cartes « Membres » et « Invitations » (s16).
 *
 * Deux membres et deux invitations, et ce n'est pas de la générosité : un seul
 * membre laisserait la branche « retirer un autre » non rendue, et une seule
 * invitation ne montrerait qu'un des deux statuts. Le second membre est
 * `removable`, le premier ne l'est pas — les deux formes de la ligne passent
 * donc sous le filet.
 */
export const FIXTURE_MEMBER_EMAIL = 'bruno@example.test'
export const FIXTURE_INVITED_EMAIL = 'claire@example.test'
export const FIXTURE_EXPIRED_INVITED_EMAIL = 'david@example.test'

export const FIXTURE_ORGANIZATIONS = {
  current: {
    id: 'org_1',
    name: FIXTURE_ORGANIZATION_NAME,
    slug: FIXTURE_ORGANIZATION_SLUG,
    role: 'owner' as const,
  },
  memberships: [
    {
      id: 'org_1',
      name: FIXTURE_ORGANIZATION_NAME,
      slug: FIXTURE_ORGANIZATION_SLUG,
      role: 'owner' as const,
    },
  ],
  members: [
    {
      userId: 'usr_1',
      email: FIXTURE_EMAIL,
      role: 'owner' as const,
      removable: false,
      assignableRoles: [],
    },
    // s17 — une ligne qui porte **des boutons de rôle**, pour que leurs deux
    // libellés (visible et accessible) entrent dans le balayage du rendu.
    {
      userId: 'usr_2',
      email: FIXTURE_MEMBER_EMAIL,
      role: 'member' as const,
      removable: true,
      assignableRoles: ['admin' as const, 'owner' as const],
    },
  ],
  invitations: [
    { id: 'inv_1', email: FIXTURE_INVITED_EMAIL, status: 'pending' as const },
    { id: 'inv_2', email: FIXTURE_EXPIRED_INVITED_EMAIL, status: 'expired' as const },
  ],
  // Le rendu se fait avec les permissions d'un propriétaire : c'est l'écran
  // complet, donc celui dont **tous** les libellés doivent passer le filet.
  permissions: permissionsOf('owner'),
}

/** L'invitation que voit l'écran d'atterrissage pendant ce rendu (s16). */
export const FIXTURE_INVITATION = {
  organizationName: FIXTURE_ORGANIZATION_NAME,
  email: FIXTURE_INVITED_EMAIL,
  status: 'pending' as const,
}

export const FIXTURE_SESSIONS: readonly DescribedSession[] = [
  {
    id: 'ses_1',
    createdAt: FIXTURE_SESSION_CREATED_AT,
    expiresAt: new Date('2026-02-15T09:30:00Z'),
    ipAddress: FIXTURE_IP,
    userAgent: FIXTURE_USER_AGENT,
    current: true,
  },
]

/**
 * Les moyens de connexion affichés par l'écran de compte (s12).
 *
 * Deux, dont un déliable : la carte rend alors **les deux formes** — l'action
 * de déliement et la mention du dernier moyen —, si bien qu'aucune des deux
 * n'échappe au filet des textes rendus.
 */
export const FIXTURE_SIGN_IN_METHODS: readonly DescribedSignInMethod[] = [
  {
    id: 'acc_1',
    providerId: 'credential',
    createdAt: FIXTURE_SESSION_CREATED_AT,
    removable: true,
  },
  {
    id: 'acc_2',
    providerId: 'github',
    createdAt: FIXTURE_SESSION_CREATED_AT,
    removable: false,
  },
]

/**
 * Les passkeys affichées par l'écran de compte (s14).
 *
 * Trois, et c'est le minimum utile : une nommée et déliable, une **sans nom**
 * — le libellé de repli du catalogue passe alors sous le filet —, et une
 * dernière non déliable, qui rend la mention du dernier moyen de connexion à la
 * place du bouton. Une seule ligne laisserait deux de ces trois formes non
 * rendues.
 *
 * `FIXTURE_PASSKEY_NAME` est **une donnée** : elle s'affiche telle quelle et ne
 * vient d'aucun catalogue.
 */
export const FIXTURE_PASSKEY_NAME = 'MacBook de Alice'

export const FIXTURE_PASSKEYS: readonly DescribedPasskey[] = [
  {
    id: 'pk_1',
    name: FIXTURE_PASSKEY_NAME,
    createdAt: FIXTURE_SESSION_CREATED_AT,
    removable: true,
  },
  { id: 'pk_2', name: null, createdAt: FIXTURE_SESSION_CREATED_AT, removable: true },
  { id: 'pk_3', name: null, createdAt: FIXTURE_SESSION_CREATED_AT, removable: false },
]

/**
 * L'état lu par le double de `currentViewer`, à l'appel et non à la
 * construction : un même fichier de test rend l'écran d'accueil anonyme puis
 * connecté.
 */
export const viewerState: { value: ViewerFixture } = { value: SIGNED_IN }

/**
 * Ce que l'écran de facturation (s19) voit pendant ce rendu.
 *
 * Le prix formaté est **une donnée** — il vient d'`Intl`, pas d'un catalogue —
 * et le test l'énumère pour le distinguer d'un texte écrit en dur, comme le nom
 * d'une organisation ou l'adresse d'un membre.
 */
export const FIXTURE_BILLING_PRICE = new Intl.NumberFormat('fr', {
  style: 'currency',
  currency: 'EUR',
}).format(29)

const OFFER: BillingView['offers'][number] = {
  id: 'pro-monthly',
  mode: 'subscription',
  price: FIXTURE_BILLING_PRICE,
  interval: 'month',
  trialDays: 14,
  perSeat: true,
  current: false,
  owned: false,
}

/**
 * s20 — l'offre **unique**, dont la carte rend des textes qu'aucune offre
 * d'abonnement ne rend : « paiement unique », et « déjà acheté » quand elle est
 * possédée.
 */
const ONE_TIME_OFFER: BillingView['offers'][number] = {
  id: 'lifetime',
  mode: 'one_time',
  price: FIXTURE_BILLING_PRICE,
  interval: null,
  trialDays: null,
  perSeat: false,
  current: false,
  owned: false,
}

/** Sans abonnement : l'état d'entrée, et le seul qui rende les offres seules. */
export const FIXTURE_BILLING_NONE: BillingView = {
  state: 'none',
  hasAccess: false,
  hasSubscription: false,
  offers: [OFFER, ONE_TIME_OFFER],
  subscription: null,
  purchases: [],
  canManage: true,
  hasCustomer: false,
  canOpenPortal: false,
}

/** Paiement échoué : l'alerte en tête, le badge, et un abonnement au siège. */
export const FIXTURE_BILLING_PAST_DUE: BillingView = {
  state: 'past_due',
  hasAccess: true,
  hasSubscription: true,
  offers: [{ ...OFFER, current: true }],
  subscription: {
    offerId: 'pro-monthly',
    quantity: 4,
    renewsAt: FIXTURE_SESSION_CREATED_AT,
    cancelAtPeriodEnd: false,
    trialEnd: null,
  },
  purchases: [],
  canManage: true,
  hasCustomer: true,
  canOpenPortal: true,
}

/**
 * Résilié : la branche « accès jusqu'au … », la période d'essai affichée, et
 * l'offre **retirée du catalogue** — trois textes qu'aucun autre état ne rend.
 */
export const FIXTURE_BILLING_ENDING: BillingView = {
  state: 'ending',
  hasAccess: true,
  hasSubscription: true,
  offers: [OFFER],
  subscription: {
    offerId: null,
    quantity: 4,
    renewsAt: FIXTURE_SESSION_CREATED_AT,
    cancelAtPeriodEnd: true,
    trialEnd: FIXTURE_SESSION_CREATED_AT,
  },
  purchases: [],
  canManage: true,
  hasCustomer: true,
  canOpenPortal: true,
}

/**
 * s20 — **l'acheteur unique pur** : un achat payé, un achat remboursé, aucun
 * abonnement.
 *
 * C'est le rendu qui porte les textes que nul autre ne produit — le titre de
 * l'historique, « acheté le … », les deux badges de statut, « déjà acheté » sur
 * la carte de l'offre — et c'est aussi celui où le bouton du portail **ne doit
 * pas** apparaître (quatrième critère).
 */
export const FIXTURE_BILLING_PURCHASED: BillingView = {
  state: 'none',
  // L'accès **consolidé** : il vient de l'achat, sans aucun abonnement.
  hasAccess: true,
  hasSubscription: false,
  offers: [OFFER, { ...ONE_TIME_OFFER, owned: true }],
  subscription: null,
  purchases: [
    {
      offerId: 'lifetime',
      price: FIXTURE_BILLING_PRICE,
      purchasedAt: FIXTURE_SESSION_CREATED_AT,
      refunded: false,
    },
    // Une offre **retirée du catalogue** et un remboursement : la seconde
    // ligne rend le badge et le libellé que la première ne rend pas.
    {
      offerId: null,
      price: null,
      purchasedAt: FIXTURE_SESSION_CREATED_AT,
      refunded: true,
    },
  ],
  canManage: true,
  hasCustomer: true,
  // **Aucun portail** : il n'y a pas d'abonnement à gérer.
  canOpenPortal: false,
}

/** L'état lu par le double de `billing.view`, à l'appel et non à la construction. */
export const billingState: { value: BillingView } = { value: FIXTURE_BILLING_NONE }

/**
 * Le droit lu par le double d'`entitlements.allows` (s21), à l'appel.
 *
 * C'est la **lecture** qui est doublée, comme `billing.view` juste au-dessus —
 * pas la règle, qui vit dans `apps/web/lib/entitlements.ts` et qui est éprouvée
 * dans `tests/entitlements.test.ts`. Sans ce levier, l'écran réservé ne
 * rendrait qu'une de ses deux moitiés, et laquelle dépendrait de la
 * configuration de modules du dépôt.
 */
export const entitlementState: { value: boolean } = { value: false }

/**
 * Les scripts non essentiels que voient la bannière et l'écran de préférences
 * pendant ce rendu (s36).
 *
 * Deux, un par catégorie, et ce n'est pas de la générosité : le dépôt n'en
 * déclare aucun dans son état livré — c'est s39 qui apportera PostHog —, si
 * bien que ni la bannière ni les cases ne seraient rendues et que leurs
 * libellés sortiraient du filet. Deux catégories permettent en outre de rendre
 * un badge « accepté » **et** un badge « en attente » sur le même écran.
 *
 * Ce sont des chemins servis par l'application, jamais du texte affiché.
 */
export const FIXTURE_CONSENT_SCRIPTS = [
  {
    id: 'demo-analytics',
    category: 'analytics' as const,
    src: '/api/consent-probe/demo-analytics',
  },
  {
    id: 'demo-advertising',
    category: 'advertising' as const,
    src: '/api/consent-probe/demo-advertising',
  },
]
