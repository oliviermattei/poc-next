import { Separator } from '@repo/ui'

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
    <main className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{t('app.twoFactor.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('app.twoFactor.description')}</p>
      </div>

      <TwoFactorForm
        action={authRoutePath('twoFactorVerify')}
        labelKey="app.twoFactor.codeLabel"
        submitLabelKey="app.twoFactor.submit"
        autoComplete="one-time-code"
        numeric
        destination={destination}
      />

      <Separator />

      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">{t('app.twoFactor.backup.title')}</h2>
        <p className="text-xs text-muted-foreground">{t('app.twoFactor.backup.description')}</p>
      </div>

      <TwoFactorForm
        action={authRoutePath('twoFactorBackupCode')}
        labelKey="app.twoFactor.backup.codeLabel"
        submitLabelKey="app.twoFactor.backup.submit"
        autoComplete="off"
        variant="secondary"
        destination={destination}
      />

      <p className="text-xs">
        <a href={path('/sign-in')}>{t('app.twoFactor.links.signIn')}</a>
      </p>
    </main>
  )
}
