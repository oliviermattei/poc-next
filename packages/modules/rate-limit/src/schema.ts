import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * **Le compteur de la limitation de débit** (s28) — une table, et une seule
 * dans tout le dépôt.
 *
 * `docs/security.md` §7 exige une limite « partagée entre instances » sur tout
 * point d'entrée public. Un compteur en mémoire de processus se contourne en
 * scalant horizontalement : deux instances, deux fois le seuil, et personne ne
 * s'en aperçoit. Une ligne par seau et par fenêtre, incrémentée par **une
 * seule** instruction atomique (`infrastructure/drizzle-rate-limiter.ts`).
 *
 * **`bucket` est un condensat.** L'identifiant d'appelant — une adresse IP,
 * quand un en-tête en donne une — et le compte visé — une adresse email —
 * n'entrent jamais en clair dans cette table. C'est pour cela qu'elle n'est pas
 * déclarée comme catégorie de données au contrat : aucune requête ne peut relier
 * une de ces lignes à un compte. La **journalisation**, elle, ne condense pas —
 * le critère 6 demande l'IP et la route —, et les deux règles diffèrent
 * sciemment : une ligne de compteur survit à l'incident, une ligne de journal
 * l'explique.
 *
 * **Ce qu'elle remplace, et ce qu'elle ne supprime pas.**
 * `public_form_throttle` (s11) et `billing_checkout_throttle` (s24) portent la
 * même forme, chacune dans son module. s28 fait converger les points d'entrée
 * ici et **cesse d'écrire** dans les deux ; elles restent en place, vides et
 * inertes. Les supprimer dans la même livraison casserait la version encore en
 * ligne, qui y écrit toujours pendant le basculement — `docs/reliability.md`
 * impose « cesser d'écrire avant de supprimer », et s27 a mesuré que le
 * basculement n'est pas instantané. Leur suppression est une story ultérieure
 * (ADR 050).
 */
export const rateLimitWindow = pgTable(
  'rate_limit_window',
  {
    /** Condensat du seau : `<route>:client:<identifiant>` ou `<route>:subject:<compte>`. */
    bucket: text('bucket').primaryKey(),
    /** Début de la fenêtre fixe en cours, aligné sur sa durée. */
    windowStartedAt: timestamp('window_started_at', { withTimezone: true, mode: 'date' }).notNull(),
    /**
     * **L'instant où la fenêtre de ce seau se ferme** — et la raison pour
     * laquelle cette colonne existe.
     *
     * La table est **partagée** par toutes les routes depuis s28, et les seaux
     * n'ont pas tous la même durée : 300 s pour la connexion, 600 s pour un
     * formulaire public, 3600 s pour un seau par compte visé. Un balayage qui
     * ne connaîtrait que `window_started_at` ne pourrait pas dire si une ligne
     * est close — il ne saurait que la comparer à un instant qu'on lui donne, et
     * effacerait les seaux longs **encore ouverts** des autres routes.
     *
     * C'est exactement le défaut que la revue de s28 a mesuré (constat C1) :
     * `marketing` balayant sa fenêtre de dix minutes remettait à zéro les seaux
     * horaires de la réinitialisation de mot de passe, du magic link et de
     * l'invitation — déclenchable à distance par un POST vide, toutes les dix
     * minutes.
     *
     * L'échéance est donc **portée par la ligne**, écrite au moment du passage,
     * et le balayage n'est plus qu'une comparaison à l'instant présent.
     */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** Passages comptés dans cette fenêtre, celui en cours compris. */
    hits: integer('hits').notNull(),
  },
  (table) => [
    // L'effacement des fenêtres closes porte sur cette colonne : sans index, il
    // balaierait la table entière à chaque passage.
    index('rate_limit_window_expires_idx').on(table.expiresAt),
  ],
)

/** Les tables du module, telles que le contrat les déclare. */
export const rateLimitSchema = { rateLimitWindow } as const
