import { z } from 'zod'

import type { AuthPolicy } from './auth-policy'

/**
 * Les règles d'identifiants, écrites **une fois**.
 *
 * Elles sont appliquées par la route avant tout appel à la bibliothèque
 * d'authentification : un refus ne doit atteindre ni la règle de la
 * bibliothèque, ni la persistance. La même politique arme ensuite Better Auth
 * (`minPasswordLength`), pour qu'il n'existe pas deux longueurs minimales dont
 * la plus permissive gagnerait.
 */
export class InvalidCredentialsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidCredentialsError'
  }
}

/**
 * L'adresse est normalisée : espaces retirés, casse abaissée.
 *
 * Sans normalisation, `Olivier@Example.test` et `olivier@example.test` sont
 * deux comptes — et l'un des deux reçoit les emails de l'autre.
 */
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((value) => z.email().safeParse(value).success, {
    message: 'doit être une adresse email valide',
  })

export interface SignUpInput {
  readonly email: string
  readonly password: string
}

export interface SignInInput {
  readonly email: string
  readonly password: string
}

const fail = (issues: readonly string[]): never => {
  throw new InvalidCredentialsError(issues.join(' ; '))
}

/**
 * Valide une inscription.
 *
 * La longueur du mot de passe vient de la politique : la story nomme
 * explicitement la constante en dur comme le piège à éviter.
 */
export function parseSignUpInput(input: unknown, policy: AuthPolicy): SignUpInput {
  const schema = z.object({
    email: emailSchema,
    password: z
      .string()
      .min(policy.passwordMinLength, {
        message: `le mot de passe doit contenir au moins ${policy.passwordMinLength} caractères`,
      })
      .max(policy.passwordMaxLength, {
        message: `le mot de passe ne peut pas dépasser ${policy.passwordMaxLength} caractères`,
      }),
  })

  const parsed = schema.safeParse(input)

  return parsed.success
    ? parsed.data
    : fail(parsed.error.issues.map((issue) => issue.message))
}

/**
 * Valide une connexion.
 *
 * **Aucune contrainte de longueur ici**, et c'est une décision de sécurité : la
 * politique a pu changer depuis la création du compte. Refuser un mot de passe
 * « trop court » à la connexion distinguerait un compte ancien d'un compte
 * récent, et le refus ne serait plus le message unique « identifiants
 * invalides ».
 */
export function parseSignInInput(input: unknown): SignInInput {
  const schema = z.object({ email: emailSchema, password: z.string().min(1) })
  const parsed = schema.safeParse(input)

  return parsed.success
    ? parsed.data
    : fail(parsed.error.issues.map((issue) => issue.message))
}

/** Valide une adresse seule : magic link, mot de passe oublié, changement d'email. */
export function parseEmailInput(input: unknown): string {
  const parsed = z.object({ email: emailSchema }).safeParse(input)

  return parsed.success
    ? parsed.data.email
    : fail(parsed.error.issues.map((issue) => issue.message))
}

/** La forme d'un refus de connexion : un statut, un corps, et rien d'autre. */
export interface SignInRefusal {
  readonly status: number
  readonly body: { readonly message: string; readonly code: string }
}

/**
 * **Le** refus de connexion. Un seul, pour tous les états de compte.
 *
 * Il reprend mot pour mot ce que la bibliothèque rend pour « compte inconnu ou
 * mot de passe faux », parce que c'est le refus le plus fréquent et que le
 * changer romprait les clients existants. Ce qui compte est qu'il soit
 * **écrit ici** : la réponse ne dépend plus de ce que la bibliothèque a décidé
 * de dire, donc plus d'aucun état de compte.
 */
export const SIGN_IN_REFUSAL: SignInRefusal = {
  status: 401,
  body: { message: 'Invalid email or password', code: 'INVALID_EMAIL_OR_PASSWORD' },
}

/**
 * Le refus à rendre pour un statut de la bibliothèque — `null` si sa réponse
 * doit passer telle quelle.
 *
 * **Mesuré** dans `better-auth@1.7.2` (`dist/api/routes/sign-in.mjs`) : compte
 * inconnu et mot de passe faux donnent `401 INVALID_EMAIL_OR_PASSWORD` ; une
 * adresse non vérifiée donne `403 EMAIL_NOT_VERIFIED`, et seulement **après**
 * que le mot de passe a été vérifié. La distinction n'est donc pas une
 * énumération à une requête — il faut déjà connaître le mot de passe — mais
 * elle reste un oracle : un bourrage d'identifiants apprend quels mots de passe
 * sont bons. `docs/security.md` §7 n'admet aucune de ces deux formes, « ni par
 * message, ni par code de statut ».
 *
 * Le critère « inviter à vérifier son adresse » est tenu ailleurs, et sans rien
 * dire de personne : l'écran `/verify-email` et sa route de renvoi répondent la
 * même chose que l'adresse existe ou non.
 *
 * Ce qui n'est **pas** masqué : tout ce qui ne dépend d'aucun compte, une panne
 * en particulier. La confondre avec un refus d'identifiants ferait mentir
 * `docs/reliability.md` §2 sans rien protéger.
 */
export function genericSignInRefusal(status: number): SignInRefusal | null {
  return status === 401 || status === 403 ? SIGN_IN_REFUSAL : null
}
