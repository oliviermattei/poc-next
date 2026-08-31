import { resolveLocale, type Locale, type LocaleRequest, type LocaleRouting } from '@repo/core'

import { preferredLocale, splitLocalePrefix, withLocalePrefix } from '../domain/locale-prefix'

/**
 * Le routage par locale **du module** : celui qui préfixe.
 *
 * Il implémente la même forme que `singleLocaleRouting` de `@repo/core`, servi
 * quand le module est coupé. C'est la seule différence entre les deux états, et
 * elle est confinée ici : ni les écrans, ni la navigation, ni un module écrit
 * plus tard ne savent laquelle des deux est en place.
 *
 * L'ordre de décision de la locale — **et il est le contrat de la
 * persistance** :
 *
 * 1. le **préfixe de l'URL**, quand il y en a un : une URL partagée doit
 *    s'ouvrir dans sa langue, pas dans celle du destinataire ;
 * 2. le **cookie**, le choix explicite de l'utilisateur, qui survit à la
 *    fermeture du navigateur ;
 * 3. l'en-tête `Accept-Language`, la seule chose connue d'un premier visiteur ;
 * 4. la locale par défaut du site.
 *
 * Chacune de ces quatre étapes passe par `resolveLocale` : une valeur non
 * livrée n'est jamais servie, d'où qu'elle vienne.
 */
export interface LocalePrefixOptions {
  readonly locales: readonly Locale[]
  readonly defaultLocale: Locale
}

export function localePrefixRouting({
  locales,
  defaultLocale,
}: LocalePrefixOptions): LocaleRouting {
  const choose = (candidate: string | null | undefined): Locale =>
    resolveLocale({ locales, defaultLocale, candidate })

  const resolve = (request: LocaleRequest): Locale => {
    const { locale } = splitLocalePrefix(request.pathname, locales)

    if (locale !== null) {
      return locale
    }

    if (request.cookieLocale !== null && locales.includes(request.cookieLocale)) {
      return choose(request.cookieLocale)
    }

    return choose(preferredLocale(request.acceptLanguage, locales))
  }

  return {
    locales,
    defaultLocale,
    prefixed: true,
    resolve,
    internalPath: (pathname) => splitLocalePrefix(pathname, locales).pathname,
    // Le préfixe éventuel est **retiré avant** d'être reposé : la mise en forme
    // est donc idempotente. Sans cela, un chemin déjà public repassé par ici
    // devient `/fr/fr/account` — mesuré au navigateur sur la destination de
    // retour d'un écran protégé, où le chemin fait un aller-retour par la
    // chaîne de requête. Le rendre idempotent ferme la classe entière, pas
    // seulement l'appelant fautif.
    publicPath: (pathname, locale) =>
      withLocalePrefix(splitLocalePrefix(pathname, locales).pathname, choose(locale)),
    canonicalPath: (request) => {
      const { locale, pathname } = splitLocalePrefix(request.pathname, locales)

      // Déjà préfixée : rien à faire. Rediriger ici ferait une boucle.
      return locale === null ? withLocalePrefix(pathname, resolve(request)) : null
    },
  }
}
