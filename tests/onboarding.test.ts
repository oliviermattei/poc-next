import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import {
  createDatabaseClient,
  planModuleMigrations,
  runModuleMigrations,
  type DatabaseConnection,
} from '@repo/db'
import {
  configureOnboarding,
  onboardingModule,
  resetOnboardingService,
  courseOf,
  stepDescriptionKey,
  stepTitleKey,
  EMPTY_PROGRESS,
  ONBOARDING_KEYS,
  ONBOARDING_SCREEN_PATH,
  type OnboardingService,
  type OnboardingStep,
} from '@repo/module-onboarding'
import { OnboardingScreen } from '@repo/module-onboarding/presentation'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { appLocales } from '../config/i18n'
import { databaseUrl, isDatabaseReachable } from './fixtures/database'

/**
 * Le **câblage** du parcours d'intégration — ce que la règle seule ne peut pas
 * dire.
 *
 * Les règles pures vivent et se prouvent dans le module
 * (`packages/modules/onboarding/src/domain/onboarding.test.ts`). Ce fichier-ci
 * pose les questions qui traversent les packages :
 *
 * 1. **la persistance** : une interruption reprend-elle où le compte s'est
 *    arrêté, mesurée sur une vraie base et deux lectures distinctes ?
 * 2. **la dérivation** : les étapes viennent-elles réellement des modules
 *    montés, avatar compris — et l'avatar disparaît-il **sans** faire
 *    disparaître l'étape ?
 * 3. **la porte** : la racine redirige-t-elle vers le parcours tant qu'il reste
 *    à faire, et cesse-t-elle de le faire une fois terminé ?
 * 4. **le module coupé** : le compte atteint-il le tableau de bord sans qu'une
 *    ligne ne nomme le module ?
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

const databaseReachable = await isDatabaseReachable()

let connection: DatabaseConnection
let service: OnboardingService

/** Les étapes que ce fichier remet au module, par compte. Ce sont des données. */
const stepsByUser = new Map<string, readonly OnboardingStep[]>()

const step = (
  id: string,
  overrides: Partial<Omit<OnboardingStep, 'id'>> = {},
): OnboardingStep => ({ id, required: false, fields: [], satisfied: true, ...overrides })

beforeAll(async () => {
  if (!databaseReachable) {
    return
  }

  connection = createDatabaseClient({ connectionString: databaseUrl, maxConnections: 5 })

  await runModuleMigrations({
    db: connection.db,
    plan: planModuleMigrations({ modules: [onboardingModule], repoRoot: REPO_ROOT }),
  })

  service = configureOnboarding({
    db: connection.db,
    stepsOf: (userId) => Promise.resolve(stepsByUser.get(userId) ?? []),
  })
})

afterAll(async () => {
  resetOnboardingService()

  if (databaseReachable) {
    await connection.close()
  }
})

