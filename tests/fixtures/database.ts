import { checkDatabaseConnection, createDatabaseClient } from '@repo/db'

/**
 * Les tests d'intégration exigent un Postgres joignable (`docker compose up`).
 * Sans lui, ils se skippent : on ne simule jamais une base absente.
 */
export const databaseUrl = process.env.DATABASE_URL ?? ''

export async function isDatabaseReachable(): Promise<boolean> {
  if (databaseUrl === '') {
    return false
  }

  const connection = createDatabaseClient({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 3_000,
    maxConnections: 1,
  })

  try {
    const status = await checkDatabaseConnection(connection)

    return status.connected
  } finally {
    await connection.close()
  }
}
