import { authRoutePath } from '../../lib/auth'
import { appIntl } from '../../lib/i18n'
import { AuthForm } from '../auth-form'

export default async function ForgotPasswordPage() {
  const { t } = await appIntl()

  return (
    <main>
      <h1>{t('app.forgotPassword.title')}</h1>
      <AuthForm
        action={authRoutePath('requestPasswordReset')}
        fields={[
          { name: 'email', labelKey: 'app.auth.field.email', type: 'email', autoComplete: 'email' },
        ]}
        submitLabelKey="app.forgotPassword.submit"
        // La réponse ne dit jamais si le compte existe : le message est le même
        // dans les deux cas (`docs/security.md` §7).
        successMessageKey="app.forgotPassword.sent"
      />
    </main>
  )
}
