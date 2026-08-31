import type { OrganizationRole } from '../domain/organization'

/**
 * **Le porteur d'accès à une organisation, et il ne se fabrique pas.**
 *
 * **Ce qu'il garde, exactement.** La formulation d'origine — « la forme qui
 * rend l'oubli du périmètre organisationnel impossible » — était trop large, et
 * la revue de s15 l'a mesurée : elle est vraie des **écritures** qui exigent un
 * `OrganizationAccess`, et fausse d'une **lecture** neuve, qu'aucune commande
 * n'arrêtait. Les lectures sont désormais gardées ailleurs, par une porte
 * unique (`infrastructure/scoped-reads.ts`) que `pnpm lint` impose. Ce fichier
 * garde les écritures, et rien d'autre.
 *
 * Toute écriture qui touche une organisation exige un
 * `OrganizationAccess` ; la seule façon d'en obtenir un est
 * `authorizeOrganization`, qui exécute la lecture conjointe
 * « cette organisation **et** ce membre ». Un identifiant venu du corps de la
 * requête n'est pas un `OrganizationAccess` et ne peut pas le devenir : la
 * marque de type ci-dessous n'est **pas exportée**, donc aucun autre fichier du
 * dépôt ne peut écrire la valeur.
 *
 * La règle est **exécutable** : `pnpm typecheck` échoue. La fixture
 * `tests/fixtures/typing/forged-organization-access.ts` fabrique un accès à la
 * main et **doit** être refusée ; `tests/module-registry.test.ts` lit le
 * diagnostic. Une contrainte de typage que personne n'a vue échouer n'existe
 * pas — c'est déjà la façon dont ce dépôt éprouve les deux contraintes du
 * contrat de module (ADR 007).
 *
 * Pourquoi ce n'est pas une simple convention de nommage : une règle
 * qu'aucune commande ne vérifie est de la documentation (ADR 013). Ici, la
 * commande est le compilateur.
 */
declare const authorizedOrganization: unique symbol

/** Une appartenance, telle que le module la lit. Aucun jeton, aucun secret. */
export interface MembershipRecord {
  readonly organizationId: string
  readonly userId: string
  readonly role: OrganizationRole
  readonly name: string
  readonly slug: string
}

export type OrganizationAccess = MembershipRecord & {
  readonly [authorizedOrganization]: true
}

/**
 * Marque une appartenance **lue** comme un accès.
 *
 * Volontairement non exportée, pas même vers les autres fichiers du module :
 * son seul appelant est `authorizeOrganization`. La création d'une organisation
 * ne l'appelle pas non plus — elle **relit** l'appartenance qu'elle vient
 * d'écrire, par la même lecture conjointe. Un accès a donc toujours la même
 * origine, et il n'existe pas de seconde porte à surveiller.
 */
const grantAccess = (membership: MembershipRecord): OrganizationAccess =>
  ({
    organizationId: membership.organizationId,
    userId: membership.userId,
    role: membership.role,
    name: membership.name,
    slug: membership.slug,
  }) as OrganizationAccess

/**
 * L'accès de ce compte à cette organisation, ou `null`.
 *
 * `null` est **la seule information rendue** à qui n'est pas membre : ni
 * l'existence, ni le nom, ni le fait qu'une organisation porte cet identifiant.
 * C'est ce que la route traduit en **404, jamais 403** (`docs/security.md` §3).
 *
 * La lecture est reçue en paramètre plutôt qu'un repository entier : ce fichier
 * n'a pas à connaître le port, et le port peut alors exiger un
 * `OrganizationAccess` sans dépendance circulaire.
 */
export async function authorizeOrganization(
  findMembership: (input: {
    readonly userId: string
    readonly organizationId: string
  }) => Promise<MembershipRecord | null>,
  input: { readonly userId: string; readonly organizationId: string },
): Promise<OrganizationAccess | null> {
  const membership = await findMembership(input)

  return membership === null ? null : grantAccess(membership)
}
