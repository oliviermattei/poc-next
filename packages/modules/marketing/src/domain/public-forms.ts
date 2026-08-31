import { z } from 'zod'

/**
 * Les deux formulaires ouverts à tout venant, et **ce qu'ils acceptent**.
 *
 * `domain` : aucune base, aucun mailer, aucun framework — seulement `zod`, que
 * `tooling/eslint/boundaries.ts` admet explicitement ici. Ce fichier est la
 * frontière du §4 de `docs/security.md` pour les corps de requête, au même
 * titre que `marketing-config.ts` l'est pour la configuration.
 *
 * Deux propriétés y sont posées, et elles sont l'une et l'autre mesurées par
 * `application/public-forms.test.ts` :
 *
 * 1. **rien de ce qui entre ne peut ressortir dans un en-tête d'email.** Le
 *    port `Mailer` n'expose que `to` et `subject` comme champs d'en-tête
 *    (`packages/ports/src/mailer.ts`) ; une adresse ou un nom porteur d'un
 *    retour à la ligne est refusé **ici**, avant même de savoir qu'un email
 *    existe. Le message, lui, est multiligne : c'est un corps, jamais un
 *    en-tête ;
 * 2. **le piège à robots est jugé avant tout le reste.** Un robot qui remplit
 *    tous les champs doit être vu comme un robot, pas comme un humain
 *    maladroit — sinon la réponse lui apprend quel champ corriger.
 */

/** Les deux formes, écrites une fois : elles nomment un seau et une source. */
export const CONTACT_FORM = 'contact' as const
export const NEWSLETTER_FORM = 'newsletter' as const

export type PublicFormId = typeof CONTACT_FORM | typeof NEWSLETTER_FORM

export const PUBLIC_FORM_IDS: readonly PublicFormId[] = [CONTACT_FORM, NEWSLETTER_FORM]

/**
 * Le champ piège, et son nom.
 *
 * Un nom **plausible** — un robot remplit ce qu'il reconnaît. Il est exporté
 * parce que le formulaire qui le rend et la règle qui le juge doivent nommer la
 * même chose : deux littéraux divergeraient, et le piège cesserait d'être
 * armé sans que rien ne rougisse.
 */
export const TRAP_FIELD = 'website'

/** Longueurs maximales. Bornées côté serveur : le client ne décide de rien. */
export const MAX_EMAIL_LENGTH = 254
export const MAX_NAME_LENGTH = 120
export const MAX_MESSAGE_LENGTH = 4_000

/**
 * Les caractères de contrôle, cherchés **par point de code** et non par
 * expression régulière.
 *
 * `no-restricted-syntax` n'y est pour rien : c'est `no-control-regex` qui refuse
 * une classe de caractères de contrôle dans une expression régulière, et il a
 * raison de le faire — la forme est illisible et se relit mal. Une boucle dit ce
 * qu'elle cherche.
 *
 * `allowBreaks` distingue les deux frontières du module : un **nom** est une
 * ligne, un **message** est un corps. Le premier ne doit porter aucun caractère
 * de contrôle — c'est ce qui empêche qu'une saisie ressorte un jour dans un
 * champ d'en-tête ; le second a le droit d'avoir des retours à la ligne et des
 * tabulations, et rien d'autre.
 */
const TAB = 0x09
const LINE_FEED = 0x0a
const CARRIAGE_RETURN = 0x0d
const FIRST_PRINTABLE = 0x20
const DELETE = 0x7f

const hasControlCharacter = (value: string, allowBreaks: boolean): boolean => {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    const isBreak = code === TAB || code === LINE_FEED || code === CARRIAGE_RETURN

    if (code === DELETE || (code < FIRST_PRINTABLE && !(allowBreaks && isBreak))) {
      return true
    }
  }

  return false
}

