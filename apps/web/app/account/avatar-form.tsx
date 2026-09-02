'use client'

import { Alert, Avatar, AvatarFallback, AvatarImage, Button, initialsOf } from '@repo/ui'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useRef, useState, type ChangeEvent } from 'react'

import { useHydrated } from '../use-hydrated'

/**
 * La photo de profil : la choisir, la remplacer, la retirer.
 *
 * **Trois appels, et le second ne passe pas par nous** (critère 2 de s18) :
 *
 * 1. `presign` — le serveur juge le type et la taille annoncés, fabrique la clé
 *    et rend une URL signée ;
 * 2. `PUT` **directement vers le stockage** — les octets ne traversent jamais
 *    l'application ;
 * 3. `confirm` — le serveur **relit les octets** et refuse ce qui n'est pas une
 *    des trois images. C'est le seul moment où le contenu peut être vu : aucune
 *    signature ne lie un en-tête `Content-Type` à des octets.
 *
 * **Pourquoi ce composant vit dans `apps/web` et non dans le module.** Il
 * appelle `fetch`, et `eslint.config.ts` refuse tout appel réseau sortant d'un
 * module hors de sa porte bornée (`docs/reliability.md` §3). La règle vise des
 * appels **serveur vers un tiers** ; élargir une garde de fiabilité pour un cas
 * qu'elle ne visait pas est précisément ce que ce dépôt refuse. Le composant a
 * donc rejoint `auth-form.tsx` et `public-form.tsx`, qui sont là pour la même
 * raison.
 *
 * **`method="post"`, et le bouton désactivé tant que React n'a pas repris la
 * main** — les deux règles que tout formulaire du dépôt hérite de s08. Le
 * formulaire ne se soumet jamais nativement : le chemin nominal est le
 * JavaScript, et sans lui rien ne part. Le `method` est écrit quand même, parce
 * que c'est le repli pré-hydratation qui met les champs dans l'URL.
 */

export interface AvatarFormProps {
  /** Les trois routes du module, résolues par l'écran serveur. */
  readonly presignAction: string
  readonly confirmAction: string
  readonly removeAction: string
  /** L'avatar actuel, ou `null` — le repli sur les initiales est celui d'`Avatar`. */
  readonly avatarUrl: string | null
  /** Le nom du compte : il donne les initiales et le texte alternatif. */
  readonly name: string
  /** Les types acceptés, dérivés du `domain` du module — jamais recopiés ici. */
  readonly accept: string
}

/** Le préfixe des clés de refus du module. Le serveur rend un code, pas une phrase. */
const REFUSAL_PREFIX = 'storage.avatar.error.'

/** Les refus que le module nomme. Un code inconnu retombe sur l'échec générique. */
const KNOWN_REFUSALS = new Set([
  'unsupported_type',
  'too_large',
  'invalid_size',
  'content_mismatch',
  'invalid_key',
  'storage_unavailable',
])

const refusalKeyOf = (code: unknown): string =>
  typeof code === 'string' && KNOWN_REFUSALS.has(code)
    ? `${REFUSAL_PREFIX}${code}`
    : 'storage.avatar.error.failed'

