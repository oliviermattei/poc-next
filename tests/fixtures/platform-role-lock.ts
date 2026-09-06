import { createDatabaseClient, type DatabaseConnection } from '@repo/db'
import { sql } from 'drizzle-orm'

import { databaseUrl } from './database'

/**
 * **L'exclusivité sur `admin_platform_role`, entre fichiers de suite** (s37b1).
 *
 * Deux fichiers écrivent cette table sur **la même base** — `tests/admin.
 * test.ts` et `tests/account-deletion.test.ts` —, et Vitest les exécute en
 * parallèle. Ils ne peuvent pas cohabiter, et pas par maladresse : la
 * désignation du premier superadmin exige qu'**aucune** ligne n'existe (règle
 * `designatesFirstSuperadmin`), donc un fichier a besoin d'un décompte global à
 * zéro pendant que l'autre a besoin de ses propres lignes. L'un vidait la table
 * de l'autre, l'autre empêchait la désignation du premier.
 *
 * La collision préexiste à `s37b1` — elle passait par chance, les deux fichiers
 * se croisant rarement. Les cas d'impersonation ont allongé `admin.test.ts`
 * (inscriptions et connexions réelles), et elle est devenue reproductible : deux
 * exécutions complètes, deux échecs, sur deux cas différents.
 *
 * Le verrou est **consultatif et de session**, pris sur une connexion à elle
 * seule (`maxConnections: 1`) : une connexion partagée rendrait le verrou et sa
 * libération dépendants de la connexion que le pool a choisie. Sa clé est
 * distincte de celle du module (`hashtext('superadmin')`) — la partager
 * bloquerait les écritures du dépôt sous test.
 */
export interface PlatformRoleLock {
  open(): Promise<void>
  close(): Promise<void>
  acquire(): Promise<void>
  release(): Promise<void>
}

const LOCK_KEY = 'tests.admin_platform_role'

export function createPlatformRoleLock(): PlatformRoleLock {
  let connection: DatabaseConnection | null = null

  return {
    open: async () => {
      connection = createDatabaseClient({ connectionString: databaseUrl, maxConnections: 1 })
      // Une requête tout de suite : le pool ouvre paresseusement, et le premier
      // `pg_advisory_lock` paierait sinon l'établissement de la connexion.
      await connection.db.execute(sql`select 1`)
    },

    close: async () => {
      await connection?.close()
      connection = null
    },

    acquire: async () => {
      await connection?.db.execute(sql`select pg_advisory_lock(hashtext(${LOCK_KEY}))`)
    },

    release: async () => {
      await connection?.db.execute(sql`select pg_advisory_unlock(hashtext(${LOCK_KEY}))`)
    },
  }
}
