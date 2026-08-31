import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { AnyModuleDefinition } from '@repo/core'

import { ArtifactSnapshotError, RegenerationFailedError } from './apply'
import { ArgumentError, parseArguments, USAGE } from './arguments'
import { renderModuleList, runList, runToggle, type ToggleEnvironment } from './commands'
import { FeaturesFileError } from './features-file'
import { ToggleRefusedError } from './toggle'

/**
 * Le **point de composition** du CLI : le seul fichier qui lise
 * `config/features.ts` et qui lance des processus. Tout le reste de `src/`
 * reçoit des modules et du texte, et se teste sur un dépôt temporaire.
 *
 * La racine du dépôt est cherchée en remontant depuis le répertoire courant :
 * `ks` doit répondre la même chose depuis `apps/web` que depuis la racine, et
 * la déduire de l'emplacement de ce fichier ferait éditer le dépôt qui héberge
 * le CLI plutôt que celui où l'on travaille.
 */
const FEATURES = join('config', 'features.ts')

const findRepositoryRoot = (from: string): string => {
  let current = resolve(from)

  for (;;) {
    if (existsSync(join(current, FEATURES))) {
      return current
    }

    const parent = dirname(current)

    if (parent === current) {
      throw new ArgumentError(
        `Aucun ${FEATURES} trouvé depuis ${from} : « ks » s’exécute dans un dépôt killer-saas.`,
      )
    }

    current = parent
  }
}

/**
 * Lance une commande du dépôt, et échoue bruyamment si elle échoue.
 *
 * En mode machine, la sortie du sous-processus part sur **stderr** (le
 * descripteur `2` du parent) : `pnpm db:generate` écrit sa bannière et celle de
 * `drizzle-kit` sur stdout, et stdout est réservé au JSON. Elle n'est pas
 * supprimée pour autant — un échec de régénération sans son message serait
 * indiagnosticable.
 */
const run = (
  command: string,
  args: readonly string[],
  cwd: string,
  machineReadable: boolean,
): Promise<void> =>
  new Promise((accept, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      stdio: ['inherit', machineReadable ? 2 : 'inherit', 'inherit'],
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        accept()
      } else {
        reject(new Error(`« ${command} ${args.join(' ')} » a terminé avec le code ${String(code)}.`))
      }
    })
  })

const ask = async (question: string): Promise<boolean> => {
  const rl = createInterface({ input: process.stdin, output: process.stderr })

  try {
    const answer = (await rl.question(`${question} [o/N] `)).trim().toLowerCase()

    return answer === 'o' || answer === 'oui' || answer === 'y' || answer === 'yes'
  } finally {
    rl.close()
  }
}

interface FeaturesModule {
  readonly availableModules: readonly AnyModuleDefinition[]
  /**
   * Le socle non désactivable (ADR 021). Facultatif : un dépôt qui n'en déclare
   * pas est valide, et le CLI n'en invente pas — il transmet ce qu'il lit.
   */
  readonly requiredModules?: readonly string[]
}

const loadFeatures = async (root: string): Promise<FeaturesModule> =>
  (await import(pathToFileURL(join(root, FEATURES)).href)) as FeaturesModule

export async function runCli(argv: readonly string[]): Promise<number> {
  try {
    const options = parseArguments(argv)

    if (options.command === 'help') {
      console.log(USAGE)

      return 0
    }

    const root = findRepositoryRoot(process.cwd())
    const featuresPath = join(root, FEATURES)
    const { availableModules: available, requiredModules: required } = await loadFeatures(root)

    if (options.command === 'list') {
      const summaries = await runList({ available, required, featuresPath })

      console.log(options.json ? JSON.stringify(summaries, null, 2) : renderModuleList(summaries))

      return 0
    }

    // Hors terminal — un agent, la CI — aucune question n'est posée : personne
    // n'y répondrait, et une commande qui attend sur `stdin` est inutilisable
    // (ADR 013). `--json` force le même régime.
    const interactive = process.stdin.isTTY === true && !options.json

    const environment: ToggleEnvironment = {
      featuresPath,
      // Les artefacts que la régénération réécrit : le dossier des barils, et
      // les migrations de chaque module. Photographiés avant, restaurés si la
      // régénération échoue.
      generatedPaths: [
        join(root, 'generated', 'schema'),
        ...available
          .map((module) => module.migrations)
          .filter((path): path is string => path !== null)
          .map((path) => join(root, path)),
      ],
      regenerate: () => run('pnpm', ['db:generate'], root, options.json),
      applyMigrations: () => run('pnpm', ['db:migrate'], root, options.json),
      confirm: ask,
      // La prose destinée à l'œil ne partage pas le canal du JSON : en mode
      // machine, stdout ne porte que l'objet, et tout le reste passe par stderr.
      print: (line) => {
        if (options.json) {
          console.error(line)
        } else {
          console.log(line)
        }
      },
    }

    const outcome = await runToggle({
      available,
      required,
      request: {
        moduleId: options.moduleId,
        interactive,
        withRequirements: options.withRequirements,
        applyMigrations: options.applyMigrations,
      },
      environment,
    })

    if (options.json) {
      console.log(JSON.stringify(outcome, null, 2))
    }

    return 0
  } catch (error) {
    if (
      error instanceof ArgumentError ||
      error instanceof ToggleRefusedError ||
      error instanceof FeaturesFileError ||
      error instanceof ArtifactSnapshotError ||
      error instanceof RegenerationFailedError
    ) {
      console.error(error.message)

      return 1
    }

    // Pas d'`USAGE` ici : une erreur non classée n'est pas une faute
    // d'invocation, et imprimer le mode d'emploi enverrait corriger la commande
    // tapée plutôt que lire ce qui a réellement échoué.
    console.error(error instanceof Error ? error.message : String(error))

    return 1
  }
}
