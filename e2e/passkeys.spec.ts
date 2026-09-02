import { expect, test, type Page } from '@playwright/test'

import { aSignedInAccount, PASSWORD, signIn, signOut } from './support/account'
import { clickOnce } from './support/interaction'
import { urlOf } from './support/locale'

/**
 * Les passkeys, dans un vrai navigateur (s14).
 *
 * Ce que ce fichier prouve et qu'aucun test Vitest ne peut prouver :
 *
 * - la **cérémonie réelle**. `tests/auth.test.ts` fabrique ses attestations et
 *   ses assertions (`tests/fixtures/webauthn.ts`) : elle mesure ce que le
 *   serveur accepte, jamais ce qu'un navigateur accepte de produire. Ici,
 *   c'est Chrome qui signe, par son authentificateur virtuel, et c'est lui qui
 *   refuserait un `rpId` qui n'est pas un suffixe de son origine ;
 * - la **liaison entre le bouton et `navigator.credentials`** : un écran qui
 *   n'appellerait jamais la cérémonie passerait tous les tests de nœud ;
 * - le fait que le bouton **n'existe pas** quand le navigateur ne sait pas
 *   faire de WebAuthn — le critère 4 de la story. C'est une propriété du
 *   navigateur : le rendu serveur ne peut pas la connaître, et aucun test de
 *   nœud ne peut la voir.
 *
 * Ce que ce parcours ne prouve pas : rien d'un authentificateur **réel**. Ni
 * Touch ID, ni clé de sécurité, ni gestionnaire de mots de passe ; un seul
 * navigateur (Chromium), une seule origine (`localhost`), un seul `rpId`.
 */

/**
 * L'authentificateur virtuel de Chrome, monté par le protocole de débogage.
 *
 * `hasResidentKey` est ce qui rend la **clé découvrable** possible : c'est ce
 * qui permet à l'écran de connexion de ne demander aucune adresse — le
 * navigateur propose les passkeys qu'il détient, et le serveur n'apprend rien
 * de personne (`docs/security.md` §7).
 *
 * `isUserVerified` et `automaticPresenceSimulation` remplacent le geste
 * humain : sans le second, la cérémonie attendrait indéfiniment un doigt.
 */
const withVirtualAuthenticator = async (page: Page): Promise<void> => {
  const client = await page.context().newCDPSession(page)

  await client.send('WebAuthn.enable')
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
}

/**
 * Le geste d'un bouton de cet écran, **une fois**, puis son achèvement.
 *
 * Le reclic est parti d'ici pour la raison mesurée dans
 * `support/interaction.ts` : à un cœur, le second clic tombait sur une page
 * **déjà en navigation** — le journal montre `navigated to …/fr` juste après
 * l'expiration de l'attente interne —, et l'attente suivante regardait
 * l'ancienne page ou la nouvelle selon le hasard.
 *
 * Les délais de 2 000 à 5 000 ms qui bornaient chaque attente sont partis avec
 * la boucle : ils bornaient **un essai** dans un `toPass` de 20 s, pas le geste.
 * Ce qui reste est le délai par défaut du projet. Aucun délai n'est allongé.
 *
 * `exact` : l'écran de compte porte « Enregistrer le nom », « Enregistrer ce
 * nom » et « Enregistrer une passkey ». Une correspondance partielle en
 * désignerait trois, et Playwright refuserait de cliquer.
 */
const press = async (page: Page, name: string, settled: () => Promise<void>): Promise<void> => {
  await clickOnce(page, page.getByRole('button', { name, exact: true }), settled)
}

test('enregistrement, connexion sans mot de passe, renommage puis révocation', async ({ page }) => {
  await withVirtualAuthenticator(page)

  const email = await aSignedInAccount(page, 's14-e2e')

  await page.goto('/account')

  // --- Aucune passkey : l'état vide, avec l'action qui en sort -----------
  await expect(page.getByText('Aucune passkey enregistrée')).toBeVisible()

  // --- Enregistrement ---------------------------------------------------
  await press(page, 'Enregistrer une passkey', async () => {
    await expect(page.getByText('Passkey sans nom')).toBeVisible()
  })

  // Le critère 1 : elle apparaît **avec sa date de création**. Sans nom pour
  // l'instant — la cérémonie part d'un clic, pas d'un formulaire.
  await expect(page.getByText(/^Ajoutée le /)).toBeVisible()

  // --- Renommage --------------------------------------------------------
  await press(page, 'Renommer la passkey Passkey sans nom', async () => {
    await expect(page.getByLabel('Nouveau nom')).toBeVisible()
  })

  await page.getByLabel('Nouveau nom').fill('MacBook')
  await press(page, 'Enregistrer ce nom', async () => {
    await expect(page.getByText('MacBook', { exact: true })).toBeVisible()
  })

  // --- Connexion sans mot de passe --------------------------------------
  await signOut(page)
  await page.goto('/sign-in')

  await press(page, 'Se connecter avec une passkey', async () => {
    await expect(page).toHaveURL(urlOf('/'))
  })

  // La session est bien celle du compte : l'écran de compte le sert.
  await page.goto('/account')
  await expect(page.getByText(email)).toBeVisible()

  // --- Révocation -------------------------------------------------------
  // Le mot de passe reste : la passkey n'est pas le dernier moyen de
  // connexion, et le bouton existe donc.
  await press(page, 'Révoquer la passkey MacBook', async () => {
    await expect(page.getByText('Aucune passkey enregistrée')).toBeVisible()
  })

  // --- Et elle n'ouvre plus rien ----------------------------------------
  await signOut(page)
  await page.goto('/sign-in')

  await press(page, 'Se connecter avec une passkey', async () => {
    // Le texte plutôt que le rôle : Next pose son propre `role="alert"` vide
    // (`__next-route-announcer__`) sur chaque page, et il gagne la sélection.
    await expect(page.getByText('Connexion par passkey impossible')).toBeVisible()
  })

  await expect(page).toHaveURL(urlOf('/sign-in'))
})

