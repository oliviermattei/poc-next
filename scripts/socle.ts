import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readEnabledModules } from '@repo/cli'
import { loadRootEnv } from '@repo/config/server'
import { createDatabaseClient } from '@repo/db'
import { sql } from 'drizzle-orm'

import { humanDuration } from '../e2e/support/steps'
import { availableModules, enabledModules, requiredModules } from '../config/features'
import { bootstrapEnvFile, freshDatabaseUrl } from './golden-path-regime'
import {
  assertProfileWasApplied,
  assertWorkingTreeUnchanged,
  cloneEnvironment,
  CLONE_STRIPPED_ENV_KEYS,
} from './minimal-profile-rules'
import {
  cutModulesOfSocle,
  SOCLE_MATRIX_VALUE,
  SOCLE_STEP_DISPOSITION,
  socleJobPlan,
} from './socle-rules'

/**
 * `pnpm test:socle` — **la moitié de la matrice de CI qui n'était jouable nulle
 * part ailleurs** (s48).
 *
 * `.github/workflows/ci.yml` joue deux configurations : `tous`, celle du dépôt,
 * et `socle`, où tout ce qui est optionnel est coupé. La seconde n'était
 * reproductible que sur un runner — et une CI rouge cinq commits durant, dont
 * l'unique cause vivait dans cette branche-là, s'est constatée après le push
 * plutôt qu'avant.
 *
 * `pnpm test:minimal-profile` ne la remplace pas : elle joue le profil de
 * `config/profiles.ts`, qui coupe **un autre ensemble** de modules (mesuré à la
 * recherche de s48 : deux modules d'écart avec la CI). Deux configurations
 * distinctes, et les confondre serait un vert qui ne dit rien.
 *
 * ## Ce qu'elle fait, dans l'ordre — celui de la CI
 *
 * 1. **dérive du fichier de workflow** les modules coupés, et les confronte à
 *    l'annuaire avant qu'une seule commande ne soit lancée
 *    (`scripts/socle-rules.ts`) ;
 * 2. **clone** le dépôt dans un répertoire temporaire, y recopie l'état du plan
 *    de travail, y pose un `.env` dérivé de `.env.example` ;
 * 3. **coupe les modules par le CLI**, `pnpm ks toggle` un par un, exactement
 *    comme l'étape gardée du workflow — le CLI refuse une coupure qui casserait
 *    un requis, et son refus est un vrai constat ;
 * 4. **relit ce que la copie active réellement** : tout ce qui suit est dérivé
 *    du registre monté dans la copie, donc vrai de lui-même ;
 * 5. **joue les étapes du job**, telles qu'elles sont écrites dans le workflow et
 *    dans son ordre, sur une base **créée pour cette exécution**. La liste n'est
 *    pas écrite ici : elle est dérivée du fichier, comme les bascules.
 *
 * ## Ce qu'elle rejoue, et ce qu'elle exclut
 *
 * Chaque étape `run:` du job gardé est **soit rejouée, soit exclue avec sa
 * raison écrite** (`SOCLE_STEP_DISPOSITION`, `scripts/socle-rules.ts`), et une
 * étape que la répartition ne classe pas fait échouer la commande en la nommant.
 * C'est le correctif du constat majeur de la revue de s48 : la liste des
 * commandes était alors écrite en dur — six étapes rejouées sur les treize que
 * le job déclare aujourd'hui, cinq passées sous silence dont les parcours
 * navigateur et l'audit —, et rien ne rougissait quand le job en gagnait une.
 *
 * La commande **journalise ce qu'elle exclut, et pourquoi**, à côté de ce qu'elle
 * a mesuré — l'idiome de `pnpm test:golden-path`. Aucune liste n'est recopiée
 * dans ce commentaire : la lire, c'est lancer la commande ou ouvrir la
 * répartition.
 *
 * Deux étapes rejouées écrivent dans `/tmp` (la photographie de l'arbre et sa
 * comparaison), parce que c'est ce que le workflow écrit : deux exécutions
 * simultanées sur la même machine se marcheraient dessus. Ce sont les seules
 * écritures hors de la copie, et elles portent sur l'arbre **de la copie**,
 * `git` étant lancé dedans.
 *
 * ## Pourquoi une copie, et pas l'arbre courant
 *
 * Parce que couper un module réécrit `config/features.ts` et `generated/`, tous
 * suivis par git. La CI peut se le permettre : son arbre est jetable, et elle le
 * photographie juste après la bascule pour comparer à **cet** état. Un poste de
 * développement, non — une commande interrompue laisserait le dépôt basculé,
 * et ADR 041 interdit précisément les écritures pilotées par agent sur un arbre
 * sale. L'arbre est donc comparé avant et après, échec et interruption compris.
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

const WORKFLOW_PATH = fileURLToPath(new URL('../.github/workflows/ci.yml', import.meta.url))

const run = (
  command: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string | undefined>,
): void => {
  execFileSync(command, [...args], { cwd, env: env as NodeJS.ProcessEnv, stdio: 'inherit' })
}

/**
 * Une étape du job, jouée **telle qu'elle est écrite** : un shell, parce que
 * les `run:` du workflow en sont un (redirection, `if`, `&&`). `-e` reproduit
 * le `bash -e` de GitHub, sans quoi un bloc de plusieurs lignes continuerait
 * après un échec.
 */
