import type { InvitationRefusal, RemovableMember } from './invitation'
import type { OrganizationRole } from './organization'

/**
 * **Qui a le droit de quoi dans une organisation** (s17).
 *
 * Aucune base, aucun framework, aucun SDK (ADR 006). Ce fichier ne connaît que
 * des rôles et des identifiants de compte : c'est la couche `application` qui
 * lui donne le rôle **relu à chaque requête** dans le prédicat de la lecture
 * conjointe, et la `presentation` qui n'en fait qu'afficher le résultat.
 *
 * Trois choses à savoir avant d'y toucher.
 *
 * 1. **Ce n'est pas `RouteProtection.level: 'role'`.** Le niveau déclaré au
 *    contrat de module interroge `ModuleSession.roles`
 *    (`packages/core/src/protection.ts`), une liste **de plateforme** — peuplée
 *    depuis s56 des rôles de `admin_platform_role`, c'est-à-dire du superadmin
 *    de s37, et de rien d'autre. Un rôle
 *    d'organisation dépend de **quelle** organisation : le ranger dans la
 *    session y mettrait une autorité organisationnelle, ce que l'ADR 025 refuse
 *    précisément. **Toutes** les routes du module restent `authenticated` — elles
 *    sont neuf, et c'est `organization-routes.ts` qui fait foi, pas ce compte —,
 *    et la garde est ici.
 * 2. **Masquer un déclencheur n'est pas une permission** (`docs/security.md`
 *    §3). L'écran lit `permissionsOf` pour ne pas promettre ce qui sera refusé ;
 *    le serveur consulte la **même** fonction avant d'écrire, et refuse en 403.
 * 3. **`null` n'est pas « pas de droits », c'est « pas d'organisation ».** Module
 *    `organizations` coupé — ou compte sans organisation courante —, la donnée
 *    appartient au compte (`resolveDataOwner`, `@repo/core`) : il en est le
 *    propriétaire, et tout lui est permis. C'est le critère 7, et c'est ce qui
 *    permet au même appel de servir les deux configurations sans variante.
 */

/**
 * Les actions que ce module garde, **énumérées**.
 *
 * Ce qui n'est pas ici n'est pas gardé : créer une organisation et basculer
 * entre les siennes n'y figurent pas, et ce n'est pas un oubli — créer la
 * sienne n'est pas une action sur celle-ci, et basculer ne touche que sa propre
 * ligne de sélection.
 */
export const ORGANIZATION_ACTION = {
  rename: 'organization.rename',
  invite: 'member.invite',
  resendInvitation: 'invitation.resend',
  revokeInvitation: 'invitation.revoke',
  removeMember: 'member.remove',
  setRole: 'member.set_role',
  /**
   * **La facturation** (s19, ADR 034).
   *
   * Elle n'est pas une action du module `organizations`, et c'est pourtant ici
   * qu'elle doit vivre : la matrice rôle × action s'écrit **une fois**, et ce
   * module est celui qui possède les rôles. La ranger ailleurs — dans le module
   * `billing`, ou pire dans le point de composition de l'application — la
   * ferait exister à deux endroits, et le second serait celui qui ment (revue
   * de s17, F4).
   *
   * Ce module n'importe pas `billing` pour autant : c'est une chaîne, pas une
   * dépendance. Le module `billing` reçoit un **prédicat** de son point de
   * composition, et ignore d'où il vient.
   *
   * Sans elle, tout `member` d'une organisation pourrait ouvrir le portail
   * client et annuler l'abonnement — `docs/security.md` §3 exige que chaque
   * combinaison rôle × action sensible soit couverte.
   */
  manageBilling: 'billing.manage',
  /**
   * **La suppression de l'organisation** (s34, critère 5).
   *
   * Réservée au propriétaire, et le commentaire de `MATRIX` le disait déjà —
   * « ni supprimer l'organisation ni modifier un owner » — pour une action qui
   * n'existait pas encore. Elle est donc absente de la liste explicite d'`admin`
   * et présente chez `owner` par `ORGANIZATION_ACTIONS` : la règle est tenue par
   * la construction de la matrice, pas par une seconde énumération.
   */
  delete: 'organization.delete',
  /**
   * **L'export des données de l'organisation** (s35, critère 5).
   *
   * Réservé au propriétaire, et il est ici pour la raison exacte qui y a mis la
   * facturation : la matrice rôle × action s'écrit **une fois**, et ce module
   * est celui qui possède les rôles. L'écrire dans le point de composition —
   * ou dans `auth`, qui sert la route — la ferait exister à deux endroits, et
   * le second serait celui qui ment (revue de s17, F4).
   *
   * `admin` ne l'a pas : l'archive contient les données de **tous** les
   * membres, y compris celles d'un `owner`, et le critère 5 dit « réservé à un
   * owner ». Un `admin` administre l'organisation ; il n'en emporte pas la
   * copie complète.
   */
  exportData: 'organization.export',
} as const

