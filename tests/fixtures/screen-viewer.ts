import type { DescribedSession } from '@repo/module-auth'

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
 * L'état lu par le double de `currentViewer`, à l'appel et non à la
 * construction : un même fichier de test rend l'écran d'accueil anonyme puis
 * connecté.
 */
export const viewerState: { value: ViewerFixture } = { value: SIGNED_IN }
