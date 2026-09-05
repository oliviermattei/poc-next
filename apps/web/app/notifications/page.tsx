import { NotificationsScreen } from '@repo/module-notifications/presentation'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'

import { currentViewer } from '../../lib/auth'
import { appIntl } from '../../lib/i18n'
import {
  notificationRoutePath,
  notifications,
  NOTIFICATIONS_SCREEN_PATH,
} from '../../lib/notifications'

/**
 * L'écran du centre de notifications.
 *
 * Trois refus, dans cet ordre, et aucun ne nomme un module :
 *
 * | Qui | Ce qu'il obtient |
 * |---|---|
 * | le produit n'a pas de notifications | **404** — l'écran n'existe pas |
 * | un visiteur anonyme | redirection vers la connexion, avec son retour |
 * | un compte | son écran, et **seulement ses** notifications |
 *
 * Le premier se départage sur `notifications.available`, c'est-à-dire sur une
 * **donnée** rendue par le point de composition — la même discipline que
 * `/organizations`.
 *
 * L'écran est protégé **côté serveur** : sans session il redirige, et la vue
 * qu'il lit est celle du compte de cette session-là, jamais d'un identifiant
 * reçu en paramètre (`docs/security.md` §3).
 */

/**
 * **Zod à chaque frontière** (`docs/security.md` §4), y compris un paramètre
 * d'URL.
 *
 * Une page illisible retombe sur la première : à la différence de la route
 * d'API, qui refuse en 400, un écran atteint par un lien bricolé doit montrer
 * quelque chose — et la première page est ce que le visiteur attendait.
 */
const PAGE = z.coerce.number().int().min(1)

const pageOf = (value: string | string[] | undefined): number => {
  const parsed = PAGE.safeParse(value)

  return parsed.success ? parsed.data : 1
}

export default async function NotificationsPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!notifications.available) {
    notFound()
  }

  const { session } = await currentViewer()
  const { t, path } = await appIntl()

  if (session === null) {
    // Le chemin **interne** part dans `next` : c'est l'écran de connexion qui
    // le met dans la forme publique de sa locale, une seule fois.
    redirect(
      `${path('/sign-in')}?next=${encodeURIComponent(NOTIFICATIONS_SCREEN_PATH)}`,
    )
  }

  const parameters = (await searchParams) ?? {}
  const view = await notifications.view(session, pageOf(parameters['page']))

  return (
    <NotificationsScreen
      view={view}
      intl={{ t }}
      actions={{
        read: notificationRoutePath('read'),
        readAll: notificationRoutePath('readAll'),
        setPreference: notificationRoutePath('setPreference'),
      }}
      hrefForPage={(page) => `${path(NOTIFICATIONS_SCREEN_PATH)}?page=${page}`}
    />
  )
}
