import { createHmac } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import { aSignedInAccount, PASSWORD, signIn } from './support/account'
import { clickOnce } from './support/interaction'
import { urlOf } from './support/locale'

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

/*
 * **Ce parcours n'attend pas l'horloge** (s50), et voici la mesure qui l'a
 * décidé. Cette note remplace la fonction qui vivait ici.
 *
 * Il portait un `withinStablePeriod` : quand il restait moins de dix secondes à
 * la période TOTP courante, il **dormait** jusqu'à la suivante avant de dériver
 * un code — 0 à 10,1 s, une fois sur trois, et le parcours l'appelait deux
 * fois. Ajouté à un parcours qui coûte déjà 20 à 28 s, il faisait dépasser le
 * budget de 30 s, et l'échec rapporté était un « Test timeout » qui ne nommait
 * aucun appel : rien ne pendait, le temps était simplement fini.
 *
 * Mesuré sur huit exécutions consécutives, traces à l'appui : une pause de 5,58
 * à 9,53 s dans les sept rouges (31,4 à 36,5 s), 3,17 s dans le seul vert
 * (29,5 s). Sur `dev`, run 33894919551, le même cas passe en 28,2 s dans une
 * configuration et échoue à 31,2 s dans l'autre.
 *
 * **Et cette attente ne protégeait de rien.** La fenêtre de vérification vaut
 * **±1 période** — `totp/index.mjs` appelle `.verify(code)` sans second
 * argument, et `@better-auth/utils` y met `window = 1`
 * (`packages/modules/auth/src/infrastructure/better-auth-service.ts`, éprouvé
 * aux deux bords par `tests/auth.test.ts`). Un code dérivé juste avant la
 * bascule de période reste donc accepté pendant toute la période suivante :
 * 30 à 60 s de marge, quand la saisie, le clic et l'aller-retour en coûtent
 * moins de deux. Dormir pour « viser le milieu d'une période » achetait de la
 * marge là où il y en avait déjà, et la payait sur le budget du test.
 *
 * Aucune reprise, aucun délai élargi : le parcours a été **raccourci**, pas
 * détendu.
 */

/**
 * Le geste d'un bouton de cet écran, **une fois**, puis son achèvement.
 *
 * Le reclic est parti d'ici avec une raison qui lui est propre : chacun de ces
 * gestes est **à usage unique**. Le code TOTP de la confirmation brûle son
 * compteur, le code de secours se consomme, le défi de vérification aussi.
 * Rejouer le clic renvoyait le même code déjà servi, que le serveur refuse à
 * juste titre — et il le refuse dans un `role="alert"`, quand l'attente cherche
 * un `role="status"` : la boucle ne pouvait plus aboutir. Le détail est dans
 * `support/interaction.ts`.
 *
 * Les délais de 2 000 et 3 000 ms qui bornaient chaque attente sont partis avec
 * la boucle : ils n'étaient pas un budget réfléchi, ils bornaient **un essai**
 * dans un `toPass` de 20 s. Ce qui reste est le délai par défaut du projet.
 * Aucun délai n'est allongé.
 */
const press = async (
  page: Page,
  name: string,
  settled: () => Promise<void>,
): Promise<void> => {
  await clickOnce(page, page.getByRole('button', { name }), settled)
}

/**
 * Redevenir un visiteur anonyme, **sans repasser par l'écran de compte** (s50).
 *
 * Le parcours enchaîne quatre connexions ; entre chacune il lui faut un
 * navigateur sans session, et il l'obtenait par `signOut` — un aller à
 * `/account`, une attente d'hydratation, un clic, une navigation, mesurés à
 * 0,76 s l'unité sur ce poste, soit environ 2,5 fois plus sur un runner. Trois
 * fois, pour un geste que ce fichier ne mesure pas : la déconnexion et sa
 * révocation côté serveur sont éprouvées par `auth.spec.ts`, qui repose le
 * cookie et vérifie qu'il ne ressuscite rien, et `passkeys.spec.ts` continue
 * d'exercer `signOut` lui-même.
 *
 * Vider les cookies du navigateur est **plus strict** que se déconnecter :
 * aucun état de session, aucun cookie d'appareil de confiance, rien à
 * réutiliser d'une connexion à la suivante. Ce n'est pas une attente supprimée,
 * c'est un aller-retour serveur supprimé — ce parcours dépassait son budget de
 * 30 s, et c'est ce budget que la mesure de s50 a rendu au parcours.
 */
