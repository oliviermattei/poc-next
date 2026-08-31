import { createHash, randomBytes } from 'node:crypto'

import type { TokenFactory } from '../application/ports'

/**
 * La fabrique de jetons à usage unique.
 *
 * Deux propriétés, et elles sont indissociables :
 *
 * - **imprévisible** : 32 octets tirés du générateur cryptographique du
 *   système. `Math.random()` produit une suite prédictible, donc des liens de
 *   réinitialisation devinables ;
 * - **stocké haché** : la base ne contient que l'empreinte SHA-256. Une copie
 *   des lignes émises par cette fabrique ne rend aucun lien utilisable, alors
 *   qu'un jeton stocké en clair est un mot de passe à usage unique lisible.
 *
 * SHA-256 sans sel ni étirement, et c'est correct ici : l'entrée fait 256 bits
 * d'entropie, il n'y a rien à deviner par force brute — contrairement à un mot
 * de passe, qui exige un KDF lent.
 *
 * ## La limite, et elle est réelle : le lien de réinitialisation
 *
 * La propriété ci-dessus vaut pour les jetons **de cette fabrique**
 * (vérification d'email, changement d'adresse) et pour le magic link, dont le
 * greffon accepte un `storeToken: { type: 'custom-hasher' }`. Elle est
 * **fausse** du lien de réinitialisation de mot de passe : celui-là est émis
 * par la bibliothèque, qui l'écrit **en clair** dans la même table
 * (`better-auth@1.7.2`, `dist/api/routes/password.mjs` : l'identifiant de la
 * ligne est « reset-password: » suivi du jeton **tel qu'il part dans l'email**,
 * et sa valeur est l'identifiant du compte). Une lecture de
 * `auth_verification` y donne un lien de reprise de compte immédiatement
 * utilisable.
 *
 * Ce n'est pas un accident qu'on pourrait corriger sur place : l'invalidation
 * des frères du module s'appuie sur cette forme en clair (préfixe
 * `reset-password:`, valeur = identifiant du compte), et `emailAndPassword`
 * n'offre, dans la version installée, aucun crochet de hachage sur ce chemin —
 * vérifié : `storeToken` n'existe que dans le greffon magic-link.
 *
 * **Arbitrage : accepté pour l'instant, et borné.** Le lien vit
 * `passwordResetTtlSeconds` (voir `AuthPolicy`), il est consommé une fois, et
 * ses frères sont invalidés à l'usage ; l'exposition demande un accès en
 * lecture à la base, c'est-à-dire un attaquant qui a déjà les empreintes de mot
 * de passe. **À reprendre** le jour où la bibliothèque expose un hacheur sur ce
 * chemin, ou le jour où le module émet lui-même le jeton de réinitialisation
 * comme il émet déjà celui de vérification. D'ici là, la propriété affirmée
 * ci-dessus ne doit pas être élargie à toute la table.
 */
export function createTokenFactory(): TokenFactory {
  return {
    generate: () => randomBytes(32).toString('base64url'),
    digest: (token) => Promise.resolve(createHash('sha256').update(token).digest('base64url')),
  }
}
