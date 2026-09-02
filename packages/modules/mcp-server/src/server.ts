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
 * jamais une seconde implémentation. Les trois outils appellent les mêmes
 * fonctions que `ks list`, `ks toggle` et `ks scaffold` — `tests/*` prouve
 * l'invariant en comparant les deux sorties sur la même configuration.
 *
 * `toggle_module` et `scaffold_module` posent la garde de dépôt propre (ADR
 * 041, `@repo/cli`) avant toute écriture : un agent qui les appelle doit
 * pouvoir toujours annuler. `list_modules` ne modifie rien, elle ne la pose
 * pas.
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
        'encore activé en le nommant, et refuse tout sur un dépôt aux modifications non commitées.',
      inputSchema: {
        moduleId: z.string(),
        withRequirements: z.boolean().optional(),
        applyMigrations: z.boolean().optional(),
      },
    },
    async ({ moduleId, withRequirements, applyMigrations }) => {
      try {
        await assertRepositoryClean(deps.repoRoot)

        // Le moteur, pas une seconde orchestration : c'est `runToggle` qui
        // sait quelles migrations l'activation vient de générer, et qui
        // refuse de toucher la base quand il n'y en a aucune. Ce que la
        // façade terminal imprime à l'œil, celle-ci le **rend** — les lignes
        // d'annonce comprises (réordonnancement ADR 019, commentaire perdu),
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
        'un identifiant mal formé ou déjà connu, et refuse tout sur un dépôt aux modifications ' +
        'non commitées.',
      inputSchema: { moduleId: z.string() },
    },
    async ({ moduleId }) => {
      try {
        await assertRepositoryClean(deps.repoRoot)

        const plan = planScaffold({ available: deps.available, moduleId })
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
