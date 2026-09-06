import { createInngestJobs, createInngestRunner } from '@repo/adapter-inngest'
import { getEnv } from '@repo/config'
import {
  assertJobSchedulesAreValid,
  assertJobsAreRunnable,
  dispatchModuleJob,
  scheduledJobs,
  type JobRetryPolicy,
  type JobRunLedger,
  type ModuleRegistry,
} from '@repo/core'
import { getDatabase } from '@repo/db'
import { createInMemoryJobs, type InMemoryJobs } from '@repo/jobs-testing'
import { createDrizzleJobLedger, JOBS_CALLBACK_PATH, provideJobs } from '@repo/module-jobs'
import { provideRateLimiter } from '@repo/module-rate-limit'
import type { EmitJobResult, JobEmission, Jobs, JobsLogRecord } from '@repo/ports'

import { enabledModules } from '../../../config/features'
import { JOBS_APP_ID, resolveJobsConfig } from './jobs-config'
import { moduleRegistry } from './module-registry'
import { appRateLimiter } from './rate-limit'

/**
 * **Le point de composition des tâches de fond** (s33) — le seul fichier de
 * l'application qui connaisse à la fois Inngest, l'exécuteur en mémoire, le
 * registre et la base.
 *
 * Le code métier ne connaît que le port `Jobs` (`@repo/ports`) et la clé `jobs`
 * du contrat de module. Il ne saura jamais lequel des trois chemins l'exécute,
 * et c'est exactement ce que le port existe pour garantir.
 *
 * **Trois chemins, et ils se choisissent sur la configuration, jamais sur
 * `NODE_ENV`** :
 *
 * | | `jobs` activé, clé Inngest | `jobs` activé, `JOBS_LOCAL_RUNNER=1` | `jobs` coupé |
 * |---|---|---|---|
 * | émission | mise en file chez le fournisseur | file en mémoire, vidée hors requête | **exécutée synchrone dans la requête** |
 * | tâches planifiées | déclenchées par le fournisseur | par la boucle locale | **ne s'exécutent pas** |
 * | déduplication | `job_run` (partagée entre instances) | en mémoire du processus | **aucune** |
 * | route de rappel | montée, gardée par la signature | 404 | **404, elle n'existe pas** |
 * | démarrage | valide les clés | valide l'opt-in | **le journalise** |
 *
 * Le repli du module coupé n'est pas un confort : l'export de ses données
 * (s35) est une obligation légale du socle et orchestre sa construction par
 * tâche — `auth.data-export`. Sans repli, couper les jobs supprimerait un
 * droit ; `tests/data-export.test.ts` mesure les deux régimes du module,
 * `tests/jobs.test.ts` celui de ce fichier.
 */

/** Le module est-il activé ? La configuration décide, pas un `if` épars. */
const mounted = (enabledModules as readonly string[]).includes('jobs')

/**
 * **La politique de reprise de l'application**, et elle est ici parce qu'elle
 * est un choix de produit, pas une constante d'adapter.
 *
 * Trois tentatives : la première absorbe le hoquet, la troisième dit que ce
 * n'en était pas un. Le recul part de 500 ms et plafonne à 30 s — une tâche de
 * fond n'a pas d'appelant qui attend, contrairement au mailer, dont le budget
 * est celui d'une requête.
 *
 * Elle ne s'applique **jamais** à une erreur définitive : `dispatchModuleJob`
 * lit le code, et `docs/reliability.md` §3 interdit de rejouer une validation.
 */
const RETRY: JobRetryPolicy = { maxAttempts: 3, baseMs: 500, maxMs: 30_000 }

/**
 * Le journal d'exécution.
 *
 * La forme est fermée par `JobsLogRecord` : il n'y a aucun champ où mettre une
 * charge utile, une clé de fournisseur ou une adresse (`docs/security.md` §5).
 * Le port de monitoring arrive en s39 ; d'ici là, la sortie du processus est le
 * journal.
 */
const logJob = (record: JobsLogRecord): void => {
  const line =
    `[${record.event}] ${record.job} key=${record.key} attempt=${record.attempt}` +
    (record.code === null ? '' : ` code=${record.code} ${record.message ?? ''}`)

  if (record.event === 'job.failed' || record.event === 'job.emit_failed') {
    console.error(line)
  } else {
    console.info(line)
  }
}

/**
 * Le registre d'exécutions, **ouvert au premier besoin et pas avant**.
 *
 * Ouvrir la base à l'import la ferait ouvrir pendant `pnpm build`, qui n'a ni
 * `DATABASE_URL` ni raison d'en avoir une — la même indirection que le compteur
 * de limitation.
 */
const deferredLedger: JobRunLedger = {
  claim: async (input) => await createDrizzleJobLedger({ db: getDatabase().db }).claim(input),
  release: async (input) => await createDrizzleJobLedger({ db: getDatabase().db }).release(input),
}

