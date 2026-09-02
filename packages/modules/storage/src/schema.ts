import { index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * La table du module `storage` — **une seule**.
 *
 * Elle n'existe que lorsque le module est activé : `pnpm db:generate` ne génère
 * que pour les modules de `config/features.ts`, et sur une base vierge dont la
 * configuration ne nomme pas ce module, elle n'est pas créée. C'est le critère 7
 * de la story.
 *
 * **Aucune clé étrangère, et c'est une décision.** `docs/architecture.md` place
 * le propriétaire d'un fichier derrière une fonction unique
 * (`resolveDataOwner`), qui rend un compte **ou** une organisation selon que le
 * module `organizations` est activé. Une clé étrangère vers `organization`
 * obligerait ce module à déclarer `organizations` dans ses requis (ADR 018),
 * donc rendrait le stockage indisponible en mode mono-utilisateur — exactement
 * ce que le produit refuse.
 *
 * Une clé étrangère vers `auth_user` serait permise (`auth` est un requis
 * déclaré), et elle est **volontairement absente** : une cascade effacerait la
 * ligne sans effacer l'objet stocké, et le fichier survivrait à la suppression
 * du compte, sans plus rien pour le désigner. C'est le défaut que s16 a laissé
 * passer sur une adresse, retourné. La suppression passe donc par `purge`, qui
 * supprime **l'objet puis la ligne**, et l'ordre du graphe (ADR 029) la fait
 * s'exécuter **avant** celle de `auth`.
 *
 * Conséquence assumée, et il faut la lire : une ligne de `auth_user` effacée
 * **hors** de `purgeModules` — un `delete` à la main dans la base — laisserait
 * une ligne de `storage_file` sans compte. `docs/reliability.md` §5 demande une
 * commande de réconciliation pour tout état divergent ; celle-ci appartient à
 * s34, avec la suppression de compte, et elle est nommée ici pour être trouvée.
 */

export const storageFile = pgTable(
  'storage_file',
  {
    id: text('id').primaryKey(),
    /** `user` ou `organization` — la forme exacte de `ModuleScope`. */
    ownerKind: text('owner_kind').notNull(),
    ownerId: text('owner_id').notNull(),
    /** `avatar` aujourd'hui, et c'est la seule valeur écrite par cette story. */
    purpose: text('purpose').notNull(),
    /** La clé d'objet chez le fournisseur. Fabriquée par le module, jamais reçue. */
    storageKey: text('storage_key').notNull(),
    /** Le type **vérifié sur les octets**, jamais celui déclaré par le client. */
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    // **Un seul fichier par propriétaire et par usage**, et c'est la base qui le
    // tient — jamais une vérification préalable, qui laisse une fenêtre de
    // concurrence (`docs/reliability.md` §1). C'est aussi ce qui fait qu'un
    // remplacement est une écriture et non deux, donc qu'il ne peut pas laisser
    // deux lignes désignant deux objets.
    uniqueIndex('storage_file_owner_purpose_key').on(
      table.ownerKind,
      table.ownerId,
      table.purpose,
    ),
    // La question de la purge et de l'export : « que possède ce périmètre ? ».
    // Sans lui, chaque suppression de compte balaye la table.
    index('storage_file_owner_idx').on(table.ownerKind, table.ownerId),
  ],
)

/** Les tables du module, telles que le contrat les déclare. */
export const storageSchema = { storageFile } as const