export function AvatarForm({
  presignAction,
  confirmAction,
  removeAction,
  avatarUrl,
  name,
  accept,
}: AvatarFormProps) {
  const t = useTranslations()
  const router = useRouter()
  const hydrated = useHydrated()
  const input = useRef<HTMLInputElement>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const upload = async (file: File): Promise<void> => {
    const presigned = await fetch(presignAction, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentType: file.type, size: file.size }),
    })

    if (!presigned.ok) {
      setErrorKey(refusalKeyOf(((await presigned.json()) as { error?: unknown }).error))

      return
    }

    const upload = (await presigned.json()) as {
      key: string
      url: string
      headers: Record<string, string>
    }

    // **Directement vers le stockage.** Les en-têtes sont ceux que le serveur a
    // signés : les reposer à l'identique est ce que le fournisseur exige, et
    // c'est aussi ce qui interdit d'envoyer un autre type ou une autre taille
    // avec cette URL.
    const stored = await fetch(upload.url, {
      method: 'PUT',
      headers: upload.headers,
      body: file,
    })

    if (!stored.ok) {
      setErrorKey('storage.avatar.error.failed')

      return
    }

    const confirmed = await fetch(confirmAction, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: upload.key }),
    })

    if (!confirmed.ok) {
      const refusal = ((await confirmed.json().catch(() => ({}))) as { error?: unknown }).error

      // **Un rejeu n'est pas un envoi invalide.** Le serveur refuse la seconde
      // confirmation d'une même clé (ADR 033), mais il dit laquelle des deux
      // histoires s'est produite. Quand la promotion a déjà eu lieu, la photo
      // enregistrée **est** celle qui vient d'être envoyée : annoncer un échec
      // dirait le contraire de ce qui s'est passé. L'écran redemande donc son
      // état au serveur, comme après un envoi réussi.
      if (confirmed.status === 404 && refusal === 'already_confirmed') {
        router.refresh()

        return
      }

      setErrorKey(
        confirmed.status === 404 ? 'storage.avatar.error.invalid_key' : refusalKeyOf(refusal),
      )

      return
    }

    // L'avatar affiché vient du serveur : l'écran le redemande plutôt que de
    // recopier localement ce qu'il vient d'envoyer.
    router.refresh()
  }

  const choose = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    // `event.currentTarget` est **nul après le retour du gestionnaire** : React
    // le remet à zéro, et le lire dans un `finally` asynchrone lève. Mesuré au
    // navigateur, où l'exception laissait le champ non vidé — donc rechoisir le
    // même fichier ne déclenchait plus rien. Le champ est donc capturé ici.
    const field = event.currentTarget
    const file = field.files?.[0]

    if (file === undefined) {
      return
    }

    setPending(true)
    setErrorKey(null)

    try {
      await upload(file)
    } catch {
      // Un réseau coupé ne doit pas laisser le bouton en « envoi en cours »
      // pour toujours : l'échec est dit, et l'écran redevient utilisable.
      setErrorKey('storage.avatar.error.failed')
    } finally {
      setPending(false)
      // Le champ est vidé pour que rechoisir **le même fichier** déclenche un
      // nouvel envoi : sans cela, `change` ne se déclenche pas deux fois.
      field.value = ''
    }
  }

  const remove = async (): Promise<void> => {
    setPending(true)
    setErrorKey(null)

    try {
      const response = await fetch(removeAction, { method: 'POST' })

      if (!response.ok) {
        setErrorKey('storage.avatar.error.failed')

        return
      }

      router.refresh()
    } catch {
      setErrorKey('storage.avatar.error.failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      method="post"
      action={confirmAction}
      onSubmit={(event) => event.preventDefault()}
      className="flex flex-col gap-4"
    >
      {errorKey === null ? null : (
        <Alert variant="destructive" role="alert">
          {t(errorKey)}
        </Alert>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Avatar size="lg">
          {avatarUrl === null ? null : (
            <AvatarImage src={avatarUrl} alt={t('storage.avatar.alt', { name })} />
          )}
          <AvatarFallback>{initialsOf(name)}</AvatarFallback>
        </Avatar>

        <div className="flex min-w-0 flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(event) => void choose(event)}
          />
          <Button
            type="button"
            pending={pending}
            disabled={!hydrated}
            onClick={() => input.current?.click()}
          >
            {pending ? t('storage.avatar.pending') : t('storage.avatar.choose')}
          </Button>
          {avatarUrl === null ? null : (
            <Button
              type="button"
              variant="outline"
              disabled={!hydrated || pending}
              onClick={() => void remove()}
            >
              {t('storage.avatar.remove')}
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
