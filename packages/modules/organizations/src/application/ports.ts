import type { Mailer } from '@repo/ports'

import type { OrganizationRole } from '../domain/organization'
import type { MembershipRecord, OrganizationAccess } from './organization-access'

/**
 * Les **ports** du module (ADR 006) : ce dont les cas d'usage ont besoin, dit
 * par eux, sans savoir qui l'implémente. `infrastructure/` les branche sur
 * Drizzle et sur la connexion que le point de composition injecte — ce module
 * n'importe jamais `@repo/db` (ADR 020).
 *
 * **Les deux écritures qui touchent une organisation existante exigent un
 * `OrganizationAccess`**, jamais un identifiant nu. C'est le compilateur qui
 * tient le périmètre organisationnel : passer l'identifiant reçu du client ne
 * compile pas.
 */

/** Ce que rend une écriture dont l'identifiant public peut déjà être pris. */
export type SlugOutcome = 'ok' | 'slug_unavailable'

export interface OrganizationRepository {
  /**
   * L'appartenance de **ce** compte à **cette** organisation, ou `null`.
   *
   * En **un seul ordre**, portant les deux conditions
   * (`organization.id = ? and organization_member.user_id = ?`). Le compte fait
   * partie du prédicat, il n'est pas vérifié avant : une vérification préalable
   * suivie d'une lecture laisse la fenêtre où l'on sert la donnée d'autrui
   * (`docs/security.md` §3, et le précédent de `revokeForUser` dans le module
   * `auth`). Le `null` ne distingue pas « pas membre » de « n'existe pas » — la
   * requête elle-même ne les distingue pas.
   */
  findMembership(input: {
    readonly userId: string
    readonly organizationId: string
  }): Promise<MembershipRecord | null>

  /** Les appartenances du compte, par nom d'organisation. */
  listMemberships(userId: string): Promise<readonly MembershipRecord[]>

  /**
   * Crée l'organisation **et** l'appartenance de son créateur.
   *
   * Les deux ensemble : une organisation sans membre serait une ressource que
   * plus personne ne peut atteindre. L'unicité de l'identifiant public est
   * celle de la **base** — la violation est traduite en `slug_unavailable`,
   * jamais devancée par un `select` (`docs/reliability.md` §1).
   */
  createOrganization(input: {
    readonly organizationId: string
    readonly membershipId: string
    readonly name: string
    readonly slug: string
    readonly userId: string
    readonly role: OrganizationRole
  }): Promise<SlugOutcome>

  /** Renomme l'organisation **à laquelle l'appelant a été autorisé**, et elle seule. */
  renameOrganization(
    access: OrganizationAccess,
    draft: { readonly name: string; readonly slug: string },
  ): Promise<SlugOutcome>

  /** L'organisation courante du compte, ou `null`. Persistée, donc survit à la session. */
  findActiveOrganizationId(userId: string): Promise<string | null>

  /** Pose l'organisation courante. Rejouable : un second appel n'ajoute rien. */
  setActiveOrganization(access: OrganizationAccess): Promise<void>

  /** Efface les appartenances et la sélection courante d'un compte. */
  deleteMembershipsOf(userId: string): Promise<void>

  /** Efface une organisation. Ses appartenances suivent par cascade. */
  deleteOrganization(organizationId: string): Promise<void>

  /** Les membres d'une organisation, pour l'export du périmètre organisation. */
  listMembersOf(organizationId: string): Promise<readonly MembershipRecord[]>

  /* ----------------------------------------------------------------------- *
   * s16 — l'invitation, l'acceptation, le retrait.
   *
   * Toutes les opérations d'organisation exigent un `OrganizationAccess` :
   * c'est le compilateur qui tient le périmètre, comme pour le renommage.
   * **Deux exceptions, et elles sont écrites** : `consumeInvitation` et
   * `describeInvitation` prennent une empreinte de jeton, parce que le jeton
   * **est** l'autorisation — l'invité n'est justement pas encore membre ;
   * `emailOf` prend un compte, et le compte est son propre propriétaire.
   * ----------------------------------------------------------------------- */

  /** Les membres, avec l'adresse qui les nomme à l'écran. */
  listMemberIdentities(access: OrganizationAccess): Promise<readonly MemberIdentity[]>

