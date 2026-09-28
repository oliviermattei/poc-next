import { parseEnv, type EnvSource } from '@repo/config'
import { describe, expect, it } from 'vitest'

import { resolveAuthConfig } from '../apps/web/lib/auth-config'
import { metadataBaseUrl, resolveSiteUrl } from '../apps/web/lib/site-url'

/**
 * **Deux origines, une résolution** (s64a, ADR 078).
 *
 * Chaque environnement passe par `parseEnv` : ce qui est résolu ici est ce que
 * le schéma a accepté, jamais une forme qu'il aurait refusée. Aucune variable
 * n'est lue du processus — tout est déclaré dans le cas.
 */
const envOf = (source: EnvSource) =>
  parseEnv({
    DATABASE_URL: 'postgres://user:password@localhost:5432/app',
    AUTH_SECRET: 'secret-de-test-uniquement-0123456789abcdef',
    ...source,
  })

describe('la résolution des origines de l’authentification', () => {
  it('sans APP_HOST, rend APP_URL octet pour octet, barre finale comprise', () => {
    // Critère 2 : une re-sérialisation par `new URL` ajouterait une barre
    // finale à `http://localhost:3000` et ferait dériver chaque lien.
    for (const APP_URL of ['http://localhost:3000', 'https://exemple.com/']) {
      const config = resolveAuthConfig(envOf({ APP_URL }))

      expect(config.appUrl, APP_URL).toBe(APP_URL)
      expect(config.siteUrl, APP_URL).toBe(APP_URL)
      expect(config.passkeyRpId, APP_URL).toBe(new URL(APP_URL).hostname)
    }
  })

  it('avec APP_HOST, vise l’application sans déplacer le site ni le rpID, port conservé', () => {
    const cases = [
      {
        env: { APP_URL: 'http://localhost:3000', APP_HOST: 'app.localhost' },
        expected: {
          appUrl: 'http://app.localhost:3000',
          siteUrl: 'http://localhost:3000',
          passkeyRpId: 'localhost',
        },
      },
      {
        env: { APP_URL: 'https://exemple.com/', APP_HOST: 'app.exemple.com' },
        expected: {
          appUrl: 'https://app.exemple.com',
          siteUrl: 'https://exemple.com/',
          passkeyRpId: 'exemple.com',
        },
      },
    ]

    for (const { env, expected } of cases) {
      const { secret, ...origins } = resolveAuthConfig(envOf(env))

      expect(secret).not.toBe('')
      expect(origins, env.APP_HOST).toEqual(expected)
    }
  })

  it('laisse les URL du site sur APP_URL quand APP_HOST est posée', () => {
    // Critère 4 : le plan de site, `robots.txt` et `metadataBase` lisent
    // `APP_URL` et ne passent jamais par la résolution de l'application.
    const env = envOf({ APP_URL: 'https://exemple.com', APP_HOST: 'app.exemple.com' })

    expect(resolveAuthConfig(env).appUrl).toBe('https://app.exemple.com')
    expect(resolveSiteUrl(env)).toBe('https://exemple.com')
    expect(metadataBaseUrl(env)?.origin).toBe('https://exemple.com')
  })
})
