import { EnvValidationError, getEnv, loadRootEnv } from '@repo/config'
import { checkDatabaseConnection, createDatabaseClient } from '@repo/db'

/**
 * Les tests d'intégration exigent un Postgres joignable (`docker compose up`).
 * Sans lui, ils se skippent : on ne simule jamais une base absente.
 *
 * L'environnement passe par le module de configuration, jamais par une lecture
 * directe de `process.env` (règle transverse de `docs/architecture.md`). Le
 * `.env` racine est chargé ici pour que `docker compose up -d && pnpm test`
 * suffise à réveiller ces tests, sans exporter la variable à la main.
 */
loadRootEnv()

const readDatabaseUrl = (): string => {
  try {
    return getEnv().DATABASE_URL
  } catch (error) {
    if (error instanceof EnvValidationError) {
      return ''
    }

    throw error
  }
}

export const databaseUrl = readDatabaseUrl()

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
