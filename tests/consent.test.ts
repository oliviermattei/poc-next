import { buildRegistry } from '@repo/core'
import {
  CONSENT_CATEGORIES,
  CONSENT_COOKIE,
  CONSENT_SCREEN_PATH,
  CONSENT_STATUSES,
  configureConsent,
  consentMessageKeys,
  consentModule,
  consentRoutePath,
  resetConsentService,
  type NonEssentialScript,
} from '@repo/module-consent'
import type { Env } from '@repo/config'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GET as probeRoute } from '../apps/web/app/api/consent-probe/[script]/route'
import { consent, probeScriptOf, resolveNonEssentialScripts } from '../apps/web/lib/consent'
import { localeRouting } from '../apps/web/lib/locale-routing'
import { moduleRegistry } from '../apps/web/lib/module-registry'
import { availableModules, enabledModules, requiredModules } from '../config/features'
import { appLocales, defaultLocale } from '../config/i18n'
import { ANONYMOUS, FIXTURE_CONSENT_SCRIPTS, SIGNED_IN, viewerState } from './fixtures/screen-viewer'
import { dispatchAllowingRateLimit } from './fixtures/rate-limit'

/* ------------------------------------------------------------------------- *
 * Ce qui est remplacé pour rendre deux écrans, et rien de plus : la base et le
 * contexte de requête. Les écrans, les composants du design system et le
 * traducteur sont les vrais — c'est la discipline de `tests/rendered-text.test.ts`,
 * dont ce fichier reprend les doublures.
 * ------------------------------------------------------------------------- */

vi.mock('../apps/web/lib/auth', async () => {
  const { authRoutePath, safeRedirectPath } = await import('@repo/module-auth')
  const {
    FIXTURE_DATA_EXPORTS,
    FIXTURE_PASSKEYS,
    FIXTURE_SESSIONS,
    FIXTURE_SIGN_IN_METHODS,
    viewerState: state,
  } = await import('./fixtures/screen-viewer')

  return {
    authRoutePath,
    safeRedirectPath,
    currentViewer: () => Promise.resolve(state.value),
    currentSessions: () => Promise.resolve(FIXTURE_SESSIONS),
    currentSignInMethods: () => Promise.resolve(FIXTURE_SIGN_IN_METHODS),
    currentPasskeys: () => Promise.resolve(FIXTURE_PASSKEYS),
    oauthProviders: () => [],
    currentDataExportRequests: () => Promise.resolve(FIXTURE_DATA_EXPORTS),
  }
})

vi.mock('../apps/web/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../apps/web/lib/storage')>()

  return { ...actual, storage: { ...actual.storage, avatarOf: () => Promise.resolve(null) } }
})

vi.mock('../apps/web/lib/i18n', async () => {
  const { createTranslator } = await import('next-intl')
  const { localeRouting } = await import('../apps/web/lib/locale-routing')
  const { pseudoRequestConfig } = await import('./fixtures/pseudo-locale')
  const { defaultLocale: locale } = await import('../config/i18n')

  return {
    appIntl: () =>
      Promise.resolve({
        locale,
        t: createTranslator(pseudoRequestConfig(locale)),
        path: (pathname: string) => localeRouting.publicPath(pathname, locale),
      }),
  }
})

/**
 * Le pot de cookies de la requête : **du contexte**, pas une règle.
 *
 * Un visiteur qui n'a rien décidé — c'est l'état d'une première visite, et
 * celui qui doit ne rien charger.
 */
vi.mock('next/headers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/headers')>()),
  cookies: () => Promise.resolve({ get: () => undefined }),
}))

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/',
  useRouter: () => ({
    refresh: () => {},
    push: () => {},
    replace: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  }),
}))

/**
 * Le consentement, tel que l'application le monte.
 *
 * Ce fichier tient ce qui **traverse les packages** : le contrat du module, sa
 * route, son point de composition, et les deux points d'accès de la story
 * (finding F57). Les règles pures — quelle catégorie autorise quel script, ce
 * que vaut un cookie illisible, ce qu'une origine étrangère obtient — sont
 * éprouvées **à côté d'elles**, dans
 * `packages/modules/consent/src/domain/consent.test.ts`.
 */

