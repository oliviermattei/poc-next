import type { AnyModuleDefinition } from '@repo/core'

/**
 * Le plan de `ks scaffold <id>` (s41) : ce qu'il faut savoir avant d'écrire quoi
 * que ce soit, jamais la génération elle-même — `scaffoldFiles` (`./scaffold-files`)
 * fait ça, et ne connaît pas l'annuaire.
 *
 * Un module inconnu de l'annuaire n'est **pas** un cas ici : c'est l'inverse
 * de `ks toggle`, qui refuse un identifiant que l'annuaire ne connaît pas.
 * `scaffold` refuse un identifiant que l'annuaire connaît **déjà** — générer
 * un second module du même nom écraserait le premier en silence.
 */
export class ScaffoldRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScaffoldRefusedError'
  }
}

export interface ScaffoldPlan {
  readonly moduleId: string
  /** Chemin du paquet, relatif à la racine du dépôt. */
  readonly packagePath: string
}

const quote = (value: string): string => `« ${value} »`

/**
 * Un identifiant de module : `kebab-case`, comme le veut la convention de
 * nommage du dépôt (`AGENTS.md` racine). Refusé tôt, avant tout calcul de
 * chemin : c'est aussi ce qui empêche un identifiant du type `../../etc` de
 * jamais atteindre un chemin de fichier — le serveur MCP ne sort pas du dépôt.
 */
const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

export function planScaffold(input: {
  readonly available: readonly AnyModuleDefinition[]
  readonly moduleId: string
}): ScaffoldPlan {
  const { available, moduleId } = input

  if (!KEBAB_CASE.test(moduleId)) {
    throw new ScaffoldRefusedError(
      `Identifiant de module refusé ${quote(moduleId)} : il doit être en kebab-case ` +
        '(minuscules, chiffres, tirets simples), comme le veut la convention de nommage du ' +
        'dépôt. Aucun fichier n’a été créé.',
    )
  }

  if (available.some((module) => module.id === moduleId)) {
    throw new ScaffoldRefusedError(
      `Module ${quote(moduleId)} refusé : l’annuaire de config/features.ts en déclare déjà un de ` +
        'ce nom. « ks list » donne les identifiants pris. Aucun fichier n’a été créé.',
    )
  }

  return { moduleId, packagePath: `packages/modules/${moduleId}` }
}
