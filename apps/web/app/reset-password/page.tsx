import { authRoutePath } from '../../lib/auth'
import { appIntl } from '../../lib/i18n'
import { AuthForm } from '../auth-form'

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { t, path } = await appIntl()
  const token = typeof params.token === 'string' ? params.token : null

  if (token === null) {
    return (
      <main>
        <h1>{t('app.resetPassword.title')}</h1>
        <p role="alert">
          {t('app.resetPassword.incomplete')}{' '}
          <a href={path('/forgot-password')}>{t('app.resetPassword.requestNew')}</a>
        </p>
      </main>
    )
  }

  return (
    <main>
      <h1>{t('app.resetPassword.title')}</h1>
      <AuthForm
        action={authRoutePath('resetPassword')}
        fields={[
          {
            name: 'newPassword',
            labelKey: 'app.auth.field.newPassword',
            type: 'password',
            autoComplete: 'new-password',
          },
        ]}
        hiddenValues={{ token }}
        submitLabelKey="app.resetPassword.submit"
        redirectTo={`${path('/sign-in')}?reset=1`}
      />
    </main>
  )
}
