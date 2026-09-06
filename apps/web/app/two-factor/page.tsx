import { Card, CardContent, PageHeader, Separator } from '@repo/ui'

import { authRoutePath, safeRedirectPath } from '../../lib/auth'
import { appIntl } from '../../lib/i18n'
import { TwoFactorForm } from './two-factor-form'

/**
 * L'écran de vérification du second facteur (s13).
 *
 * **Public**, et il ne peut pas être autre chose : on y arrive après le mot de
 * passe, quand la bibliothèque a détruit la session qu'elle venait de créer et
 * posé un cookie de défi. Il n'y a rien à protéger ici — le cookie de défi est
 * la seule chose qui vaut, et c'est le serveur qui le juge.
 *
 * La destination de retour est filtrée **côté serveur**, une fois, par la même
 * règle que l'écran de connexion : `?next=https://evil.test` retombe sur le
 * tableau de bord (`docs/security.md` §4).
 *
 * Deux formulaires plutôt qu'un basculeur, comme `/sign-in` en porte deux : le
 * code de l'application, et le code de secours. Le second est un moyen de
 * dernier recours ; le mettre derrière un bouton de bascule le rendrait
 * introuvable au moment précis où on le cherche.
 *
 * **Habillé avec les cinq autres** (s46, constat F4 de la revue). Cet écran
 * était resté hors de la famille — pas de carte, pas de largeur de lecture, un
 * `<h1>` écrit à la main — alors qu'il est un écran d'authentification, servi
 * au milieu du parcours de connexion. Il prend donc la même colonne bornée, le
 * même `PageHeader` et la même carte, et **les deux moyens tiennent dans une
 * seule carte** pour la même raison que `/sign-in` : ils mènent à la même
 * session. La liste balayée par `e2e/auth-screens.spec.ts` n'est plus écrite,
 * elle est dérivée du disque : un septième écran y entre sans que personne
 * n'ait à y penser.
 */
export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { t, path } = await appIntl()
  const next = typeof params.next === 'string' ? params.next : null
  const destination = path(safeRedirectPath(next, '/'))

  return (
    <main className="mx-auto flex w-full max-w-md min-w-0 flex-col gap-6">
      <PageHeader title={t('app.twoFactor.title')} description={t('app.twoFactor.description')} />

      <Card className="min-w-0">
        <CardContent className="flex min-w-0 flex-col gap-6">
          <TwoFactorForm
            action={authRoutePath('twoFactorVerify')}
            labelKey="app.twoFactor.codeLabel"
            submitLabelKey="app.twoFactor.submit"
            autoComplete="one-time-code"
            numeric
            destination={destination}
          />

          <Separator />

          <div className="flex min-w-0 flex-col gap-4">
            {/*
              `h2` du document, à la taille d'un titre de sous-section
              (`text-xl`) : c'est une section de la carte, pas une seconde page.
              `/sign-in` écrit son second formulaire exactement ainsi.
            */}
            <div className="flex min-w-0 flex-col gap-2">
              <h2 className="text-xl font-semibold">{t('app.twoFactor.backup.title')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('app.twoFactor.backup.description')}
              </p>
            </div>

            <TwoFactorForm
              action={authRoutePath('twoFactorBackupCode')}
              labelKey="app.twoFactor.backup.codeLabel"
              submitLabelKey="app.twoFactor.backup.submit"
              autoComplete="off"
              variant="secondary"
              destination={destination}
            />
          </div>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        <a
          className="rounded-sm underline underline-offset-4 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          href={path('/sign-in')}
        >
          {t('app.twoFactor.links.signIn')}
        </a>
      </p>
    </main>
  )
}
