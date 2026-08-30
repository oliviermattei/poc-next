import type { ModuleSession, RouteProtection } from './module'
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
