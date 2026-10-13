import {
  stepActionKey,
  ONBOARDING_FIELD_AVATAR,
  ONBOARDING_SCREEN_PATH,
} from '@repo/module-onboarding'
import { OnboardingScreen } from '@repo/module-onboarding/presentation'
import { Button } from '@repo/ui'
import { notFound, redirect } from 'next/navigation'

import { authRoutePath, currentViewer, DEFAULT_SIGNED_IN_PATH } from '../../../../lib/auth'
import { BILLING_SCREEN_PATH } from '../../../../lib/billing'
import { appIntl } from '../../../../lib/i18n'
import { onboarding, onboardingRoutePath, ONBOARDING_STEPS } from '../../../../lib/onboarding'
import { ORGANIZATIONS_SCREEN_PATH } from '../../../../lib/organizations'
import { AVATAR_CONTENT_TYPES, fileUrl, storage, storageRoutePath } from '../../../../lib/storage'
import { AccountForm } from '../settings/profile/account-form'
import { AvatarForm } from '../settings/profile/avatar-form'

/**
 * L'écran du parcours d'intégration (s40).
 *
 * **It rewrites nothing.** Each step hands over the affordance that already
 * exists: the profile step posts to the `auth` module's `changeName` route and
 * reuses the two forms of the Profile settings screen (`settings/profile/`),
 * the organization step links to `ORGANIZATIONS_SCREEN_PATH`, the offer step to
 * `BILLING_SCREEN_PATH`. A second name-change path would make
 * `docs/security.md` §2 unverifiable — the rule would have to be proven twice,
 * and one of the two would end up diverging.
 *
 * **La moitié conditionnelle de l'étape de profil** (critère 2) se lit sur
 * `fields`, pas sur un module : sans stockage, `fields` ne porte pas l'avatar
 * et la carte ne rend que le nom. L'étape, elle, reste — c'est la différence
 * avec les critères 3 et 8, où c'est l'étape entière qui disparaît.
 *
 * **Trois refus, dans cet ordre**, et ils sont complémentaires de ceux du
 * tableau de bord (`/app`) :
 *
 * | Qui | Ce qu'il obtient |
 * |---|---|
 * | le produit n'a pas de parcours d'intégration | **404** — l'écran n'existe pas |
 * | un visiteur anonyme | redirection vers la connexion, avec son retour |
 * | un compte dont le parcours est fini | le tableau de bord |
 *
 * **L'ordre est la garantie, pas la liste.** Availability first, like the
 * organization settings screen (`ORGANIZATIONS_SCREEN_PATH`) and
 * `/invitations/accept`: a screen that does not exist does not reveal itself to
 * an anonymous visitor by sending them to sign in — it answers 404, without
 * even reading the session. L'inverse avait été écrit ici,
 * sous un docblock qui annonçait déjà 404 « comme `/organizations` » ;
 * `tests/onboarding.test.ts` mesure désormais les deux visiteurs, module coupé
 * comme monté.
 *
 * `onboarding.available` est une **donnée**, pas un `if (module activé)`.
 * Parcours terminé, on renvoie au tableau de bord : c'est l'autre moitié de la
 * porte à sens unique, et la condition est l'exacte négation de celle qui, sur
 * le tableau de bord, amène ici.
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
    // Le parcours se termine sur le tableau de bord, `/app` (s61, amende
    // s40) — la constante de la destination par défaut, jamais `/`, qui sert
    // le site.
    redirect(path(DEFAULT_SIGNED_IN_PATH))
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
              current.id === ONBOARDING_STEPS.organization
                ? ORGANIZATIONS_SCREEN_PATH
                : BILLING_SCREEN_PATH,
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
