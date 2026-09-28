import { visibleNavigation } from '@repo/core'
import { DEFAULT_SIGNED_IN_PATH } from '@repo/module-auth'
import { onboardingModule, ONBOARDING_SCREEN_PATH } from '@repo/module-onboarding'

import { localeRouting } from '../../apps/web/lib/locale-routing'
import { marketingSite } from '../../apps/web/lib/marketing'
import { moduleRegistry } from '../../apps/web/lib/module-registry'
import { enabledModules } from '../../config/features'
import { defaultLocale } from '../../config/i18n'

/**
 * Les URL attendues par les parcours, **dérivées de la configuration**.
 *
 * Un parcours doit passer que le module `i18n` soit activé ou non : écrire
 * `/fr/account` en dur le rendrait faux dans un état, `/account` dans l'autre.
 * C'est la discipline de `e2e/modules.spec.ts`, qui dérive ses attentes du
 * registre au lieu de les recopier — appliquée ici à la forme des URL.
 *
 * La locale est celle du site, et c'est celle que le navigateur des parcours
 * demande : `playwright.config.ts` fixe `locale: 'fr-FR'`. Le parcours qui
 * exerce l'anglais ouvre son propre contexte.
 */
export const publicPath = (pathname: string): string =>
  localeRouting.publicPath(pathname, defaultLocale)

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** L'URL complète d'un écran, préfixe de locale compris quand il y en a un. */
export const urlOf = (pathname: string, search = ''): RegExp =>
  new RegExp(`localhost:\\d+${escape(publicPath(pathname))}${escape(search)}$`)

/**
 * L'URL de connexion telle que la redirection d'un écran protégé la produit.
 *
 * La destination de retour est un chemin **interne** : c'est l'écran de
 * connexion qui la met dans la forme publique de sa locale, une seule fois. Les
 * deux formes — encodée et non — sont acceptées, le navigateur pouvant rendre
 * l'URL décodée dans la barre d'adresse.
 */
export const signInRedirectedFrom = (pathname: string): RegExp =>
  new RegExp(
    `${escape(publicPath('/sign-in'))}\\?next=(${escape(encodeURIComponent(pathname))}|${escape(pathname)})$`,
  )

/**
 * Où atterrit un visiteur **anonyme** qui suit la racine du site.
 *
 * Depuis s10, la racine appartient au module `marketing` : site public activé,
 * elle sert l'accueil ; coupé, elle redirige vers la connexion (critère 6).
 * Les parcours qui se déconnectent ou changent de langue traversent ce chemin,
 * et leur attente est donc **dérivée** de l'état du module — comme la forme des
 * URL l'est de `localeRouting`. Un visiteur **connecté** qui ouvre `/` voit le
 * site aussi (s61) ; son tableau de bord est sur `/app`.
 */
export const anonymousLanding = (): string =>
  marketingSite.sections.length > 0 ? '/' : '/sign-in'

/**
 * **Une page de la zone Site servie dans cette configuration** (s61).
 *
 * L'en-tête du site n'est rendu que sur les écrans de la zone Site : un
 * parcours qui l'observe doit donc en ouvrir un qui existe. La racine redirige
 * quand le site public est coupé, et chaque autre page du site disparaît avec
 * son module — la première entrée de la surface `site` est, elle, servie par
 * construction. Aucune entrée (tous les modules du site coupés) : l'atterrissage
 * anonyme, en dernier recours — et le parcours qui en dépend le dit.
 */
export const sitePage = (): string =>
  visibleNavigation(moduleRegistry, null, 'site')[0]?.href ?? anonymousLanding()

/**
 * **Le parcours d'intégration est-il sur la route d'un compte connecté ?**
 *
 * L'identifiant vient du **module**, jamais d'un littéral : le point de
 * composition de l'application le dérive déjà de la même façon
 * (`apps/web/lib/onboarding.ts`), et sans ce point unique chaque fichier de
 * harnais qui a besoin de la réponse comparerait la chaîne `'onboarding'` de son
 * côté — autant d'occasions de diverger d'un identifiant qui n'a qu'une source.
 * Ce que le harnais lit ici, c'est la **configuration** (`config/features.ts`),
 * pas le registre monté : le processus des parcours n'est pas celui du serveur,
 * et c'est la seule chose que les deux partagent.
 *
 * Ce qui est à source unique ici, c'est la **comparaison** de l'identifiant, pas
 * le nom du module. Balayage : `grep -rlie onboarding e2e/` rend cinq fichiers
 * — `onboarding.spec.ts`, `golden-path/golden-path.spec.ts`, `app-shell.spec.ts`,
 * `support/account.ts` et celui-ci ; les quatre autres passent par
 * `onboardingCourseMounted()` ou par les constantes exportées du module, et
 * `support/account.ts` écrit en plus le nom de table `onboarding_progress`, que
 * le contrat n'expose pas. Aucun d'eux ne compare l'identifiant lui-même.
 */
export const onboardingCourseMounted = (): boolean =>
  enabledModules.some((id) => id === onboardingModule.id)

/**
 * Où atterrit un compte **qui vient d'ouvrir une session** et dont le parcours
 * d'intégration n'a pas été fait (s40).
 *
 * Depuis s61, une ouverture de session sans destination demandée atterrit sur
 * le tableau de bord, `/app` — la constante du module `auth`
 * (`DEFAULT_SIGNED_IN_PATH`), importée ici plutôt que recopiée. Depuis s40, le
 * tableau de bord mène au parcours tant qu'il reste à faire : un compte
 * fraîchement inscrit n'atterrit pas au tableau de bord. L'attente est donc
 * **dérivée** de la configuration, comme celle du visiteur anonyme au-dessus —
 * l'écrire en dur la rendrait fausse dans l'un des deux états, et c'est
 * exactement le défaut que ce fichier existe pour éviter. L'adresse de l'écran
 * elle-même vient du module.
 *
 * Les parcours qui ont besoin du **tableau de bord**, eux, referment d'abord le
 * parcours (`closeOnboardingCourse`, `support/account.ts`) : ce qu'ils mesurent
 * vient après l'intégration. Le parcours doré, lui, le **traverse** — il mesure
 * le chemin réel d'un acheteur, et la raison est écrite dans son fichier.
 */
export const signedInLanding = (): string =>
  onboardingCourseMounted() ? ONBOARDING_SCREEN_PATH : DEFAULT_SIGNED_IN_PATH
