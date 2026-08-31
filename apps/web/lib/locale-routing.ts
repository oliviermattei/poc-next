import { singleLocaleRouting, type Locale, type LocaleRouting } from '@repo/core'
import { i18nModule, localePrefixRouting } from '@repo/module-i18n'

import { appLocales, defaultLocale } from '../../../config/i18n'
import { moduleRegistry } from './module-registry'

/**
 * Le point de composition de l'i18n — le troisième du même modèle, après
 * `lib/mailer.ts` (quel fournisseur d'emails) et `lib/auth.ts` (quel service
 * d'authentification).
 *
 * C'est **le seul fichier de l'application** qui connaisse `@repo/module-i18n`,
 * et le seul qui regarde si ce module est monté. Ailleurs — écrans, navigation,
 * proxy, modules à venir — on appelle `localeRouting`, dont la **forme est la
 * même dans les deux états** (`LocaleRouting`, `@repo/core`). C'est ce qui
 * empêche trente-six stories de porter une branche « si l'i18n existe ».
 *
 * Le choix se lit dans le **registre**, jamais dans `config/features.ts`
 * directement : le registre est déjà la vérité sur ce qui est activé, et
 * l'identifiant vient du module lui-même — pas d'une chaîne recopiée qu'un
 * renommage laisserait fausse.
 *
 * Ce que chaque état donne :
 *
 * | | module activé | module coupé |
 * |---|---|---|
 * | URL | `/fr/account` | `/account` |
 * | locales servies | `config/i18n.ts` au complet | `defaultLocale` seule |
 * | redirection de locale | oui, vers la forme canonique | **aucune** |
 * | sélecteur | affiché | absent (`locales` n'a qu'une entrée) |
 *
 * Aucun `next` ici : ce fichier est importé par le proxy, par les écrans **et**
 * par les parcours Playwright, qui n'ont pas de contexte de requête.
 */
export const localeRouting: LocaleRouting = moduleRegistry.moduleIds.includes(i18nModule.id)
  ? localePrefixRouting({ locales: [...appLocales], defaultLocale })
  : singleLocaleRouting(defaultLocale)

/** Le nom du cookie qui porte le choix de langue, et sa durée de vie. */
export const LOCALE_COOKIE = 'app_locale'

/** Un an : le choix de langue survit à la fermeture du navigateur (critère 2). */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export type { Locale }
