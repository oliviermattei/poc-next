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
 *   de la table `auth_verification` ne rend aucun lien utilisable, alors qu'un
 *   jeton stocké en clair est un mot de passe à usage unique lisible.
 *
 * SHA-256 sans sel ni étirement, et c'est correct ici : l'entrée fait 256 bits
 * d'entropie, il n'y a rien à deviner par force brute — contrairement à un mot
 * de passe, qui exige un KDF lent.
 */
export function createTokenFactory(): TokenFactory {
  return {
    generate: () => randomBytes(32).toString('base64url'),
    digest: (token) => Promise.resolve(createHash('sha256').update(token).digest('base64url')),
  }
}
