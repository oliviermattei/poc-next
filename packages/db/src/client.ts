import { EnvValidationError, getEnv } from '@repo/config'
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
  // `pg` accepte une chaîne vide ou absente et se rabat alors sur les défauts de
  // libpq : utilisateur système, base locale, port 5432. La connexion peut donc
  // réussir sur une base que personne n'a configurée. Refuser ici est le seul
  // endroit qui couvre aussi les chemins où la validation est désactivée.
  if (options.connectionString.trim() === '') {
    throw new EnvValidationError(
      'DATABASE_URL est vide : impossible de construire un client de base de données.',
    )
  }

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
 * Drizzle enveloppe l'erreur du pilote, et le pilote lui-même en agrège
 * plusieurs quand l'hôte a une double pile (IPv6 puis IPv4). Sans déballage des
 * deux niveaux, le diagnostic se réduit à « Failed query » suivi d'un message
 * vide — un journal qui ne dit rien de l'échec de connexion.
 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'unknown error'
  }

  const details: string[] = []

  if (error instanceof AggregateError) {
    details.push(...error.errors.map(describeError))
  }

  if (error.cause instanceof Error) {
    details.push(describeError(error.cause))
  }

  const parts = [error.message.trim(), ...new Set(details)].filter((part) => part.length > 0)

  return parts.length > 0 ? parts.join(' — ') : 'unknown error'
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
