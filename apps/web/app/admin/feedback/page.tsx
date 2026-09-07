import { AdminFeedbackScreen, BackOfficeError } from '@repo/module-admin/presentation'
import { notFound, redirect } from 'next/navigation'

import { admin } from '../../../lib/admin'
import { currentViewer } from '../../../lib/auth'
import { backOfficeIntl, backOfficeNavigation } from '../../../lib/back-office'
import { feedback, feedbackRoutePath, ADMIN_FEEDBACK_SCREEN_PATH } from '../../../lib/feedback'
import { appIntl } from '../../../lib/i18n'

/**
 * `/admin/feedback` — les retours envoyés depuis l'application (s43,
 * critères 4 et 5).
 *
 * Deux absences font disparaître l'écran, et chacune est décidée **avant** la
 * session — une redirection vers la connexion apprendrait son existence à un
 * visiteur anonyme, et le balayage de `pnpm test:minimal-profile` la lirait
 * comme un 200 : le module qui porte les retours, et celui qui porte le
 * back-office. C'est la forme de `admin/subscriptions/page.tsx`.
 *
 * En pratique la première suffirait, `feedback` déclarant `admin` dans ses
 * requis : les deux sont montés, ou aucun ne l'est. Les deux sont écrites quand
 * même — un écran qui s'appuierait sur une déclaration de dépendance pour ne pas
 * se rendre refuserait par déduction, pas par mesure.
 *
 * Les paramètres d'adresse entrent **bruts** : leur forme est lue par le
 * back-office, avec Zod. Un écran qui les aurait interprétés avant serait une
 * seconde frontière.
 */
export default async function AdminFeedbackPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!feedback.available || !admin.available) {
    notFound()
  }

  const { session } = await currentViewer()
  const intl = await appIntl()

  if (session === null) {
    redirect(`${intl.path('/sign-in')}?next=${encodeURIComponent(ADMIN_FEEDBACK_SCREEN_PATH)}`)
  }

  const view = await admin.feedback({
    viewerId: session.userId,
    parameters: (await searchParams) ?? {},
  })

  if (!view.ok && view.error === 'not_found') {
    notFound()
  }

  const navigation = backOfficeNavigation(session, intl, ADMIN_FEEDBACK_SCREEN_PATH)
  const backOffice = backOfficeIntl(intl)

  if (!view.ok) {
    return <BackOfficeError intl={backOffice} />
  }

  return (
    <AdminFeedbackScreen
      view={view.view}
      intl={backOffice}
      navigation={navigation}
      screenPath={ADMIN_FEEDBACK_SCREEN_PATH}
      handleAction={feedbackRoutePath('handle')}
    />
  )
}
