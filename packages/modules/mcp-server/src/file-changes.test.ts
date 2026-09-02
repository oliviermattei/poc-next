import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { trackFileChanges } from './file-changes'

const temporaries: string[] = []

afterAll(async () => {
  for (const root of temporaries) {
    await rm(root, { recursive: true, force: true })
  }
})

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'mcp-file-changes-'))

  temporaries.push(root)

  return root
}

describe('trackFileChanges', () => {
  it('rend le fichier changé, chemin relatif à la racine', async () => {
    const root = await temporaryRoot()
    const file = join(root, 'config', 'features.ts')

    await mkdir(join(root, 'config'), { recursive: true })
    await writeFile(file, 'avant\n', 'utf8')

    const { modifiedFiles } = await trackFileChanges(root, [file], async () => {
      await writeFile(file, 'après\n', 'utf8')
    })

    expect(modifiedFiles).toEqual([join('config', 'features.ts')])
  })

  it('n’annonce rien quand l’action ne touche à rien de suivi', async () => {
    const root = await temporaryRoot()
    const file = join(root, 'config', 'features.ts')

    await mkdir(join(root, 'config'), { recursive: true })
    await writeFile(file, 'stable\n', 'utf8')

    const { modifiedFiles } = await trackFileChanges(root, [file], async () => {
      await writeFile(join(root, 'ailleurs.txt'), 'non suivi\n', 'utf8')
    })

    expect(modifiedFiles).toEqual([])
  })

  it('voit un fichier nouveau apparaître dans un dossier suivi', async () => {
    const root = await temporaryRoot()
    const dir = join(root, 'generated', 'schema')

    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'existant.ts'), '// existant\n', 'utf8')

    const { modifiedFiles } = await trackFileChanges(root, [dir], async () => {
      await writeFile(join(dir, 'nouveau.ts'), '// nouveau\n', 'utf8')
    })

    expect(modifiedFiles).toEqual([join('generated', 'schema', 'nouveau.ts')])
  })

  it('voit un fichier disparaître d’un dossier suivi', async () => {
    const root = await temporaryRoot()
    const dir = join(root, 'packages', 'modules', 'billing', 'migrations')

    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '0000_init.sql'), '-- init\n', 'utf8')

    const { modifiedFiles } = await trackFileChanges(root, [dir], async () => {
      await rm(join(dir, '0000_init.sql'))
    })

    expect(modifiedFiles).toEqual([join('packages', 'modules', 'billing', 'migrations', '0000_init.sql')])
  })
})
