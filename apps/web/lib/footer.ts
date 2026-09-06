import { visibleNavigation, type ModuleRegistry, type ModuleSession } from '@repo/core'
import type { MarketingFooterLink } from '@repo/module-marketing/presentation'

import { moduleRegistry } from './module-registry'

/**
 * **Les liens de service du pied de page public, dérivés du registre** (s31, ADR 066).
 *
 * Avant cette fonction, ils étaient un **import nommé** : `consentFooterLinks`
 * apparaissait dans sept fichiers de `apps/web/app`. Ajouter les nouveautés par
 * le même chemin en aurait fait un second nom aux sept mêmes endroits, puis un
 * troisième au module suivant — le défaut que la recherche de s31 a mesuré, et
 * que s53 avait déjà corrigé un cran plus haut pour `sitemap.xml`.
 *
 * Un module qui veut un lien ici le **déclare** à son contrat
 * (`navigation`, `surface: 'footer'`). Le registre n'agrège que les modules
 * activés : le lien disparaît donc avec le module, sans condition et sans qu'un
 * écran nomme quoi que ce soit. `tests/changelog.test.ts` mesure les deux — la
 * dérivation, et l'absence d'un nom de module dans les pages.
 *
 * **La session est `null`, et c'est une décision.** Le pied de page est rendu
 * par les pages publiques du site marketing, qui sont servies à un visiteur
 * anonyme comme à un membre connecté ; y montrer un lien de plus selon la
 * session ferait varier une page indexable avec l'appelant. Un module qui
 * déclarerait une entrée de pied de page non publique n'y paraîtrait donc
 * jamais — `visibleNavigation` applique la même protection sur les deux
 * surfaces (`packages/core/src/protection.test.ts`).
 */
export function moduleFooterLinks(
  registry: ModuleRegistry,
  session: ModuleSession | null,
  t: (key: string) => string,
): readonly MarketingFooterLink[] {
  return visibleNavigation(registry, session, 'footer').map((entry) => ({
    // Deux modules peuvent nommer leur entrée pareil : la clé de rendu porte
    // donc le module, comme la clé de traduction.
    key: `${entry.moduleId}:${entry.id}`,
    // Un chemin **interne** : c'est le pied de page qui le met dans la forme
    // publique de la langue servie, une seule fois, comme pour ses propres liens.
    href: entry.href,
    // Aucun repli sur la clé : une traduction manquante lève, ici comme partout.
    // `assertDeclarationsAreComplete` refuse déjà une entrée dont la clé manque
    // dans une locale de l'application.
    label: t(entry.labelKey),
  }))
}

/**
 * Les liens du pied de page **de cette application**, tels que les écrans les
 * demandent : un traducteur entre, des liens sortent.
 *
 * C'est la seule forme que les pages appellent, et c'est ce qui rend le
 * huitième module gratuit pour elles.
 */
export const publicFooterLinks = (t: (key: string) => string): readonly MarketingFooterLink[] =>
  moduleFooterLinks(moduleRegistry, null, t)
