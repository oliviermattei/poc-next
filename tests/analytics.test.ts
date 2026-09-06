import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

import { afterEach, describe, expect, it, vi } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * **s39 — le monitoring et l'analytique.**
 *
 * Un seul fichier pour toute la story, et c'est un choix de coût : le temps
 * d'une suite est dominé par le **par-fichier** (environnement, chargement des
 * modules), pas par le nombre de cas. Les cas propres aux deux adaptateurs
 * vivent chez eux, à côté du code qu'ils couvrent ; ce qui traverse les
 * packages — le point de composition, le registre de consentement, le balayage
 * de la surface unique, les cartes source — vit ici.
 */

/** Une doublure de **réseau**, jamais de SDK : c'est la frontière que le dépôt double. */
const recordingFetch = (
  respond: (request: Request) => Response = () => Response.json({ status: 1 }),
) => {
  const requests: Request[] = []
  // Le navigateur résout une adresse relative contre la page ; hors navigateur,
  // `new Request('/chemin')` lève. La doublure résout donc contre une origine —
  // sans quoi elle mesurerait sa propre limitation, pas le code appelé.
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    const request = new Request(new URL(url, 'https://app.test'), init)
    requests.push(request)

    return respond(request)
  }) as unknown as typeof fetch

  return { requests, fetch: impl }
}

describe('sans clé configurée : l’application tourne, et rien ne part (critère 5)', () => {
  it('ne construit aucune configuration d’analytique quand la clé manque', async () => {
    const { resolveAnalyticsConfig } = await import('../apps/web/lib/analytics-config')

    expect(resolveAnalyticsConfig({} as never)).toBeNull()
    expect(resolveAnalyticsConfig({ POSTHOG_KEY: '' } as never)).toBeNull()
  })

  it('n’émet **aucun appel réseau**, et le dit en valeur plutôt qu’en silence', async () => {
    const { createAnalytics } = await import('../apps/web/lib/analytics-config')
    const network = recordingFetch()

    const analytics = createAnalytics(null, { fetch: network.fetch })
    const tracked = await analytics.track({
      name: 'auth.signed_up',
      distinctId: 'visitor-1',
      properties: {},
    })
    const viewed = await analytics.page({
      path: '/pricing',
      distinctId: 'visitor-1',
      properties: {},
    })

    // C'est **la mesure du critère 5** : elle porte sur les appels sortants, et
    // non sur l'absence d'erreur. Une application qui tourne en émettant
    // discrètement est exactement le défaut visé.
    expect(network.requests).toEqual([])
    expect(tracked.ok).toBe(false)
    expect(viewed.ok).toBe(false)
    expect(tracked.ok ? null : tracked.error.code).toBe('not_configured')
  })

  it('mesure vraiment quelque chose : la même doublure reçoit l’appel dès qu’une clé existe', async () => {
    // **Le plancher.** Sans ce cas, l'assertion « zéro appel » ci-dessus resterait
    // verte sur une doublure jamais câblée — elle mesurerait le test, pas le code.
    const { createAnalytics } = await import('../apps/web/lib/analytics-config')
    const network = recordingFetch()

    const analytics = createAnalytics(
      { key: 'phc_test', host: 'https://analytics.test' },
      { fetch: network.fetch },
    )
    const result = await analytics.track({
      name: 'auth.signed_up',
      distinctId: 'visitor-1',
      properties: {},
    })

    expect(result.ok).toBe(true)
    expect(network.requests).toHaveLength(1)
    expect(network.requests[0]?.url).toBe('https://analytics.test/i/v0/e/')
  })
})

describe('le script d’analyse, déclaré non essentiel au registre de s36 (critère 6)', () => {
  const configured = { POSTHOG_KEY: 'phc_test', POSTHOG_HOST: 'https://analytics.test' } as never

  it('n’est déclaré que lorsque le module est activé **et** qu’une clé existe', async () => {
    const { resolveNonEssentialScripts } = await import('../apps/web/lib/consent')
    const { ANALYTICS_SCRIPT_PATH } = await import('@repo/module-analytics')

    // Module activé, aucune clé : rien à déclarer, donc rien à consentir.
    expect(resolveNonEssentialScripts({} as never, ['consent', 'analytics'])).toEqual([])
    // Clé posée, module coupé : la déclaration disparaît avec le module (critère 8).
    expect(resolveNonEssentialScripts(configured, ['consent'])).toEqual([])

    const declared = resolveNonEssentialScripts(configured, ['consent', 'analytics'])

    expect(declared).toHaveLength(1)
    expect(declared[0]).toMatchObject({ category: 'analytics' })
    // **Notre** origine, jamais celle du fournisseur : c'est ce script-ci qui
    // porte la clé de projet, donc la mesure. Déclarer le chargeur du
    // fournisseur — ce que faisait la première écriture — chargeait un tiers qui
    // n'initialisait rien (constat 6 de la revue).
    expect(declared[0]?.src).toBe(ANALYTICS_SCRIPT_PATH)
  })

  it('n’est chargé qu’après un accord explicite — ni avant, ni sur une absence de décision', async () => {
    const { resolveNonEssentialScripts } = await import('../apps/web/lib/consent')
    const { resolveConsentState } = await import('@repo/module-consent')

    const scripts = resolveNonEssentialScripts(configured, ['consent', 'analytics'])

    // Le critère dit « aucun **chargement** ni événement » : c'est la balise qui
    // est refusée, pas seulement l'envoi. Un script chargé puis muselé aurait
    // déjà porté l'adresse IP du visiteur chez le tiers.
    expect(resolveConsentState(scripts, {}).allowedScripts).toEqual([])
    expect(resolveConsentState(scripts, {}).bannerRequired).toBe(true)
    expect(resolveConsentState(scripts, { analytics: false }).allowedScripts).toEqual([])
    expect(resolveConsentState(scripts, { analytics: true }).allowedScripts).toEqual(scripts)
  })
})

