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

import { enabledModuleSchemas } from '../../../generated/schema'

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
 * Ils viennent de `generated/schema/index.ts`, écrit par `pnpm db:generate`
 * depuis `config/features.ts` : le même geste qui produit les barils produit
 * l'agrégat, donc le client ne peut pas connaître d'autres tables que celles
 * des modules activés.
 *
 * s04 avait laissé cette liste **vide**, faute d'un module qui persiste : le
 * client se construisait alors avec un schéma relationnel vide et
 * `db.query.<table>` n'existait pas. s07, premier module à persister, referme
 * le résidu à l'endroit que s04 désignait — la génération.
 *
 * Ce package continue de ne dépendre d'**aucun** package de module : il importe
 * un fichier généré, dont les imports sont écrits depuis la configuration. La
 * contrepartie est une règle, et elle est vérifiée par un test
 * (`tests/module-registry.test.ts`) : **un module n'importe jamais
 * `@repo/db`** — il reçoit sa connexion de son point de composition. Sans
 * cette règle, l'agrégat fermerait un cycle module → `@repo/db` → agrégat →
 * module, et les tables seraient lues avant d'être initialisées (ADR 020).
 *
 * Volontairement sans annotation de type : annoter `readonly ModuleSchema[]`
 * élargirait chaque schéma en `Record<string, unknown>` et annulerait le typage
 * de `appSchema`.
 */
export { enabledModuleSchemas } from '../../../generated/schema'

export const appSchema = composeSchema(enabledModuleSchemas)

export type AppSchema = typeof appSchema
