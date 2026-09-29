import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ACCOUNT_SCREEN_PATH } from '@repo/module-auth'
import { CONSENT_COOKIE } from '@repo/module-consent'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LOCALE_COOKIE, localeRouting } from '../apps/web/lib/locale-routing'
import { proxy } from '../apps/web/proxy'

/**
 * **L'aiguillage par hôte** (s64b1, ADR 079).
 *
 * Avec `APP_HOST`, le proxy sert, redirige ou refuse chaque zone selon l'hôte
 * demandé. Chaque requête est construite sur l'hôte d'**écoute** de l'image —
 * `0.0.0.0:3000` —, jamais sur l'hôte demandé : c'est ce que Next donne au
 * proxy dans `request.url` (s64b, fait 1), et c'est ce qui prouve qu'aucune
 * cible n'en est bâtie.
 */

const SITE = 'https://exemple.com'
const APP = 'https://app.exemple.com'
const LISTEN = 'http://0.0.0.0:3000'

/** La langue que le proxy retient en `accept-language: fr`, sans cookie. */
const LOCALE = localeRouting.resolve({ pathname: '/', cookieLocale: null, acceptLanguage: 'fr' })
const P = (path: string): string => localeRouting.publicPath(path, LOCALE)

/**
 * **Une seule langue servie, pas de cookie de langue** : le module `i18n` coupé
 * (`pnpm test:minimal-profile`), le proxy ne pose jamais `app_locale`, et les
 * cas qui le mesurent n'ont rien à mesurer. Même garde que `tests/i18n.test.ts`.
 */
const SINGLE_LOCALE = localeRouting.locales.length < 2

const proxied = (
  path: string,
  headers: Record<string, string>,
  method = 'GET',
): ReturnType<typeof proxy> =>
  proxy(
    new NextRequest(new URL(path, LISTEN), {
      method,
      headers: { 'accept-language': 'fr', ...headers },
    }),
  )

const SITE_HOST = { host: 'exemple.com' }
const APP_HOST = { host: 'app.exemple.com' }