const runShell = (
  script: string,
  cwd: string,
  env: Record<string, string | undefined>,
): void => {
  execFileSync('sh', ['-e', '-c', script], {
    cwd,
    env: env as NodeJS.ProcessEnv,
    stdio: 'inherit',
  })
}

const gitLines = (args: readonly string[]): string[] =>
  execFileSync('git', [...args], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

const workingTree = (): readonly string[] => gitLines(['status', '--porcelain'])

/**
 * Le clone, **plus l'état du plan de travail** — repris tel quel de
 * `scripts/minimal-profile.ts` : `git clone` ne connaît que `HEAD`, et sur une
 * branche en cours d'écriture il mesurerait le code d'avant.
 */
const cloneRepository = (destination: string): number => {
  run('git', ['clone', '--local', '--no-hardlinks', REPO_ROOT, destination], REPO_ROOT, process.env)

  const changed = gitLines(['ls-files', '--modified', '--others', '--exclude-standard'])
  const deleted = new Set(gitLines(['ls-files', '--deleted']))

  for (const file of deleted) {
    rmSync(join(destination, file), { force: true })
  }

  for (const file of changed) {
    if (deleted.has(file)) continue

    mkdirSync(dirname(join(destination, file)), { recursive: true })
    cpSync(join(REPO_ROOT, file), join(destination, file))
  }

  return changed.length - deleted.size
}

const withMaintenanceConnection = async (
  databaseUrl: string,
  statement: string,
): Promise<void> => {
  const connection = createDatabaseClient({
    connectionString: freshDatabaseUrl(databaseUrl, 'postgres'),
  })

  try {
    await connection.db.execute(sql.raw(statement))
  } finally {
    await connection.close()
  }
}

const main = async (): Promise<void> => {
  // **La dérivation d'abord** : un workflow qui ne coupe rien, ou qui nomme un
  // module que l'annuaire ignore, échoue ici en une seconde plutôt qu'après un
  // clone et une installation complète.
  const cut = cutModulesOfSocle({
    workflow: readFileSync(WORKFLOW_PATH, 'utf8'),
    available: [...availableModules],
    required: [...requiredModules],
  })

  // **Les étapes du job, dérivées du même fichier que les bascules.** Écrite en
  // dur, cette liste ne rougissait pas quand le job en gagnait une — la commande
  // promettait alors plus large que sa couverture (revue de s48).
  const job = socleJobPlan({
    workflow: readFileSync(WORKFLOW_PATH, 'utf8'),
    disposition: SOCLE_STEP_DISPOSITION,
  })

  const expected = enabledModules.filter((id) => !cut.includes(id))

  console.log(
    `Configuration ${JSON.stringify(SOCLE_MATRIX_VALUE)} dérivée de .github/workflows/ci.yml : ` +
      `${cut.length} module(s) coupé(s) — ${cut.join(', ')} —, ${expected.length} activé(s), ` +
      `${job.executed.length} étape(s) du job rejouée(s), ${job.excluded.length} exclue(s).`,
  )

  loadRootEnv()

  const ambient = process.env.DATABASE_URL

  if (ambient === undefined || ambient === '') {
    throw new Error(
      'DATABASE_URL n’est pas connue : la commande crée sa base vierge sur le serveur du dépôt, ' +
        'elle ne devine pas où celui-ci écoute.',
    )
  }

  const before = workingTree()
  const name = `socle_${Date.now()}`
  const databaseUrl = freshDatabaseUrl(ambient, name)
  const workspace = mkdtempSync(join(tmpdir(), 'socle-'))
  const clone = join(workspace, 'clone')

  const started = Date.now()

  let failure: unknown

  try {
    const overlaid = cloneRepository(clone)

    console.log(
      overlaid === 0
        ? 'Clone local de HEAD, arbre propre : aucun fichier recopié par-dessus.'
        : `Clone local de HEAD, plus ${overlaid} fichier(s) du plan de travail recopiés par-dessus.`,
    )

    writeFileSync(
      join(clone, '.env'),
      bootstrapEnvFile(readFileSync(join(clone, '.env.example'), 'utf8'), databaseUrl),
      'utf8',
    )

    // Le clone n'hérite d'aucune variable d'application du poste : `loadRootEnv`
    // ci-dessus a versé le `.env` du poste dans ce processus, et le transmettre
    // recouvrirait exactement ce que la commande éprouve.
    const cloneEnv = cloneEnvironment(process.env, {
      databaseUrl,
      appKeys: CLONE_STRIPPED_ENV_KEYS,
    })

    await withMaintenanceConnection(ambient, `create database "${name}"`)

    run('pnpm', ['install', '--frozen-lockfile'], clone, cloneEnv)

    // **La bascule par le CLI**, un module à la fois et dans l'ordre du
    // workflow : `pnpm ks toggle` refuse une coupure qui laisserait un requis en
    // l'air, et restaure la configuration quand la régénération échoue.
    for (const id of cut) {
      run('pnpm', ['ks', 'toggle', id], clone, cloneEnv)
    }

    // **Ce que la copie active réellement, relu sur son disque.** Sans cette
    // confrontation, tout ce qui suit serait dérivé du registre monté dans la
    // copie, donc vrai de lui-même — un module resté activé ne ferait broncher
    // aucune commande.
    assertProfileWasApplied({
      profileId: SOCLE_MATRIX_VALUE,
      expected,
      actual: readEnabledModules(readFileSync(join(clone, 'config', 'features.ts'), 'utf8')),
    })

    // **Le contrôle qui arrive tôt** : une commande qui écrirait dans l'arbre de
    // travail plutôt que dans la copie doit le dire ici, et non au bout du
    // build.
    assertWorkingTreeUnchanged(before, workingTree())

    const bootstrapMs = Date.now() - started
    const jobStarted = Date.now()

    // L'ordre est celui du job de CI, et il n'est pas indifférent : `db:generate`
    // avant `db:migrate`, les deux avant `pnpm test` dont trois cas interrogent
    // une vraie base, et la comparaison d'arbre **après** les parcours, parce que
    // c'est `next dev` qui réécrit `apps/web/AGENTS.md` et `next-env.d.ts`.
    for (const step of job.executed) {
      console.log('')
      console.log(`— ${step.name}`)

      runShell(step.run, clone, cloneEnv)
    }

    console.log('')
    console.log(
      [
        `Configuration ${JSON.stringify(SOCLE_MATRIX_VALUE)} — durées mesurées`,
        `  amorçage (clone, .env, install, bascules) : ${humanDuration(bootstrapMs)}`,
        `  étapes du job (${job.executed.map((step) => step.name).join(', ')}) : ${humanDuration(
          Date.now() - jobStarted,
        )}`,
        '',
        'Ce que la mesure exclut : le cache pnpm est laissé chaud et le serveur PostgreSQL est déjà',
        'démarré — seule la **base** est créée par la commande.',
        '',
        // **Ce que la commande ne rejoue pas, et pourquoi.** Journalisé plutôt
        // qu'écrit dans une documentation qui vieillirait à côté : c'est la même
        // répartition qui décide de l'exécution et de cette liste, donc l'une ne
        // peut pas mentir sur l'autre.
        `Ce que cette exécution n’a pas rejoué du job (${job.excluded.length} étape(s) sur ` +
          `${job.executed.length + job.excluded.length}) :`,
        ...job.excluded.map((entry) => `  - « ${entry.step.name} » : ${entry.reason}`),
      ].join('\n'),
    )
  } catch (error) {
    failure = error
  } finally {
    rmSync(workspace, { recursive: true, force: true })
    // La base part avec le répertoire : une exécution qui laisserait la sienne
    // derrière elle rendrait « base vierge » faux à la trentième exécution.
    await withMaintenanceConnection(
      ambient,
      `drop database if exists "${name}" with (force)`,
    ).catch((error: unknown) => {
      console.warn(`La base ${name} n’a pas pu être supprimée : ${String(error)}`)
    })
  }

  // **Le dernier mot est pour l'arbre de travail**, échec compris : c'est ce qui
  // distingue une commande qui travaille dans une copie d'une commande qui le
  // dit. Journalisé plutôt que levé quand la commande a déjà échoué : une
  // exception posée par-dessus une autre remplacerait la cause par sa
  // conséquence.
  try {
    assertWorkingTreeUnchanged(before, workingTree())
  } catch (error) {
    if (failure === undefined) {
      throw error
    }

    console.error(String(error))
  }

  if (failure !== undefined) {
    throw failure
  }
}

await main()
