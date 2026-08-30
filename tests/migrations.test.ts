import { fileURLToPath } from 'node:url'

import { createDatabaseClient, composeSchema, runMigrations, runSeeders, type Seeder } from '@repo/db'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { databaseUrl, isDatabaseReachable } from './fixtures/database'
import { fixtureItem } from './fixtures/schema'

describe('composition des schémas de modules', () => {
  it('assemble les schémas de plusieurs modules', () => {
    const composed = composeSchema([
      { id: 'billing', schema: { subscription: 'subscription-table' } },
      { id: 'storage', schema: { file: 'file-table' } },
    ])

    expect(composed).toEqual({ subscription: 'subscription-table', file: 'file-table' })
  })

  it('refuse deux modules qui déclarent la même table, en nommant les deux', () => {
    expect(() =>
      composeSchema([
        { id: 'billing', schema: { customer: 'billing-customer' } },
        { id: 'crm', schema: { customer: 'crm-customer' } },
      ]),
    ).toThrowError(/customer.*billing.*crm|billing.*crm.*customer/s)
  })
})

describe('exécution des migrations', () => {
  it('n’ouvre pas la base quand le dossier de migrations n’a pas de journal', async () => {
    // Un `db` inutilisable : toute tentative de migration réelle lèverait.
    const unusableDb = {} as never
    const folderWithoutJournal = fileURLToPath(new URL('./fixtures/absent', import.meta.url))

    await expect(
      runMigrations({ db: unusableDb, migrationsFolder: folderWithoutJournal }),
    ).resolves.toEqual({ applied: false })
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
  const connection = createDatabaseClient({ connectionString: databaseUrl, maxConnections: 1 })

  const resetDatabase = async () => {
    await connection.db.execute(sql`drop table if exists fixture_item`)
    await connection.db.execute(
      sql`drop table if exists drizzle.fixture_migrations`,
    )
  }

  beforeAll(resetDatabase)

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
    await expect(migrateOnce()).resolves.toEqual({ applied: true })
    await expect(migrateOnce()).resolves.toEqual({ applied: true })

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
