import { randomUUID } from 'node:crypto'

import { EnvValidationError, getEnv } from '@repo/config'
import { loadRootEnv } from '@repo/config/server'
import {
  checkDatabaseConnection,
  createDatabaseClient,
  type DatabaseConnection,
} from '@repo/db'
import { sql } from 'drizzle-orm'

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

/**
 * **Une base créée pour l'exécution, puis détruite** (s58).
 *
 * Les tests de base de ce dépôt travaillent sur la base du poste, avec des
 * identifiants qui leur appartiennent. Un seed, lui, se mesure sur **tout** ce
 * que la base contient — « zéro ligne » est exactement le défaut que s58
 * corrige, et une suite qui tourne en parallèle écrit dans les mêmes tables.
 * Le comptage n'a donc de sens que dans une base à soi, comme
 * `pnpm test:minimal-profile` et le parcours doré le font déjà pour la leur.
 *
 * Le nom est suffixé au hasard : deux exécutions simultanées ne doivent pas se
 * partager une base « de test ».
 */
export interface TemporaryDatabase {
  readonly url: string
  readonly connection: DatabaseConnection
  readonly drop: () => Promise<void>
}

const withMaintenanceConnection = async (statement: string): Promise<void> => {
  const maintenance = createDatabaseClient({
    connectionString: databaseUrlFor('postgres'),
    maxConnections: 1,
  })

  try {
    await maintenance.db.execute(sql.raw(statement))
  } finally {
    await maintenance.close()
  }
}

const databaseUrlFor = (name: string): string => {
  const url = new URL(databaseUrl)

  url.pathname = `/${name}`

  return url.toString()
}

export async function createTemporaryDatabase(prefix: string): Promise<TemporaryDatabase> {
  const name = `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const url = databaseUrlFor(name)

  await withMaintenanceConnection(`create database "${name}"`)

  const connection = createDatabaseClient({ connectionString: url, maxConnections: 1 })

  return {
    url,
    connection,
    drop: async () => {
      await connection.close()
      // `with (force)` : une connexion oubliée par un test en échec ne doit pas
      // laisser une base derrière elle à chaque exécution.
      await withMaintenanceConnection(`drop database if exists "${name}" with (force)`)
    },
  }
}
