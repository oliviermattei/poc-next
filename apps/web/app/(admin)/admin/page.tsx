import { ADMIN_DASHBOARD_SCREEN_PATH } from '@repo/module-admin'
import { AdminDashboardScreen, BackOfficeError } from '@repo/module-admin/presentation'
import { notFound, redirect } from 'next/navigation'

import { admin } from '../../../lib/admin'
import { currentViewer } from '../../../lib/auth'
import { backOfficeChrome, backOfficeIntl } from '../../../lib/back-office'
import { appIntl } from '../../../lib/i18n'
import { BackOfficeActions } from '../back-office-actions'

/**
 * `/admin` — le tableau de bord, écran d'accueil du back-office (s60).
 *
 * Les trois refus des autres écrans, dans le même ordre et pour les mêmes
 * raisons :
 *
 * | Qui | Ce qu'il obtient |
 * |---|---|
 * | un visiteur anonyme | redirection vers la connexion, avec son retour |
 * | un compte qui n'administre pas | **404** — l'écran n'existe pas |
 * | une plateforme sans superadmin | **404**, pour tout le monde |
 *
 * **Un bloc en panne ne fait pas tomber l'écran** : la lecture rend cinq blocs
 * indépendants, et c'est l'écran qui montre l'alerte à la place du chiffre
 * manquant. Le refus global, lui, reste celui de la garde.
 */
export default async function AdminDashboardPage() {
  if (!admin.available) {
    notFound()
  }

  const { session, account } = await currentViewer()
  const intl = await appIntl()

  if (session === null) {
    redirect(`${intl.path('/sign-in')}?next=${encodeURIComponent(ADMIN_DASHBOARD_SCREEN_PATH)}`)
  }

  const view = await admin.dashboard({ viewerId: session.userId })

  if (!view.ok && view.error === 'not_found') {
    notFound()
  }

  if (!view.ok) {
    return <BackOfficeError intl={backOfficeIntl(intl)} />
  }

  return (
    <AdminDashboardScreen
      view={view.view}
      intl={backOfficeIntl(intl)}
      chrome={backOfficeChrome(
        session,
        intl,
        ADMIN_DASHBOARD_SCREEN_PATH,
        <BackOfficeActions
          intl={intl}
          account={account === null ? null : { email: account.email, name: account.name }}
        />,
      )}
    />
  )
}