describe('les erreurs non gérées atteignent le fournisseur (critère 1)', () => {
  it('remonte une erreur **client** par la route du module, sans jamais lever', async () => {
    const { reportClientError, CLIENT_ERROR_ENDPOINT } = await import(
      '../apps/web/lib/report-client-error'
    )
    const { CLIENT_ERROR_PATH } = await import('@repo/module-analytics')
    const network = recordingFetch(() => new Response(null, { status: 204 }))

    // Le chemin est **dérivé** du module, jamais recopié : deux écritures
    // divergeraient, et le navigateur posterait vers une route qui n'existe pas.
    expect(CLIENT_ERROR_ENDPOINT).toBe(CLIENT_ERROR_PATH)

    const error = new TypeError('cannot read properties of undefined')
    error.stack = 'TypeError: boom\n    at renderInvoice (/app/chunk.js:1:2)'

    await reportClientError(error, { path: '/pricing', fetch: network.fetch })

    expect(network.requests).toHaveLength(1)

    const body = (await (network.requests[0] as Request).clone().json()) as Record<string, unknown>

    expect(network.requests[0]?.url).toContain(CLIENT_ERROR_PATH)
    expect(body).toMatchObject({
      type: 'TypeError',
      message: 'cannot read properties of undefined',
      path: '/pricing',
    })
  })

  it('ne double jamais la panne : un signalement qui échoue ne lève pas', async () => {
    const { reportClientError } = await import('../apps/web/lib/report-client-error')
    const failing = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch

    // Lever ici remplacerait l'erreur affichée au visiteur par la nôtre, dans
    // l'écran qui existe précisément pour ne plus rien casser.
    await expect(
      reportClientError(new Error('boum'), { path: '/pricing', fetch: failing }),
    ).resolves.toBeUndefined()
  })

  it('la route du module filtre et remonte, et répond 204 quoi qu’il arrive', async () => {
    const { createAnalyticsRoutes, CLIENT_ERROR_PATH } = await import('@repo/module-analytics')
    const { createMonitoring } = await import('../apps/web/lib/analytics-config')
    const network = recordingFetch(() => Response.json({ id: 'evt_1' }))

    const monitoring = createMonitoring(
      { dsn: 'https://public_key_abc@errors.test/42', release: null },
      { fetch: network.fetch },
    )
    const [route] = createAnalyticsRoutes(() => monitoring)
    const response = await (
      route as unknown as { handler: (request: Request) => Promise<Response> }
    ).handler(
      new Request(`https://app.test${CLIENT_ERROR_PATH}`, {
        method: 'POST',
        body: JSON.stringify({
          message: 'boum avec Bearer eyJhbGciOiJIUzI1NiJ9.charge.signature',
          type: 'TypeError',
          stack: 'TypeError: boum\n    at handler (/app/chunk.js:1:2)',
          path: '/pricing',
        }),
      }),
    )

    expect(response.status).toBe(204)
    expect(network.requests).toHaveLength(1)

    const raw = await (network.requests[0] as Request).clone().text()

    expect(raw, 'le jeton porteur a fui').not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(raw).toContain('"origin":"client"')
  })
})

/**
 * **Les deux points de capture du critère 1, gardés à leur propre site**
 * (constats 1 de la revue).
 *
 * Les fonctions feuilles étaient testées — `reportClientError` poste,
 * `createSentryMonitoring` émet — et **rien ne prouvait qu'une erreur non
 * rattrapée les atteigne** : vider `onRequestError` et supprimer
 * `<ClientErrorReporter error={error} />` laissait **2 605 cas verts**. C'est la
 * classe de défaut que la revue de s33 avait déjà nommée : une garde que
 * personne ne peut supprimer-tester.
 *
 * La règle est prouvée **une fois chez elle** (les cas ci-dessus) ; ici, chaque
 * point de composition reçoit un **témoin unique** — la preuve qu'il appelle la
 * règle, jamais une seconde énumération.
 */
