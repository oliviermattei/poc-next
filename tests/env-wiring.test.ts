import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EnvSource } from '@repo/config'
import { findRootEnvPath, loadRootEnv } from '@repo/config/server'

const TURBO_CONFIG_PATH = fileURLToPath(new URL('../turbo.json', import.meta.url))
const CONFIG_BARREL_PATH = fileURLToPath(
  new URL('../packages/config/src/index.ts', import.meta.url),
)

/** Spécificateurs d'import atteignables depuis un fichier, transitivement. */
const reachableImports = async (entry: string): Promise<string[]> => {
  const visited = new Set<string>()
  const specifiers: string[] = []

  const visit = async (file: string): Promise<void> => {
    if (visited.has(file)) {
      return
    }

    visited.add(file)
    const source = await readFile(file, 'utf8')

    for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
      const specifier = match[1] ?? ''
      specifiers.push(specifier)

      if (specifier.startsWith('.')) {
        await visit(resolve(dirname(file), `${specifier}.ts`))
      }
    }
  }

  await visit(entry)

  return specifiers
}

const writeEnvFile = async (content: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'boilerplate-env-'))
  const path = join(directory, '.env')
  await writeFile(path, content, 'utf8')

  return path
}

describe('chargement du `.env` racine', () => {
  it('alimente l’environnement à partir du fichier', async () => {
    const path = await writeEnvFile('DATABASE_URL=postgres://user:password@localhost:5432/app\n')
    const target: EnvSource = {}

    loadRootEnv({ path, target })

    expect(target.DATABASE_URL).toBe('postgres://user:password@localhost:5432/app')
  })

  it('n’écrase pas une variable déjà exportée : l’environnement l’emporte sur le fichier', async () => {
    const path = await writeEnvFile('DATABASE_URL=postgres://file:file@localhost:5432/file\n')
    const target: EnvSource = { DATABASE_URL: 'postgres://shell:shell@localhost:5432/shell' }

    loadRootEnv({ path, target })

    expect(target.DATABASE_URL).toBe('postgres://shell:shell@localhost:5432/shell')
  })

  it('reste sans effet quand le fichier n’existe pas : tout peut venir de l’environnement', () => {
    const target: EnvSource = {}

    expect(() => loadRootEnv({ path: join(tmpdir(), 'boilerplate-absent', '.env'), target })).not.toThrow()
    expect(target).toEqual({})
  })

  it('vise le `.env` de la racine du dépôt, celui que `.env.example` demande de copier', () => {
    expect(findRootEnvPath()).toBe(fileURLToPath(new URL('../.env', import.meta.url)))
  })

  it('trouve la même racine depuis n’importe quel dossier du dépôt', () => {
    // `next dev` s'exécute depuis `apps/web`, les scripts de base depuis
    // `packages/db`, les tests depuis la racine : tous doivent lire le même
    // fichier. Le chemin est résolu à l'exécution, jamais par un bundler.
    const fromApp = fileURLToPath(new URL('../apps/web', import.meta.url))

    expect(findRootEnvPath(fromApp)).toBe(fileURLToPath(new URL('../.env', import.meta.url)))
  })

  it('ne désigne aucun fichier hors du dépôt : tout vient alors de l’environnement', () => {
    expect(findRootEnvPath(tmpdir())).toBeUndefined()
  })

  it('résout un dossier de départ relatif avant de remonter', () => {
    // Un chemin relatif n'a pas de racine (`parse('a/b').root === ''`) et
    // `dirname('.') === '.'` : sans résolution préalable, la remontée ne
    // s'arrête jamais hors du dépôt, et rend un chemin relatif à l'intérieur.
    expect(findRootEnvPath('.')).toBe(fileURLToPath(new URL('../.env', import.meta.url)))
    expect(findRootEnvPath('apps/web')).toBe(fileURLToPath(new URL('../.env', import.meta.url)))
  })
})

/**
 * Les deux câblages ci-dessous sont invisibles pour les tests qui importent
 * directement un module applicatif : ils décident si `DATABASE_URL` atteint le
 * processus qui sert `/api/health`. Leur régression est silencieuse — 503
 * définitif, sans qu'aucun test métier ne bouge.
 */
