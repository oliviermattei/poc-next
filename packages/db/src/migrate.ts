import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

import type { DatabaseConnection } from './client'

export interface RunMigrationsOptions {
  readonly db: DatabaseConnection['db']
  readonly migrationsFolder: string
  /** Journal des migrations appliquées. Défaut Drizzle : `drizzle.__drizzle_migrations`. */
  readonly migrationsTable?: string
  readonly migrationsSchema?: string
}

export interface MigrationsResult {
  /** Vrai seulement si **cet appel** a exécuté au moins une migration. */
  readonly applied: boolean
  /** Combien de migrations cet appel a réellement jouées. */
  readonly count: number
}

/**
 * Vrai dès qu'une migration est à appliquer.
 *
 * Le dossier peut être absent (aucun `drizzle-kit generate` n'a encore tourné)
 * *ou* contenir un journal sans entrée : `generate` en écrit un dès le premier
 * appel, même quand aucun module ne déclare de table. Les deux états disent la
 * même chose — il n'y a rien à appliquer, et donc aucune raison d'ouvrir une
 * connexion.
 */
function hasMigrations(migrationsFolder: string): boolean {
  const journal = join(migrationsFolder, 'meta', '_journal.json')

  if (!existsSync(journal)) {
    return false
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(readFileSync(journal, 'utf8'))
  } catch (error) {
    // Un `SyntaxError` brut ne dit ni quel fichier ni quelle commande le
    // produit. Le journal est écrit par `drizzle-kit generate` : nommer le
    // fichier est la seule information qui mène à la réparation.
    throw new Error(`Journal de migrations illisible : ${journal}`, { cause: error })
  }

  const entries = (parsed as { entries?: unknown }).entries

  return Array.isArray(entries) && entries.length > 0
}

/** Défauts de Drizzle pour le journal en base, quand l'appelant n'en fixe pas. */
const DEFAULT_MIGRATIONS_TABLE = '__drizzle_migrations'
const DEFAULT_MIGRATIONS_SCHEMA = 'drizzle'

/**
 * Combien de migrations le journal **en base** compte, ou zéro s'il n'existe pas.
 *
 * Lu avant et après l'exécution : c'est la seule façon de savoir ce que Drizzle
 * a joué, `migrate()` ne rendant rien. Sans cette lecture, « appliquées » ne
 * dirait que « des migrations existent sur disque », et un déploiement qui n'a
 * rien fait serait indiscernable de celui qui a créé une table.
 */