describe('les points de composition sont réellement câblés (critère 1)', () => {
  /**
   * **Le nettoyage vit ici, et pas à la fin d'un cas.** Mesuré pendant la ronde
   * de correctifs : le cas ci-dessous remplace `lib/analytics` ; quand une
   * mutation le fait **échouer**, sa dernière ligne n'est jamais atteinte, la
   * doublure fuit dans le cas suivant, et celui-ci rougit pour une raison qui
   * n'est pas la sienne. Un compte de rouges gonflé par une fuite est un compte
   * faux.
   */
  afterEach(() => {
    vi.doUnmock('../apps/web/lib/analytics')
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('le crochet serveur de Next remet l’erreur au port de monitoring', async () => {
    const captured: { message: string; origin: string; context: Record<string, string> }[] = []

    vi.resetModules()
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.doMock('../apps/web/lib/analytics', () => ({
      appMonitoring: () => ({
        capture: async (event: {
          message: string
          origin: string
          context: Record<string, string>
        }) => {
          captured.push(event)

          return { ok: true as const, id: 'evt_1' }
        },
      }),
    }))

    const { onRequestError } = await import('../apps/web/instrumentation')

    await onRequestError(new TypeError('boum'), { path: '/factures/42' })

    // Sans cette ligne dans `instrumentation.ts`, une erreur serveur n'atteint
    // **jamais** le fournisseur — et rien d'autre dans la suite ne s'en aperçoit.
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      message: 'boum',
      origin: 'server',
      context: { path: '/factures/42' },
    })
  })

  it('l’écran de dernier recours confie l’erreur au signaleur du navigateur', async () => {
    // L'effet ne peut pas être observé ici — la suite rend en statique, où
    // `useEffect` ne s'exécute pas. Ce qui est mesuré est donc **le câblage** :
    // l'écran monte le composant, et lui passe **l'erreur**. Ce que ce composant
    // fait ensuite est prouvé chez lui (« remonte une erreur client par la route
    // du module »), et ne se ré-énumère pas ici.
    const { default: GlobalError } = await import('../apps/web/app/global-error')
    const { ClientErrorReporter } = await import('../apps/web/app/client-error-reporter')

    const error = new TypeError('boum')
    const tree = GlobalError({ error, retry: () => undefined })
    const reporters: { readonly error?: unknown }[] = []

    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const child of node) {
          walk(child)
        }

        return
      }

      if (typeof node !== 'object' || node === null || !('type' in node)) {
        return
      }

      const element = node as { type: unknown; props: Record<string, unknown> }

      if (element.type === ClientErrorReporter) {
        reporters.push(element.props as { readonly error?: unknown })
      }

      walk(element.props.children)
    }

    walk(tree)

    expect(reporters).toHaveLength(1)
    expect(reporters[0]?.error).toBe(error)
  })

  /**
   * **`prepareAnalytics()` de `lib/module-services.ts`** (constat 2 de la revue).
   *
   * Le commentaire de la ligne annonçait qu'en son absence la route répond
   * **500** ; retirer la ligne laissait pourtant **0 rouge**. Le mode de
   * défaillance est donc mesuré là où il se produit — sur la **réponse**, et non
   * sur un `require*` qui refuse : le répartiteur monte les routes, il ne
   * construit rien.
   */
  it('donne au module ce qu’aucune requête ne procure : la route répond, elle ne casse pas', async () => {
    vi.resetModules()
    // **Déclarées ici, pas héritées d'un `.env` de poste** : ce cas construit
    // réellement le port, donc il lit l'environnement (`pnpm test:sans-env`).
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')

    const { prepareModuleServices } = await import('../apps/web/lib/module-services')
    const analytics = await import('@repo/module-analytics')
    const { buildRegistry } = await import('@repo/core')
    const { availableModules, enabledModules, requiredModules } = await import(
      '../config/features'
    )
    const { appLocales } = await import('../config/i18n')
    const { dispatchAllowingRateLimit } = await import('./fixtures/rate-limit')

    analytics.resetAnalyticsService()

    // Contrôle positif : sans le câblage, la garde refuse en le disant. Sans
    // cette moitié, ce cas mesurerait un `require*` qui ne refuse jamais rien.
    expect(() => analytics.requireMonitoring()).toThrow(analytics.AnalyticsNotConfiguredError)

    prepareModuleServices()

    // **La configuration ambiante, jamais une forcée.** `config/profiles.ts`
    // coupe ce module et `pnpm test:minimal-profile` rejoue ce fichier dans
    // cette configuration-là : forcer le module dans le registre y monterait une
    // route que le point de composition n'a — légitimement — pas câblée. Une
    // garde qui ne mord que dans une configuration est une garde que la CI peut
    // ne jamais jouer, et c'est la moitié que ce cas doit dire honnêtement.
    const mounted = (enabledModules as readonly string[]).includes('analytics')
    const registry = buildRegistry({
      available: [...availableModules],
      enabled: [...enabledModules],
      required: [...requiredModules],
      locales: [...appLocales],
    })
    const response = await dispatchAllowingRateLimit(
      registry,
      new Request(`https://app.test${analytics.CLIENT_ERROR_PATH}`, {
        method: 'POST',
        body: JSON.stringify({ message: 'boum', type: 'TypeError' }),
      }),
    )

    // Module activé : **204**, donc le câblage a eu lieu — sans lui, le
    // répartiteur rend l'erreur du module. Module coupé : la route n'existe pas,
    // et il n'y avait rien à câbler (critère 8, mesuré à côté).
    expect(response.status).toBe(mounted ? 204 : 404)

    analytics.resetAnalyticsService()
  })
})

describe('`Analytics` est la seule surface appelée par le code métier (critère 3)', () => {
  const ROOTS = ['apps', 'packages', 'config'] as const
  const SKIPPED = new Set(['node_modules', '.next', '.turbo', 'dist', 'migrations'])

  /** Les fichiers de code du dépôt, **dérivés du disque** et jamais recopiés. */
  const sourceFiles = (): readonly string[] => {
    const found: string[] = []

    const walk = (relative: string): void => {
      for (const entry of readdirSync(join(REPO_ROOT, relative), { withFileTypes: true })) {
        if (SKIPPED.has(entry.name)) {
          continue
        }

        const child = `${relative}/${entry.name}`

        if (entry.isDirectory()) {
          walk(child)
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          found.push(child)
        }
      }
    }

    for (const root of ROOTS) {
      walk(root)
    }

    return found
  }

  /**
   * **Les seuls packages autorisés à connaître un fournisseur**, et le seul
   * fichier autorisé à les connaître.
   *
   * Le reste du dépôt ne voit que `@repo/ports`. Un contournement — un `fetch`
   * vers le fournisseur dans un composant, un SDK importé dans un cas d'usage —
   * fait rougir `pnpm test` plutôt que d'attendre une relecture.
   *
   * **Les deux adaptateurs, et pas un seul** (constat 5 de la revue) :
   * `apps/web/AGENTS.md` annonçait un balayage couvrant `@repo/adapter-posthog`
   * **et** `@repo/adapter-sentry`, quand le balayage ne connaissait que le
   * premier — un second importeur de `sentry` passait. La liste ci-dessous est
   * la phrase de la règle, et son plancher refuse qu'elle se vide.
   */
  const ADAPTERS = [
    { package: 'packages/adapters/posthog', import: '@repo/adapter-posthog' },
    { package: 'packages/adapters/sentry', import: '@repo/adapter-sentry' },
  ] as const

  const COMPOSITION_POINT = 'apps/web/lib/analytics-config.ts'

  /** Un fichier appartient-il à l'un des adaptateurs ? Alors il a le droit de savoir. */
  const insideAnAdapter = (file: string): boolean =>
    ADAPTERS.some((adapter) => file.startsWith(adapter.package))

  it('n’autorise l’import d’un adaptateur d’observabilité qu’au point de composition', () => {
    const files = sourceFiles()

    // Le plancher : un balayage sur zéro fichier serait vert sans rien vérifier
    // (constat de s32). Il monte tout seul avec le dépôt.
    expect(files.length).toBeGreaterThan(200)
    // Et le second plancher : une liste vide rendrait la boucle vraie sur rien.
    expect(ADAPTERS.length).toBe(2)

    for (const adapter of ADAPTERS) {
      const importers = files.filter(
        (file) =>
          !file.startsWith(adapter.package) &&
          new RegExp(`from '${adapter.import}'`).test(readFileSync(join(REPO_ROOT, file), 'utf8')),
      )

      // Le nom du fournisseur **en prose** n'est pas visé : ce dépôt explique ses
      // choix là où il les prend, et interdire le mot rendrait ce cas rouge à
      // chaque commentaire honnête. Ce qui est visé est le **graphe d'import**.
      expect(importers, adapter.import).toEqual([COMPOSITION_POINT])
    }
  })

  it('ne laisse aucune adresse ni clé du fournisseur hors de l’adaptateur', () => {
    // L'autre moitié du contournement : pas d'import, mais un `fetch` écrit à la
    // main vers l'hôte du fournisseur. C'est le geste naturel de qui « fait
    // marcher » une mesure, et c'est celui que le port existe pour empêcher.
    const leaks = sourceFiles().filter((file) => {
      if (insideAnAdapter(file) || file === 'packages/config/src/env.ts') {
        return false
      }

      return /posthog\.com|phc_[A-Za-z0-9]/.test(readFileSync(join(REPO_ROOT, file), 'utf8'))
    })

    expect(leaks).toEqual([])
  })

  it('**le plancher** : au moins un appelant métier passe réellement par le port', () => {
    // C'est la moitié que s32 a manquée : une interdiction balayée sur zéro
    // appelant est verte et ne prouve rien. Si plus personne ne mesure, ce cas
    // rougit — et l'interdiction ci-dessus redevient une phrase.
    const callers = sourceFiles().filter((file) => {
      if (insideAnAdapter(file) || file.startsWith('apps/web/lib/analytics')) {
        return false
      }

      const source = readFileSync(join(REPO_ROOT, file), 'utf8')

      return source.includes('analytics.track(') || source.includes('analytics.page(')
    })

    expect(callers.length).toBeGreaterThanOrEqual(1)
    // Et l'appelant ne connaît que le port : aucun ne nomme le fournisseur.
    for (const caller of callers) {
      expect(readFileSync(join(REPO_ROOT, caller), 'utf8')).not.toMatch(/posthog/i)
    }
  })
})

