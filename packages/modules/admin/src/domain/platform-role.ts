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

/**
 * Ce qui empêche un bannissement. `null` : rien ne l'empêche.
 *
 * `accounts_unavailable` n'est pas décidé par la règle ci-dessous : c'est ce
 * que rend le chemin d'écriture quand l'état des comptes n'a **pas pu être
 * lu** (s37b1). Un décompte de superadmins capables de se connecter demande
 * l'état « banni », qui vit dans le socle derrière un port ; un port en échec
 * ne vaut pas « personne n'est banni », et refuser est le sens fermé.
 */
export type BanRefusal = 'last_superadmin' | 'accounts_unavailable'

/** Ce qui empêche une révocation. `null` : rien ne l'empêche. */
export type RevocationRefusal = BanRefusal | 'not_superadmin'

/**
 * L'état de la plateforme et du compte visé, tel que la base le dit — jamais lu
 * ici : c'est `infrastructure/` qui le lit, **sous le verrou**, et le donne.
 */
export interface PlatformRoleFacts {
  /**
   * Les superadmins **capables d'ouvrir une session** (s37b1), jamais les
   * lignes de rôle.
   *
   * La distinction est toute la dette reportée de `s37a` : un superadmin banni
   * porte encore sa ligne, et le décompte qui la comptait laissait deux
   * séquences de gestes *tous permis* vider la plateforme de ses
   * administrateurs utilisables — un état qu'aucune commande ne répare.
   */
  readonly superadminCount: number
  readonly targetIsSuperadmin: boolean
  /**
   * La cible peut-elle encore ouvrir une session ?
   *
   * Ce qu'elle décide : lui retirer le rôle ou la bannir ne retire **rien** à
   * l'administrabilité quand elle est déjà fermée. Sans ce fait, révoquer le
   * rôle d'un superadmin banni serait refusé « c'est le dernier » alors qu'il
   * n'en est pas un — et le seul geste qui nettoie l'état redouté serait
   * interdit.
   */
  readonly targetCanSignIn: boolean
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
  if (!facts.targetIsSuperadmin || !facts.targetCanSignIn) {
    return null
  }

  return facts.superadminCount <= 1 ? 'last_superadmin' : null
}

/**
 * Ce qui empêche de retirer le rôle : le garde-fou ci-dessus, plus le cas d'une
 * cible qui ne le porte pas — un refus que le bannissement, lui, ne connaît pas.
 */
export function revocationRefusal(facts: PlatformRoleFacts): RevocationRefusal | null {
  return facts.targetIsSuperadmin ? banRefusal(facts) : 'not_superadmin'
}

/**
 * **Le décompte que la désignation regarde** (s37b1).
 *
 * `designatesFirstSuperadmin` reçoit ce nombre, et il compte lui aussi les
 * comptes **capables de se connecter** : le critère dit « tout décompte ». La
 * conséquence est une réparation, pas une commodité — une plateforme dont tous
 * les superadmins sont fermés redevient désignable par `SUPERADMIN_EMAIL`, là
 * où un décompte de lignes l'aurait laissée définitivement muette.
 */
export function signInCapableSuperadmins(input: {
  readonly superadminIds: readonly string[]
  readonly signInBlocked: readonly string[]
}): number {
  const blocked = new Set(input.signInBlocked)

  return input.superadminIds.filter((userId) => !blocked.has(userId)).length
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
