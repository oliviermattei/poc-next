import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * La table du module `onboarding` — **une, et pas une de plus**.
 *
 * Elle n'existe que lorsque le module est activé : `pnpm db:generate` ne génère
 * que pour les modules de `config/features.ts`, et sur une base vierge dont la
 * configuration ne le nomme pas, elle n'est pas créée. C'est le critère 8 de la
 * story, et `pnpm test:minimal-profile` le mesure sur le **schéma réel**
 * (`information_schema`), jamais sur les fichiers de migration.
 *
 * **Pourquoi une table, et pas une colonne sur le compte** : une colonne ferait
 * d'`auth` — le socle — le propriétaire d'une donnée appartenant à un module
 * **optionnel**, ce que l'ADR 018 refuse. Couper `onboarding` laisserait alors
 * une colonne orpheline dans une table que personne ne peut couper.
 *
 * **Aucune clé étrangère vers `auth_user`, et c'est la décision de `storage` et
 * de `notifications`, pour leur raison** : une cascade effacerait la ligne sans
 * passer par `purge`, et le module perdrait la seule porte où l'effacement est
 * observable (`docs/reliability.md` §1). La suppression de compte passe par
 * `purgeModules` (ADR 029), qui exécute ce module **avant** `auth`.
 */
export const onboardingProgress = pgTable('onboarding_progress', {
  /**
   * Le compte, **et la clé primaire** : un compte a un parcours, jamais deux.
   * C'est la base qui le tient — deux écritures concurrentes passeraient toutes
   * deux un `select` préalable —, et c'est aussi ce qui rend l'écriture
   * idempotente (`onConflictDoUpdate`, jamais « lire puis choisir »).
   */
  userId: text('user_id').primaryKey(),
  /**
   * Les étapes franchies, dans l'ordre où elles l'ont été.
   *
   * Des identifiants d'étapes, jamais de modules : une étape que plus aucun
   * module ne propose est **ignorée** à la lecture (`courseOf`), pas refusée.
   */
  clearedSteps: jsonb('cleared_steps').$type<readonly string[]>().notNull(),
  /**
   * **La porte à sens unique** (critère 5) : non nulle, le parcours n'est plus
   * proposé, quoi qu'il advienne ensuite des modules activés.
   */
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
})

/** Les tables du module, telles que le contrat les déclare. */
export const onboardingSchema = { onboardingProgress } as const