describe('le module `consent` au contrat', () => {
  it('est monté par le registre de l’application', () => {
    // Dérivé de la configuration, jamais recopié : l'assertion reste vraie
    // quelle que soit la liste de `config/features.ts`.
    expect(enabledModules).toContain(consentModule.id)
    expect(moduleRegistry.moduleIds).toContain(consentModule.id)
  })

  it('ne persiste rien : ni table, ni migration, ni catégorie de données', () => {
    // Le consentement d'un visiteur **anonyme** vit sur son appareil (ADR 035).
    // L'enregistrer côté serveur demanderait de lui attribuer un identifiant
    // persistant, c'est-à-dire de le pister pour noter son refus d'être pisté.
    expect(consentModule.schema).toEqual({})
    expect(consentModule.migrations).toBeNull()
    expect(consentModule.dataCategories).toEqual([])
    expect(consentModule.retention).toEqual({})
  })

  it('n’exige aucun autre module : le socle ne dépend pas d’une option', () => {
    // s36 est socle et `marketing` est optionnel : déclarer un requis ici
    // rendrait le consentement indisponible sur une installation qui coupe le
    // site public — exactement la non-conformité que F57 a relevée.
    expect(consentModule.requires).toEqual([])
  })

  it('se construit sans son requérant, et son requérant ne se construit pas sans lui', () => {
    // Le couplage va du **dépendant vers le socle** : s39 déclarera
    // `requires: ['consent']`. Vérifié sur un module fictif plutôt que sur s39,
    // qui n'existe pas : ce qui se prouve ici est la direction de l'arête.
    expect(() =>
      buildRegistry({
        available: [...availableModules],
        enabled: [consentModule.id],
        required: [],
        locales: [...appLocales],
      }),
    ).not.toThrow()

    expect(requiredModules).not.toContain(consentModule.id)
  })
})

/* ------------------------------------------------------------------------- *
 * La route — le seul point d'entrée qui écrit le choix.
 * ------------------------------------------------------------------------- */

const DEMO_SCRIPTS: readonly NonEssentialScript[] = FIXTURE_CONSENT_SCRIPTS

const ORIGIN = 'http://localhost'
const DECIDE_URL = `${ORIGIN}${consentRoutePath('decide')}`

const submit = async (
  fields: Record<string, string | readonly string[]>,
  headers: Record<string, string> = {},
): Promise<Response> => {
  const body = new URLSearchParams()

  for (const [name, value] of Object.entries(fields)) {
    for (const entry of typeof value === 'string' ? [value] : value) {
      body.append(name, entry)
    }
  }

  return await dispatchAllowingRateLimit(
    moduleRegistry,
    new Request(DECIDE_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: ORIGIN,
        referer: `${ORIGIN}/fr/cookies`,
        ...headers,
      },
      body,
    }),
  )
}

