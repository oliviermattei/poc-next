import { MODULE_ROUTE_PREFIX } from '@repo/core'
import { createDatabaseClient } from '@repo/db'
import { billingWebhookEvent, PRICING_SCREEN_PATH } from '@repo/module-billing'
import { demoEnabledModule } from '@repo/module-demo-enabled'
import { ONBOARDING_SCREEN_PATH } from '@repo/module-onboarding'
import { expect, test, type Page } from '@playwright/test'

import { billing } from '../../apps/web/lib/billing'
import { organizations } from '../../apps/web/lib/organizations'
import { resolveGoldenPathRegime, verifyEventIdMark } from '../../scripts/golden-path-regime'
import {
  clearRemainingOnboardingSteps,
  linkSentTo,
  PASSWORD,
  signIn,
  signUp,
} from '../support/account'
import { onboardingCourseMounted, publicPath, signedInLanding, urlOf } from '../support/locale'
import { humanDuration, measuredStep, totalOf, type StepMeasurement } from '../support/steps'

/**
 * **Le parcours doré** (s25) — clone → premier paiement, le critère de succès
 * n°1 du PRD, joué de bout en bout dans un vrai navigateur.
 *
 * Ce fichier ne s'exécute **pas** avec `pnpm test:e2e` : il a sa propre
 * commande, `pnpm test:golden-path`, qui l'amorce depuis un clone neuf et une
 * base vierge, puis journalise les trois durées. Chaque story paierait sinon un
 * amorçage complet, alors que la CI, elle, le lance.
 *
 * ## Ce que ce fichier mesure, et ce qu'il ne juge pas
 *
 * Il **mesure**. Le seuil des trente minutes du PRD reste une recette humaine :
 * un parcours qui rougirait à la trente-et-unième minute transformerait une
 * promesse commerciale en régression de CI, sur une machine dont personne ne
 * contrôle la charge. Ce qui rougit ici est un **blocage** — une étape qui
 * dépasse son budget —, et l'échec nomme l'étape.
 *
 * ## Pourquoi les identités sont fixes
 *
 * `parcours-dore@example.test`, `parcours-dore-achat@example.test`, l'organisation
 * `parcours-dore` : aucun UUID. C'est la garde du critère 2 — « une base vierge,
 * sans état résiduel ». Rejouée sur une base déjà servie, la création
 * d'organisation se heurte à l'identifiant déjà pris, et l'écran réservé
 * apparaît déjà ouvert : le parcours rougit au lieu de mesurer une base qui
 * n'était pas vierge. Des identités aléatoires auraient rendu ce défaut
 * invisible, ce qui est exactement l'erreur que la story cherche à ne pas
 * commettre.
 *
 * ## Le parcours d'intégration est **traversé**, jamais refermé (s40)
 *
 * Depuis s40, un compte neuf atterrit sur le parcours d'intégration avant le
 * tableau de bord. Le reste de la suite le **referme** par une écriture en base
 * (`closeOnboardingCourse`) : ce que ces parcours mesurent vient après
 * l'intégration, et le leur faire traverser coûterait un formulaire par compte.
 * Ici, non — et c'est une décision, pas une omission.
 *
 * Le parcours doré est « clone → premier paiement », c'est-à-dire le chemin
 * **réel** d'un acheteur. Depuis s40 ce chemin passe par le parcours
 * d'intégration : le refermer d'un `insert` ferait mesurer au premier critère de
 * succès du PRD un chemin que plus personne n'emprunte — moins cher, et faux de
 * ce qu'il prétend mesurer. Le fondateur le traverse donc pour de vrai : il
 * **remplit** l'étape de profil, atteint l'organisation puis les offres **depuis
 * le parcours**, et franchit la dernière étape. Deux garanties que la story vend
 * se trouvent ainsi mesurées dans le parcours qui vend le produit — une étape qui
 * disparaît parce que sa donnée existe (l'organisation créée), et une porte qui
 * ne se rouvre pas.
 *
 * **Le coût est mesuré, jamais concédé** : la traversée porte ses propres étapes
 * chronométrées, sous le même budget que les autres. Aucun budget n'est relevé
 * pour elle.
 *
 * Les deux variantes de paiement, elles, ne traversent pas : leur sujet est la
 * **forme** du paiement, et elles vont droit aux offres. Leur atterrissage est
 * simplement **dérivé** (`signedInLanding`) — ni écrit en dur, ni refermé.
 *
 * Un dépôt qui coupe le module `onboarding` n'a rien à traverser : la décision
 * est dérivée de la configuration, et le journal dit lequel des deux régimes a
 * été mesuré.
 */

