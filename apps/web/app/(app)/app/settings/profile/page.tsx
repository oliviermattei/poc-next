import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from '@repo/ui'
import { redirect } from 'next/navigation'

import {
  authRoutePath,
  currentDataExportRequests,
  currentViewer,
  PROFILE_SCREEN_PATH,
} from '../../../../../lib/auth'
import { appIntl } from '../../../../../lib/i18n'
import { AVATAR_CONTENT_TYPES, fileUrl, storage, storageRoutePath } from '../../../../../lib/storage'
import { AccountForm } from './account-form'
import { AvatarForm } from './avatar-form'
import { DataExportCard } from './data-export-card'
import { DeleteAccountCard } from './delete-account-card'
import { dataExportStateOf } from './rgpd-outcomes'

/**
 * **La rubrique Profil** des réglages (s62b) : ce que les autres voient de vous
 * — avatar, nom, email —, et en bas vos données : l'export, puis la
 * suppression du compte. Mot de passe, connexions, passkeys, second facteur et
 * sessions sont dans la rubrique Sécurité ; les cookies dans la leur. Les
 * cartes sont celles de l'ancien écran Compte (s62a), **déplacées** : aucune
 * n'est réécrite, et `tests/rendered-text.test.ts` retrouve chacune sous une
 * rubrique.
 *
 * Le titre de la page est celui de la zone (« Réglages », le seul `h1`, rendu
 * par le cadre) ; la rubrique ouvre par un `h2`.
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

export default async function ProfilePage() {
  const { session, account } = await currentViewer()
  const { locale, t, path } = await appIntl()

  if (session === null || account === null) {
    // `next` porte le chemin **interne** : c'est l'écran de connexion qui le met
    // dans la forme publique de sa locale, une seule fois. Y mettre le chemin
    // déjà préfixé le ferait préfixer deux fois — et surtout, la règle
    // `safeRedirectPath` du module juge un chemin interne, pas une URL de langue.
    redirect(`${path('/sign-in')}?next=${encodeURIComponent(PROFILE_SCREEN_PATH)}`)
  }

  // Module de stockage coupé : `avatarOf` rend `null` **sans toucher la base**,
  // et la carte n'est pas rendue. Aucune condition ne nomme un module ici —
  // `available` est une donnée, comme `sections.length` l'est pour la racine.
  const avatar = await storage.avatarOf(account.userId)
  const dateFormat = dateFormatFor(locale)
  // **L'état des demandes d'export, tel que le serveur le rend** — jamais leur
  // jeton : la trace ne porte que l'instant, l'état et l'échéance (s34b).
  const dataExport = dataExportStateOf(await currentDataExportRequests())
  return (
    <>
      <div className="min-w-0 space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">{t('app.settings.profile.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('app.settings.profile.description')}</p>
      </div>

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

      {/*
        **Vos données** (s62b) : l'export et la suppression restent sous une
        rubrique listée, jamais sur une page à part — séparés des cartes du
        profil par un `Separator`, la suppression en dernier.
      */}
      <div className="flex flex-col gap-2">
        <Separator />
        <p className="text-sm text-muted-foreground">{t('app.settings.profile.data')}</p>
      </div>

      {/*
        **Le droit à la portabilité** (s35), enfin joignable depuis
        l'application. L'écran montre l'**état** de la demande ; le lien de
        téléchargement, lui, part par email et n'apparaît jamais ici — sa route
        est publique, et il donne accès à l'ensemble des données d'une personne.
      */}
      <Card>
        <CardHeader>
          <CardTitle>{t('app.account.export.title')}</CardTitle>
          <CardDescription>{t('app.account.export.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataExportCard
            action={authRoutePath('dataExport')}
            pending={dataExport.pending}
            latest={
              dataExport.latest === null
                ? null
                : {
                    status: dataExport.latest.status,
                    // Formatées **par le serveur**, dans la locale servie : les
                    // formater dans le composant client les rendrait dans le
                    // fuseau du navigateur, ce que React signale comme un écart
                    // d'hydratation.
                    requestedAt: dateFormat.format(new Date(dataExport.latest.requestedAt)),
                    expiresAt:
                      dataExport.latest.expiresAt === null
                        ? null
                        : dateFormat.format(new Date(dataExport.latest.expiresAt)),
                  }
            }
          />
        </CardContent>
      </Card>

      {/*
        **La zone dangereuse**, en dernier et bordée de `destructive` : elle est
        séparée des cartes qui précèdent, et le design system réserve cette
        sémantique à ce qui ne se rattrape pas. Aucun jeton n'est inventé ici —
        `border-destructive/50` est celui de l'`Alert` de même variante.
      */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle>{t('app.account.deletion.title')}</CardTitle>
          <CardDescription>{t('app.account.deletion.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteAccountCard
            action={authRoutePath('deleteAccount')}
            email={account.email}
            destination={path('/sign-in')}
          />
        </CardContent>
      </Card>
    </>
  )
}