/**
 * **Le classement transitoire / définitif, confronté à sa déclaration**
 * (constat 4 de la revue).
 *
 * Quatre commentaires — `packages/ports/src/analytics.ts`,
 * `packages/ports/src/monitoring.ts`, `posthog-analytics.ts`,
 * `sentry-monitoring.ts` — affirmaient que ce fichier confrontait
 * `isTransient*Error` à `ANALYTICS_ERROR_CODES` / `MONITORING_ERROR_CODES`. **Ce
 * test n'existait pas** : reclasser `unauthorized` et `not_configured` en
 * transitoires laissait la suite verte, c'est-à-dire une reprise sur une erreur
 * que `docs/reliability.md` §3 interdit de rejouer.
 *
 * Le motif est celui de `tests/jobs.test.ts` — avec une différence : il n'y a
 * **qu'un** classement par port, pas deux à faire s'accorder. Ce qui joue le
 * rôle du second est l'**annotation écrite à côté de chaque code**, celle que
 * lit l'humain qui ajoute un code. Elle est extraite de la source plutôt que
 * recopiée : un code ajouté demain entre dans la confrontation sans que personne
 * y pense, et un code ajouté **sans annotation** rougit au lieu de passer.
 */
describe('le classement transitoire / définitif des deux ports', () => {
  /** L'annotation de chaque code, lue dans le commentaire qui la porte. */
  const annotated = (
    file: string,
    codes: readonly string[],
  ): readonly { readonly code: string; readonly transient: boolean }[] => {
    const source = readFileSync(join(REPO_ROOT, file), 'utf8')

    return codes.map((code) => {
      const at = source.indexOf(`  '${code}',`)

      expect(at, `${code} n’est pas déclaré littéralement dans ${file}`).toBeGreaterThan(0)

      const block = source.slice(source.lastIndexOf('/**', at), at)
      const transient = /transitoire/i.test(block)
      const definitive = /définitif/i.test(block)

      // Un code sans annotation, ou annoté des deux côtés, n'a pas de
      // classement déclaré : il ne peut être confronté à rien.
      expect([transient, definitive], `annotation de ${code} dans ${file}`).toEqual(
        transient ? [true, false] : [false, true],
      )

      return { code, transient }
    })
  }

  it('dit la même chose que l’annotation de chaque code, sur les deux ports', async () => {
    const { ANALYTICS_ERROR_CODES, MONITORING_ERROR_CODES } = await import('@repo/ports')
    const { isTransientAnalyticsError } = await import('@repo/adapter-posthog')
    const { isTransientMonitoringError } = await import('@repo/adapter-sentry')

    const ports = [
      {
        file: 'packages/ports/src/analytics.ts',
        codes: ANALYTICS_ERROR_CODES as readonly string[],
        isTransient: isTransientAnalyticsError as (code: string) => boolean,
      },
      {
        file: 'packages/ports/src/monitoring.ts',
        codes: MONITORING_ERROR_CODES as readonly string[],
        isTransient: isTransientMonitoringError as (code: string) => boolean,
      },
    ]

    for (const port of ports) {
      // Un balayage vide passerait pour une raison qui n'en est pas une (s26).
      expect(port.codes.length, port.file).toBeGreaterThanOrEqual(6)

      const divergent = annotated(port.file, port.codes).filter(
        (entry) => port.isTransient(entry.code) !== entry.transient,
      )

      expect(divergent, port.file).toEqual([])
    }
  })

  it('classe au moins un code de chaque côté, sur les deux ports', async () => {
    // Sans cette moitié, un classement qui rendrait toujours `false` serait
    // « d'accord » avec des annotations toutes définitives, et ce fichier ne
    // mesurerait rien.
    const { ANALYTICS_ERROR_CODES, MONITORING_ERROR_CODES } = await import('@repo/ports')
    const { isTransientAnalyticsError } = await import('@repo/adapter-posthog')
    const { isTransientMonitoringError } = await import('@repo/adapter-sentry')

    for (const [codes, isTransient] of [
      [ANALYTICS_ERROR_CODES as readonly string[], isTransientAnalyticsError as (c: string) => boolean],
      [MONITORING_ERROR_CODES as readonly string[], isTransientMonitoringError as (c: string) => boolean],
    ] as const) {
      expect(codes.filter((code) => isTransient(code)).length).toBeGreaterThan(0)
      expect(codes.filter((code) => !isTransient(code)).length).toBeGreaterThan(0)
    }
  })
})

