import type { ModuleExportPayload, ModuleScope } from '@repo/core'
import { z } from 'zod'

import {
  alreadyMember,
  exceedsInvitationQuota,
  INVITATION_EMAIL_TEMPLATE,
  INVITATION_QUOTA_WINDOW_SECONDS,
  INVITATION_SCREEN_PATH,
  INVITED_ROLE,
  invitationExpiry,
  invitationStatus,
  isInvitationUsable,
  normalizeEmail,
  parseInvitationEmail,
  refusalForStatus,
  removalRefusal,
  type InvitationRefusal,
  type InvitationStatus,
} from '../domain/invitation'
import {
  FOUNDER_ROLE,
  ORGANIZATIONS_MODULE_ID,
  parseOrganizationDraft,
  type OrganizationRefusal,
  type OrganizationRole,
} from '../domain/organization'
import { authorizeOrganization, type OrganizationAccess } from './organization-access'
import type { OrganizationsDependencies } from './ports'

/**
 * Les cas d'usage du module : créer, basculer, renommer, décrire, purger,
 * exporter.
 *
 * Deux invariants traversent ce fichier, et ils ne sont pas décoratifs :
 *
 * 1. **Aucune écriture ne reçoit un identifiant d'organisation nu.** Elles
 *    exigent un `OrganizationAccess`, que seule la lecture conjointe produit
 *    (`organization-access.ts`). Le compilateur refuse le contraire.
 * 2. **L'autorisation vient avant la validation.** Un non-membre reçoit
 *    `not_found`, quel que soit son corps de requête — sinon un formulaire mal
 *    rempli distinguerait « l'organisation existe et je n'y suis pas » de
 *    « elle n'existe pas » (`docs/security.md` §7).
 */

/** Une organisation telle qu'un écran la voit. Ni identifiant technique caché, ni jeton. */
export interface OrganizationSummary {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly role: OrganizationRole
}

/**
 * Ce que l'écran des organisations affiche.
 *
 * **La forme est la même quand le module est coupé** — deux champs, une liste
 * vide et un `null`. C'est ce qui évite à l'écran de porter une branche « si le
 * module existe » (le patron de `EMPTY_MARKETING_SITE`, s10).
 */
export interface OrganizationsView {
  readonly current: OrganizationSummary | null
  readonly memberships: readonly OrganizationSummary[]
  /** Les membres de l'organisation courante. Vide quand il n'y en a pas. */
  readonly members: readonly OrganizationMemberView[]
  /** Les invitations vivantes de l'organisation courante. */
  readonly invitations: readonly OrganizationInvitationView[]
}

/**
 * Un membre, tel que l'écran l'affiche.
 *
 * `removable` est **calculé ici**, par la règle du `domain` : l'écran ne compte
 * pas les propriétaires, il lit une donnée. Masquer l'action n'est pas une
 * permission — le serveur refuse quand même (`docs/security.md` §3) —, c'est
 * seulement ne pas promettre ce qu'on refusera.
 */
export interface OrganizationMemberView {
  readonly userId: string
  readonly email: string
  readonly role: OrganizationRole
  readonly removable: boolean
}

/** Une invitation, telle que l'écran l'affiche. Aucun jeton n'en sort. */
export interface OrganizationInvitationView {
  readonly id: string
  readonly email: string
  readonly status: InvitationStatus
}

export const EMPTY_ORGANIZATIONS_VIEW: OrganizationsView = {
  current: null,
  memberships: [],
  members: [],
  invitations: [],
}

/** Ce qu'un écran a le droit de savoir d'une invitation avant de l'accepter. */
export interface InvitationPreview {
  readonly organizationName: string
  readonly email: string
  readonly status: InvitationStatus
}

export type OrganizationOutcome =
  | { readonly status: 'ok'; readonly organizationId: string }
  | { readonly status: 'not_found' }
  | {
      readonly status: 'refused'
      readonly refusal: OrganizationRefusal | InvitationRefusal
    }

/**
 * L'identifiant d'organisation reçu d'un corps de requête.
 *
 * Zod à **chaque** frontière (`docs/security.md` §4), y compris pour un champ
 * qui « ne peut être qu'une chaîne » : ce qui arrive ici vient de nulle part.
 */
