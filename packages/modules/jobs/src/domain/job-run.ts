/** L'identifiant du module — écrit une fois, jamais recopié. */
export const JOBS_MODULE_ID = 'jobs'

/**
 * **Le condensat de l'identité d'une exécution vit dans `infrastructure/`**, pas
 * ici, et c'est la frontière que `pnpm lint` tient (ADR 006) : `node:crypto` est
 * un module de plateforme, et une règle métier n'en connaît aucun. C'est le même
 * placement que la clé de seau de `rate-limit` (s28).
 *
 * Ce fichier ne garde donc que ce qui est vraiment du domaine : le nom du
 * module, dont `module.ts` et le point de composition ont besoin sans traverser
 * une couche.
 */
export {}
