import { describe, expect, it } from 'vitest'

import {
  clearanceOf,
  courseOf,
  displayNameProvided,
  EMPTY_PROGRESS,
  progressAfter,
  type OnboardingStep,
} from './onboarding'

/**
 * Les règles pures du parcours d'intégration — **tout ce qui décide**, et rien
 * qui sache ce qu'est un module, une base ou une requête.
 *
 * Les étapes arrivent ici en **données** : le point de composition de
 * l'application les dérive des modules montés, et ce fichier ne connaît que
 * leur forme. C'est ce qui rend l'angle du PRD vérifiable — une liste écrite en
 * dur casserait la modularité, et aucune de ces règles ne pourrait la produire.
 */

const step = (
  id: string,
  overrides: Partial<Omit<OnboardingStep, 'id'>> = {},
): OnboardingStep => ({
  id,
  required: false,
  fields: [],
  satisfied: true,
  ...overrides,
})

const PROFILE = step('profile', { required: true, fields: ['name'], satisfied: false })
const ORGANIZATION = step('organization', { satisfied: false })

describe('le parcours proposé à un compte', () => {
  it('ouvre sur la première étape non franchie', () => {
    const course = courseOf([PROFILE, ORGANIZATION], EMPTY_PROGRESS)

    expect(course.proposed).toBe(true)
    expect(course.current?.id).toBe('profile')
    expect(course.steps.map((view) => view.state)).toEqual(['current', 'upcoming'])
  })

  it('reprend à l’étape en cours quand la précédente est franchie', () => {
    const course = courseOf([PROFILE, ORGANIZATION], {
      clearedSteps: ['profile'],
      completedAt: null,
    })

    expect(course.current?.id).toBe('organization')
    expect(course.steps.map((view) => view.state)).toEqual(['cleared', 'current'])
  })

  /**
   * **La question laissée ouverte par la recherche, et sa réponse** : un module
   * coupé après qu'un compte a franchi son étape laisse un état qui cite une
   * étape qui n'existe plus. On **ignore l'inconnu** plutôt que de refuser —
   * l'utilisateur n'y peut rien, et une progression qui bloque sur une décision
   * d'exploitant est pire que la même progression amputée.
   */
  it('ignore une étape franchie que plus aucun module ne propose', () => {
    const course = courseOf([PROFILE], {
      clearedSteps: ['profile', 'organization'],
      completedAt: null,
    })

    expect(course.steps.map((view) => view.id)).toEqual(['profile'])
    expect(course.proposed).toBe(false)
  })

  /**
   * **La porte à sens unique** (critère 5). Une erreur de ce côté enferme
   * l'utilisateur dans une boucle : le parcours terminé ne se re-propose pas,
   * **même** quand un module activé après coup ajoute une étape neuve.
   */
  it('ne se re-propose pas après une fin de parcours, module ajouté compris', () => {
    const finished = { clearedSteps: ['profile'], completedAt: new Date('2026-09-06T10:00:00Z') }

    expect(courseOf([PROFILE], finished).proposed).toBe(false)
    expect(courseOf([PROFILE, step('offer')], finished).proposed).toBe(false)
  })

  it('ne propose rien quand aucune étape ne reste', () => {
    expect(courseOf([], EMPTY_PROGRESS).proposed).toBe(false)
  })

  /**
   * **La porte n'est pas le seul chemin par lequel un parcours s'arrête**, et
   * c'est la limite exacte de ce que `completedAt` garantit.
   *
   * Une étape peut sortir de la liste **par dérivation** — l'organisation
   * existe désormais, donc l'application ne propose plus de la créer —, et
   * personne n'a alors rien franchi : le parcours cesse d'être proposé sans
   * être clos. Si cette étape redevient dérivable, elle rouvre le parcours,
   * exactement comme elle le ferait au milieu de celui-ci.
   *
   * Ce n'est pas un défaut, c'est le sens que le point de composition a choisi
   * pour l'étape d'organisation (critère 7) : elle est *sautée*, jamais
   * *marquée franchie*, et une marque persistée affirmerait « cette personne a
   * créé son espace » là où rien ne le rendrait vrai à nouveau. Ce cas existe
   * parce qu'aucune commande ne le disait, pendant qu'une prose annonçait que
   * la porte tranchait sur **tous** les chemins qui terminent le parcours.
   */
  it('cesse d’être proposé quand la dernière étape sort de la liste, sans être clos', () => {
    const cleared = progressAfter(
      [PROFILE, ORGANIZATION],
      EMPTY_PROGRESS,
      'profile',
      new Date('2026-09-06T10:00:00Z'),
    )

    expect(courseOf([PROFILE, ORGANIZATION], cleared).proposed).toBe(true)

    // L'étape est sortie de la liste : plus rien n'est proposé, et la porte n'a
    // pas été armée pour autant.
    expect(courseOf([PROFILE], cleared).proposed).toBe(false)
    expect(cleared.completedAt).toBeNull()

    // Elle redevient dérivable — l'organisation quittée : le parcours rouvre.
    expect(courseOf([PROFILE, ORGANIZATION], cleared).proposed).toBe(true)
  })
})

