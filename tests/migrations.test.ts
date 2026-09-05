import { fileURLToPath } from 'node:url'

import {
  createDatabaseClient,
  composeSchema,
  isConcurrentCreationError,
  runMigrations,
  runSeeders,
  type DatabaseConnection,
  type Seeder,
} from '@repo/db'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest'

import { databaseUrl, isDatabaseReachable } from './fixtures/database'
import { fixtureItem } from './fixtures/schema'

/**
 * **Ce qui distingue « quelqu'un d'autre vient de créer cet objet » d'un échec
 * de migration** (s34).
 *
 * La distinction décide d'un rejeu, et un rejeu qui se tromperait de côté
 * masquerait une migration réellement en échec — ce que `docs/reliability.md`
 * refuse en toutes lettres (« une migration en échec empêche l'application de
 * démarrer »). Elle est donc une fonction pure, éprouvée ici, et le rejeu qui
 * s'en sert est éprouvé par la concurrence réelle de
 * `pnpm test:minimal-profile`, où le défaut s'est produit.
 */
describe('la création concurrente d’un objet, distinguée d’un échec', () => {
  it('reconnaît les codes du catalogue, y compris à travers l’enveloppe de Drizzle', () => {
    // Drizzle enveloppe l'erreur du pilote et range l'originale dans `cause` :
    // ne regarder que le premier niveau ne verrait jamais le code.
    const wrapped = new Error('Failed query: create table "organization" …', {
      cause: { code: '23505', constraint: 'pg_type_typname_nsp_index' },
    })

    expect(isConcurrentCreationError(wrapped)).toBe(true)
    expect(isConcurrentCreationError({ code: '42P07' })).toBe(true)
    expect(isConcurrentCreationError({ code: '42710' })).toBe(true)
  })

  it('ne reconnaît pas un échec de migration, qui doit rester un échec', () => {
    // Une syntaxe invalide, une contrainte violée par les données, une colonne
    // absente : rien de tout cela ne se répare en rejouant.
    expect(isConcurrentCreationError({ code: '42601' })).toBe(false)
    expect(isConcurrentCreationError({ code: '23503' })).toBe(false)
    expect(isConcurrentCreationError(new Error('migration illisible'))).toBe(false)
    expect(isConcurrentCreationError(null)).toBe(false)
  })
})

describe('composition des schémas de modules', () => {
  it('assemble les schémas de plusieurs modules', () => {
    const composed = composeSchema([
      { id: 'billing', schema: { subscription: 'subscription-table' } },
      { id: 'storage', schema: { file: 'file-table' } },
    ])

    expect(composed).toEqual({ subscription: 'subscription-table', file: 'file-table' })
  })

  it('conserve le type des tables composées : `db.query.<table>` reste utilisable', () => {
    const composed = composeSchema([{ id: 'fixtures', schema: { fixtureItem } }])

    expect(composed.fixtureItem).toBe(fixtureItem)
    // Vérifié par `tsc`, pas à l'exécution : une composition qui renverrait
    // `Record<string, unknown>` échouerait ici.
    expectTypeOf(composed.fixtureItem).toEqualTypeOf<typeof fixtureItem>()
  })

  it('refuse deux modules qui déclarent la même table, en nommant les deux', () => {
    expect(() =>
      composeSchema([
        { id: 'billing', schema: { customer: 'billing-customer' } },
        { id: 'crm', schema: { customer: 'crm-customer' } },
      ]),
    ).toThrowError(/customer.*billing.*crm|billing.*crm.*customer/s)
  })

  /**
   * **Le baril d'un module sans table n'apporte aucune table** — y compris quand
   * le chargeur le matérialise en CommonJS.
   *
   * `pnpm db:generate` écrit `export {}` pour un module qui ne déclare aucune
   * table (`generated/schema/consent.ts`, `…/i18n.ts`, `…/mcp-server.ts`). En
   * ESM, `import * as consent` rend alors un espace de noms **vide**. Sous le
   * chargeur de `next.config.ts`, il rend `{ default: … }` : l'artefact d'interop
   * CommonJS, qui n'est pas une déclaration du module.
   *
   * **Mesuré le 3 septembre 2026**, en instrumentant `composeSchema` pendant
   * `pnpm build` : `consent` et `i18n` arrivaient tous deux avec la seule clé
   * `default`. Deux conséquences, et la seconde est la pire :
   *
   * 1. **deux** barils vides entrent en collision sur `default`, et le démarrage
   *    échoue en accusant deux modules qui ne déclarent rien ;
   * 2. **un seul** baril vide ne déclenche rien du tout : `default` entre dans
   *    `appSchema` comme s'il était une table, et part au constructeur de
   *    requêtes relationnelles de Drizzle. C'est silencieux, et c'était déjà le
   *    cas avant s28 — aucun chemin ne chargeait `@repo/db` sous ce
   *    chargeur-là, si bien que personne ne l'avait vu.
   *
   * La commande qui échoue si cette règle est violée : `pnpm build`, et ces cas.
   */
  describe('les artefacts d’interop d’un baril vide', () => {
    /** La forme mesurée : un espace de noms dont `default` est l'objet d'exports. */
    const emptyBarrelUnderInterop = (): Record<string, unknown> => {
      const namespace: Record<string, unknown> = {}

      namespace['default'] = namespace
      namespace['__esModule'] = true

      return namespace
    }

    it('n’entre pas dans le schéma composé quand un seul module a un baril vide', () => {
      const composed = composeSchema([
        { id: 'consent', schema: emptyBarrelUnderInterop() },
        { id: 'storage', schema: { file: 'file-table' } },
      ])

      expect(composed).toEqual({ file: 'file-table' })
    })

    it('ne fait pas entrer deux barils vides en collision', () => {
      // La régression exacte qui a cassé `pnpm build` : deux modules sans
      // table s'accusaient de déclarer « default » tous les deux.
      expect(() =>
        composeSchema([
          { id: 'consent', schema: emptyBarrelUnderInterop() },
          { id: 'i18n', schema: emptyBarrelUnderInterop() },
        ]),
      ).not.toThrow()
    })

    it('refuse en revanche une **vraie** table exportée par défaut, en nommant le module', () => {
      // On ignore l'artefact, jamais une déclaration. Un baril qui exporterait
      // réellement une table par défaut serait avalé en silence sans ce refus —
      // et le générateur de barils n'en produit jamais.
      expect(() =>
        composeSchema([{ id: 'fixtures', schema: { default: fixtureItem } }]),
      ).toThrowError(/fixtures/)
    })
  })
})