describe('transmission de `DATABASE_URL` jusqu’à l’application', () => {
  afterEach(() => {
    vi.doUnmock('@repo/config/server')
    vi.resetModules()
  })

  it('la configuration de `apps/web` charge le `.env` racine — Next ne lit que le dossier de l’app', async () => {
    const loadedPaths: (string | undefined)[] = []

    vi.doMock('@repo/config/server', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@repo/config/server')>()),
      loadRootEnv: (options?: { path?: string }) => {
        loadedPaths.push(options?.path ?? findRootEnvPath())
      },
    }))
    vi.resetModules()

    await import('../apps/web/next.config')

    expect(loadedPaths).toEqual([findRootEnvPath()])
  })

  it('turbo transmet `DATABASE_URL` à toutes les tâches qui joignent la base', async () => {
    const turbo = JSON.parse(await readFile(TURBO_CONFIG_PATH, 'utf8')) as {
      tasks: Record<string, { env?: string[] }>
    }

    for (const task of ['dev', 'build', 'db:migrate', 'db:seed']) {
      expect(turbo.tasks[task]?.env ?? []).toContain('DATABASE_URL')
    }
  })

  it('turbo compte le `.env` racine dans la clé de cache', async () => {
    // Turborepo hache les variables du processus, pas le fichier qui les porte :
    // sans cette déclaration, modifier `.env` puis relancer `build` rend
    // `FULL TURBO`. Dès la première variable `NEXT_PUBLIC_*`, inlinée au build,
    // le cache servirait un artefact construit avec l'ancienne valeur.
    const turbo = JSON.parse(await readFile(TURBO_CONFIG_PATH, 'utf8')) as {
      globalDependencies?: string[]
    }

    expect(turbo.globalDependencies ?? []).toContain('.env')
  })
})

describe('surface client de `@repo/config`', () => {
  it('n’entraîne aucun module Node depuis son barril principal', async () => {
    // Ce package est le point d'accès unique à l'environnement et hébergera les
    // variables `NEXT_PUBLIC_*` : le premier composant client qui l'importe
    // traînerait `node:fs` dans le graphe client. Ce qui lit un fichier vit
    // dans `@repo/config/server`.
    const specifiers = await reachableImports(CONFIG_BARREL_PATH)

    expect(specifiers.filter((specifier) => specifier.startsWith('node:'))).toEqual([])
  })
})

/**
 * Critère 2 de la story : une variable absente ou malformée doit faire échouer
 * le **démarrage**, pas seulement la première requête. Next charge
 * `next.config.ts` avant de servir quoi que ce soit et abandonne quand ce
 * chargement lève — c'est le seul point de démarrage commun à `next dev` et à
 * `next start`, et il reçoit la phase, ce qui laisse `next build` passer.
 */
describe('validation de l’environnement au démarrage du serveur', () => {
  const DEV_SERVER_PHASE = 'phase-development-server'
  const BUILD_PHASE = 'phase-production-build'

  const loadNextConfig = async () => {
    vi.resetModules()
    const { default: config } = await import('../apps/web/next.config')

    return config
  }

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('refuse de démarrer sur une `DATABASE_URL` malformée, en la nommant', async () => {
    vi.stubEnv('DATABASE_URL', 'mysql://oops@localhost/x')

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/DATABASE_URL/)
  })

  it('démarre sur une URL bien formée mais injoignable : c’est la sonde qui répondra 503', async () => {
    // Une base éteinte n'est pas une erreur de configuration : le serveur doit
    // démarrer et `/api/health` répondre 503.
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@127.0.0.1:1/app')

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).not.toThrow()
  })

  it('ne valide pas pendant `next build` : le build s’exécute sans les variables d’exécution', async () => {
    vi.stubEnv('DATABASE_URL', 'mysql://oops@localhost/x')

    const config = await loadNextConfig()

    expect(() => config(BUILD_PHASE)).not.toThrow()
  })
})
