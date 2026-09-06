/**
 * Le module d'administration de la plateforme (s37a).
 *
 * Deux surfaces sortent d'ici, et elles n'ont pas le même public :
 *
 * - le **contrat** (`adminModule`) et la **table**, lus par
 *   `config/features.ts` et par le baril de schéma de s04 ;
 * - la **configuration** (`configureAdmin`), appelée par le seul point de
 *   composition de l'application, qui possède la connexion à la base et le
 *   module `auth`.
 *
 * Ce baril ne réexporte aucun `.tsx` (ADR 024) : `config/features.ts` est lu
 * par `pnpm db:generate`, `pnpm ks` et le typecheck de `@repo/db`, dont aucun
 * ne compile de JSX. Les écrans du back-office (s37b) sortiront par un second
 * point d'entrée.
 */
export { adminModule } from './module'
export { adminPlatformRole, adminSchema } from './schema'
export {
  configureAdmin,
  provideAdmin,
  requireAdminService,
  resetAdminService,
  type ConfigureAdminOptions,
} from './infrastructure/admin-runtime'
export { AdminNotConfiguredError, type AdminService } from './application/admin-service'
export type { AdminDatabase } from './infrastructure/drizzle-platform-role-repository'
export type {
  AccountBanOutcome,
  AdminAccount,
  AdminAccountDetail,
  AdminAccountSession,
  AdminAccountsPort,
  AdminMembership,
  AdminOrganization,
  AdminOrganizationMember,
  AdminOrganizationsPort,
  BanAccountOutcome,
  GrantOutcome,
  RevokeOutcome,
} from './application/ports'
export type {
  AdminAccountRow,
  AdminAccountsView,
  AdminAccountView,
  AdminOrganizationsView,
  AdminOrganizationView,
  AdminUseCases,
  BackOfficePage,
  BackOfficeView,
} from './application/admin-use-cases'
export {
  BACK_OFFICE_PAGE_SIZE,
  parseBackOfficeQuery,
  type BackOfficeQuery,
} from './domain/back-office'
export type { AdminSecurityEvent, AdminSecurityLog } from './domain/security-event'
export { SUPERADMIN_ROLE } from './domain/platform-role'
export { ADMIN_USERS_SCREEN_PATH, adminRoutePath } from './presentation/admin-routes'