  /** Les invitations ni acceptées ni révoquées — donc en attente ou échues. */
  listLiveInvitations(access: OrganizationAccess): Promise<readonly InvitationRecord[]>

  /** Combien d'invitations cette organisation a émises depuis cet instant. */
  countInvitationsIssuedSince(access: OrganizationAccess, since: Date): Promise<number>

  /**
   * Écrit une invitation. L'unicité est celle de la **base** : une seconde
   * invitation vivante pour la même adresse est refusée par la contrainte, et
   * la violation est traduite — jamais devancée par un `select`
   * (`docs/reliability.md` §1).
   */
  createInvitation(
    access: OrganizationAccess,
    invitation: {
      readonly invitationId: string
      readonly email: string
      readonly role: OrganizationRole
      readonly tokenHash: string
      readonly expiresAt: Date
      readonly invitedBy: string
      /**
       * L'instant d'émission, **écrit** et non laissé au `default now()` de la
       * base : le quota compte sur une fenêtre glissante, et une horloge de base
       * mélangée à l'horloge injectée rend cette fenêtre inobservable — mesuré,
       * le cas du quota passait au vert avec vingt-et-une invitations.
       */
      readonly now: Date
    },
  ): Promise<InvitationOutcome>

  /**
   * Le renvoi : **une émission de plus**, donc une ligne de plus.
   *
   * La ligne précédente est éteinte dans la **même transaction** — révoquée, et
   * son empreinte remplacée par celle d'un jeton que personne n'a reçu, si bien
   * que l'ancien lien ne désigne plus rien (« inconnu », jamais « révoquée »).
   * Une seule invitation vivante subsiste donc pour l'adresse, ce que l'index
   * unique partiel impose de toute façon.
   *
   * **Pourquoi une ligne et non une rotation en place** : le quota de l'ADR 026
   * est un quota d'**émission**, compté sur `created_at`. Tant que le renvoi
   * réécrivait la même ligne, il n'était compté par rien — cinquante renvois
   * consécutifs envoyaient cinquante emails sans un seul refus (revue de s16,
   * F2). Une émission = une ligne : le comptage n'a plus de trou à combler.
   */
  reissueInvitation(
    access: OrganizationAccess,
    reissue: {
      /** L'invitation renvoyée, celle que l'écran désigne. */
      readonly invitationId: string
      /** L'identifiant de la ligne neuve : c'est elle qui portera le lien. */
      readonly issuedInvitationId: string
      readonly tokenHash: string
      /** L'empreinte qui remplace celle de la ligne éteinte. Aucun jeton ne la produit. */
      readonly supersededTokenHash: string
      readonly expiresAt: Date
      readonly invitedBy: string
      readonly now: Date
    },
  ): Promise<{ readonly email: string } | null>

  /** Révoque une invitation vivante. `false` si elle n'existe pas, ou plus. */
  revokeInvitation(
    access: OrganizationAccess,
    invitation: { readonly invitationId: string; readonly now: Date },
  ): Promise<boolean>

  /**
   * L'invitation que ce jeton désigne, quel que soit son état — c'est ce qui
   * permet de dire « expirée », « révoquée » ou « déjà acceptée » plutôt qu'un
   * refus générique (critère 3).
   */
  describeInvitation(tokenHash: string): Promise<InvitationRecord | null>

  /**
   * **Consomme** l'invitation et écrit l'appartenance, en un seul ordre
   * conditionnel puis une insertion idempotente.
   *
   * Le prédicat porte tout : l'empreinte, l'adresse du destinataire, et les
   * trois conditions de vie. Un second appel concurrent ne trouve donc plus
   * rien — c'est ce qui rend l'acceptation rejouable sans seconde appartenance,
   * sans aucune vérification préalable.
   */
  consumeInvitation(consumption: {
    readonly tokenHash: string
    readonly email: string
    readonly userId: string
    readonly membershipId: string
    readonly now: Date
  }): Promise<{ readonly organizationId: string } | null>

  /**
   * Retire une appartenance. Le prédicat porte **lui-même** la règle du dernier
   * propriétaire : une lecture suivie d'un `delete` laisserait la fenêtre où
   * deux propriétaires se retirent simultanément.
   */
  removeMember(access: OrganizationAccess, userId: string): Promise<boolean>

