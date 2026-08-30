import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { findRootEnvPath, loadRootEnv, type EnvSource } from '@repo/config'

const TURBO_CONFIG_PATH = fileURLToPath(new URL('../turbo.json', import.meta.url))

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
})

/**
 * Les deux câblages ci-dessous sont invisibles pour les tests qui importent
 * directement un module applicatif : ils décident si `DATABASE_URL` atteint le
 * processus qui sert `/api/health`. Leur régression est silencieuse — 503
 * définitif, sans qu'aucun test métier ne bouge.
 */
describe('transmission de `DATABASE_URL` jusqu’à l’application', () => {
  afterEach(() => {
    vi.doUnmock('@repo/config')
    vi.resetModules()
  })

  it('la configuration de `apps/web` charge le `.env` racine — Next ne lit que le dossier de l’app', async () => {
    const loadedPaths: (string | undefined)[] = []

    vi.doMock('@repo/config', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@repo/config')>()),
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
})
