import { createHmac } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import { aSignedInAccount, PASSWORD, signIn } from './support/account'
import { anonymousLanding, urlOf } from './support/locale'

/**
 * Le second facteur, dans un vrai navigateur (s13).
 *
 * Ce que ce fichier prouve et qu'aucun test Vitest ne peut prouver :
 *
 * - le **secret affiché** à l'écran d'enrôlement est celui qui vérifie le code.
 *   Le parcours ne le reçoit d'aucune API : il le **lit dans la page**, comme
 *   quelqu'un qui n'a pas de caméra, puis en dérive le code. Un écran qui
 *   afficherait un autre secret que celui qui a été stocké passerait tous les
 *   tests de nœud et échouerait ici ;
 * - la **redirection vers l'écran de vérification** après le mot de passe.
 *   Côté nœud, la réponse `{ twoFactor: true }` est mesurée ; le fait que le
 *   formulaire de connexion y **aille** ne l'est pas ;
 * - les **codes de secours affichés une seule fois** : quitter l'écran puis y
 *   revenir ne les rend pas.
 *
 * Le QR n'est pas décodé — il n'existe pas de lecteur ici. Ce qui est vérifié
 * de lui est qu'il est rendu, avec un nom accessible : le secret, lui, est
 * exercé par le chemin manuel, qui porte la même valeur.
 */

const TOTP_PERIOD_MS = 30_000

/** RFC 4648 sans remplissage : la forme d'un secret TOTP. */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

const base32Decode = (input: string): Buffer => {
  let bits = 0
  let value = 0
  const bytes: number[] = []

  for (const character of input.toUpperCase().replace(/=+$/, '')) {
    const index = BASE32_ALPHABET.indexOf(character)

    if (index < 0) {
      throw new Error(`Caractère base32 inattendu : « ${character} »`)
    }

    value = (value << 5) | index
    bits += 5

    if (bits >= 8) {
      bits -= 8
      bytes.push((value >>> bits) & 0xff)
    }
  }

  return Buffer.from(bytes)
}

/**
 * Le code TOTP dérivé du secret **lu à l'écran**, à `periods` périodes de
 * maintenant.
 *
 * Le décalage n'est pas une commodité : **un compteur ne sert qu'une fois**
 * (garde de rejeu, revue s13 C3). Le code qui confirme l'enrôlement brûle son
 * compteur, et la connexion qui suit — quelques secondes plus tard, donc dans
 * la même période — doit présenter le suivant. La fenêtre de vérification vaut
 * ±1 période, il est donc accepté.
 */
const totpOf = (secret: string, periods = 0): string => {
  const key = base32Decode(secret.replaceAll(' ', ''))
  const block = Buffer.alloc(8)

  block.writeBigUInt64BE(BigInt(Math.floor(Date.now() / TOTP_PERIOD_MS) + periods))

  const digest = createHmac('sha1', key).update(block).digest()
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f
  const truncated =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff)

  return (truncated % 1_000_000).toString().padStart(6, '0')
}

/**
 * Écarte la fin d'une période avant de dériver un code.
 *
 * La fenêtre de vérification vaut ±1 période, donc un code dérivé à la fin
 * d'une période reste valide ; ce qui ne l'est pas, c'est de dériver **puis**
 * d'attendre l'hydratation, la saisie et l'aller-retour réseau. `retries: 0`
 * est délibéré dans ce dépôt : un parcours instable n'y garde rien.
 */
const withinStablePeriod = async (): Promise<void> => {
  const remaining = TOTP_PERIOD_MS - (Date.now() % TOTP_PERIOD_MS)

  if (remaining < 10_000) {
    await new Promise((accept) => setTimeout(accept, remaining + 100))
  }
}

/** Le clic rejoué jusqu'à ce qu'il prenne — un bouton non hydraté l'avale. */
const clickUntil = async (
  page: Page,
  name: string,
  settled: () => Promise<void>,
): Promise<void> => {
  await expect(async () => {
    await page.getByRole('button', { name }).click()
    await settled()
  }).toPass({ timeout: 20_000 })
}

const signOut = async (page: Page): Promise<void> => {
  await page.goto('/account')
  await clickUntil(page, 'Se déconnecter', async () => {
    await expect(page).toHaveURL(urlOf(anonymousLanding()), { timeout: 2_000 })
  })
}

