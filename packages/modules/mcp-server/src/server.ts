import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  ArtifactSnapshotError,
  applyScaffold,
  assertRepositoryClean,
  DirtyRepositoryError,
  FeaturesFileError,
  planScaffold,
  RegenerationFailedError,
  runList,
  runToggle,
  ScaffoldDirectoryExistsError,
  ScaffoldRefusedError,
  scaffoldFiles,
  ScaffoldWriteError,
  ToggleRefusedError,
} from '@repo/cli'
import type { AnyModuleDefinition } from '@repo/core'
import { z } from 'zod'

import { trackFileChanges } from './file-changes'

/**
 * Le serveur MCP (s41) : une **seconde façade** sur le moteur de `@repo/cli`,
 * jamais une seconde implémentation. The three tools call the same functions
 * as `ks list`, `ks toggle` and `ks scaffold` (`runList`, `runToggle`,
 * `planScaffold`/`applyScaffold`), which is what keeps the two facades from
 * diverging. Only `list_modules` has its outputs compared against the CLI's on
 * the same configuration, in `src/server.test.ts`.
 *
 * `toggle_module` and `scaffold_module` set the clean-repository guard
 * (`packages/cli/AGENTS.md`) on the paths they write, before any write: an
 * agent calling them must always be undoable. `list_modules` writes nothing
 * and does not set it.
 */
export interface McpServerDependencies {
  readonly repoRoot: string
  readonly available: readonly AnyModuleDefinition[]
  /** Le socle non désactivable (ADR 021), tel que `config/features.ts` le déclare. */
  readonly required?: readonly string[]
  readonly featuresPath: string
  readonly generatedPaths: readonly string[]
  readonly regenerate: () => Promise<void>
  readonly applyMigrations: () => Promise<void>
}

const errorResult = (message: string) => ({
  content: [{ type: 'text' as const, text: message }],
  isError: true as const,
})

const textResult = (payload: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
})

const KNOWN_REFUSALS = [
  ToggleRefusedError,
  ScaffoldRefusedError,
  ScaffoldDirectoryExistsError,
  ScaffoldWriteError,
  ArtifactSnapshotError,
  RegenerationFailedError,
  FeaturesFileError,
  DirtyRepositoryError,
] as const

const messageOf = (error: unknown): string => {
  for (const knownError of KNOWN_REFUSALS) {
    if (error instanceof knownError) {
      return error.message
    }
  }

  throw error
}

export function createMcpServer(deps: McpServerDependencies): McpServer {
  const server = new McpServer({ name: 'killer-boilerplate', version: '0.0.0' })
  const trackedPaths = [deps.featuresPath, ...deps.generatedPaths]

  server.registerTool(
    'list_modules',
    {
      title: 'Lister les modules',
      description:
        'Liste les modules de l’annuaire, leur état (activé/désactivé), leurs requis, leurs ' +
        'dépendants et leur appartenance au socle non désactivable.',
    },
    async () => {
      try {
        const summaries = await runList({
          available: deps.available,
          required: deps.required,
          featuresPath: deps.featuresPath,
        })

        return textResult(summaries)
      } catch (error) {
        return errorResult(messageOf(error))
      }
    },
  )

  server.registerTool(
    'toggle_module',
    {
      title: 'Activer ou désactiver un module',
      description:
        'Inverse l’état d’un module dans config/features.ts, régénère les barils, et propose ' +
        'les migrations à jouer. Refuse un module inconnu, un requis manquant ou un dépendant ' +
        'encore activé en le nommant, et refuse tout si config/features.ts ou les barils ont des ' +
        'modifications non commitées.',
      inputSchema: {
        moduleId: z.string(),
        withRequirements: z.boolean().optional(),
        applyMigrations: z.boolean().optional(),
      },
    },
    async ({ moduleId, withRequirements, applyMigrations }) => {
      try {
        await assertRepositoryClean(deps.repoRoot, trackedPaths)

        // Le moteur, pas une seconde orchestration : c'est `runToggle` qui
        // sait quelles migrations l'activation vient de générer, et qui
        // refuse de toucher la base quand il n'y en a aucune. Ce que la
        // façade terminal imprime à l'œil, celle-ci le **rend** — les lignes
        // d'annonce comprises (réordonnancement canonique, commentaire perdu),
        // qu'un agent n'aurait vues nulle part ailleurs.
        const notices: string[] = []

        const { result: outcome, modifiedFiles } = await trackFileChanges(
          deps.repoRoot,
          trackedPaths,
          async () =>
            runToggle({
              available: deps.available,
              required: deps.required,
              request: { moduleId, interactive: false, withRequirements, applyMigrations },
              environment: {
                featuresPath: deps.featuresPath,
                generatedPaths: [...deps.generatedPaths],
                regenerate: deps.regenerate,
                applyMigrations: deps.applyMigrations,
                // Hors terminal, aucune question n'est posée : un agent ne
                // répond pas à un prompt, et un refus nommé vaut mieux qu'une
                // attente (ADR 013).
                confirm: async () => false,
                print: (line) => notices.push(line),
              },
            }),
        )

        return textResult({ ...outcome, modifiedFiles, notices })
      } catch (error) {
        return errorResult(messageOf(error))
      }
    },
  )

  server.registerTool(
    'scaffold_module',
    {
      title: 'Générer le squelette d’un nouveau module',
      description:
        'Génère packages/modules/<id> conforme au contrat de module (13 clés, ADR 007). Refuse ' +
        'un identifiant mal formé ou déjà connu, et refuse tout si packages/modules/<id> a des ' +
        'modifications non commitées.',
      inputSchema: { moduleId: z.string() },
    },
    async ({ moduleId }) => {
      try {
        const plan = planScaffold({ available: deps.available, moduleId })

        await assertRepositoryClean(deps.repoRoot, [plan.packagePath])
        const written = await applyScaffold({
          repoRoot: deps.repoRoot,
          packagePath: plan.packagePath,
          files: scaffoldFiles(plan.moduleId),
        })

        return textResult({ moduleId: plan.moduleId, written })
      } catch (error) {
        return errorResult(messageOf(error))
      }
    },
  )

  return server
}