describe.skipIf(!databaseReachable)('la progression persistée', () => {
  /**
   * **La reprise, mesurée sur une vraie interruption** (critère 4).
   *
   * Deux lectures distinctes, séparées par une écriture : un état recomposé en
   * mémoire passerait ce cas sans rien prouver de la table.
   */
  it('reprend à l’étape en cours à la lecture suivante', async () => {
    const userId = `usr_${randomUUID()}`

    stepsByUser.set(userId, [
      step('profile', { required: true, fields: ['name'] }),
      step('organization'),
    ])

    expect((await service.useCases.course(userId)).current?.id).toBe('profile')

    const cleared = await service.useCases.clear({ userId, stepId: 'profile', intent: 'continue' })

    expect(cleared.ok).toBe(true)

    // La **seconde** lecture : elle ne partage rien avec la première hors de la
    // table, et c'est tout ce que ce cas mesure.
    const resumed = await service.useCases.course(userId)

    expect(resumed.current?.id).toBe('organization')
    expect(resumed.steps.map((view) => view.state)).toEqual(['cleared', 'current'])
  })

  /**
   * **Rejouable sans effet supplémentaire** (`docs/reliability.md` §1) : la
   * seconde écriture laisse une seule ligne et une seule mention de l'étape.
   */
  it('rejouée, n’écrit pas une seconde ligne ni une seconde mention', async () => {
    const userId = `usr_${randomUUID()}`

    stepsByUser.set(userId, [step('profile', { required: true }), step('organization')])

    await service.useCases.clear({ userId, stepId: 'profile', intent: 'continue' })
    await service.useCases.clear({ userId, stepId: 'profile', intent: 'continue' })

    const exported = (await service.useCases.exportUser(userId)) as {
      readonly progress: { readonly clearedSteps: readonly string[] } | null
    }

    expect(exported.progress?.clearedSteps).toEqual(['profile'])
  })

  /**
   * **Le refus n'écrit rien.** Une garde qui refuse puis persiste quand même
   * laisserait franchie une étape obligatoire que personne n'a remplie — le
   * défaut silencieux du critère 6, à la lettre.
   */
  it('ne persiste rien quand la règle refuse', async () => {
    const userId = `usr_${randomUUID()}`

    stepsByUser.set(userId, [step('profile', { required: true, satisfied: false })])

    const skipped = await service.useCases.clear({ userId, stepId: 'profile', intent: 'skip' })
    const forced = await service.useCases.clear({ userId, stepId: 'profile', intent: 'continue' })

    expect(skipped).toEqual({ ok: false, refusal: 'step_required' })
    expect(forced).toEqual({ ok: false, refusal: 'step_not_satisfied' })

    const exported = (await service.useCases.exportUser(userId)) as {
      readonly progress: unknown
    }

    expect(exported.progress).toBeNull()
    expect((await service.useCases.course(userId)).current?.id).toBe('profile')
  })
})

describe.skipIf(!databaseReachable)('les quatre clés RGPD du module', () => {
  /**
   * **`s34` et `s35` ont fermé la classe « une table qui n'est ni purgée ni
   * exportée »**, et cette story ne la rouvre pas : les deux fonctions du
   * contrat sont exercées sur une vraie ligne, par le contrat lui-même — pas
   * par les cas d'usage, qui ne sont pas ce que `purgeModules` appelle.
   */
  it('rend la progression à l’export, puis ne rend plus rien après la purge', async () => {
    const userId = `usr_${randomUUID()}`

    stepsByUser.set(userId, [step('profile', { required: true }), step('organization')])
    await service.useCases.clear({ userId, stepId: 'profile', intent: 'continue' })

    const exported = (await onboardingModule.export({ kind: 'user', userId })) as {
      readonly progress: { readonly clearedSteps: readonly string[] } | null
    }

    expect(exported.progress?.clearedSteps).toEqual(['profile'])

    await onboardingModule.purge({ kind: 'user', userId })

    const afterPurge = (await onboardingModule.export({ kind: 'user', userId })) as {
      readonly progress: unknown
    }

    expect(afterPurge.progress).toBeNull()
  })

  /** La purge est rejouable : la seconde exécution n'a rien de plus à faire. */
  it('rejouée, la purge n’a plus rien à effacer et ne lève pas', async () => {
    const userId = `usr_${randomUUID()}`

    stepsByUser.set(userId, [step('profile', { required: true })])
    await service.useCases.clear({ userId, stepId: 'profile', intent: 'continue' })

    await onboardingModule.purge({ kind: 'user', userId })
    await expect(onboardingModule.purge({ kind: 'user', userId })).resolves.toBeUndefined()
  })
})

