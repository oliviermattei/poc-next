import { Alert, Card, CardContent, PageHeader } from '@repo/ui'

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
      <main className="mx-auto flex w-full max-w-md min-w-0 flex-col gap-6">
        <PageHeader title={t('app.resetPassword.title')} />
        {/*
          `warning` plutôt que `destructive` : un lien incomplet ou déjà servi
          n'est pas une panne, c'est une demande à refaire — et le message
          porte lui-même le chemin de sortie, la couleur ne dit rien toute
          seule.
        */}
        <Alert variant="warning" role="alert">
          {t('app.resetPassword.incomplete')}{' '}
          <a
            className="rounded-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
            href={path('/forgot-password')}
          >
            {t('app.resetPassword.requestNew')}
          </a>
        </Alert>
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-md min-w-0 flex-col gap-6">
      <PageHeader title={t('app.resetPassword.title')} />
      <Card className="min-w-0">
        <CardContent>
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
        </CardContent>
      </Card>
    </main>
  )
}
