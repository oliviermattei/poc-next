import { authRoutePath, safeRedirectPath } from '../../lib/auth'
import { AuthForm } from '../auth-form'

/**
 * L'écran de connexion.
 *
 * La destination de retour est filtrée **côté serveur**, une seule fois, par la
 * règle du module : `?next=https://evil.test` retombe sur le tableau de bord
 * (`docs/security.md` §4). Le composant client ne reçoit qu'un chemin déjà jugé.
 *
 * Ce repli est le **tableau de bord**, et pas l'écran de compte : c'est le
 * critère 1 de s08 — « une fois connecté, l'utilisateur atteint un tableau de
 * bord avec navigation latérale et menu de compte ». s07 repliait sur
 * `/account` faute de tableau de bord ; s08 en livre un, et le commentaire
 * ci-dessus redevient vrai. Une demande explicite (`?next=/account`) reste
 * respectée : c'est le repli qui change, pas la règle.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const next = typeof params.next === 'string' ? params.next : null
  const destination = safeRedirectPath(next, '/')

  return (
    <main>
      <h1>Se connecter</h1>

      {params.verified === undefined ? null : (
        <p role="status">Votre adresse est vérifiée. Vous pouvez vous connecter.</p>
      )}
      {params.email_changed === undefined ? null : (
        <p role="status">Votre nouvelle adresse est confirmée. Reconnectez-vous.</p>
      )}
      {params.reset === undefined ? null : (
        <p role="status">Votre mot de passe est changé. Vous pouvez vous connecter.</p>
      )}

      <AuthForm
        action={authRoutePath('signIn')}
        fields={[
          { name: 'email', label: 'Adresse email', type: 'email', autoComplete: 'email' },
          {
            name: 'password',
            label: 'Mot de passe',
            type: 'password',
            autoComplete: 'current-password',
          },
        ]}
        submitLabel="Se connecter"
        redirectTo={destination}
      />

      <h2>Recevoir un lien de connexion</h2>
      <AuthForm
        action={authRoutePath('magicLink')}
        fields={[
          { name: 'email', label: 'Adresse email (lien de connexion)', type: 'email', autoComplete: 'email' },
        ]}
        hiddenValues={{ callbackURL: destination }}
        submitLabel="Envoyer un lien"
        successMessage="Si cette adresse a un compte, un lien de connexion vient de partir."
      />

      <p>
        <a href="/forgot-password">Mot de passe oublié</a> ·{' '}
        <a href="/verify-email">Adresse non vérifiée</a> · <a href="/sign-up">Créer un compte</a>
      </p>
    </main>
  )
}