const ORGANIZATION_ID = z.object({ organizationId: z.string().trim().min(1).max(64) })

const summaryOf = (membership: {
  organizationId: string
  name: string
  slug: string
  role: OrganizationRole
}): OrganizationSummary => ({
  id: membership.organizationId,
  name: membership.name,
  slug: membership.slug,
  role: membership.role,
})

export interface OrganizationsUseCases {
  createOrganization(input: {
    readonly userId: string
    readonly body: unknown
  }): Promise<OrganizationOutcome>
  switchOrganization(input: {
    readonly userId: string
    readonly body: unknown
  }): Promise<OrganizationOutcome>
  renameOrganization(input: {
    readonly userId: string
    readonly body: unknown
  }): Promise<OrganizationOutcome>
  viewOrganizations(userId: string): Promise<OrganizationsView>
  activeOrganizationId(userId: string): Promise<string | null>
  /* --------------------------------------------------------------------- *
   * s16
   * --------------------------------------------------------------------- */
  inviteMember(input: { readonly userId: string; readonly body: unknown }): Promise<OrganizationOutcome>
  resendInvitation(input: {
    readonly userId: string
    readonly body: unknown
  }): Promise<OrganizationOutcome>
  revokeInvitation(input: {
    readonly userId: string
    readonly body: unknown
  }): Promise<OrganizationOutcome>
  /**
   * Accepte une invitation. **Elle ne prend pas d'organisation** : le jeton est
   * l'autorisation, et l'invité n'est pas encore membre — il n'existe donc
   * aucun `OrganizationAccess` à produire avant la consommation.
   */
  acceptInvitation(input: {
    readonly userId: string
    readonly body: unknown
  }): Promise<OrganizationOutcome>
  removeMember(input: { readonly userId: string; readonly body: unknown }): Promise<OrganizationOutcome>
  /** Ce que l'écran d'atterrissage montre avant l'acceptation, ou `null`. */
  describeInvitation(token: string): Promise<InvitationPreview | null>
  purge(scope: ModuleScope): Promise<void>
  export(scope: ModuleScope): Promise<ModuleExportPayload>
}

/**
 * L'identifiant d'invitation reçu d'un corps de requête. Zod à chaque frontière.
 */
const INVITATION_ID = z.object({ invitationId: z.string().trim().min(1).max(64) })

/** L'identifiant du compte visé par un retrait. */
const MEMBER_ID = z.object({ userId: z.string().trim().min(1).max(64) })

/**
 * Le jeton d'invitation, tel qu'il arrive.
 *
 * Borné en longueur comme le reste : ce qui arrive ici vient de nulle part, et
 * une chaîne d'un mégaoctet serait hachée avant d'être rejetée.
 */
const INVITATION_TOKEN = z.object({ token: z.string().trim().min(1).max(256) })