describe('les cartes source : envoyées, et jamais servies (critère 1)', () => {
  /**
   * **La section du guide qui porte la recette**, découpée sur ses titres.
   *
   * Lire le fichier entier ferait tomber la recherche sur le `--target` du guide
   * Coolify, qui parle d'autre chose : mesuré, ce cas passait alors sur l'étape
   * d'exécution.
   */
  const sourceMapSection = (): string => {
    const guide = readFileSync(join(REPO_ROOT, 'docs/deployment.md'), 'utf8')
    const start = guide.indexOf('## Les cartes source')

    expect(start, 'la section des cartes source a disparu du guide').toBeGreaterThan(0)

    const end = guide.indexOf('\n## ', start + 1)

    return guide.slice(start, end === -1 ? guide.length : end)
  }

  it('génère les cartes au build — sans quoi il n’y aurait rien à envoyer', async () => {
    const config = readFileSync(join(REPO_ROOT, 'apps/web/next.config.ts'), 'utf8')

    expect(config).toContain('productionBrowserSourceMaps: true')
  })

  it('refuse un envoi vide plutôt que de passer au vert', async () => {
    const { planRelease, EmptyReleaseError } = await import('../scripts/source-maps-rules')

    // C'est la leçon du régime `recorded` du parcours doré : une recette qui n'a
    // rien à jouer ne doit pas ressembler à une recette qui a tout joué.
    expect(() => planRelease('.next', [])).toThrow(EmptyReleaseError)
  })

  it('n’envoie que ce que le serveur exécute ou sert : ni outillage, ni doublon', async () => {
    // Constat mineur de la revue : `collectMaps` parcourt **tout** `.next` — 326
    // fichiers `.map` mesurés, dont 25 seulement sont des chunks navigateur. Le
    // reste est l'outillage du bundler (`.next/build`) et la recopie de la
    // sortie autonome (`.next/standalone`), qui enverraient chez le fournisseur
    // des cartes qu'aucune trace ne nomme.
    const { planRelease } = await import('../scripts/source-maps-rules')

    const plan = planRelease('.next', [
      'build/chunks/[turbopack]_runtime.js.map',
      'standalone/apps/web/.next/server/app/page.js.map',
      'static/chunks/482.js.map',
      'server/app/page.js.map',
    ])

    expect(plan.uploads.map((entry) => entry.path)).toEqual([
      'static/chunks/482.js.map',
      'server/app/page.js.map',
    ])
  })

  it('refuse un envoi dont il ne reste rien après filtrage', async () => {
    const { planRelease, EmptyReleaseError } = await import('../scripts/source-maps-rules')

    // Un build dont il ne resterait que l'outillage n'est pas un envoi : c'est
    // la même leçon que l'ensemble vide, et elle serait sinon invisible.
    expect(() => planRelease('.next', ['build/chunks/[turbopack]_runtime.js.map'])).toThrow(
      EmptyReleaseError,
    )
  })

  it('envoie tout, et n’élague que ce qui serait servi au visiteur', async () => {
    const { planRelease } = await import('../scripts/source-maps-rules')

    const plan = planRelease('.next', [
      'static/chunks/482.js.map',
      // Une carte CSS : jamais envoyée — elle n'apparaît dans aucune trace —,
      // mais **élaguée**, parce qu'une carte est du code source quel qu'en soit
      // le langage.
      'static/css/app.css.map',
      'server/app/page.js.map',
      // Un dossier serveur dont le nom **commence** par autre chose que le
      // segment public : une comparaison par sous-chaîne le compterait public.
      'server/static-pages/x.js.map',
    ])

    expect(plan.uploads.map((entry) => entry.path)).toEqual([
      'static/chunks/482.js.map',
      'server/app/page.js.map',
      'server/static-pages/x.js.map',
    ])
    expect(plan.uploads[0]?.artifact).toBe('~/_next/static/chunks/482.js.map')
    expect(plan.prunes.map((entry) => entry.path)).toEqual([
      'static/chunks/482.js.map',
      'static/css/app.css.map',
    ])
  })

  it('refuse l’envoi en nommant ce qui manque, plutôt que de le sauter', async () => {
    const { readReleaseCredentials, MissingReleaseCredentialsError } = await import(
      '../scripts/source-maps-rules'
    )

    expect(() => readReleaseCredentials({ SENTRY_ORG: 'acme' })).toThrow(
      MissingReleaseCredentialsError,
    )
    expect(() => readReleaseCredentials({ SENTRY_ORG: 'acme' })).toThrow(/SENTRY_AUTH_TOKEN/)
    expect(
      readReleaseCredentials({
        SENTRY_ORG: 'acme',
        SENTRY_PROJECT: 'web',
        SENTRY_AUTH_TOKEN: 'sntrys_x',
        SENTRY_RELEASE: 'app@1.2.3',
      }).release,
    ).toBe('app@1.2.3')
  })

  /**
   * **La recette documentée peut-elle fonctionner ?** (constat 7 de la revue.)
   *
   * Elle disait : `pnpm build` → `pnpm sourcemaps:release` → `docker build`.
   * Or `.dockerignore` **exclut** `.next` du contexte et l'image rejoue son
   * propre `pnpm build` : les empreintes des chunks servis ne sont pas celles
   * dont les cartes ont été publiées, et une trace navigateur reste non
   * symbolisée — sans que rien ne le dise.
   *
   * Ce que ce cas garde, et qui est la condition pour que la recette soit vraie :
   * les cartes sont extraites d'une étape qui **n'a pas élagué**, et cette étape
   * est un **ancêtre** de celle dont l'image sert les fichiers statiques. Même
   * build, mêmes couches, donc mêmes empreintes. Tout y est dérivé du
   * `Dockerfile` et de la recette écrite : recopier un nom d'étape ici
   * laisserait ce cas vert après un renommage.
   */
  it('extrait les cartes de l’étape qui a produit le bundle servi', async () => {
    const dockerfile = readFileSync(join(REPO_ROOT, 'Dockerfile'), 'utf8')
    const guide = sourceMapSection()

    /** Chaque étape, son parent et son corps — dérivés du fichier. */
    const stages = new Map<string, { readonly parent: string; readonly body: string }>()
    const headers = [...dockerfile.matchAll(/^FROM (\S+)(?: AS (\S+))?$/gm)]

    expect(headers.length, 'aucune étape lue dans le Dockerfile').toBeGreaterThan(2)

    headers.forEach((header, index) => {
      const next = headers[index + 1]
      const body = dockerfile.slice(
        (header.index ?? 0) + header[0].length,
        next?.index ?? dockerfile.length,
      )

      stages.set(header[2] ?? `#${String(index)}`, { parent: header[1] ?? '', body })
    })

    const ranPrune = (name: string): boolean => {
      const stage = stages.get(name)

      if (stage === undefined) {
        return false
      }

      return stage.body.includes('sourcemaps:prune') || ranPrune(stage.parent)
    }

    const isAncestor = (ancestor: string, name: string): boolean => {
      const stage = stages.get(name)

      return stage === undefined ? false : stage.parent === ancestor || isAncestor(ancestor, stage.parent)
    }

    // L'étape dont l'image sert les fichiers statiques : **elle a élagué**, sinon
    // l'image publierait le code source du produit.
    const servedFrom = /COPY --from=(\S+)[^\n]*\.next\/static/.exec(dockerfile)?.[1] ?? ''

    expect(servedFrom, 'aucune recopie de `.next/static` trouvée').not.toBe('')
    expect(ranPrune(servedFrom), `${servedFrom} n’a pas élagué`).toBe(true)

    // L'étape que la recette extrait : **elle n'a pas élagué** — il n'y aurait
    // sinon plus une seule carte navigateur à envoyer —, et elle est un ancêtre
    // de la précédente, donc le même build.
    const extractedFrom = /docker build --target (\S+)/.exec(guide)?.[1] ?? ''

    expect(extractedFrom, 'la recette de `docs/deployment.md` ne nomme aucune étape').not.toBe('')
    expect(stages.has(extractedFrom), `l’étape ${extractedFrom} n’existe pas`).toBe(true)
    expect(ranPrune(extractedFrom), `${extractedFrom} a déjà élagué`).toBe(false)
    expect(isAncestor(extractedFrom, servedFrom), `${extractedFrom} n’est pas un ancêtre`).toBe(true)
  })

  it('envoie les cartes du dossier que la recette lui désigne', async () => {
    const { resolveNextRoot } = await import('../scripts/source-maps-rules')
    const guide = sourceMapSection()

    // Les variables sont **lues dans la recette**, jamais recopiées ici : en
    // renommer une d'un côté sans l'autre rend ce cas rouge, au lieu d'envoyer
    // en silence les cartes du build de l'hôte — celles qui ne sont pas servies.
    const declared = [...new Set([...guide.matchAll(/\b([A-Z][A-Z0-9_]+)=/g)].map((m) => m[1] ?? ''))]

    expect(declared.length, 'la recette ne pose aucune variable').toBeGreaterThan(0)

    const honoured = declared.filter(
      (name) => resolveNextRoot({ [name]: '/extrait/.next' }, '/defaut') === '/extrait/.next',
    )

    // Exactement une : zéro voudrait dire que la recette ne désigne aucun
    // dossier — donc qu'elle envoie encore le build de l'hôte —, et deux que la
    // règle lit une variable de plus que ce qui est écrit.
    expect(honoured).toHaveLength(1)
    expect(resolveNextRoot({}, '/defaut')).toBe('/defaut')
    expect(resolveNextRoot({ [honoured[0] ?? '']: '  ' }, '/defaut')).toBe('/defaut')
  })

  it('l’image de production n’embarque aucune carte servie publiquement', async () => {
    // La moitié de sécurité, et elle se joue **dans le Dockerfile** : sans
    // élagage, `.next/static` part dans l'image avec ses `.map`, que le serveur
    // sert à qui les demande — c'est-à-dire le code source du produit.
    const dockerfile = readFileSync(join(REPO_ROOT, 'Dockerfile'), 'utf8')

    expect(dockerfile).toContain('sourcemaps:prune')
  })
})

