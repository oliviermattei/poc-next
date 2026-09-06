import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BUILD_ENV_KEYS, ENV_KEYS, type EnvSource } from '@repo/config'
import { findRootEnvPath, loadRootEnv } from '@repo/config/server'

import { humanDuration } from '../e2e/support/steps'
import {
  assertCanaryRan,
  assertSweptFiles,
  sansEnvEnvironment,
  sansEnvVariables,
  SansEnvConfigurationError,
  undeclaredVariables,
  type SuiteFileResult,
} from './sans-env-rules'

/**
 * `pnpm test:sans-env` — **la suite, jouée comme la CI la joue** (s55).
 *
 * ## Le défaut qu'elle attrape
 *
 * Un fichier de `tests/` atteint la configuration d'authentification — par
 * `appAuth()` ou par un point de composition — sans déclarer `AUTH_SECRET` et
 * `APP_URL`. Le `.env` du poste les fournit, le job de CI non : vert chez
 * l'agent, rouge en intégration. C'est arrivé **trois fois en trois stories**
 * (s32 en ronde 3, s34 évitée de justesse, s35 en échec de suite), la règle étant
 * écrite trois fois dans le dépôt. Ce qui manquait n'était pas une quatrième
 * écriture, c'était la commande.
 *
 * ## Ce qu'elle reproduit, et ce qu'elle ne reproduit pas
 *
 * Elle fournit à la suite **ce que le job de CI fournit, ni plus ni moins**,
 * dérivé de `.github/workflows/ci.yml` (`scripts/sans-env-rules.ts`) : une liste
 * recopiée ici vieillirait à côté du workflow, et l'absence *totale* ferait
 * rougir des fichiers corrects — la pire issue, un contrôle bloquant de plus que
 * personne ne regarde (P8).
 *
 * Les **noms** viennent du workflow, les **valeurs** du poste quand il en a une :
 * la base de la CI n'écoute pas ici, et la recopier ferait sauter les cas
 * d'intégration, donc mesurer plus étroit que la CI.
 *
 * Ce qu'elle **ne** mesure **pas** : un sous-processus lancé par un cas
 * (`pnpm ks`, ESLint, `drizzle-kit`) relit le disque avec son propre `node:fs` et
 * y retrouve le `.env` — son environnement, lui, est bien celui du régime ; un
 * lecteur qui prendrait `node:fs` par un import ESM nommé ne verrait pas le
 * retrait, qui porte sur la vue CommonJS, celle de `dotenv`
 * (`scripts/sans-env-rules.ts`) ; et elle tourne sur le poste, pas sur un runner
 * Ubuntu.
 *
 * ## Pourquoi elle n'est pas dans la CI
 *
 * Parce que **la CI est déjà ce régime** : son job ne pose aucun `.env`, il
 * n'apporte que son bloc `env:`, et `pnpm test` y est donc exactement ce que
 * cette commande joue ici. L'y ajouter rejouerait la suite entière pour mesurer
 * ce que l'étape d'à côté mesure déjà, deux fois par matrice. C'est une commande
 * de diagnostic **local** : elle rend constatable avant le push ce que la CI
 * constatait après.
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

const WORKFLOW_PATH = fileURLToPath(new URL('../.github/workflows/ci.yml', import.meta.url))

const CONFIG_PATH = fileURLToPath(new URL('../vitest.sans-env.config.ts', import.meta.url))

/** La forme du rapport JSON de Vitest, réduite à ce que la commande en lit. */
interface VitestReport {
  readonly numTotalTestSuites?: number
  readonly testResults?: readonly {
    readonly name?: string
    readonly status?: string
    readonly message?: string
    readonly assertionResults?: readonly {
      readonly title?: string
      readonly failureMessages?: readonly string[]
    }[]
  }[]
}

/**
 * Ce que le poste sait de l'environnement : son `.env`, recouvert par ce que le
 * shell exporte — l'ordre de `loadRootEnv()`, pour que la commande lise les
 * mêmes valeurs que `pnpm test`.
 *
 * Chargé dans un objet à part : le processus courant garde le sien intact, et
 * seul le sous-processus reçoit ce que le régime a décidé.
 */
const workstationValues = (): EnvSource => {
  const fromFile: EnvSource = {}
  loadRootEnv({ target: fromFile })

  const exported = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined && value !== ''),
  )

  return { ...fromFile, ...exported }
}

