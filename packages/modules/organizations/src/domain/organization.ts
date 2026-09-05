import { z } from 'zod'

/**
 * Les règles pures d'une organisation : ce qu'un nom et un identifiant ont le
 * droit d'être, et qui devient propriétaire.
 *
 * Aucune base, aucun framework, aucun SDK (ADR 006). La liste des identifiants
 * **réservés** est un paramètre et non une constante de ce fichier : les routes
 * du système sont celles de l'application, pas celles du module — et une liste
 * écrite ici serait fausse dès l'écran suivant. C'est le point de composition
 * (`apps/web/lib/organizations.ts`) qui la dérive, et `tests/organizations.test.ts`
 * qui refuse qu'elle rate un segment réellement servi.
 */

/** L'identifiant du module. Recopié nulle part : le contrat le lit d'ici. */
export const ORGANIZATIONS_MODULE_ID = 'organizations'

/**
 * Les rôles connus du module.
 *
 * Ce sont ceux du plugin `organization` de Better Auth (`owner`, `admin`,
 * `member`), repris **volontairement** : s16 et s17 s'y adosseront, et changer
 * de vocabulaire en route obligerait à migrer une colonne. s15 n'en attribue
 * qu'un — celui du créateur.
 */
export const ORGANIZATION_ROLES = ['owner', 'admin', 'member'] as const

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number]

/** Le créateur d'une organisation en est **propriétaire** (critère 4 de s15). */
export const FOUNDER_ROLE: OrganizationRole = 'owner'

/**
 * Ce que devient un propriétaire qui **transfère** la propriété (critère 4 de
 * s17) : administrateur, pas simple membre.
 *
 * Le rétrograder jusqu'à `member` lui retirerait d'un coup le droit d'inviter
 * et de retirer, alors qu'il vient seulement de désigner un successeur ; et le
 * laisser propriétaire ne serait pas un transfert.
 */
export const SUCCEEDED_OWNER_ROLE: OrganizationRole = 'admin'

/**
 * Les motifs de refus de l'organisation elle-même.
 *
 * `slug_unavailable` couvre **à la fois** l'identifiant réservé et
 * l'identifiant déjà pris, et c'est une décision de sécurité, pas une paresse :
 * deux motifs distincts feraient du formulaire de création un test d'existence
 * d'organisation (`docs/security.md` §7). Le message dit quoi faire, pas
 * pourquoi.
 *
 * `invalid_role` (s17) est le quatrième : un rôle demandé qui n'est pas un rôle
 * du produit. Il n'a rien à voir avec une permission — un rôle inconnu est une
 * entrée malformée, refusée par Zod à la frontière, pas un droit manquant.
 */
export type OrganizationRefusal =
  | 'invalid_name'
  | 'invalid_slug'
  | 'slug_unavailable'
  | 'invalid_role'
  // s34 — la suppression de l'organisation. Trois refus, et ils ne disent pas
  // la même chose à qui les lit : la saisie ne correspond pas au nom ;
  // l'abonnement n'a pas pu être annulé chez le fournisseur, donc **rien** n'a
  // été effacé et il faut réessayer ; la purge d'un module a échoué, et le
  // rejeu reprend là où elle s'est arrêtée.
  | 'confirmation_mismatch'
  | 'billing_cancel_failed'
  | 'purge_failed'

export interface OrganizationDraft {
  readonly name: string
  readonly slug: string
}

export type OrganizationParse =
  | { readonly ok: true; readonly value: OrganizationDraft }
  | { readonly ok: false; readonly refusal: OrganizationRefusal }

/**
 * La forme d'un identifiant public : minuscules, chiffres, tirets simples.
 *
 * Un tiret de tête ou de queue, et deux tirets consécutifs, sont refusés :
 * `studio--martin` et `studio-martin` se lisent pareil dans une URL et
 * produiraient deux organisations qu'un humain croirait être la même.
 */
const SLUG_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const NAME = z.string().trim().min(1).max(64)

/**
 * L'identifiant est **normalisé avant d'être jugé** : espaces de bord retirés,
 * casse abaissée. L'ordre compte — normaliser après la confrontation aux
 * réservés laisserait passer `Account`, qui servirait ensuite `/account`.
 */
const SLUG = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(48)
  .regex(SLUG_SHAPE)

const DRAFT = z.object({ name: NAME, slug: SLUG })

/**
 * Valide un couple (nom, identifiant) venu d'un corps de requête.
 *
 * Rend un résultat discriminé plutôt que de lever : c'est la forme que le dépôt
 * impose déjà aux ports (`docs/architecture.md`), et elle oblige l'appelant à
 * traduire le refus au lieu de laisser passer un 500.
 */
/**
 * **La saisie de confirmation d'une suppression** (s34, critère 1).
 *
 * Bornée comme toute entrée : ce qui arrive ici vient de nulle part. La
 * comparaison ignore la casse et les espaces de bord — un nom se recopie, et
 * exiger l'octet près ferait échouer une confirmation authentique.
 *
 * Elle est ici, dans le `domain`, parce que c'est une **règle** : la faire
 * décider par l'écran reviendrait à ne pas la faire (`docs/security.md` §3).
 */
const CONFIRMATION = z.object({ confirmation: z.string().trim().min(1).max(200) })

export function confirmsOrganization(body: unknown, name: string): boolean {
  const parsed = CONFIRMATION.safeParse(body)

  return (
    parsed.success &&
    parsed.data.confirmation.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase()
  )
}

export function parseOrganizationDraft(
  input: unknown,
  reservedSlugs: ReadonlySet<string>,
): OrganizationParse {
  const parsed = DRAFT.safeParse(input)

  if (!parsed.success) {
    // Le premier champ fautif décide du motif ; le nom d'abord, parce qu'il est
    // le premier du formulaire. Aucun détail de Zod ne sort d'ici : un message
    // de bibliothèque dans une réponse publique renseigne sur l'implémentation.
    const fields = new Set(parsed.error.issues.map((issue) => issue.path[0]))

    return { ok: false, refusal: fields.has('name') ? 'invalid_name' : 'invalid_slug' }
  }

  if (reservedSlugs.has(parsed.data.slug)) {
    return { ok: false, refusal: 'slug_unavailable' }
  }

  return { ok: true, value: { name: parsed.data.name, slug: parsed.data.slug } }
}
