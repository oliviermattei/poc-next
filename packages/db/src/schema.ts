/**
 * Composition des schémas de modules.
 *
 * Chaque module applicatif déclare ses tables dans son propre package ; la base
 * ne connaît que la liste des modules activés.
 *
 * ---------------------------------------------------------------------------
 * CE QUE `composeSchema` FAIT, ET CE QU'ELLE NE FERA JAMAIS (finding N3, fermé en s04)
 *
 * `drizzle-kit generate` ne voit *que* les exports de premier niveau du fichier
 * désigné par `schema:` : sa fonction interne `prepareFromExports` parcourt
 * `Object.values(exports)` et ne retient que les valeurs qui sont elles-mêmes
 * des `PgTable`. Elle ne descend dans aucun objet. Les tables assemblées ici
 * vivent dans un objet : elles lui sont invisibles, et le resteront.
 *
 * s04 ne l'a donc pas « corrigée » — la composition sert l'**exécution** (le
 * client, la requête relationnelle `db.query.<table>`), la **génération** passe
 * par les barils de `generated/schema/`, produits depuis `config/features.ts`
 * par `pnpm db:generate` et versionnés. Les deux chemins ne se remplacent pas.
 * ---------------------------------------------------------------------------
 */

export interface ModuleSchema<
  TSchema extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Identifiant du module propriétaire des tables. */
  readonly id: string
  /** Tables Drizzle exportées par le module, indexées par nom d'export. */
  readonly schema: TSchema
}

type UnionToIntersection<TUnion> = (
  TUnion extends unknown ? (value: TUnion) => void : never
) extends (value: infer TIntersection) => void
  ? TIntersection
  : never

/**
 * Type du schéma composé : l'intersection des schémas des modules fournis.
 *
 * Sans ce type, la composition renverrait `Record<string, unknown>` et
 * écraserait le typage des tables : `db.query.<table>` serait inutilisable, quel
 * que soit le module ajouté.
 */
export type ComposedSchema<TModules extends readonly ModuleSchema[]> =
  UnionToIntersection<TModules[number]['schema']> extends infer TSchema
    ? TSchema extends Record<string, unknown>
      ? TSchema
      : Record<string, never>
    : never

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
export function composeSchema<const TModules extends readonly ModuleSchema[]>(
  modules: TModules,
): ComposedSchema<TModules> {
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

  // L'assemblage est dynamique : seul le type de retour porte la garantie que
  // les tables des modules traversent la composition sans perdre leur type.
  return composed as ComposedSchema<TModules>
}

/**
 * Schémas passés au client Drizzle pour la **requête relationnelle**.
 *
 * Vide, et ce n'est pas un oubli : `@repo/db` ne dépend d'aucun package de
 * module, et il ne doit pas — l'`infrastructure/` d'un module dépendra de ce
 * package pour sa connexion, la dépendance inverse fermerait un cycle. Aucun
 * module ne persiste encore (les repositories de démonstration sont en
 * mémoire) ; le jour où l'un le fera, c'est le point de composition qui
 * possède la configuration qui lui passera les schémas, comme
 * `src/scripts/migrate.ts` lui passe déjà le plan de migration.
 *
 * Rien de tout cela ne concerne la génération des migrations : elle lit les
 * barils de `generated/schema/`, pas cette liste.
 *
 * Volontairement sans annotation de type : annoter `readonly ModuleSchema[]`
 * élargirait chaque schéma en `Record<string, unknown>` et annulerait le typage
 * de `appSchema`.
 */
export const enabledModuleSchemas = [] as const satisfies readonly ModuleSchema[]

export const appSchema = composeSchema(enabledModuleSchemas)

export type AppSchema = typeof appSchema
