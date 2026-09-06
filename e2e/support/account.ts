import { readdir, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { ONBOARDING_SCREEN_PATH } from '@repo/module-onboarding'
import { expect, type Page } from '@playwright/test'

import { clickOnce } from './interaction'
import { anonymousLanding, onboardingCourseMounted, publicPath, urlOf } from './locale'

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
 * **Referme le parcours d'intégration d'un compte** (s40), à la porte que le
 * produit lui offre : celle du parcours **terminé**.
 *
 * Pourquoi cette fonction existe. Depuis s40, la racine mène au parcours tant
 * qu'il reste à faire — c'est le critère 1 de la story —, si bien qu'un compte
 * fraîchement inscrit n'atterrit plus au tableau de bord. **Tout parcours de la
 * suite qui ouvre une session** en est concerné, et ils rougissaient presque
 * tous sur la seule assertion d'atterrissage d'`aSignedInAccount`. Le nombre
 * n'est pas écrit ici, exprès : aucune commande ne le maintiendrait vrai, et
 * `AGENTS.md` demande de dériver un compte plutôt que de le taper — ce que
 * cette prose s'était déjà permis, avec deux chiffres faux dès la revue.
 *
 * Pourquoi l'état est **posé** et non parcouru. Franchir les étapes au
 * navigateur demanderait, pour **chaque** compte de la suite, de saisir un nom
 * puis de passer les étapes restantes — un formulaire et trois chargements de
 * page par parcours, et un nom choisi qui contredirait `app-shell.spec.ts`, qui
 * mesure précisément ce que change le premier nom saisi. Ce que ces parcours
 * mesurent n'est pas l'intégration : c'est ce qui vient après.
 *
 * **Ce que ce raccourci ne masque pas** : `e2e/onboarding.spec.ts` fait le
 * parcours réel, au navigateur, sans jamais appeler cette fonction — l'écran,
 * l'étape obligatoire qu'on ne peut pas passer, et la porte à sens unique. Le
 * **parcours doré** le traverse aussi, et pour une autre raison : il mesure le
 * chemin réel d'un acheteur, qui passe désormais par là (la décision et son
 * motif sont dans `e2e/golden-path/golden-path.spec.ts`). Les règles, elles,
 * sont mesurées par `tests/onboarding.test.ts` et par le `domain` du module.
 *
 * Module coupé, il n'y a **rien à refermer** : la décision est dérivée de
 * `config/features.ts`, aucun identifiant n'est comparé ailleurs, et la table
 * n'existe alors pas.
 */
export const closeOnboardingCourse = async (email: string): Promise<void> => {
  if (!onboardingCourseMounted()) {
    return
  }

  const { createDatabaseClient } = await import('@repo/db')
  const { getEnv } = await import('@repo/config')
  const { loadRootEnv } = await import('@repo/config/server')

  loadRootEnv()

  const connection = createDatabaseClient({
    connectionString: getEnv().DATABASE_URL,
    maxConnections: 1,
  })

  try {
    const { sql } = await import('drizzle-orm')

    // Une seule écriture, paramétrée, et **rejouable** : la clé primaire du
    // compte arbitre, et une seconde exécution ne déplace pas l'instant de fin.
    await connection.db.execute(
      sql`insert into onboarding_progress (user_id, cleared_steps, completed_at)
          select id, '[]'::jsonb, now() from auth_user where email = ${email}
          on conflict (user_id) do nothing`,
    )
  } finally {
    await connection.close()
  }
}

/**
 * **Franchit ce qu'il reste du parcours d'intégration**, à la porte que
 * l'écran offre — l'exact opposé du raccourci ci-dessus, et l'autre moitié de
 * la décision qu'il documente.
 *
 * **Aucune étape n'est nommée** : la boucle clique ce que l'écran propose, et
 * s'arrête quand la page a quitté le parcours. C'est ce qui la rend vraie de
 * toute configuration — un module coupé retire une étape, et rien ici ne
 * change. Écrire « trois étapes » y ferait entrer par la porte du harnais la
 * liste en dur que la story existe pour interdire.
 *
 * La borne est un garde-fou, pas une attente : si le parcours ne se termine
 * pas, l'appelant rougit sur son assertion d'atterrissage, avec l'URL réelle
 * sous les yeux. Le locator, lui, **attend l'apparition du bouton** : après une
 * soumission, l'étape change de forme, et une lecture instantanée du DOM verrait
 * l'état d'avant.
 *
 * Deux appelants, et c'est pourquoi cette fonction est ici plutôt que dans un
 * parcours : `e2e/onboarding.spec.ts`, dont c'est le sujet, et le parcours doré,
 * qui referme le parcours d'un acheteur après l'avoir suivi.
 */
export const clearRemainingOnboardingSteps = async (page: Page): Promise<void> => {
  const onCourse = (): boolean =>
    new URL(page.url()).pathname.endsWith(ONBOARDING_SCREEN_PATH)

  for (let guard = 0; guard < 8 && onCourse(); guard += 1) {
    await page
      .getByRole('button', { name: /^(Continuer|Passer cette étape)$/ })
      .first()
      .click()
    await page.waitForLoadState('networkidle')
  }
}

/**
 * Inscrit un compte, suit son lien de vérification, et le connecte.
 *
 * La connexion aboutit au **tableau de bord** (critère 1 de s08) : un parcours
 * qui a besoin de l'écran de compte le demande ensuite, explicitement.
 *
 * Depuis s40, elle referme d'abord le parcours d'intégration : sans cela, la
 * racine mènerait au parcours et non au tableau de bord. Le parcours lui-même a
 * son propre fichier, qui n'emprunte pas ce chemin.
 */
export const aSignedInAccount = async (page: Page, prefix: string): Promise<string> => {
  const email = anEmail(prefix)

  await signUp(page, email)
  await page.goto(await linkSentTo(email))
  await closeOnboardingCourse(email)
  await signIn(page, email)
  await expect(page).toHaveURL(urlOf('/'))

  return email
}
