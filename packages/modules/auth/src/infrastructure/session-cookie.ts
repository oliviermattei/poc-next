import { createHmac } from 'node:crypto'

/**
 * **La signature du cookie de session**, telle que la bibliothèque la vérifie.
 *
 * Better Auth lit son cookie de session avec `ctx.getSignedCookie(...)`
 * (`api/routes/session.mjs`), dont la vérification vient de `better-call` :
 * la valeur du cookie est `encodeURIComponent(`${valeur}.${signature}`)`, et la
 * signature est un HMAC-SHA256 de la valeur par le secret, en base64
 * (`better-call@1.4.0`, `dist/crypto.mjs`). C'est cette forme, et pas une
 * autre, qui est reproduite ici.
 *
 * ## Pourquoi elle est reproduite plutôt qu'appelée
 *
 * `setSessionCookie` de la bibliothèque exige un contexte de point d'entrée
 * (`GenericEndpointContext`), et aucun point d'entrée n'ouvre une session **au
 * nom d'un autre compte** sans justificatif — c'est précisément ce que le
 * greffon `admin` fournit, et que l'ADR de `s37b1` a écarté à la mesure.
 * Fabriquer ce contexte reviendrait à dépendre de bien plus d'internes que de
 * cette seule ligne.
 *
 * **Ce qui l'empêche de mentir en silence** : `tests/admin.test.ts` ouvre une
 * impersonation, renvoie le cookie obtenu au **résolveur de session de la
 * bibliothèque**, et exige qu'il désigne le compte emprunté. Le jour où
 * `better-call` change de forme de signature, ce cas rougit — il ne s'agit pas
 * d'un fait supposé du paquet, mais d'un fait mesuré à chaque exécution.
 */
export function signSessionCookieValue(input: {
  readonly token: string
  readonly secret: string
}): string {
  const signature = createHmac('sha256', input.secret).update(input.token).digest('base64')

  return encodeURIComponent(`${input.token}.${signature}`)
}
