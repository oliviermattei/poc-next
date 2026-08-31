import type { OrganizationRole } from '../domain/organization'
import type { MembershipRecord, OrganizationAccess } from './organization-access'

/**
 * Les **ports** du module (ADR 006) : ce dont les cas d'usage ont besoin, dit
 * par eux, sans savoir qui l'implémente. `infrastructure/` les branche sur
 * Drizzle et sur la connexion que le point de composition injecte — ce module
 * n'importe jamais `@repo/db` (ADR 020).
 *
 * **Les deux écritures qui touchent une organisation existante exigent un
 * `OrganizationAccess`**, jamais un identifiant nu. C'est le compilateur qui
 * tient le périmètre organisationnel : passer l'identifiant reçu du client ne
 * compile pas.
 */

/** Ce que rend une écriture dont l'identifiant public peut déjà être pris. */
export type SlugOutcome = 'ok' | 'slug_unavailable'

export interface OrganizationRepository {
  /**
   * L'appartenance de **ce** compte à **cette** organisation, ou `null`.
   *
   * En **un seul ordre**, portant les deux conditions
   * (`organization.id = ? and organization_member.user_id = ?`). Le compte fait
   * partie du prédicat, il n'est pas vérifié avant : une vérification préalable
   * suivie d'une lecture laisse la fenêtre où l'on sert la donnée d'autrui
   * (`docs/security.md` §3, et le précédent de `revokeForUser` dans le module
   * `auth`). Le `null` ne distingue pas « pas membre » de « n'existe pas » — la
   * requête elle-même ne les distingue pas.
   */
  findMembership(input: {
    readonly userId: string
    readonly organizationId: string
  }): Promise<MembershipRecord | null>

  /** Les appartenances du compte, par nom d'organisation. */
  listMemberships(userId: string): Promise<readonly MembershipRecord[]>

  /**
   * Crée l'organisation **et** l'appartenance de son créateur.
   *
   * Les deux ensemble : une organisation sans membre serait une ressource que
   * plus personne ne peut atteindre. L'unicité de l'identifiant public est
   * celle de la **base** — la violation est traduite en `slug_unavailable`,
   * jamais devancée par un `select` (`docs/reliability.md` §1).
   */
  createOrganization(input: {
    readonly organizationId: string
    readonly membershipId: string
    readonly name: string
    readonly slug: string
    readonly userId: string
    readonly role: OrganizationRole
  }): Promise<SlugOutcome>

  /** Renomme l'organisation **à laquelle l'appelant a été autorisé**, et elle seule. */
  renameOrganization(
    access: OrganizationAccess,
    draft: { readonly name: string; readonly slug: string },
  ): Promise<SlugOutcome>

  /** L'organisation courante du compte, ou `null`. Persistée, donc survit à la session. */
  findActiveOrganizationId(userId: string): Promise<string | null>

  /** Pose l'organisation courante. Rejouable : un second appel n'ajoute rien. */
  setActiveOrganization(access: OrganizationAccess): Promise<void>

  /** Efface les appartenances et la sélection courante d'un compte. */
  deleteMembershipsOf(userId: string): Promise<void>

  /** Efface une organisation. Ses appartenances suivent par cascade. */
  deleteOrganization(organizationId: string): Promise<void>

  /** Les membres d'une organisation, pour l'export du périmètre organisation. */
  listMembersOf(organizationId: string): Promise<readonly MembershipRecord[]>
}

export interface OrganizationsDependencies {
  readonly repository: OrganizationRepository
  /**
   * Les identifiants publics que le produit se réserve.
   *
   * **Reçus, jamais écrits ici** : les routes du système sont celles de
   * l'application, pas celles du module. Le point de composition les dérive de
   * la navigation du registre, des langues servies et des écrans de
   * l'application ; `tests/organizations.test.ts` refuse qu'un segment
   * réellement servi manque à l'appel.
   */
  readonly reservedSlugs: ReadonlySet<string>
  /** Fabrique d'identifiants. Injectée : un `domain` ne connaît pas `node:crypto`. */
  readonly generateId: (prefix: string) => string
}
