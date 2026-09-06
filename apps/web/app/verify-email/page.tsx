import { Alert, Card, CardContent, PageHeader } from '@repo/ui'

import { authRoutePath } from '../../lib/auth'
import { appIntl } from '../../lib/i18n'
import { AuthForm } from '../auth-form'

/**
 * L'écran d'échec de vérification.
 *
 * Le succès ne passe pas par ici : la route du module redirige vers la
 * connexion. Cet écran ne sert donc qu'au lien **expiré ou déjà consommé**, et
 * il le dit explicitement plutôt que de laisser croire à une vérification.
 *
 * Le lien mort est un `Alert` `warning` et non `destructive` : rien n'est
 * cassé, il faut en redemander un — la même distinction que le refus de débit
 * de `app/auth-form.tsx`. Et **la couleur ne porte jamais seule le message** :
 * le texte le dit, comme la recherche de s46 l'exige des écrans
 * d'authentification.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { t } = await appIntl()

  return (
    <main className="mx-auto flex w-full max-w-md min-w-0 flex-col gap-6">
      <PageHeader title={t('app.verifyEmail.title')} />
      {params.error === undefined ? (
        <p className="text-sm text-muted-foreground">{t('app.verifyEmail.hint')}</p>
      ) : (
        <Alert variant="warning" role="alert">
          {t('app.verifyEmail.expired')}
        </Alert>
      )}
      <Card className="min-w-0">
        <CardContent>
          <AuthForm
            action={authRoutePath('sendVerificationEmail')}
            fields={[
              {
                name: 'email',
                labelKey: 'app.auth.field.email',
                type: 'email',
                autoComplete: 'email',
              },
            ]}
            submitLabelKey="app.verifyEmail.submit"
            successMessageKey="app.verifyEmail.sent"
          />
        </CardContent>
      </Card>
    </main>
  )
}
