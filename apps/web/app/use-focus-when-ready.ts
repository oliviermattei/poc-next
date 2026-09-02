'use client'

import { useEffect, useRef, type RefObject } from 'react'

/**
 * Donne le focus à un élément **une fois qu'il est en état de le recevoir**.
 *
 * **Pourquoi pas `autoFocus`.** React rend l'attribut `autofocus` dans le
 * balisage servi, et le navigateur l'applique à l'analyse du document — sur un
 * lien comme sur un bouton. Mais un bouton désactivé n'est pas focalisable :
 * `app/billing-actions.tsx` éteint le sien jusqu'à l'hydratation
 * (`use-hydrated.ts`), donc au moment où le navigateur cherche l'élément à
 * focaliser, il n'y a rien à focaliser — et rien ne repose le focus quand le
 * bouton se rallume. Mesuré à la revue de s22 : `document.activeElement` restait
 * `BODY` alors que trois textes affirmaient le contraire.
 *
 * Ce crochet ferme exactement cette fenêtre : il pose le focus **après**
 * l'hydratation, quand l'appelant dit que le contrôle est prêt, et il ne
 * l'arrache pas si le contrôle est encore désactivé.
 *
 * La commande qui rougit s'il cesse de fonctionner est `pnpm test:e2e` — le
 * parcours « rend le focus au bouton de l'offre reposée » d'`e2e/billing.spec.ts`.
 * Le focus n'existe que dans un navigateur : aucun test de nœud ne peut le voir.
 */
export function useFocusWhenReady<T extends HTMLElement>(wanted: boolean): RefObject<T | null> {
  const element = useRef<T | null>(null)

  useEffect(() => {
    const node = element.current

    if (!wanted || node === null || (node as { disabled?: boolean }).disabled === true) {
      return
    }

    node.focus()
  }, [wanted])

  return element
}
