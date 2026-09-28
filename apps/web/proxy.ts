import { getHostRouting, getNodeEnv, type HostRouting } from '@repo/config'
import { carriesLocalePrefix, MODULE_ROUTE_PREFIX, type Locale } from '@repo/core'
import { authModule } from '@repo/module-auth'
import { NextResponse, type NextRequest } from 'next/server'

import { contentSecurityPolicySources } from '../../config/security'
import { LOCALE_HEADER } from './lib/current-locale'
import { legacyScreenTarget } from './lib/legacy-paths'
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, localeRouting } from './lib/locale-routing'
import { moduleRegistry } from './lib/module-registry'
import { CSP_REPORT_PATH, NONCE_HEADER, policyMode, securityHeaders } from './lib/security-headers'
import { zoneOf } from './lib/zones'

/**
 * **L'hôte demandé**, en minuscules : `x-forwarded-host` (premier élément
 * d'une liste), sinon `host`. Next remplit le premier depuis le second ;
 * `request.url` porte l'hôte d'**écoute**, jamais celui-là (s64b, fait 1).
 *
 * Contrôlable par le client sans proxy amont : il **choisit une branche** et
 * rien d'autre — aucune URL n'est construite avec (ADR 079).
 */
const requestedHost = (headers: Headers): string | null => {
  const forwarded = headers.get('x-forwarded-host')?.split(',')[0]?.trim() ?? ''
  const host = forwarded === '' ? (headers.get('host')?.trim() ?? '') : forwarded

  return host === '' ? null : host.toLowerCase()
}

/** Le préfixe des routes du module d'authentification, servies par la seule application. */
const AUTH_ROUTES_PREFIX = `${MODULE_ROUTE_PREFIX}/${authModule.id}/`

interface HostRouteInput {
  readonly request: NextRequest
  readonly routing: HostRouting
  /** Le chemin interne, préfixe de langue retiré. */
  readonly internal: string
  readonly locale: Locale
}

/**
 * **L'aiguillage par hôte** (s64b1, ADR 079) : la réponse du proxy quand
 * l'hôte demandé n'a pas le droit de servir cette zone, ou `null` pour servir.
 *
 * | zone | hôte de l'application | hôte du site |
 * |---|---|---|
 * | site | 308 vers le site (`/` : 308 vers `/app`) | servie |
 * | Hors zone | servie | 308 vers l'application |
 * | application, anciens chemins | servie | 308 vers la cible finale, un saut |
 * | console | servie | **404** |
 * | `/api/modules/auth/*` | servie | GET/HEAD : 308 ; autre verbe : 404 |
 * | reste de l'API | servie | servie |
 *
 * Un hôte ni du site ni de l'application — la sonde de santé sur l'IP du
 * conteneur — n'est pas aiguillé. **Toute cible est bâtie sur une origine
 * configurée** : le chemin est posé par `pathname`, jamais concaténé à
 * l'origine, si bien qu'un chemin `//ailleurs` ne change pas d'hôte.
 */
function hostRoute({ request, routing, internal, locale }: HostRouteInput): NextResponse | null {
  const host = requestedHost(request.headers)
  const { pathname, search } = request.nextUrl

  const redirectTo = (origin: string, path: string): NextResponse => {
    const target = new URL(origin)

    target.pathname = path
    target.search = search

    return NextResponse.redirect(target, 308)
  }

  const zone = zoneOf(internal)

  if (host === new URL(routing.appOrigin).host) {
    if (internal === '/') {
      return redirectTo(routing.appOrigin, localeRouting.publicPath('/app', locale))
    }

    return zone === 'site' ? redirectTo(routing.siteOrigin, pathname) : null
  }

  if (host !== new URL(routing.siteOrigin).host) {
    return null
  }

  switch (zone) {
    case 'app': {
      const legacy = carriesLocalePrefix(pathname)
        ? legacyScreenTarget(internal, moduleRegistry)
        : null

      return redirectTo(
        routing.appOrigin,
        legacy === null ? pathname : localeRouting.publicPath(legacy, locale),
      )
    }
    case 'outside':
      return redirectTo(routing.appOrigin, pathname)
    case 'console':
      return new NextResponse(null, { status: 404 })
    case 'api':
      if (!internal.startsWith(AUTH_ROUTES_PREFIX)) {
        return null
      }

      return request.method === 'GET' || request.method === 'HEAD'
        ? redirectTo(routing.appOrigin, pathname)
        : new NextResponse(null, { status: 404 })
    default:
      return null
  }
}

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

  const internal = carriesLocalePrefix(pathname)
    ? localeRouting.internalPath(pathname)
    : pathname
  const locale = localeRouting.resolve(localeRequest)

  /**
   * **L'aiguillage par hôte** (s64b1, ADR 079), avant tout le reste : placé
   * après le 308 legacy, `/billing` demandé au site ferait deux sauts. Sans
   * `APP_HOST`, `getHostRouting` rend `null` et rien ne change.
   */
  const routing = getHostRouting()
  const routed = routing === null ? null : hostRoute({ request, routing, internal, locale })

  if (routed !== null) {
    return withSecurityHeaders(routed)
  }

  /**
   * **Les anciens chemins d'écran** (s62a, ADR 075) : 308 vers la cible de la
   * table, **avant** la redirection de langue.
   *
   * La recherche porte sur le chemin **interne** — `/fr/account` et `/account`
   * y sont la même clé —, et la cible est re-préfixée dans la langue de la
   * requête : l'URL préfixée l'emporte, puis le cookie, puis le navigateur,
   * exactement comme pour la redirection canonique. Placée après celle-ci,
   * `/account` aurait fait deux sauts (307 vers `/fr/account`, puis 308) ;
   * placée avant `internalPath`, `/fr/account` n'aurait rien trouvé. La
   * cible est une constante de la table, jamais une valeur de la requête ; la
   * chaîne de requête suit telle quelle, comme pour la redirection de langue.
   */
  const legacy = carriesLocalePrefix(pathname)
    ? legacyScreenTarget(internal, moduleRegistry)
    : null

  if (legacy !== null) {
    return withSecurityHeaders(
      NextResponse.redirect(
        new URL(`${localeRouting.publicPath(legacy, locale)}${search}`, request.url),
        308,
      ),
    )
  }

  const canonical = carriesLocalePrefix(pathname)
    ? localeRouting.canonicalPath(localeRequest)
    : null

  if (canonical !== null) {
    return withSecurityHeaders(
      NextResponse.redirect(new URL(`${canonical}${search}`, request.url)),
    )
  }

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
