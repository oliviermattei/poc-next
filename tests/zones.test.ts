import { readdirSync } from 'node:fs'
import { sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildRegistry, MODULE_ROUTE_PREFIX, navigationSurfaceOf } from '@repo/core'
import { describe, expect, it } from 'vitest'

import { urlSegment, warmUpTargets } from '../e2e/support/warm-up'
import { LEGACY_SCREEN_PATHS } from '../apps/web/lib/legacy-paths'
import { zoneOf } from '../apps/web/lib/zones'
import { availableModules, requiredModules } from '../config/features'
import { appLocales } from '../config/i18n'

/**
 * **Les écrans sont rangés par zone** (s60, ADR 071).
 *
 * Quatre dossiers de routes — `(site)`, `(auth)`, `(app)`, `(console)` — et
 * chaque page vit sous **exactement un** d'eux. Une page posée à la racine de
 * `apps/web/app` n'hériterait d'aucun shell (le layout racine n'en rend plus),
 * et une page sous deux zones imbriquées en rendrait deux. Les deux défauts se
 * lisent sur le disque, sans rien rendre : la liste des pages est **dérivée**
 * de l'arborescence, jamais recopiée.
 */

const APP_ROOT = fileURLToPath(new URL('../apps/web/app', import.meta.url))

/** Les dossiers de zone, tels que l'ADR 071 les fixe. */
const ZONES = ['(site)', '(auth)', '(app)', '(console)'] as const

const pageFiles = (): readonly string[] =>
  readdirSync(APP_ROOT, { recursive: true })
    .map((entry) => String(entry).split(sep).join('/'))
    .filter((file) => file === 'page.tsx' || file.endsWith('/page.tsx'))
    .sort()

const zonesOf = (file: string): readonly string[] =>
  file.split('/').filter((segment) => (ZONES as readonly string[]).includes(segment))

describe('chaque page vit dans exactement une zone', () => {
  it('trouve des pages, faute de quoi ce cas ne vérifierait rien', () => {
    // Le plancher : l'arborescence porte une trentaine de pages ; un balayage
    // qui n'en verrait qu'une poignée aurait perdu un dossier entier.
    expect(pageFiles().length).toBeGreaterThan(25)
    // Et chaque zone en porte au moins une : une zone vide serait un dossier
    // que la partition annonce sans le tenir.
    for (const zone of ZONES) {
      expect(
        pageFiles().some((file) => file.startsWith(`${zone}/`)),
        `aucune page sous ${zone}`,
      ).toBe(true)
    }
  })

  it('range chaque page sous un seul dossier de zone, au premier niveau', () => {
    const misplaced = pageFiles().filter((file) => {
      const zones = zonesOf(file)

      return zones.length !== 1 || !file.startsWith(`${zones[0] ?? ''}/`)
    })

    expect(misplaced).toEqual([])
  })

  it('ne connaît aucun autre dossier de routes que les quatre zones', () => {
    // Un cinquième groupe `(…)` hors de la partition serait une zone sans
    // décision : il doit passer par un ADR, pas par un dossier.
    const groups = readdirSync(APP_ROOT, { recursive: true })
      .map((entry) => String(entry).split(sep).join('/'))
      .flatMap((path) => path.split('/'))
      .filter((segment) => segment.startsWith('('))

    expect([...new Set(groups)].sort()).toEqual([...ZONES].sort())
  })
})

