import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
} from '@repo/ui'
import { redirect } from 'next/navigation'

import { authRoutePath, currentSessions, currentViewer } from '../../lib/auth'
import { appIntl } from '../../lib/i18n'
import { SignOutButton } from '../sign-out-button'
import { AccountForm } from './account-form'
import { SessionList, type SessionRow } from './session-list'

/**
 * Les paramètres du compte.
 *
 * **Aucune règle n'est réécrite ici.** Chaque formulaire poste vers la route du
 * module livrée par s07 ou s08 : le mot de passe courant est exigé par le
 * service, les autres sessions sont révoquées par lui, le changement d'adresse
 * passe par une revérification. Un second chemin rendrait `docs/security.md`
 * §2 invérifiable — il faudrait prouver la règle deux fois, et l'une des deux
 * finirait par diverger.
 *
 * L'écran est protégé **côté serveur** : sans session il redirige, et il ne lit
 * que le compte de cette session-là.
 */

/**
 * Le format des dates, **dérivé de la locale servie**.
 *
 * Le fuseau reste fixé : le serveur et le navigateur n'ont pas le même, et une
 * date rendue dans deux fuseaux est un écart d'hydratation. La langue, elle,
 * suit la requête — c'est la moitié qui manquait, et elle se voit tout de suite
 * (« 3 septembre 2026 » contre « September 3, 2026 »).
 */
const dateFormatFor = (locale: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  })

/**
 * L'appareil d'une session, lu dans son agent utilisateur.
 *
 * Volontairement grossier : la chaîne complète est illisible, et une
 * bibliothèque d'analyse d'agent utilisateur serait une dépendance de plus pour
 * une ligne de texte. Ce qui compte est de distinguer deux sessions, pas de
 * nommer une version de navigateur.
 */
const deviceOf = (userAgent: string | null, unknown: string): string => {
  if (userAgent === null || userAgent.trim() === '') {
    return unknown
  }

  return userAgent.length > 60 ? `${userAgent.slice(0, 60)}…` : userAgent
}

export default async function AccountPage() {
  const { session, account } = await currentViewer()
  const { locale, t, path } = await appIntl()

  if (session === null || account === null) {
    // `next` porte le chemin **interne** : c'est l'écran de connexion qui le met
    // dans la forme publique de sa locale, une seule fois. Y mettre le chemin
    // déjà préfixé le ferait préfixer deux fois — et surtout, la règle
    // `safeRedirectPath` du module juge un chemin interne, pas une URL de langue.
    redirect(`${path('/sign-in')}?next=${encodeURIComponent('/account')}`)
  }

  const dateFormat = dateFormatFor(locale)
  const sessions: readonly SessionRow[] = (await currentSessions()).map((active) => ({
    id: active.id,
    createdAt: dateFormat.format(active.createdAt),
    device: deviceOf(active.userAgent, t('app.account.sessions.unknownDevice')),
    ipAddress: active.ipAddress,
    current: active.current,
  }))

  return (
    <>
      <PageHeader
        title={t('app.account.title')}
        description={t('app.account.description')}
        actions={<SignOutButton action={authRoutePath('signOut')} destination={path('/')} />}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('app.account.profile.title')}</CardTitle>
          <CardDescription>{t('app.account.profile.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <AccountForm
            action={authRoutePath('changeName')}
            fields={[
              {
                name: 'name',
                labelKey: 'app.account.profile.nameLabel',
                type: 'text',
                autoComplete: 'name',
                defaultValue: account.name,
              },
            ]}
            submitLabelKey="app.account.profile.submit"
            successMessageKey="app.account.profile.done"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('app.account.email.title')}</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            <span className="truncate">{account.email}</span>
            {account.emailVerified ? (
              <Badge variant="secondary">{t('app.account.email.verified')}</Badge>
            ) : (
              <Badge variant="warning">{t('app.account.email.unverified')}</Badge>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Une note, pas une région vivante : elle est là en permanence. */}
          <Alert variant="info">{t('app.account.email.notice')}</Alert>
          <AccountForm
            action={authRoutePath('changeEmail')}
            fields={[
              {
                name: 'email',
                labelKey: 'app.account.email.newLabel',
                type: 'email',
                autoComplete: 'email',
              },
            ]}
            submitLabelKey="app.account.email.submit"
            successMessageKey="app.account.email.done"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('app.account.password.title')}</CardTitle>
          <CardDescription>{t('app.account.password.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <AccountForm
            action={authRoutePath('changePassword')}
            fields={[
              {
                name: 'currentPassword',
                labelKey: 'app.account.password.currentLabel',
                type: 'password',
                autoComplete: 'current-password',
              },
              {
                name: 'newPassword',
                labelKey: 'app.account.password.newLabel',
                type: 'password',
                autoComplete: 'new-password',
              },
            ]}
            submitLabelKey="app.account.password.submit"
            successMessageKey="app.account.password.done"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('app.account.sessions.title')}</CardTitle>
          <CardDescription>{t('app.account.sessions.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <SessionList
            sessions={sessions}
            action={authRoutePath('revokeSession')}
            signInHref={path('/sign-in')}
          />
        </CardContent>
      </Card>
    </>
  )
}
