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
} from '@repo/ui'
import { BellIcon } from 'lucide-react'

import type { NotificationsView, NotificationView } from '../application/notification-use-cases'
import { typeBodyKey, typeLabelKey, NOTIFICATIONS_KEYS as K } from '../domain/message-keys'
import type { ResolvedPayload } from '../domain/notification'
import type { NotificationsIntl } from './notifications-intl'

/**
 * L'écran du centre de notifications — **composé, jamais inventé**.
 *
 * Tout vient de `@repo/ui` (`docs/design-system.md`) : `PageHeader`, `Card`,
 * `Badge`, `Button`, `EmptyState`, `Pagination`. Aucune primitive
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
  }
  /** L'URL d'une page du centre, connue de l'application seule. */
  readonly hrefForPage: (page: number) => string
  /**
   * L'URL de la rubrique des préférences (s62c), connue de l'application
   * seule — la sortie de l'état vide. Les préférences ne vivent plus ici.
   */
  readonly preferencesHref: string
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

export function NotificationsScreen({
  view,
  intl,
  actions,
  hrefForPage,
  preferencesHref,
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
                  <a href={preferencesHref}>{intl.t(K.emptyAction)}</a>
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
    </>
  )
}