describe('la route de décision', () => {
  beforeEach(() => {
    configureConsent({ scripts: DEMO_SCRIPTS })
  })

  afterEach(() => {
    resetConsentService()
  })

  it('enregistre le choix dans un cookie et renvoie sur la page d’origine', async () => {
    const response = await submit({ decision: 'save', category: ['analytics'] })

    // 303 et non 302 : c'est le seul code qui garantisse que le navigateur
    // suive en `GET`, donc que recharger la page d'arrivée ne repose rien.
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/fr/cookies')
    expect(response.headers.get('set-cookie')).toContain(`${CONSENT_COOKIE}=`)
    expect(response.headers.get('set-cookie')).toContain('analytics=1')
    // La case décochée est un **refus enregistré**, pas une absence : sans cela
    // la bannière reviendrait à chaque page.
    expect(response.headers.get('set-cookie')).toContain('advertising=0')
  })

  it('refuse une soumission venue d’un autre site, sans poser de cookie', async () => {
    // Un consentement forgé est pire qu'un refus perdu : la garde passe avant
    // toute lecture du corps, et rien ne part.
    const response = await submit(
      { decision: 'accept-all' },
      { origin: 'https://evil.test', referer: 'https://evil.test/piege' },
    )

    expect(response.status).toBe(403)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('refuse une intention inconnue sans rien dire de plus', async () => {
    const response = await submit({ decision: 'peut-etre' })

    expect(response.status).toBe(400)
    expect(response.headers.get('set-cookie')).toBeNull()
    // `docs/security.md` §7 : une réponse d'erreur publique ne renseigne pas
    // sur ce que le produit déclare.
    await expect(response.json()).resolves.toEqual({ error: 'invalid_request' })
  })

  it('n’est montée nulle part quand le module n’est pas activé', async () => {
    const withoutConsent = buildRegistry({
      available: [...availableModules],
      enabled: enabledModules.filter((id) => id !== consentModule.id),
      required: [...requiredModules],
      locales: [...appLocales],
    })

    const response = await dispatchAllowingRateLimit(
      withoutConsent,
      new Request(DECIDE_URL, { method: 'POST' }),
    )

    expect(response.status).toBe(404)
  })
})

/* ------------------------------------------------------------------------- *
 * Le registre des scripts non essentiels, et sa sonde.
 * ------------------------------------------------------------------------- */

const envWith = (probe: string | undefined): Env =>
  ({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x/y', CONSENT_SCRIPT_PROBE: probe }) as Env

/**
 * L'environnement du processus, le temps d'une lecture.
 *
 * `getEnv()` valide tout le contrat, `DATABASE_URL` compris : les cas qui
 * traversent le point de composition le posent, comme le fait déjà
 * `tests/i18n.test.ts` pour la sonde de traduction manquante.
 */
const withProcessEnv = async <T>(
  overrides: Record<string, string | undefined>,
  run: () => Promise<T> | T,
): Promise<T> => {
  const before = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]))

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    return await run()
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

describe('le registre des scripts non essentiels', () => {
  it('est vide dans l’état livré : rien de tiers n’est déclaré par défaut', async () => {
    // Critère 7 de la story. C'est le drapeau qui déclare, jamais un repli — et
    // il n'est posé que par `playwright.config.ts`.
    expect(resolveNonEssentialScripts(envWith(undefined))).toEqual([])

    await withProcessEnv(
      {
        DATABASE_URL:
          process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/app',
        CONSENT_SCRIPT_PROBE: undefined,
      },
      () => {
        expect(consent.scripts).toEqual([])
        expect(consent.categories).toEqual([])
      },
    )
  })

  it('déclare une catégorie distincte par script quand la sonde est posée', () => {
    // Deux et non un : « le consentement **de sa catégorie** » ne se distingue
    // d'un tout-ou-rien qu'à partir de deux.
    const scripts = resolveNonEssentialScripts(envWith('1'))

    expect(scripts.map((script) => script.category)).toEqual(['analytics', 'advertising'])
  })

  it('ne prend pas une variable déclarée vide pour un drapeau posé', () => {
    // `.env.example` livre `CONSENT_SCRIPT_PROBE=`, et `getEnv` rend la source
    // telle quelle en phase de build : sans cette normalisation, un clone
    // afficherait une bannière que personne n'a demandée.
    expect(resolveNonEssentialScripts(envWith('  '))).toEqual([])
  })
})

describe('la sonde de script', () => {
  const request = (id: string): Promise<Response> =>
    probeRoute(new Request(`http://localhost/api/consent-probe/${id}`), {
      params: Promise.resolve({ script: id }),
    })

  it('n’expose rien sans le drapeau, dans l’état livré du dépôt', async () => {
    const response = await withProcessEnv(
      {
        DATABASE_URL:
          process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/app',
        CONSENT_SCRIPT_PROBE: undefined,
      },
      () => request('demo-analytics'),
    )

    expect(response.status).toBe(404)
  })

  it('ne sert que les identifiants qu’elle déclare', () => {
    expect(probeScriptOf('demo-analytics')?.category).toBe('analytics')
    expect(probeScriptOf('../../etc/passwd')).toBeNull()
    expect(probeScriptOf('posthog')).toBeNull()
  })
})

/* ------------------------------------------------------------------------- *
 * Les **deux** points d'accès (finding F57), et la raison d'être de la story.
 *
 * Les attentes sont **dérivées** de l'état du module `marketing` : le fichier
 * passe donc dans les deux configurations, et c'est en le rejouant après
 * `pnpm ks toggle marketing` que la garantie est réellement mesurée dans les
 * deux — un seul état ne prouverait rien de ce que F57 reproche.
 * ------------------------------------------------------------------------- */

/** L'URL publique de l'écran de préférences, **dérivée** de la forme des URL du projet. */
const screenPath = localeRouting.publicPath(CONSENT_SCREEN_PATH, defaultLocale)

const renderScreen = async (screen: () => Promise<unknown>): Promise<string> => {
  const { NextIntlClientProvider } = await import('next-intl')
  const { createElement } = await import('react')
  const { pseudoRequestConfig } = await import('./fixtures/pseudo-locale')
  const { defaultLocale } = await import('../config/i18n')

  const config = pseudoRequestConfig(defaultLocale)

  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale: defaultLocale,
      messages: config.messages,
      timeZone: 'UTC',
      onError: config.onError,
      getMessageFallback: config.getMessageFallback,
      children: (await screen()) as never,
    }),
  )
}

