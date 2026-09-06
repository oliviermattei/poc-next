import { getDatabase } from '@repo/db'
import {
  displayNameProvided,
  onboardingModule,
  onboardingRoutePath,
  provideOnboarding,
  requireOnboardingService,
  EMPTY_COURSE,
  ONBOARDING_FIELD_AVATAR,
  ONBOARDING_FIELD_NAME,
  ONBOARDING_SCREEN_PATH,
  type OnboardingCourse,
  type OnboardingStep,
} from '@repo/module-onboarding'

import { appAuth } from './auth'
import { billing } from './billing'
import { moduleRegistry } from './module-registry'
import { organizations } from './organizations'
import { storage } from './storage'

/**
 * Le point de composition du parcours d'intégration (s40) — le même modèle que
 * `lib/mailer.ts`, `lib/auth.ts`, `lib/marketing.ts`, `lib/organizations.ts`,
 * `lib/storage.ts` et `lib/notifications.ts`.
 *
 * **C'est le seul fichier du dépôt qui sait de quoi le parcours est fait.** Le
 * module reçoit `stepsOf` et n'invente rien ; les écrans lisent `onboarding`,
 * dont la forme est la même dans les deux états — un drapeau `available`, un
 * parcours qui n'est pas proposé.
 *
 * | | module activé | module coupé |
 * |---|---|---|
 * | `/onboarding` | l'écran | **404** |
 * | routes d'API | deux | **404** |
 * | `pending(userId)` | vrai tant qu'il reste une étape | **toujours faux**, sans requête |
 * | table `onboarding_progress` | créée | absente d'une base vierge |
 *
 * ## Les étapes, dérivées — et les deux formes de dépendance
 *
 * Les critères 2, 3 et 8 ne demandent pas la même chose, et c'est le piège que
 * la note de la story annonce :
 *
 * - **une étape entière disparaît** quand son module n'est pas monté :
 *   `organizations` coupé, il n'y a pas d'étape d'organisation ; la facturation
 *   coupée, pas d'étape d'offre. C'est la forme `mounted ? … : …` au point de
 *   composition — l'absence par **la valeur**, jamais un `if (module activé)`
 *   disséminé ;
 * - **une partie d'étape disparaît** quand `storage` n'est pas monté : l'étape
 *   de profil garde le nom et perd l'avatar. C'est `fields` qui porte la
 *   différence, et c'est la seule raison pour laquelle `OnboardingStep` a un
 *   champ `fields` plutôt qu'un booléen d'avatar.
 *
 * Aucune de ces deux formes n'atteint le module : il reçoit une liste.
 *
 * ## L'invité, et la décision que la recherche laissait ouverte
 *
 * **L'étape de création d'organisation est *sautée*, jamais *marquée franchie*.**
 * Elle n'est proposée qu'à un compte qui n'appartient à aucune organisation :
 * un invité arrivé par `invitations/accept` en est déjà membre, donc l'étape
 * n'existe pas dans son parcours (critère 7).
 *
 * La différence se voit quand il quitte ensuite l'organisation, et c'est
 * pourquoi ce sens-là est le bon : une marque persistée affirmerait « cette
 * personne a créé son espace », ce que rien ne rendrait vrai à nouveau. La
 * dérivation, elle, reste vraie dans les deux sens — quitter l'organisation
 * avant d'avoir terminé le parcours **rouvre** l'étape, ce qui est exactement
 * ce qu'un compte sans organisation doit voir.
 *
 * **Ce que la porte à sens unique tranche, et ce qu'elle ne tranche pas.** Elle
 * n'est armée que par un **franchissement** : un compte qui franchit sa dernière
 * étape ne se voit plus rien proposer, quoi qu'il advienne ensuite de la liste.
 * Mais un parcours dont la dernière étape **disparaît par dérivation** — la
 * seule y étant l'organisation, créée entre-temps — s'arrête sans être clos, et
 * la quitter plus tard le rouvre au même endroit. C'est le sens choisi
 * ci-dessus, appliqué jusqu'au bout plutôt qu'une exception discrète ; le
 * `domain` du module le mesure, plutôt que cette prose ne l'affirme.
 */

/**
 * Les étapes que ce projet sait dériver.
 *
 * Elles sont ici, au point de composition, et pas dans le module : c'est
 * l'application qui sait qu'un compte a un nom, une organisation et une offre.
 * Le module en livre les **textes** — un identifiant qu'il ne connaîtrait pas
 * ferait échouer la traduction plutôt que d'afficher un libellé vide (s09), et
 * `tests/onboarding.test.ts` confronte ces trois-là au catalogue, dans chaque
 * locale.
 */
export const ONBOARDING_STEPS = {
  profile: 'profile',
  organization: 'organization',
  offer: 'offer',
} as const