test('sans WebAuthn, l’option disparaît et les autres moyens de connexion restent', async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: 'fr-FR' })
  const page = await context.newPage()

  // **Le navigateur ne sait pas faire.** `browserSupportsWebAuthn()` regarde
  // `globalThis.PublicKeyCredential` ; le retirer avant tout script de la page
  // reproduit exactement un navigateur ou un appareil incompatible. C'est le
  // critère 4, et il ne se mesure que là.
  await context.addInitScript(() => {
    // @ts-expect-error — on retire délibérément une propriété du navigateur.
    delete globalThis.PublicKeyCredential
  })

  try {
    const email = await aSignedInAccount(page, 's14-e2e-sans-webauthn')

    // Les paramètres : la carte reste, la liste aussi, le bouton non.
    await page.goto('/account')
    await expect(page.getByText('Aucune passkey enregistrée')).toBeVisible()

    // **Le témoin d'hydratation, et il n'est pas décoratif.** Sans lui,
    // `toHaveCount(0)` passe avant que React n'ait rendu quoi que ce soit de
    // client : mesuré — la garde `browserSupportsWebAuthn()` retirée des deux
    // composants, ce cas restait **vert**. Les boutons d'envoi de l'écran sont
    // désactivés jusqu'à l'hydratation (`use-hydrated.ts`) : en attendre un
    // actif, c'est attendre que le rendu client ait eu lieu. L'absence
    // constatée ensuite en est une.
    await expect(page.getByRole('button', { name: 'Changer le mot de passe' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Enregistrer une passkey' })).toHaveCount(0)

    await signOut(page)

    // L'écran de connexion : pas de bouton de passkey, et le mot de passe
    // fonctionne toujours.
    await page.goto('/sign-in')
    await expect(page.getByRole('button', { name: 'Se connecter', exact: true })).toBeEnabled()
    await expect(
      page.getByRole('button', { name: 'Se connecter avec une passkey' }),
    ).toHaveCount(0)

    await signIn(page, email, PASSWORD)
    await expect(page).toHaveURL(urlOf('/'))
  } finally {
    await context.close()
  }
})

test('une cérémonie d’enrôlement annulée le dit, et n’écrit rien', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'fr-FR' })
  const page = await context.newPage()

  // **Le geste que rien n'automatise : fermer la fenêtre du système.** Chrome
  // le rend par un `NotAllowedError` sur `navigator.credentials.create` — c'est
  // le même rejet que l'authentificateur virtuel ne sait pas produire, et la
  // même technique que le cas « sans WebAuthn » plus haut : on déplace le
  // **navigateur**, jamais le code de l'application. Ce qui est mesuré ensuite
  // est entièrement à nous : le message rendu, et l'absence de requête
  // d'enrôlement.
  await context.addInitScript(() => {
    navigator.credentials.create = () =>
      Promise.reject(
        new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'),
      )
  })

  try {
    await aSignedInAccount(page, 's14-e2e-annulation')

    const posted: string[] = []

    page.on('request', (request) => {
      if (request.method() === 'POST') {
        posted.push(request.url())
      }
    })

    await page.goto('/account')
    await expect(page.getByText('Aucune passkey enregistrée')).toBeVisible()

    // Le critère 5 de la story, dans ses deux moitiés.
    await press(page, 'Enregistrer une passkey', async () => {
      // **Annuler n'est pas échouer**, et le message le dit : il nomme le
      // geste et son absence de conséquence, là où « L'opération a échoué »
      // enverrait réessayer une personne qui vient de renoncer.
      await expect(
        page.getByText('Enregistrement annulé. Aucune passkey n’a été ajoutée.'),
      ).toBeVisible()
    })

    await expect(
      page.getByText('L’opération a échoué. Réessayez dans un instant.'),
    ).toHaveCount(0)

    // « Sans créer d'entrée orpheline » : aucune requête d'enrôlement n'est
    // partie — la cérémonie s'est arrêtée avant —, et la liste servie par le
    // serveur après rechargement est toujours vide.
    expect(posted.filter((url) => url.includes('/passkey/verify-registration'))).toEqual([])

    await page.reload()
    await expect(page.getByText('Aucune passkey enregistrée')).toBeVisible()
  } finally {
    await context.close()
  }
})