/** Les mesures d'étape de l'exécution, journalisées à la fin de chaque parcours. */
const measured: StepMeasurement[] = []

/**
 * **Y a-t-il un parcours d'intégration sur la route de l'acheteur ?**
 *
 * Dérivé, jamais écrit : couper le module est une ligne de `config/features.ts`,
 * et le parcours doré doit rester vrai des deux côtés.
 */
const COURSE_ON_THE_WAY = onboardingCourseMounted()

/**
 * Le budget d'une étape (critère 8), en millisecondes.
 *
 * Large : il borne un **blocage**, pas une lenteur. La machine du parcours doré
 * peut être un runner à deux cœurs qui vient de compiler l'application.
 */
const STEP_BUDGET_MS = 90_000

const step = async <T>(name: string, run: () => Promise<T>): Promise<T> =>
  await measuredStep(name, STEP_BUDGET_MS, run, measured)

/**
 * Le chemin de la route réservée, **dérivé du contrat du module** : le recopier
 * ferait un parcours qui reste vert quand la route déménage.
 *
 * Aucune route réservée déclarée **refuse en le disant** (constat F9 de la
 * revue) : le repli sur la chaîne vide faisait rougir le parcours sur une URL
 * tronquée, c'est-à-dire sur un message qui ne nomme pas la cause.
 */
const premiumRoute = (): string => {
  const declared = demoEnabledModule.routes.find(
    (route) => route.protection.level === 'entitlement',
  )?.path

  if (declared === undefined) {
    throw new Error(
      `Le module ${demoEnabledModule.id} ne déclare plus aucune route de niveau « entitlement » : ` +
        'le parcours doré n’a plus de mur payant à franchir, et son critère central n’a plus de ' +
        'sujet.',
    )
  }

  return declared
}

const PREMIUM_ROUTE = premiumRoute()

const FOUNDER = 'parcours-dore@example.test'
/**
 * Le nom que le fondateur **choisit** à l'étape de profil.
 *
 * Il n'est pas décoratif : l'inscription pose le nom à l'adresse, et l'étape
 * obligatoire ne se franchit pas tant que ce nom-là n'a pas été remplacé.
 */
const FOUNDER_NAME = 'Camille Fondatrice'
const BUYER = 'parcours-dore-achat@example.test'
const ORGANIZATION = { name: 'Parcours doré', slug: 'parcours-dore' }

/**
 * **L'écran que l'étape en cours propose**, atteint depuis le parcours — ou
 * demandé directement quand il n'y a pas de parcours à suivre.
 *
 * C'est ce que fait un acheteur : il suit ce qu'on lui propose. Le passage par
 * la racine n'est pas décoratif — il mesure, **au milieu du chemin d'achat**,
 * que le parcours reprend à l'étape en cours (critère 4 de s40) et que la
 * précédente en est sortie.
 *
 * Le libellé de l'action vient du catalogue du module ; l'adresse, elle, est
 * celle que le parcours doré demanderait de toute façon. Les deux régimes
 * finissent donc sur la **même** assertion d'arrivée.
 */
const reachFromCourse = async (page: Page, action: string, screen: string): Promise<void> => {
  if (COURSE_ON_THE_WAY) {
    await page.goto('/')
    await expect(page).toHaveURL(urlOf(ONBOARDING_SCREEN_PATH))
    await page.getByRole('link', { name: action }).click()
  } else {
    await page.goto(publicPath(screen))
  }

  await expect(page).toHaveURL(urlOf(screen))
}

/** Le droit d'accès, des deux côtés du mur : l'écran **et** la route. */
const expectFeatureGranted = async (page: Page): Promise<void> => {
  await page.goto('/premium')
  await expect(page.getByText('Accès ouvert')).toBeVisible()

  const served = await page.request.get(`${MODULE_ROUTE_PREFIX}${PREMIUM_ROUTE}`)

  expect(served.status(), 'la route réservée doit être servie une fois le droit acquis').toBe(200)
}

