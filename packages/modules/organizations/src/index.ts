/**
 * Le module des organisations — **optionnel**, et c'est tout son intérêt.
 *
 * Coupé, l'application est mono-utilisateur : aucune route, aucune entrée de
 * navigation, aucune des quatre tables sur une base vierge, et toute donnée est
 * rattachée directement au compte par `resolveDataOwner` (`@repo/core`), sans
 * qu'un seul appelant change de code.
 *
 * Trois surfaces sortent d'ici, et elles n'ont pas le même public :
 *
 * - le **contrat** (`organizationsModule`) et les **tables**, lus par
 *   `config/features.ts` et par le baril de schéma de s04 ;
 * - la **configuration** (`configureOrganizations`), appelée par le seul point
 *   de composition de l'application, qui possède la connexion à la base et
 *   connaît les routes que le produit se réserve ;
 * - la **présentation**, sur un **second point d'entrée**,
 *   `@repo/module-organizations/presentation` (ADR 024). Aucun `.tsx` n'est
 *   réexporté d'ici : `config/features.ts` est lu par des outils qui ne
 *   compilent pas de JSX.
 */
export { organizationsModule } from './module'
export {
  organization,
  organizationActiveSelection,
  organizationInvitation,
  organizationMember,
  organizationsSchema,
} from './schema'
export {
  configureOrganizations,
  provideOrganizations,
  requireOrganizationsService,
  resetOrganizationsService,
  OrganizationsNotConfiguredError,
  type ConfigureOrganizationsOptions,
  type OrganizationsService,
} from './infrastructure/organizations-runtime'
export type { OrganizationsDatabase } from './infrastructure/drizzle-organization-repositories'
export {
  EMPTY_ORGANIZATIONS_VIEW,
  type InvitationPreview,
  type OrganizationInvitationView,
  type OrganizationMemberView,
  type OrganizationOutcome,
  type OrganizationsUseCases,
  type OrganizationsView,
  type OrganizationSummary,
} from './application/organization-use-cases'
export {
  authorizeOrganization,
  type MembershipRecord,
  type OrganizationAccess,
} from './application/organization-access'
export { MEMBER_JOINED_NOTIFICATION, SoleOwnershipError } from './application/ports'
export type {
  NotifyRecipient,
  OrganizationRepository,
  SeatSync,
  SeatSyncRefusal,
  SeatSyncVerdict,
  SecurityLog,
  SlugOutcome,
} from './application/ports'
export type {
  OrganizationSecurityEvent,
  OrganizationSecurityEventName,
} from './domain/security-event'
export {
  allows,
  assignableRolesFor,
  ORGANIZATION_ACTION,
  ORGANIZATION_ACTIONS,
  permissionsOf,
  type OrganizationAction,
  type OrganizationPermissions,
} from './domain/permissions'
export {
  FOUNDER_ROLE,
  ORGANIZATIONS_MODULE_ID,
  ORGANIZATION_ROLES,
  parseOrganizationDraft,
  type OrganizationRefusal,
  type OrganizationRole,
} from './domain/organization'
export {
  ACCEPT_REFUSALS,
  INVITATION_QUOTA_PER_WINDOW,
  INVITATION_QUOTA_WINDOW_SECONDS,
  INVITATION_REFUSALS,
  INVITATION_SCREEN_PATH,
  INVITED_ROLE,
  refusalForStatus,
  type InvitationRefusal,
  type InvitationStatus,
} from './domain/invitation'
export { invitationEmail } from './emails/invitation'
export {
  acceptRefusalMessageKey,
  ORGANIZATIONS_KEYS,
  ORGANIZATION_REFUSALS,
  organizationsKey,
  organizationsMessageKeys,
  refusalMessageKey,
  roleLabelKey,
} from './domain/message-keys'
export {
  ORGANIZATIONS_SCREEN_PATH,
  organizationRoutePath,
} from './presentation/organization-routes'
