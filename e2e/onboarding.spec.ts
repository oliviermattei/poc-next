import { ONBOARDING_SCREEN_PATH } from '@repo/module-onboarding'
import { expect, test } from '@playwright/test'

import {
  anEmail as anAddress,
  clearRemainingOnboardingSteps,
  linkSentTo,
  signIn,
  signUp,
} from './support/account'
import { onboardingCourseMounted, urlOf } from './support/locale'

/**
 * Le parcours d'intégration, dans un vrai navigateur (s40).
 *
 * Ce que ce fichier prouve et qu'aucun test Vitest ne peut prouver : que le
 * compte fraîchement inscrit **atterrit** sur le parcours au lieu du tableau de
 * bord, qu'une étape obligatoire n'offre pas de sortie, et que le parcours
 * terminé ne se re-propose plus — la boucle que le critère 5 refuse.
 *
 * **Il n'emprunte pas `aSignedInAccount`**, et c'est le point : ce raccourci
 * referme le parcours pour les autres parcours de la suite, qui mesurent ce qui
 * vient après. Ici, le parcours est fait à la main, comme un utilisateur.
 *
 * Il est sauté quand le module n'est pas activé — la décision est **dérivée**
 * de `config/features.ts`, jamais concédée : dans cette configuration il n'y a
 * pas de parcours à faire, et c'est `pnpm test:minimal-profile` qui mesure que
 * l'écran répond alors 404.
 */

const anEmail = (): string => anAddress('s40-e2e')

test.describe('le parcours d’intégration', () => {
  test.skip(!onboardingCourseMounted(), 'module « onboarding » non activé dans cette configuration')

  test('mène l’inscrit au parcours, exige l’étape obligatoire, puis n’y revient plus', async ({
    page,
  }) => {
    const email = anEmail()

    await signUp(page, email)
    await page.goto(await linkSentTo(email))
    await signIn(page, email)

    // **Critère 1** : le parcours, pas le tableau de bord. `page.url()` ne
    // réessaie pas — il rougit si la redirection est encore en vol, ce qui est
    // le contrat que `signIn` porte pour ses appelants.
    expect(page.url()).toMatch(urlOf(ONBOARDING_SCREEN_PATH))
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()

    // **Critère 6** : l'étape de profil est obligatoire. Aucune sortie n'est
    // offerte tant que le nom posé à l'inscription n'a pas été remplacé — ni
    // « passer », ni « continuer ».
    await expect(page.getByRole('button', { name: 'Passer cette étape' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Continuer' })).toHaveCount(0)

    // La racine y ramène tant qu'il reste à faire : c'est la porte, dans le
    // sens qui n'enferme personne.
    await page.goto('/')
    expect(page.url()).toMatch(urlOf(ONBOARDING_SCREEN_PATH))

    // Le nom, saisi dans le formulaire que `/account` porte déjà.
    await page.getByLabel('Nom').fill('Camille Durand')
    await page.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByRole('status')).toBeVisible()

    // L'exigence remplie, l'étape se franchit — et les suivantes, facultatives,
    // se passent. Le parcours est **dérivé des modules activés** : la boucle du
    // harnais ne nomme aucune étape, elle suit ce que l'écran propose. Elle est
    // partagée avec le parcours doré, qui referme ainsi le parcours d'un
    // acheteur après l'avoir suivi.
    await clearRemainingOnboardingSteps(page)

    // **Critère 5** : le parcours terminé mène au tableau de bord, et la racine
    // n'y ramène plus. L'erreur qui compte de ce côté est la boucle.
    expect(page.url()).toMatch(urlOf('/'))

    await page.goto(ONBOARDING_SCREEN_PATH)
    expect(page.url()).toMatch(urlOf('/'))
  })
})
