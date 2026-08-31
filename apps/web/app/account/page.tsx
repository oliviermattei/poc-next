import { redirect } from 'next/navigation'

import { authRoutePath, currentSession } from '../../lib/auth'
import { SignOutButton } from '../sign-out-button'

/**
 * Un écran protégé.
 *
 * Sans session, il **redirige vers la connexion en emportant la destination**,
 * et l'utilisateur y revient une fois authentifié. La vérification est faite
 * côté serveur : masquer l'écran n'a jamais été une permission
 * (`docs/security.md` §3).
 */
export default async function AccountPage() {
  const session = await currentSession()

  if (session === null) {
    redirect('/sign-in?next=/account')
  }

  return (
    <main>
      <h1>Mon compte</h1>
      <p>Vous êtes connecté.</p>
      <SignOutButton action={authRoutePath('signOut')} />
    </main>
  )
}