test('activation, connexion par code, puis connexion par code de secours', async ({ page }) => {
  const email = await aSignedInAccount(page, 's13-e2e')

  await page.goto('/account')
  await expect(page.getByText('Désactivée', { exact: true })).toBeVisible()

  // --- Activation -------------------------------------------------------
  // Le champ est désigné par **son identifiant**, pas par son libellé :
  // « Mot de passe actuel » est aussi celui de la carte « Mot de passe », et
  // `.first()` viserait l'autre carte — le formulaire partirait vide, et le
  // parcours échouerait en accusant l'activation.
  await page.locator('#two-factor-enable-password').fill(PASSWORD)
  await clickUntil(page, 'Activer', async () => {
    await expect(page.getByRole('img', { name: /Code QR/ })).toBeVisible({ timeout: 2_000 })
  })

  // Le secret est **lu dans la page** : c'est le chemin de qui n'a pas de
  // caméra, et c'est ce qui rend le QR et le texte solidaires.
  const secret = (await page.getByText(/^[A-Z2-7 ]{30,}$/).innerText()).trim()

  await withinStablePeriod()
  await page.getByLabel('Code à six chiffres').fill(totpOf(secret))
  await clickUntil(page, 'Confirmer', async () => {
    await expect(page.getByRole('status')).toContainText('Notez ces dix codes', {
      timeout: 2_000,
    })
  })

  // Les éléments de liste **de la forme d'un code** : la page en porte
  // d'autres — navigation, sessions, connexions —, et les compter tous ferait
  // dire au parcours qu'il y a dix-sept codes de secours.
  const backupCodes = await page
    .getByRole('listitem')
    .filter({ hasText: /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/ })
    .allInnerTexts()

  expect(backupCodes).toHaveLength(10)

  await clickUntil(page, 'J’ai noté ces codes', async () => {
    await expect(page.getByText('Activée', { exact: true })).toBeVisible({ timeout: 2_000 })
  })

  // **Affichés une seule fois** : rien ne les relit, ni l'écran, ni une route.
  await page.reload()
  await expect(page.getByText(backupCodes[0] ?? 'code-absent')).toHaveCount(0)

  // --- Connexion par code d'application ---------------------------------
  await signOut(page)
  await page.goto('/sign-in')
  await signIn(page, email)

  // Le mot de passe seul ne mène plus au tableau de bord.
  await expect(page).toHaveURL(urlOf('/two-factor', '?next=%2F'))

  await withinStablePeriod()
  // **Le compteur suivant** : celui de la confirmation vient d'être consommé,
  // et le rejouer serait refusé — c'est exactement ce que la garde protège.
  const signInCode = totpOf(secret, 1)

  await page.getByLabel('Code à six chiffres').fill(signInCode)
  await clickUntil(page, 'Vérifier', async () => {
    await expect(page).toHaveURL(urlOf('/'), { timeout: 3_000 })
  })

  // --- Connexion par code de secours ------------------------------------
  await signOut(page)
  await page.goto('/sign-in')
  await signIn(page, email)
  await expect(page).toHaveURL(urlOf('/two-factor', '?next=%2F'))

  await page.getByLabel('Code de secours').fill(backupCodes[0] ?? '')
  await clickUntil(page, 'Valider ce code', async () => {
    await expect(page).toHaveURL(urlOf('/'), { timeout: 3_000 })
  })

  // --- Le même code, une seconde fois -----------------------------------
  await signOut(page)
  await page.goto('/sign-in')
  await signIn(page, email)
  await expect(page).toHaveURL(urlOf('/two-factor', '?next=%2F'))

  await page.getByLabel('Code de secours').fill(backupCodes[0] ?? '')
  // Le texte plutôt que le rôle : Next pose son propre `role="alert"` vide
  // (`__next-route-announcer__`) sur chaque page, et il gagne la sélection.
  await clickUntil(page, 'Valider ce code', async () => {
    await expect(page.getByText('n’est pas valide')).toBeVisible({ timeout: 3_000 })
  })

  await expect(page).toHaveURL(urlOf('/two-factor', '?next=%2F'))

  // --- Et le code d'application déjà servi, sur le même défi -------------
  // C'est le cas de tous les jours : un second navigateur dans les trente
  // secondes, et le code que l'application d'authentification affiche encore.
  // Le code est **juste** ; ce qui le refuse est son compteur, déjà pris.
  // L'écran doit le dire — « ce code n'est pas valide » enverrait chercher une
  // compromission qui n'existe pas (revue s13, C12/C13/C14). Le défi est
  // consommé par cette tentative, elle vient donc en dernier.
  await page.getByLabel('Code à six chiffres').fill(signInCode)
  await clickUntil(page, 'Vérifier', async () => {
    await expect(page.getByText('a déjà servi')).toBeVisible({ timeout: 3_000 })
  })

  await expect(page).toHaveURL(urlOf('/two-factor', '?next=%2F'))
})