/* ------------------------------------------------------------------------- *
 * La dérivation des étapes — **le cœur de la story**.
 *
 * Elle vit au point de composition (`apps/web/lib/onboarding.ts`), donc c'est
 * là qu'elle se mesure : une mutation posée dans le module prouverait le
 * module, pas la dérivation. Le registre est **construit** ici plutôt que lu
 * dans `config/features.ts` — la CI joue cette suite dans deux configurations,
 * et un cas dont le résultat dépendrait de la configuration courante serait
 * vert sans rien mesurer dans l'une des deux.
 *
 * Ce qui est doublé : **les lectures** (le compte, les appartenances, les
 * droits), jamais les drapeaux `available` — ceux-ci restent ceux des vrais
 * points de composition, sous le registre forcé, sans quoi ce fichier ferait la
 * démonstration de sa propre fixture.
 * ------------------------------------------------------------------------- */

const FIXTURE_ACCOUNT = {
  userId: 'usr_derive',
  name: 'alice@example.test',
  email: 'alice@example.test',
  emailVerified: true,
}

interface DerivationOptions {
  readonly modules: readonly string[]
  readonly account?: typeof FIXTURE_ACCOUNT | null
  readonly memberships?: readonly { readonly id: string }[]
  readonly entitledOffers?: readonly string[]
}

/**
 * **Le registre monté, construit pour ce cas** — jamais celui de la
 * configuration courante.
 *
 * La CI joue cette suite dans deux configurations : un cas dont le résultat
 * dépendrait de celle du moment serait vert sans rien mesurer dans l'autre.
 * Partagé entre la dérivation des étapes et le rendu de l'écran, parce que les
 * deux posent la même question au même endroit.
 */
const mockModuleRegistry = (modules: readonly string[]): void => {
  vi.doMock('../apps/web/lib/module-registry', async () => {
    const { buildRegistry } = await import('@repo/core')
    const { availableModules, requiredModules } = await import('../config/features')
    const { appLocales } = await import('../config/i18n')

    return {
      moduleRegistry: buildRegistry({
        available: [...availableModules],
        enabled: [...new Set([...requiredModules, ...modules])],
        required: [...requiredModules],
        locales: [...appLocales],
      }),
    }
  })
}

const withModules = async <T>(
  options: DerivationOptions,
  read: (loaded: typeof import('../apps/web/lib/onboarding')) => Promise<T>,
): Promise<T> => {
  const {
    modules,
    account = FIXTURE_ACCOUNT,
    memberships = [],
    entitledOffers = [],
  } = options

  vi.resetModules()

  mockModuleRegistry(modules)

  vi.doMock('../apps/web/lib/auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../apps/web/lib/auth')>()),
    appAuth: () => ({ useCases: { viewAccount: () => Promise.resolve(account) } }),
  }))

  vi.doMock('../apps/web/lib/organizations', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../apps/web/lib/organizations')>()

    return {
      ...actual,
      organizations: { ...actual.organizations, view: () => Promise.resolve({ memberships }) },
    }
  })

  vi.doMock('../apps/web/lib/billing', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../apps/web/lib/billing')>()

    return {
      ...actual,
      billing: { ...actual.billing, entitledOffers: () => Promise.resolve(entitledOffers) },
    }
  })

  try {
    return await read(await import('../apps/web/lib/onboarding'))
  } finally {
    vi.doUnmock('../apps/web/lib/module-registry')
    vi.doUnmock('../apps/web/lib/auth')
    vi.doUnmock('../apps/web/lib/organizations')
    vi.doUnmock('../apps/web/lib/billing')
    vi.resetModules()
  }
}

const derivedSteps = async (
  options: DerivationOptions,
): Promise<readonly OnboardingStep[]> =>
  await withModules(options, async (loaded) => await loaded.stepsOf(FIXTURE_ACCOUNT.userId))

const ALL_MODULES = ['onboarding', 'storage', 'organizations', 'billing'] as const