describe('franchir une étape', () => {
  /**
   * **Le défaut silencieux du critère 6** : une étape obligatoire qui se laisse
   * passer ne casse rien — l'utilisateur arrive simplement au tableau de bord
   * sans nom. C'est un invariant, pas un comportement d'écran.
   */
  it('refuse de passer une étape obligatoire', () => {
    expect(clearanceOf(PROFILE, 'skip')).toBe('step_required')
  })

  it('laisse passer une étape facultative', () => {
    expect(clearanceOf(ORGANIZATION, 'skip')).toBeNull()
  })

  it('refuse de valider une étape dont l’exigence n’est pas remplie', () => {
    expect(clearanceOf(PROFILE, 'continue')).toBe('step_not_satisfied')
    expect(clearanceOf({ ...PROFILE, satisfied: true }, 'continue')).toBeNull()
  })

  it('refuse une étape qu’aucun module ne propose', () => {
    expect(clearanceOf(undefined, 'continue')).toBe('unknown_step')
    expect(clearanceOf(undefined, 'skip')).toBe('unknown_step')
  })
})

describe('la progression écrite après un franchissement', () => {
  const now = new Date('2026-09-06T10:00:00Z')

  it('ajoute l’étape franchie sans clore un parcours qui continue', () => {
    const after = progressAfter([PROFILE, ORGANIZATION], EMPTY_PROGRESS, 'profile', now)

    expect(after.clearedSteps).toEqual(['profile'])
    expect(after.completedAt).toBeNull()
  })

  it('clôt le parcours quand la dernière étape est franchie', () => {
    const after = progressAfter(
      [PROFILE, ORGANIZATION],
      { clearedSteps: ['profile'], completedAt: null },
      'organization',
      now,
    )

    expect(after.completedAt).toEqual(now)
  })

  /**
   * Rejouée, l'écriture ne produit aucun effet supplémentaire
   * (`docs/reliability.md` §1) : ni doublon dans la liste, ni instant de fin
   * réécrit — sans quoi un double clic déplacerait la date de fin du parcours.
   */
  it('rejouée, n’ajoute rien et ne réécrit pas l’instant de fin', () => {
    const first = progressAfter([PROFILE], EMPTY_PROGRESS, 'profile', now)
    const again = progressAfter([PROFILE], first, 'profile', new Date('2026-09-07T10:00:00Z'))

    expect(again.clearedSteps).toEqual(['profile'])
    expect(again.completedAt).toEqual(now)
  })
})

describe('l’exigence de l’étape de profil', () => {
  /**
   * **L'inscription pose le nom à l'adresse** (`auth-routes.ts`, `signUp`).
   * « Le nom est renseigné » ne peut donc pas être « le nom n'est pas vide » :
   * ce serait vrai de tout compte dès sa création, et l'étape obligatoire
   * serait franchie sans que personne n'ait rien saisi.
   */
  it('n’est pas remplie tant que le nom est l’adresse posée à l’inscription', () => {
    expect(displayNameProvided('alice@example.test', 'alice@example.test')).toBe(false)
    expect(displayNameProvided(' Alice@Example.test ', 'alice@example.test')).toBe(false)
    expect(displayNameProvided('   ', 'alice@example.test')).toBe(false)
  })

  it('est remplie dès qu’un nom choisi remplace l’adresse', () => {
    expect(displayNameProvided('Alice Martin', 'alice@example.test')).toBe(true)
  })
})