const fileResults = (report: VitestReport): readonly SuiteFileResult[] =>
  (report.testResults ?? []).map((file) => ({
    name: file.name ?? '(fichier sans nom)',
    failed: file.status === 'failed',
    messages: [
      ...(file.message === undefined || file.message === '' ? [] : [file.message]),
      ...(file.assertionResults ?? []).flatMap((assertion) => assertion.failureMessages ?? []),
    ],
  }))

const main = (): void => {
  const started = Date.now()

  const workflow = readFileSync(WORKFLOW_PATH, 'utf8')
  const variables = sansEnvVariables({ workflow, local: workstationValues() })
  const hiddenFile = findRootEnvPath() ?? join(REPO_ROOT, '.env')

  const environment = sansEnvEnvironment({
    parent: process.env,
    // `ENV_KEYS` seul ne suffirait pas : `NEXT_PHASE` et `SKIP_ENV_VALIDATION`
    // **désactivent** la validation d'environnement, et un poste qui les
    // exporte verrait la suite passer sans que rien ne soit validé.
    appKeys: [...ENV_KEYS, ...BUILD_ENV_KEYS],
    variables,
    hiddenFile,
  })

  // Les **noms** seulement : une `DATABASE_URL` porte un mot de passe, et le
  // socle de sécurité interdit qu'un secret passe dans un journal.
  console.log(
    'Régime sans `.env` — les variables que le job de CI fournit à `pnpm test`, et rien ' +
      `d’autre : ${Object.keys(variables).join(', ')}.`,
  )
  console.log(
    'Valeurs : celles du poste quand il en a une, celles du workflow sinon (la base de la CI ' +
      'n’écoute pas ici).',
  )
  console.log(`Fichier retiré des lectures : ${hiddenFile}`)
  console.log('')

  const reportDirectory = mkdtempSync(join(tmpdir(), 'sans-env-'))
  const reportPath = join(reportDirectory, 'rapport.json')

  let failed = false

  try {
    execFileSync(
      'pnpm',
      [
        'exec',
        'vitest',
        'run',
        '--config',
        CONFIG_PATH,
        '--reporter=default',
        '--reporter=json',
        `--outputFile.json=${reportPath}`,
      ],
      { cwd: REPO_ROOT, env: environment as NodeJS.ProcessEnv, stdio: 'inherit' },
    )
  } catch {
    failed = true
  }

  let report: VitestReport

  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8')) as VitestReport
  } catch (error) {
    // Un rapport illisible n'est pas un succès : la commande n'a alors aucune
    // idée de ce qui a été balayé.
    rmSync(reportDirectory, { recursive: true, force: true })

    throw new SansEnvConfigurationError(
      `Le rapport de la suite est illisible (${reportPath}) : ${String(error)}. ` +
        'Sans lui, la commande ne peut ni compter les fichiers balayés ni nommer ce qui manque.',
    )
  }

  rmSync(reportDirectory, { recursive: true, force: true })

  const files = fileResults(report)
  assertSweptFiles(report.numTotalTestSuites ?? files.length)

  // **Le préambule a-t-il été en vigueur ?** Un balayage non vide ne le dit pas :
  // sans le `setupFiles`, la suite tourne avec le `.env` du poste et rend le même
  // compte de fichiers. Le canari est un cas de la suite, et son absence du
  // rapport est donc constatable ici.
  assertCanaryRan(
    (report.testResults ?? []).flatMap((file) =>
      (file.assertionResults ?? []).flatMap((assertion) =>
        assertion.title === undefined ? [] : [assertion.title],
      ),
    ),
  )

  const undeclared = undeclaredVariables(files, ENV_KEYS)

  console.log('')
  console.log(
    `Régime sans \`.env\` : ${files.length} fichiers balayés en ${humanDuration(Date.now() - started)}.`,
  )
  console.log(
    'Non mesuré : les sous-processus lancés par un cas relisent le `.env` du disque ; un ' +
      'lecteur ESM nommé de `node:fs` ne verrait pas le retrait (le chemin de `dotenv`, lui, ' +
      'est couvert et le canari le vérifie) ; et ceci tourne sur ce poste, pas sur un runner ' +
      'Ubuntu.',
  )

  if (undeclared.length > 0) {
    console.error('')
    console.error(
      'Des fichiers de test lisent une variable qu’ils ne déclarent pas. Chaque cas doit ' +
        'déclarer **l’intégralité** de ce qu’il lit (`vi.stubEnv`), précédent : ' +
        '`tests/admin.test.ts` :',
    )

    for (const file of undeclared) {
      console.error(`  ${relative(REPO_ROOT, file.name)} → ${file.variables.join(', ')}`)
    }
  }

  if (failed) {
    process.exitCode = 1
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
