import { z } from 'zod'

/**
 * **Le rôle de plateforme** (s37a) : qui administre le produit lui-même.
 *
 * Aucune base, aucun framework, aucun SDK (ADR 006). Ce fichier ne connaît que
 * des adresses, des identifiants et des comptes — c'est `application/` qui lui
 * donne ce que la base dit, et `presentation/` qui traduit ses refus en
 * réponses HTTP.
 *
 * **Ce n'est pas un rôle d'organisation.** `owner`, `admin` et `member` (s17)
 * vivent dans `organizations` et sont scopés à **une** organisation ; celui-ci
 * est global. Les confondre donnerait le back-office à tout administrateur
 * d'organisation, ce qui est exactement l'élévation implicite que
 * `docs/security.md` §3 refuse.
 */

/**
 * Le nom du rôle, écrit **une fois**.
 *
 * Il est stocké en base et comparé ici, jamais recopié dans une route : deux
 * littéraux divergeraient, et le premier à diverger ouvrirait ou fermerait le
 * back-office sans que rien ne le dise.
 */
export const SUPERADMIN_ROLE = 'superadmin'

/** Une adresse comparable : bordures retirées, casse abaissée. */
const comparableEmail = (value: string): string => value.trim().toLowerCase()

/**
 * **La désignation du premier superadmin** (critère 1 de la story).
 *
 * Elle répond à une seule question : ce compte-ci doit-il recevoir le rôle
 * parce qu'il **n'y en a aucun** et que la configuration nomme son adresse ?
 *
 * Deux bornes, et chacune ferme une porte :
 *
 * - **aucun superadmin en base**. C'est le *premier*, pas un compte de secours
 *   permanent : sans cette borne, révoquer le compte que la variable nomme ne
 *   servirait à rien — il se redésignerait à la requête suivante, et le
 *   garde-fou du dernier deviendrait un décor ;
 * - **l'adresse est celle de la variable**, comparée sans casse ni espaces de
 *   bordure : elle est saisie à la main dans un `.env`.
 *
 * La question « quelle adresse » n'est pas posée ici : le module ne lit aucune
 * variable d'environnement (`docs/security.md` §5), il la reçoit de son point
 * de composition.
 */
export function designatesFirstSuperadmin(input: {
  readonly superadminCount: number
  readonly designatedEmail: string | null
  readonly candidateEmail: string | null
}): boolean {
  if (input.superadminCount > 0) {
    return false
  }

  if (input.designatedEmail === null || input.candidateEmail === null) {
    return false
  }

  return comparableEmail(input.designatedEmail) === comparableEmail(input.candidateEmail)
}

/** Ce qui empêche un bannissement. `null` : rien ne l'empêche. */
export type BanRefusal = 'last_superadmin'

/** Ce qui empêche une révocation. `null` : rien ne l'empêche. */
export type RevocationRefusal = BanRefusal | 'not_superadmin'

/**
 * L'état de la plateforme et du compte visé, tel que la base le dit — jamais lu
 * ici : c'est `infrastructure/` qui le lit, **sous le verrou**, et le donne.
 */
export interface PlatformRoleFacts {
  readonly superadminCount: number
  readonly targetIsSuperadmin: boolean
}

/**
 * **Le garde-fou du dernier superadmin** (critère 2 de la story), et il vaut
 * pour les **deux** gestes qui font perdre à la plateforme son dernier
 * administrateur utilisable : lui retirer le rôle, et bannir le compte qui le
 * porte.
 *
 * Sans lui, la plateforme devient définitivement inadministrable en un clic :
 * plus personne ne peut promouvoir, et la variable d'environnement ne désigne
 * plus rien tant qu'un superadmin existe — or celui qui reste ne peut plus se
 * connecter. **Aucune commande ne répare cet état** ; il faudrait une écriture
 * en base à la main.
 *
 * Bannir un superadmin qui **n'est pas** le dernier reste permis : c'est de la
 * modération entre pairs, et la règle ne protège que l'administrabilité.
 *
 * La règle est ici, pure, et le chemin d'écriture la **consulte** : les deux
 * dépôts de `infrastructure/` l'appellent avec des faits lus sous
 * `pg_advisory_xact_lock`, si bien qu'aucun autre écrivain du rôle ne peut se
 * glisser entre la décision et l'écriture (`docs/reliability.md` §1). La
 * révocation porte en plus le même prédicat **dans son `delete`** : c'est lui
 * qui tranche si les deux venaient à diverger.
 */
export function banRefusal(facts: PlatformRoleFacts): BanRefusal | null {
  return facts.targetIsSuperadmin && facts.superadminCount <= 1 ? 'last_superadmin' : null
}

/**
 * Ce qui empêche de retirer le rôle : le garde-fou ci-dessus, plus le cas d'une
 * cible qui ne le porte pas — un refus que le bannissement, lui, ne connaît pas.
 */
export function revocationRefusal(facts: PlatformRoleFacts): RevocationRefusal | null {
  return facts.targetIsSuperadmin ? banRefusal(facts) : 'not_superadmin'
}

/** La cible d'une action d'administration, telle que le corps la porte. */
export interface AccountTarget {
  readonly userId: string
  /** Le motif d'un bannissement. Absent ou vide : `null`, jamais une chaîne vide. */
  readonly reason: string | null
}

const targetSchema = z.object({
  userId: z.string().trim().min(1),
  reason: z.string().optional(),
})

/**
 * **Zod à la frontière** (`docs/security.md` §4) : le corps entrant n'est pas de
 * confiance.
 *
 * Rend `null` quand le corps ne nomme pas de cible utilisable — la route en
 * fait un 400. La **longueur** du motif n'est pas jugée ici : la colonne qui le
 * porte appartient au module `auth`, et sa borne vit avec elle. Deux bornes
 * divergeraient, et la plus permissive tronquerait en silence.
 */
export function parseAccountTarget(input: unknown): AccountTarget | null {
  const parsed = targetSchema.safeParse(input)

  if (!parsed.success) {
    return null
  }

  const reason = parsed.data.reason?.trim() ?? ''

  return { userId: parsed.data.userId, reason: reason === '' ? null : reason }
}
