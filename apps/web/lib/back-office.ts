import { visibleNavigation, type ModuleSession } from '@repo/core'
import type { ReactNode } from 'react'
import { adminRoutePath } from '@repo/module-admin'
import type {
  AdminIntl,
  BackOfficeChrome,
  BackOfficeListLinks,
  BackOfficeNavigationItem,
} from '@repo/module-admin/presentation'

import type { AppIntl } from './i18n'
import { moduleRegistry } from './module-registry'

/**
 * **Ce que les quatre écrans du back-office partagent**, et rien de plus.
 *
 * Deux choses : la langue telle que le module la demande, et la **navigation
 * dérivée du registre**. Les deux sont ici plutôt que dans les pages parce
 * qu'elles se prouvent sans rendre quoi que ce soit — c'est la discipline de
 * `lib/navigation.ts` et de `lib/footer.ts`.
 */

/**
 * La langue du back-office, dans la forme que le module attend.
 *
 * `date` est fournie plutôt que calculée dans le module : `toLocaleDateString()`
 * sans locale explicite rend une valeur qui dépend du **serveur**, donc un rendu
 * différent d'une instance à l'autre.
 */
export const backOfficeIntl = (intl: AppIntl): AdminIntl => ({
  t: (key, values) => intl.t(key, values),
  path: intl.path,
  date: (value) =>
    new Intl.DateTimeFormat(intl.locale, { dateStyle: 'medium' }).format(value),
  /**
   * **Un montant en unités mineures, dans sa devise** (s38).
   *
   * Fournie ici pour la raison de `date` : la locale servie est une donnée de
   * l'application, et `Intl.NumberFormat` sans locale explicite rend une valeur
   * qui dépend du serveur. La division par cent est celle de tout ce dépôt —
   * les montants y sont en unités mineures (2900 = 29,00 €).
   *
   * Ce n'est **pas** un import de `formatOfferPrice` : ce fichier ne connaît
   * qu'un module, celui du back-office (`tests/admin.test.ts` le vérifie), et
   * emprunter la fonction à `billing` en ferait un second.
   */
  money: (amount, currency) =>
    new Intl.NumberFormat(intl.locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100),
})

/**
 * **La navigation du back-office, dérivée du registre** (ADR 066, surface
 * `admin`).
 *
 * Aucun identifiant de module n'est écrit ici : le registre n'agrège que les
 * modules activés, et un module qui veut une entrée dans le back-office la
 * **déclare** à son contrat. Couper `organizations` retire donc son entrée sans
 * qu'aucun fichier de `apps/web` ne le nomme — c'est la forme que s31 a établie
 * pour le pied de page, et `pnpm test:minimal-profile` la tient.
 */
export function backOfficeNavigation(
  session: ModuleSession | null,
  intl: AppIntl,
  currentPath: string,
): readonly BackOfficeNavigationItem[] {
  return visibleNavigation(moduleRegistry, session, 'admin').map((entry) => ({
    // Deux modules peuvent nommer leur entrée pareil : la clé de rendu porte
    // donc le module, comme la clé de traduction.
    key: `${entry.moduleId}:${entry.id}`,
    href: intl.path(entry.href),
    // Aucun repli sur la clé : une traduction manquante lève, ici comme
    // partout. `assertDeclarationsAreComplete` refuse déjà, à la construction
    // du registre, une entrée dont la clé manque dans une locale.
    label: intl.t(entry.labelKey),
    // Le chemin **interne** est comparé : la forme publique porte le préfixe de
    // langue, qui n'est pas ce qui distingue deux écrans.
    current: currentPath === entry.href || currentPath.startsWith(`${entry.href}/`),
  }))
}

/**
 * **Les adresses d'une liste, dérivées de son chemin** — écrites une fois.
 *
 * Les quatre écrans construisaient chacun le leur (`` `${liste}/${id}` ``), et
 * la revue a relevé une cinquième copie, en dur, dans un écran (constat F6). La
 * forme d'une adresse de détail est une seule décision : elle se prend ici, et
 * un écran qui la voudrait autrement passerait par le même endroit.
 *
 * Le chemin de liste reste **injecté** par la page : c'est lui qui varie, et il
 * vient de la constante du module qui porte l'écran — `admin` pour les comptes,
 * `organizations` pour les organisations.
 */
export const backOfficeLinks = (listPath: string): BackOfficeListLinks => ({
  listPath,
  detailPath: (id) => `${listPath}/${id}`,
})

/**
 * Les routes du module que le détail d'un compte poste — **résolues par
 * l'application**, jamais recopiées dans un écran.
 */
export const backOfficeActions = {
  revokeSession: adminRoutePath('revokeAccountSession'),
  sendPasswordReset: adminRoutePath('sendPasswordReset'),
}

/**
 * **Le téléchargement des inscriptions publiques** (s37c), résolu ici pour la
 * raison des deux gestes ci-dessus : une adresse de route ne se recopie pas
 * dans un écran.
 *
 * Séparé de `backOfficeActions`, et ce n'est pas un rangement : l'écran de
 * détail d'un compte reçoit cet objet **entier**, si bien qu'une troisième
 * adresse posée dedans lui arriverait en propriété inutile —
 * `tests/rendered-text.test.ts` l'a mesuré au premier essai.
 */
export const backOfficeExportSubscriptions = adminRoutePath('exportSubscriptions')

/**
 * **La coquille du back-office, assemblée par l'application** (s60).
 *
 * Le module décide de la forme — barre latérale, en-tête, place des gestes —,
 * l'application fournit ce qu'elle seule possède : le nom du produit, le
 * catalogue, la navigation dérivée du registre, et les gestes qui sont des
 * composants d'`apps/web` (thème, langue, compte).
 *
 * `actions` est un emplacement, pas une liste : le module ne saura jamais
 * combien de gestes l'application y met, ni lesquels. C'est ce qui lui permet
 * de n'en connaître aucun.
 */
export const backOfficeChrome = (
  session: ModuleSession | null,
  intl: AppIntl,
  currentPath: string,
  actions?: ReactNode,
): BackOfficeChrome => ({
  appName: intl.t('app.name'),
  badge: intl.t('app.backOffice.badge'),
  navigation: backOfficeNavigation(session, intl, currentPath),
  navigationLabel: intl.t('app.backOffice.navigation'),
  // La racine du produit, et non l'écran précédent : un retour qui dépendrait
  // de l'historique demanderait un état, donc un composant client, sur une
  // surface qui n'en a aucun.
  backHref: intl.path('/'),
  backLabel: intl.t('app.backOffice.back'),
  ...(actions === undefined ? {} : { actions }),
})
