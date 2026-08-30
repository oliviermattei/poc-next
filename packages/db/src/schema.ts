/**
 * Composition des schémas de modules.
 *
 * Chaque module applicatif déclare ses tables dans son propre package ; la base
 * ne connaît que la liste des modules activés. Aujourd'hui cette liste est vide
 * — le premier module l'alimentera.
 *
 * ---------------------------------------------------------------------------
 * CONTRAINTE CONNUE, À TRAITER EN s04 (« un module déclare son schéma »)
 *
 * `drizzle-kit generate` ne voit *que* les exports de premier niveau du fichier
 * désigné par `schema:` dans `drizzle.config.ts` : sa fonction interne
 * `prepareFromExports` parcourt `Object.values(exports)` et ne retient que les
 * valeurs qui sont elles-mêmes des `PgTable`. Elle ne descend dans aucun objet.
 *
 * Les tables assemblées par `composeSchema` vivent donc dans un objet et sont
 * invisibles pour `generate` : la composition sert l'exécution (le client, la
 * requête relationnelle `db.query.<table>`), pas la génération des migrations.
 * Tant que la liste est vide, `generate` répond « 0 tables » et rien ne casse ;
 * l'échec est différé, pas absent.
 *
 * s04 doit livrer le chaînon manquant : un fichier baril qui réexporte à plat
 * les tables des modules activés (`export * from '@repo/module-x/schema'`) et
 * que `drizzle.config.ts` désignera, la composition ci-dessous restant la
 * source de vérité pour l'exécution. La forme exacte de ce baril — un fichier
 * par module ou un agrégat généré — est une décision de s04.
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
 * Modules activés. Vide tant qu'aucun module n'est livré.
 *
 * Volontairement sans annotation de type : annoter `readonly ModuleSchema[]`
 * élargirait chaque schéma en `Record<string, unknown>` et annulerait le typage
 * de `appSchema`.
 */
export const enabledModuleSchemas = [] as const satisfies readonly ModuleSchema[]

export const appSchema = composeSchema(enabledModuleSchemas)

export type AppSchema = typeof appSchema
