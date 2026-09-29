import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from '@repo/ui'

import type { TypePreferenceView } from '../application/notification-use-cases'
import { channelLabelKey, typeLabelKey, NOTIFICATIONS_KEYS as K } from '../domain/message-keys'
import type { NotificationsIntl } from './notifications-intl'

/**
 * **La carte des préférences de notification** (s32), sortie du centre en s62c
 * pour la rubrique Notifications des réglages — déplacée telle quelle.
 *
 * Aucun composant client : chaque interrupteur est un `<form method="post">`
 * natif vers la route du module, qui répond 303 vers la rubrique.
 */
export interface NotificationPreferencesCardProps {
  readonly preferences: readonly TypePreferenceView[]
  readonly intl: NotificationsIntl
  /** L'URL de la route qui enregistre une préférence, résolue par l'application. */
  readonly action: string
}

function PreferenceRow({
  preference,
  intl,
  action,
}: {
  readonly preference: TypePreferenceView
  readonly intl: NotificationsIntl
  readonly action: string
}) {
  const type = intl.t(typeLabelKey(preference.type))

  return (
    <li className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3">
      <span className="min-w-0 text-sm font-semibold">{type}</span>
      <div className="flex flex-wrap items-center gap-2">
        {preference.channels.map((setting) => {
          const channel = intl.t(channelLabelKey(setting.channel))

          return (
            <form method="post" action={action} key={setting.channel}>
              <input type="hidden" name="type" value={preference.type} />
              <input type="hidden" name="channel" value={setting.channel} />
              <input type="hidden" name="enabled" value={setting.enabled ? 'false' : 'true'} />
              <Button
                type="submit"
                variant={setting.enabled ? 'default' : 'outline'}

                // Le nom accessible dit le canal **et** le type : sans lui,
                // quatre boutons portant « Par email » seraient indiscernables
                // au clavier comme pour une aide technique.
                aria-label={intl.t(
                  setting.enabled ? K.preferencesDisableFor : K.preferencesEnableFor,
                  { channel, type },
                )}
              >
                <span aria-hidden>{channel}</span>
                <Badge variant={setting.enabled ? 'success' : 'outline'}>
                  {intl.t(setting.enabled ? K.preferencesOn : K.preferencesOff)}
                </Badge>
              </Button>
            </form>
          )
        })}
      </div>
    </li>
  )
}

export function NotificationPreferencesCard({
  preferences,
  intl,
  action,
}: NotificationPreferencesCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.t(K.preferencesTitle)}</CardTitle>
        <CardDescription>{intl.t(K.preferencesDescription)}</CardDescription>
      </CardHeader>
      <CardContent>
        <Separator />
        <ul className="divide-y divide-border">
          {preferences.map((preference) => (
            <PreferenceRow
              key={preference.type}
              preference={preference}
              intl={intl}
              action={action}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