describe('les étapes dérivées des modules montés', () => {
  it('les propose toutes les trois quand les trois modules sont montés', async () => {
    const steps = await derivedSteps({ modules: [...ALL_MODULES] })

    // L'anti-vacuité : sans cette ligne, « aucune étape d'organisation » serait
    // vrai d'une dérivation qui ne rend jamais rien.
    expect(steps.map((step) => step.id)).toEqual(['profile', 'organization', 'offer'])
  })

  it('n’a pas d’étape d’organisation sans le module d’organisations', async () => {
    const steps = await derivedSteps({ modules: ['onboarding', 'storage', 'billing'] })

    expect(steps.map((step) => step.id)).toEqual(['profile', 'offer'])
  })

  it('n’a pas d’étape d’offre sans le module de facturation', async () => {
    const steps = await derivedSteps({ modules: ['onboarding', 'storage', 'organizations'] })

    expect(steps.map((step) => step.id)).toEqual(['profile', 'organization'])
  })

  /**
   * **Le piège nommé par la story** : sans stockage, l'étape de profil **perd
   * l'avatar et garde le nom**. C'est plus fin que les critères 3 et 8, où
   * c'est l'étape entière qui disparaît — et c'est là qu'une dérivation naïve
   * écrit un `if`.
   */
  it('garde l’étape de profil sans le module de stockage, et lui retire l’avatar', async () => {
    const withStorage = await derivedSteps({ modules: [...ALL_MODULES] })
    const without = await derivedSteps({ modules: ['onboarding', 'organizations', 'billing'] })

    expect(withStorage[0]?.fields).toEqual(['name', 'avatar'])
    expect(without.map((step) => step.id)).toContain('profile')
    expect(without[0]?.fields).toEqual(['name'])
  })

  /**
   * **L'invité saute l'étape de création** (critère 7), et la décision est
   * écrite : elle est *sautée*, jamais *marquée franchie*. Rien n'est persisté,
   * donc quitter l'organisation avant la fin du parcours rouvre l'étape — ce
   * qu'un compte sans organisation doit voir.
   */
  it('ne propose pas la création à qui appartient déjà à une organisation', async () => {
    const steps = await derivedSteps({
      modules: [...ALL_MODULES],
      memberships: [{ id: 'org_1' }],
    })

    expect(steps.map((step) => step.id)).toEqual(['profile', 'offer'])
  })

  /**
   * L'exigence de l'étape obligatoire, dérivée de la **donnée réelle** : le nom
   * posé à l'inscription est l'adresse, donc l'étape n'est pas remplie tant que
   * personne n'a rien saisi.
   */
  it('ne tient pas l’étape de profil pour remplie tant que le nom est l’adresse', async () => {
    const asSignedUp = await derivedSteps({ modules: [...ALL_MODULES] })
    const named = await derivedSteps({
      modules: [...ALL_MODULES],
      account: { ...FIXTURE_ACCOUNT, name: 'Alice Martin' },
    })

    expect(asSignedUp[0]?.satisfied).toBe(false)
    expect(named[0]?.satisfied).toBe(true)
  })

  /** L'étape d'offre est remplie par un droit détenu, pas par un clic. */
  it('tient l’étape d’offre pour remplie quand le compte détient une offre', async () => {
    const none = await derivedSteps({ modules: [...ALL_MODULES] })
    const owner = await derivedSteps({ modules: [...ALL_MODULES], entitledOffers: ['pro'] })

    expect(none.find((step) => step.id === 'offer')?.satisfied).toBe(false)
    expect(owner.find((step) => step.id === 'offer')?.satisfied).toBe(true)
  })

  /**
   * **Chaque étape que ce projet sait dériver a ses textes**, dans chaque
   * locale livrée. Une étape sans libellé ferait tomber l'écran en 500 — aucune
   * clé manquante ne se replie (s09) —, et c'est le seul défaut que la
   * dérivation peut introduire dans le module sans que rien d'autre ne le voie.
   *
   * Les deux côtés sont dérivés : les identifiants viennent du point de
   * composition, les clés du `domain` du module.
   */
  it('livre les textes de chaque étape dérivable, dans chaque locale', async () => {
    const ids = await withModules({ modules: [...ALL_MODULES] }, async (loaded) =>
      Object.values(loaded.ONBOARDING_STEPS),
    )

    expect(ids.length).toBeGreaterThan(2)

    for (const locale of appLocales) {
      for (const id of ids) {
        const catalogue = onboardingModule.messages[locale] ?? {}

        for (const key of [stepTitleKey(id), stepDescriptionKey(id)]) {
          // Le catalogue du module porte la clé **non qualifiée** : c'est le
          // registre qui la préfixe.
          expect(catalogue[key.slice('onboarding.'.length)], `${locale} / ${key}`).toBeDefined()
        }
      }
    }
  })
})

