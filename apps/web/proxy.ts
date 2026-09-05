import { getNodeEnv } from '@repo/config'
import { carriesLocalePrefix } from '@repo/core'
import { NextResponse, type NextRequest } from 'next/server'

import { contentSecurityPolicySources } from '../../config/security'
import { LOCALE_HEADER } from './lib/current-locale'
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, localeRouting } from './lib/locale-routing'
import { CSP_REPORT_PATH, NONCE_HEADER, policyMode, securityHeaders } from './lib/security-headers'

/**
 * Le préfixe de locale des URL, **et le socle d'en-têtes de sécurité**.
 *
 * Les deux vivent ici parce que ce fichier est le seul endroit traversé par
 * toute réponse : la politique de sécurité du contenu doit accompagner les
 * pages **et** les routes de l'API (`docs/security.md` §1), et la partager avec
 * `headers()` de `next.config.ts` ferait partir deux en-têtes dont le navigateur
 * applique l'intersection.
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
/**
 * Ce qui **ne porte pas** de préfixe de locale : `carriesLocalePrefix`, de
 * `@repo/core`.
 *
 * La règle vivait ici — elle était le motif du `matcher` jusqu'à s45. Elle est
 * montée dans le socle en s53 parce qu'un **second appelant** en a besoin : la
 * dérivation des URL indexables (`apps/web/lib/public-urls.ts`) applique
 * `publicPath`, qui préfixe sans condition. Deux écritures de la même règle
 * auraient divergé au premier module contribuant l'URL d'une route montée.
 */

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value ?? null
  const localeRequest = {
    pathname,
    cookieLocale,
    acceptLanguage: request.headers.get('accept-language'),
  }

  // Un nonce **par requête** : c'est toute la valeur du mécanisme. `randomUUID`
  // est cryptographiquement sûr, ce qu'un `Math.random()` n'est pas — un nonce
  // devinable vaut `unsafe-inline`.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const security = securityHeaders({
    mode: policyMode(getNodeEnv()),
    nonce,
    sources: contentSecurityPolicySources,
    reportPath: CSP_REPORT_PATH,
  })

  const withSecurityHeaders = <T extends NextResponse>(response: T): T => {
    for (const [name, value] of Object.entries(security)) {
      response.headers.set(name, value)
    }

    response.headers.set(NONCE_HEADER, nonce)

    return response
  }

  const canonical = carriesLocalePrefix(pathname)
    ? localeRouting.canonicalPath(localeRequest)
    : null

  if (canonical !== null) {
    return withSecurityHeaders(
      NextResponse.redirect(new URL(`${canonical}${search}`, request.url)),
    )
  }

  const internal = carriesLocalePrefix(pathname)
    ? localeRouting.internalPath(pathname)
    : pathname
  const locale = localeRouting.resolve(localeRequest)
  const headers = new Headers(request.headers)

  headers.set(LOCALE_HEADER, locale)
  // **Sur les en-têtes de la requête, et pas seulement de la réponse.** Next lit
  // le nonce là — `dist/server/app-render/app-render.js` prend
  // `headers['content-security-policy']` puis `getScriptNonceFromHeader` — pour
  // le poser sur ses propres balises.
  //
  // Ce que la revue de s45 a **mesuré**, et qui corrige ce que cette story
  // affirmait d'abord : sur le runtime **Node** de Next 16.3.3, retirer ces deux
  // lignes ne casse pas l'hydratation. `resolve-routes.js` (§`router-utils`)
  // recopie chaque en-tête de réponse ordinaire du proxy sur `req.headers`
  // (`resHeaders[key] = value; req.headers[key] = value`), si bien que la
  // politique posée sur la réponse atteint le rendu de toute façon — et le
  // `x-nonce` que lit `app/layout.tsx` avec elle. Le câblage reste parce qu'il
  // est la voie **explicite**, celle du mécanisme de surcharge
  // `x-middleware-request-*`, probablement porteuse sur un runtime edge où la
  // recopie ci-dessus n'existe pas : **ce runtime-là n'a pas été mesuré**, ni
  // par la story ni par la revue. Ce qui est faux, c'est « sans ces lignes, la
  // page ne s'hydrate pas » : sur le runtime Node, elle s'hydrate.
  headers.set('content-security-policy', security['content-security-policy']!)
  headers.set(NONCE_HEADER, nonce)

  const response = withSecurityHeaders(
    internal === pathname
      ? NextResponse.next({ request: { headers } })
      : NextResponse.rewrite(new URL(`${internal}${search}`, request.url), {
          request: { headers },
        }),
  )

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
 * Depuis s45 il voit **tout ce qui produit une réponse de l'application** :
 * pages, routes d'API, `/robots.txt`, `/sitemap.xml`. Le critère l'exige — « les
 * en-têtes sont présents aussi bien sur les pages publiques que sur les routes
 * de l'API » — et la seule autre voie, `headers()` de `next.config.ts`, aurait
 * posé un second `Content-Security-Policy` sur les chemins couverts par les
 * deux. Le préfixe de locale, lui, garde exactement son périmètre d'avant :
 * c'est `carriesLocalePrefix` qui le porte désormais, et `pnpm test` le vérifie
 * sur `/robots.txt`, `/sitemap.xml` et `/api/…`.
 *
 * Restent hors du proxy les seuls chemins qui ne sont pas des réponses de
 * l'application : les artefacts statiques de Next et l'optimiseur d'images. Ils
 * ne portent ni HTML ni JSON, donc aucune politique à appliquer, et les faire
 * traverser le proxy coûterait un nonce par fichier servi.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}
