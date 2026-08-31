import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { defineModule } from '@repo/core'
import { afterAll, describe, expect, it } from 'vitest'

import { ArtifactSnapshotError, RegenerationFailedError } from './apply'
import { parseArguments } from './arguments'
import { runToggle } from './commands'
import { readEnabledModules } from './features-file'
import { describeModules, renderModuleList } from './modules'
import { missingRequirements, planToggle, ToggleRefusedError } from './toggle'

/**
 * Un seul fichier de test pour les deux commandes et pour l'écriture atomique.
 *
 * Le coût d'une suite se paie **par fichier** (environnement, chargement des
 * modules), pas par assertion : ouvrir un fichier par unité multiplierait le
 * temps d'exécution sans rien prouver de plus. Les groupes ci-dessous portent
 * la distinction.
 *
 * Les modules sont fabriqués ici, jamais importés de `config/features.ts` : les
 * fonctions du CLI **reçoivent** l'annuaire, elles ne le lisent pas. C'est ce
 * qui permet d'éprouver un graphe que le dépôt ne contient pas — un cycle, une
 * chaîne de requis à trois maillons — sans toucher à sa configuration.
 */
const moduleFor = (id: string, requires: readonly string[] = []) =>
  defineModule({
    id,
    requires,
    schema: {},
    migrations: `packages/modules/${id}/migrations`,
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

const available = [
  moduleFor('socle'),
  moduleFor('facturation', ['socle']),
  moduleFor('roadmap', ['facturation']),
]

describe('ks list', () => {
  it('rend chaque module de l’annuaire, son état et ses requis', () => {
    expect(describeModules({ available, enabled: ['socle'] })).toEqual([
      { id: 'socle', enabled: true, requires: [], requiredBy: ['facturation'] },
      { id: 'facturation', enabled: false, requires: ['socle'], requiredBy: ['roadmap'] },
      { id: 'roadmap', enabled: false, requires: ['facturation'], requiredBy: [] },
    ])
  })

  it('distingue les deux états dans la sortie lue par un humain', () => {
    const rendered = renderModuleList(describeModules({ available, enabled: ['socle'] }))

    // La ligne d'un module est celle qui **commence** par son identifiant, pas
    // celle qui le contient : « socle » apparaît aussi dans les requis des
    // autres. Et l'état est comparé **entier** : « activé » est un sous-mot de
    // « désactivé », donc une assertion de sous-chaîne serait verte dans les
    // deux cas — c'est-à-dire aveugle à l'inversion des deux états.
    const fieldsOf = (id: string): readonly string[] =>
      (
        rendered
          .split('\n')
          .find((line) => line.split(/\s+/)[1] === id) ?? ''
      )
        .split(/\s+/)
        .slice(2)

    expect(fieldsOf('socle')[0]).toBe('activé')
    expect(fieldsOf('facturation')[0]).toBe('désactivé')
    // Le requis est nommé : sans lui, « activer facturation » échoue sans que
    // la liste ait prévenu.
    expect(fieldsOf('facturation').join(' ')).toContain('requiert : socle')
  })
})

/**
 * La validation du graphe **n'est pas ici**. `resolveEnabledModules` refuse
 * déjà un requis non activé, un cycle, une auto-référence et un identifiant
 * inconnu, en nommant les modules ; le CLI lui soumet la configuration
 * candidate et traduit son refus. Deux implémentations divergeraient, et ce
 * serait la validation qui perdrait.
 *
 * Les cas ci-dessous sont donc choisis pour ce qu'ils prouvent de la
 * **délégation** — un cycle, qu'aucune ligne du CLI ne sait détecter, y compris.
 */
describe('ks toggle — activation', () => {
  it('active un module dont les requis sont déjà là', () => {
    expect(planToggle({ available, enabled: ['socle'], moduleId: 'facturation' })).toEqual({
      action: 'enable',
      moduleId: 'facturation',
      nextEnabled: ['socle', 'facturation'],
      alsoEnabled: [],
    })
  })

  it('refuse quand un requis manque, en nommant le manquant et la façon de l’activer', () => {
    let message = ''

    try {
      planToggle({ available, enabled: [], moduleId: 'facturation' })
    } catch (error) {
      expect(error).toBeInstanceOf(ToggleRefusedError)
      message = (error as Error).message
    }

    expect(message).toContain('facturation')
    expect(message).toContain('socle')
    expect(message).toContain('--with-requires')
  })

  it('active aussi les requis transitifs quand on l’y autorise, le requis avant son dépendant', () => {
    expect(
      planToggle({ available, enabled: [], moduleId: 'roadmap', withRequirements: true }),
    ).toEqual({
      action: 'enable',
      moduleId: 'roadmap',
      nextEnabled: ['socle', 'facturation', 'roadmap'],
      alsoEnabled: ['socle', 'facturation'],
    })
  })

  it('nomme les requis manquants sans les activer', () => {
    expect(missingRequirements({ available, enabled: [], moduleId: 'roadmap' })).toEqual([
      'socle',
      'facturation',
    ])
    expect(missingRequirements({ available, enabled: ['socle'], moduleId: 'roadmap' })).toEqual([
      'facturation',
    ])
  })

  it('écrit la liste dans l’ordre de l’annuaire, quel que soit l’ordre du fichier (ADR 019)', () => {
    // C'est la moitié « décision » du critère 8. L'ordre de `enabledModules` est
    // canonique : celui de l'annuaire. Un aller-retour, ce sont deux invocations
    // séparées, et à la seconde la position d'origine du module retiré n'existe
    // nulle part — seul un ordre dérivé de l'annuaire rend le fichier identique.
    const independent = [moduleFor('alpha'), moduleFor('beta'), moduleFor('gamma')]

    expect(
      planToggle({ available: independent, enabled: ['alpha', 'gamma'], moduleId: 'beta' })
        .nextEnabled,
    ).toEqual(['alpha', 'beta', 'gamma'])
    // Une liste ordonnée à la main est normalisée, y compris pour les entrées
    // qu'on ne touche pas : c'est ce que le CLI annonce.
    expect(
      planToggle({ available: independent, enabled: ['gamma', 'alpha'], moduleId: 'beta' })
        .nextEnabled,
    ).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('normalise aussi l’ordre en désactivation', () => {
    const independent = [moduleFor('alpha'), moduleFor('beta'), moduleFor('gamma')]

    expect(
      planToggle({
        available: independent,
        enabled: ['gamma', 'beta', 'alpha'],
        moduleId: 'beta',
      }).nextEnabled,
    ).toEqual(['alpha', 'gamma'])
  })

  it('refuse un cycle, que le CLI ne sait pas détecter lui-même', () => {
    // Preuve de la délégation : aucune ligne du CLI ne cherche de cycle. Si
    // cette assertion tombe, c'est que la validation a été réécrite ici.
    const cyclic = [moduleFor('a', ['b']), moduleFor('b', ['a'])]

    expect(() =>
      planToggle({ available: cyclic, enabled: [], moduleId: 'a', withRequirements: true }),
    ).toThrowError(/Cycle/)
  })

  it('refuse un identifiant que l’annuaire ne contient pas, en le nommant', () => {
    expect(() => planToggle({ available, enabled: [], moduleId: 'inexistant' })).toThrowError(
      /inexistant/,
    )
  })
})

describe('ks toggle — désactivation', () => {
  it('refuse de désactiver un module du socle, en le nommant', () => {
    // Le socle n'était qu'une phrase de `config/features.ts` : aucun module ne
    // déclarant `requires: ['auth']`, rien n'empêchait de le couper. Le CLI ne
    // rejoue pas la règle, il soumet la configuration candidate à
    // `resolveEnabledModules` — le socle voyage donc avec elle (ADR 021).
    expect(() =>
      planToggle({
        available,
        enabled: ['socle', 'facturation'],
        required: ['socle'],
        moduleId: 'socle',
      }),
    ).toThrowError(/socle et ne peut pas être désactivé/)
  })

  it('laisse basculer ce qui n’est pas du socle', () => {
    expect(
      planToggle({
        available,
        enabled: ['socle', 'facturation'],
        required: ['socle'],
        moduleId: 'facturation',
      }).nextEnabled,
    ).toEqual(['socle'])
  })

  it('désactive un module dont personne d’activé ne dépend', () => {
    expect(
      planToggle({ available, enabled: ['socle', 'facturation'], moduleId: 'facturation' }),
    ).toEqual({
      action: 'disable',
      moduleId: 'facturation',
      nextEnabled: ['socle'],
      alsoEnabled: [],
    })
  })

  it('refuse quand un module activé en dépend, en nommant le dépendant', () => {
    let message = ''

    try {
      planToggle({ available, enabled: ['socle', 'facturation'], moduleId: 'socle' })
    } catch (error) {
      expect(error).toBeInstanceOf(ToggleRefusedError)
      message = (error as Error).message
    }

    expect(message).toContain('facturation')
    expect(message).toContain('socle')
    // La phrase déléguée dit « n'est pas activé dans config/features.ts » d'un
    // module qui l'est encore : elle décrit la configuration **candidate**. Le
    // refus doit le dire, sinon il est contre-factuel à la lettre.
    expect(message).toContain('configuration candidate')
  })

  it('n’affirme pas une cause qu’il n’a pas vérifiée', () => {
    // Ici, aucun module activé ne dépend de « alpha » : la configuration
    // candidate est refusée pour une tout autre raison. Un refus qui annonce
    // systématiquement « un module activé en dépend » envoie chercher au mauvais
    // endroit, et c'est la seule information que l'utilisateur a.
    const bancal = [moduleFor('alpha'), moduleFor('beta', ['fantome'])]
    let message = ''

    try {
      planToggle({ available: bancal, enabled: ['alpha', 'beta'], moduleId: 'alpha' })
    } catch (error) {
      expect(error).toBeInstanceOf(ToggleRefusedError)
      message = (error as Error).message
    }

    expect(message).toContain('fantome')
    expect(message).not.toMatch(/dépend/)
  })
})

/**
 * Tout ce qui écrit s'exécute sur un **dépôt temporaire** : une copie de
 * `config/features.ts` et du dossier des barils dans un répertoire jetable.
 * Un test qui régénérerait le dépôt qui l'exécute rendrait la suite
 * destructrice, et il faudrait le désarmer le jour où il servirait.
 */
describe('ks toggle — écriture sur un dépôt temporaire', () => {
  const FEATURES = [
    '/**',
    ' * Les modules du projet — le fichier que le propriétaire édite.',
    ' */',
    'export const availableModules = [socleModule, facturationModule, roadmapModule] as const',
    '',
    '/** Les modules activés. */',
    "export const enabledModules = ['socle'] as const satisfies readonly AvailableModuleId[]",
    '',
  ].join('\n')

  const BARREL = '// baril versionné\nexport { socleTable } from \'@repo/module-socle\'\n'

  interface TemporaryRepo {
    readonly root: string
    readonly featuresPath: string
    readonly generatedPath: string
    readonly features: () => Promise<string>
    readonly barrels: () => Promise<readonly string[]>
  }

  const temporaryRepo = async (features: string = FEATURES): Promise<TemporaryRepo> => {
    const root = await mkdtemp(join(tmpdir(), 'ks-cli-'))
    const featuresPath = join(root, 'config', 'features.ts')
    const generatedPath = join(root, 'generated', 'schema')

    await mkdir(dirname(featuresPath), { recursive: true })
    await mkdir(generatedPath, { recursive: true })
    await writeFile(featuresPath, features, 'utf8')
    await writeFile(join(generatedPath, 'socle.ts'), BARREL, 'utf8')

    temporaries.push(root)

    return {
      root,
      featuresPath,
      generatedPath,
      features: () => readFile(featuresPath, 'utf8'),
      barrels: async () => (await readdir(generatedPath)).sort(),
    }
  }

  const temporaries: string[] = []

  afterAll(async () => {
    for (const root of temporaries) {
      await rm(root, { recursive: true, force: true })
    }
  })

  /**
   * L'environnement du CLI, réduit à ce qui sort du processus : régénérer,
   * migrer, demander, écrire une ligne. Les remplacer est ce qui permet
   * d'observer qu'une migration **n'a pas** été appliquée — un effet dont
   * l'absence est le critère.
   */
  const environmentFor = (
    repo: TemporaryRepo,
    overrides: {
      readonly regenerate?: () => Promise<void>
      readonly confirm?: (question: string) => Promise<boolean>
    } = {},
  ) => {
    const lines: string[] = []
    const migrated: string[] = []
    const questions: string[] = []

    return {
      lines,
      migrated,
      questions,
      environment: {
        featuresPath: repo.featuresPath,
        generatedPaths: [repo.generatedPath],
        regenerate:
          overrides.regenerate ??
          (async () => {
            // Ce que fait la vraie régénération : réécrire le dossier des
            // barils depuis la configuration.
            const enabled = readEnabledModules(await repo.features())

            await rm(repo.generatedPath, { recursive: true, force: true })
            await mkdir(repo.generatedPath, { recursive: true })

            for (const id of enabled) {
              await writeFile(
                join(repo.generatedPath, `${id}.ts`),
                `// baril versionné\nexport { ${id}Table } from '@repo/module-${id}'\n`,
                'utf8',
              )
            }
          }),
        applyMigrations: async () => {
          migrated.push('appliquées')
        },
        confirm: async (question: string) => {
          questions.push(question)

          return overrides.confirm?.(question) ?? false
        },
        print: (line: string) => lines.push(line),
      },
    }
  }

  it('active un module, écrit la configuration et régénère les barils', async () => {
    const repo = await temporaryRepo()
    const harness = environmentFor(repo)

    const outcome = await runToggle({
      available,
      request: { moduleId: 'facturation', interactive: false },
      environment: harness.environment,
    })

    expect(outcome.action).toBe('enable')
    expect(readEnabledModules(await repo.features())).toEqual(['socle', 'facturation'])
    expect(await repo.barrels()).toEqual(['facturation.ts', 'socle.ts'])
  })

  it('restaure la configuration **et** les barils quand la régénération échoue', async () => {
    const repo = await temporaryRepo()
    const before = await repo.features()
    const harness = environmentFor(repo, {
      regenerate: async () => {
        // Une régénération réelle écrit avant d'échouer : c'est ce demi-état
        // que la restauration doit effacer.
        await writeFile(join(repo.generatedPath, 'facturation.ts'), '// à moitié écrit\n', 'utf8')

        throw new Error('schéma invalide : 0 tables')
      },
    })

    await expect(
      runToggle({
        available,
        request: { moduleId: 'facturation', interactive: false },
        environment: harness.environment,
      }),
    ).rejects.toThrowError(RegenerationFailedError)

    // Octet pour octet : le dépôt n'est jamais laissé entre deux états.
    expect(await repo.features()).toBe(before)
    expect(await repo.barrels()).toEqual(['socle.ts'])
  })

  it('refuse sans rien écrire quand un dossier d’artefacts existe mais ne peut pas être lu', async () => {
    // Un dossier absent et un dossier illisible ne sont pas le même fait : le
    // premier se restaure en le supprimant, le second **contient peut-être le SQL
    // versionné d'un module**. Les confondre transformerait la restauration en
    // suppression de migrations, ce qu'ADR 016 interdit. Le toggle refuse donc
    // avant d'écrire, plutôt que de photographier un dossier qu'il n'a pas lu.
    const repo = await temporaryRepo()
    const before = await repo.features()
    const unreadable = join(repo.root, 'packages', 'modules', 'socle', 'migrations')

    await mkdir(dirname(unreadable), { recursive: true })
    await writeFile(unreadable, 'ce chemin existe, mais ce n’est pas un dossier\n', 'utf8')

    const harness = environmentFor(repo)

    await expect(
      runToggle({
        available,
        request: { moduleId: 'facturation', interactive: false },
        environment: { ...harness.environment, generatedPaths: [repo.generatedPath, unreadable] },
      }),
    ).rejects.toThrowError(ArtifactSnapshotError)

    expect(await repo.features()).toBe(before)
    // Rien n'a été touché : ni la configuration, ni le chemin illisible.
    expect(await readFile(unreadable, 'utf8')).toContain('ce chemin existe')
  })

  it('refuse sans rien écrire quand un requis manque et qu’on n’est pas interactif', async () => {
    const repo = await temporaryRepo()
    const before = await repo.features()
    const harness = environmentFor(repo)

    await expect(
      runToggle({
        available,
        request: { moduleId: 'roadmap', interactive: false },
        environment: harness.environment,
      }),
    ).rejects.toThrowError(ToggleRefusedError)

    expect(await repo.features()).toBe(before)
    expect(await repo.barrels()).toEqual(['socle.ts'])
    // Un refus ne pose pas de question : hors terminal, personne ne répondrait.
    expect(harness.questions).toEqual([])
  })

  it('propose d’activer le requis manquant en mode interactif, et le fait si on accepte', async () => {
    const repo = await temporaryRepo()
    const harness = environmentFor(repo, { confirm: async () => true })

    const outcome = await runToggle({
      available,
      request: { moduleId: 'roadmap', interactive: true },
      environment: harness.environment,
    })

    expect(outcome.alsoEnabled).toEqual(['facturation'])
    expect(readEnabledModules(await repo.features())).toEqual(['socle', 'facturation', 'roadmap'])
    expect(harness.questions.join('\n')).toContain('facturation')
  })

  it('génère les migrations et **propose** de les appliquer, sans y toucher', async () => {
    const repo = await temporaryRepo()
    const harness = environmentFor(repo)

    const outcome = await runToggle({
      available,
      request: { moduleId: 'facturation', interactive: false },
      environment: harness.environment,
    })

    // Le seul effet qu'une commande de configuration ne doit jamais avoir sans
    // qu'on le lui demande : toucher la base.
    expect(harness.migrated).toEqual([])
    expect(outcome.migrationsApplied).toBe(false)
    expect(harness.lines.join('\n')).toContain('pnpm db:migrate')
  })

  it('applique les migrations quand on l’y autorise explicitement', async () => {
    const repo = await temporaryRepo()
    const harness = environmentFor(repo)

    const outcome = await runToggle({
      available,
      request: { moduleId: 'facturation', interactive: false, applyMigrations: true },
      environment: harness.environment,
    })

    expect(harness.migrated).toEqual(['appliquées'])
    expect(outcome.migrationsApplied).toBe(true)
  })

  it('informe que la désactivation conserve tables et données, et n’offre aucun nettoyage', async () => {
    const repo = await temporaryRepo()
    const harness = environmentFor(repo)

    await runToggle({
      available,
      request: { moduleId: 'socle', interactive: false },
      environment: harness.environment,
    })

    const output = harness.lines.join('\n')

    expect(output).toContain('conservé')
    // Aucune commande de nettoyage, sous aucun nom : ce serait `eject`, au
    // cimetière du PRD (ADR 016).
    expect(output).not.toMatch(/supprim|nettoy|purge|drop\b/i)
    expect(harness.migrated).toEqual([])
  })

  it('deux toggles inverses laissent le fichier commenté identique, sur une entrée **non finale**', async () => {
    // Le critère 8 de bout en bout, sur le seul cas qui le distingue d'une
    // coïncidence : l'entrée basculée n'est ni la dernière ni la seule, et le
    // fichier porte les commentaires du propriétaire.
    const commented = [
      '/** Les modules activés. */',
      'export const enabledModules = [',
      '  // le socle, jamais coupé',
      "  'alpha',",
      "  'beta',",
      '  // la vitrine publique du produit',
      "  'gamma',",
      '] as const satisfies readonly AvailableModuleId[]',
      '',
    ].join('\n')

    const independent = [moduleFor('alpha'), moduleFor('beta'), moduleFor('gamma')]
    const repo = await temporaryRepo(commented)
    const harness = environmentFor(repo)

    await runToggle({
      available: independent,
      request: { moduleId: 'beta', interactive: false },
      environment: harness.environment,
    })

    // L'état intermédiaire est vérifié : sans lui, deux écritures inertes se
    // compenseraient et le test serait vert sans rien prouver.
    expect(readEnabledModules(await repo.features())).toEqual(['alpha', 'gamma'])

    await runToggle({
      available: independent,
      request: { moduleId: 'beta', interactive: false },
      environment: harness.environment,
    })

    expect(await repo.features()).toBe(commented)
  })

  it('ne perd pas un dossier de migrations parce qu’un de ses fichiers est illisible', async () => {
    // Un `ENOENT` venu d'un **fichier** ne dit pas que le dossier est absent. Le
    // prendre pour tel fait photographier « absent » un dossier qui existe, et la
    // restauration le supprime alors définitivement — sur un dossier
    // `migrations`, c'est le SQL versionné d'un module, qui ne se recrée pas
    // (ADR 016). Seule la lecture de premier niveau décide de l'absence.
    const repo = await temporaryRepo()
    const before = await repo.features()
    const migrations = join(repo.root, 'packages', 'modules', 'socle', 'migrations')

    await mkdir(migrations, { recursive: true })
    await writeFile(join(migrations, '0000_init.sql'), '-- SQL versionné\n', 'utf8')
    // Un lien cassé : le dossier se liste, mais ce fichier ne se lit pas.
    await symlink(join(migrations, 'absent.sql'), join(migrations, '0001_lien.sql'))

    const harness = environmentFor(repo, {
      regenerate: async () => {
        throw new Error('schéma invalide : 0 tables')
      },
    })

    await expect(
      runToggle({
        available,
        request: { moduleId: 'facturation', interactive: false },
        environment: { ...harness.environment, generatedPaths: [repo.generatedPath, migrations] },
      }),
    ).rejects.toThrowError(ArtifactSnapshotError)

    expect(await repo.features()).toBe(before)
    expect(await readdir(migrations)).toContain('0000_init.sql')
  })

  it('annonce la normalisation de l’ordre, en nommant le fichier et la raison', async () => {
    // ADR 019 : l'ordre est canonique, donc une liste ordonnée à la main est
    // réordonnée à la première bascule. Le faire en silence sur un fichier qu'on
    // édite à la main est exactement ce que l'ADR interdit.
    const independent = [moduleFor('alpha'), moduleFor('beta'), moduleFor('gamma')]
    const repo = await temporaryRepo(
      "export const enabledModules = ['gamma', 'alpha'] as const\n",
    )
    const harness = environmentFor(repo)

    const outcome = await runToggle({
      available: independent,
      request: { moduleId: 'beta', interactive: false },
      environment: harness.environment,
    })

    expect(readEnabledModules(await repo.features())).toEqual(['alpha', 'beta', 'gamma'])
    expect(outcome.reordered).toEqual(['gamma', 'alpha'])

    const output = harness.lines.join('\n')

    expect(output).toContain('config/features.ts')
    expect(output).toContain('ordre')
    expect(output).toContain('gamma')
  })

  it('dit que le retrait a emporté le commentaire du propriétaire', async () => {
    // La limite du CLI, dite là où l'utilisateur la subit : le commentaire part
    // avec son entrée et une réactivation ne le rendra pas. Ne pas le dire, c'est
    // lui faire découvrir la perte à la relecture, sans savoir quand elle a eu
    // lieu.
    const independent = [moduleFor('alpha'), moduleFor('beta')]
    const repo = await temporaryRepo(
      [
        'export const enabledModules = [',
        "  'alpha',",
        '  // celui-ci sert la démo du lundi',
        "  'beta',",
        '] as const',
        '',
      ].join('\n'),
    )
    const harness = environmentFor(repo)

    const outcome = await runToggle({
      available: independent,
      request: { moduleId: 'beta', interactive: false },
      environment: harness.environment,
    })

    expect(outcome.droppedComments).toEqual(['beta'])
    expect(await repo.features()).not.toContain('démo du lundi')

    const output = harness.lines.join('\n')

    expect(output).toContain('commentaire')
    expect(output).toContain('beta')
  })

  it('deux toggles inverses laissent le dépôt exactement dans son état d’origine', async () => {
    const repo = await temporaryRepo()
    const before = await repo.features()
    const harness = environmentFor(repo)

    for (let pass = 0; pass < 2; pass += 1) {
      await runToggle({
        available,
        request: { moduleId: 'facturation', interactive: false },
        environment: harness.environment,
      })
    }

    expect(await repo.features()).toBe(before)
    expect(await repo.barrels()).toEqual(['socle.ts'])
  })
})

describe('analyse des arguments', () => {
  it('lit la commande, le module et les drapeaux', () => {
    expect(parseArguments(['toggle', 'facturation', '--with-requires', '--json'])).toEqual({
      command: 'toggle',
      moduleId: 'facturation',
      json: true,
      withRequirements: true,
      applyMigrations: false,
    })
  })

  it('refuse un drapeau inconnu au lieu de l’ignorer', () => {
    // Ignorer une faute de frappe ferait exécuter autre chose que ce que
    // l'appelant — humain ou agent — croit avoir demandé.
    expect(() => parseArguments(['toggle', 'facturation', '--with-requiers'])).toThrowError(
      /--with-requiers/,
    )
  })

  it('rend l’aide plutôt que de la refuser comme une option inconnue', () => {
    // « --help » est le premier geste de quiconque découvre une commande. Le
    // refuser en code 1 apprend que l'outil est cassé, pas comment s'en servir.
    expect(parseArguments(['--help']).command).toBe('help')
    expect(parseArguments(['-h']).command).toBe('help')
    expect(parseArguments(['toggle', 'facturation', '--help']).command).toBe('help')
  })

  it('refuse `toggle` sans module', () => {
    expect(() => parseArguments(['toggle'])).toThrowError(/module/)
  })
})
