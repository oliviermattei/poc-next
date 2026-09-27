import { ADMIN_ORGANIZATIONS_SCREEN_PATH } from '@repo/module-organizations'
import { ADMIN_USERS_SCREEN_PATH } from '@repo/module-admin'
import { AdminOrganizationScreen, BackOfficeError } from '@repo/module-admin/presentation'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { admin } from '../../../../../lib/admin'
import { currentViewer } from '../../../../../lib/auth'
import { backOfficeIntl, backOfficeLinks } from '../../../../../lib/back-office'
import { appIntl } from '../../../../../lib/i18n'
import { organizations } from '../../../../../lib/organizations'

/** Zod sur le segment d'URL : un identifiant reste une entrée (`docs/security.md` §4). */
const ORGANIZATION_ID = z.string().trim().min(1).max(128)

/** `/console/organizations/<id>` — membres et rôles, offre et état d'abonnement. */
export default async function AdminOrganizationPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}) {
  if (!organizations.available || !admin.available) {
    notFound()
  }

  const { session } = await currentViewer()
  const intl = await appIntl()

  if (session === null) {
    // **404, jamais une redirection vers la connexion** (s60) : elle
    // apprendrait à un visiteur anonyme que la console existe.
    notFound()
  }

  const organizationId = ORGANIZATION_ID.safeParse((await params).id)

  if (!organizationId.success) {
    notFound()
  }

  const view = await admin.organization({
    viewerId: session.userId,
    organizationId: organizationId.data,
  })

  if (!view.ok && view.error === 'not_found') {
    notFound()
  }

  const backOffice = backOfficeIntl(intl)

  if (!view.ok) {
    return <BackOfficeError intl={backOffice} />
  }

  return (
    <AdminOrganizationScreen
      view={view.view}
      intl={backOffice}
      links={backOfficeLinks(ADMIN_ORGANIZATIONS_SCREEN_PATH)}
      // Le détail d'un membre : **la même dérivation**, sur le chemin de
      // l'autre liste. Écrit une fois, ici comme dans les redirections des
      // routes du module (revue F6).
      accountPath={backOfficeLinks(ADMIN_USERS_SCREEN_PATH).detailPath}
    />
  )
}
