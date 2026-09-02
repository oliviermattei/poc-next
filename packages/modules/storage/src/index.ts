/**
 * Le module de stockage de fichiers — **optionnel**.
 *
 * Trois surfaces sortent d'ici :
 *
 * - le **contrat** (`storageModule`), lu par `config/features.ts` ;
 * - les **règles** du `domain`, que l'application lit pour dériver ce qu'elle
 *   affiche (le plafond de taille, la liste des types acceptés) ;
 * - le **montage** (`provideStorage`), appelé par `apps/web/lib/storage.ts`.
 *
 * Il n'y a **pas** de second point d'entrée de présentation (ADR 024) : ce
 * module ne rend aucun composant React. L'écran qui téléverse vit dans
 * `apps/web`, parce qu'il appelle `fetch` et que `eslint.config.ts` refuse un
 * appel réseau dans un module hors de sa porte bornée — la même raison qui a
 * fait vivre `app/public-form.tsx` et `app/auth-form.tsx` dans l'application.
 */
export { storageModule } from './module'
/**
 * La table, réexportée **à plat** : c'est la seule forme que
 * `drizzle-kit generate` sait lire dans le baril généré (`generated/schema/`),
 * qui n'accepte que des exports de premier niveau.
 */
export { storageFile, storageSchema } from './schema'
export {
  AVATAR_CONTENT_TYPES,
  AVATAR_MAX_BYTES,
  AVATAR_PURPOSE,
  STORAGE_MODULE_ID,
  avatarKeyFor,
  detectImageType,
  keyBelongsTo,
  scopePrefix,
  servedKeyOf,
  validateAvatarUpload,
  validateStoredAvatar,
  type AvatarContentType,
  type AvatarRefusal,
  type FileOwner,
  type KeySpace,
} from './domain/avatar'
export {
  UPLOAD_URL_TTL_SECONDS,
  type AvatarView,
  type StorageRefusal,
  type StorageUseCases,
} from './application/storage-use-cases'
export type { FileRecord, FileRepository } from './application/ports'
export {
  configureStorage,
  provideStorage,
  requireStorageService,
  resetStorageService,
  StorageNotConfiguredError,
  type ConfigureStorageOptions,
  type StorageService,
} from './infrastructure/storage-runtime'
export type { StorageDatabase } from './infrastructure/drizzle-file-repository'
export { fileUrl, storageRoutePath } from './presentation/storage-routes'
