import { ADMIN_REVENUE_SCREEN_PATH } from '@repo/module-billing'
import { AdminRevenueScreen, BackOfficeError } from '@repo/module-admin/presentation'
import { notFound, redirect } from 'next/navigation'

import { admin } from '../../../lib/admin'
import { currentViewer } from '../../../lib/auth'
import { backOfficeIntl, backOfficeNavigation } from '../../../lib/back-office'
import { billing } from '../../../lib/billing'
import { appIntl } from '../../../lib/i18n'

/**
 * `/admin/revenue` — les indicateurs de revenu de la plateforme (s38).
 *
 * Deux absences font disparaître l'écran, et chacune est décidée **avant** la
 * session — une redirection vers la connexion apprendrait son existence à un
 * visiteur anonyme : le module qui porte les montants, et celui qui porte le
 * back-office. C'est la forme de `admin/organizations/page.tsx`, et ce que
 * `pnpm test:minimal-profile` mesure : l'entrée de navigation disparaît avec le
 * module (elle est dérivée du registre) et l'adresse vers laquelle elle
 * pointait répond 404 sur une vraie requête HTTP.
 *
 * **Un seul paramètre d'URL** : la période (critère 4). Ni recherche, ni
 * pagination — ce sont des indicateurs, pas une liste. Et la période ne borne
 * que la moitié **constatée** : un achat porte une date d'encaissement, le parc
 * d'abonnements n'a aucun instantané daté, si bien que le récurrent reste
 * l'état courant et que l'écran le dit à côté du chiffre.
 *
 * Le paramètre entre **brut**, comme ceux des listes : sa forme est lue par le
 * back-office, son vocabulaire par la facturation, qui seule sait où chaque
 * période commence.
 */
export default async function AdminRevenuePage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!billing.available || !admin.available) {
    notFound()
  }

  const { session } = await currentViewer()
  const intl = await appIntl()

  if (session === null) {
    redirect(`${intl.path('/sign-in')}?next=${encodeURIComponent(ADMIN_REVENUE_SCREEN_PATH)}`)
  }

  const view = await admin.revenue({
    viewerId: session.userId,
    parameters: (await searchParams) ?? {},
  })

  if (!view.ok && view.error === 'not_found') {
    notFound()
  }

  const navigation = backOfficeNavigation(session, intl, ADMIN_REVENUE_SCREEN_PATH)
  const backOffice = backOfficeIntl(intl)

  if (!view.ok) {
    return <BackOfficeError intl={backOffice} />
  }

  return (
    <AdminRevenueScreen
      view={view.view}
      intl={backOffice}
      navigation={navigation}
      screenPath={ADMIN_REVENUE_SCREEN_PATH}
    />
  )
}
