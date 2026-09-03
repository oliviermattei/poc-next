import { index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * Les tables du module `marketing` — **trois, et pas une de plus**.
 *
 * Elles n'existent que lorsque le module est activé : `pnpm db:generate` ne
 * génère que pour les modules de `config/features.ts`, et sur une base vierge
 * dont la configuration ne nomme pas ce module, aucune des deux n'est créée.
 * C'est le quatrième critère de s11, et `tests/marketing.test.ts` le vérifie en
 * lisant `information_schema`, pas les fichiers de migration.
 *
 * **Aucune clé étrangère**, et c'est une propriété, pas un oubli : une
 * inscription publique est faite par quelqu'un **qui n'a pas de compte** — c'est
 * tout l'objet d'une newsletter. Une référence vers `auth_user` obligerait ce
 * module à déclarer `auth` dans ses requis (ADR 018) pour lier une donnée qui,
 * neuf fois sur dix, ne se lie à rien.
 *
 * `contact_message` a d'abord été écartée — « un schéma que rien n'écrit » — et
 * la revue a montré la conséquence : un envoi en échec rendait 502 et le message
 * du visiteur disparaissait, sans reprise possible (constat F8). Elle est donc
 * livrée, avec un lecteur : la purge et l'export du contrat, et une date de
 * remise vide quand le fournisseur n'a pas pris le message.
 */

/**
 * Les inscriptions publiques — **un seul modèle**, distingué par sa source.
 *
 * La story le dit explicitement : cette table est réutilisée par s42 pour la
 * liste d'attente, et un second modèle concurrent est interdit. `source` vient
 * de `config/marketing.ts` ; le module ne l'écrit nulle part.
 *
 * L'unicité porte sur **le couple `(source, email)`** et elle est **en base** :
 * `docs/reliability.md` §1 refuse une vérification préalable, qui laisse une
 * fenêtre où deux soumissions simultanées passent toutes les deux le `select`.
 * C'est cette contrainte, et elle seule, qui rend une seconde soumission
 * identique sans effet supplémentaire — critère 2 de la story.
 *
 * L'adresse est stockée **normalisée** (`normaliseEmail`, dans le `domain`) :
 * sans cela « A@B.co » et « a@b.co » sont deux lignes et deux emails.
 */
export const publicSubscription = pgTable(
  'public_subscription',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    /** `newsletter` aujourd'hui, `waitlist` en s42. La colonne qui les sépare. */
    source: text('source').notNull(),
    /** La langue de la requête d'inscription : celle de l'email de confirmation. */
    locale: text('locale').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('public_subscription_source_email_key').on(table.source, table.email),
    // La question que le back-office de s37 posera : « qui est inscrit à quoi ».
    index('public_subscription_source_idx').on(table.source),
  ],
)

/**
 * Le compteur de la limitation de débit des formulaires publics (s11) —
 * **abandonné depuis s28**.
 *
 * `docs/security.md` §7 exige une limite « partagée entre instances » ; un
 * compteur en mémoire de processus se contourne en scalant horizontalement,
 * c'est le piège que s28 a généralisé. Une ligne par seau et par fenêtre,
 * incrémentée par une seule instruction atomique — la forme que
 * `rate_limit_window` porte désormais pour tout le dépôt.
 *
 * `bucket` est un **condensat** : l'identifiant d'appelant — une adresse IP,
 * quand un en-tête en donne une — n'entre jamais en clair dans cette table.
 * C'est pour cela qu'elle n'est pas déclarée comme catégorie de données au
 * contrat : aucune requête de ce module ne peut relier une de ces lignes à un
 * compte. La question reste discutable, et elle est écrite comme telle dans
 * `docs/research/s11-public-forms.md` §6.4.
 *
 * **Abandonnée par s28, et volontairement pas supprimée.** Le compteur a
 * convergé vers le port partagé (ADR 050) : **plus rien n'écrit ici**. La table
 * reste parce que `docs/reliability.md` impose de cesser d'écrire **avant** de
 * supprimer, et que la version encore en ligne l'écrit pendant une bascule — s27
 * a mesuré qu'elle n'est pas instantanée. Sa suppression est une **story
 * ultérieure** ; `tests/rate-limiting.test.ts` refuse à la fois qu'on la
 * réécrive et qu'on la supprime ici.
 */
export const publicFormThrottle = pgTable(
  'public_form_throttle',
  {
    /** Condensat du seau : `<formulaire>:client:<identifiant>` ou `<formulaire>:all`. */
    bucket: text('bucket').primaryKey(),
    /** Début de la fenêtre fixe en cours, aligné sur sa durée. */
    windowStartedAt: timestamp('window_started_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** Soumissions comptées dans cette fenêtre, celle en cours comprise. */
    hits: integer('hits').notNull(),
  },
  (table) => [
    // L'effacement des fenêtres closes porte sur cette colonne : sans index, il
    // balaierait la table entière à chaque bascule de fenêtre.
    index('public_form_throttle_window_idx').on(table.windowStartedAt),
  ],
)

/**
 * Les messages de contact reçus — **enregistrés avant d'être envoyés**.
 *
 * `docs/architecture.md` attribue cette table à ce module ; s11 l'avait d'abord
 * écartée, faute de lecteur applicatif. La revue a nommé le prix : l'envoi
 * échoue, la route rend 502, et le message est perdu sans que personne ne puisse
 * le rattraper (constat F8). Il est désormais écrit d'abord, envoyé ensuite.
 *
 * `delivered_at` **nullable**, et c'est toute la propriété : une ligne sans date
 * de remise est un message reçu que le fournisseur n'a pas pris. C'est la trace
 * exploitable, et c'est aussi ce qui rend acceptable la suspension des envois
 * quand le seau du formulaire sature (constat F2).
 *
 * Le lecteur est le contrat lui-même : la catégorie `contact-message` est
 * déclarée, donc l'export la rend et la purge l'efface. Une donnée personnelle
 * sans ces deux-là n'aurait pas dû être écrite.
 */
export const contactMessage = pgTable(
  'contact_message',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** L'adresse du visiteur : la clé du périmètre de purge et d'export. */
    email: text('email').notNull(),
    message: text('message').notNull(),
    /** La langue de la requête : celle dans laquelle l'email est parti. */
    locale: text('locale').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    /** Vide tant que le fournisseur n'a pas pris le message. */
    deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    // La question de la purge et de l'export : « les messages de cette adresse ».
    index('contact_message_email_idx').on(table.email),
  ],
)

/** Les tables du module, telles que le contrat les déclare. */
export const marketingSchema = {
  publicSubscription,
  publicFormThrottle,
  contactMessage,
} as const
