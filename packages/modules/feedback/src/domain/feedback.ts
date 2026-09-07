import { z } from 'zod'

/**
 * Les règles pures d'un retour (s43) — aucun framework, aucun ORM, aucun SDK.
 *
 * Elles portent deux frontières, et la seconde est la surface de sécurité de la
 * story :
 *
 * 1. **la catégorie et le statut sont des vocabulaires fermés.** Un texte libre
 *    y ferait du filtre du back-office une liste ouverte pilotée par
 *    l'appelant, et d'une colonne indexée un champ sans forme ;
 * 2. **l'URL d'origine est une donnée fournie par le client** (critère 2). Elle
 *    arrive d'un champ caché du formulaire, donc de quelqu'un qui l'écrit
 *    entièrement. Elle est validée, bornée, et réduite à un **chemin interne**
 *    avant d'entrer en base — voir `parseOriginPath`.
 */

/** Les catégories du critère 1 : un bogue, une idée, autre chose. */
export const FEEDBACK_CATEGORIES = ['bug', 'idea', 'other'] as const

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]

/**
 * Les statuts du critère 5 : reçu, traité.
 *
 * **Deux valeurs, pas un cycle.** Le critère 4 demande de filtrer par statut et
 * le critère 5 de marquer comme traité : deux valeurs répondent aux deux, et un
 * cycle plus riche serait une décision de produit que la story ne prend pas.
 */
export const FEEDBACK_STATUSES = ['open', 'handled'] as const

export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

/**
 * La longueur maximale d'un message.
 *
 * Une borne, parce que la colonne est du texte libre écrit par un compte
 * authentifié : sans elle, une seule requête écrit ce qu'elle veut en base.
 * Deux mille caractères tiennent un rapport de bogue circonstancié.
 */
export const FEEDBACK_MESSAGE_MAX_LENGTH = 2_000

/**
 * La longueur maximale d'un chemin d'origine.
 *
 * Les navigateurs eux-mêmes n'ont aucune limite normative ; celle-ci borne ce
 * qu'un appelant peut faire écrire, et 512 laisse largement passer les chemins
 * de ce produit, chaîne de requête comprise.
 */
export const FEEDBACK_ORIGIN_MAX_LENGTH = 512

/**
 * Un caractère de contrôle, ou une espace.
 *
 * Écrit en **points de code** et non en expression régulière : un motif porterait
 * les caractères eux-mêmes, invisibles dans un éditeur — c'est exactement ce
 * qu'un lecteur ne relirait pas, et `no-control-regex` le refuse pour cette
 * raison. La borne haute est `0x20` (l'espace comprise) plus `0x7f`.
 */
const isControlCharacter = (character: string): boolean => {
  const code = character.codePointAt(0) ?? 0

  return code <= 0x20 || code === 0x7f
}

/**
 * **Le chemin de la page d'origine, tel qu'il a le droit d'entrer en base.**
 *
 * C'est la tâche 2 du plan, et la seule surface de sécurité que ce module
 * ajoute : la valeur vient d'un champ caché du formulaire, c'est-à-dire de
 * l'appelant, et elle finira **rendue dans un écran d'administration**. Trois
 * refus, et chacun ferme une famille d'attaque :
 *
 * - **un schéma exécutable** (`javascript:`, `data:`) : posé dans un `href`
 *   d'écran d'administration, il s'exécute au clic d'un superadmin ;
 * - **une adresse protocole-relative** (`//ailleurs.test/…`) : elle quitte le
 *   site sans en avoir l'air, et c'est la forme qui trompe le lecteur humain ;
 * - **une adresse absolue** : ce module ne sait pas quelle origine est la
 *   sienne — il ne lit aucune variable d'environnement (`docs/security.md` §5).
 *   Ne garder qu'un chemin rend la question sans objet.
 *
 * La borne **refuse**, elle ne tronque pas : une valeur tronquée est une valeur
 * fausse qu'un écran affiche comme vraie.
 *
 * Un refus n'est jamais une erreur de soumission : le retour part sans son
 * origine. Refuser le message entier pour un champ caché mal formé punirait
 * l'utilisateur d'une valeur qu'il n'a pas écrite.
 */
export function parseOriginPath(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  if (trimmed.length === 0 || trimmed.length > FEEDBACK_ORIGIN_MAX_LENGTH) {
    return null
  }

  // Un chemin, et rien d'autre : une seule barre oblique en tête, aucune
  // seconde (protocole-relatif), aucun schéma (le deux-points est refusé avant
  // la première barre oblique par la contrainte de tête).
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return null
  }

  // Une barre oblique inversée est lue comme une barre oblique par les
  // navigateurs : `/\ailleurs.test` sort du site exactement comme `//`.
  if (trimmed.startsWith('/\\')) {
    return null
  }

  // Un caractère de contrôle — espace compris — dans un `href` casse la lecture
  // humaine de l'adresse et permet d'en masquer la vraie destination.
  if ([...trimmed].some(isControlCharacter)) {
    return null
  }

  return trimmed
}

/** Ce qu'une soumission valide porte, une fois taillée. */
export interface FeedbackSubmission {
  readonly category: FeedbackCategory
  readonly message: string
  /** Le chemin de la page d'origine, ou `null` — jamais une valeur non validée. */
  readonly originPath: string | null
}

/**
 * Ce que rend la lecture d'une soumission.
 *
 * Le refus **nomme le champ** : le formulaire est natif et rendu par le
 * serveur, donc c'est la seule façon de dire à l'auteur ce qui ne va pas sans
 * lui redemander tout son message.
 */
export type FeedbackSubmissionOutcome =
  | { readonly ok: true; readonly value: FeedbackSubmission }
  | { readonly ok: false; readonly field: 'category' | 'message' }

const submissionSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES),
  message: z.string(),
  origin: z.unknown().optional(),
})

/**
 * **La frontière d'entrée d'un retour** (`docs/security.md` §4) : Zod, ici, et
 * pas dans la route.
 *
 * L'ordre des deux refus est fixé pour que le message rendu à l'auteur soit
 * celui de sa faute : la catégorie vient d'un `<select>`, donc une catégorie
 * invalide est une soumission forgée, pas une faute de saisie.
 */
export function parseFeedbackSubmission(input: unknown): FeedbackSubmissionOutcome {
  const parsed = submissionSchema.safeParse(input ?? {})

  if (!parsed.success) {
    const named = parsed.error.issues.find((issue) => issue.path[0] === 'message')

    return { ok: false, field: named === undefined ? 'category' : 'message' }
  }

  const message = parsed.data.message.trim()

  if (message.length === 0 || message.length > FEEDBACK_MESSAGE_MAX_LENGTH) {
    return { ok: false, field: 'message' }
  }

  return {
    ok: true,
    value: {
      category: parsed.data.category,
      message,
      originPath: parseOriginPath(parsed.data.origin),
    },
  }
}

const targetSchema = z.object({ id: z.string().min(1).max(128) })

/**
 * L'identifiant qu'un geste du back-office vise, lu **après** la garde.
 *
 * Borné comme tout ce qui vient d'un corps de requête : un identifiant de ce
 * dépôt est un UUID, et rien de plus long n'a de sens à atteindre la base.
 */
export function parseFeedbackTarget(input: unknown): { readonly id: string } | null {
  const parsed = targetSchema.safeParse(input ?? {})

  return parsed.success ? { id: parsed.data.id } : null
}
