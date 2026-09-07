import { ADMIN_SUBSCRIPTIONS_SCREEN_PATH } from '@repo/module-marketing'
import { AdminSubscriptionsScreen, BackOfficeError } from '@repo/module-admin/presentation'
import { notFound, redirect } from 'next/navigation'

import { admin } from '../../../lib/admin'
import { currentViewer } from '../../../lib/auth'
import {
  backOfficeExportSubscriptions,
  backOfficeIntl,
  backOfficeNavigation,
} from '../../../lib/back-office'
import { appIntl } from '../../../lib/i18n'
import { marketingSubscriptions } from '../../../lib/marketing'

/**
 * `/admin/subscriptions` — les inscriptions publiques (s37c).
 *
 * Deux absences font disparaître l'écran, et chacune est décidée **avant** la
 * session — une redirection vers la connexion apprendrait son existence à un
 * visiteur anonyme : le module qui porte les inscriptions, et celui qui porte
 * le back-office. C'est la forme de `admin/organizations/page.tsx` et de
 * `admin/revenue/page.tsx`.
 *
 * **Les deux moitiés ne sont pas tenues par la même commande**, et l'écrire
 * ici est le prix de l'avoir eu faux une fois (revue de s37c, constat 4) :
 *
 * - back-office coupé → `pnpm test:minimal-profile`, qui coupe `admin` ;
 * - site public coupé → `pnpm test:socle`, la **seule des deux** qui le coupe.
 *   `minimal-profile` ne l'atteint pas : son balayage dérive les entrées de
 *   navigation des modules **coupés**, et celle-ci est déclarée par le site
 *   public, activé dans ce profil.
 *
 * Dans les deux configurations, `tests/rendered-text.test.ts` dérive le refus
 * de l'état des modules — c'est lui qui rougit quand on neutralise l'une des
 * deux moitiés. `e2e/admin.spec.ts` y ajoute ce qu'un appel direct à cette
 * fonction ne peut pas voir : le **statut servi**, et le fait que le refus
 * précède la résolution de session — une redirection vers la connexion
 * apprendrait à un anonyme que l'écran existe, et un balayage qui suit les
 * redirections la lirait comme un 200.
 *
 * Les paramètres d'adresse entrent **bruts** : leur forme est lue par le
 * back-office, avec Zod. Un écran qui les aurait interprétés avant serait une
 * seconde frontière.
 */
export default async function AdminSubscriptionsPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!marketingSubscriptions.available || !admin.available) {
    notFound()
  }

  const { session } = await currentViewer()
  const intl = await appIntl()

  if (session === null) {
    redirect(
      `${intl.path('/sign-in')}?next=${encodeURIComponent(ADMIN_SUBSCRIPTIONS_SCREEN_PATH)}`,
    )
  }

  const view = await admin.subscriptions({
    viewerId: session.userId,
    parameters: (await searchParams) ?? {},
  })

  if (!view.ok && view.error === 'not_found') {
    notFound()
  }

  const navigation = backOfficeNavigation(session, intl, ADMIN_SUBSCRIPTIONS_SCREEN_PATH)
  const backOffice = backOfficeIntl(intl)

  if (!view.ok) {
    return <BackOfficeError intl={backOffice} />
  }

  return (
    <AdminSubscriptionsScreen
      view={view.view}
      intl={backOffice}
      navigation={navigation}
      screenPath={ADMIN_SUBSCRIPTIONS_SCREEN_PATH}
      exportAction={backOfficeExportSubscriptions}
    />
  )
}
