import { authRoutePath } from '../../lib/auth'
import { AuthForm } from '../auth-form'

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const token = typeof params.token === 'string' ? params.token : null

  if (token === null) {
    return (
      <main>
        <h1>Réinitialiser le mot de passe</h1>
        <p role="alert">
          Ce lien est incomplet ou a déjà servi. <a href="/forgot-password">Demandez-en un nouveau</a>.
        </p>
      </main>
    )
  }

  return (
    <main>
      <h1>Réinitialiser le mot de passe</h1>
      <AuthForm
        action={authRoutePath('resetPassword')}
        fields={[
          {
            name: 'newPassword',
            label: 'Nouveau mot de passe',
            type: 'password',
            autoComplete: 'new-password',
          },
        ]}
        hiddenValues={{ token }}
        submitLabel="Changer le mot de passe"
        redirectTo="/sign-in?reset=1"
      />
    </main>
  )
}
