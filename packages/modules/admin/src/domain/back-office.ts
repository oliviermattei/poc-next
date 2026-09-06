import { z } from 'zod'

/**
 * Les règles pures des **listes** du back-office (s37b2) : ce qu'une adresse
 * demande, et ce que la base doit lire pour y répondre.
 *
 * Elles vivent dans le `domain` — aucune requête HTTP, aucune table, aucun
 * composant — parce qu'elles se prouvent sans base et sans navigateur, et
 * qu'elles gardent une frontière : les paramètres d'une liste de comptes sont
 * une **entrée**, au même titre qu'un corps de requête (`docs/security.md` §4).
 */

/** Une page de liste. Vingt lignes : la densité confortable du design system. */
export const BACK_OFFICE_PAGE_SIZE = 20

/**
 * La page la plus haute qu'une adresse puisse demander.
 *
 * Elle existe pour que le décalage passé à la base reste borné : `?page=1e9`
 * ferait lire un décalage que PostgreSQL parcourt ligne à ligne. Le refus est
 * un repli sur la première page, jamais une erreur — une adresse forgée ne doit
 * pas apprendre à son visiteur que cet écran existe.
 */
export const MAX_BACK_OFFICE_PAGE = 10_000

/** La recherche la plus longue acceptée. Au-delà, il n'y a plus rien à chercher. */
const MAX_SEARCH_LENGTH = 120

/** Ce qu'une liste de back-office lit de son adresse. */
export interface BackOfficeQuery {
  /** Le texte cherché, déjà taillé. `null` quand il n'y a pas de recherche. */
  readonly search: string | null
  readonly page: number
}

/**
 * Le premier passage d'un paramètre d'URL : Next rend `string | string[] |
 * undefined`, et une valeur répétée (`?q=a&q=b`) doit devenir **une** valeur.
 * Passer le tableau à une requête paramétrée serait une valeur d'un type que
 * personne n'attend.
 */
const firstValue = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => (Array.isArray(value) ? value[0] : value))

const searchSchema = firstValue.transform((value) => {
  const trimmed = (value ?? '').trim()

  return trimmed === '' || trimmed.length > MAX_SEARCH_LENGTH ? null : trimmed
})

const pageSchema = firstValue.transform((value) => {
  const parsed = z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_BACK_OFFICE_PAGE)
    .safeParse(value ?? '1')

  // **Un repli, jamais une exception** : `?page=abc` sert la première page.
  return parsed.success ? parsed.data : 1
})

const querySchema = z.object({ q: searchSchema, page: pageSchema })

/**
 * Lit les paramètres d'une liste — et **ne lève jamais**.
 *
 * C'est une décision, pas une facilité : le seul appelant est un écran servi à
 * un superadmin, et une adresse malformée qui le ferait tomber en 500 le
 * distinguerait d'une URL inventée, ce que la story refuse partout ailleurs.
 * Ce qui n'est pas lisible est remplacé par son défaut, jamais transmis à la
 * base.
 */
export function parseBackOfficeQuery(input: unknown): BackOfficeQuery {
  const parsed = querySchema.safeParse(input ?? {})

  if (!parsed.success) {
    return { search: null, page: 1 }
  }

  return { search: parsed.data.q, page: parsed.data.page }
}

/**
 * La période la plus longue acceptée d'une adresse. Au-delà, ce n'est plus un
 * identifiant de période : rien n'est transmis plus bas.
 */
const MAX_PERIOD_LENGTH = 20

const periodSchema = z.object({
  period: firstValue.transform((value) => {
    const trimmed = (value ?? '').trim()

    return trimmed === '' || trimmed.length > MAX_PERIOD_LENGTH ? null : trimmed
  }),
})

/**
 * Lit la **période** demandée par une adresse (s38, critère 4) — et ne lève pas
 * davantage que `parseBackOfficeQuery`.
 *
 * Ce module s'arrête à la forme : une valeur, taillée, bornée en longueur, ou
 * `null`. **Il ne sait pas quelles périodes existent** — le vocabulaire
 * appartient à la facturation, qui seule sait où chacune commence, et c'est elle
 * qui refuse ce qu'elle ne connaît pas. Deux frontières, chacune sur ce qu'elle
 * possède, plutôt qu'une liste recopiée qui divergerait.
 */
export function parseBackOfficePeriod(input: unknown): string | null {
  const parsed = periodSchema.safeParse(input ?? {})

  return parsed.success ? parsed.data.period : null
}

/** La fenêtre de lecture d'une page : ce que la requête paramétrée reçoit. */
export function pageWindowOf(input: {
  readonly page: number
  readonly pageSize: number
}): { readonly limit: number; readonly offset: number } {
  return { limit: input.pageSize, offset: (input.page - 1) * input.pageSize }
}

/**
 * Le nombre de pages, **jamais zéro**.
 *
 * Une liste vide a une page : sans elle, la pagination rendrait une navigation
 * sans aucun numéro et l'état vide n'aurait pas de page courante à nommer.
 */
export function pageCountOf(input: {
  readonly total: number
  readonly pageSize: number
}): number {
  return Math.max(1, Math.ceil(input.total / input.pageSize))
}

/** La session visée par une révocation : deux identifiants, et rien d'autre. */
export interface SessionTarget {
  readonly userId: string
  readonly sessionId: string
}

const sessionTargetSchema = z.object({
  userId: z.string().trim().min(1).max(128),
  sessionId: z.string().trim().min(1).max(128),
})

/**
 * Lit le corps d'une révocation de session — **Zod à la frontière**
 * (`docs/security.md` §4), comme `parseAccountTarget` pour les autres routes.
 *
 * Deux **identifiants**, jamais une adresse : le back-office ne désigne un
 * compte que par ce que sa propre table connaît déjà.
 */
export function parseSessionTarget(body: unknown): SessionTarget | null {
  const parsed = sessionTargetSchema.safeParse(body)

  return parsed.success ? parsed.data : null
}
