import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'

/**
 * La garde de référence inter-modules.
 *
 * Une clé étrangère d'un module vers un autre est le moyen le plus courant de
 * rendre un module non désactivable sans s'en apercevoir : le schéma compile,
 * les migrations passent, et le jour où l'on coupe le module référencé, la
 * contrainte pend. ADR 007 le nomme explicitement et renvoie le refus ici, **à
 * la génération** — pas à la revue, pas au démarrage.
 *
 * Ce qui est autorisé n'est écrit dans aucune liste. Une référence passe si le
 * module cible est déclaré, directement ou transitivement, dans les `requires`
 * du module source. C'est exactement la condition qui rend la référence sûre :
 * `resolveEnabledModules` refuse déjà d'activer le source sans la cible, donc
 * la cible ne peut pas disparaître sous lui. Le socle non désactivable
 * (`auth`, s07) est couvert par cette même règle sans figurer dans une liste
 * qu'il faudrait maintenir : un module qui référence `auth` le déclare dans ses
 * requis, et c'est la déclaration qui décide.
 *
 * L'inspection porte sur les objets Drizzle, pas sur le texte du schéma :
 * `getTableConfig` rend les clés étrangères réellement construites, y compris
 * celles écrites en `.references(() => …)` sur une colonne.
 */

export interface ModuleReferenceSource {
  readonly id: string
  readonly requires: readonly string[]
  /** Tables Drizzle déclarées au contrat, indexées par nom d'export. */
  readonly schema: Record<string, unknown>
}

export class ForbiddenModuleReferenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ForbiddenModuleReferenceError'
  }
}

const quote = (value: string): string => `« ${value} »`

/** Les tables déclarées par un module, dans l'ordre de déclaration. */
function declaredTables(module: ModuleReferenceSource): readonly PgTable[] {
  return Object.values(module.schema).filter(
    (candidate): candidate is PgTable => candidate instanceof PgTable,
  )
}

/** Clôture transitive des `requires`, calculée sur l'annuaire fourni. */
function transitiveRequires(
  moduleId: string,
  byId: ReadonlyMap<string, ModuleReferenceSource>,
): ReadonlySet<string> {
  const reached = new Set<string>()
  const pending = [...(byId.get(moduleId)?.requires ?? [])]

  while (pending.length > 0) {
    const next = pending.pop() as string

    if (reached.has(next)) {
      continue
    }

    reached.add(next)
    pending.push(...(byId.get(next)?.requires ?? []))
  }

  return reached
}

/**
 * Refuse toute clé étrangère qu'un module ne peut pas honorer.
 *
 * Reçoit l'**annuaire complet** et non les seuls modules activés : c'est ce qui
 * permet de nommer le module propriétaire d'une table référencée alors qu'il
 * n'est pas activé, au lieu de se contenter d'un « table inconnue ».
 */
export function assertNoForbiddenModuleReferences(
  modules: readonly ModuleReferenceSource[],
): void {
  const byId = new Map(modules.map((module) => [module.id, module]))
  const ownerOfTable = new Map<string, string>()

  for (const module of modules) {
    for (const table of declaredTables(module)) {
      ownerOfTable.set(getTableConfig(table).name, module.id)
    }
  }

  for (const module of modules) {
    const allowed = transitiveRequires(module.id, byId)

    for (const table of declaredTables(module)) {
      const { name: tableName, foreignKeys } = getTableConfig(table)

      for (const foreignKey of foreignKeys) {
        const targetName = getTableConfig(foreignKey.reference().foreignTable).name
        const owner = ownerOfTable.get(targetName)

        if (owner === module.id) {
          continue
        }

        if (owner === undefined) {
          throw new ForbiddenModuleReferenceError(
            `Référence inconnue : la table ${quote(tableName)} du module ${quote(module.id)} ` +
              `référence la table ${quote(targetName)}, qu’aucun module de l’annuaire ne déclare ` +
              `dans son schéma. Une table non déclarée n’a ni purge, ni export, ni rétention.`,
          )
        }

        if (!allowed.has(owner)) {
          throw new ForbiddenModuleReferenceError(
            `Clé étrangère interdite : la table ${quote(tableName)} du module ${quote(module.id)} ` +
              `référence la table ${quote(targetName)} du module ${quote(owner)}, ` +
              `que ${quote(module.id)} ne déclare pas dans ses requis. Elle rendrait ` +
              `${quote(owner)} silencieusement non désactivable. Déclarer ${quote(owner)} dans ` +
              `les requis de ${quote(module.id)}, ou passer par l’identifiant plutôt que par une ` +
              `contrainte.`,
          )
        }
      }
    }
  }
}
