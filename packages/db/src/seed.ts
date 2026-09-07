import type { ModuleScope, ModuleSeed } from '@repo/core'
import { sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type { DatabaseConnection } from './client'

/**
 * La connexion telle qu'un seed la reçoit : les opérations, sans le schéma.
 *
 * Réduite pour deux raisons, et la seconde est celle qui compte : un module
 * n'a pas à connaître les tables des autres pour recevoir une connexion, et
 * **une transaction n'est pas une connexion** — `NodePgDatabase` porte un
 * `$client` que `PgTransaction` n'a pas. Les seeds tournant tous dans une même
 * transaction, c'est cette forme-là qu'ils reçoivent.
 */
export type SeedDatabase = Pick<
  PgDatabase<PgQueryResultHKT>,
  'select' | 'insert' | 'update' | 'delete' | 'execute'
>

/**
 * Un seed est rejouable par construction : identifiants déterministes et
 * écritures tolérantes au conflit. Un seed à identifiants aléatoires passe une
 * fois puis duplique.
 *
 * Ce n'est plus une obligation de commentaire depuis s58 : `tests/seed.test.ts`
 * exécute les seeds **livrés** deux fois et compte les lignes.
 */
export interface Seeder {
  readonly id: string
  readonly run: (db: SeedDatabase) => Promise<void>
}

/**
 * **Les périmètres de démonstration** (s58), partagés par tous les seeds.
 *
 * Ils sont **ici**, au point de composition des seeds, et pas dans un module :
 * c'est ce qui permet à un jeu de données **lié** d'exister sans qu'un module
 * en connaisse un autre. Mesuré sur ce dépôt, aucune des trois autres voies
 * n'est ouverte : `eslint.config.ts` refuse à `organizations` d'importer
 * `@repo/module-auth` hors de deux fichiers, l'`AGENTS.md` de `notifications`
 * écrit que ce module ne connaît pas `auth`, et `billing` déclare
 * `requires: []`. Chaque module écrit donc ses propres lignes pour les mêmes
 * périmètres, sans savoir qui écrit les autres — exactement comme `purge` et
 * `export` reçoivent leur périmètre.
 *
 * Ce sont des **références**, jamais des données : le nom, l'adresse et le mot
 * de passe d'un compte appartiennent au module qui possède les comptes.
 *
 * **L'ordre est stable et il compte** : un module qui distingue ses lignes —
 * le premier compte est le propriétaire de l'organisation — le lit dans cet
 * ordre. Le préfixe `demo-` rend la provenance lisible en base, et c'est aussi
 * lui que la garde de non-écrasement retrouve.
 */
export const DEMONSTRATION_SCOPES = [
  { kind: 'user', userId: 'demo-compte-ada' },
  { kind: 'user', userId: 'demo-compte-hedy' },
  { kind: 'organization', organizationId: 'demo-organisation' },
] as const satisfies readonly ModuleScope[]

/**
 * Une entrée de seed du registre : le module qui la donne, et le seed.
 *
 * Typée **structurellement**, comme `MigratableModule` : `@repo/db` ne reçoit
 * jamais la configuration, il reçoit ce que le registre en a dérivé. Sans cela,
 * aucun test ne pourrait composer un autre ensemble de seeds.
 */
export interface ModuleSeedEntry {
  readonly moduleId: string
  readonly seed: ModuleSeed
}

/**
 * Les seeds du registre, prêts à être exécutés.
 *
 * **Le seul endroit du dépôt qui restitue le type de la connexion.** Le contrat
 * de module voit la base comme `never` (`ModuleSeedDatabase`) parce que
 * `@repo/core` ne dépend pas de l'ORM ; le module, lui, annonce la forme
 * réduite qu'il utilise. L'assertion ci-dessous est ce raccord, et elle est
 * ici, à l'unique point qui possède la vraie connexion, plutôt que répétée dans
 * chaque module.
 *
 * L'identifiant est **qualifié par le module** : deux modules peuvent appeler
 * leur seed `demonstration`, et un journal qui les confondrait ne dirait pas
 * lequel a échoué. **Deux seeds de même identifiant qualifié sont refusés
 * ici**, comme `assertJobSchedulesAreValid` refuse deux tâches homonymes : le
 * plancher par seed et le journal les nommeraient de la même façon, donc « le
 * seed *x* n'a rien laissé » ne désignerait plus rien.
 *
 * **Ce que ce raccord ne tient pas** : la forme de la connexion qu'un module
 * annonce. `ModuleSeedDatabase` est `never`, donc `Pick<PgDatabase, 'insert'>`
 * comme n'importe quelle autre forme lui est assignable, et un module qui
 * déclarerait une opération que le lanceur ne fournit pas échouerait à
 * l'exécution. Aucun type ne peut le tenir sans faire dépendre `@repo/core` de
 * l'ORM ; ce qui est tenu, c'est que l'échec **nomme le seed** — voir
 * `runSeeders` — et `tests/seed.test.ts` le mesure.
 */
export function planModuleSeeders(entries: readonly ModuleSeedEntry[]): readonly Seeder[] {
  const planned = entries.map(({ moduleId, seed }) => ({
    id: `${moduleId}.${seed.id}`,
    run: (db: SeedDatabase) => {
      const run = seed.run as (context: {
        readonly database: SeedDatabase
        readonly demonstration: readonly ModuleScope[]
      }) => Promise<void>

      return run({ database: db, demonstration: DEMONSTRATION_SCOPES })
    },
  }))

  const seen = new Set<string>()

  for (const { id } of planned) {
    if (seen.has(id)) {
      throw new Error(
        `Seed déclaré deux fois : « ${id} ». Deux seeds de même identifiant qualifié sont ` +
          'indiscernables dans le journal comme dans le refus du plancher, et le second ' +
          'passerait pour un rejeu du premier.',
      )
    }

    seen.add(id)
  }

  return planned
}

/** Ce que porte le schéma applicatif : ses tables, et leurs lignes. */
export interface SeededRowCount {
  readonly tables: number
  readonly rows: number
}

/**
 * **Combien de lignes le schéma applicatif porte**, toutes tables confondues.
 *
 * Dérivé d'`information_schema`, jamais d'une liste de tables : une liste
 * écrite ici vieillirait au premier module, et c'est précisément le comptage
 * qui a établi le défaut de s58 — toutes les tables du schéma public à zéro
 * ligne, et sortie 0 (le nombre de tables est dans la recherche, daté ; l'écrire
 * ici le ferait vieillir à côté du code qui le dérive). Le schéma `drizzle`
 * (les journaux de migration) n'est pas compté : il porte des lignes sur une
 * base migrée mais non semée, et le plancher les prendrait pour des données —
 * c'est ce que mesure le cas « un seed qui n'a rien laissé » de
 * `tests/seed.test.ts`, qui tourne sur une base migrée.
 *
 * `query_to_xml` est ce qui permet de compter des tables dont les noms ne sont
 * connus qu'à l'exécution sans concaténer une seule valeur dans du SQL :
 * `format('%I')` cite les identifiants (`docs/security.md` §4).
 *
 * **Une transaction compte aussi** : le plancher par seed mesure entre deux
 * seeds, donc avant la validation. Le paramètre est réduit à l'exécution de SQL
 * pour cette raison.
 */
export async function countSeededRows(
  db: Pick<DatabaseConnection['db'], 'execute'>,
): Promise<SeededRowCount> {
  const result = await db.execute<{ tables: number; rows: number }>(sql`
    select count(*)::int as tables, coalesce(sum(counted.rows), 0)::int as rows
    from (
      select
        (xpath(
          '/row/c/text()',
          query_to_xml(
            format('select count(*) as c from %I.%I', table_schema, table_name),
            false,
            true,
            ''
          )
        ))[1]::text::int as rows
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    ) as counted
  `)

  const row = result.rows[0]

  return { tables: Number(row?.tables ?? 0), rows: Number(row?.rows ?? 0) }
}

export interface RunSeedersOptions {
  /**
   * La **connexion**, pas une transaction : c'est elle qui en ouvre une, et
   * c'est elle qui compte les lignes de part et d'autre.
   */
  readonly db: DatabaseConnection['db']
  /**
   * Les seeds à exécuter. **Obligatoire**, et c'est la correction de s58 : le
   * paramètre était facultatif et retombait sur un tableau vide écrit à la
   * main, si bien que la commande ne pouvait rien faire d'autre que réussir
   * sans rien créer.
   */
  readonly seeders: readonly Seeder[]
}

/** Ce qu'une exécution a fait, et ce que la base porte avant et après. */
export interface SeedOutcome {
  readonly executed: readonly string[]
  readonly tables: number
  readonly rowsBefore: number
  readonly rowsAfter: number
}

/**
 * Exécute les seeds dans l'ordre du graphe et **rend le comptage**.
 *
 * Deux planchers, et ce sont eux la cause du défaut de s58, pas les données :
 *
 * - **aucun seed** — la configuration n'en déclare aucun. Une commande de seed
 *   qui n'a rien à semer n'a pas réussi, elle n'a pas eu lieu ;
 * - **un seed qui n'a rien laissé**, mesuré **seed par seed**. Le plancher
 *   global qu'écrivait la première version de s58 — « toutes les tables du
 *   schéma public à zéro ligne » — promettait plus qu'il ne tenait : les lignes
 *   d'un *autre* seed le satisfaisaient, si bien qu'un module qui déclare
 *   `seeds` et n'écrit rien sortait vert. C'est exactement le défaut que cette
 *   story ferme, reproduit dans le mécanisme qui le ferme.
 *
 * **Ce que le plancher par seed ne tient pas, et il faut le savoir** : il ne
 * s'arme que sur une **première exécution**, c'est-à-dire une base dont le
 * schéma public ne porte aucune ligne. Au-delà, un seed qui n'écrit rien est
 * indiscernable d'un seed rejoué — c'est la même absence de delta, et refuser
 * le rejeu ferait rougir la commande sur son propre usage normal. Un seed muet
 * introduit sur une base déjà semée n'est donc pas attrapé ici ; il l'est à la
 * première exécution sur une base neuve, celle que `pnpm test:golden-path` et
 * `pnpm test:minimal-profile` jouent.
 *
 * Ce qu'aucun plancher ne peut être : « la base a gagné des lignes » à chaque
 * exécution. Un seed rejoué n'en ajoute aucune, par construction.
 */
export async function runSeeders(options: RunSeedersOptions): Promise<SeedOutcome> {
  if (options.seeders.length === 0) {
    throw new Error(
      'Aucun module activé ne déclare de données de départ : il n’y a rien à semer. ' +
        'Un module déclare les siennes par la clé facultative `seeds` de son contrat.',
    )
  }

  const before = await countSeededRows(options.db)
  const executed: string[] = []
  // Le plancher par seed ne s'arme que sur une base vide : voir le commentaire
  // ci-dessus, un rejeu n'écrit rien et c'est ce qu'on lui demande.
  const firstRun = before.rows === 0
  const silent: string[] = []

  /**
   * **Une seule transaction pour tous les seeds**, et ce n'est pas de la
   * performance : c'est ce qui fait qu'un refus ne refuse pas à moitié. La
   * garde de non-écrasement vit dans le module qui possède les comptes, donc
   * dans *un* des seeds ; sans transaction, « rien n'est écrit sur une base en
   * service » ne tiendrait que par l'ordre du graphe, c'est-à-dire par accident.
   * Mesuré : `tests/seed.test.ts` fait écrire un seed **avant** que la garde
   * refuse, et compte les lignes après le refus.
   */
  await options.db.transaction(async (transaction) => {
    for (const seeder of options.seeders) {
      const rowsBeforeSeeder = firstRun ? (await countSeededRows(transaction)).rows : 0

      try {
        await seeder.run(transaction)
      } catch (error) {
        // **L'échec nomme le seed.** Le contrat voit la base comme `never`
        // (`ModuleSeedDatabase`), donc un module peut annoncer une forme de
        // connexion que le lanceur ne fournit pas et échouer à l'exécution :
        // « insert is not a function » sans nom ne désignerait aucun des seeds
        // de la configuration.
        throw new Error(
          `Le seed « ${seeder.id} » a échoué : ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        )
      }

      executed.push(seeder.id)

      if (firstRun && (await countSeededRows(transaction)).rows === rowsBeforeSeeder) {
        silent.push(seeder.id)
      }
    }

    if (silent.length > 0) {
      // Levé **dans** la transaction : une exécution refusée ne laisse rien,
      // seed muet compris.
      throw new Error(
        `Seed(s) sans effet sur une base vide : ${silent.join(', ')}. Un module qui déclare ` +
          '`seeds` et n’écrit aucune ligne sort vert sans que rien ne le signale — c’est le ' +
          'défaut que ce plancher ferme. Les lignes des autres seeds ne comptent pas pour lui.',
      )
    }
  })

  const after = await countSeededRows(options.db)

  return { executed, tables: after.tables, rowsBefore: before.rows, rowsAfter: after.rows }
}
