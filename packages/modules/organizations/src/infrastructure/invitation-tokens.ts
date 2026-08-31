import { createHash, randomBytes } from 'node:crypto'

import type { InvitationTokenFactory } from '../application/ports'

/**
 * La fabrique du jeton d'invitation.
 *
 * Deux propriétés, indissociables, et ce sont celles que
 * `packages/modules/auth/src/infrastructure/token-factory.ts` a déjà payées :
 *
 * - **imprévisible** : 32 octets tirés du générateur cryptographique du système.
 *   `Math.random()` produit une suite prédictible, donc des liens d'invitation
 *   devinables — et un lien deviné donne l'accès aux données d'une organisation ;
 * - **stocké haché** : la base ne contient que l'empreinte SHA-256. Une copie de
 *   `organization_invitation` ne rend aucun lien utilisable.
 *
 * SHA-256 sans sel ni étirement, et c'est correct ici : l'entrée fait 256 bits
 * d'entropie, il n'y a rien à deviner par force brute — contrairement à un mot
 * de passe, qui exige un KDF lent.
 *
 * **Ce que ce module ne partage pas avec `auth`.** Le lien de réinitialisation
 * de Better Auth est écrit **en clair** dans `auth_verification`
 * (`better-auth@1.7.2`, `dist/api/routes/password.mjs`) : c'est un arbitrage
 * accepté et borné, documenté là-bas. s16 émet son propre jeton et n'hérite pas
 * de cette limite — la propriété ci-dessus vaut pour toute la table
 * `organization_invitation`.
 *
 * `digest` est **synchrone**, contrairement à celle du module `auth` : là-bas la
 * signature est asynchrone parce qu'un hacheur de bibliothèque l'impose, ici
 * rien ne l'impose et une promesse inutile est une occasion d'oublier un `await`.
 */
export function createInvitationTokenFactory(): InvitationTokenFactory {
  return {
    generate: () => randomBytes(32).toString('base64url'),
    digest: (token) => createHash('sha256').update(token).digest('base64url'),
  }
}
