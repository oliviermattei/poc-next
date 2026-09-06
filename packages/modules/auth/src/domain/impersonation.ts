/**
 * **L'emprunt de session** (s37b1), écrit à la main.
 *
 * Le greffon `admin` de Better Auth le fournit, et il a été écarté par la
 * mesure, pas par le principe : il déclare `banned`, `banReason` et
 * `banExpires` en plus d'`impersonatedBy`, or `s37a` a déjà livré `banned`,
 * `bannedAt` et `bannedReason` à la main (ADR 058). L'adopter signifierait un
 * modèle de bannissement en double pour une capacité dont **une seule colonne**
 * est nécessaire.
 *
 * Ce fichier ne connaît ni base, ni framework, ni cookie signé : des dates, des
 * identifiants, et la forme d'un en-tête.
 */

/**
 * L'échéance d'une session empruntée.
 *
 * Courte, et injectée par la politique : une élévation de privilège qui vit
 * aussi longtemps qu'une session ordinaire est une élévation qu'on oublie sur
 * un poste.
 */
export function impersonationExpiry(input: {
  readonly at: Date
  readonly ttlSeconds: number
}): Date {
  return new Date(input.at.getTime() + input.ttlSeconds * 1000)
}

/**
 * **Cette session est-elle empruntée ?**
 *
 * `null` — aucune session de ce nom — rend `false` : ce n'est pas une session
 * empruntée, c'est une absence. Qui décide *qui* est l'appelant est le
 * répartiteur ; cette règle ne répond qu'à « la session de l'appelant est-elle
 * un emprunt ».
 */
export function isBorrowedSession(
  session: { readonly impersonatedBy: string | null } | null,
): boolean {
  return session !== null && session.impersonatedBy !== null
}

/** Les attributs d'un cookie de session, tels que la bibliothèque les impose. */
export interface SessionCookieAttributes {
  readonly path?: string
  readonly httpOnly?: boolean
  readonly secure?: boolean
  readonly sameSite?: string
  readonly domain?: string
}

/**
 * **L'en-tête `Set-Cookie` d'une session, construit ici et nulle part ailleurs**
 * — même forme que `consent/domain/consent-cookie.ts`.
 *
 * Il est écrit à la main pour une seule raison : la bibliothèque ne pose un
 * cookie de session que depuis un de ses points d'entrée, et aucun n'ouvre une
 * session **au nom d'un autre compte**. Les attributs, eux, ne sont pas
 * inventés : ils viennent de la bibliothèque (`authCookies.sessionToken`), donc
 * `HttpOnly`, `Secure` et `SameSite` sont exactement ceux de toutes les autres
 * sessions du produit (`docs/security.md` §2).
 *
 * `maxAgeSeconds` à zéro écrit un cookie **expiré** : c'est ainsi qu'une
 * session empruntée est retirée du navigateur.
 */
export function serializeSessionCookie(input: {
  readonly name: string
  readonly value: string
  readonly maxAgeSeconds: number
  readonly attributes: SessionCookieAttributes
}): string {
  const parts = [`${input.name}=${input.value}`, `Max-Age=${Math.floor(input.maxAgeSeconds)}`]

  if (input.attributes.domain !== undefined) {
    parts.push(`Domain=${input.attributes.domain}`)
  }

  parts.push(`Path=${input.attributes.path ?? '/'}`)

  if (input.attributes.httpOnly === true) {
    parts.push('HttpOnly')
  }

  if (input.attributes.secure === true) {
    parts.push('Secure')
  }

  if (input.attributes.sameSite !== undefined) {
    const sameSite = input.attributes.sameSite

    parts.push(`SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`)
  }

  return parts.join('; ')
}
