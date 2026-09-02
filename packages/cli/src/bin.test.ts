import { execFile, spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { afterAll, describe, expect, it } from 'vitest'

/**
 * `src/bin.ts` est le **point de composition** : c'est lui qui remonte jusqu'à
 * la racine du dépôt, lit `config/features.ts`, décide sur quoi porte la
 * transaction, lance les sous-processus et traduit tout ça en code de sortie.
 * Rien de tout cela n'est unitaire — et c'est précisément pour ça qu'il faut
 * l'éprouver de bout en bout : retirer les dossiers de migrations du câblage de
 * `generatedPaths`, c'est retirer la moitié de la promesse d'atomicité sans
 * qu'aucun test unitaire ne bouge.
 *
 * Le binaire est donc lancé pour de vrai, sur un **dépôt temporaire** dont
 * `config/features.ts` ne dépend de rien : un annuaire écrit à la main, deux
 * modules, et des scripts `db:generate` / `db:migrate` que le test contrôle.
 * Jamais contre le dépôt courant — un test qui régénère le dépôt qui l'exécute
 * rend la suite destructrice.
 */
const KS = fileURLToPath(new URL('../bin/ks.mjs', import.meta.url))

interface Execution {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

const ks = (args: readonly string[], cwd: string): Promise<Execution> =>
  new Promise((accept, reject) => {
    // `stdin` fermé : `process.stdin.isTTY` est faux, donc le mode non
    // interactif — celui d'un agent et de la CI (ADR 013).
    const child = spawn(process.execPath, [KS, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
    child.on('error', reject)
    child.on('close', (code) => accept({ code: code ?? -1, stdout, stderr }))
  })

const FEATURES = [
  '/** Dépôt temporaire : l’annuaire est écrit à la main, sans dépendance. */',
  'export const availableModules = [',
  "  { id: 'alpha', requires: [], migrations: 'packages/modules/alpha/migrations' },",
  "  { id: 'beta', requires: [], migrations: 'packages/modules/beta/migrations' },",
  '] as const',
  '',
  '/** Les modules activés. */',
  "export const enabledModules = ['alpha'] as const",
  '',
].join('\n')

const MIGRATION = '-- migration versionnée du module beta\nCREATE TABLE beta_items (id text);\n'

interface TemporaryRepo {
  readonly root: string
  readonly featuresPath: string
  readonly migrationsPath: string
  readonly features: () => Promise<string>
  readonly migrations: () => Promise<readonly string[]>
}

const temporaries: string[] = []

/** Le dépôt jetable, et le script `db:generate` que le test lui donne. */
const temporaryRepo = async (generate: string): Promise<TemporaryRepo> => {
  const root = await mkdtemp(join(tmpdir(), 'ks-bin-'))
  const featuresPath = join(root, 'config', 'features.ts')
  const migrationsPath = join(root, 'packages', 'modules', 'beta', 'migrations')

  temporaries.push(root)

  await mkdir(dirname(featuresPath), { recursive: true })
  await mkdir(join(root, 'generated', 'schema'), { recursive: true })
  await mkdir(migrationsPath, { recursive: true })
  await mkdir(join(root, 'apps', 'web'), { recursive: true })
  await writeFile(featuresPath, FEATURES, 'utf8')
  await writeFile(join(migrationsPath, '0000_init.sql'), MIGRATION, 'utf8')
  await writeFile(join(root, 'generate.mjs'), generate, 'utf8')
  await writeFile(
    join(root, 'migrate.mjs'),
    "console.log('migrations appliquées sur la base')\n",
    'utf8',
  )
  await writeFile(
    join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: 'depot-temporaire',
        private: true,
        type: 'module',
        scripts: { 'db:generate': 'node generate.mjs', 'db:migrate': 'node migrate.mjs' },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  return {
    root,
    featuresPath,
    migrationsPath,
    features: () => readFile(featuresPath, 'utf8'),
    migrations: async () => (await readdir(migrationsPath)).sort(),
  }
}

afterAll(async () => {
  for (const root of temporaries) {
    await rm(root, { recursive: true, force: true })
  }
})

/** Une régénération qui réussit, bruyante — comme `drizzle-kit` l'est. */
const NOISY_GENERATE = [
  "import { writeFile } from 'node:fs/promises'",
  "console.log('drizzle-kit: 2 tables, 0 enums')",
  "await writeFile('generated/schema/beta.ts', '// baril régénéré\\n', 'utf8')",
  '',
].join('\n')

/** Une régénération qui écrit **avant** d’échouer, y compris dans les migrations. */
const FAILING_GENERATE = [
  "import { writeFile } from 'node:fs/promises'",
  "console.log('drizzle-kit: 2 tables, 0 enums')",
  "await writeFile('generated/schema/beta.ts', '// baril à moitié écrit\\n', 'utf8')",
  "await writeFile('packages/modules/beta/migrations/0001_partiel.sql', '-- à moitié écrit\\n', 'utf8')",
  "console.error('schéma invalide : 0 tables')",
  'process.exit(1)',
  '',
].join('\n')

describe('ks, lancé comme un utilisateur le lance', () => {
  it('rend sur stdout du JSON et rien d’autre, en mode --json', async () => {
    // La promesse d'ADR 013 : « sortie lisible par une machine ». La prose
    // française et le bruit du sous-processus doivent sortir par stderr, sinon
    // l'agent qui appelle la commande pour **agir** ne peut rien en faire.
    const repo = await temporaryRepo(NOISY_GENERATE)
    const result = await ks(['toggle', 'beta', '--json', '--apply-migrations'], repo.root)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      action: 'enable',
      moduleId: 'beta',
      enabled: ['alpha', 'beta'],
      migrationsApplied: true,
    })
    // Le bruit existe bel et bien : il a été dérouté, pas supprimé.
    expect(result.stderr).toContain('drizzle-kit')
    expect(result.stderr).toContain('Migrations appliquées')
  }, 30_000)

  it('restaure les migrations des modules quand la régénération échoue', async () => {
    // Le câblage de `generatedPaths` **est** la portée de la transaction. En
    // retirer les dossiers de migrations laisserait ici un `0001_partiel.sql`
    // derrière un toggle refusé — du SQL versionné que personne n'a écrit.
    const repo = await temporaryRepo(FAILING_GENERATE)
    const before = await repo.features()

    const result = await ks(['toggle', 'beta'], repo.root)

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('régénération a échoué')
    expect(await repo.features()).toBe(before)
    expect(await repo.migrations()).toEqual(['0000_init.sql'])
    expect(await readFile(join(repo.migrationsPath, '0000_init.sql'), 'utf8')).toBe(MIGRATION)
    expect(await readdir(join(repo.root, 'generated', 'schema'))).toEqual([])
  }, 30_000)

  it('répond depuis un sous-dossier du dépôt, en remontant jusqu’à sa racine', async () => {
    // `ks` doit dire la même chose depuis `apps/web` que depuis la racine :
    // c'est le dépôt où l'on travaille qu'il édite, pas celui qui l'héberge.
    const repo = await temporaryRepo(NOISY_GENERATE)
    const result = await ks(['list', '--json'], join(repo.root, 'apps', 'web'))

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([
      { id: 'alpha', enabled: true, required: false, requires: [], requiredBy: [] },
      { id: 'beta', enabled: false, required: false, requires: [], requiredBy: [] },
    ])
  }, 30_000)

  it('refuse de couper un module du socle, sans rien écrire', async () => {
    // Le bout de la chaîne : c'est `bin.ts` qui lit `requiredModules` dans
    // `config/features.ts` et le fait suivre jusqu'à la validation. Sans cette
    // lecture, la règle serait armée dans `@repo/core` et jamais invoquée par
    // la commande qui peut la violer (ADR 021).
    const repo = await temporaryRepo(NOISY_GENERATE)

    await writeFile(
      repo.featuresPath,
      `${FEATURES}\nexport const requiredModules = ['alpha'] as const\n`,
      'utf8',
    )

    const refused = await ks(['toggle', 'alpha'], repo.root)

    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('alpha')
    expect(refused.stderr).toContain('socle')
    // Et le fichier n'a pas bougé : le refus a lieu avant l'écriture.
    expect(await repo.features()).toContain("export const enabledModules = ['alpha'] as const")

    // Et la liste l'annonce **avant** le refus : c'est le même `bin.ts` qui lit
    // `requiredModules`, et l'oublier pour `list` laisserait la règle
    // découvrable seulement en se faisant jeter.
    const listed = await ks(['list', '--json'], repo.root)

    expect(JSON.parse(listed.stdout)).toEqual([
      { id: 'alpha', enabled: true, required: true, requires: [], requiredBy: [] },
      { id: 'beta', enabled: false, required: false, requires: [], requiredBy: [] },
    ])
  }, 30_000)

  it('affiche l’aide en code 0, et refuse une invocation inconnue en code 1', async () => {
    const repo = await temporaryRepo(NOISY_GENERATE)
    const help = await ks(['--help'], repo.root)
    const unknown = await ks(['toggle', 'beta', '--with-requiers'], repo.root)

    expect(help.code).toBe(0)
    expect(help.stdout).toContain('Usage : ks')
    expect(unknown.code).toBe(1)
    expect(unknown.stderr).toContain('--with-requiers')
    // Rien n'a été basculé par une invocation refusée.
    expect(await repo.features()).toBe(FEATURES)
  }, 30_000)
})

const execFileAsync = promisify(execFile)

/** `ks scaffold` pose la garde de dépôt propre (ADR 041) : il lui faut un vrai dépôt git. */
const gitInit = async (root: string): Promise<void> => {
  await execFileAsync('git', ['init', '--quiet'], { cwd: root })
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root })
  await execFileAsync('git', ['add', '.'], { cwd: root })
  await execFileAsync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: root })
}

