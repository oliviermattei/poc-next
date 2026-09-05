/**
 * Outils de test et de développement du port `Jobs` (s33).
 *
 * **Ce ne sont pas des fournisseurs** (ADR 008). La seule implémentation livrée
 * est Inngest, dans `@repo/adapter-inngest`. Ce que ce package contient ne rend
 * légitime aucun adapter trigger.dev, QStash ou BullMQ : ils sont au cimetière
 * du PRD.
 *
 * Deux outils, deux emplois qu'il ne faut pas confondre :
 *
 * - `createRecordingJobs` est le régime de **CI** — il enregistre, il n'exécute
 *   pas ;
 * - `createInMemoryJobs` est le **mode local** — il exécute, sans clé et sans
 *   service, sur opt-in explicite (`JOBS_LOCAL_RUNNER=1`).
 */
export { createInMemoryJobs, type InMemoryJobs, type InMemoryJobsOptions } from './in-memory-jobs'
export {
  createRecordingJobs,
  type RecordedJobEmission,
  type RecordingJobs,
  type RecordingJobsOptions,
} from './recording-jobs'
