import {
  createHash,
  createSign,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto'

/**
 * **Un authentificateur WebAuthn de laboratoire**, écrit pour la suite de nœud.
 *
 * Il n'existe pas de « poster un formulaire » pour une passkey : la seule
 * chose qu'un serveur voit est une **attestation** ou une **assertion** signées
 * par une clé que le navigateur détient. Sans de quoi en fabriquer, les
 * propriétés qui décident de cette story ne sont pas mesurables — l'origine
 * attendue, l'identifiant de partie de confiance, le compteur de signature, et
 * le fait qu'une passkey supprimée n'ouvre plus rien.
 *
 * Ce fichier **remplace l'authentificateur, jamais le vérificateur** : les
 * réponses produites ici traversent le vrai `@simplewebauthn/server` embarqué
 * par `@better-auth/passkey`, avec ses vraies vérifications. C'est la règle du
 * dépôt sur les doublures — on remplace le monde extérieur, pas le code jugé.
 *
 * Ce qu'il ne prouve pas, et qui n'appartient qu'à un navigateur :
 * l'interaction utilisateur (`e2e/passkeys.spec.ts` s'en charge avec
 * l'authentificateur virtuel de Chrome), le fait qu'un navigateur refuse de
 * produire une assertion pour un `rpId` qui n'est pas un suffixe de son
 * origine, et la découverte de la clé résidente. Ici, **tout** est fabriqué :
 * ce qui est mesuré est ce que le serveur accepte, pas ce qu'un navigateur
 * accepterait de produire.
 */

const base64url = (bytes: Uint8Array | Buffer): string =>
  Buffer.from(bytes).toString('base64url')

/* --------------------------------------------------------------------- *
 * Le minimum de CBOR : l'objet d'attestation et la clé publique COSE.
 * Cinq formes suffisent — entier positif, entier négatif, chaîne d'octets,
 * chaîne de texte, table. Rien d'autre n'entre dans une attestation `none`.
 * --------------------------------------------------------------------- */

const cborHead = (major: number, value: number): Buffer => {
  if (value < 24) {
    return Buffer.from([(major << 5) | value])
  }

  if (value < 0x100) {
    return Buffer.from([(major << 5) | 24, value])
  }

  const head = Buffer.alloc(3)

  head[0] = (major << 5) | 25
  head.writeUInt16BE(value, 1)

  return head
}

const cborUnsigned = (value: number): Buffer => cborHead(0, value)
/** Un entier négatif CBOR encode `-1 - n` : `-7` s'écrit donc `n = 6`. */
const cborNegative = (value: number): Buffer => cborHead(1, -1 - value)
const cborBytes = (value: Buffer): Buffer => Buffer.concat([cborHead(2, value.length), value])
const cborText = (value: string): Buffer => {
  const encoded = Buffer.from(value, 'utf8')

  return Buffer.concat([cborHead(3, encoded.length), encoded])
}
const cborMap = (entries: readonly (readonly [Buffer, Buffer])[]): Buffer =>
  Buffer.concat([cborHead(5, entries.length), ...entries.map(([key, value]) => Buffer.concat([key, value]))])

/**
 * La clé publique ES256 au format COSE_Key (RFC 8152), telle qu'une
 * attestation la porte : `kty = EC2`, `alg = ES256`, `crv = P-256`, puis les
 * deux coordonnées sur 32 octets.
 */
const cosePublicKey = (key: KeyObject): Buffer => {
  const jwk = key.export({ format: 'jwk' })

  return cborMap([
    [cborUnsigned(1), cborUnsigned(2)],
    [cborUnsigned(3), cborNegative(-7)],
    [cborNegative(-1), cborUnsigned(1)],
    [cborNegative(-2), cborBytes(Buffer.from(String(jwk.x), 'base64url'))],
    [cborNegative(-3), cborBytes(Buffer.from(String(jwk.y), 'base64url'))],
  ])
}

/** Présence de l'utilisateur, vérification de l'utilisateur, données jointes. */
const FLAG_USER_PRESENT = 0x01
const FLAG_USER_VERIFIED = 0x04
const FLAG_ATTESTED_DATA = 0x40

const authenticatorData = (input: {
  readonly rpId: string
  readonly flags: number
  readonly counter: number
  readonly attested?: { readonly aaguid: Buffer; readonly credentialId: Buffer; readonly key: KeyObject }
}): Buffer => {
  const header = Buffer.alloc(37)

  createHash('sha256').update(input.rpId).digest().copy(header, 0)
  header[32] = input.flags
  header.writeUInt32BE(input.counter, 33)

  if (input.attested === undefined) {
    return header
  }

  const credentialIdLength = Buffer.alloc(2)

  credentialIdLength.writeUInt16BE(input.attested.credentialId.length)

  return Buffer.concat([
    header,
    input.attested.aaguid,
    credentialIdLength,
    input.attested.credentialId,
    cosePublicKey(input.attested.key),
  ])
}

const clientData = (input: {
  readonly type: 'webauthn.create' | 'webauthn.get'
  readonly challenge: string
  readonly origin: string
}): Buffer =>
  Buffer.from(
    JSON.stringify({
      type: input.type,
      challenge: input.challenge,
      origin: input.origin,
      crossOrigin: false,
    }),
    'utf8',
  )

export interface VirtualAuthenticatorOptions {
  /** L'identifiant de partie de confiance que cet authentificateur **prétend**. */
  readonly rpId: string
  /** L'origine que le navigateur inscrirait dans `clientDataJSON`. */
  readonly origin: string
  /** L'identifiant du justificatif. Deux authentificateurs peuvent le partager : c'est mesuré. */
  readonly credentialId?: string
}

export interface RegistrationResponse {
  readonly id: string
  readonly rawId: string
  readonly type: 'public-key'
  readonly response: {
    readonly clientDataJSON: string
    readonly attestationObject: string
    readonly transports: readonly string[]
  }
  readonly clientExtensionResults: Record<string, never>
  readonly authenticatorAttachment: 'platform'
}

export interface AuthenticationResponse {
  readonly id: string
  readonly rawId: string
  readonly type: 'public-key'
  readonly response: {
    readonly clientDataJSON: string
    readonly authenticatorData: string
    readonly signature: string
    readonly userHandle?: string
  }
  readonly clientExtensionResults: Record<string, never>
  readonly authenticatorAttachment: 'platform'
}

export interface VirtualAuthenticator {
  readonly credentialId: string
  /** Le compteur de signature courant. `0` signifie « cet authentificateur n'en tient pas ». */
  counter: number
  register(input: { readonly challenge: string; readonly origin?: string; readonly rpId?: string }): RegistrationResponse
  authenticate(input: {
    readonly challenge: string
    readonly origin?: string
    readonly rpId?: string
    /** Le compteur présenté. Absent, l'authentificateur incrémente le sien. */
    readonly counter?: number
    readonly userVerified?: boolean
  }): AuthenticationResponse
}

const AAGUID = Buffer.alloc(16)

/**
 * Fabrique un authentificateur : une paire de clés ES256, un identifiant de
 * justificatif, et un compteur.
 */
export function createVirtualAuthenticator(
  options: VirtualAuthenticatorOptions,
): VirtualAuthenticator {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const credentialIdBytes = Buffer.from(
    options.credentialId ?? base64url(Buffer.from(crypto.randomUUID().replaceAll('-', ''), 'hex')),
    'base64url',
  )
  const credentialId = base64url(credentialIdBytes)

  const authenticator: VirtualAuthenticator = {
    credentialId,
    counter: 0,

    register: ({ challenge, origin = options.origin, rpId = options.rpId }) => {
      const data = clientData({ type: 'webauthn.create', challenge, origin })
      const attestationObject = cborMap([
        [cborText('fmt'), cborText('none')],
        [cborText('attStmt'), cborMap([])],
        [
          cborText('authData'),
          cborBytes(
            authenticatorData({
              rpId,
              flags: FLAG_USER_PRESENT | FLAG_USER_VERIFIED | FLAG_ATTESTED_DATA,
              counter: 0,
              attested: { aaguid: AAGUID, credentialId: credentialIdBytes, key: publicKey },
            }),
          ),
        ],
      ])

      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        response: {
          clientDataJSON: base64url(data),
          attestationObject: base64url(attestationObject),
          transports: ['internal'],
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      }
    },

    authenticate: ({
      challenge,
      origin = options.origin,
      rpId = options.rpId,
      counter,
      userVerified = true,
    }) => {
      const presented = counter ?? (authenticator.counter += 1)
      const data = clientData({ type: 'webauthn.get', challenge, origin })
      const authData = authenticatorData({
        rpId,
        flags: FLAG_USER_PRESENT | (userVerified ? FLAG_USER_VERIFIED : 0),
        counter: presented,
      })
      const signature = createSign('sha256')
        .update(Buffer.concat([authData, createHash('sha256').update(data).digest()]))
        .sign(privateKey)

      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        response: {
          clientDataJSON: base64url(data),
          authenticatorData: base64url(authData),
          signature: base64url(signature),
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      }
    },
  }

  return authenticator
}