/**
 * Ce que rend un refus.
 *
 * Deux natures, et elles **ne se répondent pas pareil** : `invalid` nomme le
 * champ, `automated` ne dit rien du tout à l'appelant. C'est le type qui force
 * la route à faire la différence.
 */
export type PublicFormRefusal =
  | { readonly kind: 'invalid'; readonly field: string }
  | { readonly kind: 'automated' }

export type PublicFormParse<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly refusal: PublicFormRefusal }

export interface ContactSubmission {
  readonly name: string
  readonly email: string
  readonly message: string
}

export interface NewsletterSubmission {
  readonly email: string
}

/**
 * L'adresse, telle que la contrainte d'unicité doit la voir.
 *
 * `docs/reliability.md` §1 fait porter l'idempotence par la contrainte de base,
 * pas par une vérification préalable. Encore faut-il que deux écritures de la
 * même adresse produisent la **même** chaîne : sans cette normalisation,
 * « A@B.co » et « a@b.co » sont deux lignes et deux emails de confirmation.
 */
export const normaliseEmail = (value: string): string => value.trim().toLowerCase()

const singleLine = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (value) => !hasControlCharacter(value, false),
      'ne peut pas porter de caractère de contrôle',
    )

const multiLine = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (value) => !hasControlCharacter(value, true),
      'ne peut pas porter de caractère de contrôle',
    )

const emailField = z.string().max(MAX_EMAIL_LENGTH).pipe(z.email())

const contactSchema = z.object({
  name: singleLine(MAX_NAME_LENGTH),
  email: emailField,
  message: multiLine(MAX_MESSAGE_LENGTH),
})

const newsletterSchema = z.object({ email: emailField })

/** Le corps, s'il est bien un objet. Un tableau n'en est pas un. */
const asRecord = (input: unknown): Record<string, unknown> | null =>
  typeof input === 'object' && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null

/** Les espaces de bordure sont du bruit de saisie, pas une donnée. */
const trimmed = (value: unknown): unknown => (typeof value === 'string' ? value.trim() : value)

/** Le piège est-il armé ? Une valeur non vide, quelle qu'elle soit, dit « robot ». */
const trapped = (body: Record<string, unknown>): boolean => {
  const value = body[TRAP_FIELD]

  return typeof value === 'string' && value.trim() !== ''
}

const fieldOf = (path: readonly PropertyKey[]): string => String(path[0] ?? 'body')

const parseWith = <TSchema extends z.ZodType>(
  schema: TSchema,
  body: Record<string, unknown>,
): PublicFormParse<z.infer<TSchema>> => {
  const result = schema.safeParse(body)

  return result.success
    ? { ok: true, value: result.data as z.infer<TSchema> }
    : {
        ok: false,
        refusal: { kind: 'invalid', field: fieldOf(result.error.issues[0]?.path ?? []) },
      }
}

export function parseContactSubmission(input: unknown): PublicFormParse<ContactSubmission> {
  const body = asRecord(input)

  if (body === null) {
    return { ok: false, refusal: { kind: 'invalid', field: 'body' } }
  }

  if (trapped(body)) {
    return { ok: false, refusal: { kind: 'automated' } }
  }

  const parsed = parseWith(contactSchema, {
    name: trimmed(body.name),
    email: trimmed(body.email),
    message: trimmed(body.message),
  })

  return parsed.ok
    ? { ok: true, value: { ...parsed.value, email: normaliseEmail(parsed.value.email) } }
    : parsed
}

export function parseNewsletterSubmission(input: unknown): PublicFormParse<NewsletterSubmission> {
  const body = asRecord(input)

  if (body === null) {
    return { ok: false, refusal: { kind: 'invalid', field: 'body' } }
  }

  if (trapped(body)) {
    return { ok: false, refusal: { kind: 'automated' } }
  }

  const parsed = parseWith(newsletterSchema, { email: trimmed(body.email) })

  return parsed.ok ? { ok: true, value: { email: normaliseEmail(parsed.value.email) } } : parsed
}
