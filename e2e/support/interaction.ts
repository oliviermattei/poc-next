import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Le geste, **une fois**, puis son signal d'achèvement.
 *
 * ## Le défaut que ce fichier ferme
 *
 * `auth`, `passkeys` et `two-factor` portaient chacun leur copie d'un
 * `clickUntil` : un `expect(...).toPass()` de 20 s qui **recliquait** le bouton
 * tant que l'écran attendu n'était pas là. C'est une course, pas une attente —
 * et elle a deux façons de perdre, les deux mesurées dans un conteneur borné à
 * **un** cœur, un travailleur, cache `.next` vidé :
 *
 * - **le second clic tombe sur une page déjà en navigation.** Journal de
 *   `passkeys.spec.ts:141` : `waiting for "…/fr" navigation to finish… ` puis
 *   `navigated to "…/fr"` **après** l'expiration de l'attente interne. Le clic
 *   suivant part alors sur un document en train d'être remplacé, et l'attente
 *   d'après regarde l'ancienne page ou la nouvelle selon le hasard ;
 * - **le second clic rejoue un geste à usage unique.** `two-factor.spec.ts:142`
 *   confirme l'enrôlement avec un code TOTP ; le compteur est **brûlé** au
 *   premier envoi (garde de rejeu, revue s13 C3). Le reclic renvoie le même
 *   code, que le serveur refuse — et il le refuse dans un `role="alert"`, quand
 *   l'attente cherche un `role="status"`. La boucle ne peut plus aboutir : les
 *   dix reclics suivants consomment les 30 s du test, et l'échec rapporté est
 *   un dépassement de délai sur un parcours que **rien** ne pouvait plus faire
 *   passer.
 *
 * Allonger le délai n'y change rien : dans les deux cas, ce qui manque n'est
 * pas du temps, c'est que le geste ait été délivré **une** fois sur un document
 * prêt à le recevoir.
 *
 * ## La forme correcte
 *
 * Attendre que React ait repris la main, cliquer une fois, puis attendre le
 * signal d'achèvement — une navigation, une réponse, un état à l'écran.
 */

/**
 * Attend que React ait repris la main sur le document servi par le serveur.
 *
 * **Pourquoi c'est nécessaire, et mesuré.** `consent.spec.ts:142` cliquait le
 * lien « Gérer mes cookies » de `/account` sans rien attendre. À l'échec, la
 * sonde rapporte : document **non hydraté** au moment du clic, **aucune requête
 * de navigation** vers `/cookies` émise, et la boîte du lien mesurée à
 * `y = 2227` avant le clic contre `y = 449` après — la mise en page a bougé de
 * 1 778 px entre le contrôle d'actionnabilité de Playwright et la dépêche de
 * l'événement, qui a donc atterri ailleurs. Aux exécutions qui passent, la même
 * sonde rapporte le document déjà hydraté. Ce n'est pas un budget d'attente :
 * la navigation n'a pas eu lieu du tout.
 *
 * Ce n'est pas un bouton d'envoi qui sert de témoin ici — `use-hydrated.ts` en
 * désactive un jusqu'à l'hydratation, et Playwright attend qu'il soit actif,
 * mais un `<a>` n'a pas d'état désactivé et tout écran n'a pas de formulaire.
 * Le témoin est celui de Next lui-même : `<next-route-announcer>` est ajouté au
 * `body` par l'effet de montage du routeur
 * (`node_modules/next/dist/client/components/app-router-announcer.js`), donc
 * après la validation du rendu client. Il est absent du HTML servi.
 *
 * Le jour où Next cesse de l'émettre, cette attente expire en le nommant —
 * l'échec est bruyant, jamais silencieux.
 *
 * **Piège** : sans JavaScript, il n'apparaît jamais. Les cas qui posent
 * `javaScriptEnabled: false` n'ont rien à attendre — leur page ne s'hydrate
 * pas, et le repli natif du navigateur délivre leurs gestes.
 */
export const whenHydrated = async (page: Page): Promise<void> => {
  await expect(page.locator('next-route-announcer')).toBeAttached({ timeout: 30_000 })
}

/**
 * Clique **une seule fois**, sur un document que React contrôle, puis attend le
 * signal d'achèvement du geste.
 *
 * `settled` décrit ce qui prouve que le geste a abouti. Il n'est jamais rejoué :
 * s'il n'aboutit pas, l'échec est le vrai constat.
 */
export const clickOnce = async (
  page: Page,
  control: Locator,
  settled: () => Promise<void>,
): Promise<void> => {
  await whenHydrated(page)
  await control.click()
  await settled()
}
