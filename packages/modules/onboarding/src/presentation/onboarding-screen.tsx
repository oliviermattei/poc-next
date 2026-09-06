import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
  Separator,
} from '@repo/ui'
import type { ReactNode } from 'react'

import {
  ONBOARDING_KEYS as K,
  stepDescriptionKey,
  stepTitleKey,
} from '../domain/message-keys'
import type { OnboardingCourse, OnboardingStepView } from '../domain/onboarding'
import type { OnboardingIntl } from './onboarding-intl'

/**
 * L'écran du parcours d'intégration — **composé, jamais inventé**.
 *
 * Tout vient de `@repo/ui` (`docs/design-system.md`) : `PageHeader`, `Card`,
 * `Badge`, `Separator`, `Button`, `Alert`. Aucune primitive maison, aucune
 * couleur Tailwind brute, aucun texte en dur.
 *
 * **`Stepper` n'est pas livré, et c'est une décision.** Le design system le
 * déclare, `packages/ui` ne l'a pas, et un fil d'étapes est un titre, une
 * position et un état : `Badge` et `Separator` suffisent. Copier une primitive
 * générique pour **un** appelant serait la généralisation que le cimetière du
 * PRD refuse — `s46` vient de prendre la même décision sur `Form`. Le manque
 * est **reporté** dans `docs/design-system.md`, il n'est pas comblé.
 *
 * **Aucun composant client.** Les deux formulaires postent nativement vers les
 * routes du module, qui répondent 303 vers cet écran : il n'y a pas de fenêtre
 * entre le premier octet et l'hydratation pendant laquelle une soumission
 * serait perdue. Le `method="post"` reste écrit en toutes lettres — `pnpm lint`
 * le refuse autrement, et sans lui le repli du navigateur mettrait les champs
 * dans l'URL (`docs/security.md` §5).
 *
 * **Ce que cet écran ne décide pas** : ni les étapes — elles arrivent dérivées
 * des modules montés —, ni ce que l'étape en cours propose de faire, qui est le
 * `panel` que l'application lui remet. Le module n'a donc aucun moyen de nommer
 * `storage`, `organizations` ou la facturation, ce qui est exactement l'angle
 * du PRD que la story doit tenir.
 */

export interface OnboardingScreenProps {
  readonly course: OnboardingCourse
  readonly intl: OnboardingIntl
  /** URL des deux routes du module, résolues par l'application. */
  readonly actions: {
    readonly continue: string
    readonly skip: string
  }
  /**
   * L'affordance de l'étape en cours, **remise par l'application**.
   *
   * C'est elle qui réutilise ce que `/account` édite déjà, ou renvoie vers
   * l'écran d'organisations, ou vers les offres. Le module ne les connaît pas
   * et n'en écrit pas une seconde version.
   */
  readonly panel: ReactNode
}

const stateKeyOf = (step: OnboardingStepView): string =>
  step.state === 'cleared'
    ? K.stateCleared
    : step.state === 'current'
      ? K.stateCurrent
      : K.stateUpcoming

const badgeVariantOf = (step: OnboardingStepView): 'success' | 'default' | 'outline' =>
  step.state === 'cleared' ? 'success' : step.state === 'current' ? 'default' : 'outline'

export function OnboardingScreen({ course, intl, actions, panel }: OnboardingScreenProps) {
  const { t } = intl
  const current = course.current
  const position = course.steps.findIndex((step) => step.state === 'current') + 1

  return (
    <>
      <PageHeader title={t(K.screenTitle)} description={t(K.screenDescription)} />

      {/*
        Le fil d'étapes : une navigation, donc elle porte un nom accessible.
        L'état de chaque étape est **dit**, pas seulement peint — une couleur de
        badge n'est lisible ni au clavier, ni par une aide technique.
      */}
      <nav aria-label={t(K.trailLabel)} className="flex flex-wrap items-center gap-2">
        {course.steps.map((step, index) => (
          <div key={step.id} className="flex items-center gap-2">
            {index === 0 ? null : <Separator orientation="vertical" className="h-4" />}
            <Badge variant={badgeVariantOf(step)}>
              {t(K.trailItem, { step: t(stepTitleKey(step.id)), state: t(stateKeyOf(step)) })}
            </Badge>
          </div>
        ))}
      </nav>

      {current === null ? null : (
        <Card>
          <CardHeader>
            <CardTitle>{t(stepTitleKey(current.id))}</CardTitle>
            <CardDescription>
              {t(K.position, {
                position,
                total: course.steps.length,
                detail: t(stepDescriptionKey(current.id)),
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {panel}

            {/*
              L'exigence non remplie d'une étape **obligatoire** est dite. Sans
              cela, le refus du serveur serait la seule chose que l'utilisateur
              verrait, et il ne saurait pas ce qu'on attend de lui.
            */}
            {current.satisfied || !current.required ? null : (
              <Alert variant="info">{t(K.required)}</Alert>
            )}

            <div className="flex flex-wrap gap-2">
              {/*
                « Continuer » n'est rendu que lorsque l'exigence est remplie :
                le serveur refuse de toute façon (`step_not_satisfied`), et
                proposer un bouton qui ne peut que échouer serait un piège.
              */}
              {current.satisfied ? (
                <form method="post" action={actions.continue}>
                  <input type="hidden" name="step" value={current.id} />
                  <Button type="submit">{t(K.continue)}</Button>
                </form>
              ) : null}

              {/*
                **Une étape obligatoire n'a pas de bouton « Passer »**, et le
                serveur la refuse aussi (`step_required`). La règle est prouvée
                côté serveur ; ici elle est seulement rendue visible.
              */}
              {current.required ? null : (
                <form method="post" action={actions.skip}>
                  <input type="hidden" name="step" value={current.id} />
                  <Button type="submit" variant="ghost">
                    {t(K.skip)}
                  </Button>
                </form>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  )
}
