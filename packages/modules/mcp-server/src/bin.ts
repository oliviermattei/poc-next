import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { AnyModuleDefinition } from '@repo/core'

import { createMcpServer } from './server'

/**
 * Le point de composition du serveur MCP (s41) : le seul fichier de ce paquet
 * qui lit `config/features.ts`, lance un sous-processus, ou parle au
 * transport. Miroir de `packages/cli/src/bin.ts`, pour la même raison : tout
 * le reste de `src/` reçoit des dépendances et se teste sans processus réel.
 *
 * Critère 7 : « module non activé, le serveur n'est pas démarrable ». C'est
 * ici, et seulement ici, que ça se vérifie — **avant** toute construction de
 * transport, avant même de lire quoi que ce soit d'autre que
 * `config/features.ts`.
 */
const FEATURES = join('config', 'features.ts')
const MODULE_ID = 'mcp-server'

const findRepositoryRoot = (from: string): string => {
  let current = resolve(from)

  for (;;) {
    if (existsSync(join(current, FEATURES))) {
      return current
    }

    const parent = dirname(current)

    if (parent === current) {
      throw new Error(
        `Aucun ${FEATURES} trouvé depuis ${from} : le serveur MCP s’exécute dans un dépôt killer-saas.`,
      )
    }

    current = parent
  }
}

interface FeaturesModule {
  readonly availableModules: readonly AnyModuleDefinition[]
  readonly enabledModules: readonly string[]
  readonly requiredModules?: readonly string[]
}

const loadFeatures = async (root: string): Promise<FeaturesModule> =>
  (await import(pathToFileURL(join(root, FEATURES)).href)) as FeaturesModule

/**
 * Lance une commande du dépôt, sans jamais lui donner le canal du protocole.
 *
 * Le descripteur `1` de l'enfant est le `2` du parent : `pnpm db:generate`
 * écrit sa bannière, celle de `turbo` et l'inventaire des tables sur *son*
 * stdout, et ce stdout-là est le flux JSON-RPC de `StdioServerTransport`. Un
 * `inherit` ici injecte de la prose entre deux messages du protocole. La
 * sortie n'est pas supprimée pour autant — elle part sur `stderr`, sans quoi
 * un échec de régénération serait indiagnosticable. Même geste que
 * `packages/cli/src/bin.ts` en mode `--json`, pour la même raison.
 */
const run = (command: string, args: readonly string[], cwd: string): Promise<void> =>
  new Promise((accept, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: ['ignore', 2, 'inherit'] })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        accept()
      } else {
        reject(new Error(`« ${command} ${args.join(' ')} » a terminé avec le code ${String(code)}.`))
      }
    })
  })

export async function runMcpServer(): Promise<number> {
  const root = findRepositoryRoot(process.cwd())
  const { availableModules: available, enabledModules: enabled, requiredModules: required } =
    await loadFeatures(root)

  if (!enabled.includes(MODULE_ID)) {
    // Rien n'est démarré : le refus a lieu avant toute construction de
    // transport, comme le critère 7 l'exige. Sur `stderr` : `stdout` est le
    // canal du protocole MCP, il ne doit jamais porter de la prose.
    console.error(
      `Module ${MODULE_ID} désactivé dans config/features.ts : le serveur MCP ne démarre pas. ` +
        `Activez-le avec « pnpm ks toggle ${MODULE_ID} ».`,
    )

    return 1
  }

  const server = createMcpServer({
    repoRoot: root,
    available,
    required,
    featuresPath: join(root, FEATURES),
    generatedPaths: [
      join(root, 'generated', 'schema'),
      ...available
        .map((module) => module.migrations)
        .filter((path): path is string => path !== null)
        .map((path) => join(root, path)),
    ],
    regenerate: () => run('pnpm', ['db:generate'], root),
    applyMigrations: () => run('pnpm', ['db:migrate'], root),
  })

  await server.connect(new StdioServerTransport())

  return 0
}
