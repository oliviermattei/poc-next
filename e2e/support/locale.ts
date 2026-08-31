import { localeRouting } from '../../apps/web/lib/locale-routing'
import { marketingSite } from '../../apps/web/lib/marketing'
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
 * URL l'est de `localeRouting`. Un visiteur **connecté**, lui, conserve son
 * tableau de bord dans les deux états : les cas qui l'observent gardent `/`.
 */
export const anonymousLanding = (): string =>
  marketingSite.sections.length > 0 ? '/' : '/sign-in'
