'use client'

import { setNonce } from 'get-nonce'

/**
 * Le nonce de la requête, donné aux `<style>` que les primitives injectent.
 *
 * Le verrou de défilement d'un dialogue ou d'un panneau (`Sheet`,
 * `DropdownMenu`) n'est pas une classe Tailwind : Radix s'appuie sur
 * `react-remove-scroll`, qui crée un élément `<style>` **au moment de
 * l'ouverture**. Sous une politique de sécurité du contenu stricte, cet élément
 * est refusé s'il ne porte pas le nonce de la requête — mesuré : le fond de page
 * continue de défiler derrière le panneau mobile ouvert, et la console signale
 * une violation `style-src-elem` (`docs/research/s45-security-headers.md` §2.2).
 *
 * `setNonce` est l'API que `react-style-singleton` publie pour cela, et la seule
 * qui ne dépende pas d'un identifiant de bundler : la lecture par défaut passe
 * par `__webpack_nonce__`, que Turbopack ne pose pas. Le nonce n'existant qu'à
 * la requête, l'appel ne peut pas vivre au niveau du module — il vit dans le
 * rendu de ce composant, qui ne rend rien et doit donc être placé **avant** tout
 * ce qui peut ouvrir une surface flottante.
 *
 * Le composant est rendu côté serveur puis côté client, et `setNonce` est
 * idempotent : appeler deux fois avec la même valeur ne change rien.
 */
export function InlineStyleNonce({ nonce }: { readonly nonce: string | null }) {
  if (nonce !== null) {
    setNonce(nonce)
  }

  return null
}
