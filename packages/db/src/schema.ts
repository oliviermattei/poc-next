/**
 * Composition des schémas de modules.
 *
 * Chaque module applicatif déclare ses tables dans son propre package ; la base
 * ne connaît que la liste des modules activés. Aujourd'hui cette liste est vide
 * — le premier module l'alimentera.
 */

export interface ModuleSchema {
  /** Identifiant du module propriétaire des tables. */
  readonly id: string
  /** Tables Drizzle exportées par le module, indexées par nom d'export. */
  readonly schema: Record<string, unknown>
}

export class SchemaCollisionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SchemaCollisionError'
  }
}

/**
 * Assemble les schémas des modules activés en un schéma unique.
 *
 * Deux modules qui déclarent le même nom sont un conflit, pas une surcharge :
 * l'écrasement silencieux produirait des migrations fausses.
 */
export function composeSchema(modules: readonly ModuleSchema[]): Record<string, unknown> {
  const composed: Record<string, unknown> = {}
  const owners = new Map<string, string>()

  for (const module of modules) {
    for (const [name, table] of Object.entries(module.schema)) {
      const owner = owners.get(name)

      if (owner !== undefined) {
        throw new SchemaCollisionError(
          `Schema collision on "${name}": declared by both module "${owner}" and module "${module.id}".`,
        )
      }

      owners.set(name, module.id)
      composed[name] = table
    }
  }

  return composed
}

/** Modules activés. Vide tant qu'aucun module n'est livré. */
export const enabledModuleSchemas: readonly ModuleSchema[] = []

export const appSchema = composeSchema(enabledModuleSchemas)

export type AppSchema = typeof appSchema
