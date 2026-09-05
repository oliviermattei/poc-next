import type { AvailableModuleId } from './features'

/**
 * Les **profils de configuration** — le fichier que le propriétaire édite.
 *
 * Un profil ne dit qu'une chose : **quels modules optionnels sont coupés**. Il
 * ne dit pas quelles routes doivent disparaître, ni quelles entrées de
 * navigation, ni quelles tables : tout cela est déjà déclaré par le contrat de
 * chaque module, et la recette le dérive (`scripts/minimal-profile-rules.ts`).
 *
 * C'est ce qui rend le harnais générique : couper un module de plus, c'est
 * ajouter une ligne **ici**, et rien d'autre nulle part.
 *
 * ## Ce qu'un profil ne peut pas faire
 *
 * - couper un module que l'annuaire ne connaît pas : le compilateur refuse
 *   (`satisfies readonly AvailableModuleId[]`), et `parseModuleProfile` refuse
 *   à l'exécution, en le nommant ;
 * - couper un module du socle (`requiredModules`, ADR 021) : sans comptes, il
 *   n'y a pas de SaaS.
 *
 * ## Le profil minimal, et pourquoi ces trois-là
 *
 * Ils portent les promesses de modularité que le PRD vend séparément — le
 * multi-tenant, la facturation, le multilingue —, et ce sont les trois que
 * personne n'avait jamais coupés **ensemble**. Chaque story de module éprouve
 * son propre « off » ; la recette de s26 les éprouve à la fois, sur une base
 * vierge, et vérifie qu'il n'en reste ni route, ni entrée de navigation, ni
 * table.
 *
 * `blog` les a rejoints en s29, et `docs` en s30, pour la raison exacte qui
 * fait exister ce fichier : leur critère « module non activé, aucune route et
 * le lien disparaît de la navigation publique » n'était vérifié par **aucune
 * exécution** tant qu'aucun profil ne les coupait. Le coût est d'une ligne
 * chacun, ce qui est précisément la promesse.
 *
 * Ni l'un ni l'autre ne déclare de table ni de route : ce que la recette
 * vérifie d'eux est l'entrée de navigation — rendue nulle part, et **répondant
 * 404 sur une vraie requête HTTP**, la garde ajoutée par la troisième revue de
 * s29. C'est la seule qui morde sur un module qui n'apporte que des écrans.
 *
 * `pnpm test:minimal-profile` joue ce profil dans une **copie** du dépôt : il
 * n'est pas la configuration livrée, et éditer cette liste ne change rien à
 * l'application tant que la recette n'est pas lancée.
 */
export interface ModuleProfileDeclaration {
  /** Nom du profil, journalisé par la recette. */
  readonly id: string
  /** Les modules coupés, en plus de ceux que `enabledModules` n'active déjà pas. */
  readonly cut: readonly AvailableModuleId[]
}

export const minimalProfile = {
  id: 'minimal',
  cut: ['organizations', 'billing', 'i18n', 'blog', 'docs'],
} as const satisfies ModuleProfileDeclaration
