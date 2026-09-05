import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { runList } from '@repo/cli'
import { defineModule } from '@repo/core'
import { afterAll, describe, expect, it } from 'vitest'

import { createMcpServer, type McpServerDependencies } from './server'

const execFileAsync = promisify(execFile)

/**
 * Le serveur est éprouvé par un **vrai client MCP**, relié par un transport en
 * mémoire (§ SDK, `inMemory.js`) : c'est le réseau qu'on double, jamais le
 * SDK — `docs/architecture.md` §Integration points. Un dépôt temporaire, un
 * vrai dépôt git dessus : la garde de dépôt propre (ADR 041) interroge `git`
 * pour de vrai.
 */
const moduleFor = (
  id: string,
  requires: readonly string[] = [],
  migrations: string | null = `packages/modules/${id}/migrations`,
) =>
  defineModule({
    id,
    requires,
    schema: {},
    migrations,
    routes: [],
    navigation: [],
    publicUrls: () => [],
    messages: { fr: {} },
    emails: [],
    webhooks: [],
    jobs: [],
    dataCategories: [],
    retention: {},
    purge: async () => {},
    export: async () => ({}),
  })

const available = [
  moduleFor('socle'),
  moduleFor('facturation', ['socle']),
  // Un module sans SQL versionné : activer celui-là n'a aucune migration à
  // jouer, et ne doit donc toucher aucune base, même autorisation donnée.
  moduleFor('journal', [], null),
]

const temporaries: string[] = []

afterAll(async () => {
  for (const root of temporaries) {
    await rm(root, { recursive: true, force: true })
  }
})

interface Repo {
  readonly root: string
  readonly featuresPath: string
  readonly generatedPath: string
}

const temporaryRepo = async (enabled: readonly string[] = ['socle']): Promise<Repo> => {
  const root = await mkdtemp(join(tmpdir(), 'mcp-server-'))
  const featuresPath = join(root, 'config', 'features.ts')
  const generatedPath = join(root, 'generated', 'schema')

  temporaries.push(root)

  await mkdir(join(root, 'config'), { recursive: true })
  await mkdir(generatedPath, { recursive: true })
  await writeFile(
    featuresPath,
    `export const enabledModules = [${enabled.map((id) => `'${id}'`).join(', ')}] as const\n`,
    'utf8',
  )

  for (const id of enabled) {
    await writeFile(join(generatedPath, `${id}.ts`), `// baril ${id}\n`, 'utf8')
  }

  await execFileAsync('git', ['init', '--quiet'], { cwd: root })
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root })
  await execFileAsync('git', ['add', '.'], { cwd: root })
  await execFileAsync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: root })

  return { root, featuresPath, generatedPath }
}

const dependenciesFor = (
  repo: Repo,
  regenerated: string[] = [],
  migrated: string[] = [],
): McpServerDependencies => ({
  repoRoot: repo.root,
  available,
  featuresPath: repo.featuresPath,
  generatedPaths: [repo.generatedPath],
  regenerate: async () => {
    const source = await readFile(repo.featuresPath, 'utf8')
    const enabled = [...source.matchAll(/'([a-z-]+)'/g)]
      .map((match) => match[1])
      .filter((id): id is string => id !== undefined)

    await rm(repo.generatedPath, { recursive: true, force: true })
    await mkdir(repo.generatedPath, { recursive: true })

    for (const id of enabled) {
      await writeFile(join(repo.generatedPath, `${id}.ts`), `// baril régénéré ${id}\n`, 'utf8')
      regenerated.push(id)
    }
  },
  applyMigrations: async () => {
    migrated.push('appliquées')
  },
})

/** Un client MCP réel, relié au serveur par un transport en mémoire. */
const connectedClient = async (deps: McpServerDependencies): Promise<Client> => {
  const server = createMcpServer(deps)
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' })

  await server.connect(serverTransport)
  await client.connect(clientTransport)

  return client
}

const jsonOf = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: readonly { readonly type: string; readonly text: string }[]
    isError?: boolean
  }

  return { isError: result.isError === true, payload: JSON.parse(result.content[0]!.text) }
}

describe('serveur MCP — l’invariant « deux façades, un moteur »', () => {
  it('list_modules rend exactement ce que rend le moteur CLI sur la même configuration', async () => {
    const repo = await temporaryRepo(['socle', 'facturation'])
    const client = await connectedClient(dependenciesFor(repo))

    const fromMcp = await jsonOf(client, 'list_modules')
    const fromCli = await runList({ available, featuresPath: repo.featuresPath })

    expect(fromMcp.payload).toEqual(fromCli)
  })
})

