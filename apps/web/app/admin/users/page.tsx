import { ADMIN_USERS_SCREEN_PATH } from '@repo/module-admin'
import { AdminUsersScreen, BackOfficeError } from '@repo/module-admin/presentation'
import { notFound, redirect } from 'next/navigation'

import { admin } from '../../../lib/admin'
import { currentViewer } from '../../../lib/auth'
import { backOfficeIntl, backOfficeLinks, backOfficeNavigation } from '../../../lib/back-office'
import { appIntl } from '../../../lib/i18n'

/**
 * `/admin/users` — la liste des comptes de la plateforme.
 *
 * Trois refus, dans cet ordre, et aucun ne nomme un module :
 *
 * | Qui | Ce qu'il obtient |
 * |---|---|
 * | un visiteur anonyme | redirection vers la connexion, avec son retour |
 * | un compte qui n'administre pas | **404** — l'écran n'existe pas |
 * | une plateforme sans superadmin | **404**, pour tout le monde |
 *
 * **404 et jamais 403** (`docs/security.md` §3) : un 403 confirmerait que le
 * back-office existe et que ce compte n'y a pas droit. La garde n'est pas
 * écrite ici — elle vit dans le module, où elle sert aussi ses routes ; cette
 * page ne fait que traduire son refus en réponse HTTP.
 *
 * Les paramètres d'URL sont passés **bruts** : c'est le module qui les lit, avec
 * Zod. Une lecture ici serait une seconde frontière, donc une seconde vérité.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  // **Le module coupé décide avant la session** : une redirection vers la
  // connexion apprendrait à un visiteur anonyme que cet écran existe, et le
  // balayage de `pnpm test:minimal-profile` la lit comme un 200 — il suit les
  // redirections. C'est le même arbitrage que `organizations.available`, sur
  // une **donnée** et jamais sur un identifiant de module.
  if (!admin.available) {
    notFound()
  }

  const { session } = await currentViewer()
  const intl = await appIntl()

  if (session === null) {
    // Le chemin **interne** part dans `next` : c'est l'écran de connexion qui le
    // met dans la forme publique de sa locale, une seule fois.
    redirect(`${intl.path('/sign-in')}?next=${encodeURIComponent(ADMIN_USERS_SCREEN_PATH)}`)
  }

  const view = await admin.accounts({
    viewerId: session.userId,
    parameters: (await searchParams) ?? {},
  })

  if (!view.ok && view.error === 'not_found') {
    notFound()
  }

  const navigation = backOfficeNavigation(session, intl, ADMIN_USERS_SCREEN_PATH)
  const backOffice = backOfficeIntl(intl)

  if (!view.ok) {
    return <BackOfficeError intl={backOffice} />
  }

  return (
    <AdminUsersScreen
      view={view.view}
      intl={backOffice}
      navigation={navigation}
      links={backOfficeLinks(ADMIN_USERS_SCREEN_PATH)}
    />
  )
}