describe('la gestion du consentement est atteignable', () => {
  it('depuis les paramètres de compte, quel que soit l’état du site public', async () => {
    // C'est **le** point d'accès qui ne dépend d'aucun module optionnel. Sur une
    // installation « marketing coupé, analytique activée » — légale au regard de
    // s10 et de s39 —, il est le seul moyen de retirer son consentement.
    viewerState.value = SIGNED_IN

    const html = await renderScreen(
      async () => (await import('../apps/web/app/account/page')).default(),
    )

    expect(html).toContain(`href="${screenPath}"`)
  })

  it('depuis le pied de page du site public, quand ce module est activé', async () => {
    const { marketingSite } = await import('../apps/web/lib/marketing')

    viewerState.value = ANONYMOUS

    if (marketingSite.sections.length === 0) {
      // Site public coupé : la racine redirige, il n'y a pas de pied de page —
      // et c'est exactement la configuration où la carte de compte ci-dessus
      // devient le seul point d'accès.
      await expect(
        renderScreen(async () => (await import('../apps/web/app/page')).default()),
      ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })

      return
    }

    const html = await renderScreen(
      async () => (await import('../apps/web/app/page')).default(),
    )

    expect(html).toContain(`href="${screenPath}"`)
  })

  it('mène à un écran servi à un visiteur anonyme, et non à une page qui répond 404', async () => {
    // L'écran est **public** : un visiteur anonyme a le même droit qu'un compte
    // à retirer son consentement (ADR 035). Il est rendu ici sans session.
    viewerState.value = ANONYMOUS

    const html = await renderScreen(
      async () => (await import('../apps/web/app/cookies/page')).default(),
    )

    expect(html).toContain('<h1')
    // Aucun script non essentiel n'est déclaré dans l'état livré : l'écran le
    // **dit** au lieu de proposer un réglage qui ne réglerait rien, et il
    // n'offre aucun formulaire — critère 7 de la story, vu depuis l'écran.
    expect(html).not.toContain('<form')
  })
})

/* ------------------------------------------------------------------------- *
 * Le catalogue : les clés **composées** que le balayage statique ne voit pas.
 * ------------------------------------------------------------------------- */

describe('le catalogue du module', () => {
  it('livre chaque clé que le code compose, dans toutes les locales du projet', () => {
    // Le titre d'une catégorie et le libellé d'un statut sont construits par
    // une fonction : `tests/i18n.test.ts` ne les voit pas. Une catégorie
    // ajoutée sans traduction ferait tomber l'écran en 500 (aucune clé absente
    // ne se replie depuis s09), et aucune commande ne le dirait avant.
    const required = consentMessageKeys(CONSENT_CATEGORIES, CONSENT_STATUSES)

    expect(required.length).toBeGreaterThan(10)

    for (const locale of appLocales) {
      const catalogue = consentModule.messages[locale] ?? {}

      for (const key of required) {
        expect(catalogue[key.replace(`${consentModule.id}.`, '')], `${locale} → ${key}`).toBeDefined()
      }
    }
  })
})