  /** L'adresse d'un compte, telle que l'acceptation la compare à l'invitation. */
  emailOf(userId: string): Promise<string | null>

  /**
   * Les invitations adressées à ce compte, pour son **export**.
   *
   * L'adresse est celle du compte, lue sur lui : le périmètre est le compte,
   * comme pour `listMemberships`.
   */
  listInvitationsAddressedTo(
    userId: string,
    email: string,
  ): Promise<readonly InvitationRecord[]>

  /**
   * Efface les invitations adressées à cette adresse, **dans toutes les
   * organisations**, et rend le nombre de lignes effacées.
   *
   * C'est la purge de la catégorie `invitation` : `organization_invitation.email`
   * est l'adresse d'une personne, souvent sans compte, et rien d'autre ne
   * l'efface — la cascade de `organization` ne joue que pour la purge d'une
   * organisation, et les clés étrangères vers `auth_user` ne portent que
   * l'auteur et le consommateur, jamais le destinataire.
   */
  deleteInvitationsAddressedTo(email: string): Promise<number>
}

/** Un membre, tel que l'écran le nomme. */
export interface MemberIdentity {
  readonly userId: string
  readonly email: string
  readonly role: OrganizationRole
}

/** Une invitation, telle que le module la lit. Aucun jeton n'en sort. */
export interface InvitationRecord {
  readonly id: string
  readonly organizationId: string
  readonly organizationName: string
  readonly email: string
  readonly role: OrganizationRole
  readonly expiresAt: Date
  readonly acceptedAt: Date | null
  readonly revokedAt: Date | null
}

/** Ce que rend une écriture d'invitation dont l'adresse peut déjà être invitée. */
export type InvitationOutcome = 'ok' | 'already_invited'

export interface OrganizationsDependencies {
  readonly repository: OrganizationRepository
  /**
   * Les identifiants publics que le produit se réserve.
   *
   * **Reçus, jamais écrits ici** : les routes du système sont celles de
   * l'application, pas celles du module. Le point de composition les dérive de
   * la navigation du registre, des langues servies et des écrans de
   * l'application ; `tests/organizations.test.ts` refuse qu'un segment
   * réellement servi manque à l'appel.
   */
  readonly reservedSlugs: ReadonlySet<string>
  /** Fabrique d'identifiants. Injectée : un `domain` ne connaît pas `node:crypto`. */
  readonly generateId: (prefix: string) => string
  /**
   * Le port d'envoi d'emails (`@repo/ports`).
   *
   * Le module ne saura jamais si c'est Resend ou la capture locale qui
   * l'exécute — c'est exactement ce que ce port existe pour garantir. Il **ne
   * lève pas** : l'échec est un résultat, et l'invitation reste alors en
   * attente, donc renvoyable (`docs/reliability.md` §2).
   */
  readonly mailer: Mailer
  /**
   * L'URL publique de l'application, **reçue** et jamais déduite d'un en-tête
   * `Host` : la déduire laisserait un attaquant faire pointer un lien
   * d'invitation vers son propre domaine (`apps/web/AGENTS.md`).
   */
  readonly appUrl: string
  /**
   * La langue de l'email d'invitation.
   *
   * C'est celle du **site**, parce qu'un destinataire dont rien n'est connu n'en
   * a pas d'autre — la règle est écrite au même endroit pour le module `auth`
   * (`AuthService.localeOf` : « `null` est le destinataire dont rien n'est
   * connu — invitation, guest checkout, liste d'attente »).
   */
  readonly emailLocale: string
  /** L'horloge, injectée : une échéance non injectée est une échéance non testable. */
  readonly now: () => Date
  /** Fabrique de jetons : un secret imprévisible et son empreinte. */
  readonly tokens: InvitationTokenFactory
}

/**
 * La fabrique du jeton d'invitation, **injectée**.
 *
 * Son implémentation vit dans `infrastructure/` parce qu'elle a besoin de
 * `node:crypto` ; l'`application` n'en connaît que la forme, et le `domain`
 * ignore jusqu'à son existence.
 */
export interface InvitationTokenFactory {
  /** Un secret imprévisible. Il ne doit jamais être écrit en base. */
  generate(): string
  /** L'empreinte du secret. C'est **elle** que la base garde. */
  digest(token: string): string
}
