import {
  stepActionKey,
  ONBOARDING_FIELD_AVATAR,
  ONBOARDING_SCREEN_PATH,
} from '@repo/module-onboarding'
import { OnboardingScreen } from '@repo/module-onboarding/presentation'
import { Button } from '@repo/ui'
import { notFound, redirect } from 'next/navigation'

import { authRoutePath, currentViewer } from '../../lib/auth'
import { appIntl } from '../../lib/i18n'
import { onboarding, onboardingRoutePath, ONBOARDING_STEPS } from '../../lib/onboarding'
import { AVATAR_CONTENT_TYPES, fileUrl, storage, storageRoutePath } from '../../lib/storage'
import { AccountForm } from '../account/account-form'
import { AvatarForm } from '../account/avatar-form'

/**
 * L'écran du parcours d'intégration (s40).
 *
 * **Il ne réécrit rien.** Chaque étape remet l'affordance qui existe déjà :
 * l'étape de profil poste vers la route `changeName` du module `auth` et
 * réemploie les deux formulaires de `/account`, l'étape d'organisation renvoie
 * à `/organizations`, l'étape d'offre à `/billing`. Un second chemin de
 * changement de nom rendrait `docs/security.md` §2 invérifiable — il faudrait
 * prouver la règle deux fois, et l'une des deux finirait par diverger.
 *
 * **La moitié conditionnelle de l'étape de profil** (critère 2) se lit sur
 * `fields`, pas sur un module : sans stockage, `fields` ne porte pas l'avatar
 * et la carte ne rend que le nom. L'étape, elle, reste — c'est la différence
 * avec les critères 3 et 8, où c'est l'étape entière qui disparaît.
 *
 * **Trois refus, dans cet ordre**, et ils sont complémentaires de ceux de la
 * racine :
 *
 * | Qui | Ce qu'il obtient |
 * |---|---|
 * | le produit n'a pas de parcours d'intégration | **404** — l'écran n'existe pas |
 * | un visiteur anonyme | redirection vers la connexion, avec son retour |
 * | un compte dont le parcours est fini | le tableau de bord |
 *
 * **L'ordre est la garantie, pas la liste.** La disponibilité d'abord, comme
 * `/organizations` et `/invitations/accept` : un écran qui n'existe pas ne parle
 * pas de lui à un visiteur anonyme en l'envoyant se connecter — il répond 404,
 * et il ne lit même pas la session pour le dire. L'inverse avait été écrit ici,
 * sous un docblock qui annonçait déjà 404 « comme `/organizations` » ;
 * `tests/onboarding.test.ts` mesure désormais les deux visiteurs, module coupé
 * comme monté.
 *
 * `onboarding.available` est une **donnée**, pas un `if (module activé)`.
 * Parcours terminé, on renvoie au tableau de bord : c'est l'autre moitié de la
 * porte à sens unique, et la condition est l'exacte négation de celle qui, à la
 * racine, amène ici.
 */
export default async function OnboardingPage() {
  if (!onboarding.available) {
    notFound()
  }

  const { session, account } = await currentViewer()
  const { t, path } = await appIntl()

  if (session === null || account === null) {
    // `next` porte le chemin **interne** : c'est l'écran de connexion qui le
    // met dans la forme publique de sa locale, une seule fois.
    redirect(`${path('/sign-in')}?next=${encodeURIComponent(ONBOARDING_SCREEN_PATH)}`)
  }

  const course = await onboarding.course(account.userId)

  if (!course.proposed) {
    redirect(path('/'))
  }

  const current = course.current
  const avatar =
    current?.id === ONBOARDING_STEPS.profile && current.fields.includes(ONBOARDING_FIELD_AVATAR)
      ? await storage.avatarOf(account.userId)
      : null

  /**
   * Ce que l'étape en cours propose de faire — **remis au module**, qui ne
   * connaît ni `auth`, ni `organizations`, ni la facturation.
   */
  const panel =
    current === null ? null : current.id === ONBOARDING_STEPS.profile ? (
      <>
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
        {current.fields.includes(ONBOARDING_FIELD_AVATAR) ? (
          <AvatarForm
            presignAction={storageRoutePath('presignAvatar')}
            confirmAction={storageRoutePath('confirmAvatar')}
            removeAction={storageRoutePath('removeAvatar')}
            avatarUrl={avatar === null ? null : fileUrl(avatar.fileId, avatar.version)}
            name={account.name}
            // Les types acceptés viennent du `domain` du module de stockage :
            // les recopier ici en ferait une seconde liste, qui divergerait.
            accept={AVATAR_CONTENT_TYPES.join(',')}
          />
        ) : null}
      </>
    ) : (
      <div>
        <Button asChild variant="secondary">
          <a
            href={path(
              current.id === ONBOARDING_STEPS.organization ? '/organizations' : '/billing',
            )}
          >
            {t(stepActionKey(current.id))}
          </a>
        </Button>
      </div>
    )

  return (
    <OnboardingScreen
      course={course}
      intl={{ t }}
      actions={{
        continue: onboardingRoutePath('continue'),
        skip: onboardingRoutePath('skip'),
      }}
      panel={panel}
    />
  )
}
