/**
 * Outil de développement du port `Storage`. **Ce n'est pas un fournisseur.**
 *
 * ADR 008 livre une seule implémentation par port, et cette implémentation est
 * S3 / R2 (`packages/adapters/s3`). Rien de ce que contient ce package ne rend
 * légitime un second adapter — parce que rien ici ne parle à un service tiers.
 */
export {
  createLocalDiskStorage,
  localObjectPath,
  LOCAL_UPLOAD_PATH,
  type LocalDiskStorage,
  type LocalDiskStorageOptions,
} from './local-disk-storage'
