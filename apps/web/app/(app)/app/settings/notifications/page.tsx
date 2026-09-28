import { NotificationPreferencesCard } from '@repo/module-notifications/presentation'
import { notFound, redirect } from 'next/navigation'

import { currentViewer } from '../../../../../lib/auth'
import { appIntl } from '../../../../../lib/i18n'
import {
  notificationRoutePath,
  notifications,
  NOTIFICATIONS_SETTINGS_SCREEN_PATH,
} from '../../../../../lib/notifications'

/**
 * **La rubrique Notifications** des réglages (s62c) : la carte des préférences
 * du centre de notifications, **déplacée** telle quelle. Le centre reste servi
 * à son adresse, atteint par la cloche de la barre du haut ; il ne porte plus
 * la carte.
 *
 * Deux refus, et aucun ne nomme un module :
 *
 * | Qui | Ce qu'il obtient |
 * |---|---|
 * | le produit n'a pas de notifications | **404** — la rubrique n'existe pas |
 * | un visiteur anonyme | redirection vers la connexion, avec son retour |
 *
 * La vue est celle du compte de la session, jamais d'un identifiant reçu
 * (`docs/security.md` §3).
 */
export default async function NotificationsSettingsPage() {
  if (!notifications.available) {
    notFound()
  }

  const { session } = await currentViewer()
  const { t, path } = await appIntl()

  if (session === null) {
    // Le chemin **interne** part dans `next` : c'est l'écran de connexion qui le
    // met dans la forme publique de sa locale, une seule fois.
    redirect(`${path('/sign-in')}?next=${encodeURIComponent(NOTIFICATIONS_SETTINGS_SCREEN_PATH)}`)
  }

  const view = await notifications.view(session, 1)

  return (
    <>
      <div className="min-w-0 space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('app.settings.notifications.title')}
        </h2>
      </div>

      <NotificationPreferencesCard
        preferences={view.preferences}
        intl={{ t }}
        action={notificationRoutePath('setPreference')}
      />
    </>
  )
}
