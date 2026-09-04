import { readdir, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { expect, type Page } from '@playwright/test'

import { clickOnce } from './interaction'
import { anonymousLanding, publicPath, urlOf } from './locale'

/**
 * Les gestes communs aux parcours : inscrire un compte, lire son email, se
 * connecter.
 *
 * Ils vivent ici plutôt que dans un fichier de parcours parce que s08 en a
 * besoin autant que s07 : deux copies de la lecture de la boîte email
 * divergeraient au premier changement de format de capture. Ce fichier n'est
 * pas un parcours — Playwright ne collecte que les `*.spec.ts`.
 */

const MAIL_DIRECTORY = fileURLToPath(new URL('../../apps/web/.mail', import.meta.url))
const LINK_PATTERN = /http:\/\/localhost:\d+\/[^\s"<]+/g

export const PASSWORD = 'mot-de-passe-de-test-e2e'

export const anEmail = (prefix: string): string => `${prefix}-${randomUUID()}@example.test`

/** L'horodatage d'envoi, lu dans le nom du fichier de capture. */
const sentAt = (name: string): number => Number(/^local-(\d+)-/.exec(name)?.[1] ?? 0)

export interface LinkOptions {
  /**
   * N'accepter qu'un email écrit après cet instant (`Date.now()` avant
   * l'action).
   *
   * Sans lui, « le dernier email reçu » est le dernier **déjà écrit** : quand
   * un parcours demande un second email à la même adresse, la lecture peut
   * gagner la course contre l'envoi et rendre le lien précédent, déjà consommé.
   * C'est ce qui rendait le parcours « mot de passe oublié » instable — le
   * courrier de réinitialisation part hors du temps de réponse, exprès
   * (`docs/security.md` §7), donc il arrive toujours en retard. Rapporté
   * « flaky » par la reprise de Playwright, ce n'était pas une instabilité de
   * test : c'était une lecture sans condition d'ordre.
   */
  readonly since?: number
}

/**
 * Le dernier email capturé pour ce destinataire, tel qu'il est parti.
 *
 * Une seule lecture de la boîte, partagée : le lien et le texte viennent du
 * **même** email, sinon un parcours pourrait affirmer sur un courrier et suivre
 * le lien d'un autre.
 */
export const mailSentTo = async (email: string, options: LinkOptions = {}): Promise<string> => {
  const since = options.since ?? 0
  const deadline = Date.now() + 10_000

  while (Date.now() < deadline) {
    const files = await readdir(MAIL_DIRECTORY).catch(() => [] as string[])
    // Du plus récent au plus ancien : le nom du fichier de capture commence par
    // l'horodatage de l'envoi, et un même destinataire reçoit plusieurs emails
    // au cours d'un parcours.
    const contents = await Promise.all(
      files
        .filter((name) => name.endsWith('.html') && sentAt(name) >= since)
        .sort((left, right) => sentAt(right) - sentAt(left) || right.localeCompare(left))
        .map(async (name) => await readFile(`${MAIL_DIRECTORY}/${name}`, 'utf8')),
    )

    const found = contents.find((content) => content.includes(email))

    // `match` et non `test` : le motif porte le drapeau global, donc `test`
    // reprendrait sa recherche à `lastIndex` et rendrait faux un appel sur deux.
    if (found !== undefined && found.match(LINK_PATTERN) !== null) {
      return found
    }

    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  throw new Error(`Aucun email capturé pour ${email} dans ${MAIL_DIRECTORY}.`)
}

/** Le lien contenu dans le dernier email capturé pour ce destinataire. */
export const linkSentTo = async (email: string, options: LinkOptions = {}): Promise<string> => {
  const match = (await mailSentTo(email, options)).match(LINK_PATTERN)?.at(-1)

  if (match === undefined) {
    throw new Error(`Aucun lien dans l’email capturé pour ${email}.`)
  }

  return match.replaceAll('&amp;', '&')
}

export const signUp = async (page: Page, email: string): Promise<void> => {
  await page.goto('/sign-up')
  await page.getByLabel('Adresse email').fill(email)
  await page.getByLabel('Mot de passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Créer le compte' }).click()
  await expect(page.getByRole('status')).toContainText('Vérifiez votre boîte email')
}

/**
 * L'écran de connexion, quel que soit le préfixe de locale.
 *
 * Il sert de **signal d'achèvement** : la connexion est finie quand la page a
 * quitté cet écran. C'est le plus lâche des signaux corrects, et c'est
 * délibéré — la connexion atterrit sur le tableau de bord, sur l'écran demandé
 * par `?next=`, ou sur l'écran de second facteur quand le compte en a un. Un
 * signal qui nommerait le tableau de bord casserait `two-factor.spec.ts`.
 */
const SIGN_IN_SCREEN = new RegExp(`${publicPath('/sign-in').replaceAll('/', '\\/')}(\\?|$)`)

/**
 * Connecte un compte, et **rend la main quand la connexion a atterri** (s50).
 *
 * Le geste seul ne mesurait rien : `click()` dépêche l'événement et rend la
 * main, pendant que la requête de connexion et la redirection qu'elle provoque
 * sont encore en vol. La navigation demandée juste après partait donc en
 * concurrence de celle-là — mesuré sur `dev`, run 33894919551 :
 * `billing.spec.ts:439` attendait la page de tarifs et recevait `.../fr`,
 * c'est-à-dire l'atterrissage de la connexion arrivé après coup. Sur les
 * demandes de fusion 7 et 8, la même course s'était vue en
 * `net::ERR_ABORTED` : la redirection annulait la navigation en cours.
 *
 * Le signal est celui que `signOut` documente juste en dessous — la
 * navigation que la connexion provoque —, et le `clickOnce` de
 * `support/interaction.ts` est l'outil qui le porte. Aucun délai n'est ajouté :
 * une attente qui n'aboutit pas rougit sur le vrai constat.
 *
 * Ce contrat est éprouvé par un instantané, pas par une attente :
 * `auth.spec.ts` sur l'atterrissage tableau de bord, `two-factor.spec.ts` sur
 * l'atterrissage second facteur. `page.url()` ne réessaie pas, donc il rougit
 * dès que le geste rend la main trop tôt — mesuré avant le correctif :
 * `"http://localhost:3142/fr/sign-in?verified=1"` au retour de `signIn`.
 */
export const signIn = async (page: Page, email: string, password = PASSWORD): Promise<void> => {
  await page.getByLabel('Adresse email', { exact: true }).fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  // `exact` depuis s14 : l'écran porte aussi « Se connecter avec une passkey »,
  // et une correspondance partielle en désignerait deux — Playwright refuse
  // alors de cliquer, sur **tous** les parcours qui passent par ici.
  await clickOnce(
    page,
    page.getByRole('button', { name: 'Se connecter', exact: true }),
    async () => {
      await expect(page).not.toHaveURL(SIGN_IN_SCREEN)
    },
  )
}

/**
 * Déconnecte le compte courant depuis l'écran de compte.
 *
 * Ici, et plus dans chaque parcours : `passkeys.spec.ts` et
 * `two-factor.spec.ts` en portaient deux copies identiques, toutes deux fondées
 * sur le `clickUntil` que `support/interaction.ts` remplace.
 *
 * Le bouton de déconnexion n'est **pas** désactivé jusqu'à l'hydratation
 * (`app/sign-out-button.tsx` : un `type="button"` avec un `onClick`, sans
 * formulaire derrière) : avant que React n'ait repris la main, le clic n'a
 * aucun gestionnaire et disparaît sans trace. C'est exactement le cas que
 * `clickOnce` attend — et le signal d'achèvement est la navigation que
 * `window.location.assign` provoque.
 */
export const signOut = async (page: Page): Promise<void> => {
  await page.goto('/account')
  await clickOnce(page, page.getByRole('button', { name: 'Se déconnecter' }), async () => {
    await expect(page).toHaveURL(urlOf(anonymousLanding()))
  })
}

/**
 * Inscrit un compte, suit son lien de vérification, et le connecte.
 *
 * La connexion aboutit au **tableau de bord** (critère 1 de s08) : un parcours
 * qui a besoin de l'écran de compte le demande ensuite, explicitement.
 */
export const aSignedInAccount = async (page: Page, prefix: string): Promise<string> => {
  const email = anEmail(prefix)

  await signUp(page, email)
  await page.goto(await linkSentTo(email))
  await signIn(page, email)
  await expect(page).toHaveURL(urlOf('/'))

  return email
}
