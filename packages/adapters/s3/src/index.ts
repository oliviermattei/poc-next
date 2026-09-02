/**
 * L'unique implémentation livrée du port `Storage` (ADR 008) — S3 et toute API
 * compatible (Cloudflare R2, MinIO, DigitalOcean Spaces).
 *
 * La surface publique est la fabrique, et rien d'autre : le classement des
 * erreurs, le recul et l'assainissement des messages sont des détails de cet
 * adapter, éprouvés chez eux. Les exporter inviterait un appelant à s'en servir
 * — et le port cesserait d'être la seule surface appelée par le code métier.
 *
 * Le stockage sur disque — l'outil de développement qui rend le port utilisable
 * sans aucune clé (`docs/reliability.md` §2) — vit dans `@repo/storage-testing`.
 * Ce n'est pas un second fournisseur : rien là-bas ne parle à un service tiers.
 */
export { createS3Storage, type S3StorageOptions } from './s3-storage'