async function journalLength(
  db: RunMigrationsOptions['db'],
  schema: string,
  table: string,
): Promise<number> {
  const relation = await db.execute<{ present: boolean }>(
    sql`select to_regclass(${`${schema}.${table}`}) is not null as present`,
  )

  if (relation.rows[0]?.present !== true) {
    return 0
  }

  const counted = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from ${sql.identifier(schema)}.${sql.identifier(table)}`,
  )

  return Number(counted.rows[0]?.count ?? 0)
}

/**
 * Applique les migrations en attente, et rapporte ce qui a **réellement** été
 * joué. L'idempotence est celle de Drizzle : le journal des migrations déjà
 * appliquées vit dans la base, un second passage n'exécute rien — et le dit.
 */
/**
 * **Les codes PostgreSQL d'un objet déjà créé par quelqu'un d'autre.**
 *
 * `42P07` table déjà là, `42710` objet déjà là (type, contrainte, index), et
 * `23505` la violation d'unicité que le catalogue rend quand deux `create table`
 * du même nom se croisent (`pg_type_typname_nsp_index`). Ce sont les seuls que
 * le rejeu ci-dessous accepte : une migration réellement en échec n'est **pas**
 * rejouée, et continue d'empêcher l'application de démarrer.
 */
const CONCURRENT_CREATION_CODES: readonly string[] = ['42P07', '42710', '23505']

/**
 * Cette erreur dit-elle « quelqu'un d'autre vient de créer cet objet » ?
 *
 * **La cause est inspectée, pas seulement l'erreur** : `drizzle-orm@0.45.2`
 * enveloppe l'erreur du pilote dans une `DrizzleQueryError` (« Failed query: … »)
 * et range l'originale — celle qui porte le `code` de PostgreSQL — dans
 * `cause`. C'est la lecture déjà employée par le module `admin` pour la
 * violation de clé étrangère ; ne regarder que le premier niveau ne verrait
 * jamais le code.
 */
export function isConcurrentCreationError(error: unknown): boolean {
  for (let candidate: unknown = error; candidate != null; ) {
    if (
      typeof candidate === 'object' &&
      'code' in candidate &&
      typeof candidate.code === 'string' &&
      CONCURRENT_CREATION_CODES.includes(candidate.code)
    ) {
      return true
    }

    candidate = typeof candidate === 'object' && 'cause' in candidate ? candidate.cause : null
  }

  return false
}

/** Tentatives d'un pas de migration perdu contre un créateur concurrent. */
const CONCURRENT_ATTEMPTS = 5

export async function runMigrations(options: RunMigrationsOptions): Promise<MigrationsResult> {
  if (!hasMigrations(options.migrationsFolder)) {
    return { applied: false, count: 0 }
  }

  const schema = options.migrationsSchema ?? DEFAULT_MIGRATIONS_SCHEMA
  const table = options.migrationsTable ?? DEFAULT_MIGRATIONS_TABLE

  const before = await journalLength(options.db, schema, table)

  /**
   * **Deux migrateurs qui démarrent ensemble sur une base vierge.**
   *
   * Le cas n'est pas théorique et il ne vient pas de la production : la suite
   * de tests exécute ses fichiers en parallèle, plusieurs d'entre eux montent
   * les mêmes modules, et `pnpm test:minimal-profile` leur donne une base
   * **créée pour l'exécution** où les modules coupés n'ont pas été migrés par
   * la recette. Deux workers émettent alors le même `create table` et le
   * perdant échoue sur le catalogue — mesuré en s34.
   *
   * Le rejeu suffit à converger, et c'est une propriété du journal : le gagnant
   * l'écrit, si bien que la tentative suivante ne crée plus rien
   * (`docs/reliability.md` §1). Il est ici plutôt que chez chaque appelant —
   * mesuré aussi : rejouer d'un seul côté déplace l'échec sur l'autre.
   *
   * **Il ne rattrape que la création concurrente** : tout autre échec sort au
   * premier essai.
   *
   * Ce que cette discrimination change, dit exactement — la revue de s34 a
   * mesuré qu'elle ne change **pas** l'issue : une migration réellement en
   * échec échoue de toute façon, rejouée ou non. Drizzle ouvre **une seule
   * transaction pour toute la boucle** des migrations en attente
   * (`drizzle-orm@0.45.2/pg-core/dialect.js`, `session.transaction` autour du
   * `for await`), donc un échec annule le lot entier et la tentative suivante
   * repart du même journal, sur le même SQL — la conclusion tient, et plus
   * fermement qu'avec une transaction par migration.
   *
   * Elle change le **coût** : sans elle, un échec réel paierait cinq
   * tentatives et ~1,5 s de recul avant de se dire, dans le conteneur de
   * migration qui précède la bascule du trafic. Ce qui est éprouvé est donc le
   * classement lui-même (`isConcurrentCreationError`, `tests/migrations.test.ts`)
   * et non une issue qu'il ferait diverger. La décision et ses options écartées
   * vivent dans l'ADR 060.
   */
  for (let attempt = 1; ; attempt += 1) {
    try {
      await migrate(options.db, {
        migrationsFolder: options.migrationsFolder,
        ...(options.migrationsTable === undefined
          ? {}
          : { migrationsTable: options.migrationsTable }),
        ...(options.migrationsSchema === undefined
          ? {}
          : { migrationsSchema: options.migrationsSchema }),
      })

      break
    } catch (error) {
      if (attempt >= CONCURRENT_ATTEMPTS || !isConcurrentCreationError(error)) {
        throw error
      }

      await new Promise((accept) => setTimeout(accept, 100 * attempt))
    }
  }

  const count = (await journalLength(options.db, schema, table)) - before

  return { applied: count > 0, count }
}

/**
 * Un module au regard des migrations : ce que le contrat en dit, et rien de
 * plus. Volontairement structurel — `@repo/db` reçoit des modules, il ne lit
 * pas `config/features.ts`.
 */
export interface MigratableModule {
  readonly id: string
  /** Dossier des migrations, relatif à la racine du dépôt, ou `null`. */
  readonly migrations: string | null
}

export interface ModuleMigrationStep {
  readonly moduleId: string
  readonly migrationsFolder: string
  readonly migrationsTable: string
  readonly migrationsSchema: string
}

/** Schéma qui héberge les journaux, un par module. Convention Drizzle. */
export const MIGRATIONS_SCHEMA = 'drizzle'

const MIGRATIONS_TABLE_PREFIX = '__drizzle_migrations_'

/** Limite d'un identifiant PostgreSQL : au-delà, la troncature est silencieuse. */
const POSTGRES_IDENTIFIER_LIMIT = 63

/**
 * Journal d'un module, dérivé de son identifiant de façon stable.
 *
 * Un journal par module, et non un journal commun : c'est ce qui fait qu'activer
 * un module applique **ses** migrations sans que Drizzle croie les autres déjà
 * jouées, et que désactiver un module ne perturbe pas le décompte de ceux qui
 * restent.
 */
export function migrationsTableFor(moduleId: string): string {
  const table = `${MIGRATIONS_TABLE_PREFIX}${moduleId.replaceAll('-', '_')}`

  if (table.length > POSTGRES_IDENTIFIER_LIMIT) {
    throw new Error(
      `Identifiant de module trop long : le journal « ${table} » dépasse la limite de ` +
        `${POSTGRES_IDENTIFIER_LIMIT} caractères de PostgreSQL, qui tronquerait sans le dire — ` +
        `deux modules partageraient alors le même journal.`,
    )
  }

  return table
}

export interface PlanModuleMigrationsOptions {
  /**
   * Les modules activés, **dans l'ordre du graphe des requis**. C'est l'ordre
   * que rend `buildRegistry` : le plan le conserve, il ne retrie pas. Un tri
   * alphabétique appliquerait les tables d'un dépendant avant celles de son
   * requis.
   */
  readonly modules: readonly MigratableModule[]
  readonly repoRoot: string
}

/** Ce qu'il y a à appliquer, module par module, dans l'ordre reçu. */
export function planModuleMigrations(
  options: PlanModuleMigrationsOptions,
): readonly ModuleMigrationStep[] {
  return options.modules
    .filter((module) => module.migrations !== null)
    .map((module) => ({
      moduleId: module.id,
      migrationsFolder: join(options.repoRoot, module.migrations as string),
      migrationsTable: migrationsTableFor(module.id),
      migrationsSchema: MIGRATIONS_SCHEMA,
    }))
}

export interface ModuleMigrationOutcome {
  readonly moduleId: string
  /** Vrai seulement si ce passage a exécuté au moins une migration du module. */
  readonly applied: boolean
  readonly count: number
}

/**
 * Applique les migrations des modules, dans l'ordre du plan.
 *
 * Aucune notion de module désactivé ici : un module absent du plan n'a rien à
 * appliquer, et il n'y a donc rien à ignorer. C'est ce qui fait qu'une base
 * vierge ne porte aucune trace d'un module non activé — pas un `if`, une
 * absence.
 *
 * ## Course connue, établie et **non corrigée** (s52)
 *
 * `CREATE TABLE "organization"` en échec, vu une fois sur la demande de fusion
 * 12. Cause établie par lecture : `tests/auth.test.ts`, `tests/billing.test.ts`,
 * `tests/organizations.test.ts` et `tests/marketing.test.ts` appellent chacun
 * cette fonction dans leur `beforeAll`, contre la **même** base, dans des
 * travailleurs Vitest parallèles. L'idempotence de Drizzle repose sur le
 * journal en base — elle n'est pas concurrente : deux passages simultanés le
 * lisent vide, puis exécutent la même migration.
 *
 * Ce n'est pas propre à la suite : deux instances qui démarrent ensemble
 * feraient la même chose. Le correctif — un verrou consultatif PostgreSQL
 * autour de `migrate`, ou une passe unique avant les travailleurs — change le
 * contrat de migration de ce package et demande une connexion dédiée (un
 * verrou de session pris sur une connexion du pool serait relâché sur une
 * autre). C'est une décision de structure : elle se prend au plan, pas dans la
 * story qui a classé le cas.
 */
export async function runModuleMigrations(options: {
  readonly db: RunMigrationsOptions['db']
  readonly plan: readonly ModuleMigrationStep[]
}): Promise<readonly ModuleMigrationOutcome[]> {
  const outcomes: ModuleMigrationOutcome[] = []

  for (const step of options.plan) {
    const { applied, count } = await runMigrations({
      db: options.db,
      migrationsFolder: step.migrationsFolder,
      migrationsTable: step.migrationsTable,
      migrationsSchema: step.migrationsSchema,
    })

    outcomes.push({ moduleId: step.moduleId, applied, count })
  }

  return outcomes
}