export type OrganizationAction = (typeof ORGANIZATION_ACTION)[keyof typeof ORGANIZATION_ACTION]

/**
 * La même liste, en tableau — **dérivée**, jamais recopiée.
 *
 * Deux écritures des mêmes identifiants divergeraient, et la première à
 * diverger serait celle que la matrice n'énumère pas.
 *
 * **Aucun nombre ici** : cette phrase a dit « six » alors qu'il y en avait huit,
 * puis neuf. Un compte écrit à côté d'une liste vieillit à chaque ajout sans
 * que rien ne rougisse — la liste **est** le compte, et
 * `organization-rules.test.ts` confronte `ORGANIZATION_ACTIONS` à la matrice
 * qu'il énumère à la main.
 */
export const ORGANIZATION_ACTIONS = Object.values(
  ORGANIZATION_ACTION,
) as readonly OrganizationAction[]

/** Ce qu'un appelant peut faire, une entrée par action. */
export type OrganizationPermissions = Readonly<Record<OrganizationAction, boolean>>

/**
 * La matrice, écrite **une fois**.
 *
 * `member` : rien. Il lit la liste des membres — savoir avec qui l'on partage
 * ses données n'est pas un privilège — et il peut quitter l'organisation, ce qui
 * est un geste sur sa propre appartenance et non une action d'administration
 * (voir `removalPermission`).
 *
 * `admin` : tout sauf la distribution des rôles. Les critères énumèrent ce qu'il
 * peut faire — « inviter et retirer des members » — et bornent ce qu'il ne peut
 * pas — « ni supprimer l'organisation ni modifier un owner ». Le rôle n'est pas
 * dans la liste des permis : `member.set_role` reste au propriétaire, et un
 * `admin` ne peut donc pas se fabriquer un pair.
 *
 * `owner` : tout.
 */
const MATRIX: Readonly<Record<OrganizationRole, readonly OrganizationAction[]>> = {
  owner: ORGANIZATION_ACTIONS,
  admin: [
    ORGANIZATION_ACTION.rename,
    ORGANIZATION_ACTION.invite,
    ORGANIZATION_ACTION.resendInvitation,
    ORGANIZATION_ACTION.revokeInvitation,
    ORGANIZATION_ACTION.removeMember,
    // La facturation : un `admin` administre l'organisation, ce qui inclut ce
    // qu'elle paie. Ce que le critère de s17 lui refuse est la distribution des
    // rôles, pas la gestion courante.
    ORGANIZATION_ACTION.manageBilling,
  ],
  member: [],
}

/**
 * Ce rôle permet-il cette action ?
 *
 * `null` signifie **aucune organisation** : le compte est propriétaire de sa
 * donnée, tout lui est permis (critère 7).
 *
 * **Un rôle hors matrice ne permet rien**, et ce repli n'est pas décoratif :
 * `organization_member.role` est un `text not null` **sans contrainte de
 * valeur**, et ce rôle est relu en base à chaque requête. Sans le `?? []`,
 * `MATRIX[role]` valait `undefined` et la fonction levait — un 500 au lieu d'un
 * refus, sur la fonction que s18, s19, s24, s33 et s35 appelleront (revue de
 * s17, F3). Un défaut se ferme, il ne s'ouvre pas.
 */
export function allows(role: OrganizationRole | null, action: OrganizationAction): boolean {
  return role === null || (MATRIX[role] ?? []).includes(action)
}

/** L'enregistrement complet, tel que la vue le sert à l'écran. */
export function permissionsOf(role: OrganizationRole | null): OrganizationPermissions {
  return Object.fromEntries(
    ORGANIZATION_ACTIONS.map((action) => [action, allows(role, action)]),
  ) as OrganizationPermissions
}

/** Un membre, réduit à ce dont les règles de permission ont besoin. */
export interface MemberRole {
  readonly userId: string
  readonly role: OrganizationRole
}

/**
 * Cet appelant peut-il retirer cette personne ?
 *
 * **Se retirer soi-même est toujours permis**, quel que soit le rôle : c'est le
 * geste de la personne sur sa propre appartenance, pas une action
 * d'administration. Le dernier propriétaire reste protégé — par une autre règle,
 * et surtout par le prédicat de l'ordre de suppression.
 *
 * **Un `admin` ne retire qu'un `member`** (critère 3, à la lettre : « inviter et
 * retirer des *members* »). C'est la seule borne qui dépende du rôle de la
 * **cible** pour le retrait, et elle existe pour que l'échelon intermédiaire ne
 * puisse destituer ni celui du dessus, ni son pair.
 */
export function removalPermission(actor: MemberRole, target: MemberRole): boolean {
  if (actor.userId === target.userId) {
    return true
  }

  if (!allows(actor.role, ORGANIZATION_ACTION.removeMember)) {
    return false
  }

  return !unremovableRolesFor(actor, target.userId).includes(target.role)
}

