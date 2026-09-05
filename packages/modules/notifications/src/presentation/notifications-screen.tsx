import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Pagination,
  Separator,
} from '@repo/ui'
import { BellIcon } from 'lucide-react'

import type {
  NotificationsView,
  NotificationView,
  TypePreferenceView,
} from '../application/notification-use-cases'
import {
  channelLabelKey,
  typeBodyKey,
  typeLabelKey,
  NOTIFICATIONS_KEYS as K,
} from '../domain/message-keys'
import type { ResolvedPayload } from '../domain/notification'
import type { NotificationsIntl } from './notifications-intl'

/**
 * L'écran du centre de notifications — **composé, jamais inventé**.
 *
 * Tout vient de `@repo/ui` (`docs/design-system.md`) : `PageHeader`, `Card`,
 * `Badge`, `Button`, `EmptyState`, `Pagination`, `Separator`. Aucune primitive
 * maison, aucune couleur Tailwind brute, aucun texte en dur.
 *
 * **Aucun composant client, et c'est le point.** Les formulaires postent
 * nativement vers les routes du module, qui répondent 303 vers cet écran : il
 * n'y a pas de fenêtre entre le premier octet et l'hydratation pendant laquelle
 * une soumission serait perdue. Le `method="post"` reste écrit en toutes
 * lettres — `pnpm lint` le refuse autrement, et sans lui le repli du navigateur
 * mettrait les champs dans l'URL (`docs/security.md` §5).
 *
 * **Le compteur est relu du serveur à chaque rendu, et à rien d'autre.** Pas
 * d'intervalle de rafraîchissement, pas de websocket, pas de sondage : le temps
 * réel est au cimetière du PRD. Après une lecture, la redirection 303 recharge
 * cet écran, donc le badge suit — c'est le critère 2, tenu par la navigation.
 */

export interface NotificationsScreenProps {
  readonly view: NotificationsView
  readonly intl: NotificationsIntl
  /** URL des routes du module, résolues par l'application. */
  readonly actions: {
    readonly read: string
    readonly readAll: string
    readonly setPreference: string
  }
  /** L'URL d'une page du centre, connue de l'application seule. */
  readonly hrefForPage: (page: number) => string
}

/**
 * La charge utile, prête à être interpolée.
 *
 * `null` vient de la lecture : c'est une référence de compte que le module n'a
 * pas su résoudre, donc un compte effacé (revue s32, R1). L'écran y met son
 * libellé plutôt qu'un identifiant technique ou un trou — la ligne appartient à
 * celui qui la lit, et elle doit rester lisible quand la personne qu'elle nomme
 * n'est plus là.
 */
const displayable = (
  payload: ResolvedPayload,
  intl: NotificationsIntl,
): Record<string, string | number> =>
  Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      value === null ? intl.t(K.deletedActor) : value,
    ]),
  )

/** L'ancre de la carte des préférences : la sortie de l'état vide. */
const PREFERENCES_ANCHOR = 'notification-preferences'

function NotificationRow({
  notification,
  intl,
  action,
}: {
  readonly notification: NotificationView
  readonly intl: NotificationsIntl
  readonly action: string
}) {
  const label = intl.t(typeLabelKey(notification.type))

  return (
    <li className="flex min-w-0 flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{label}</span>
          {notification.read ? (
            <Badge variant="outline">{intl.t(K.read)}</Badge>
          ) : (
            <Badge variant="info">{intl.t(K.unreadOne)}</Badge>
          )}
        </div>
        <p className="max-w-prose text-sm text-muted-foreground">
          {intl.t(typeBodyKey(notification.type), displayable(notification.payload, intl))}
        </p>
      </div>
      {notification.read ? null : (
        <form method="post" action={action}>
          <input type="hidden" name="id" value={notification.id} />
          <Button type="submit" variant="ghost">
            {intl.t(K.markOneFor, { label })}
          </Button>
        </form>
      )}
    </li>
  )
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

export function NotificationsScreen({
  view,
  intl,
  actions,
  hrefForPage,
}: NotificationsScreenProps) {
  return (
    <>
      <PageHeader
        title={intl.t(K.screenTitle)}
        description={intl.t(K.screenDescription)}
        actions={
          view.unreadCount === 0 ? undefined : (
            <form method="post" action={actions.readAll}>
              <Button type="submit" variant="outline">
                {intl.t(K.markAll)}
              </Button>
            </form>
          )
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{intl.t(K.screenTitle)}</CardTitle>
          <CardDescription>{intl.t(K.unread, { count: view.unreadCount })}</CardDescription>
        </CardHeader>
        <CardContent>
          {view.notifications.length === 0 ? (
            <EmptyState
              icon={<BellIcon />}
              title={intl.t(K.emptyTitle)}
              description={intl.t(K.emptyDescription)}
              action={
                <Button asChild variant="outline">
                  <a href={`#${PREFERENCES_ANCHOR}`}>{intl.t(K.emptyAction)}</a>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {view.notifications.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  intl={intl}
                  action={actions.read}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {view.pageCount < 2 ? null : (
        <Pagination
          page={view.page}
          pageCount={view.pageCount}
          hrefFor={hrefForPage}
          label={intl.t(K.paginationLabel)}
          previousLabel={intl.t(K.paginationPrevious)}
          nextLabel={intl.t(K.paginationNext)}
          pageLabel={(page) => intl.t(K.paginationPage, { page })}
        />
      )}

      <Card id={PREFERENCES_ANCHOR}>
        <CardHeader>
          <CardTitle>{intl.t(K.preferencesTitle)}</CardTitle>
          <CardDescription>{intl.t(K.preferencesDescription)}</CardDescription>
        </CardHeader>
        <CardContent>
          <Separator />
          <ul className="divide-y divide-border">
            {view.preferences.map((preference) => (
              <PreferenceRow
                key={preference.type}
                preference={preference}
                intl={intl}
                action={actions.setPreference}
              />
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  )
}
