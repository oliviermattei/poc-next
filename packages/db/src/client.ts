import { getEnv } from '@repo/config'
import { sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { appSchema, type AppSchema } from './schema'

/**
 * Point d'entrée unique vers la base.
 *
 * Le choix du pilote et la stratégie de connexions sont encapsulés ici : passer
 * d'un PostgreSQL conteneurisé à un provider managé ne change qu'une chaîne de
 * connexion (`DATABASE_URL`), jamais une ligne de code applicatif. Le pilote
 * `node-postgres` parle le protocole PostgreSQL standard et honore `sslmode`
 * dans la chaîne de connexion, ce qui couvre les deux cibles.
 */
export interface DatabaseConnection {
  readonly db: NodePgDatabase<AppSchema>
  readonly pool: Pool
  readonly close: () => Promise<void>
}

export interface CreateDatabaseClientOptions {
  readonly connectionString: string
  /** Taille maximale du pool. Réduire en environnement serverless. */
  readonly maxConnections?: number
  /** Délai d'établissement de connexion : une sonde ne doit jamais pendre. */
  readonly connectionTimeoutMillis?: number
}

export function createDatabaseClient(options: CreateDatabaseClientOptions): DatabaseConnection {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
  })

  const db = drizzle(pool, { schema: appSchema, casing: 'snake_case' })

  return {
    db,
    pool,
    close: () => pool.end(),
  }
}

let connection: DatabaseConnection | null = null

/** Connexion partagée du processus, construite à la première utilisation. */
export function getDatabase(): DatabaseConnection {
  if (connection === null) {
    connection = createDatabaseClient({ connectionString: getEnv().DATABASE_URL })
  }

  return connection
}

export async function closeDatabase(): Promise<void> {
  if (connection !== null) {
    const current = connection
    connection = null
    await current.close()
  }
}

/**
 * Drizzle enveloppe l'erreur du pilote : sans sa cause, le diagnostic se réduit
 * à « Failed query », ce qui ne dit rien de l'échec de connexion.
 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'unknown error'
  }

  return error.cause instanceof Error ? `${error.message} — ${error.cause.message}` : error.message
}

export interface DatabaseStatus {
  readonly connected: boolean
  /** Cause de l'échec, destinée aux journaux — jamais à une réponse HTTP. */
  readonly reason?: string
}

/**
 * Interroge réellement la base. Ne lève jamais : un appelant doit pouvoir
 * répondre « injoignable » sans se protéger lui-même.
 */
export async function checkDatabaseConnection(
  target?: DatabaseConnection,
): Promise<DatabaseStatus> {
  try {
    const { db } = target ?? getDatabase()
    await db.execute(sql`select 1`)

    return { connected: true }
  } catch (error) {
    return { connected: false, reason: describeError(error) }
  }
}
