import { execFileSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildRegistry, resolveEnabledModules } from '@repo/core'
import {
  assertNoForbiddenModuleReferences,
  createDatabaseClient,
  listDatabaseTables,
  migrationsTableFor,
  planModuleMigrations,
  planModuleSchemaBarrels,
  renderModuleSchemaBarrel,
  runModuleMigrations,
  type DatabaseConnection,
} from '@repo/db'
import { demoDisabledModule } from '@repo/module-demo-disabled'
import { demoEnabledModule } from '@repo/module-demo-enabled'
import { sql } from 'drizzle-orm'
import { pgTable, text, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { availableModules, enabledModules } from '../config/features'
import { databaseUrl, isDatabaseReachable } from './fixtures/database'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const GENERATED_SCHEMA_DIR = join(REPO_ROOT, 'generated', 'schema')

/** Le registre du dépôt tel qu'il est configuré : ordre du graphe compris. */
const moduleRegistry = buildRegistry({
  available: [...availableModules],
  enabled: [...enabledModules],
})

/**
 * Le chaînon manquant du finding N3.
 *
 * `drizzle-kit@0.31.10` n'inspecte que les **exports de premier niveau** du
 * fichier qu'on lui désigne (`prepareFromExports` parcourt
 * `Object.values(exports)` et ne descend dans aucun objet). Un agrégat construit
 * à l'exécution lui est donc invisible : mesuré, un fichier qui exporte
 * `{ demoItems, demoNotes }` dans un objet fait dire « 0 tables » à `generate`.
 *
 * Le baril est le fichier qui rétablit la visibilité — et il réexporte
 * exactement les tables **déclarées au contrat**, pas ce que le fichier de
 * schéma du module exporte par ailleurs : sans cela, une table que personne n'a
 * déclarée entrerait en base par la seule vertu d'un export oublié.
 */
describe('baril de schéma d’un module', () => {
  const declared = {
    demoItems: pgTable('demo_items', { id: text('id').primaryKey() }),
    demoTags: pgTable('demo_tags', { id: text('id').primaryKey() }),
  }

  it('réexporte à plat les tables déclarées, depuis le package du module', () => {
    const barrel = renderModuleSchemaBarrel({ id: 'demo-enabled', schema: declared })

    expect(barrel).toContain("export { demoItems, demoTags } from '@repo/module-demo-enabled'")
  })

  it('ne réexporte pas une table que le contrat ne déclare pas', () => {
    const barrel = renderModuleSchemaBarrel({ id: 'demo-enabled', schema: { demoItems: declared.demoItems } })

    expect(barrel).not.toContain('demoTags')
  })
})

/**
 * Le baril est un artefact versionné, et un artefact versionné peut mentir.
 *
 * S'il n'était pas committé, `drizzle-kit generate` ne trouverait rien sur un
 * clone neuf. Committé sans garde, il diverge dès qu'un module est activé et
 * personne ne le voit : les migrations d'un module actif ne seraient plus
 * générées, et la table manquante se découvrirait en production. La seule
 * combinaison qui tienne dans les deux sens est celle-ci — versionné, et
 * comparé à sa régénération.
 */
describe('le baril versionné correspond à `config/features.ts`', () => {
  it('contient exactement les fichiers des modules activés, au contenu près', async () => {
    const expected = planModuleSchemaBarrels(moduleRegistry.modules)
    const present = (await readdir(GENERATED_SCHEMA_DIR)).filter((name) => name.endsWith('.ts'))

    expect(present.sort()).toEqual(expected.map((barrel) => barrel.file).sort())

    for (const barrel of expected) {
      await expect(readFile(join(GENERATED_SCHEMA_DIR, barrel.file), 'utf8')).resolves.toBe(
        barrel.content,
      )
    }
  })
})

/**
 * La clé étrangère inter-modules : le moyen le plus courant de rendre un module
 * non désactivable sans s'en apercevoir.
 *
 * Le schéma compile, les migrations passent, et la promesse de modularité est
 * morte : couper le module référencé laisse une contrainte pendante. Le refus
 * a donc lieu **à la génération**, et il nomme les deux modules — un refus qui
 * dit « référence interdite » sans dire laquelle oblige à relire tout le schéma.
 *
 * Ce qui est autorisé n'est pas écrit en dur : une référence passe si le module
 * cible est déclaré, directement ou transitivement, dans les `requires` du
 * module source. C'est exactement la condition qui rend la référence sûre — la
 * configuration refuse déjà d'activer le source sans la cible, donc la cible ne
 * peut pas disparaître sous lui. Le socle (`auth` en s07) est couvert par cette
 * règle sans figurer dans aucune liste : les modules qui s'y réfèrent le
 * déclarent dans leurs requis.
 */
describe('références inter-modules refusées à la génération', () => {
  const usersTable = pgTable('socle_users', { id: text('id').primaryKey() })

  const socle = { id: 'socle', requires: [], schema: { usersTable } }
  const optional = {
    id: 'optionnel',
    requires: [],
    schema: { notes: pgTable('optionnel_notes', { id: text('id').primaryKey() }) },
  }

  const moduleReferencing = (id: string, requires: readonly string[], target: AnyPgColumn) => ({
    id,
    requires,
    schema: {
      own: pgTable(`${id}_items`, {
        id: text('id').primaryKey(),
        targetId: text('target_id').references(() => target),
      }),
    },
  })

  it('accepte une référence interne au module', () => {
    const parent = pgTable('solo_parents', { id: text('id').primaryKey() })
    const child = pgTable('solo_children', {
      id: text('id').primaryKey(),
      parentId: text('parent_id').references(() => parent.id),
    })

    expect(() =>
      assertNoForbiddenModuleReferences([{ id: 'solo', requires: [], schema: { parent, child } }]),
    ).not.toThrow()
  })

  it('accepte une référence vers un module déclaré dans les requis', () => {
    expect(() =>
      assertNoForbiddenModuleReferences([socle, moduleReferencing('app', ['socle'], usersTable.id)]),
    ).not.toThrow()
  })

  it('accepte une référence vers un module requis transitivement', () => {
    const intermediate = { id: 'intermediaire', requires: ['socle'], schema: {} }

    expect(() =>
      assertNoForbiddenModuleReferences([
        socle,
        intermediate,
        moduleReferencing('app', ['intermediaire'], usersTable.id),
      ]),
    ).not.toThrow()
  })

  it('refuse une référence vers un module optionnel, en nommant les deux', () => {
    let message = ''

    try {
      assertNoForbiddenModuleReferences([
        optional,
        moduleReferencing('app', [], optional.schema.notes.id),
      ])
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toContain('app')
    expect(message).toContain('optionnel')
    expect(message).toContain('optionnel_notes')
  })

  it('refuse une référence vers une table qu’aucun module ne déclare', () => {
    const orphan = pgTable('table_orpheline', { id: text('id').primaryKey() })

    expect(() =>
      assertNoForbiddenModuleReferences([moduleReferencing('app', [], orphan.id)]),
    ).toThrowError(/app.*table_orpheline|table_orpheline.*app/s)
  })
})

/**
 * L'ordre d'application vient du **graphe des requis**, jamais de l'ordre de
 * `config/features.ts` ni de l'alphabet.
 *
 * Un module requis doit voir ses tables créées avant celles de son dépendant,
 * faute de quoi la première migration qui référencera le socle échouera au
 * déploiement, et pas avant. `@repo/core` fournit déjà cet ordre : le plan le
 * **consomme**, il ne le recalcule pas — et il ne le retrie surtout pas.
 */
describe('plan de migration par module', () => {
  const moduleWithMigrations = (id: string) => ({
    id,
    migrations: `packages/modules/${id}/migrations`,
  })

  // « zeta » est requis par « alpha » : l'ordre du graphe est donc zeta → alpha,
  // quand l'ordre déclaré est alpha → zeta et l'ordre alphabétique alpha → zeta.
  // Les trois se distinguent, sans quoi le test passerait par accident.
  const graphOrder = [moduleWithMigrations('zeta'), moduleWithMigrations('alpha')]

  it('applique les modules dans l’ordre reçu du registre, pas dans l’ordre alphabétique', () => {
    const plan = planModuleMigrations({ modules: graphOrder, repoRoot: '/repo' })

    expect(plan.map((step) => step.moduleId)).toEqual(['zeta', 'alpha'])
  })

  it('donne à chaque module son propre journal, dérivé de son identifiant', () => {
    const plan = planModuleMigrations({ modules: graphOrder, repoRoot: '/repo' })

    expect(plan.map((step) => step.migrationsTable)).toEqual([
      '__drizzle_migrations_zeta',
      '__drizzle_migrations_alpha',
    ])
    expect(plan[0]?.migrationsFolder).toBe('/repo/packages/modules/zeta/migrations')
  })

  it('ignore un module qui ne déclare aucune migration', () => {
    const plan = planModuleMigrations({
      modules: [{ id: 'sans-table', migrations: null }],
      repoRoot: '/repo',
    })

    expect(plan).toEqual([])
  })

  it('tient l’ordre du graphe des modules réels, pas celui de la configuration', () => {
    // La configuration liste délibérément le dépendant en premier ; l'ordre
    // alphabétique le mettrait aussi en premier. Seul le graphe met le requis
    // devant.
    const plan = planModuleMigrations({
      modules: resolveEnabledModules({
        available: [demoEnabledModule, demoDisabledModule],
        enabled: ['demo-disabled', 'demo-enabled'],
      }),
      repoRoot: REPO_ROOT,
    })

    expect(plan.map((step) => step.moduleId)).toEqual(['demo-enabled', 'demo-disabled'])
  })

  it('refuse un identifiant dont le journal dépasserait la limite de PostgreSQL', () => {
    // PostgreSQL tronque silencieusement au-delà de 63 caractères : deux modules
    // aux identifiants longs partageraient alors le même journal, et le second
    // croirait ses migrations déjà appliquées.
    expect(() =>
      planModuleMigrations({
        modules: [moduleWithMigrations('m'.repeat(60))],
        repoRoot: '/repo',
      }),
    ).toThrowError(/63/)
  })
})

const databaseReachable = await isDatabaseReachable()

/**
 * La vérification qui compte se fait dans la **base**, pas dans les fichiers.
 *
 * Lire les dossiers de migrations ne dirait que ce qu'on a écrit ; seul
 * `information_schema` attrape une table créée par un import transitif, une
 * migration copiée à la main ou un schéma monolithique oublié. C'est le
 * mécanisme que la recette de modularité (s26) reprendra tel quel.
 *
 * Sans Postgres joignable (`docker compose up -d`), ces tests se skippent :
 * simuler une base ne prouverait rien de ce qui précède.
 */
describe.skipIf(!databaseReachable)('migrations de modules sur une base réelle', () => {
  let connection: DatabaseConnection

  const availableForTests = [demoEnabledModule, demoDisabledModule]

  const planFor = (enabled: readonly string[]) =>
    planModuleMigrations({
      // L'ordre vient du graphe, comme dans l'application : la liste ci-dessous
      // est délibérément donnée à l'envers de l'ordre des requis.
      modules: resolveEnabledModules({ available: availableForTests, enabled }),
      repoRoot: REPO_ROOT,
    })

  const virginDatabase = async () => {
    await connection.db.execute(sql`drop table if exists demo_items`)
    await connection.db.execute(sql`drop table if exists demo_notes`)
    await connection.db.execute(sql`create schema if not exists drizzle`)

    for (const module of availableForTests) {
      await connection.db.execute(
        sql`drop table if exists drizzle.${sql.identifier(migrationsTableFor(module.id))}`,
      )
    }
  }

  beforeAll(async () => {
    connection = createDatabaseClient({ connectionString: databaseUrl, maxConnections: 1 })
    await virginDatabase()
  })

  afterAll(async () => {
    await virginDatabase()
    await connection.close()
  })

  const journalEntries = async (moduleId: string): Promise<number> => {
    const result = await connection.db.execute<{ count: number }>(
      sql`select count(*)::int as count from drizzle.${sql.identifier(migrationsTableFor(moduleId))}`,
    )

    return Number(result.rows[0]?.count ?? 0)
  }

  it('ne crée sur une base vierge que les tables des modules activés', async () => {
    await runModuleMigrations({ db: connection.db, plan: planFor(['demo-enabled']) })

    const tables = await listDatabaseTables({ db: connection.db })

    expect(tables).toContain('demo_items')
    expect(tables).not.toContain('demo_notes')
  })

  it('n’applique rien de plus au second passage', async () => {
    await runModuleMigrations({ db: connection.db, plan: planFor(['demo-enabled']) })
    await runModuleMigrations({ db: connection.db, plan: planFor(['demo-enabled']) })

    expect(await journalEntries('demo-enabled')).toBe(1)
    expect(await listDatabaseTables({ db: connection.db })).toContain('demo_items')
  })

  it('conserve tables et données d’un module activé puis désactivé', async () => {
    // Activation : le module requis d'abord, son dépendant ensuite.
    const applied = await runModuleMigrations({
      db: connection.db,
      plan: planFor(['demo-disabled', 'demo-enabled']),
    })

    expect(applied.map((outcome) => outcome.moduleId)).toEqual(['demo-enabled', 'demo-disabled'])

    await connection.db.execute(
      sql`insert into demo_notes (id, owner_id, body) values ('n-1', 'u-1', 'gardée')`,
    )

    // Désactivation : le plan ne contient plus le module, et rien n'est détruit.
    await runModuleMigrations({ db: connection.db, plan: planFor(['demo-enabled']) })

    const rows = await connection.db.execute<{ count: number }>(
      sql`select count(*)::int as count from demo_notes`,
    )

    expect(await listDatabaseTables({ db: connection.db })).toContain('demo_notes')
    expect(Number(rows.rows[0]?.count ?? 0)).toBe(1)
  })
})

/**
 * Aucune migration destructive, sous aucun prétexte (`docs/reliability.md` §4).
 *
 * Une migration doit rester rétrocompatible avec la version encore en ligne
 * pendant le basculement : ajouter avant de lire, cesser d'écrire avant de
 * supprimer. Supprimer les tables d'un module désactivé serait `eject`, au
 * cimetière du PRD — et il n'existe aucune commande de nettoyage.
 *
 * La règle porte sur le SQL réellement versionné, pas sur une intention : c'est
 * ce fichier-là que le déploiement exécute.
 */
describe('les migrations versionnées ne détruisent rien', () => {
  const destructive = /\b(drop\s+(table|column|schema|database)|truncate)\b/i

  it('aucun module ne livre de suppression de table, de colonne ou de schéma', async () => {
    const statements = await Promise.all(
      availableModules
        .filter((module) => module.migrations !== null)
        .map(async (module) => {
          const folder = join(REPO_ROOT, module.migrations as string)
          const files = (await readdir(folder)).filter((name) => name.endsWith('.sql'))

          return Promise.all(
            files.map(async (file) => ({
              origin: `${module.id}/${file}`,
              sql: await readFile(join(folder, file), 'utf8'),
            })),
          )
        }),
    )

    const offending = statements
      .flat()
      .filter((migration) => destructive.test(migration.sql))
      .map((migration) => migration.origin)

    expect(offending).toEqual([])
  })
})

/**
 * Le baril doit entrer dans la **clé de cache**, comme la configuration dont il
 * dérive (revue de s03, F1).
 *
 * `config/**` a été couvert par le correctif de s03 ; le baril est un autre
 * fichier, à un autre endroit, et il décide des tables que `drizzle-kit` voit.
 * Sans lui dans la clé, éditer la configuration, régénérer puis reconstruire
 * peut rendre un artefact haché avant la régénération.
 *
 * L'assertion n'inspecte pas `turbo.json` : elle interroge le calcul de hachage
 * de Turborepo. Un motif présent mais mal orthographié laisserait passer une
 * lecture du fichier, pas celle-ci.
 */
describe('le baril généré entre dans la clé de cache du build', () => {
  it('hache chaque fichier de `generated/schema/` avant de décider qu’un build est réutilisable', async () => {
    const output = execFileSync(
      'node_modules/.bin/turbo',
      ['run', 'build', '--dry=json', '--filter=@repo/web'],
      { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )

    const plan = JSON.parse(output) as { globalCacheInputs?: { files?: Record<string, string> } }
    const hashed = new Set(Object.keys(plan.globalCacheInputs?.files ?? {}))
    // Le dossier réel, quel que soit le jeu de modules activés — un fichier
    // attendu en dur ne dirait rien de l'état où aucun module ne l'est.
    const present = (await readdir(GENERATED_SCHEMA_DIR)).map((name) => `generated/schema/${name}`)

    expect(present.length).toBeGreaterThan(0)
    expect(present.filter((file) => !hashed.has(file))).toEqual([])
  })
})
