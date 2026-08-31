import { NextResponse, type NextRequest } from 'next/server'

import { LOCALE_HEADER } from './lib/current-locale'
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, localeRouting } from './lib/locale-routing'

/**
 * Le préfixe de locale des URL — **et rien d'autre**.
 *
 * Pourquoi un proxy écrit ici plutôt que `createMiddleware` de `next-intl` :
 * mesuré dans le paquet installé (4.14.1), ce middleware réécrit chaque requête
 * vers `/<locale><chemin>` (`getLocaleAsPrefix`), ce qui **impose un segment
 * `[locale]`** dans l'arborescence. Le critère « module coupé, routes servies
 * sans préfixe » tombe alors, et toutes les routes livrées seraient à déplacer,
 * y compris `/api/modules/…` que le registre monte. Le sens de la réécriture
 * est donc inversé ici : l'arborescence reste sans préfixe, et c'est l'URL
 * publique qui en porte un.
 *
 * Trois cas, et le premier est le seul qui existe module coupé :
 *
 * 1. `canonicalPath` rend `null` et le chemin interne est le chemin reçu — rien
 *    à faire. C'est **toujours** l'état de `singleLocaleRouting` : « aucune
 *    redirection de locale n'a lieu » est un critère, pas une conséquence ;
 * 2. l'URL porte déjà son préfixe — il est retiré pour atteindre le fichier de
 *    route, et la locale part dans un en-tête ;
 * 3. l'URL n'en porte pas — redirection vers sa forme canonique, dans la langue
 *    que le cookie ou le navigateur désigne.
 *
 * **La persistance du choix est ici, et nulle part ailleurs.** Suivre une URL
 * préfixée est le geste explicite de changement de langue — c'est ce que fait
 * le sélecteur, dont chaque option est un lien —, donc c'est là que le cookie
 * s'écrit. Le faire dans le composant client aurait donné deux chemins vers le
 * même état, dont l'un ne fonctionne pas sans JavaScript ; et le faire à chaque
 * requête, préfixe ou non, aurait figé la langue devinée du navigateur comme si
 * l'utilisateur l'avait choisie.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value ?? null
  const localeRequest = {
    pathname,
    cookieLocale,
    acceptLanguage: request.headers.get('accept-language'),
  }

  const canonical = localeRouting.canonicalPath(localeRequest)

  if (canonical !== null) {
    return NextResponse.redirect(new URL(`${canonical}${search}`, request.url))
  }

  const internal = localeRouting.internalPath(pathname)
  const locale = localeRouting.resolve(localeRequest)
  const headers = new Headers(request.headers)

  headers.set(LOCALE_HEADER, locale)

  const response =
    internal === pathname
      ? NextResponse.next({ request: { headers } })
      : NextResponse.rewrite(new URL(`${internal}${search}`, request.url), {
          request: { headers },
        })

  if (internal !== pathname && cookieLocale !== locale) {
    // Un an, pour que le choix survive à la fermeture du navigateur (critère 2).
    // `SameSite=Lax` : le cookie doit survivre à un lien entrant. `Secure` est
    // posé partout comme pour la session (`docs/security.md` §2) ; les
    // navigateurs traitent `localhost` comme une origine sûre.
    //
    // `HttpOnly` bien que ce cookie ne porte aucun secret : le §1 du socle ne
    // pose aucune condition, et c'est le premier cookie hors session du dépôt —
    // celui qui fixe le précédent des suivants. Rien côté client ne le lit :
    // le sélecteur est une liste de liens, et c'est ce proxy qui écrit.
    response.cookies.set(LOCALE_COOKIE, locale, {
      path: '/',
      maxAge: LOCALE_COOKIE_MAX_AGE,
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
    })
  }

  return response
}

/**
 * Ce que le proxy ne voit pas, et ne doit pas voir.
 *
 * `/api` en tête : les routes que le registre monte vivent sous
 * `/api/modules/…` et **n'héritent d'aucun préfixe de locale**. Les préfixer
 * casserait chaque lien envoyé par email et chaque appel des formulaires. Leur
 * langue, elles la lisent dans le cookie de la requête, pas dans leur URL.
 */
export const config = {
  matcher: ['/((?!api|_next|favicon.ico|.*\\..*).*)'],
}
