import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defineModule } from '@repo/core'
import { afterAll, describe, expect, it } from 'vitest'

import {
  applyScaffold,
  ScaffoldDirectoryExistsError,
  ScaffoldWriteError,
  type ApplyScaffoldOptions,
} from './apply-scaffold'
import { planScaffold, ScaffoldRefusedError } from './scaffold'
import { scaffoldFiles } from './scaffold-files'

const moduleFor = (id: string) =>
  defineModule({
    id,
    requires: [],
    schema: {},
    migrations: null,
    routes: [],
    navigation: [],
    messages: { fr: {} },
    emails: [],
    webhooks: [],
    jobs: [],
    dataCategories: [],
    retention: {},
    purge: async () => {},
    export: async () => ({}),
  })

const available = [moduleFor('facturation')]

describe('ks scaffold — le plan', () => {
  it('refuse un identifiant déjà connu de l’annuaire, en le nommant', () => {
    expect(() => planScaffold({ available, moduleId: 'facturation' })).toThrowError(
      ScaffoldRefusedError,
    )
    expect(() => planScaffold({ available, moduleId: 'facturation' })).toThrowError(
      /facturation/,
    )
  })

  it('refuse un identifiant mal formé, sans toucher au disque', () => {
    for (const bad of ['Facturation', 'facturation_v2', '../../etc', '-facturation', '']) {
      expect(() => planScaffold({ available, moduleId: bad })).toThrowError(ScaffoldRefusedError)
    }
  })

  it('accepte un identifiant nouveau et bien formé', () => {
    expect(planScaffold({ available, moduleId: 'roadmap' })).toEqual({
      moduleId: 'roadmap',
      packagePath: 'packages/modules/roadmap',
    })
  })
})

describe('ks scaffold — le contenu généré', () => {
  it('rend un contrat conforme aux 13 clés (ADR 007), rien omis', () => {
    const files = scaffoldFiles('roadmap')
    const moduleFile = files.find((file) => file.path === 'src/module.ts')

    expect(moduleFile).toBeDefined();

    for (const key of [
      'id:',
      'requires:',
      'schema:',
      'migrations:',
      'routes:',
      'navigation:',
      'messages:',
      'emails:',
      'webhooks:',
      'jobs:',
      'dataCategories:',
      'retention:',
      'purge:',
      'export:',
    ]) {
      expect(moduleFile?.content).toContain(key)
    }
  })

  it('génère un module qui compile réellement contre le contrat', async () => {
    // Preuve la plus forte qu'un générateur de squelette puisse offrir : le
    // module produit n'est pas relu, il est **exécuté** contre `defineModule`.
    // Un squelette qui ne compilerait pas serait pire qu'aucun squelette.
    const files = scaffoldFiles('roadmap')
    const messages = { fr: JSON.parse(files.find((f) => f.path === 'src/messages/fr.json')!.content) }

    expect(() =>
      defineModule({
        id: 'roadmap',
        requires: [],
        schema: {},
        migrations: null,
        routes: [],
        navigation: [],
        messages,
        emails: [],
        webhooks: [],
        jobs: [],
        dataCategories: [],
        retention: {},
        purge: async () => {},
        export: async () => ({}),
      }),
    ).not.toThrow()
  })
})

describe('ks scaffold — écriture transactionnelle sur un dépôt temporaire', () => {
  const temporaries: string[] = []

  afterAll(async () => {
    for (const root of temporaries) {
      await rm(root, { recursive: true, force: true })
    }
  })

  const temporaryRepo = async (): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), 'ks-scaffold-'))

    temporaries.push(root)

    return root
  }

  it('écrit exactement les fichiers annoncés', async () => {
    const root = await temporaryRepo()
    const plan = planScaffold({ available, moduleId: 'roadmap' })
    const files = scaffoldFiles(plan.moduleId)

    const written = await applyScaffold({ repoRoot: root, packagePath: plan.packagePath, files })

    expect([...written].sort()).toEqual(
      files.map((file) => join('packages/modules/roadmap', file.path)).sort(),
    )
    expect(
      await readFile(join(root, 'packages/modules/roadmap/src/module.ts'), 'utf8'),
    ).toContain("id: 'roadmap'")
  })

  it('refuse d’écraser un module existant, sans rien modifier', async () => {
    const root = await temporaryRepo()
    const target = join(root, 'packages/modules/roadmap')

    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'marker.txt'), 'déjà là\n', 'utf8')

    await expect(
      applyScaffold({
        repoRoot: root,
        packagePath: 'packages/modules/roadmap',
        files: scaffoldFiles('roadmap'),
      }),
    ).rejects.toThrowError(ScaffoldDirectoryExistsError)

    expect(await readFile(join(target, 'marker.txt'), 'utf8')).toBe('déjà là\n')
  })

  it('retire tout le dossier créé si un fichier échoue à s’écrire en cours de route', async () => {
    const root = await temporaryRepo()
    const files = scaffoldFiles('roadmap')
    // Un chemin qui ne peut pas être créé : un fichier existe là où il faudrait
    // un dossier — la panne la plus simple à provoquer sans mock du système de
    // fichiers.
    const poisoned = [
      ...files,
      { path: 'src/module.ts/impossible.ts', content: 'jamais écrit\n' },
    ]

    const options: ApplyScaffoldOptions = {
      repoRoot: root,
      packagePath: 'packages/modules/roadmap',
      files: poisoned,
    }

    await expect(applyScaffold(options)).rejects.toThrowError(ScaffoldWriteError)

    const remains = await access(join(root, 'packages/modules/roadmap'))
      .then(() => true)
      .catch(() => false)

    expect(remains).toBe(false)
  })
})