describe('le préambule des parcours traduit les dossiers de routes', () => {
  it('traduit un dossier de zone en « aucun segment »', () => {
    expect(urlSegment('(site)')).toBe('')
    expect(urlSegment('(console)')).toBe('')
  })

  it('refuse toujours une route parallèle, qu’aucun écran n’utilise', () => {
    expect(() => urlSegment('@panneau')).toThrow(/préambule/)
  })

  it('demande l’URL de chaque page sans le dossier de zone, telle que le routeur la sert', async () => {
    const targets = await warmUpTargets()
    const expected = pageFiles().map(
      (file) =>
        `/${file
          .split('/')
          .slice(0, -1)
          .filter((segment) => !segment.startsWith('('))
          .map((segment) => (segment.startsWith('[') ? 'warm-up' : segment))
          .join('/')}`,
    )

    // Aucune cible ne porte de groupe, de double barre ni de segment vide.
    expect(targets.filter((target) => /[()@]|\/\//.test(target))).toEqual([])
    expect(expected.filter((path) => !targets.includes(path))).toEqual([])
    // Et l'accueil reste `/`, pas une chaîne vide.
    expect(targets).toContain('/')
  })
})

/**
 * **L'application est servie sous `/app`** (s63).
 *
 * `/` est le site, `/console` le back-office ; tout écran de l'application —
 * celui d'un compte connecté — vit sous `/app`. Deux lectures, chacune dérivée :
 * le disque (aucune page de la zone `(app)` hors de son dossier `app/`), et le
 * registre complet (aucune entrée protégée d'un module, hors console et hors
 * API, ne mène ailleurs). Un écran laissé à la racine répondrait encore, et
 * aucun parcours ne rougirait.
 */
describe('chaque écran applicatif vit sous /app', () => {
  it('ne trouve aucune page de la zone Application hors de son dossier app/', () => {
    const application = pageFiles().filter((file) => file.startsWith('(app)/'))

    // L'anti-vacuité : la zone porte bien des pages.
    expect(application.length).toBeGreaterThan(5)
    expect(application.filter((file) => !file.startsWith('(app)/app/'))).toEqual([])
  })

  it('ne déclare, dans aucun module, d’entrée protégée hors /app, sauf console et API', () => {
    // Le registre **complet** : chaque module de l'annuaire, activé ou non ici
    // — un écran qu'une configuration coupe reste un écran que le module déclare.
    const everything = buildRegistry({
      available: availableModules,
      enabled: availableModules.map((module) => module.id),
      required: requiredModules,
      locales: [...appLocales],
    })
    const protectedScreens = everything.navigation.filter(
      (entry) =>
        entry.protection.level !== 'public' &&
        navigationSurfaceOf(entry) !== 'console' &&
        !entry.href.startsWith(MODULE_ROUTE_PREFIX),
    )

    // L'anti-vacuité : des entrées protégées existent hors console.
    expect(protectedScreens.length).toBeGreaterThan(0)
    expect(
      protectedScreens
        .filter((entry) => entry.href !== '/app' && !entry.href.startsWith('/app/'))
        .map((entry) => `${entry.id} → ${entry.href}`),
    ).toEqual([])
  })
})

/**
 * **La table des zones du proxy** (s64b1, ADR 079) comparée au disque.
 *
 * `apps/web/lib/zones.ts` classe un chemin interne par son premier segment ;
 * chaque premier segment de page d'un dossier de zone doit y être classé dans
 * la zone de ce dossier, sinon une page ajoutée serait servie sur le mauvais
 * hôte — ou redirigée vers lui — sans que rien ne rougisse.
 */
describe('la table des zones du proxy suit le disque', () => {
  const ZONE_OF_FOLDER = {
    '(site)': 'site',
    '(auth)': 'outside',
    '(app)': 'app',
    '(console)': 'console',
  } as const

  /** Les fichiers de métadonnées de Next, et l'URL que chacun sert. */
  const METADATA_URLS: Readonly<Record<string, string>> = {
    robots: 'robots.txt',
    sitemap: 'sitemap.xml',
    manifest: 'manifest.webmanifest',
  }

  it('classe chaque premier segment de page, de métadonnées et d’API dans la zone de son dossier', () => {
    const expected = new Map<string, string>()

    for (const file of pageFiles()) {
      const [folder, ...rest] = file.split('/')
      const zone = ZONE_OF_FOLDER[folder as keyof typeof ZONE_OF_FOLDER]
      // `page.tsx` directement sous le dossier de zone : la racine du chemin.
      const segment = rest.length === 1 ? '' : (rest[0] ?? '')

      expected.set(`/${segment}`, zone)
    }

    const metadata = readdirSync(APP_ROOT)
      .map((file) => METADATA_URLS[file.replace(/\.[^.]+$/, '')])
      .filter((url): url is string => url !== undefined)

    // L'anti-vacuité : les deux fichiers de métadonnées livrés sont vus.
    expect(metadata).toEqual(expect.arrayContaining(['robots.txt', 'sitemap.xml']))

    for (const url of metadata) {
      expected.set(`/${url}`, 'site')
    }

    expected.set('/api/health', 'api')
    // L'anti-vacuité : chaque zone du disque a fourni au moins un segment.
    expect(new Set(expected.values())).toEqual(
      new Set(['site', 'outside', 'app', 'console', 'api']),
    )

    const actual = new Map([...expected.keys()].map((path) => [path, zoneOf(path)]))

    expect(Object.fromEntries(actual)).toEqual(Object.fromEntries(expected))
    // Et un segment qu'aucun dossier ne sert n'est aiguillé nulle part.
    expect(zoneOf('/inconnu')).toBeNull()
  })

  it('range chaque ancien chemin d’écran dans la zone Application', () => {
    const legacy = Object.keys(LEGACY_SCREEN_PATHS)

    expect(legacy.length).toBeGreaterThan(0)
    expect(legacy.filter((path) => zoneOf(path) !== 'app')).toEqual([])
  })
})
