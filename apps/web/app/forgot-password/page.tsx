import { Card, CardContent, PageHeader } from '@repo/ui'

import { authRoutePath } from '../../lib/auth'
import { appIntl } from '../../lib/i18n'
import { AuthForm } from '../auth-form'

/**
 * La demande de réinitialisation.
 *
 * La colonne des six écrans d'authentification est la même : une largeur de
 * lecture bornée, centrée dans la coquille. **Le design system ne fixe aucune
 * largeur de formulaire** — `max-w-md` est le choix de ces écrans, pas une
 * règle du système. Le manque est écrit dans `docs/design-system.md`, § « Lacune
 * : la liaison de formulaire, et la largeur d'un écran centré (s46) », et pas
 * seulement ici.
 */
export default async function ForgotPasswordPage() {
  const { t } = await appIntl()

  return (
    <main className="mx-auto flex w-full max-w-md min-w-0 flex-col gap-6">
      <PageHeader title={t('app.forgotPassword.title')} />
      <Card className="min-w-0">
        <CardContent>
          <AuthForm
            action={authRoutePath('requestPasswordReset')}
            fields={[
              {
                name: 'email',
                labelKey: 'app.auth.field.email',
                type: 'email',
                autoComplete: 'email',
              },
            ]}
            submitLabelKey="app.forgotPassword.submit"
            // La réponse ne dit jamais si le compte existe : le message est le
            // même dans les deux cas (`docs/security.md` §7).
            successMessageKey="app.forgotPassword.sent"
          />
        </CardContent>
      </Card>
    </main>
  )
}