describe('exécution des migrations', () => {
  // Un `db` inutilisable : toute tentative de migration réelle lèverait.
  const unusableDb = {} as never

  it('n’ouvre pas la base quand le dossier de migrations n’a pas de journal', async () => {
    const folderWithoutJournal = fileURLToPath(new URL('./fixtures/absent', import.meta.url))

    await expect(
      runMigrations({ db: unusableDb, migrationsFolder: folderWithoutJournal }),
    ).resolves.toEqual({ applied: false, count: 0 })
  })

  it('n’ouvre pas la base quand le journal ne déclare aucune migration', async () => {
    // C'est l'état réel du dépôt tant qu'aucun module ne livre de table :
    // `drizzle-kit generate` écrit un journal vide.
    const folderWithEmptyJournal = fileURLToPath(
      new URL('./fixtures/empty-journal', import.meta.url),
    )

    await expect(
      runMigrations({ db: unusableDb, migrationsFolder: folderWithEmptyJournal }),
    ).resolves.toEqual({ applied: false, count: 0 })
  })

  it('nomme le journal illisible plutôt que de remonter une erreur de syntaxe brute', async () => {
    const folderWithMalformedJournal = fileURLToPath(
      new URL('./fixtures/malformed-journal', import.meta.url),
    )

    await expect(
      runMigrations({ db: unusableDb, migrationsFolder: folderWithMalformedJournal }),
    ).rejects.toThrowError(/malformed-journal\/meta\/_journal\.json/)
  })
})

const FIXTURE_MIGRATIONS_FOLDER = fileURLToPath(new URL('./fixtures/migrations', import.meta.url))
const FIXTURE_MIGRATIONS_TABLE = 'fixture_migrations'

const databaseReachable = await isDatabaseReachable()

/**
 * Ces tests exigent un Postgres joignable (`docker compose up -d`). Sans base,
 * ils se skippent : rien ne serait prouvé en simulant la persistance.
 */
describe.skipIf(!databaseReachable)('migrations et seed sur une base réelle', () => {
  // Construit dans `beforeAll` : le corps d'un `describe` skippé s'évalue quand
  // même, et un pool ouvert ici ne serait jamais refermé.
  let connection: DatabaseConnection

  const resetDatabase = async () => {
    await connection.db.execute(sql`drop table if exists fixture_item`)
    // Sur une base vierge le schéma `drizzle` n'existe pas encore : le créer
    // rend le `drop` inoffensif quel que soit l'état de départ.
    await connection.db.execute(sql`create schema if not exists drizzle`)
    await connection.db.execute(sql`drop table if exists drizzle.fixture_migrations`)
  }

  beforeAll(async () => {
    connection = createDatabaseClient({ connectionString: databaseUrl, maxConnections: 1 })
    await resetDatabase()
  })

  afterAll(async () => {
    await resetDatabase()
    await connection.close()
  })

  const migrateOnce = () =>
    runMigrations({
      db: connection.db,
      migrationsFolder: FIXTURE_MIGRATIONS_FOLDER,
      migrationsTable: FIXTURE_MIGRATIONS_TABLE,
    })

  const countRows = async (query: ReturnType<typeof sql>): Promise<number> => {
    const result = await connection.db.execute<{ count: number }>(query)

    return Number(result.rows[0]?.count ?? 0)
  }

  it('applique les migrations sur une base vierge, puis ne fait rien au second passage', async () => {
    await expect(migrateOnce()).resolves.toEqual({ applied: true, count: 1 })
    // Le second passage n'exécute rien, et le dit : `applied` rapporte ce que
    // Drizzle a joué, pas ce que le journal sur disque contient.
    await expect(migrateOnce()).resolves.toEqual({ applied: false, count: 0 })

    const tables = await countRows(
      sql`select count(*)::int as count from information_schema.tables where table_name = 'fixture_item'`,
    )
    const journalEntries = await countRows(
      sql`select count(*)::int as count from drizzle.fixture_migrations`,
    )

    expect(tables).toBe(1)
    expect(journalEntries).toBe(1)
  })

  it('rejoue le seed sans dupliquer les données', async () => {
    await migrateOnce()

    const fixtureSeeder: Seeder = {
      id: 'fixture',
      run: async (db) => {
        await db
          .insert(fixtureItem)
          .values({ id: 'fixture-1', label: 'Fixture' })
          .onConflictDoNothing()
      },
    }

    await runSeeders({ db: connection.db, seeders: [fixtureSeeder] })
    await runSeeders({ db: connection.db, seeders: [fixtureSeeder] })

    const rows = await countRows(sql`select count(*)::int as count from fixture_item`)

    expect(rows).toBe(1)
  })
})