/** L'état verrouillé : ce que voit un compte qui n'a rien payé. */
const expectFeatureLocked = async (page: Page): Promise<void> => {
  await page.goto('/premium')
  await expect(page.getByText('Réservé aux offres payantes')).toBeVisible()

  const refused = await page.request.get(`${MODULE_ROUTE_PREFIX}${PREMIUM_ROUTE}`)

  expect(refused.status(), 'la route réservée doit refuser sans le droit').toBe(403)
}

/**
 * Les trois parcours s'exécutent **l'un après l'autre**, jamais en série au sens
 * de Playwright.
 *
 * La distinction est mesurée : `mode: 'serial'` **saute** les cas suivants dès
 * qu'un cas échoue, et une mutation posée sur le droit d'accès n'a fait rougir
 * qu'un parcours sur trois — les deux autres, qui la portaient aussi, ont
 * disparu du rapport. Un rapport qui cache deux constats vrais vaut moins qu'un
 * rapport lent. La sérialisation vient donc de la configuration
 * (`workers: 1`, `fullyParallel: false`), qui ordonne sans masquer.
 */

/**
 * **Les deux modules que le parcours doré exige**, affirmés une fois pour les
 * trois parcours (constat F9 de la revue).
 *
 * Le premier parcours **affirmait** pendant que les deux autres **sautaient** :
 * `billing` coupé, la commande rougissait sur l'un et taisait les deux autres.
 * Le parcours doré est « clone → premier paiement » : un dépôt qui ne vend rien
 * n'a pas de parcours doré, et c'est un refus, pas un saut.
 */
test.beforeAll(() => {
  expect(billing.available, 'le parcours doré exige le module de facturation').toBe(true)
  expect(organizations.available, 'le parcours doré exige le module d’organisations').toBe(true)

  // **Lequel des deux régimes a été mesuré**, dit à côté des durées : le
  // parcours doré n'exige pas l'intégration — il la traverse quand elle est là.
  console.log(
    COURSE_ON_THE_WAY
      ? '  parcours d’intégration : traversé par le fondateur (module activé)'
      : '  parcours d’intégration : absent (module coupé), chaque étape va droit à son écran',
  )
})

test.afterAll(() => {
  for (const entry of measured) {
    console.log(`  étape « ${entry.name} » : ${humanDuration(entry.durationMs)}`)
  }

  console.log(`  somme des étapes du parcours : ${humanDuration(totalOf(measured))}`)
})

/**
 * **Le parcours doré lui-même** (critère 1) : inscription, vérification
 * d'email, parcours d'intégration, organisation, souscription, fonctionnalité
 * réservée.
 *
 * Les étapes sont enchaînées dans **un seul** cas : ce qui est mesuré est la
 * chaîne, et une étape qui ne mène pas à la suivante doit rougir plutôt que de
 * laisser la suivante repartir d'un état posé à la main. C'est aussi pourquoi
 * l'intégration est traversée plutôt que refermée : la refermer poserait à la
 * main, en base, l'état que l'acheteur atteint en cliquant.
 */
