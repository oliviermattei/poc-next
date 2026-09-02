import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { mcpClientConfigSchema } from './client-config-schema'

const EXAMPLE = fileURLToPath(new URL('../mcp-client.example.json', import.meta.url))

describe('exemple de configuration client MCP (critère 6)', () => {
  it('valide contre le schéma', async () => {
    const raw = JSON.parse(await readFile(EXAMPLE, 'utf8'))

    const result = mcpClientConfigSchema.safeParse(raw)

    expect(result.success).toBe(true)
    expect(result.data?.mcpServers['killer-boilerplate']?.command).toBe('node')
  })

  it('refuse une entrée sans commande', () => {
    const result = mcpClientConfigSchema.safeParse({
      mcpServers: { broken: { args: ['--help'] } },
    })

    expect(result.success).toBe(false)
  })

  it('refuse un document qui n’a pas la clé mcpServers', () => {
    const result = mcpClientConfigSchema.safeParse({
      servers: { killer: { command: 'node' } },
    })

    expect(result.success).toBe(false)
  })
})
