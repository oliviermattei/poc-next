import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * La table du module `feedback` — **une, et pas une de plus** (s43).
 *
 * Elle n'existe que lorsque le module est activé : `pnpm db:generate` ne génère
 * que pour les modules de `config/features.ts`, et sur une base vierge dont la
 * configuration ne le nomme pas, elle n'est pas créée. C'est le critère 6, et
 * `pnpm test:minimal-profile` le mesure sur le **schéma réel**
 * (`information_schema`), jamais sur les fichiers de migration.
 *
 * **Aucune clé étrangère, et c'est la décision de `notifications` et de
 * `storage`**, pour leurs deux raisons :
 *
 * 1. vers `organization` : elle obligerait ce module à déclarer `organizations`
 *    dans ses requis (ADR 018), donc rendrait les retours indisponibles en mode
 *    mono-utilisateur — alors que le périmètre d'un retour est une **donnée**,
 *    résolue par le point de composition ;
 * 2. vers `auth_user` : elle serait permise (`auth` est un requis déclaré), et
 *    elle est volontairement absente. Une cascade effacerait les lignes sans
 *    passer par `purge`, et le module perdrait la seule porte où l'effacement
 *    est observable — `docs/reliability.md` §1 veut la purge **rejouable et
 *    mesurée**, pas déléguée à une contrainte.
 *
 * Conséquence assumée, la même que celle des deux autres : une ligne de
 * `auth_user` effacée **hors** de `purgeModules` laisserait un retour sans
 * auteur. La suppression de compte passe par `purgeModules` (ADR 029).
 */
export const feedback = pgTable(
  'feedback',
  {
    id: text('id').primaryKey(),
    /** Le compte qui a envoyé le retour (critère 2). */
    authorId: text('author_id').notNull(),
    /**
     * L'organisation qu'il avait sous les yeux, ou `null` en mode
     * mono-utilisateur — le module `organizations` peut être coupé.
     */
    organizationId: text('organization_id'),
    /** `bug`, `idea` ou `other` : le vocabulaire fermé du `domain`. */
    category: text('category').notNull(),
    message: text('message').notNull(),
    /**
     * **Le chemin de la page d'origine, jamais l'URL reçue** (critère 2).
     *
     * La valeur vient d'un champ caché du formulaire, donc de l'appelant :
     * `parseOriginPath` l'a réduite à un chemin interne borné avant d'arriver
     * ici, et `null` est le résultat normal d'une valeur refusée.
     */
    originPath: text('origin_path'),
    /** `open` ou `handled` : le statut du critère 5. */
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    /** Vide tant que personne n'a marqué le retour comme traité. */
    handledAt: timestamp('handled_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    // La question de l'écran du back-office : « les retours, les plus récents
    // en premier », et ses deux filtres. Sans ces index, chaque affichage
    // balaie la table.
    index('feedback_created_idx').on(table.createdAt),
    index('feedback_status_idx').on(table.status),
    index('feedback_category_idx').on(table.category),
    // La question de la purge et de l'export : « les retours de ce compte ».
    index('feedback_author_idx').on(table.authorId),
  ],
)

/** Les tables du module, telles que le contrat les déclare. */
export const feedbackSchema = { feedback } as const