describe('le module coupé', () => {
  /**
   * **Critère 8** : l'utilisateur atteint directement le tableau de bord.
   *
   * Rien n'est nommé ici non plus — la coupure passe par le registre, et la
   * réponse est une **valeur**. Le service n'est volontairement pas configuré :
   * s'il était atteint, `requireOnboardingService` lèverait, et c'est ce qui
   * prouve qu'aucune requête n'est émise pour apprendre qu'il n'y a rien.
   */
  it('ne propose aucun parcours et ne touche à rien', async () => {
    resetOnboardingService()

    const outcome = await withModules({ modules: ['storage'] }, async (loaded) => ({
      available: loaded.onboarding.available,
      pending: await loaded.onboarding.pending(FIXTURE_ACCOUNT.userId),
      course: await loaded.onboarding.course(FIXTURE_ACCOUNT.userId),
    }))

    expect(outcome.available).toBe(false)
    expect(outcome.pending).toBe(false)
    expect(outcome.course.proposed).toBe(false)
    expect(outcome.course.steps).toEqual([])
  })
})

/* ------------------------------------------------------------------------- *
 * L'écran du parcours : ses deux refus, et leur **ordre**.
 *
 * L'ordre n'est pas un détail de style. Session d'abord, un visiteur anonyme
 * est renvoyé à la connexion **même quand le module est coupé** — c'est-à-dire
 * qu'un écran qui n'existe pas se met à parler de lui à qui n'est pas connecté.
 * Disponibilité d'abord, il obtient 404, comme `/organizations` et
 * `/invitations/accept`, dont la page teste bien la disponibilité en premier.
 *
 * Mesuré ici plutôt que dans le module : l'ordre vit dans la page, et une
 * mutation posée ailleurs prouverait autre chose. Le registre est **construit**,
 * comme pour la dérivation — un cas dont la réponse dépendrait de la
 * configuration courante ne mesurerait rien dans l'autre.
 * ------------------------------------------------------------------------- */

const ANONYMOUS_VIEWER = { session: null, account: null, impersonatedBy: null }
const SIGNED_IN_VIEWER = {
  session: { userId: FIXTURE_ACCOUNT.userId, roles: [] },
  account: FIXTURE_ACCOUNT,
  impersonatedBy: null,
}

/**
 * Rend l'écran du parcours et **rapporte son refus**, tel que Next le signale.
 *
 * `null` quand l'écran a rendu quelque chose : ce fichier ne mesure ici que les
 * refus, le contenu de l'écran étant mesuré plus bas sur le composant.
 */
const onboardingScreenRefusal = async (options: {
  readonly modules: readonly string[]
  readonly viewer: typeof ANONYMOUS_VIEWER | typeof SIGNED_IN_VIEWER
}): Promise<string | null> => {
  vi.resetModules()

  mockModuleRegistry(options.modules)

  vi.doMock('../apps/web/lib/auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../apps/web/lib/auth')>()),
    currentViewer: () => Promise.resolve(options.viewer),
  }))

  vi.doMock('../apps/web/lib/i18n', () => ({
    appIntl: () =>
      Promise.resolve({ locale: 'fr', t: (key: string) => key, path: (to: string) => to }),
  }))

  try {
    await (await import('../apps/web/app/onboarding/page')).default()

    return null
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest

    if (typeof digest !== 'string') {
      throw error
    }

    return digest
  } finally {
    vi.doUnmock('../apps/web/lib/module-registry')
    vi.doUnmock('../apps/web/lib/auth')
    vi.doUnmock('../apps/web/lib/i18n')
    vi.resetModules()
  }
}

