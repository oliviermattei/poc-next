import {
  visibleNavigation,
  type Locale,
  type LocaleRouting,
  type ModuleRegistry,
  type ModuleSession,
} from '@repo/core'
import type { LocaleOption, SidebarItem } from '@repo/ui'

/**
 * Les entrées de navigation du shell, dérivées du registre.
 *
 * **Aucune condition, et surtout aucun identifiant de module.** Le registre
 * n'agrège que les modules activés, `visibleNavigation` (s03) retire ensuite ce
 * que la session n'a pas le droit de voir — la même règle qui refusera la route
 * correspondante (`docs/security.md` §3). Cette fonction ne fait que traduire
 * les clés en libellés et préfixer les liens.
 *
 * Les deux viennent du **même** appel : `t` est le traducteur de la locale
 * servie, `path` la forme publique d'un chemin dans cette locale. Module `i18n`
 * coupé, `path` est l'identité — et cette fonction ne le sait pas. C'est ce qui
 * fait passer le même scénario de test dans les deux configurations.
 *
 * Elle est ici, et pas dans le composant, pour qu'elle soit éprouvable sans
 * rendre quoi que ce soit : ce qui se prouve dans une fonction pure n'a pas
 * besoin d'un navigateur.
 */
export interface NavigationIntl {
  readonly locale: Locale
  /** Traduit une clé de navigation qualifiée. Lève si elle manque — jamais de repli. */
  readonly t: (key: string) => string
  readonly path: (pathname: string) => string
}

export function shellNavigation(
  registry: ModuleRegistry,
  session: ModuleSession | null,
  intl: NavigationIntl,
): readonly SidebarItem[] {
  return visibleNavigation(registry, session).map((entry) => ({
    // Deux modules peuvent nommer leur entrée pareil : la clé de rendu porte
    // donc le module, comme la clé de traduction.
    id: `${entry.moduleId}:${entry.id}`,
    href: intl.path(entry.href),
    // Aucun repli sur la clé : une traduction manquante lève, ici comme
    // partout. `assertDeclarationsAreComplete` refuse déjà, à la construction
    // du registre, une entrée dont la clé manque dans une locale de
    // l'application — l'écran ne peut donc pas afficher « auth.navigation.account ».
    label: intl.t(entry.labelKey),
  }))
}

/**
 * Les langues que le sélecteur propose — **vide quand il n'y en a qu'une**.
 *
 * Le `return` anticipé n'est pas une commodité d'affichage : les libellés des
 * langues (`i18n.locale.*`) appartiennent au **module** `i18n`, donc ils
 * disparaissent du catalogue avec lui. Construire la liste puis ne pas
 * l'afficher demanderait des clés absentes — et comme aucune traduction ne se
 * replie sur sa clé, l'écran tomberait en 500. Mesuré : c'est exactement ce que
 * faisait le shell, et aucun test de nœud ne le voyait, faute de rendre quoi
 * que ce soit. La construction est donc ici, éprouvable sans navigateur.
 *
 * La condition porte sur le **nombre de langues servies**, jamais sur
 * l'identifiant d'un module.
 */
export function localeOptions(
  routing: LocaleRouting,
  intl: NavigationIntl,
): readonly LocaleOption[] {
  if (routing.locales.length < 2) {
    return []
  }

  return routing.locales.map((candidate) => ({
    value: candidate,
    label: intl.t(`i18n.locale.${candidate}`),
    href: routing.publicPath('/', candidate),
  }))
}
