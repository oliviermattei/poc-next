import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import type { DataExportTokenSigner } from '../application/ports'
import { formatDataExportToken, parseDataExportToken } from '../domain/data-export'

/**
 * **La signature du lien d'export** (s35).
 *
 * Le lien est une frontière **publique** qui donne accès à *toutes* les données
 * d'une personne : c'est la surface la plus sensible de la story. Trois
 * propriétés, et elles sont dans cet ordre :
 *
 * 1. **la signature est vérifiée avant tout effet.** `verify` ne lit aucune
 *    base : elle recalcule le HMAC de l'identifiant porté par le jeton et le
 *    compare. Un jeton forgé est refusé sans qu'une seule requête parte, ce qui
 *    ferme aussi l'énumération d'identifiants de demandes par la base ;
 * 2. **la comparaison est à temps constant.** Un `===` sur une signature fuit
 *    la position du premier octet faux, et c'est la fuite classique qui rend
 *    une signature devinable octet par octet ;
 * 3. **le secret est celui de l'application**, dérivé par un label. Il ne
 *    quitte pas `infrastructure/` — `domain/` ne connaît aucune primitive
 *    (`packages/modules/auth/AGENTS.md`).
 *
 * **Ce que la signature ne remplace pas** : l'échéance. Elle vit en base, elle
 * est relue à chaque téléchargement, et le jeton ne la porte pas — un jeton qui
 * porterait sa propre échéance ferait décider au client le moment où le lien
 * meurt, sauf à la signer, ce qui la rendrait immuable et interdirait de couper
 * un lien avant terme.
 */
const LABEL = 'data-export-link:v1'

export function createDataExportTokenSigner(secret: string): DataExportTokenSigner {
  const sign = (requestId: string): string =>
    createHmac('sha256', `${LABEL}:${secret}`).update(requestId).digest('base64url')

  return {
    issue: (requestId) => formatDataExportToken({ requestId, signature: sign(requestId) }),

    verify: (token) => {
      const parsed = parseDataExportToken(token)

      if (parsed === null) {
        return null
      }

      const expected = Buffer.from(sign(parsed.requestId))
      const received = Buffer.from(parsed.signature)

      // Les longueurs d'abord : `timingSafeEqual` lève sur des tampons de
      // tailles différentes, et une exception ici serait un 500 sur une
      // frontière publique.
      if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
        return null
      }

      return parsed.requestId
    },

    digest: (token) => createHash('sha256').update(token).digest('base64url'),
  }
}
