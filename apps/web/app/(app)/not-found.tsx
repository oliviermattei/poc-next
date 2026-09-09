import { NotFoundScreen } from '../not-found-screen'

/**
 * L'écran servi quand une page **du produit** appelle `notFound()` — un
 * document légal inconnu, un écran dont le module est coupé.
 *
 * **Il ne monte aucun châssis, et c'est tout son intérêt.** Next rend la page
 * introuvable à l'intérieur des layouts du segment où le refus a été levé :
 * ici, celle du groupe `(app)`, qui monte déjà `AppShell`. En monter un second
 * donnait deux coquilles imbriquées — deux navigations, deux bandeaux d'emprunt
 * de session —, ce que `pnpm test:socle` a mesuré sur `/organizations` avec le
 * module coupé.
 */
export default async function ProductNotFound() {
  return await NotFoundScreen()
}
