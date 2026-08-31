import type { ModuleScope, ModuleSession, RouteProtection } from './module'
import type { ModuleRegistry, RegistryNavigationEntry } from './registry'

/**
 * La règle d'accès, écrite **une fois**.
 *
 * Le contrat déclare un niveau de protection sur une route comme sur une entrée
 * de navigation (`docs/security.md` §3). Les deux surfaces posent la même
 * question — « cette session satisfait-elle cette protection ? » — et la
 * réponse doit être la même : une entrée de navigation visible vers une route
 * qui refusera l'appel promet ce qu'elle ne tiendra pas, et une entrée cachée
 * vers une route ouverte divulgue moins que ce qui est déjà public. Deux
 * implémentations de cette règle divergeraient au premier rôle ajouté.
 *
 * Ce prédicat ne connaît ni requête, ni réponse HTTP : c'est le répartiteur qui
 * traduit un refus en 401 ou en 403, selon qu'il sait ou non qui appelle.
 */
export const satisfiesProtection = (
  protection: RouteProtection,
  session: ModuleSession | null,
): boolean => {
  if (protection.level === 'public') {
    return true
  }

  if (session === null) {
    return false
  }

  return protection.level !== 'role' || session.roles.includes(protection.role)
}

/**
 * Les entrées de navigation que cette session a le droit de voir.
 *
 * Le registre n'agrège déjà que les modules activés : ce filtre est l'étage du
 * dessous, celui qui distingue deux appelants d'un **même** module activé. Sans
 * lui, `protection` serait un champ que le contrat déclare et que personne ne
 * lit — une règle qu'aucune commande ne fait échouer (ADR 013).
 *
 * Tant que l'authentification n'existe pas (s07), l'application appelle cette
 * fonction avec `null` : seules les entrées publiques s'affichent. C'est le sens
 * fermé, cohérent avec le répartiteur, qui refuse toute route non publique faute
 * de savoir qui appelle.
 */
export const visibleNavigation = (
  registry: ModuleRegistry,
  session: ModuleSession | null,
): readonly RegistryNavigationEntry[] =>
  registry.navigation.filter((entry) => satisfiesProtection(entry.protection, session))

/**
 * **À qui appartient la donnée qu'on s'apprête à lire ou à écrire.**
 *
 * `docs/architecture.md` (« Data model ») et `docs/security.md` §3 exigent tous
 * deux que ce propriétaire soit résolu par une **fonction unique**, identique
 * que le module `organizations` soit activé ou non. La raison est écrite dans
 * les notes de s15 : sans elle, le mode mono-utilisateur duplique chaque
 * requête, et la seconde copie est celle qu'on oublie de filtrer.
 *
 * Elle vit ici, dans `@repo/core`, et pas dans le module — parce qu'il faut
 * qu'elle existe quand le module est **coupé**. `@repo/core` ne connaît aucun
 * module : il reçoit un identifiant d'organisation active, ou `null`. C'est le
 * point de composition de l'application qui sait d'où vient ce `null` — d'un
 * module absent, ou d'un compte qui n'a pas encore d'organisation. L'appelant,
 * lui, ne le sait pas, et c'est tout l'intérêt.
 *
 * Le résultat est un `ModuleScope`, la forme que `purge` et `export` prennent
 * déjà au contrat (ADR 007) : un seul vocabulaire de périmètre dans tout le
 * dépôt.
 */
export const resolveDataOwner = (input: {
  readonly session: ModuleSession
  readonly activeOrganizationId: string | null
}): ModuleScope =>
  input.activeOrganizationId === null
    ? { kind: 'user', userId: input.session.userId }
    : { kind: 'organization', organizationId: input.activeOrganizationId }
