'use client'

import { useSyncExternalStore } from 'react'

/**
 * Vrai une fois que React a repris la main sur le balisage venu du serveur.
 *
 * **Ce que ça garde.** Entre le premier octet et l'hydratation, un formulaire
 * rendu par le serveur est un formulaire HTML ordinaire : son `onSubmit` React
 * n'existe pas encore, et le navigateur applique son propre repli. Un clic
 * pendant cette fenêtre — hydratation en cours, script en échec, réseau lent —
 * envoie donc les champs sans que le code de l'écran ne s'exécute. C'est la
 * course qui a fait partir un mot de passe dans l'URL (revue de s08, C1), et
 * elle se reproduisait dans deux exécutions de parcours sur trois.
 *
 * Le formulaire garde donc son bouton d'envoi **désactivé** tant que ce crochet
 * répond `false`. Deux conséquences voulues : rien ne peut être soumis par un
 * chemin que le composant ne contrôle pas, et l'action n'est pas perdue en
 * silence — l'utilisateur voit un bouton qui n'est pas encore prêt plutôt
 * qu'une page qui recharge en ayant tout jeté.
 *
 * Ce n'est pas la seule ligne de défense : les formulaires déclarent aussi
 * `method="post"`, pour que le repli natif ne soit jamais un `GET` (règle de
 * lint `no-restricted-syntax` dans `eslint.config.ts`). Le crochet ferme la
 * perte silencieuse, l'attribut ferme la fuite.
 *
 * `useSyncExternalStore` plutôt qu'un `useState` posé dans un effet : React 19
 * refuse le second (`react-hooks/set-state-in-effect`, `pnpm lint`). Le magasin
 * ne change jamais — c'est le passage de l'instantané serveur à l'instantané
 * client, au moment où React reprend la main, qui porte toute l'information.
 */

/** Aucun abonnement : rien ne change après l'hydratation. Stable par module. */
const subscribe = (): (() => void) => () => {}

export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
}
