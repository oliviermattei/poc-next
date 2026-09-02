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

import {
  authRoutePath,
  currentPasskeys,
  currentSessions,
  currentSignInMethods,
  currentViewer,
} from '../../lib/auth'
import { appIntl } from '../../lib/i18n'
import { AVATAR_CONTENT_TYPES, fileUrl, storage, storageRoutePath } from '../../lib/storage'
import { SignOutButton } from '../sign-out-button'
import { AccountForm } from './account-form'
import { AvatarForm } from './avatar-form'
import { ConnectionList, type ConnectionRow } from './connection-list'
import { PasskeyCard, type PasskeyRow } from './passkey-card'
import { SessionList, type SessionRow } from './session-list'
import { TwoFactorBadge, TwoFactorCard } from './two-factor-card'

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

  // Module de stockage coupé : `avatarOf` rend `null` **sans toucher la base**,
  // et la carte n'est pas rendue. Aucune condition ne nomme un module ici —
  // `available` est une donnée, comme `sections.length` l'est pour la racine.
  const avatar = await storage.avatarOf(account.userId)
  const dateFormat = dateFormatFor(locale)
  // Les dates sont formatées **par le serveur**, dans la locale servie : les
  // formater dans le composant client les rendrait dans le fuseau du
  // navigateur, ce que React signale comme un écart d'hydratation.
  const connections: readonly ConnectionRow[] = (await currentSignInMethods()).map((method) => ({
    id: method.id,
    providerId: method.providerId,
    addedAt: dateFormat.format(method.createdAt),
    removable: method.removable,
  }))
  const passkeys: readonly PasskeyRow[] = (await currentPasskeys()).map((passkey) => ({
    id: passkey.id,
    name: passkey.name,
    addedAt: dateFormat.format(passkey.createdAt),
    removable: passkey.removable,
  }))
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

      {storage.available ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('storage.avatar.title')}</CardTitle>
            <CardDescription>{t('storage.avatar.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <AvatarForm
              presignAction={storageRoutePath('presignAvatar')}
              confirmAction={storageRoutePath('confirmAvatar')}
              removeAction={storageRoutePath('removeAvatar')}
              avatarUrl={avatar === null ? null : fileUrl(avatar.fileId, avatar.version)}
              name={account.name}
              // Les types acceptés viennent du `domain` du module : les
              // recopier ici en ferait une seconde liste, qui divergerait le
              // jour où le `domain` en ajoute ou en retire un.
              accept={AVATAR_CONTENT_TYPES.join(',')}
            />
          </CardContent>
        </Card>
      ) : null}

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
          <CardTitle>{t('app.account.connections.title')}</CardTitle>
          <CardDescription>{t('app.account.connections.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ConnectionList
            connections={connections}
            action={authRoutePath('unlinkProvider')}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('app.account.passkeys.title')}</CardTitle>
          <CardDescription>{t('app.account.passkeys.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {/*
            La liste vient du **serveur** ; le bouton d'enregistrement, lui,
            n'existe que dans un navigateur qui sait faire du WebAuthn — une
            cérémonie ne peut pas naître d'une soumission de formulaire. Voir
            `passkey-card.tsx`.
          */}
          <PasskeyCard
            passkeys={passkeys}
            optionsAction={authRoutePath('passkeyRegisterOptions')}
            registerAction={authRoutePath('passkeyRegister')}
            renameAction={authRoutePath('passkeyRename')}
            revokeAction={authRoutePath('passkeyRevoke')}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('app.account.twoFactor.title')}</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            <span>{t('app.account.twoFactor.description')}</span>
            <TwoFactorBadge enabled={account.twoFactorEnabled} />
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/*
            L'état vient du **serveur**, jamais du navigateur : c'est la même
            lecture que celle qui décide, côté routes, si le second facteur
            s'applique. Masquer un bouton n'a jamais été une permission
            (`docs/security.md` §3) — les routes refusent de toute façon.
          */}
          <TwoFactorCard
            enabled={account.twoFactorEnabled}
            enableAction={authRoutePath('twoFactorEnable')}
            verifyAction={authRoutePath('twoFactorVerify')}
            regenerateAction={authRoutePath('twoFactorRegenerate')}
            disableAction={authRoutePath('twoFactorDisable')}
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