describe('module « analytics » non activé : les trois garanties (critère 8)', () => {
  const configured = { POSTHOG_KEY: 'phc_test', POSTHOG_HOST: 'https://analytics.test' } as never
  const withoutAnalytics = ['consent', 'auth'] as const

  it('ne déclare aucun script, **même avec une clé configurée**', async () => {
    const { resolveNonEssentialScripts } = await import('../apps/web/lib/consent')

    expect(resolveNonEssentialScripts(configured, withoutAnalytics)).toEqual([])
  })

  it('ne remonte rien : ni analytique, ni erreur, et aucun appel réseau', async () => {
    const { createAnalytics, createMonitoring } = await import('../apps/web/lib/analytics-config')
    const network = recordingFetch()

    // Module coupé, le point de composition ne construit aucun adaptateur : ce
    // n'est pas une garde qu'on peut oublier de poser, c'est une absence.
    const analytics = createAnalytics(null, { fetch: network.fetch })
    const monitoring = createMonitoring(null, { fetch: network.fetch })

    await analytics.track({ name: 'auth.signed_up', distinctId: 'u', properties: {} })
    await monitoring.capture({
      message: 'boum',
      type: 'Error',
      stack: null,
      origin: 'server',
      release: null,
      context: {},
    })

    expect(network.requests).toEqual([])
  })

  it('**la bannière de consentement disparaît**, faute de script non essentiel', async () => {
    const { resolveNonEssentialScripts } = await import('../apps/web/lib/consent')
    const { resolveConsentState } = await import('@repo/module-consent')

    // C'est la garantie qui traverse deux modules, et elle n'est écrite nulle
    // part : elle est **dérivée**. `consent` reste activé, mais plus aucun
    // script ne déclare de catégorie — il n'y a donc plus rien à demander au
    // visiteur, et lui montrer une bannière proposerait de régler ce qui
    // n'existe pas.
    const cut = resolveConsentState(resolveNonEssentialScripts(configured, withoutAnalytics), {})

    expect(cut.declared).toEqual([])
    expect(cut.bannerRequired).toBe(false)

    // Le plancher de la comparaison : avec le module, la bannière est requise.
    // Sans ce second appel, l'assertion ci-dessus serait verte même si la
    // bannière ne s'affichait plus jamais, dans aucune configuration.
    const mounted = resolveConsentState(
      resolveNonEssentialScripts(configured, [...withoutAnalytics, 'analytics']),
      {},
    )

    expect(mounted.bannerRequired).toBe(true)
  })

  it('ne monte aucune route : le répartiteur répond 404', async () => {
    const { buildRegistry } = await import('@repo/core')
    const { CLIENT_ERROR_PATH } = await import('@repo/module-analytics')
    const { availableModules, enabledModules, requiredModules } = await import(
      '../config/features'
    )
    const { appLocales } = await import('../config/i18n')
    const { dispatchAllowingRateLimit } = await import('./fixtures/rate-limit')

    const request = () =>
      new Request(`https://app.test${CLIENT_ERROR_PATH}`, { method: 'POST', body: '{}' })

    const registryOf = (enabled: readonly string[]) =>
      buildRegistry({
        available: [...availableModules],
        enabled,
        required: [...requiredModules],
        locales: [...appLocales],
      })

    const cut = await dispatchAllowingRateLimit(
      registryOf(enabledModules.filter((id) => id !== 'analytics')),
      request(),
    )

    expect(cut.status).toBe(404)

    // **Le plancher** : la même requête doit atteindre la route quand le module
    // est activé. Sans ce second appel, un 404 dû à un chemin erroné passerait
    // pour la garantie du critère 8.
    //
    // Le module est **ajouté explicitement**, jamais supposé présent dans
    // `enabledModules` : `config/profiles.ts` le coupe, et
    // `pnpm test:minimal-profile` rejoue ce fichier dans cette
    // configuration-là — où un plancher dérivé de la configuration ambiante
    // mesurerait deux fois le module coupé. Mesuré : ce cas a rougi en 404.
    const mounted = await dispatchAllowingRateLimit(
      registryOf([...new Set([...enabledModules, 'analytics'])]),
      request(),
    )

    // 400 : la route existe, et son schéma Zod refuse un corps vide. C'est plus
    // fort que « pas 404 » — un chemin erroné rendrait 404 dans les deux cas.
    expect(mounted.status).toBe(400)
  })

  it('sert le script du navigateur **par le répartiteur**, et 404 module coupé', async () => {
    const { buildRegistry } = await import('@repo/core')
    const analytics = await import('@repo/module-analytics')
    const { availableModules, enabledModules, requiredModules } = await import(
      '../config/features'
    )
    const { appLocales } = await import('../config/i18n')
    const { dispatchAllowingRateLimit } = await import('./fixtures/rate-limit')

    const request = () =>
      new Request(`https://app.test${analytics.ANALYTICS_SCRIPT_PATH}`, { method: 'GET' })

    const registryOf = (enabled: readonly string[]) =>
      buildRegistry({
        available: [...availableModules],
        enabled,
        required: [...requiredModules],
        locales: [...appLocales],
      })

    // Le port et la configuration du navigateur sont **injectés** : ce cas
    // mesure le montage du chemin, pas la lecture de l'environnement.
    analytics.resetAnalyticsService()
    analytics.provideAnalytics(() => ({
      monitoring: { capture: async () => ({ ok: false as const, error: { code: 'not_configured' as const, message: '' } }) },
      browser: { key: 'phc_test', host: 'https://analytics.test' },
    }))

    const served = await dispatchAllowingRateLimit(
      registryOf([...new Set([...enabledModules, 'analytics'])]),
      request(),
    )

    // Un chemin qui porte une extension traverse-t-il le répartiteur ? La
    // question n'est pas rhétorique : c'est le seul chemin du dépôt qui en ait
    // une, et 404 est ici indistinguable d'une route absente.
    expect(served.status).toBe(200)
    expect(await served.text()).toContain('posthog')

    // **La configuration livrée, et c'est elle que la CI joue** : le module est
    // activé, aucune clé n'est posée. Ce cas manquait — celui d'au-dessus
    // injecte une configuration, donc n'exerçait jamais l'état livré, et
    // `e2e/modules.spec.ts` a trouvé le 404 en intégration. Troisième fois pour
    // cette classe après le rappel de s33 et le téléchargement de s35.
    analytics.resetAnalyticsService()
    analytics.provideAnalytics(() => ({
      monitoring: {
        capture: async () => ({
          ok: false as const,
          error: { code: 'not_configured' as const, message: '' },
        }),
      },
      browser: null,
    }))

    const unconfigured = await dispatchAllowingRateLimit(
      registryOf([...new Set([...enabledModules, 'analytics'])]),
      request(),
    )

    expect(unconfigured.status).toBe(503)

    const cut = await dispatchAllowingRateLimit(
      registryOf(enabledModules.filter((id) => id !== 'analytics')),
      request(),
    )

    // **Les deux absences ne se ressemblent pas, et c'est tout l'enjeu** :
    // 404 « ce module n'est pas activé », 503 « il l'est, rien n'est configuré ».
    // Les confondre rend le balayage de `e2e/modules.spec.ts` aveugle.
    expect(cut.status).toBe(404)
    expect(cut.status).not.toBe(unconfigured.status)

    analytics.resetAnalyticsService()
  })
})

