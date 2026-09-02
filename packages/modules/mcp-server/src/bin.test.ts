import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import { afterAll, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

/**
 * `src/bin.ts` est le point de composition : lancé pour de vrai, sur un dépôt
 * temporaire, comme `packages/cli/src/bin.test.ts` le fait pour `ks`. Critère
 * 7 : un module désactivé ne doit même pas construire de transport.
 */
const BIN = fileURLToPath(new URL('../bin/mcp-server.mjs', import.meta.url))

const FEATURES = (enabled: readonly string[], available: readonly string[]): string =>
  [
    '/** Dépôt temporaire, annuaire écrit à la main. */',
    `export const availableModules = [${available
      .map((id) => `{ id: '${id}', requires: [], migrations: null }`)
      .join(', ')}] as const`,
    `export const enabledModules = [${enabled.map((id) => `'${id}'`).join(', ')}] as const`,
    '',
  ].join('\n')

const temporaries: string[] = []

afterAll(async () => {
  for (const root of temporaries) {
    await rm(root, { recursive: true, force: true })
  }
})

interface RepoOptions {
  /** L'annuaire du dépôt temporaire. Par défaut, le seul module du test. */
  readonly available?: readonly string[]
  /** Scripts du `package.json` : ce que les sous-processus du serveur lanceront. */
  readonly scripts?: Record<string, string>
  /** Un vrai dépôt git, propre — ce qu'exige la garde d'ADR 041. */
  readonly git?: boolean
}

const temporaryRepo = async (
  enabled: readonly string[],
  options: RepoOptions = {},
): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'mcp-bin-'))

  temporaries.push(root)
  await mkdir(join(root, 'config'), { recursive: true })
  await mkdir(join(root, 'generated', 'schema'), { recursive: true })
  await writeFile(
    join(root, 'config', 'features.ts'),
    FEATURES(enabled, options.available ?? ['mcp-server']),
    'utf8',
  )
  await writeFile(
    join(root, 'package.json'),
    `${JSON.stringify(
      { name: 'depot-temporaire', private: true, type: 'module', scripts: options.scripts ?? {} },
      null,
      2,
    )}\n`,
    'utf8',
  )

  if (options.git === true) {
    await execFileAsync('git', ['init', '--quiet'], { cwd: root })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root })
    await execFileAsync('git', ['add', '-A'], { cwd: root })
    await execFileAsync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: root })
  }

  return root
}

describe('serveur MCP — module désactivé (critère 7)', () => {
  it('refuse de démarrer, nomme le module, et ne construit aucun transport', async () => {
    const root = await temporaryRepo([])

    const exit = await new Promise<{ code: number; stdout: string; stderr: string }>(
      (accept, reject) => {
        const child = spawn(process.execPath, [BIN], {
          cwd: root,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        let stdout = ''
        let stderr = ''

        child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')))
        child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
        child.on('error', reject)
        child.on('close', (code) => accept({ code: code ?? -1, stdout, stderr }))
      },
    )

    expect(exit.code).toBe(1)
    expect(exit.stderr).toContain('mcp-server')
    expect(exit.stderr).toContain('désactivé')
    // Rien du protocole MCP n'a été émis : le refus a lieu avant tout transport.
    expect(exit.stdout).toBe('')
  }, 15_000)
})

/**
 * Le canal du protocole, tenu de bout en bout.
 *
 * `stdout` d'un serveur MCP en `stdio` ne porte **que** des messages JSON-RPC :
 * tout ce qu'un sous-processus (`pnpm db:generate`, `pnpm db:migrate`) imprime
 * doit partir ailleurs. Le défaut vit au point de composition — c'est là que la
 * redirection se décide — et aucun client du SDK ne le montre : il faut piloter
 * le binaire en `stdio` brut et **classer chaque ligne reçue**.
 */
interface RawExchange {
  readonly stdout: string
  readonly stderr: string
}

const rawToolCall = async (
  root: string,
  call: { readonly name: string; readonly arguments: Record<string, unknown> },
): Promise<RawExchange> => {
  const child = spawn(process.execPath, [BIN], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => (stderr += chunk))

  const send = (message: unknown): void => {
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  /** Attend la réponse portant `id`, quoi qu'il arrive d'autre sur le canal. */
  const awaitResponse = (id: number): Promise<void> =>
    new Promise((accept, reject) => {
      const timer = setTimeout(() => reject(new Error(`Aucune réponse à l’identifiant ${id}.`)), 40_000)
      const onData = (chunk: string): void => {
        stdout += chunk

        for (const line of stdout.split('\n')) {
          try {
            const message = JSON.parse(line) as { id?: number }

            if (message.id === id) {
              clearTimeout(timer)
              child.stdout.off('data', onData)
              accept()

              return
            }
          } catch {
            // Ligne non-JSON : exactement ce que le test mesure plus bas.
          }
        }
      }

      child.stdout.on('data', onData)
      child.on('error', reject)
    })

  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'client-brut', version: '0.0.0' },
    },
  })
  await awaitResponse(1)

  send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: call })
  await awaitResponse(2)

  child.kill()

  return { stdout, stderr }
}

describe('serveur MCP — le canal du protocole', () => {
  it('n’écrit que du JSON-RPC sur stdout, même quand un outil lance un sous-processus', async () => {
    const banner = 'BANNIERE-DE-SOUS-PROCESSUS'
    const root = await temporaryRepo(['mcp-server'], {
      available: ['mcp-server', 'facturation'],
      git: true,
      scripts: {
        'db:generate': `node -e "console.log('${banner}'); console.log('inventaire des tables')"`,
      },
    })

    const { stdout, stderr } = await rawToolCall(root, {
      name: 'toggle_module',
      arguments: { moduleId: 'facturation' },
    })

    const lines = stdout.split('\n').filter((line) => line.trim().length > 0)
    const notJson = lines.filter((line) => {
      try {
        return (JSON.parse(line) as { jsonrpc?: string }).jsonrpc !== '2.0'
      } catch {
        return true
      }
    })

    expect(notJson).toEqual([])
    // La sortie du sous-processus n'est pas supprimée pour autant : sans elle,
    // un échec de régénération serait indiagnosticable.
    expect(stderr).toContain(banner)
  }, 60_000)
})

describe('serveur MCP — module activé', () => {
  it('démarre et répond à un vrai client MCP relié en stdio', async () => {
    const root = await temporaryRepo(['mcp-server'])
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BIN],
      cwd: root,
    })
    const client = new Client({ name: 'test-client', version: '0.0.0' })

    await client.connect(transport)

    const tools = await client.listTools()

    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      'list_modules',
      'scaffold_module',
      'toggle_module',
    ])

    await client.close()
  }, 15_000)
})