export function createOrganizationsUseCases(
  dependencies: OrganizationsDependencies,
): OrganizationsUseCases {
  const { repository, reservedSlugs, generateId, mailer, appUrl, emailLocale, now, tokens } =
    dependencies

  /** La lecture conjointe, enveloppée : le port garde son receveur. */
  const findMembership = (input: {
    readonly userId: string
    readonly organizationId: string
  }) => repository.findMembership(input)

  /** L'accès demandé par un corps de requête, ou le refus qui ne dit rien. */
  const accessFrom = async (
    userId: string,
    body: unknown,
  ): Promise<OrganizationAccess | null> => {
    const parsed = ORGANIZATION_ID.safeParse(body)

    if (!parsed.success) {
      // Un identifiant malformé et une organisation d'autrui rendent la même
      // chose : rien. Distinguer les deux rendrait la forme des identifiants
      // observable, et avec elle l'existence des organisations.
      return null
    }

    return await authorizeOrganization(findMembership, {
      userId,
      organizationId: parsed.data.organizationId,
    })
  }

  /**
   * Le quota d'émission de l'organisation est-il atteint ?
   *
   * **Une seule fenêtre pour les deux portes** — l'invitation et le renvoi.
   * Écrite ici plutôt que deux fois : deux copies divergeraient, et la première
   * à diverger serait celle qui oublie de compter.
   */
  const exceedsQuota = async (access: OrganizationAccess): Promise<boolean> => {
    const since = new Date(now().getTime() - INVITATION_QUOTA_WINDOW_SECONDS * 1_000)

    return exceedsInvitationQuota(await repository.countInvitationsIssuedSince(access, since))
  }

  /** Ce que rend une écriture d'invitation : l'adresse à qui écrire, ou un refus. */
  type Issued =
    | { readonly ok: true; readonly email: string }
    | { readonly ok: false; readonly refusal: InvitationRefusal }

  /**
   * Émet un jeton, laisse l'appelant l'écrire **haché**, et envoie le lien.
   *
   * Partagée par l'invitation et le renvoi, parce que c'est exactement le même
   * geste : deux copies divergeraient, et la première à diverger serait celle
   * qui oublie de hacher. Le secret en clair ne quitte pas cette fonction
   * autrement que par le lien.
   */
  const deliver = async (
    access: OrganizationAccess,
    issue: (token: { readonly hash: string; readonly expiresAt: Date }) => Promise<Issued>,
  ): Promise<OrganizationOutcome> => {
    const token = tokens.generate()
    const issued = await issue({
      hash: tokens.digest(token),
      expiresAt: invitationExpiry(now()),
    })

    if (!issued.ok) {
      return { status: 'refused', refusal: issued.refusal }
    }

    const sent = await mailer.send({
      to: issued.email,
      template: `${ORGANIZATIONS_MODULE_ID}.${INVITATION_EMAIL_TEMPLATE}`,
      locale: emailLocale,
      data: {
        // Le jeton en clair ne vit **que** dans ce lien : la base n'en a que
        // l'empreinte, et rien d'autre ne le voit passer.
        url: `${appUrl}${INVITATION_SCREEN_PATH}?token=${encodeURIComponent(token)}`,
        organization: access.name,
      },
    })

    // L'invitation est écrite, l'email n'est pas parti : l'état est **explicite
    // et rejouable** — elle reste en attente, donc renvoyable
    // (`docs/reliability.md` §2). Le port ne lève pas, il rend son échec.
    return sent.ok
      ? { status: 'ok', organizationId: access.organizationId }
      : { status: 'refused', refusal: 'email_failed' }
  }

  /**
   * Pourquoi ce jeton n'a rien consommé.
   *
   * Appelée **après** la tentative de consommation, jamais avant : vérifier
   * d'abord laisserait la fenêtre où deux acceptations concurrentes passent le
   * contrôle. Ici, l'ordre a déjà échoué ; il ne reste qu'à nommer la raison.
   */
  const refusalForToken = async (
    tokenHash: string,
    email: string,
  ): Promise<InvitationRefusal> => {
    const invitation = await repository.describeInvitation(tokenHash)

    if (invitation === null) {
      return 'invitation_unknown'
    }

    const status = invitationStatus(invitation, now())

    if (!isInvitationUsable(status)) {
      return refusalForStatus(status) ?? 'invitation_unknown'
    }

    // Vivante, mais elle n'a pas été consommée : le lien a été émis pour une
    // autre adresse. Le faire suivre ne donne donc pas l'accès à qui le reçoit.
    return normalizeEmail(invitation.email) === normalizeEmail(email)
      ? 'invitation_unknown'
      : 'invitation_other_recipient'
  }

  return {
    createOrganization: async ({ userId, body }) => {
      const draft = parseOrganizationDraft(body, reservedSlugs)

      if (!draft.ok) {
        return { status: 'refused', refusal: draft.refusal }
      }

      const organizationId = generateId('org')
      const written = await repository.createOrganization({
        organizationId,
        membershipId: generateId('mbr'),
        name: draft.value.name,
        slug: draft.value.slug,
        userId,
        // Le créateur en est **propriétaire** (critère 4). C'est le `domain` qui
        // le dit, pas cette ligne.
        role: FOUNDER_ROLE,
      })

      if (written === 'slug_unavailable') {
        return { status: 'refused', refusal: 'slug_unavailable' }
      }

      // L'appartenance qu'on vient d'écrire est **relue** par la lecture
      // conjointe : c'est ce qui fait qu'un accès a toujours la même origine.
      const access = await authorizeOrganization(findMembership, { userId, organizationId })

      if (access === null) {
        return { status: 'not_found' }
      }

      await repository.setActiveOrganization(access)

      return { status: 'ok', organizationId: access.organizationId }
    },

    switchOrganization: async ({ userId, body }) => {
      const access = await accessFrom(userId, body)

      if (access === null) {
        return { status: 'not_found' }
      }

      await repository.setActiveOrganization(access)

      return { status: 'ok', organizationId: access.organizationId }
    },

    renameOrganization: async ({ userId, body }) => {
      // L'autorisation d'abord : un non-membre n'apprend rien de son corps de
      // requête, pas même qu'il était mal formé.
      const access = await accessFrom(userId, body)

      if (access === null) {
        return { status: 'not_found' }
      }

      const draft = parseOrganizationDraft(body, reservedSlugs)

      if (!draft.ok) {
        return { status: 'refused', refusal: draft.refusal }
      }

      const written = await repository.renameOrganization(access, {
        name: draft.value.name,
        slug: draft.value.slug,
      })

      return written === 'slug_unavailable'
        ? { status: 'refused', refusal: 'slug_unavailable' }
        : { status: 'ok', organizationId: access.organizationId }
    },

    viewOrganizations: async (userId) => {
      const [memberships, activeId] = await Promise.all([
        repository.listMemberships(userId),
        repository.findActiveOrganizationId(userId),
      ])

      const summaries = memberships.map(summaryOf)
      // L'organisation courante est cherchée **dans les appartenances** :
      // une sélection qui aurait survécu au retrait du membre ne ressort donc
      // pas, sans qu'aucune ligne n'ait à être nettoyée.
      const current = summaries.find((summary) => summary.id === activeId) ?? null

      if (current === null) {
        return { current: null, memberships: summaries, members: [], invitations: [] }
      }

      // Le détail de l'organisation courante n'est lu qu'après une
      // **autorisation**, comme toute écriture : c'est la même lecture conjointe
      // qui produit l'accès, et rien ici ne prend un identifiant nu.
      const access = await authorizeOrganization(findMembership, {
        userId,
        organizationId: current.id,
      })

      if (access === null) {
        return { current: null, memberships: summaries, members: [], invitations: [] }
      }

      const [identities, invitations] = await Promise.all([
        repository.listMemberIdentities(access),
        repository.listLiveInvitations(access),
      ])
      const instant = now()

      return {
        current,
        memberships: summaries,
        members: identities.map((identity) => ({
          userId: identity.userId,
          email: identity.email,
          role: identity.role,
          // La règle du `domain`, appelée ici : l'écran ne compte pas les
          // propriétaires, il lit une donnée.
          removable: removalRefusal(identities, identity.userId) === null,
        })),
        invitations: invitations.map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          status: invitationStatus(invitation, instant),
        })),
      }
    },

    activeOrganizationId: async (userId) => await repository.findActiveOrganizationId(userId),

    inviteMember: async ({ userId, body }) => {
      // L'autorisation **d'abord** : un non-membre n'apprend rien de son corps de
      // requête, pas même qu'il était mal formé.
      const access = await accessFrom(userId, body)

      if (access === null) {
        return { status: 'not_found' }
      }

      const parsed = parseInvitationEmail(body)

      if (!parsed.ok) {
        return { status: 'refused', refusal: parsed.refusal }
      }

      const email = parsed.value
      const members = await repository.listMemberIdentities(access)

      // Rien de tout cela ne consulte les comptes par adresse : la comparaison
      // porte sur les **membres de cette organisation**, que l'appelant voit
      // déjà. Inviter n'apprend donc jamais si un compte existe
      // (`docs/security.md` §7).
      if (alreadyMember(members.map((member) => member.email), email)) {
        return { status: 'refused', refusal: 'already_member' }
      }

      if (await exceedsQuota(access)) {
        return { status: 'refused', refusal: 'invitation_quota' }
      }

      return await deliver(access, async (token) => {
        const written = await repository.createInvitation(access, {
          invitationId: generateId('inv'),
          email,
          role: INVITED_ROLE,
          tokenHash: token.hash,
          expiresAt: token.expiresAt,
          invitedBy: userId,
          now: now(),
        })

        // L'unicité est celle de la **base**, jamais un `select` préalable :
        // deux invitations simultanées à la même adresse passeraient toutes
        // deux une vérification (`docs/reliability.md` §1).
        return written === 'ok'
          ? { ok: true, email }
          : { ok: false, refusal: 'already_invited' }
      })
    },

    resendInvitation: async ({ userId, body }) => {
      const access = await accessFrom(userId, body)

      if (access === null) {
        return { status: 'not_found' }
      }

      const parsed = INVITATION_ID.safeParse(body)

      if (!parsed.success) {
        return { status: 'refused', refusal: 'invitation_unknown' }
      }

      // **Le renvoi est une émission**, donc il passe par le quota : un renvoi
      // est un email de plus expédié depuis le domaine du produit, et la
      // réputation d'envoi est l'actif que ce quota existe pour protéger
      // (ADR 026). Sans ce contrôle, cinquante renvois de la même invitation
      // partaient sans un refus (revue de s16, F2).
      if (await exceedsQuota(access)) {
        return { status: 'refused', refusal: 'invitation_quota' }
      }

      return await deliver(access, async (token) => {
        // L'ancien lien meurt : sa ligne est révoquée et son empreinte
        // remplacée par celle d'un jeton **que personne n'a reçu**, si bien
        // qu'il ne désigne plus rien. La ligne neuve porte le lien envoyé et
        // son instant d'émission — c'est elle que le quota compte.
        const reissued = await repository.reissueInvitation(access, {
          invitationId: parsed.data.invitationId,
          issuedInvitationId: generateId('inv'),
          tokenHash: token.hash,
          supersededTokenHash: tokens.digest(tokens.generate()),
          expiresAt: token.expiresAt,
          invitedBy: userId,
          now: now(),
        })

        return reissued === null
          ? { ok: false, refusal: 'invitation_unknown' }
          : { ok: true, email: reissued.email }
      })
    },

    revokeInvitation: async ({ userId, body }) => {
      const access = await accessFrom(userId, body)

      if (access === null) {
        return { status: 'not_found' }
      }

      const parsed = INVITATION_ID.safeParse(body)

      if (!parsed.success) {
        return { status: 'refused', refusal: 'invitation_unknown' }
      }

      const revoked = await repository.revokeInvitation(access, {
        invitationId: parsed.data.invitationId,
        now: now(),
      })

      // Rejouable : une seconde révocation ne trouve plus rien et rend le même
      // refus, sans rien écrire de plus.
      return revoked
        ? { status: 'ok', organizationId: access.organizationId }
        : { status: 'refused', refusal: 'invitation_unknown' }
    },

    acceptInvitation: async ({ userId, body }) => {
      const parsed = INVITATION_TOKEN.safeParse(body)

      if (!parsed.success) {
        return { status: 'refused', refusal: 'invitation_unknown' }
      }

      const tokenHash = tokens.digest(parsed.data.token)
      const email = await repository.emailOf(userId)

      if (email === null) {
        return { status: 'refused', refusal: 'invitation_unknown' }
      }

      // **Consommer d'abord.** L'ordre est la garantie : le prédicat porte
      // l'empreinte, l'adresse du destinataire et les trois conditions de vie,
      // donc un second appel — concurrent ou rejoué — ne trouve plus rien. C'est
      // la même discipline que `consume` du module `auth`.
      const consumed = await repository.consumeInvitation({
        tokenHash,
        email: normalizeEmail(email),
        userId,
        membershipId: generateId('mbr'),
        now: now(),
      })

      if (consumed === null) {
        // Rien n'a été consommé : on **relit** pour dire pourquoi. Un refus
        // générique laisserait l'invité sans savoir quoi demander (critère 3).
        return { status: 'refused', refusal: await refusalForToken(tokenHash, email) }
      }

      // L'appartenance qu'on vient d'écrire est **relue** par la lecture
      // conjointe : un accès a toujours la même origine.
      const access = await authorizeOrganization(findMembership, {
        userId,
        organizationId: consumed.organizationId,
      })

      if (access === null) {
        return { status: 'not_found' }
      }

      // L'organisation acceptée devient courante : sans cela, l'invité
      // atterrirait sur « Choisir une organisation » (constat F7 de s15).
      await repository.setActiveOrganization(access)

      return { status: 'ok', organizationId: access.organizationId }
    },

    removeMember: async ({ userId, body }) => {
      const access = await accessFrom(userId, body)

      if (access === null) {
        return { status: 'not_found' }
      }

      const parsed = MEMBER_ID.safeParse(body)

      if (!parsed.success) {
        return { status: 'refused', refusal: 'not_a_member' }
      }

      // **On écrit d'abord.** Le prédicat de l'ordre de suppression porte la
      // règle du dernier propriétaire ; une lecture qui déciderait avant lui
      // ferait deux vérités, et laisserait la fenêtre entre les deux. La lecture
      // ne sert donc qu'à **nommer** le refus, et seulement s'il y en a un.
      const removed = await repository.removeMember(access, parsed.data.userId)

      if (removed) {
        return { status: 'ok', organizationId: access.organizationId }
      }

      const members = await repository.listMemberIdentities(access)

      return {
        status: 'refused',
        // La ligne n'a pas été supprimée : ou bien elle n'existe pas, ou bien
        // c'est le dernier propriétaire. La règle pure départage, et son repli
        // est le refus le plus prudent.
        refusal: removalRefusal(members, parsed.data.userId) ?? 'last_owner',
      }
    },

    describeInvitation: async (token) => {
      const invitation = await repository.describeInvitation(tokens.digest(token))

      if (invitation === null) {
        return null
      }

      return {
        organizationName: invitation.organizationName,
        email: invitation.email,
        status: invitationStatus(invitation, now()),
      }
    },

    purge: async (scope) => {
      // Rejouable : les effacements sont des `delete` conditionnels, donc un
      // second passage ne trouve rien et n'ajoute rien
      // (`docs/reliability.md` §1).
      if (scope.kind === 'user') {
        // **L'adresse d'abord**, tant que le compte existe : c'est elle qui
        // désigne les invitations de cette personne, et rien d'autre ne les
        // relie à son compte (constat F6). L'ordre de purge — le dépendant
        // avant son requis (ADR 029) — est ce qui rend cette lecture possible.
        const email = await repository.emailOf(scope.userId)

        await repository.deleteMembershipsOf(scope.userId)

        if (email !== null) {
          await repository.deleteInvitationsAddressedTo(normalizeEmail(email))
        }

        return
      }

      // La cascade de `organization` emporte ses invitations : effacer
      // l'organisation efface les adresses qu'elle avait invitées.
      await repository.deleteOrganization(scope.organizationId)
    },

    export: async (scope) => {
      if (scope.kind === 'user') {
        const [memberships, activeOrganizationId, email] = await Promise.all([
          repository.listMemberships(scope.userId),
          repository.findActiveOrganizationId(scope.userId),
          repository.emailOf(scope.userId),
        ])

        // Les invitations **adressées à ce compte** font partie de ses données :
        // elles nomment qui l'a sollicité, et l'export doit les rendre comme il
        // rend ses appartenances (constat F6). Aucun jeton n'en sort — la porte
        // de lecture ne sélectionne jamais l'empreinte.
        const invitations =
          email === null
            ? []
            : await repository.listInvitationsAddressedTo(scope.userId, normalizeEmail(email))
        const instant = now()

        return {
          memberships: memberships.map(summaryOf),
          activeOrganizationId,
          invitations: invitations.map((invitation) => ({
            organizationName: invitation.organizationName,
            email: invitation.email,
            status: invitationStatus(invitation, instant),
          })),
        }
      }

      const members = await repository.listMembersOf(scope.organizationId)

      return {
        organizationId: scope.organizationId,
        members: members.map((member) => ({ userId: member.userId, role: member.role })),
      }
    },
  }
}
