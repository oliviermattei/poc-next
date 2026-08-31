import { authRoutePath } from '../../lib/auth'
import { appIntl } from '../../lib/i18n'
import { AuthForm } from '../auth-form'

export default async function SignUpPage() {
  const { t, path } = await appIntl()

  return (
    <main>
      <h1>{t('app.signUp.title')}</h1>
      <AuthForm
        action={authRoutePath('signUp')}
        fields={[
          { name: 'email', labelKey: 'app.auth.field.email', type: 'email', autoComplete: 'email' },
          {
            name: 'password',
            labelKey: 'app.auth.field.password',
            type: 'password',
            autoComplete: 'new-password',
          },
        ]}
        submitLabelKey="app.signUp.submit"
        successMessageKey="app.signUp.done"
      />
      <p>
        <a href={path('/sign-in')}>{t('app.signUp.haveAccount')}</a>
      </p>
    </main>
  )
}