export interface OnboardingFeature {
  /** Le module est-il monté ? **Une donnée**, lue par les écrans. */
  readonly available: boolean
  /** Donne au module ce qu'il ne peut pas se procurer, **sans rien construire**. */
  readonly prepare: () => void
  /**
   * Le parcours reste-t-il à proposer à ce compte ?
   *
   * C'est la seule question de la racine. **Toujours `false` module coupé, sans
   * toucher la base** : un projet qui coupe l'intégration ne paie pas une
   * requête pour apprendre qu'il n'en a pas, et son utilisateur atteint
   * directement le tableau de bord (critère 8).
   */
  readonly pending: (userId: string) => Promise<boolean>
  /** Le parcours d'un compte, pour l'écran. Vide et non proposé module coupé. */
  readonly course: (userId: string) => Promise<OnboardingCourse>
}

/**
 * L'état « module coupé », qui est une **donnée** et non une condition.
 *
 * Ses fonctions n'ouvrent aucune connexion, et le parcours vide est **dérivé**
 * du `domain` plutôt que recopié.
 */
const ABSENT_ONBOARDING: OnboardingFeature = {
  available: false,
  prepare: () => {},
  pending: () => Promise.resolve(false),
  course: () => Promise.resolve(EMPTY_COURSE),
}

const mounted = moduleRegistry.moduleIds.includes(onboardingModule.id)

/**
 * Les étapes d'un compte, **dérivées des modules montés et de sa donnée réelle**.
 *
 * Rien ici n'est écrit en dur : chaque `available` est le drapeau du point de
 * composition du module concerné, c'est-à-dire une donnée du registre. Couper
 * un module retire son étape sans qu'une ligne ne le nomme dans le `domain`.
 *
 * **Exportée pour être mesurée là où elle vit.** C'est la règle que la story
 * vend, et une mutation posée dans le module prouverait le module, pas la
 * dérivation : `tests/onboarding.test.ts` l'appelle sous des registres
 * construits, dans les deux configurations que la CI joue.
 */
export const stepsOf = async (userId: string): Promise<readonly OnboardingStep[]> => {
  const account = await appAuth().useCases.viewAccount(userId)
  // Module `organizations` coupé, la vue est vide **sans toucher la base** :
  // c'est la même donnée que celle qu'`/organizations` et l'écran d'invitation
  // lisent, jamais une seconde résolution.
  const memberships = (await organizations.view(userId)).memberships

  const profile: OnboardingStep = {
    id: ONBOARDING_STEPS.profile,
    // **Obligatoire** : un compte sans nom choisi arrive au tableau de bord
    // sous son adresse email, et rien ne le signale (critère 6).
    required: true,
    // **La moitié conditionnelle** : le nom toujours, l'avatar seulement quand
    // le stockage est monté (critère 2). L'étape, elle, ne disparaît pas.
    fields: storage.available
      ? [ONBOARDING_FIELD_NAME, ONBOARDING_FIELD_AVATAR]
      : [ONBOARDING_FIELD_NAME],
    satisfied: account !== null && displayNameProvided(account.name, account.email),
  }

  const organizationStep: readonly OnboardingStep[] =
    organizations.available && memberships.length === 0
      ? [
          {
            id: ONBOARDING_STEPS.organization,
            required: false,
            fields: [ONBOARDING_STEPS.organization],
            // Elle n'est proposée qu'à qui n'a pas d'organisation : dès qu'il en
            // a une, elle sort de la liste. C'est ce qui la rend *sautée* pour
            // un invité, sans rien persister.
            satisfied: false,
          },
        ]
      : []

  const offerStep: readonly OnboardingStep[] = billing.available
    ? [
        {
          id: ONBOARDING_STEPS.offer,
          // **Facultative** : le produit se vend, il ne se refuse pas à qui
          // n'achète pas encore. C'est l'étape que le critère 6 laisse passer.
          required: false,
          fields: [ONBOARDING_STEPS.offer],
          satisfied:
            (await billing.entitledOffers({ userId, roles: [] })).length > 0,
        },
      ]
    : []

  return [profile, ...organizationStep, ...offerStep]
}

/**
 * Comment construire le service du module — **et non sa construction**.
 *
 * C'est ici que le module reçoit la **connexion** (ADR 020) et la dérivation
 * des étapes, qu'il ne peut pas se procurer. La construction reste différée :
 * le répartiteur prépare les services à chaque requête, y compris celles
 * qu'aucune route ne satisfait.
 */
const provide = (): void => {
  provideOnboarding(() => ({ db: getDatabase().db, stepsOf }))
}

export const onboarding: OnboardingFeature = mounted
  ? {
      available: true,
      prepare: provide,
      pending: async (userId) => {
        provide()

        return await requireOnboardingService().useCases.proposed(userId)
      },
      course: async (userId) => {
        provide()

        return await requireOnboardingService().useCases.course(userId)
      },
    }
  : ABSENT_ONBOARDING

/** Ce que les écrans ont le droit de connaître du module : ses chemins. */
export { onboardingRoutePath, ONBOARDING_SCREEN_PATH }
