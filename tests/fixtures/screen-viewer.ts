import type {
  DescribedPasskey,
  DescribedSession,
  DescribedSignInMethod,
} from '@repo/module-auth'
import { permissionsOf } from '@repo/module-organizations'

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