describe('l’origine du fournisseur doit être déclarée à la politique de sécurité', () => {
  it('refuse le démarrage quand une clé est configurée sans son origine, en nommant la directive', async () => {
    const { assertAnalyticsIsReachable } = await import('../apps/web/lib/analytics-config')

    // Sans cette garde, le navigateur bloque les appels du script et la mesure
    // disparaît **sans un mot** — le mode de panne exact que `config/security.ts`
    // décrit pour le captcha. `'strict-dynamic'` autorise la **balise** ; les
    // appels réseau du fournisseur, eux, exigent son origine.
    expect(() =>
      assertAnalyticsIsReachable({ key: 'phc_test', host: 'https://analytics.test' }, {
        connect: [],
        img: [],
      }),
    ).toThrow(/connect-src/)
    expect(() =>
      assertAnalyticsIsReachable({ key: 'phc_test', host: 'https://analytics.test' }, {
        connect: ['https://analytics.test'],
        img: [],
      }),
    ).toThrow(/img-src/)
    expect(() =>
      assertAnalyticsIsReachable({ key: 'phc_test', host: 'https://analytics.test' }, {
        connect: ['https://analytics.test'],
        img: ['https://analytics.test'],
      }),
    ).not.toThrow()
    // Aucune clé : rien à déclarer, et c'est l'état livré du boilerplate.
    expect(() => assertAnalyticsIsReachable(null, { connect: [], img: [] })).not.toThrow()
  })
})