test('un clone mène à un premier paiement, et le paiement ouvre la fonctionnalité', async ({
  page,
}) => {
  await step('inscription', async () => {
    await signUp(page, FOUNDER)
  })

  await step('vérification de l’adresse email', async () => {
    await page.goto(await linkSentTo(FOUNDER))
  })

  await step('connexion', async () => {
    await signIn(page, FOUNDER)
    // **L'atterrissage est dérivé** : le parcours d'intégration quand il est
    // monté, le tableau de bord sinon. C'est là que cette commande partait
    // rouge après s40, sur un motif ancré qui ne connaissait que le second.
    await expect(page).toHaveURL(urlOf(signedInLanding()))
  })

  if (COURSE_ON_THE_WAY) {
    await step('parcours d’intégration : l’étape de profil', async () => {
      await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()

      // Le nom est saisi dans le formulaire que `/account` porte déjà — le
      // parcours n'en écrit pas un second. Tant qu'il n'est pas choisi, l'étape
      // obligatoire n'offre aucune sortie : ce refus-là est mesuré par
      // `e2e/onboarding.spec.ts`, dont c'est le sujet.
      await page.getByLabel('Nom').fill(FOUNDER_NAME)
      await page.getByRole('button', { name: 'Enregistrer' }).click()
      await expect(page.getByRole('status')).toBeVisible()

      await page.getByRole('button', { name: 'Continuer' }).click()
      await expect(page).toHaveURL(urlOf(ONBOARDING_SCREEN_PATH))
    })
  }

  await step('création de l’organisation', async () => {
    await reachFromCourse(page, 'Créer une organisation', '/organizations')

    const form = page.getByRole('form', { name: 'Créer une organisation' })

    await form.getByLabel('Nom').fill(ORGANIZATION.name)
    await form.getByLabel('Identifiant').fill(ORGANIZATION.slug)
    await form.getByRole('button', { name: 'Créer l’organisation' }).click()

    // Le sélecteur porte le nom de l'organisation courante : c'est le signal
    // que la création a abouti, et non que le formulaire a été soumis.
    await expect(page.getByRole('button', { name: ORGANIZATION.name })).toBeVisible()
  })

  // **Avant tout paiement, la porte est fermée** — et c'est aussi la garde du
  // critère 2 : sur une base déjà servie, cette assertion trouverait la porte
  // ouverte et rougirait.
  await step('la fonctionnalité réservée refuse un compte qui n’a rien payé', async () => {
    await expectFeatureLocked(page)
  })

  await step('souscription d’une offre', async () => {
    // L'organisation existe désormais : son étape a **disparu du parcours par
    // dérivation**, sans que personne ne l'ait franchie, et c'est l'offre qui
    // est proposée. Rien ici ne le suppose — le libellé cliqué est celui de
    // l'étape en cours, et le parcours rougirait s'il en restait une autre.
    await reachFromCourse(page, 'Voir les offres', '/billing')

    const subscribe = page.getByRole('button', { name: 'Souscrire' }).first()

    await expect(subscribe).toBeEnabled()
    await subscribe.click()
    await expect(page).toHaveURL(urlOf('/billing', '?checkout=success'))
    // **L'état vient de la base**, écrite par le webhook que la route de
    // simulation a fait passer par la vraie route du module. Un
    // `?checkout=success` n'accorde rien par lui-même.
    await expect(page.getByText('Période d’essai').first()).toBeVisible()
  })

  if (COURSE_ON_THE_WAY) {
    await step('fin du parcours d’intégration', async () => {
      await page.goto('/')
      await expect(page).toHaveURL(urlOf(ONBOARDING_SCREEN_PATH))

      // Ce qu'il reste est franchi comme l'écran le propose, sans nommer une
      // étape : c'est la même boucle que le parcours dont l'intégration est le
      // sujet.
      await clearRemainingOnboardingSteps(page)

      // **La porte à sens unique**, mesurée dans le parcours qui vend le
      // produit : le parcours terminé mène au tableau de bord, et la racine n'y
      // ramène plus. L'erreur qui compte de ce côté est la boucle.
      await expect(page).toHaveURL(urlOf('/'))

      await page.goto(ONBOARDING_SCREEN_PATH)
      await expect(page).toHaveURL(urlOf('/'))
    })
  }

  await step('accès à la fonctionnalité réservée', async () => {
    await expectFeatureGranted(page)
  })
})

/**
 * **Variante achat unique** (critère 3) : le même mur, franchi par un paiement
 * qui n'est pas un abonnement.
 *
 * Elle n'existe pas pour doubler le parcours : elle existe parce que le droit
 * d'accès ne se lit **pas** sur un état d'abonnement (s20, s21), et que rien
 * d'autre ne le prouve de bout en bout.
 */
test('un achat unique ouvre la même fonctionnalité qu’un abonnement', async ({ page }) => {
  await step('inscription de l’acheteur', async () => {
    await signUp(page, BUYER)
    await page.goto(await linkSentTo(BUYER))
    await signIn(page, BUYER)
    // L'atterrissage est dérivé : ce parcours ne traverse pas l'intégration —
    // son sujet est la forme du paiement, et il va droit aux offres.
    await expect(page).toHaveURL(urlOf(signedInLanding()))
  })

  await step('achat unique', async () => {
    await page.goto('/billing')

    const buy = page.getByRole('button', { name: 'Acheter' })

    await expect(buy).toBeEnabled()
    await buy.click()
    await expect(page).toHaveURL(urlOf('/billing', '?checkout=success'))
    await expect(page.getByText('Payé')).toBeVisible()
  })

  await step('accès à la fonctionnalité après un achat unique', async () => {
    await expectFeatureGranted(page)
  })
})