describe('serveur MCP — toggle_module', () => {
  it('active un module, régénère, et rend la liste exacte des fichiers modifiés', async () => {
    const repo = await temporaryRepo(['socle'])
    const regenerated: string[] = []
    const client = await connectedClient(dependenciesFor(repo, regenerated))

    const { isError, payload } = await jsonOf(client, 'toggle_module', {
      moduleId: 'facturation',
    })

    expect(isError).toBe(false)
    expect(payload).toMatchObject({ action: 'enable', moduleId: 'facturation' })
    expect(payload.modifiedFiles).toContain(join('config', 'features.ts'))
    expect(payload.modifiedFiles).toContain(join('generated', 'schema', 'facturation.ts'))
    expect(await readdir(repo.generatedPath)).toContain('facturation.ts')
  })

  it('nomme les migrations restées à jouer, et ne touche à aucune base sans autorisation', async () => {
    // Critère 2 : « propose les migrations à jouer ». Un agent n'a pas la
    // sortie de la commande sous les yeux — si la charge utile ne les nomme
    // pas, elles n'existent pas pour lui.
    const repo = await temporaryRepo(['socle'])
    const migrated: string[] = []
    const client = await connectedClient(dependenciesFor(repo, [], migrated))

    const { payload } = await jsonOf(client, 'toggle_module', { moduleId: 'facturation' })

    expect(payload.migrations).toEqual([
      { moduleId: 'facturation', path: 'packages/modules/facturation/migrations' },
    ])
    expect(payload.migrationsApplied).toBe(false)
    expect(migrated).toEqual([])
  })

  it('applique les migrations quand l’appelant l’autorise', async () => {
    const repo = await temporaryRepo(['socle'])
    const migrated: string[] = []
    const client = await connectedClient(dependenciesFor(repo, [], migrated))

    const { payload } = await jsonOf(client, 'toggle_module', {
      moduleId: 'facturation',
      applyMigrations: true,
    })

    expect(payload.migrationsApplied).toBe(true)
    expect(migrated).toEqual(['appliquées'])
  })

  it('ne lance aucune migration quand le module activé n’en déclare aucune', async () => {
    const repo = await temporaryRepo(['socle'])
    const migrated: string[] = []
    const client = await connectedClient(dependenciesFor(repo, [], migrated))

    const { payload } = await jsonOf(client, 'toggle_module', {
      moduleId: 'journal',
      applyMigrations: true,
    })

    expect(payload.migrations).toEqual([])
    expect(payload.migrationsApplied).toBe(false)
    expect(migrated).toEqual([])
  })

  it('refuse un module inconnu, en le nommant', async () => {
    const repo = await temporaryRepo()
    const client = await connectedClient(dependenciesFor(repo))

    const result = (await client.callTool({
      name: 'toggle_module',
      arguments: { moduleId: 'inexistant' },
    })) as { content: readonly { text: string }[]; isError?: boolean }

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('inexistant')
  })

  it('refuse un requis manquant, en le nommant', async () => {
    const repo = await temporaryRepo([])
    const client = await connectedClient(dependenciesFor(repo))

    const result = (await client.callTool({
      name: 'toggle_module',
      arguments: { moduleId: 'facturation' },
    })) as { content: readonly { text: string }[]; isError?: boolean }

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('socle')
  })

  it('refuse un dépendant encore activé, en le nommant', async () => {
    const repo = await temporaryRepo(['socle', 'facturation'])
    const client = await connectedClient(dependenciesFor(repo))

    const result = (await client.callTool({
      name: 'toggle_module',
      arguments: { moduleId: 'socle' },
    })) as { content: readonly { text: string }[]; isError?: boolean }

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('facturation')
  })

  it('refuse sur un dépôt aux modifications non commitées, sans rien écrire', async () => {
    const repo = await temporaryRepo(['socle'])

    await writeFile(join(repo.root, 'oubli.txt'), 'travail en cours\n', 'utf8')

    const client = await connectedClient(dependenciesFor(repo))
    const before = await readFile(repo.featuresPath, 'utf8')

    const result = (await client.callTool({
      name: 'toggle_module',
      arguments: { moduleId: 'facturation' },
    })) as { content: readonly { text: string }[]; isError?: boolean }

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('non commitées')
    expect(await readFile(repo.featuresPath, 'utf8')).toBe(before)
  })
})

describe('serveur MCP — scaffold_module', () => {
  it('génère le squelette et rend la liste exacte des fichiers créés', async () => {
    const repo = await temporaryRepo()
    const client = await connectedClient(dependenciesFor(repo))

    const { isError, payload } = await jsonOf(client, 'scaffold_module', {
      moduleId: 'roadmap',
    })

    expect(isError).toBe(false)
    expect(payload.moduleId).toBe('roadmap')
    expect(payload.written).toContain(join('packages/modules/roadmap', 'src/module.ts'))
    expect(
      await readFile(join(repo.root, 'packages/modules/roadmap/src/module.ts'), 'utf8'),
    ).toContain("id: 'roadmap'")
  })

  it('refuse un identifiant déjà connu de l’annuaire, en le nommant', async () => {
    const repo = await temporaryRepo()
    const client = await connectedClient(dependenciesFor(repo))

    const result = (await client.callTool({
      name: 'scaffold_module',
      arguments: { moduleId: 'socle' },
    })) as { content: readonly { text: string }[]; isError?: boolean }

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('socle')
  })

  it('refuse sur un dépôt aux modifications non commitées, sans rien créer', async () => {
    const repo = await temporaryRepo()

    await writeFile(join(repo.root, 'oubli.txt'), 'travail en cours\n', 'utf8')

    const client = await connectedClient(dependenciesFor(repo))

    const result = (await client.callTool({
      name: 'scaffold_module',
      arguments: { moduleId: 'roadmap' },
    })) as { content: readonly { text: string }[]; isError?: boolean }

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('non commitées')

    const created = await readdir(join(repo.root, 'packages')).catch(() => [])

    expect(created).not.toContain('modules')
  })
})