describe('l’écran du parcours, avant tout rendu', () => {
  it('répond 404 au visiteur anonyme quand le module n’est pas monté', async () => {
    const refusal = await onboardingScreenRefusal({
      modules: ['storage'],
      viewer: ANONYMOUS_VIEWER,
    })

    expect(refusal).toContain('NEXT_HTTP_ERROR_FALLBACK;404')
  })

  it('répond 404 au compte connecté quand le module n’est pas monté', async () => {
    const refusal = await onboardingScreenRefusal({
      modules: ['storage'],
      viewer: SIGNED_IN_VIEWER,
    })

    expect(refusal).toContain('NEXT_HTTP_ERROR_FALLBACK;404')
  })

  /**
   * L'autre refus reste entier : le module monté, c'est la session qui manque,
   * et le retour part en chemin **interne**, jamais reçu de l'extérieur.
   */
  it('renvoie le visiteur anonyme à la connexion quand le module est monté', async () => {
    const refusal = await onboardingScreenRefusal({
      modules: [...ALL_MODULES],
      viewer: ANONYMOUS_VIEWER,
    })

    expect(refusal).toContain('NEXT_REDIRECT')
    expect(refusal).toContain('/sign-in')
    expect(refusal).toContain(encodeURIComponent(ONBOARDING_SCREEN_PATH))
  })
})

/* ------------------------------------------------------------------------- *
 * La porte : la racine mène au parcours, et cesse d'y mener.
 *
 * Mesurée **sur l'écran de la racine**, parce que c'est là que le défaut
 * vivrait : la redirection retirée, `courseOf` resterait juste et personne ne
 * verrait jamais le parcours. C'est aussi là que la règle de destination
 * s'applique — une constante du code, jamais un paramètre d'URL.
 * ------------------------------------------------------------------------- */

/** Le parcours que voit la racine pendant ce rendu. Une **lecture**, doublée. */
const pendingState: { value: boolean } = { value: true }

const renderRoot = async (): Promise<{
  readonly html: string
  readonly digest: string | null
}> => {
  vi.resetModules()

  vi.doMock('../apps/web/lib/auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../apps/web/lib/auth')>()),
    currentViewer: () =>
      Promise.resolve({ session: { userId: 'usr_1', roles: [] }, account: FIXTURE_ACCOUNT, impersonatedBy: null }),
  }))

  // Le **contexte de requête**, jamais une règle : hors de Next, `appIntl` lit
  // `next/headers`, qui n'existe pas. Le traducteur rend la clé — ce que ce cas
  // mesure est une redirection, pas un texte.
  vi.doMock('../apps/web/lib/i18n', () => ({
    appIntl: () =>
      Promise.resolve({ locale: 'fr', t: (key: string) => key, path: (to: string) => to }),
  }))

  vi.doMock('../apps/web/lib/onboarding', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../apps/web/lib/onboarding')>()

    return {
      ...actual,
      onboarding: { ...actual.onboarding, pending: () => Promise.resolve(pendingState.value) },
    }
  })

  try {
    const HomePage = (await import('../apps/web/app/page')).default

    return { html: renderToStaticMarkup(await HomePage()), digest: null }
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest

    if (typeof digest !== 'string') {
      throw error
    }

    return { html: '', digest }
  } finally {
    vi.doUnmock('../apps/web/lib/auth')
    vi.doUnmock('../apps/web/lib/i18n')
    vi.doUnmock('../apps/web/lib/onboarding')
    vi.resetModules()
  }
}

