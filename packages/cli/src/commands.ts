import { readFile } from 'node:fs/promises'

import type { AnyModuleDefinition } from '@repo/core'

import { applyToggle } from './apply'
import { readEnabledModules } from './features-file'
import { describeModules, renderModuleList, type ModuleSummary } from './modules'
import { missingRequirements, planToggle, ToggleRefusedError } from './toggle'

/**
 * Les deux commandes, orchestrées.
 *
 * Tout ce qui sort du processus passe par `ToggleEnvironment` : régénérer,
 * migrer, poser une question, écrire une ligne. C'est ce qui rend observable
 * l'effet dont l'**absence** est un critère — une migration qui n'a pas été
 * appliquée.
 *
 * Le mode non interactif n'est pas un repli, c'est le mode nominal d'un agent
 * ou de la CI (ADR 013) : hors terminal, la commande ne pose aucune question.
 * Elle refuse en nommant le drapeau qui l'aurait autorisée, plutôt que d'attendre
 * une réponse que personne ne donnera.
 */
export interface ToggleEnvironment {
  readonly featuresPath: string
  readonly generatedPaths: readonly string[]
  readonly regenerate: () => Promise<void>
  readonly applyMigrations: () => Promise<void>
  readonly confirm: (question: string) => Promise<boolean>
  readonly print: (line: string) => void
}

export interface ToggleRequest {
  readonly moduleId: string
  readonly interactive: boolean
  readonly withRequirements?: boolean
  readonly applyMigrations?: boolean
}

export interface ToggleOutcome {
  readonly action: 'enable' | 'disable'
  readonly moduleId: string
  readonly enabled: readonly string[]
  readonly alsoEnabled: readonly string[]
  readonly migrationsApplied: boolean
}

const quote = (value: string): string => `« ${value} »`

export async function runList(input: {
  readonly available: readonly AnyModuleDefinition[]
  readonly featuresPath: string
}): Promise<readonly ModuleSummary[]> {
  const source = await readFile(input.featuresPath, 'utf8')

  return describeModules({ available: input.available, enabled: readEnabledModules(source) })
}

export { renderModuleList }

export async function runToggle(input: {
  readonly available: readonly AnyModuleDefinition[]
  readonly request: ToggleRequest
  readonly environment: ToggleEnvironment
}): Promise<ToggleOutcome> {
  const { available, request, environment } = input
  const enabled = readEnabledModules(await readFile(environment.featuresPath, 'utf8'))

  const missing =
    enabled.includes(request.moduleId) || request.withRequirements === true
      ? []
      : missingRequirements({ available, enabled, moduleId: request.moduleId })

  // La proposition n'a lieu qu'en interactif. Hors terminal, `planToggle` refuse
  // en nommant le manquant et le drapeau qui l'activerait aussi.
  const withRequirements =
    request.withRequirements === true ||
    (request.interactive &&
      missing.length > 0 &&
      (await environment.confirm(
        `Activer aussi ${missing.map(quote).join(', ')}, dont ${quote(request.moduleId)} a besoin ?`,
      )))

  const plan = planToggle({ available, enabled, moduleId: request.moduleId, withRequirements })

  await applyToggle({
    featuresPath: environment.featuresPath,
    nextEnabled: plan.nextEnabled,
    generatedPaths: environment.generatedPaths,
    regenerate: environment.regenerate,
  })

  if (plan.action === 'disable') {
    environment.print(
      `Module ${quote(plan.moduleId)} désactivé. Ses tables et ses données sont **conservées** : ` +
        'une réactivation les retrouvera intactes. Il n’existe aucune commande pour les retirer.',
    )

    return { ...plan, enabled: plan.nextEnabled, migrationsApplied: false }
  }

  const activated = [...plan.alsoEnabled, plan.moduleId]
  const withMigrations = available.filter(
    (module) => activated.includes(module.id) && module.migrations !== null,
  )

  environment.print(
    `Module ${quote(plan.moduleId)} activé${
      plan.alsoEnabled.length > 0 ? ` (avec ${plan.alsoEnabled.map(quote).join(', ')})` : ''
    }. Barils régénérés.`,
  )

  if (withMigrations.length === 0) {
    return { ...plan, enabled: plan.nextEnabled, migrationsApplied: false }
  }

  environment.print(
    `Migrations générées pour ${withMigrations.map((module) => quote(module.id)).join(', ')}.`,
  )

  // Générer, mais ne pas appliquer : une commande de configuration ne touche pas
  // une base parce qu'on a tapé « toggle ». L'autorisation est explicite, et
  // hors terminal elle ne peut venir que du drapeau.
  const authorized =
    request.applyMigrations === true ||
    (request.interactive && (await environment.confirm('Appliquer les migrations maintenant ?')))

  if (!authorized) {
    environment.print(
      'Migrations non appliquées. Lancez « pnpm db:migrate » quand votre base est prête.',
    )

    return { ...plan, enabled: plan.nextEnabled, migrationsApplied: false }
  }

  await environment.applyMigrations()
  environment.print('Migrations appliquées.')

  return { ...plan, enabled: plan.nextEnabled, migrationsApplied: true }
}

export { ToggleRefusedError }
