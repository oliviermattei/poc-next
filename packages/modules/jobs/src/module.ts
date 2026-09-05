import { defineModule, type ModuleJob } from '@repo/core'

import { JOBS_MODULE_ID } from './domain/job-run'
import { JOB_RUN_RETENTION_DAYS, sweepJobRuns } from './infrastructure/drizzle-job-ledger'
import { requireJobsCallback, requireJobsDatabase } from './infrastructure/jobs-runtime'
import enMessages from './messages/en.json' with { type: 'json' }
import frMessages from './messages/fr.json' with { type: 'json' }
import { createJobRoutes } from './presentation/job-routes'
import { jobsSchema } from './schema'

/**
 * Le contrat du module `jobs` (s33), rempli — les quinze clés.
 *
 * **Un module sans écran et sans navigation** : ce qu'il apporte n'est pas une
 * fonctionnalité du produit, c'est le registre d'exécutions et la route par
 * laquelle le fournisseur rappelle. Il est ici, et non dans le socle, pour la
 * raison qui fait exister le contrat : le dépôt n'a **qu'un** mécanisme pour
 * qu'une table ait un propriétaire, une migration et un journal de migration.
 *
 * **Il est optionnel, et c'est le critère 8 de la story.** Coupé, l'émission
 * s'exécute de façon **synchrone dans la requête appelante**, les tâches
 * planifiées ne s'exécutent pas, et le démarrage le journalise
 * (`apps/web/lib/jobs.ts`). Ce repli n'est pas un confort : la suppression de
 * compte (s34) et l'export (s35) sont des obligations légales du socle et
 * orchestrent leurs traitements par job — sans repli, couper les jobs
 * supprimerait un droit.
 *
 * **Il déclare exactement une tâche : le balayage de son propre registre
 * d'exécutions.** Rien d'autre — il *exécute* celles des autres modules, il n'en
 * possède qu'une. Et celle-là n'est pas optionnelle : sans elle, `job_run`
 * croîtrait sans borne, c'est-à-dire que cette story rejouerait sur une table
 * neuve le défaut exact qu'elle corrige sur `rate_limit_window`, où une tâche
 * déclarée sans consommateur laissait le magasin grossir jusqu'à casser la
 * suite de parcours.
 *
 * **Aucune catégorie de données.** `run` est un condensat (voir `schema.ts`) :
 * aucune requête ne peut relier une de ces lignes à un compte. Il n'y a donc
 * rien à purger ni à exporter — les fonctions sont là, vides, parce que le
 * contrat les exige de tous (ADR 007).
 */
/**
 * **Le balayage du registre d'exécutions.**
 *
 * `03:25` UTC, tous les jours, et les deux moitiés de l'échéance se justifient :
 *
 * - **quotidien**, parce que la rétention se compte en jours
 *   (`JOB_RUN_RETENTION_DAYS`) : passer plus souvent n'effacerait rien de plus,
 *   passer plus rarement laisserait la table dépasser sa fenêtre du délai qui
 *   sépare deux passages ;
 * - **minute 25**, parce qu'elle n'est multiple d'aucun pas déclaré dans ce
 *   dépôt — le seul est de dix minutes : cette tâche ne tombe donc jamais dans la même
 *   minute que le balayage des fenêtres closes, et les deux ne se disputent pas
 *   la base. L'heure creuse, elle, est la convention usuelle et rien de plus.
 *
 * Elle ne construit rien : la connexion est **reçue** du point de composition
 * (`requireJobsDatabase`, ADR 020), comme le compteur l'est à `rate-limit`.
 */
const sweepClosedRuns: ModuleJob = {
  id: 'sweep-job-runs',
  schedule: '25 3 * * *',
  run: async ({ now }) => {
    await sweepJobRuns({
      db: requireJobsDatabase(),
      before: new Date(now.getTime() - JOB_RUN_RETENTION_DAYS * 24 * 60 * 60 * 1_000),
    })
  },
}

export const jobsModule = defineModule({
  id: JOBS_MODULE_ID,
  requires: [],
  schema: jobsSchema,
  migrations: 'packages/modules/jobs/migrations',
  routes: createJobRoutes(requireJobsCallback),
  navigation: [],
  /**
   * Aucune URL publique : ce module ne publie pas de page indexable (s53).
   *
   * Déclaré vide, jamais omis — le compilateur refuse l'omission
   * (`tests/fixtures/typing/missing-public-urls.ts`).
   */
  publicUrls: () => [],
  messages: { fr: frMessages, en: enMessages },
  emails: [],
  webhooks: [],
  jobs: [sweepClosedRuns],
  dataCategories: [],
  retention: {},
  purge: async () => {},
  export: async () => ({}),
})
