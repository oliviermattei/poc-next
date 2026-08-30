import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { BUILD_ENV_KEYS, ENV_KEYS, parseEnv } from '@repo/config'
import { loadRootEnv } from '@repo/config/server'

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
  it('démarre l’application une fois copié en `.env`, sans rien y toucher', async () => {
    // La première ligne du fichier dit « copiez ce fichier en `.env` ». Sur un
    // clone vierge c'est le premier geste, et il doit suffire : ce cas charge
    // le fichier par le **vrai** chargeur puis le soumet au **vrai** schéma.
    // Inventorier les noms de clés ne l'attrape pas — une clé déclarée vide
    // (`CLE=`) arrive en chaîne vide, que le schéma refusait.
    const source: Record<string, string | undefined> = {}
    loadRootEnv({ path: ENV_EXAMPLE_PATH, target: source })

    expect(() => parseEnv(source)).not.toThrow()
  })

  it('déclare toutes les variables lues par le schéma', async () => {
    const declared = await readDeclaredKeys()

    expect(declared).toEqual(expect.arrayContaining([...ENV_KEYS]))
  })

  it('documente aussi les variables qui pilotent la garde de build', async () => {
    // Elles ne sont pas dans le schéma — elles sont posées par l'outillage, pas
    // par le développeur — mais elles sont lues par le module de configuration,
    // et `.env.example` est le seul inventaire de ce que le dépôt lit.
    const content = await readFile(ENV_EXAMPLE_PATH, 'utf8')

    for (const key of BUILD_ENV_KEYS) {
      expect(content).toMatch(new RegExp(`\\b${key}\\b`))
    }
  })

  it('ne contient aucune valeur secrète, uniquement des valeurs de développement local', async () => {
    const content = await readFile(ENV_EXAMPLE_PATH, 'utf8')

    expect(content).not.toMatch(/\b(sk_live|pk_live|AKIA)[A-Za-z0-9_-]*/)
    expect(content).not.toMatch(/@(?!localhost|postgres\b)[a-z0-9.-]+\.[a-z]{2,}[:/]/i)
  })
})