describe('avec APP_HOST', () => {
  beforeEach(() => {
    vi.stubEnv('APP_URL', SITE)
    vi.stubEnv('APP_HOST', 'app.exemple.com')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // [cas, en-têtes, méthode, chemin, statut, Location attendue — null : servie]
  it.each([
    // Hôte de l'application.
    ['app : Hors zone servie', APP_HOST, 'GET', P('/sign-in'), 200, null],
    ['app : application servie', APP_HOST, 'GET', P('/app'), 200, null],
    ['app : console servie', APP_HOST, 'GET', P('/console'), 200, null],
    ['app : API d’auth servie', APP_HOST, 'POST', '/api/modules/auth/sign-in/email', 200, null],
    ['app : la racine mène à /app', APP_HOST, 'GET', P('/'), 308, `${APP}${P('/app')}`],
    [
      'app : le site repart vers le site, langue et requête conservées',
      APP_HOST,
      'GET',
      `${P('/pricing')}?checkout=ok`,
      308,
      `${SITE}${P('/pricing')}?checkout=ok`,
    ],
    // Hôte du site.
    ['site : site servi', SITE_HOST, 'GET', P('/pricing'), 200, null],
    ['site : reste de l’API servi', SITE_HOST, 'POST', '/api/modules/consent/decide', 200, null],
    ['site : application redirigée', SITE_HOST, 'GET', P('/app'), 308, `${APP}${P('/app')}`],
    [
      'site : un ancien chemin en un seul saut, vers sa cible finale',
      SITE_HOST,
      'GET',
      // `/account` et non `/billing` : le module `auth` est requis, donc
      // présent dans tous les profils. `pnpm test:minimal-profile` coupe la
      // facturation, et son ancien chemin n'a alors plus de cible.
      `${P('/account')}?a=1`,
      308,
      `${APP}${P(ACCOUNT_SCREEN_PATH)}?a=1`,
    ],
    ['site : Hors zone redirigée', SITE_HOST, 'GET', P('/sign-in'), 308, `${APP}${P('/sign-in')}`],
    ['site : console introuvable', SITE_HOST, 'GET', P('/console'), 404, null],
    [
      'site : lien d’auth en GET redirigé',
      SITE_HOST,
      'GET',
      '/api/modules/auth/magic-link/verify?token=t',
      308,
      `${APP}/api/modules/auth/magic-link/verify?token=t`,
    ],
    ['site : auth en POST introuvable', SITE_HOST, 'POST', '/api/modules/auth/sign-in/email', 404, null],
    [
      'x-forwarded-host ignoré : seul Host choisit la branche (ADR 081, #67)',
      { host: 'app.exemple.com', 'x-forwarded-host': 'exemple.com' },
      'GET',
      P('/sign-in'),
      200,
      null,
    ],
    [
      'Host en majuscules : la branche est choisie, la configuration construit la cible',
      { host: 'EXEMPLE.com' },
      'GET',
      P('/sign-in'),
      308,
      `${APP}${P('/sign-in')}`,
    ],
    ['hôte inconnu : la sonde de santé servie', { host: '0.0.0.0:3000' }, 'GET', '/api/health', 200, null],
    ['hôte inconnu : rien n’est aiguillé', { host: '0.0.0.0:3000' }, 'GET', P('/console'), 200, null],
  ] as const)('%s', (_, headers, method, path, status, location) => {
    const response = proxied(path, headers, method)

    expect(response.status).toBe(status)
    expect(response.headers.get('location')).toBe(location)
  })

  it('interdit la mise en cache des redirections d’aiguillage (ADR 081)', () => {
    const routed = proxied(P('/sign-in'), SITE_HOST)

    expect(routed.status).toBe(308)
    expect(routed.headers.get('cache-control')).toBe('no-store')
  })

  it('pose la même politique de sécurité du contenu sur une réponse aiguillée et une réponse servie', () => {
    const policyOf = (response: ReturnType<typeof proxy>): string =>
      (response.headers.get('content-security-policy') ?? '').replace(/'nonce-[^']+'/g, "'nonce'")

    const routed = proxied(P('/sign-in'), SITE_HOST)
    const refused = proxied(P('/console'), SITE_HOST)
    const served = proxied(P('/pricing'), SITE_HOST)

    expect(routed.status).toBe(308)
    expect(policyOf(served)).toContain("default-src 'self'")
    expect(policyOf(routed)).toBe(policyOf(served))
    expect(policyOf(refused)).toBe(policyOf(served))
  })
})

/**
 * **Les cookies partagés** (s64c) : avec `APP_HOST`, la langue et le
 * consentement vivent sur le domaine parent, et la copie d'avant, propre à
 * l'hôte, est effacée — sans `Domain`, sinon c'est le parent qui partirait.
 */
describe('les cookies partagés, avec APP_HOST', () => {
  beforeEach(() => {
    vi.stubEnv('APP_URL', `${SITE}:8443`)
    vi.stubEnv('APP_HOST', 'app.exemple.com')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const EN = localeRouting.publicPath('/pricing', 'en')
  const clearanceOf = (name: string): RegExp => new RegExp(`^${name}=; Path=/; Max-Age=0;`)

  it.skipIf(SINGLE_LOCALE)('pose la langue sur le domaine parent, puis efface la copie d’hôte', () => {
    const cookies = proxied(EN, { host: 'exemple.com:8443' }).headers.getSetCookie()
    const [written, cleared, ...rest] = cookies

    expect(rest, cookies.join('\n')).toEqual([])
    // L'hôte d'`APP_URL`, sans port.
    expect(written).toMatch(new RegExp(`^${LOCALE_COOKIE}=en;.*Domain=exemple\\.com(;|$)`, 'i'))
    expect(cleared).toMatch(clearanceOf(LOCALE_COOKIE))
    expect(cleared).not.toMatch(/Domain=/i)
  })

  it('efface la copie d’hôte d’un cookie que l’en-tête porte deux fois, sans ré-émettre sa valeur', () => {
    const cookies = proxied(P('/pricing'), {
      ...SITE_HOST,
      cookie: `${CONSENT_COOKIE}=v=1&analytics=0; ${LOCALE_COOKIE}=${LOCALE}; ${CONSENT_COOKIE}=v=1&analytics=1`,
    }).headers.getSetCookie()

    expect(cookies).toHaveLength(1)
    expect(cookies[0]).toMatch(clearanceOf(CONSENT_COOKIE))
    expect(cookies[0]).not.toMatch(/Domain=/i)
  })

  it('n’efface rien sans doublon', () => {
    const response = proxied(P('/pricing'), {
      ...SITE_HOST,
      cookie: `${CONSENT_COOKIE}=v=1&analytics=1; ${LOCALE_COOKIE}=${LOCALE}`,
    })

    expect(response.status).toBe(200)
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it.skipIf(SINGLE_LOCALE)('retient la dernière occurrence d’un doublon : celle du parent, la plus récente', () => {
    const response = proxied('/pricing', {
      ...SITE_HOST,
      cookie: `${LOCALE_COOKIE}=fr; ${LOCALE_COOKIE}=en`,
    })

    expect(new URL(response.headers.get('location')!).pathname).toBe(EN)
    expect(response.headers.getSetCookie()).toEqual([
      expect.stringMatching(clearanceOf(LOCALE_COOKIE)),
    ])
  })
})

describe('sans APP_HOST', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.skipIf(SINGLE_LOCALE)('pose la langue sans domaine et n’efface rien, même sur un doublon', () => {
    vi.stubEnv('APP_URL', SITE)
    vi.stubEnv('APP_HOST', '')

    const cookies = proxied(localeRouting.publicPath('/pricing', 'en'), {
      ...SITE_HOST,
      cookie: `${CONSENT_COOKIE}=v=1; ${CONSENT_COOKIE}=v=1`,
    }).headers.getSetCookie()

    expect(cookies).toHaveLength(1)
    expect(cookies[0]).toMatch(new RegExp(`^${LOCALE_COOKIE}=en;`))
    expect(cookies[0]).not.toMatch(/Domain=/i)
  })

  it('n’aiguille rien : la console est servie sur l’hôte du site', () => {
    vi.stubEnv('APP_URL', SITE)
    vi.stubEnv('APP_HOST', '')

    const response = proxied(P('/console'), SITE_HOST)

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })
})

/**
 * **Une redirection émise par une route est relative** (s64b2, ADR 080, #69).
 *
 * `request.url` porte l'hôte d'**écoute** du serveur — `0.0.0.0:3000` dans
 * l'image —, et Next ne relativise que les `Location` du proxy. Un
 * `new URL(chemin, request.url)` envoyait donc le navigateur ailleurs que sur
 * l'hôte demandé, et CSP `form-action 'self'` bloquait le formulaire natif.
 *
 * Balayé : les routes des modules (`packages/modules/*\/src/presentation`) et
 * celles de l'application (`apps/web/app/api`). `Response.redirect` est écarté
 * avec : il exige une URL absolue, donc une origine, et la seule à portée d'une
 * route est celle-là.
 */
describe('les redirections des routes', () => {
  const ROOT = fileURLToPath(new URL('..', import.meta.url))

  const sources = (directory: string): string[] =>
    readdirSync(directory).flatMap((entry) => {
      const path = join(directory, entry)

      if (statSync(path).isDirectory()) {
        return sources(path)
      }

      return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : []
    })

  const MODULES = join(ROOT, 'packages/modules')
  const swept = [
    ...readdirSync(MODULES)
      .map((module) => join(MODULES, module, 'src/presentation'))
      .filter((directory) => {
        try {
          return statSync(directory).isDirectory()
        } catch {
          return false
        }
      })
      .flatMap(sources),
    ...sources(join(ROOT, 'apps/web/app/api')),
  ]

  it('ne bâtit aucun Location sur `request.url`', () => {
    // Plancher anti-balayage-vide : une arborescence déplacée rendrait le cas
    // vert sans rien lire. Mesuré à l'écriture : bien au-delà de vingt fichiers.
    expect(swept.length).toBeGreaterThan(20)

    const offenders = swept.flatMap((file) => {
      const text = readFileSync(file, 'utf8')
      const found = [
        ...text.matchAll(/new URL\([^;]*?,\s*request\.url\s*\)/gs),
        ...text.matchAll(/Response\.redirect\(/g),
      ]

      return found.map((match) => `${relative(ROOT, file)} : ${match[0].replace(/\s+/g, ' ')}`)
    })

    expect(offenders).toEqual([])
  })
})
