import { authRoutePath } from '../../lib/auth'
import { AuthForm } from '../auth-form'

/**
 * L'écran d'échec de vérification.
 *
 * Le succès ne passe pas par ici : la route du module redirige vers la
 * connexion. Cet écran ne sert donc qu'au lien **expiré ou déjà consommé**, et
 * il le dit explicitement plutôt que de laisser croire à une vérification.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams

  return (
    <main>
      <h1>Vérification de l’adresse email</h1>
      {params.error === undefined ? (
        <p>Suivez le lien reçu par email pour activer votre compte.</p>
      ) : (
        <p role="alert">Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau.</p>
      )}
      <AuthForm
        action={authRoutePath('sendVerificationEmail')}
        fields={[{ name: 'email', label: 'Adresse email', type: 'email', autoComplete: 'email' }]}
        submitLabel="Recevoir un nouveau lien"
        successMessage="Si cette adresse attend une vérification, un lien vient de partir."
      />
    </main>
  )
}
