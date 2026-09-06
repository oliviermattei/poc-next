import { ADMIN_ORGANIZATIONS_SCREEN_PATH } from '@repo/module-organizations'
import { AdminOrganizationsScreen, BackOfficeError } from '@repo/module-admin/presentation'
import { notFound, redirect } from 'next/navigation'

import { admin } from '../../../lib/admin'
import { currentViewer } from '../../../lib/auth'
import { backOfficeIntl, backOfficeLinks, backOfficeNavigation } from '../../../lib/back-office'
import { appIntl } from '../../../lib/i18n'
import { organizations } from '../../../lib/organizations'

/**
 * `/admin/organizations` — la liste des organisations.
 *
 * Un refus de plus que la liste des comptes, et il est en **premier** : le
 * produit peut ne pas avoir d'organisations du tout. C'est le même arbitrage
 * que `app/organizations/page.tsx` — la page existe toujours sur le disque, et
 * `notFound()` décide sur une **donnée** rendue par le point de composition.
 *
 * Ce refus est ce que `pnpm test:minimal-profile` mesure : l'entrée de
 * navigation du back-office disparaît avec le module (elle est dérivée du
 * registre), et l'adresse vers laquelle elle pointait répond 404 sur une vraie
 * requête HTTP. Les deux moitiés, pas l'une des deux.
 */
export default async function AdminOrganizationsPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  // **Deux absences, et chacune fait disparaître l'écran** : le module qui
  // porte les organisations, et celui qui porte le back-office. Toutes deux
  // décidées avant la session — une redirection vers la connexion apprendrait
  // l'existence de l'écran à un visiteur anonyme.
  if (!organizations.available || !admin.available) {
    notFound()
  }

  const { session } = await currentViewer()
  const intl = await appIntl()

  if (session === null) {
    redirect(
      `${intl.path('/sign-in')}?next=${encodeURIComponent(ADMIN_ORGANIZATIONS_SCREEN_PATH)}`,
    )
  }

  const view = await admin.organizations({
    viewerId: session.userId,
    parameters: (await searchParams) ?? {},
  })

  if (!view.ok && view.error === 'not_found') {
    notFound()
  }

  const navigation = backOfficeNavigation(session, intl, ADMIN_ORGANIZATIONS_SCREEN_PATH)
  const backOffice = backOfficeIntl(intl)

  if (!view.ok) {
    return <BackOfficeError intl={backOffice} />
  }

  return (
    <AdminOrganizationsScreen
      view={view.view}
      intl={backOffice}
      navigation={navigation}
      links={backOfficeLinks(ADMIN_ORGANIZATIONS_SCREEN_PATH)}
    />
  )
}