describe('ks scaffold, lancé comme un utilisateur le lance', () => {
  it('génère le squelette et l’annonce en JSON, fichier par fichier', async () => {
    const repo = await temporaryRepo(NOISY_GENERATE)

    await gitInit(repo.root)

    const result = await ks(['scaffold', 'roadmap', '--json'], repo.root)

    expect(result.code).toBe(0)

    const parsed = JSON.parse(result.stdout) as { moduleId: string; written: string[] }

    expect(parsed.moduleId).toBe('roadmap')
    expect(parsed.written).toContain(join('packages', 'modules', 'roadmap', 'src', 'module.ts'))
    expect(
      await readFile(join(repo.root, 'packages', 'modules', 'roadmap', 'src', 'module.ts'), 'utf8'),
    ).toContain("id: 'roadmap'")
  }, 30_000)

  it('refuse sur un dépôt aux modifications non commitées, sans rien créer', async () => {
    const repo = await temporaryRepo(NOISY_GENERATE)

    await gitInit(repo.root)
    await writeFile(join(repo.root, 'oubli.txt'), 'travail en cours\n', 'utf8')

    const result = await ks(['scaffold', 'roadmap'], repo.root)

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('non commitées')

    const created = await readdir(join(repo.root, 'packages', 'modules')).catch(() => [])

    expect(created).not.toContain('roadmap')
  }, 30_000)

  it('refuse un identifiant déjà déclaré dans l’annuaire, en le nommant', async () => {
    const repo = await temporaryRepo(NOISY_GENERATE)

    await gitInit(repo.root)

    const result = await ks(['scaffold', 'alpha'], repo.root)

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('alpha')
  }, 30_000)
})