/**
 * **Variante guest checkout** (critère 3, s24) : payer d'abord, avoir un compte
 * ensuite.
 *
 * Le chemin complet, jusqu'au droit d'accès : le compte naît du **webhook**, le
 * seul chemin qui y mène est le lien reçu par email, et c'est ce compte-là qui
 * doit trouver la fonctionnalité ouverte.
 */
test('un paiement sans compte mène, par l’email reçu, à la fonctionnalité ouverte', async ({
  page,
}) => {
  const paidAt = Date.now()
  let guestEmail = ''

  await step('paiement depuis la page publique de tarifs', async () => {
    await page.goto(publicPath(PRICING_SCREEN_PATH))

    // L'aller vers la page hébergée simulée porte l'identifiant de session, et
    // c'est de lui que le simulateur dérive l'adresse qu'une vraie page aurait
    // collectée. Le retour, lui, est une URL publique qui ne porte rien.
    const hosted = page.waitForRequest((request) =>
      request.url().includes('/api/billing-local-checkout'),
    )

    await page.getByRole('button', { name: 'Souscrire' }).first().click()

    const sessionId = new URL((await hosted).url()).searchParams.get('session') ?? ''

    expect(sessionId).not.toBe('')
    guestEmail = `${sessionId}@guest.local`

    await page.waitForURL(/\/pricing\?checkout=success/)
  })

  await step('ouverture du compte par le lien reçu', async () => {
    const link = await linkSentTo(guestEmail, { since: paidAt })

    expect(link).toContain('/reset-password?token=')

    await page.goto(link)
    await page.getByLabel('Nouveau mot de passe').fill(PASSWORD)
    await page.getByRole('button', { name: 'Changer le mot de passe' }).click()
    await expect(page).toHaveURL(urlOf('/sign-in', '?reset=1'))

    await signIn(page, guestEmail)
    // Même raison que la variante précédente : l'atterrissage est dérivé, et
    // ce que ce parcours mesure est le chemin du paiement invité.
    await expect(page).toHaveURL(urlOf(signedInLanding()))
  })

  await step('accès à la fonctionnalité après un paiement invité', async () => {
    await expectFeatureGranted(page)
  })
})

/**
 * **La preuve que le serveur a joué le régime que la commande a demandé**
 * (constat F1 de la revue de s25).
 *
 * C'est le filet qui manquait, et la story n'existe que pour la garantie qu'il
 * porte. La chaîne est : `GOLDEN_PATH_PAYMENTS` → `PAYMENTS_RECORDED_EVENTS`
 * posé dans `webServer.env` → `resolveBillingConfig` → source d'événements.
 * Chaque maillon mordait, **sauf la couture** : le serveur ne sait pas ce que
 * la commande a demandé, et sans la variable il retombe sur le simulateur.
 * Mesuré par la revue : la ligne retirée, une exécution annonçant « recorded »
 * passait au vert, trois parcours, sortie 0.
 *
 * Ce cas exige donc un signal **positif** — les identifiants réellement écrits
 * par la vraie route de webhook dans son journal d'idempotence — et il lit le
 * régime dans l'environnement de la **commande**, que la configuration de
 * Playwright ne peut pas altérer. La règle vit dans `scripts/golden-path-regime.ts`,
 * où `tests/golden-path.test.ts` l'éprouve sans navigateur ; ce cas-ci lui
 * apporte l'observation.
 */
test('le serveur a joué le régime demandé, et ses événements le prouvent', async () => {
  const regime = resolveGoldenPathRegime(process.env)
  const connection = createDatabaseClient({
    connectionString: process.env.DATABASE_URL ?? '',
  })

  try {
    const processed = await connection.db
      .select({ eventId: billingWebhookEvent.eventId })
      .from(billingWebhookEvent)

    verifyEventIdMark(
      regime,
      processed.map((row) => row.eventId),
    )
  } finally {
    await connection.close()
  }
})
