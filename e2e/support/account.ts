import { readdir, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { expect, type Page } from '@playwright/test'

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

/** Le lien contenu dans le dernier email capturé pour ce destinataire. */
export const linkSentTo = async (email: string, options: LinkOptions = {}): Promise<string> => {
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

    const match = contents
      .find((content) => content.includes(email))
      ?.match(LINK_PATTERN)
      ?.at(-1)

    if (match !== undefined) {
      return match.replaceAll('&amp;', '&')
    }

    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  throw new Error(`Aucun email capturé pour ${email} dans ${MAIL_DIRECTORY}.`)
}

export const signUp = async (page: Page, email: string): Promise<void> => {
  await page.goto('/sign-up')
  await page.getByLabel('Adresse email').fill(email)
  await page.getByLabel('Mot de passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Créer le compte' }).click()
  await expect(page.getByRole('status')).toContainText('Vérifiez votre boîte email')
}

export const signIn = async (page: Page, email: string, password = PASSWORD): Promise<void> => {
  await page.getByLabel('Adresse email', { exact: true }).fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
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
  await expect(page).toHaveURL(/localhost:\d+\/$/)

  return email
}