const anonymousAgain = async (page: Page): Promise<void> => {
  await page.context().clearCookies()
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
  await press(page, 'Activer', async () => {
    await expect(page.getByRole('img', { name: /Code QR/ })).toBeVisible()
  })

  // Le secret est **lu dans la page** : c'est le chemin de qui n'a pas de
  // caméra, et c'est ce qui rend le QR et le texte solidaires.
  const secret = (await page.getByText(/^[A-Z2-7 ]{30,}$/).innerText()).trim()

  await page.getByLabel('Code à six chiffres').fill(totpOf(secret))
  await press(page, 'Confirmer', async () => {
    await expect(page.getByRole('status')).toContainText('Notez ces dix codes')
  })

  // Les éléments de liste **de la forme d'un code** : la page en porte
  // d'autres — navigation, sessions, connexions —, et les compter tous ferait
  // dire au parcours qu'il y a dix-sept codes de secours.
  const backupCodes = await page
    .getByRole('listitem')
    .filter({ hasText: /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/ })
    .allInnerTexts()

  expect(backupCodes).toHaveLength(10)

  await press(page, 'J’ai noté ces codes', async () => {
    await expect(page.getByText('Activée', { exact: true })).toBeVisible()
  })

  // **Affichés une seule fois** : rien ne les relit, ni l'écran, ni une route.
  await page.reload()
  await expect(page.getByText(backupCodes[0] ?? 'code-absent')).toHaveCount(0)

  // --- Connexion par code d'application ---------------------------------
  await anonymousAgain(page)
  await page.goto('/sign-in')
  await signIn(page, email)

  // Le mot de passe seul ne mène plus au tableau de bord.
  //
  // **L'instantané, et pas l'attente** (s50) : c'est ici que le signal
  // d'achèvement de `signIn` est éprouvé sur son **second** atterrissage. Un
  // signal qui n'attendrait que le tableau de bord laisserait ce parcours
  // rendre la main pendant la redirection ; `page.url()` ne réessaie pas et le
  // dirait. Les deux connexions suivantes gardent leur `toHaveURL` : une seule
  // mesure du contrat suffit, les autres attestent l'écran.
  expect(page.url()).toMatch(urlOf('/two-factor', '?next=%2F'))

  // **Le compteur suivant** : celui de la confirmation vient d'être consommé,
  // et le rejouer serait refusé — c'est exactement ce que la garde protège.
  const signInCode = totpOf(secret, 1)

  await page.getByLabel('Code à six chiffres').fill(signInCode)
  await press(page, 'Vérifier', async () => {
    await expect(page).toHaveURL(urlOf('/'))
  })

  // --- Connexion par code de secours ------------------------------------
  await anonymousAgain(page)
  await page.goto('/sign-in')
  await signIn(page, email)
  await expect(page).toHaveURL(urlOf('/two-factor', '?next=%2F'))

  await page.getByLabel('Code de secours').fill(backupCodes[0] ?? '')
  await press(page, 'Valider ce code', async () => {
    await expect(page).toHaveURL(urlOf('/'))
  })

  // --- Le même code, une seconde fois -----------------------------------
  await anonymousAgain(page)
  await page.goto('/sign-in')
  await signIn(page, email)
  await expect(page).toHaveURL(urlOf('/two-factor', '?next=%2F'))

  await page.getByLabel('Code de secours').fill(backupCodes[0] ?? '')
  // Le texte plutôt que le rôle : Next pose son propre `role="alert"` vide
  // (`__next-route-announcer__`) sur chaque page, et il gagne la sélection.
  await press(page, 'Valider ce code', async () => {
    await expect(page.getByText('n’est pas valide')).toBeVisible()
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
  await press(page, 'Vérifier', async () => {
    await expect(page.getByText('a déjà servi')).toBeVisible()
  })

  await expect(page).toHaveURL(urlOf('/two-factor', '?next=%2F'))
})
