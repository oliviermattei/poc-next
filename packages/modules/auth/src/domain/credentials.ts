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
