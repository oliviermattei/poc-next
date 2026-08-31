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

/** Le fuseau est fixé : le serveur et le navigateur n'ont pas le même. */
const dateFormat = new Intl.DateTimeFormat('fr-FR', {
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
const deviceOf = (userAgent: string | null): string => {
  if (userAgent === null || userAgent.trim() === '') {
    return 'Appareil inconnu'
  }

  return userAgent.length > 60 ? `${userAgent.slice(0, 60)}…` : userAgent
}

export default async function AccountPage() {
  const { session, account } = await currentViewer()

  if (session === null || account === null) {
    redirect('/sign-in?next=/account')
  }

  const sessions: readonly SessionRow[] = (await currentSessions()).map((active) => ({
    id: active.id,
    createdAt: dateFormat.format(active.createdAt),
    device: deviceOf(active.userAgent),
    ipAddress: active.ipAddress,
    current: active.current,
  }))

  return (
    <>
      <PageHeader
        title="Mon compte"
        description="Votre profil, votre mot de passe et les appareils connectés."
        actions={<SignOutButton action={authRoutePath('signOut')} />}
      />

      <Card>
        <CardHeader>
          <CardTitle>Profil</CardTitle>
          <CardDescription>Le nom affiché dans l’application.</CardDescription>
        </CardHeader>
        <CardContent>
          <AccountForm
            action={authRoutePath('changeName')}
            fields={[
              {
                name: 'name',
                label: 'Nom affiché',
                type: 'text',
                autoComplete: 'name',
                defaultValue: account.name,
              },
            ]}
            submitLabel="Enregistrer le nom"
            successMessage="Nom enregistré."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Adresse email</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            <span className="truncate">{account.email}</span>
            {account.emailVerified ? (
              <Badge variant="secondary">Vérifiée</Badge>
            ) : (
              <Badge variant="warning">Non vérifiée</Badge>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Une note, pas une région vivante : elle est là en permanence. */}
          <Alert variant="info">
            Une nouvelle adresse n’est active qu’une fois le lien de vérification suivi. Toutes les
            sessions sont alors révoquées, y compris celle-ci.
          </Alert>
          <AccountForm
            action={authRoutePath('changeEmail')}
            fields={[
              {
                name: 'email',
                label: 'Nouvelle adresse email',
                type: 'email',
                autoComplete: 'email',
              },
            ]}
            submitLabel="Envoyer le lien de vérification"
            successMessage="Lien envoyé. Ouvrez-le depuis la nouvelle adresse pour confirmer."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mot de passe</CardTitle>
          <CardDescription>
            Le mot de passe actuel est exigé, et le changement révoque les autres sessions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AccountForm
            action={authRoutePath('changePassword')}
            fields={[
              {
                name: 'currentPassword',
                label: 'Mot de passe actuel',
                type: 'password',
                autoComplete: 'current-password',
              },
              {
                name: 'newPassword',
                label: 'Nouveau mot de passe',
                type: 'password',
                autoComplete: 'new-password',
              },
            ]}
            submitLabel="Changer le mot de passe"
            successMessage="Mot de passe changé. Les autres sessions ont été révoquées."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessions actives</CardTitle>
          <CardDescription>
            Chaque appareil connecté à ce compte. Révoquer une session la refuse immédiatement,
            côté serveur.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SessionList sessions={sessions} action={authRoutePath('revokeSession')} />
        </CardContent>
      </Card>
    </>
  )
}