/**
 * Les rôles que cet appelant ne peut **pas** retirer sur cette ligne.
 *
 * Elle existe pour que la borne entre dans le **prédicat de l'ordre de
 * suppression** au lieu d'être décidée par une lecture préalable. Lire le rôle
 * de la cible puis supprimer laisserait la fenêtre où la cible devient
 * propriétaire entre les deux, et un `admin` retirerait le propriétaire qu'il ne
 * doit pas toucher. C'est la même discipline que la règle du dernier
 * propriétaire : la règle **nomme**, le prédicat **refuse**.
 *
 * `removalPermission` s'écrit à partir d'elle : une seule vérité, pas deux.
 *
 * **Un `admin` ne retire qu'un `member`** : ni un `owner`, ni un autre `admin`.
 * Le critère 3 dit « inviter et retirer des *members* », et deux administrateurs
 * qui peuvent se retirer l'un l'autre forment une prise de pouvoir latérale que
 * personne n'a décidée (revue de s17, arbitrage 2). Se retirer soi-même reste
 * permis — c'est le cas au-dessus, et il vient en premier.
 */
export function unremovableRolesFor(
  actor: MemberRole,
  targetUserId: string,
): readonly OrganizationRole[] {
  if (targetUserId === actor.userId) {
    return []
  }

  return actor.role === 'admin' ? ['owner', 'admin'] : []
}

/**
 * L'ordre dans lequel les rôles sont proposés sur une ligne.
 *
 * `owner` en dernier, et c'est une décision du **domaine**, pas de l'écran : le
 * geste qui change qui gouverne l'organisation vient après ceux qui ne le
 * changent pas.
 */
const ASSIGNABLE_ORDER: readonly OrganizationRole[] = ['admin', 'member', 'owner']

/**
 * Les rôles que cet appelant peut poser sur cette ligne, dans l'ordre d'affichage.
 *
 * Vide s'il ne distribue pas les rôles, et vide **sur sa propre ligne** : se
 * rétrograder soi-même passe par « quitter » ou par un transfert vers quelqu'un
 * d'autre. Une ligne qui proposerait à un propriétaire de se rétrograder
 * l'inviterait à laisser l'organisation sans gouvernance — le prédicat le
 * refuserait, mais promettre puis refuser est un écran cassé.
 */
export function assignableRolesFor(
  actor: MemberRole,
  target: MemberRole,
): readonly OrganizationRole[] {
  if (!allows(actor.role, ORGANIZATION_ACTION.setRole) || actor.userId === target.userId) {
    return []
  }

  return ASSIGNABLE_ORDER.filter((role) => role !== target.role)
}

/**
 * Poser ce rôle donne-t-il la propriété de l'organisation ?
 *
 * La seule notion dérivée d'un rôle dont le reste du module ait besoin : le
 * libellé du bouton (« Transférer la propriété » plutôt que le nom du rôle) et
 * sa variante d'affichage en dépendent. Elle est ici, comme la matrice, parce
 * qu'un `role === 'owner'` écrit dans un `.tsx` ou dans les clés de traduction
 * ferait exister la règle à deux endroits — c'est ce qui s'était produit, trois
 * fois, dans le commit qui l'interdisait (revue de s17, F4). `pnpm lint` refuse
 * désormais la comparaison partout ailleurs dans le module.
 */
export const grantsOwnership = (role: OrganizationRole): boolean => role === 'owner'

/**
 * Nommer un `owner` **est** le transfert de propriété.
 *
 * Il n'y a pas de route de transfert distincte : promouvoir quelqu'un
 * propriétaire rétrograde l'ancien en `admin` (critère 4), dans la même
 * transaction. Deux routes pour un geste feraient deux chemins vers le même
 * invariant, et le second serait celui qu'on oublie de sérialiser.
 */
export const isOwnershipTransfer = (
  actor: MemberRole,
  targetUserId: string,
  nextRole: OrganizationRole,
): boolean => grantsOwnership(nextRole) && targetUserId !== actor.userId

/**
 * Ce qui interdit ce changement de rôle, ou `null`.
 *
 * Comme `removalRefusal`, cette fonction décide du **message** et rien d'autre.
 * L'invariant — une organisation garde au moins un propriétaire — est tenu par
 * le prédicat de l'ordre de modification, qui compte les propriétaires dans la
 * même instruction, et par le verrou consultatif porté par la transaction. Une
 * lecture qui déciderait ferait deux vérités, et la première à diverger serait
 * celle qui écrit.
 */
export function roleChangeRefusal(
  members: readonly RemovableMember[],
  targetUserId: string,
  nextRole: OrganizationRole,
): InvitationRefusal | null {
  const target = members.find((member) => member.userId === targetUserId)

  if (target === undefined) {
    return 'not_a_member'
  }

  if (target.role !== 'owner' || nextRole === 'owner') {
    return null
  }

  const owners = members.filter((member) => member.role === 'owner').length

  return owners <= 1 ? 'last_owner' : null
}
