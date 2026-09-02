import { describe, expect, it } from 'vitest'

import {
  AVATAR_MAX_BYTES,
  avatarKeyFor,
  detectImageType,
  keyBelongsTo,
  scopePrefix,
  servedKeyOf,
  validateAvatarUpload,
  validateStoredAvatar,
} from './avatar'

/**
 * Les règles pures du module, éprouvées **là où elles vivent**.
 *
 * Ce que ce fichier protège n'est pas « une image est acceptée » : c'est que
 * **le type déclaré par le client ne décide de rien**. Le piège est nommé par
 * la story, et il ne se ferme qu'ici — une route qui appellerait ces fonctions
 * sans les avoir prouvées ne prouverait que son propre câblage.
 */

const withHeader = (...header: number[]): Uint8Array =>
  new Uint8Array([...header, ...new Array(32).fill(0)])

const PNG = withHeader(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
const JPEG = withHeader(0xff, 0xd8, 0xff, 0xe0)
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
])
const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)

const USER = { kind: 'user', id: 'usr_1' } as const
const OTHER_USER = { kind: 'user', id: 'usr_2' } as const
const ORGANIZATION = { kind: 'organization', id: 'org_1' } as const

describe('detectImageType — les octets décident, pas l’en-tête', () => {
  it('reconnaît les trois formats livrés', () => {
    expect(detectImageType(PNG)).toBe('image/png')
    expect(detectImageType(JPEG)).toBe('image/jpeg')
    expect(detectImageType(WEBP)).toBe('image/webp')
  })

  it('refuse un SVG, qui est du script déguisé en image', () => {
    expect(detectImageType(bytesOf('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"/>'))).toBe(
      null,
    )
  })

  it('refuse du HTML, un GIF et un PDF', () => {
    expect(detectImageType(bytesOf('<!doctype html><script>x()</script>'))).toBe(null)
    expect(detectImageType(withHeader(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe(null)
    expect(detectImageType(bytesOf('%PDF-1.7'))).toBe(null)
  })

  it('refuse un conteneur RIFF qui n’est pas du WebP', () => {
    // `RIFF` seul ne prouve rien : un WAV commence pareil. Les octets 8 à 11
    // sont ce qui distingue.
    const wav = new Uint8Array(WEBP)

    wav.set(bytesOf('WAVE'), 8)

    expect(detectImageType(wav)).toBe(null)
  })

  it('refuse ce qui est trop court pour porter une signature', () => {
    expect(detectImageType(new Uint8Array([]))).toBe(null)
    expect(detectImageType(new Uint8Array([0x89, 0x50]))).toBe(null)
  })
})

describe('validateAvatarUpload — ce qui est refusé avant même de présigner', () => {
  it('accepte un des trois types, sous la taille maximale', () => {
    expect(validateAvatarUpload({ contentType: 'image/png', size: 1024 })).toEqual({ ok: true })
  })

  it('refuse un type que le produit ne sert pas', () => {
    expect(validateAvatarUpload({ contentType: 'image/svg+xml', size: 10 })).toEqual({
      ok: false,
      refusal: 'unsupported_type',
    })
    expect(validateAvatarUpload({ contentType: 'text/html', size: 10 })).toEqual({
      ok: false,
      refusal: 'unsupported_type',
    })
  })

  it('refuse une taille annoncée au-dessus du plafond, et une taille absurde', () => {
    expect(validateAvatarUpload({ contentType: 'image/png', size: AVATAR_MAX_BYTES + 1 })).toEqual({
      ok: false,
      refusal: 'too_large',
    })
    expect(validateAvatarUpload({ contentType: 'image/png', size: 0 })).toEqual({
      ok: false,
      refusal: 'invalid_size',
    })
    expect(validateAvatarUpload({ contentType: 'image/png', size: -1 })).toEqual({
      ok: false,
      refusal: 'invalid_size',
    })
  })
})

describe('validateStoredAvatar — le contrôle qui compte, après téléversement', () => {
  it('accepte des octets qui sont réellement l’image annoncée', () => {
    expect(validateStoredAvatar({ bytes: PNG, declaredContentType: 'image/png' })).toEqual({
      ok: true,
      contentType: 'image/png',
    })
  })

  it('refuse du HTML téléversé sous un en-tête `image/png`', () => {
    expect(
      validateStoredAvatar({
        bytes: bytesOf('<html><script>fetch("/vol")</script></html>'),
        declaredContentType: 'image/png',
      }),
    ).toEqual({ ok: false, refusal: 'content_mismatch' })
  })

  it('refuse une image réelle dont le type ne correspond pas à celui annoncé', () => {
    // Le fournisseur servira l'objet sous le type **déclaré au stockage** :
    // stocker un JPEG sous `image/png` ferait servir un type qui ment.
    expect(validateStoredAvatar({ bytes: JPEG, declaredContentType: 'image/png' })).toEqual({
      ok: false,
      refusal: 'content_mismatch',
    })
  })

  it('refuse des octets plus gros que le plafond, quoi qu’ait annoncé le client', () => {
    const oversized = new Uint8Array(AVATAR_MAX_BYTES + 1)

    oversized.set(PNG.slice(0, 8), 0)

    expect(validateStoredAvatar({ bytes: oversized, declaredContentType: 'image/png' })).toEqual({
      ok: false,
      refusal: 'too_large',
    })
  })
})

describe('avatarKeyFor et keyBelongsTo — la clé est confinée à son périmètre', () => {
  it('construit une clé sous le préfixe du propriétaire, sans rien recevoir du client', () => {
    const key = avatarKeyFor(USER, 'image/png', () => 'aaaabbbbccccdddd')

    expect(key.startsWith(scopePrefix(USER))).toBe(true)
    expect(key).toBe('avatars/user/usr_1/aaaabbbbccccdddd.png')
  })

  it('donne une extension par type, jamais celle d’un nom de fichier', () => {
    expect(avatarKeyFor(USER, 'image/jpeg', () => 'x')).toMatch(/\.jpg$/)
    expect(avatarKeyFor(ORGANIZATION, 'image/webp', () => 'x')).toBe(
      'avatars/organization/org_1/x.webp',
    )
  })

  it('reconnaît la clé de son propre périmètre', () => {
    expect(keyBelongsTo('avatars/user/usr_1/abc.png', USER)).toBe(true)
    expect(keyBelongsTo('avatars/organization/org_1/abc.png', ORGANIZATION)).toBe(true)
  })

  it('refuse la clé d’un autre compte, même à un caractère près', () => {
    expect(keyBelongsTo('avatars/user/usr_2/abc.png', USER)).toBe(false)
    expect(keyBelongsTo('avatars/organization/org_1/abc.png', USER)).toBe(false)
    // Le préfixe `usr_1` est un préfixe de `usr_10` : une comparaison de chaîne
    // sans la barre oblique laisserait passer le périmètre du voisin.
    expect(keyBelongsTo('avatars/user/usr_10/abc.png', USER)).toBe(false)
    expect(keyBelongsTo('avatars/user/usr_1/abc.png', OTHER_USER)).toBe(false)
  })

  it('refuse une clé qui remonte dans l’arborescence, même sous le bon préfixe', () => {
    expect(keyBelongsTo('avatars/user/usr_1/../usr_2/abc.png', USER)).toBe(false)
    expect(keyBelongsTo('avatars/user/usr_1/sous/dossier/abc.png', USER)).toBe(false)
    expect(keyBelongsTo('avatars/user/usr_1/', USER)).toBe(false)
  })

  it('refuse un identifiant de propriétaire qui contiendrait une barre oblique', () => {
    // Un identifiant venu de la base, jamais du client — mais la clé est ce qui
    // sépare deux périmètres, et elle ne doit pas pouvoir être fabriquée.
    expect(() => avatarKeyFor({ kind: 'user', id: '../org_1' }, 'image/png', () => 'x')).toThrow()
  })
})

describe('servedKeyOf — ce qui est servi n’est jamais ce qui a été présigné', () => {
  it('sépare l’espace d’attente de l’espace servi', () => {
    const pending = avatarKeyFor(USER, 'image/png', () => 'aaaabbbbccccdddd', 'pending')

    expect(pending).toBe('pending/user/usr_1/aaaabbbbccccdddd.png')
    // **Aucune URL présignée ne nomme jamais cette clé-là** : elle est
    // fabriquée à la confirmation, sur des octets déjà vérifiés.
    expect(servedKeyOf(pending, USER)).toBe('avatars/user/usr_1/aaaabbbbccccdddd.png')
    expect(keyBelongsTo(pending, USER)).toBe(false)
  })

  it('refuse de promouvoir la clé d’attente d’un autre périmètre', () => {
    expect(servedKeyOf('pending/user/usr_2/abc.png', USER)).toBe(null)
    expect(servedKeyOf('pending/user/usr_10/abc.png', USER)).toBe(null)
    expect(servedKeyOf('pending/organization/org_1/abc.png', USER)).toBe(null)
  })

  it('refuse de promouvoir une clé déjà servie, ou qui remonte dans l’arborescence', () => {
    // La clé servie n'est pas présignable : la confirmer reviendrait à faire
    // remplacer l'objet vérifié par lui-même, et ouvrirait le chemin que la
    // promotion referme.
    expect(servedKeyOf('avatars/user/usr_1/abc.png', USER)).toBe(null)
    expect(servedKeyOf('pending/user/usr_1/../../avatars/user/usr_1/abc.png', USER)).toBe(null)
    expect(servedKeyOf('pending/user/usr_1/', USER)).toBe(null)
  })
})

describe('la clé d’un identifiant fabriqué', () => {
  it('refuse un identifiant de propriétaire qui contiendrait une barre oblique', () => {
    // Un identifiant venu de la base, jamais du client — mais la clé est ce qui
    // sépare deux périmètres, et elle ne doit pas pouvoir être fabriquée.
    expect(() => avatarKeyFor({ kind: 'user', id: '../org_1' }, 'image/png', () => 'x')).toThrow()
  })
})
