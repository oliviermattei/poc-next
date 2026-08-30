import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ENV_KEYS } from '@repo/config'

const ENV_EXAMPLE_PATH = fileURLToPath(new URL('../.env.example', import.meta.url))

const readDeclaredKeys = async (): Promise<string[]> => {
  const content = await readFile(ENV_EXAMPLE_PATH, 'utf8')

  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split('=')[0]?.trim() ?? '')
    .filter((key) => key.length > 0)
}

describe('.env.example', () => {
  it('déclare toutes les variables lues par le schéma', async () => {
    const declared = await readDeclaredKeys()

    expect(declared).toEqual(expect.arrayContaining([...ENV_KEYS]))
  })

  it('ne contient aucune valeur secrète, uniquement des valeurs de développement local', async () => {
    const content = await readFile(ENV_EXAMPLE_PATH, 'utf8')

    expect(content).not.toMatch(/\b(sk_live|pk_live|AKIA)[A-Za-z0-9_-]*/)
    expect(content).not.toMatch(/@(?!localhost|postgres\b)[a-z0-9.-]+\.[a-z]{2,}[:/]/i)
  })
})