describe('la racine, pour un compte connecté', () => {
  it('mène au parcours tant qu’il reste à faire', async () => {
    pendingState.value = true

    const outcome = await renderRoot()

    expect(outcome.digest).toContain('NEXT_REDIRECT')
    // **La destination est la constante du module**, jamais un paramètre : le
    // digest de Next la porte, et c'est le seul endroit où elle se lit.
    expect(outcome.digest).toContain(ONBOARDING_SCREEN_PATH)
  })

  /**
   * **La porte à sens unique, vue d'en haut** (critère 5). L'erreur qui compte
   * n'est pas « le parcours ne s'affiche jamais » : c'est « il se re-propose »,
   * qui enferme l'utilisateur dans une boucle entre la racine et l'écran.
   */
  it('sert le tableau de bord dès que le parcours ne reste plus à faire', async () => {
    pendingState.value = false

    const outcome = await renderRoot()

    expect(outcome.digest).toBeNull()
    expect(outcome.html).not.toBe('')
  })
})

describe.skipIf(!databaseReachable)('la porte, une fois le parcours terminé', () => {
  /**
   * Le parcours terminé ne se re-propose pas, **même quand un module activé
   * après coup ajoute une étape neuve** : la progression est relue d'abord, et
   * la fin tranche sans qu'aucune étape ne soit dérivée.
   */
  it('ne se re-propose plus, module ajouté après coup compris', async () => {
    const userId = `usr_${randomUUID()}`

    stepsByUser.set(userId, [step('profile', { required: true })])

    expect(await service.useCases.proposed(userId)).toBe(true)

    await service.useCases.clear({ userId, stepId: 'profile', intent: 'continue' })

    expect(await service.useCases.proposed(userId)).toBe(false)

    // Un module activé après coup : une étape de plus, jamais franchie.
    stepsByUser.set(userId, [step('profile', { required: true }), step('offer')])

    expect(await service.useCases.proposed(userId)).toBe(false)
  })
})

/* ------------------------------------------------------------------------- *
 * Ce que l'écran refuse de proposer — la moitié visible du critère 6.
 * ------------------------------------------------------------------------- */

/** Un traducteur qui rend la clé : ce qui est mesuré ici est **quelles** clés. */
const keyTranslator = { t: (key: string) => key }

const renderCourse = (steps: readonly OnboardingStep[]): string =>
  renderToStaticMarkup(
    createElement(OnboardingScreen, {
      course: courseOf(steps, EMPTY_PROGRESS),
      intl: keyTranslator,
      actions: { continue: '/api/continue', skip: '/api/skip' },
      panel: null,
    }),
  )

describe('l’écran du parcours', () => {
  it('n’offre pas de passer une étape obligatoire', () => {
    const required = renderCourse([step('profile', { required: true, satisfied: false })])
    const optional = renderCourse([step('organization', { satisfied: false })])

    expect(required).not.toContain(ONBOARDING_KEYS.skip)
    expect(optional).toContain(ONBOARDING_KEYS.skip)
  })

  it('n’offre pas de valider une étape dont l’exigence n’est pas remplie', () => {
    const unmet = renderCourse([step('profile', { required: true, satisfied: false })])
    const met = renderCourse([step('profile', { required: true })])

    expect(unmet).not.toContain(ONBOARDING_KEYS.continue)
    expect(unmet).toContain(ONBOARDING_KEYS.required)
    expect(met).toContain(ONBOARDING_KEYS.continue)
  })
})

describe('le catalogue de l’écran', () => {
  /**
   * **Toutes** les clés fixes de l'écran sont livrées, dans chaque locale. Les
   * deux côtés sont dérivés : les clés du `domain`, les textes du contrat — une
   * clé ajoutée sans son texte ferait tomber l'écran en 500, aucune clé
   * manquante ne se repliant (s09).
   */
  it('livre chaque clé fixe de l’écran, dans chaque locale', () => {
    const keys = Object.values(ONBOARDING_KEYS)

    expect(keys.length).toBeGreaterThan(5)

    for (const locale of appLocales) {
      for (const key of keys) {
        const catalogue = onboardingModule.messages[locale] ?? {}

        expect(catalogue[key.slice('onboarding.'.length)], `${locale} / ${key}`).toBeDefined()
      }
    }
  })
})
