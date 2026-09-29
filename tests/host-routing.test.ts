import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BILLING_SCREEN_PATH } from '@repo/module-billing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { localeRouting } from '../apps/web/lib/locale-routing'
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
      `${P('/billing')}?a=1`,
      308,
      `${APP}${P(BILLING_SCREEN_PATH)}?a=1`,
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
      'x-forwarded-host hostile : il choisit la branche, la configuration construit la cible',
      { host: 'evil.test:8080', 'x-forwarded-host': 'EXEMPLE.com, evil.test' },
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

describe('sans APP_HOST', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
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
