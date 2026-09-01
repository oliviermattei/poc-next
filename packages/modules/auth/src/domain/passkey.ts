import { z } from 'zod'

import { InvalidCredentialsError } from './credentials'

/**
 * Les règles pures des passkeys (s14).
 *
 * Pures : elles ne connaissent ni WebAuthn, ni la bibliothèque
 * d'authentification, ni une requête, ni une table. Ce sont elles que les
 * routes appellent, et c'est là qu'elles sont éprouvées
 * (`auth-rules.test.ts`).
 *
 * Ce qui **n'est pas** ici, et qui n'y sera jamais : la vérification d'une
 * attestation ou d'une assertion. C'est de la cryptographie sur des octets,
 * elle appartient à `@simplewebauthn/server` par le greffon, donc à
 * `infrastructure/`. Le `domain` décide ce qu'on accepte de dire ; il ne
 * réimplémente pas ce qu'on sait déjà vérifier.
 */

/**
 * Longueur maximale du nom d'une passkey.
 *
 * Le nom est écrit par la personne et relu par elle seule, dans une liste : il
 * n'a pas besoin d'être long, et une chaîne sans borne dans une colonne
 * `text` est une porte à déni de service par volume.
 */
export const PASSKEY_NAME_MAX_LENGTH = 60

/**
 * Le nom donné à une passkey, ou `null` quand il n'y en a pas.
 *
 * **`null` est un état légitime, pas un oubli.** L'enregistrement part d'un
 * clic — la cérémonie WebAuthn ne peut pas naître d'une soumission de
 * formulaire —, donc aucun nom n'est saisi à ce moment-là. Le nom arrive
 * ensuite, par le renommage, et l'écran affiche d'ici là un libellé de son
 * catalogue. Le module, lui, ne parle aucune langue : il ne fabrique pas de
 * nom par défaut.
 *
 * Un nom **présent** est en revanche jugé : rogné, non vide, borné. Le refus
 * emprunte le même chemin que `parseDisplayName` — `InvalidCredentialsError`,
 * que la route traduit en 400.
 */
export function parsePasskeyName(input: unknown): string | null {
  const parsed = z
    .object({
      name: z
        .string({ error: 'le nom doit être une chaîne de caractères' })
        .trim()
        .min(1, { message: 'le nom ne peut pas être vide' })
        .max(PASSKEY_NAME_MAX_LENGTH, {
          message: `le nom ne peut pas dépasser ${PASSKEY_NAME_MAX_LENGTH} caractères`,
        })
        .optional(),
    })
    .safeParse(input ?? {})

  if (!parsed.success) {
    throw new InvalidCredentialsError(
      parsed.error.issues.map((issue) => issue.message).join(' ; '),
    )
  }

  return parsed.data.name ?? null
}

/**
 * Ce qu'un refus d'opération de passkey a le droit de dire. Deux classes.
 *
 * Même discipline que les deux classes d'un retour de fournisseur (s12) et les
 * trois d'une vérification de second facteur (s13) : les codes du greffon
 * décrivent l'état du compte ou celui du défi, et aucun n'a le droit
 * d'atteindre le navigateur (`docs/security.md` §7).
 *
 * Les classes disent la **conduite à tenir**, et rien d'autre :
 *
 * - `stale` — la session est trop ancienne pour ajouter un moyen de connexion.
 *   Il faut se reconnecter, ressayer ne sert à rien ;
 * - `refused` — tout le reste : cérémonie invalide, défi consommé ou expiré,
 *   justificatif déjà connu, nom refusé.
 *
 * Le **statut** est le même pour les deux. Le distinguer rendrait l'état de la
 * session lisible à qui ne lit que l'en-tête — et ces routes-là sont déclarées
 * `authenticated`, donc on n'y arrive que sur son propre compte, mais la règle
 * du module ne dépend pas de ce détail.
 */
export type PasskeyFailureClass = 'stale' | 'refused'

/** Le statut rendu par tout refus d'enrôlement, de renommage ou de révocation. */
export const PASSKEY_REFUSAL_STATUS = 400

export interface PasskeyRefusal {
  readonly status: number
  readonly body: { readonly error: PasskeyFailureClass }
}

/**
 * Le refus à rendre pour un statut du greffon — `null` si la réponse doit
 * passer telle quelle.
 *
 * **Mesuré dans `better-auth@1.7.2`** : `freshSessionMiddleware` rend `403`
 * (`SESSION_NOT_FRESH`) quand la session dépasse `freshAge` — un jour par
 * défaut — et `401` quand il n'y a pas de session du tout. Les deux autres
 * refus du greffon (`CHALLENGE_NOT_FOUND`,
 * `FAILED_TO_VERIFY_REGISTRATION`) sortent en `400`.
 *
 * Le repli est `refused` : c'est le seul message qui ne suppose rien de l'état
 * de la session.
 */
export function passkeyRefusal(status: number): PasskeyRefusal | null {
  if (status >= 200 && status < 300) {
    return null
  }

  return {
    status: PASSKEY_REFUSAL_STATUS,
    body: { error: status === 403 ? 'stale' : 'refused' },
  }
}

/** Une passkey telle que la persistance la connaît. La clé publique en fait partie. */
export interface StoredPasskey {
  readonly id: string
  readonly name: string | null
  readonly createdAt: Date
}

/** Une passkey telle qu'un écran a le droit de la connaître. */
export interface DescribedPasskey {
  readonly id: string
  readonly name: string | null
  readonly createdAt: Date
  /**
   * La règle **déjà décidée**, jamais rejouée par l'écran : le compte
   * garderait-il un moyen de connexion après cette révocation ?
   * `canUnlinkSignInMethod` (`domain/oauth.ts`) la porte, et le repository la
   * réapplique sous verrou au moment de supprimer — masquer un bouton n'a
   * jamais été une permission (`docs/security.md` §3).
   */
  readonly removable: boolean
}

/**
 * Ce qu'une liste de passkeys montre, et dans quel ordre.
 *
 * Les champs sont **recopiés un à un**, jamais étalés depuis la ligne — même
 * règle que `describeSessions`, et pour la même raison : un `...row` ferait
 * voyager `publicKey`, `credentialID` et `counter` jusqu'au HTML au premier
 * ajout de colonne. Aucun des trois n'est un secret au sens strict, et aucun
 * des trois n'a de raison de sortir : le premier identifie un justificatif
 * pour qui voudrait le supplanter, le troisième est l'état d'une garde.
 *
 * La plus récente d'abord : c'est celle qu'on vient d'ajouter, donc celle qu'on
 * cherche à nommer.
 */
export function describePasskeys(
  passkeys: readonly StoredPasskey[],
  options: { readonly removable: boolean },
): readonly DescribedPasskey[] {
  return passkeys
    .map((passkey) => ({
      id: passkey.id,
      name: passkey.name,
      createdAt: passkey.createdAt,
      removable: options.removable,
    }))
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
}
