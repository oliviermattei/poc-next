import { readFile } from 'node:fs/promises'

import type { AnyModuleDefinition } from '@repo/core'

import { applyToggle } from './apply'
import { readEnabledModules, type EnabledModulesEdit } from './features-file'
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
  /** Entrées déjà présentes que l'ordre canonique a déplacées (ADR 019). */
  readonly reordered: readonly string[]
  /** Entrées retirées dont le commentaire du propriétaire est parti avec elles. */
  readonly droppedComments: readonly string[]
}

const quote = (value: string): string => `« ${value} »`

/**
 * Ce que l'écriture a changé **sans qu'on le lui demande**, dit à voix haute.
 *
 * ADR 019 fait de l'ordre de `enabledModules` une propriété canonique, donc une
 * liste ordonnée à la main est réordonnée à la première bascule. Ce coût est
 * payé une fois, et il est **annoncé** : une normalisation silencieuse d'un
 * fichier qu'on édite à la main est exactement ce que l'ADR interdit.
 *
 * Et le commentaire d'une entrée retirée part avec elle — le laisser en place le
 * réattribuerait au module voisin. Une réactivation ne le rendra pas : à la
 * seconde invocation, le texte n'existe plus nulle part. Le dire au moment où
 * ça arrive est la seule chance qu'a l'utilisateur de le récupérer.
 */
const announce = (environment: ToggleEnvironment, edit: EnabledModulesEdit): void => {
  if (edit.reordered.length > 0) {
    environment.print(
      `config/features.ts : la liste des modules activés a été réécrite dans l’ordre de l’annuaire ` +
        `${quote('availableModules')} — ${edit.reordered.map(quote).join(', ')} ${
          edit.reordered.length > 1 ? 'ont changé' : 'a changé'
        } de place. C’est l’ordre canonique du dépôt (ADR 019), établi une fois : ` +
        'les bascules suivantes ne réordonneront plus rien.',
    )
  }

  for (const id of edit.droppedComments) {
    environment.print(
      `Le commentaire que vous aviez écrit à côté de ${quote(id)} dans config/features.ts est parti ` +
        'avec son entrée — le laisser en place l’aurait attribué au module voisin. Une réactivation ' +
        'ne le rétablira pas : le CLI ne peut pas deviner un texte qui n’est plus dans le fichier.',
    )
  }
}

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

  const edit = await applyToggle({
    featuresPath: environment.featuresPath,
    nextEnabled: plan.nextEnabled,
    generatedPaths: environment.generatedPaths,
    regenerate: environment.regenerate,
  })

  const written = {
    enabled: plan.nextEnabled,
    reordered: edit.reordered,
    droppedComments: edit.droppedComments,
  }

  if (plan.action === 'disable') {
    environment.print(
      `Module ${quote(plan.moduleId)} désactivé. Ses tables et ses données sont **conservées** : ` +
        'une réactivation les retrouvera intactes. Il n’existe aucune commande pour les retirer.',
    )

    announce(environment, edit)

    return { ...plan, ...written, migrationsApplied: false }
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

  announce(environment, edit)

  if (withMigrations.length === 0) {
    return { ...plan, ...written, migrationsApplied: false }
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

    return { ...plan, ...written, migrationsApplied: false }
  }

  await environment.applyMigrations()
  environment.print('Migrations appliquées.')

  return { ...plan, ...written, migrationsApplied: true }
}

export { ToggleRefusedError }
