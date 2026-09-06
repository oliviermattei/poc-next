import { ADMIN_USERS_SCREEN_PATH } from '@repo/module-admin'
import { AdminUserScreen, BackOfficeError } from '@repo/module-admin/presentation'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'

import { admin } from '../../../../lib/admin'
import { currentViewer } from '../../../../lib/auth'
import {
  backOfficeActions,
  backOfficeIntl,
  backOfficeLinks,
  backOfficeNavigation,
} from '../../../../lib/back-office'
import { appIntl } from '../../../../lib/i18n'

/**
 * `/admin/users/<id>` — le détail d'un compte.
 *
 * Mêmes refus que la liste, dans le même ordre, et le même **404 plutôt que
 * 403**. Un identifiant que le socle ne connaît pas reçoit lui aussi 404 : rien
 * ici ne confirme l'existence d'un compte.
 *
 * **Zod sur le paramètre d'URL** (`docs/security.md` §4) : un identifiant est
 * une entrée, même quand il vient d'un segment de chemin.
 */
const USER_ID = z.string().trim().min(1).max(128)

export default async function AdminUserPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}) {
  // Le module coupé décide avant la session, comme sur la liste.
  if (!admin.available) {
    notFound()
  }

  const { session } = await currentViewer()
  const intl = await appIntl()

  if (session === null) {
    redirect(`${intl.path('/sign-in')}?next=${encodeURIComponent(ADMIN_USERS_SCREEN_PATH)}`)
  }

  const userId = USER_ID.safeParse((await params).id)

  if (!userId.success) {
    notFound()
  }

  const view = await admin.account({ viewerId: session.userId, userId: userId.data })

  if (!view.ok && view.error === 'not_found') {
    notFound()
  }

  const navigation = backOfficeNavigation(session, intl, ADMIN_USERS_SCREEN_PATH)
  const backOffice = backOfficeIntl(intl)

  if (!view.ok) {
    return <BackOfficeError intl={backOffice} />
  }

  return (
    <AdminUserScreen
      view={view.view}
      intl={backOffice}
      navigation={navigation}
      links={backOfficeLinks(ADMIN_USERS_SCREEN_PATH)}
      actions={backOfficeActions}
    />
  )
}
