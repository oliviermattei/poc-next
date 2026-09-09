import { headers } from 'next/headers'

import { NONCE_HEADER } from './security-headers'

/**
 * **Le nonce de la requête**, lu à l'en-tête que le proxy pose — en un seul
 * endroit.
 *
 * Il était lu par `app/layout.tsx`, qui le faisait descendre au shell. Depuis
 * que la racine ne monte plus de coquille (s60), deux surfaces en ont besoin —
 * le châssis du produit sous `(app)` et la page introuvable, qui monte le sien.
 * Deux lectures littérales de `headers()` seraient deux endroits à corriger le
 * jour où l'en-tête change de nom ; c'est aussi le seul point que les rendus de
 * test ont à doubler.
 *
 * Rend `null` quand l'en-tête manque : ce n'est pas une erreur, c'est un
 * rendu hors requête — et un `<script>` sans nonce est refusé par la politique,
 * ce qui est le comportement voulu, jamais un contournement.
 */
export const currentNonce = async (): Promise<string | null> =>
  (await headers()).get(NONCE_HEADER)
