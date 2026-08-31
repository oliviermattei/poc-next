import type { OrganizationRole } from './organization'

/**
 * Les événements de sécurité du module (`docs/security.md` §7, qui nomme
 * explicitement « changement de rôle »).
 *
 * **La forme est fermée, et c'est toute la garde.** Le module `auth` a le même
 * besoin et deux gardes : une forme fermée *plus* un filtrage des valeurs, parce
 * que son enregistrement porte un `details` ouvert
 * (`Record<string, string|number|boolean>`) où n'importe quoi peut entrer — une
 * URL de vérification avec son jeton, par exemple. Ici il n'y a **aucun champ
 * libre** : chaque champ est nommé ci-dessous, et l'interface est la liste — un
 * compte écrit à côté d'elle vieillirait, celui-ci disait « cinq » pour six
 * (revue de s17, F2). Il n'existe pas d'emplacement où glisser un secret, et
 * c'est le compilateur qui le tient. Les deux valeurs qui viennent du corps de
 * la requête passent par Zod avant d'entrer ici.
 *
 * Recopier le filtrage d'`auth` serait pire que inutile : son
 * `SECRET_VALUE_PATTERN` (`/[A-Za-z0-9_\-+/=.]{16,}/`) attraperait les
 * identifiants de compte de ce dépôt (`usr_` suivi d'un UUID, 40 caractères) et
 * journaliserait `[filtré]` à la place de la cible d'un changement de rôle,
 * c'est-à-dire l'information même que le §7 demande.
 *
 * **Pourquoi ce n'est pas le journal d'`auth`.** `pnpm lint` refuse
 * `@repo/module-auth` dans ce module hors de `src/schema.ts` et
 * `src/infrastructure/scoped-reads.ts` (revue de s16, F9) : c'est la borne qui
 * rend l'absence d'énumération de comptes structurelle. Elle ne cède pas pour un
 * journal.
 *
 * **Ce n'est pas non plus un journal d'audit métier** : celui-là est au cimetière
 * du PRD, et `docs/security.md` le rappelle en clôture. Ce qui sort d'ici va
 * dans la sortie standard du processus, comme le journal d'`auth`, jusqu'au port
 * de supervision de s39.
 */
export type OrganizationSecurityEventName =
  /** Un rôle a changé. Transfert de propriété compris. */
  | 'organizations.role_changed'
  /**
   * Un changement de rôle **refusé faute de droit**.
   *
   * Journalisé parce que c'est le signal d'une tentative d'élévation, et pour la
   * même raison que le module `auth` journalise `auth.session_revocation_refused`.
   * Les refus **métier** — dernier propriétaire, cible absente, rôle inconnu — ne
   * le sont pas : ce sont des erreurs d'usage, pas des tentatives.
   */
  | 'organizations.role_change_refused'

export interface OrganizationSecurityEvent {
  readonly event: OrganizationSecurityEventName
  /** Le compte qui agit. Un identifiant, jamais une adresse — elle nomme une personne. */
  readonly actor: string
  readonly organizationId: string
  /**
   * Le compte visé. Un identifiant, pour la même raison.
   *
   * `null` **au refus seulement** : la permission est décidée avant la
   * validation (ADR 030, revue de s17 F5), donc un corps qui ne nomme aucune
   * cible valide est refusé avant qu'on en connaisse une. Le journal dit alors
   * `null` plutôt que d'écrire ce qui est arrivé tel quel.
   */
  readonly target: string | null
  /** Le rôle demandé, `null` au refus quand le corps n'en nommait pas un connu. */
  readonly role: OrganizationRole | null
  /** Le geste était-il un transfert de propriété ? */
  readonly transfersOwnership: boolean
}