/**
 * Le répartiteur de l'application : registre, journal, reprise, déduplication.
 *
 * `ledger` n'est passé que si le module est activé — coupé, il n'y a pas de
 * table pour tenir la déduplication, et c'est une garantie en moins, dite plutôt
 * que sous-entendue.
 */
const dispatch = async (
  emission: JobEmission,
  registry: ModuleRegistry = moduleRegistry,
): Promise<ReturnType<typeof dispatchModuleJob>> =>
  await dispatchModuleJob({
    registry,
    emission,
    ledger: mounted ? deferredLedger : undefined,
    log: logJob,
    retry: RETRY,
    now: () => new Date(),
  })

/**
 * **Le repli du module coupé** : l'émission s'exécute dans la requête appelante.
 *
 * **Le précédent qu'annonçait s33 n'existait pas** — et il existe maintenant.
 * Cette phrase promettait en s33 que « `purgeModules` et `exportModules` sont
 * synchrones depuis s03, et exécutées » ; à l'écriture de s33, ni l'une ni
 * l'autre n'avait d'appelant hors des tests. Les deux clés sont branchées
 * depuis :
 *
 * - `purgeModules` par **s34**, en deux points de composition — la suppression
 *   de compte (`lib/auth.ts`, `purgeScope`) et celle d'une organisation
 *   (`lib/organizations.ts`). **Deux appelants, un par périmètre du contrat** :
 *   en ajouter un troisième pour le même périmètre purgerait deux fois ;
 * - `exportModules` par **s35**, à travers `buildDataExportArchive`
 *   (`lib/auth.ts`, `collectArchive`).
 *
 * Le balayage qui le dit : `purgeModules|exportModules` sur `apps/` et
 * `packages/`, hors tests.
 *
 * Et c'est s35 qui **dépend** de ce repli : la construction d'une archive est
 * émise comme tâche (`auth.data-export`), donc module `jobs` coupé, elle
 * s'exécute ici, dans la requête appelante — un export est une obligation
 * légale du socle, il ne disparaît pas avec un module optionnel.
 *
 * Ce que ce repli ajoute, c'est qu'il **borne son coût** — une seule
 * tentative, sans reprise et sans attente : la requête d'un
 * utilisateur n'a pas à payer trois tentatives et trente secondes de recul pour
 * une tâche que le fournisseur aurait reprise hors ligne. C'est la réserve que
 * la revue de s32 a posée sur sa boucle d'émission synchrone : un repli ne doit
 * pas être plus coûteux que ce qu'il remplace.
 */
const synchronousJobs: Jobs = {
  emit: async (emission: JobEmission): Promise<EmitJobResult> => {
    const outcome = await dispatchModuleJob({
      registry: moduleRegistry,
      emission,
      log: logJob,
      retry: { maxAttempts: 1, baseMs: 0, maxMs: 0 },
      now: () => new Date(),
    })

    return outcome.ok
      ? { ok: true, id: `${emission.job}:${emission.key}` }
      : { ok: false, error: outcome.error }
  },
}

let local: InMemoryJobs | null = null
let jobs: Jobs | null = null

/** L'exécuteur en mémoire, construit une fois. */
const localRunner = (): InMemoryJobs => {
  local ??= createInMemoryJobs({
    registry: moduleRegistry,
    log: logJob,
    retry: RETRY,
    now: () => new Date(),
  })

  return local
}

/**
 * **Le port, tel que le code métier l'appelle.**
 *
 * Construit au premier appel, jamais à l'import : lire l'environnement à
 * l'import le ferait lire pendant `pnpm build`.
 */
export function appJobs(): Jobs {
  if (jobs !== null) {
    return jobs
  }

  if (!mounted) {
    jobs = synchronousJobs

    return jobs
  }

  const config = resolveJobsConfig(getEnv())

  jobs =
    config.kind === 'local'
      ? localRunner().jobs
      : createInngestJobs({
          eventKey: config.eventKey,
          declared: scheduledJobs(moduleRegistry).map((entry) => entry.id),
          ...(config.baseUrl === null ? {} : { baseUrl: config.baseUrl }),
          log: logJob,
        })

  return jobs
}

/**
 * La garde de démarrage, **deux moitiés** — appelée par `lib/startup.ts` :
 *
 * - le **plancher** : les modules activés déclarent au moins une tâche, aucune
 *   n'est déclarée deux fois, et chaque expression cron est lisible. Sans lui,
 *   l'ordonnanceur démarrerait sur un tableau vide et tournerait à vide en
 *   silence — c'est-à-dire exactement l'état que cette story corrige ;
 * - la **configuration** : une clé de fournisseur ou l'opt-in local, jamais ni
 *   l'un ni l'autre.
 *
 * Module coupé, elle **journalise le repli** au lieu de refuser (critère 8).
 */