/**
 * **Le script déclaré mesure-t-il quoi que ce soit ?** (constat 6 de la revue).
 *
 * La première écriture de cette story déclarait `<hôte>/static/array.js` — le
 * chargeur du fournisseur — et **rien d'autre** : aucune `posthog.init(clé, …)`
 * nulle part, donc aucune clé de projet dans le bundle du navigateur. Un
 * exploitant qui posait `POSTHOG_KEY` obtenait une bannière demandant au
 * visiteur d'autoriser un tiers, un téléchargement chez ce tiers à
 * l'acceptation, et **zéro mesure**.
 *
 * Le script est donc **exécuté** ici, dans un DOM minimal, et ce sont ses effets
 * qu'on observe : la balise qu'il insère, et l'initialisation qu'il émet une
 * fois le chargeur arrivé. Une déclaration dont la seule preuve est la
 * déclaration est exactement ce que la revue a attrapé.
 */
describe('le script d’analyse initialise le fournisseur (critère 6)', () => {
  const settings = { key: 'phc_test', host: 'https://analytics.test' }

  interface FakeScript {
    src: string
    async: boolean
    readonly listeners: Record<string, () => void>
    addEventListener: (type: string, listener: () => void) => void
  }

  /** Le DOM qu'un navigateur offre à ce script, et rien de plus. */
  const runBootstrap = (source: string) => {
    const created: FakeScript[] = []
    const appended: FakeScript[] = []
    const context = {
      window: {} as { posthog?: unknown },
      document: {
        createElement: (): FakeScript => {
          const element: FakeScript = {
            src: '',
            async: false,
            listeners: {},
            addEventListener(type: string, listener: () => void) {
              this.listeners[type] = listener
            },
          }

          created.push(element)

          return element
        },
        head: { appendChild: (element: FakeScript) => appended.push(element) },
      },
    }

    runInNewContext(source, context)

    return { ...context, created, appended }
  }

  it('charge le chargeur du fournisseur **et** l’initialise avec la clé du projet', async () => {
    const { analyticsBootstrap } = await import('@repo/module-analytics')
    const dom = runBootstrap(analyticsBootstrap(settings))

    // La balise est insérée, et vers l'hôte configuré — jamais une adresse figée.
    expect(dom.created).toHaveLength(1)
    expect(dom.created[0]?.src).toBe('https://analytics.test/static/array.js')
    expect(dom.appended).toEqual(dom.created)

    // Rien n'est initialisé tant que le chargeur n'est pas arrivé : la clé ne
    // part pas dans le vide.
    const calls: unknown[][] = []

    dom.window.posthog = {
      init: (...args: unknown[]) => {
        calls.push(args)
      },
    }
    expect(calls).toEqual([])

    dom.created[0]?.listeners.load?.()

    // **C'est la mesure du constat 6** : sans cet appel, le fournisseur est
    // téléchargé et ne mesure rien.
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toBe('phc_test')
    expect(calls[0]?.[1]).toMatchObject({
      api_host: 'https://analytics.test',
      capture_pageview: true,
    })
  })

  it('ne lève jamais, même si le chargeur n’a pas défini le fournisseur', async () => {
    const { analyticsBootstrap } = await import('@repo/module-analytics')
    const dom = runBootstrap(analyticsBootstrap(settings))

    // Un chargeur bloqué par un bloqueur de publicité définit parfois la balise
    // sans définir l'objet. Lever ici casserait la page pour une mesure.
    expect(() => dom.created[0]?.listeners.load?.()).not.toThrow()
  })

  it('sert ce script depuis notre propre origine, et **503** sans clé configurée', async () => {
    const { createBrowserScriptRoutes } = await import('@repo/module-analytics')

    const call = async (browser: typeof settings | null): Promise<Response> => {
      const [route] = createBrowserScriptRoutes(() => browser)

      return await (
        route as unknown as { handler: (request: Request) => Promise<Response> }
      ).handler(new Request('https://app.test/api/modules/analytics/script.js'))
    }

    const served = await call(settings)

    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toContain('javascript')
    expect(await served.text()).toContain('phc_test')

    // **503, jamais 404** — la réponse de s33, et pour sa raison exacte :
    // l'endroit existe, aucun fournisseur n'est derrière. 404 dirait « ce
    // boilerplate ne sert pas de script d'analyse », ce qui est faux, et se
    // confondrait avec la réponse d'un module **coupé** — la distinction que le
    // critère 8 tout entier repose sur.
    const unconfigured = await call(null)

    expect(unconfigured.status).toBe(503)
    expect(await unconfigured.json()).toEqual({ error: 'analytics_provider_not_configured' })
  })
})
