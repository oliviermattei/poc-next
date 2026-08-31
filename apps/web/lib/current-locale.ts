import { resolveLocale, type Locale } from '@repo/core'
import { cookies, headers } from 'next/headers'

import { LOCALE_COOKIE, localeRouting } from './locale-routing'

/**
 * L'en-tête par lequel le proxy transmet la locale de la requête.
 *
 * Le proxy est le seul endroit qui voit l'URL entrante en entier ; un composant
 * serveur, lui, ne reçoit que des en-têtes. C'est le même mécanisme que
 * `next-intl` utilise entre son middleware et sa configuration de requête, et
 * pour la même raison.
 */
export const LOCALE_HEADER = 'x-app-locale'

/**
 * La locale de la requête en cours — **la même fonction dans les deux états**.
 *
 * Module `i18n` coupé, `localeRouting` est `singleLocaleRouting` : la liste des
 * locales servies se réduit à la locale par défaut, et cette fonction rend
 * cette locale quoi qu'annoncent l'en-tête ou le cookie. Il n'y a pas de
 * seconde branche à écrire, ici ni ailleurs.
 *
 * L'en-tête posé par le proxy est **rejugé** contre les locales servies : un
 * en-tête est une donnée d'entrée comme une autre, et un client qui l'enverrait
 * lui-même ne doit pas pouvoir demander un catalogue qui n'existe pas.
 */
export async function currentLocale(): Promise<Locale> {
  const [headerBag, cookieBag] = await Promise.all([headers(), cookies()])
  const announced = headerBag.get(LOCALE_HEADER)

  if (announced !== null) {
    return resolveLocale({
      locales: localeRouting.locales,
      defaultLocale: localeRouting.defaultLocale,
      candidate: announced,
    })
  }

  // Aucun proxy n'est passé (rendu statique, appel interne) : la décision est
  // reprise depuis les mêmes entrées, par la même règle.
  return localeRouting.resolve({
    pathname: '/',
    cookieLocale: cookieBag.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: headerBag.get('accept-language'),
  })
}