export function assertJobsConfiguration(env?: Parameters<typeof resolveJobsConfig>[0]): void {
  // **Les déclarations d'abord, dans toutes les configurations.** Un doublon
  // d'identifiant ou une expression cron illisible est un défaut que le module
  // `jobs` soit activé ou non — et `pnpm test:minimal-profile`, qui le coupe,
  // les laissait passer tant qu'ils vivaient derrière le plancher.
  assertJobSchedulesAreValid(scheduledJobs(moduleRegistry))

  if (!mounted) {
    console.info(
      '[jobs.disabled] Le module « jobs » est coupé : les tâches planifiées ne s’exécutent ' +
        'pas, et l’émission d’une tâche s’exécute de façon synchrone dans la requête appelante.',
    )

    return
  }

  assertJobsAreRunnable(scheduledJobs(moduleRegistry))

  if (env !== undefined) {
    resolveJobsConfig(env)
  }
}

/**
 * Donne aux modules ce qu'ils ne peuvent pas se procurer **avant** qu'une tâche
 * ne tourne.
 *
 * Deux choses, et la première est la raison d'être de la story : le compteur de
 * limitation, sans lequel `rate-limit.sweep-closed-windows` — déclarée depuis
 * s28, jamais exécutée — n'aurait toujours pas de corps ; et le gestionnaire de
 * rappel du fournisseur, sans lequel la route `/api/modules/jobs/inngest`
 * répondrait 404 alors qu'Inngest l'appelle.
 */
export function prepareJobs(): void {
  provideRateLimiter(() => appRateLimiter())

  if (!mounted) {
    return
  }

  provideJobs(() => {
    const config = resolveJobsConfig(getEnv())

    // La connexion est **reçue** par le module, jamais construite par lui
    // (ADR 020) : elle sert sa seule tâche, le balayage de `job_run`. Elle est
    // résolue ici, à l'intérieur de la fabrique, donc jamais à l'import.
    const db = getDatabase().db

    if (config.kind === 'local') {
      // Aucun rappel : l'exécuteur local n'a pas de fournisseur qui appelle. La
      // route répond 404, comme celle d'un module coupé.
      return { callback: null, db }
    }

    return {
      db,
      callback: createInngestRunner({
        appId: JOBS_APP_ID,
        servePath: `/api/modules${JOBS_CALLBACK_PATH}`,
        jobs: scheduledJobs(moduleRegistry).map((entry) => ({
          id: entry.id,
          schedule: entry.job.schedule,
        })),
        dispatch: async (emission) => await dispatch(emission),
        eventKey: config.eventKey,
        signingKey: config.signingKey,
        ...(config.baseUrl === null ? {} : { baseUrl: config.baseUrl }),
      }),
    }
  })
}

/**
 * **La boucle de l'exécuteur local** — le seul ordonnanceur que ce dépôt
 * embarque.
 *
 * Une minute, parce que c'est la granularité d'une expression cron : plus
 * souvent ne trouverait rien de plus, moins souvent manquerait des échéances.
 * Elle n'existe **que** dans le mode local ; avec le fournisseur, c'est lui qui
 * tient les horloges, et deux ordonnanceurs feraient deux exécutions.
 *
 * Le minuteur est `unref` : il ne doit jamais tenir un processus en vie à lui
 * seul — un script qui migre puis rend la main ne doit pas rester bloqué sur une
 * boucle de tâches.
 *
 * **Ce que cette boucle ne garantit pas, et il faut le savoir avant d'y
 * compter** (constat F9 de la revue) : `setInterval` **dérive**. Il replanifie
 * à partir de la fin du battement précédent, pas sur une horloge murale, et une
 * boucle d'événements bloquée au-delà d'une minute — un rendu lourd, une
 * migration, un ramasse-miettes long — fait **sauter** l'occurrence cron de
 * cette minute-là, en silence : `cronMatches` est évalué à la minute, et la
 * minute manquée ne sera pas rejouée. C'est l'une des deux raisons pour
 * lesquelles `docs/deployment.md` réserve ce mode à un déploiement à une seule
 * instance et le présente comme un mode de développement ; le fournisseur, lui,
 * tient ses horloges hors du processus.
 */
export function startLocalJobScheduler(): (() => void) | null {
  if (!mounted || resolveJobsConfig(getEnv()).kind !== 'local') {
    return null
  }

  const runner = localRunner()
  const timer = setInterval(() => void runner.tick(new Date()), 60_000)

  timer.unref?.()

  return () => clearInterval(timer)
}

/** Réservé aux suites de tests : rend le point de composition reconstructible. */
export function resetAppJobs(): void {
  jobs = null
  local = null
}
