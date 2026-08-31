import { authRoutePath } from '../../lib/auth'
import { appIntl } from '../../lib/i18n'
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
  const { t } = await appIntl()

  return (
    <main>
      <h1>{t('app.verifyEmail.title')}</h1>
      {params.error === undefined ? (
        <p>{t('app.verifyEmail.hint')}</p>
      ) : (
        <p role="alert">{t('app.verifyEmail.expired')}</p>
      )}
      <AuthForm
        action={authRoutePath('sendVerificationEmail')}
        fields={[
          { name: 'email', labelKey: 'app.auth.field.email', type: 'email', autoComplete: 'email' },
        ]}
        submitLabelKey="app.verifyEmail.submit"
        successMessageKey="app.verifyEmail.sent"
      />
    </main>
  )
}
