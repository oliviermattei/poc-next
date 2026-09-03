import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { BUILD_ENV_KEYS, ENV_KEYS } from '@repo/config'
import { pgTable, text } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { availableModules, enabledModules, requiredModules } from '../config/features'
import { minimalProfile } from '../config/profiles'
import {
  applyProfile,
  assertNoTablesOfCutModules,
  assertProfileWasApplied,
  assertSuiteCounts,
  assertSweepIsNotEmpty,
  assertWorkingTreeUnchanged,
  cloneEnvironment,
  CLONE_STRIPPED_ENV_KEYS,
  EXECUTED_FLOOR,
  MINIMAL_PROFILE_TRACES_DIRECTORY,
  moduleTableNames,
  parseModuleProfile,
  suiteReport,
  sweepProfile,
  sweepReport,
  type ProfileModule,
} from '../scripts/minimal-profile-rules'

/**
 * **La recette du profil minimal** (s26) — tout ce qui s'éprouve sans base ni
 * navigateur.
 *
 * Un seul fichier, comme partout dans ce dépôt : le coût d'une suite est dominé
 * par le fichier, pas par l'assertion.
 */

const ANNUAIRE = [
  { id: 'auth' },
  { id: 'alpha' },
  { id: 'beta' },
] as const

describe('le profil, à sa frontière (critère 1)', () => {
  it('refuse un identifiant que l’annuaire ne connaît pas, en le nommant', () => {
    expect(() =>
      parseModuleProfile(
        { id: 'minimal', cut: ['alpha', 'gamma'] },
        { available: ANNUAIRE, required: ['auth'] },
      ),
    ).toThrow(/gamma/)
  })

  it('refuse de couper un module du socle, en le nommant', () => {
    expect(() =>
      parseModuleProfile(
        { id: 'minimal', cut: ['auth'] },
        { available: ANNUAIRE, required: ['auth'] },
      ),
    ).toThrow(/auth/)
  })

  it('accepte un profil vide : il vaut le profil complet', () => {
    expect(
      parseModuleProfile({ id: 'complet', cut: [] }, { available: ANNUAIRE, required: ['auth'] }),
    ).toEqual({ id: 'complet', cut: [] })
  })

  it('accepte le profil livré, confronté à l’annuaire réel du dépôt', () => {
    // Le seul cas de ce bloc qui porte sur `config/profiles.ts` lui-même : une
    // faute de frappe du propriétaire y rougit ici, et pas au bout des dix
    // minutes de la recette.
    expect(
      parseModuleProfile(minimalProfile, {
        available: [...availableModules],
        required: [...requiredModules],
      }).cut,
    ).toEqual([...minimalProfile.cut])
  })
})

/**
 * L'annuaire d'essai des cas ci-dessous.
 *
 * Il porte volontairement un module que **le profil ne nomme pas** et que la
 * configuration n'active pas : c'est le cas qui distingue un harnais qui balaie
 * « ce que le profil a coupé » d'un harnais qui balaie « ce qui n'est pas
 * activé ». Le dépôt en contient un pour de vrai — `demo-disabled` —, et un
 * harnais aveugle à celui-là serait déjà faux aujourd'hui.
 */
const aTable = (name: string) => pgTable(name, { id: text('id').primaryKey() })

const aModule = (
  id: string,
  parts: Partial<Omit<ProfileModule, 'id'>> = {},
): ProfileModule => ({
  id,
  requires: [],
  routes: [],
  navigation: [],
  schema: {},
  ...parts,
})

const ESSAI = [
  aModule('auth', { routes: [{ method: 'GET', path: '/auth/me' }], schema: { user: aTable('auth_user') } }),
  aModule('alpha', {
    requires: ['auth'],
    routes: [
      { method: 'GET', path: '/alpha/items' },
      { method: 'POST', path: '/alpha/items' },
    ],
    navigation: [{ id: 'alpha-home', href: '/alpha' }],
    schema: { items: aTable('alpha_items') },
  }),
  aModule('beta', {
    routes: [{ method: 'GET', path: '/beta/ping' }],
    navigation: [{ id: 'beta-home', href: '/beta' }],
    schema: { notes: aTable('beta_notes') },
  }),
  aModule('gamma', { routes: [{ method: 'GET', path: '/gamma/thing' }], schema: {} }),
] as const satisfies readonly ProfileModule[]

describe('la dérivation du profil (critères 3, 4, 5)', () => {
  const sweep = sweepProfile({
    profileId: 'essai',
    available: [...ESSAI],
    // `gamma` n'est activé nulle part et le profil ne le nomme pas : il doit
    // quand même être balayé.
    enabled: ['auth', 'alpha'],
  })

  it('balaie tout module non activé, y compris celui que le profil ne nomme pas', () => {
    expect(sweep.cutModuleIds).toEqual(['beta', 'gamma'])
  })

  it('dérive les routes qui ne doivent pas répondre, avec leur méthode', () => {
    expect(sweep.routes).toEqual([
      { moduleId: 'beta', method: 'GET', path: '/beta/ping' },
      { moduleId: 'gamma', method: 'GET', path: '/gamma/thing' },
    ])
  })

  it('dérive les entrées de navigation qui ne doivent pas paraître', () => {
    expect(sweep.navigation).toEqual([{ moduleId: 'beta', entryId: 'beta-home', href: '/beta' }])
  })

  it('dérive les tables absentes et les tables attendues, par leur nom physique', () => {
    expect(sweep.absentTables).toEqual([{ moduleId: 'beta', table: 'beta_notes' }])
    expect(sweep.presentTables).toEqual([
      { moduleId: 'auth', table: 'auth_user' },
      { moduleId: 'alpha', table: 'alpha_items' },
    ])
  })
})

describe('le balayage vide, qui passerait pour de mauvaises raisons', () => {
  it('refuse un profil qui ne coupe que des modules ne déclarant rien', () => {
    const sweep = sweepProfile({
      profileId: 'creux',
      available: [...ESSAI],
      enabled: ['auth', 'alpha', 'beta'],
    })

    // `gamma` ne déclare ni navigation ni table, mais il déclare une route :
    // c'est bien le cas où l'on veut que la recette continue.
    expect(sweep.routes).toHaveLength(1)
    expect(() => assertSweepIsNotEmpty(sweep)).not.toThrow()

    const nothing = sweepProfile({
      profileId: 'creux',
      available: [aModule('auth'), aModule('vide')],
      enabled: ['auth'],
    })

    expect(() => assertSweepIsNotEmpty(nothing)).toThrow(/vide/)
  })
})

describe('les tables, lues dans le schéma réel (critère 5)', () => {
  const sweep = sweepProfile({
    profileId: 'essai',
    available: [...ESSAI],
    enabled: ['auth', 'alpha'],
  })

  it('accepte une base qui porte les tables des modules activés, et elles seules', () => {
    expect(() =>
      assertNoTablesOfCutModules({ sweep, tables: ['auth_user', 'alpha_items'] }),
    ).not.toThrow()
  })

  it('refuse une table d’un module coupé, en nommant la table et son module', () => {
    expect(() =>
      assertNoTablesOfCutModules({ sweep, tables: ['auth_user', 'alpha_items', 'beta_notes'] }),
    ).toThrow(/beta_notes/)
  })

  /**
   * **L'absence ne prouve rien sur une base qui n'a pas migré.** Sans ce refus,
   * une base vide — migrations en échec, mauvaise base interrogée — rendrait la
   * vérification verte : aucune table d'un module coupé n'y existe, et pour
   * cause.
   */
  it('refuse une base où les tables des modules activés manquent', () => {
    expect(() => assertNoTablesOfCutModules({ sweep, tables: [] })).toThrow(/alpha_items/)
  })
})

describe('l’application du profil à la configuration', () => {
  it('retire les modules coupés de la liste activée, sans toucher aux autres', () => {
    expect(
      applyProfile({
        available: [...ESSAI],
        enabled: ['auth', 'alpha', 'beta'],
        required: ['auth'],
        profile: { id: 'essai', cut: ['beta'] },
      }),
    ).toEqual(['auth', 'alpha'])
  })

  it('refuse de couper un module qu’un module resté activé requiert, en nommant les deux', () => {
    expect(() =>
      applyProfile({
        available: [...ESSAI],
        enabled: ['auth', 'alpha'],
        required: [],
        profile: { id: 'essai', cut: ['auth'] },
      }),
    ).toThrow(/alpha/)
  })
})

/**
 * **Le profil a-t-il vraiment été appliqué ?**
 *
 * La recette calcule `nextEnabled`, l'écrit dans le `config/features.ts` de la
 * copie, puis n'y revient jamais : tout ce qui suit est dérivé du registre
 * **monté**, qui serait donc vrai de lui-même. Un module que l'écriture aurait
 * laissé en place — et le cas qui l'illustre est celui d'un module ne déclarant
 * ni route, ni entrée, ni table — ne ferait broncher aucune vérification.
 *
 * Ce refus confronte les deux : ce que la recette a décidé, et ce que la copie
 * porte réellement.
 */
describe('l’état réel de la copie, confronté au profil calculé', () => {
  it('accepte une copie dont la liste activée est celle du profil, quel qu’en soit l’ordre', () => {
    expect(() =>
      assertProfileWasApplied({
        profileId: 'essai',
        expected: ['auth', 'alpha'],
        actual: ['alpha', 'auth'],
      }),
    ).not.toThrow()
  })

  it('refuse un module resté activé dans la copie, en le nommant', () => {
    expect(() =>
      assertProfileWasApplied({
        profileId: 'essai',
        expected: ['auth', 'alpha'],
        actual: ['auth', 'alpha', 'beta'],
      }),
    ).toThrow(/beta/)
  })

  it('refuse un module que la copie n’active plus alors que le profil le garde', () => {
    expect(() =>
      assertProfileWasApplied({
        profileId: 'essai',
        expected: ['auth', 'alpha'],
        actual: ['auth'],
      }),
    ).toThrow(/alpha/)
  })
})

/**
 * **Le cœur de la story** (critère 8) : « ajouter un module désactivé au profil
 * ne demande aucune modification du harnais ».
 *
 * Le test construit un profil **supplémentaire** — un module coupé de plus, et
 * lequel est *dérivé*, jamais écrit — puis vérifie que le balayage grandit
 * exactement de ce que ce module déclare. Un harnais qui nommerait des modules
 * en dur rendrait le même balayage dans les deux cas, et ce cas rougirait.
 */
describe('la généricité, éprouvée sur l’annuaire réel (critère 8)', () => {
  const context = {
    available: [...availableModules],
    required: [...requiredModules],
  }

  const sweepOf = (cut: readonly string[]) =>
    sweepProfile({
      profileId: 'essai',
      available: [...availableModules],
      enabled: applyProfile({ ...context, enabled: [...enabledModules], profile: { id: 'essai', cut } }),
    })

  const livré = sweepOf([...minimalProfile.cut])

  /**
   * Le module que le profil supplémentaire coupera, **choisi par dérivation** :
   * le premier module activé, hors socle, hors profil, qui déclare quelque
   * chose. Écrire son nom ici rendrait ce test faux au module suivant, ce qui
   * est exactement le défaut qu'il existe pour attraper.
   */
  const extra = availableModules.find(
    (module) =>
      enabledModules.includes(module.id as (typeof enabledModules)[number]) &&
      !requiredModules.includes(module.id as (typeof requiredModules)[number]) &&
      !minimalProfile.cut.includes(module.id as (typeof minimalProfile.cut)[number]) &&
      availableModules.every((other) => !other.requires.includes(module.id)) &&
      // Il doit déclarer dans les **trois** catégories, sans quoi les écarts
      // mesurés plus bas vaudraient zéro et ne prouveraient rien.
      module.routes.length > 0 &&
      module.navigation.length > 0 &&
      moduleTableNames(module).length > 0,
  )

  it('balaie, sous le profil livré, un nombre de déclarations non nul dans les trois catégories', () => {
    // Le compte, et pas seulement l'absence : un balayage de zéro route, zéro
    // entrée et zéro table serait vert sans rien vérifier. Les planchers sont
    // à 1 — ce sont les seuils que la généricité permet de tenir, un nombre
    // figé rougirait à la première story qui ajoute une route.
    expect(livré.cutModuleIds.length).toBeGreaterThan(0)
    expect(livré.routes.length).toBeGreaterThan(0)
    expect(livré.navigation.length).toBeGreaterThan(0)
    expect(livré.absentTables.length).toBeGreaterThan(0)
    expect(livré.presentTables.length).toBeGreaterThan(0)
    expect(() => assertSweepIsNotEmpty(livré)).not.toThrow()
  })

  it('couvre les modules du profil **et** ceux que la configuration n’active déjà pas', () => {
    for (const id of minimalProfile.cut) {
      expect(livré.cutModuleIds).toContain(id)
    }

    // La différence entre « ce que le profil coupe » et « ce qui n'est pas
    // activé » : ce dépôt en porte au moins un, et un harnais fondé sur la
    // seule liste du profil le manquerait.
    const jamaisActivés = availableModules
      .map((module) => module.id)
      .filter(
        (id) =>
          !enabledModules.includes(id as (typeof enabledModules)[number]) &&
          !minimalProfile.cut.includes(id as (typeof minimalProfile.cut)[number]),
      )

    expect(jamaisActivés.length).toBeGreaterThan(0)

    for (const id of jamaisActivés) {
      expect(livré.cutModuleIds).toContain(id)
    }
  })

  it('traite un profil d’un module de plus sans qu’une ligne du harnais change', () => {
    expect(extra, 'aucun module activé n’est coupable pour éprouver la généricité').toBeDefined()

    const augmenté = sweepOf([...minimalProfile.cut, extra?.id ?? ''])

    expect(new Set(augmenté.cutModuleIds)).toEqual(
      new Set([...livré.cutModuleIds, extra?.id]),
    )
    expect(augmenté.routes.length).toBe(livré.routes.length + (extra?.routes.length ?? 0))
    expect(augmenté.navigation.length).toBe(
      livré.navigation.length + (extra?.navigation.length ?? 0),
    )
    expect(augmenté.absentTables.length).toBe(
      livré.absentTables.length + (extra === undefined ? 0 : moduleTableNames(extra).length),
    )
    // Et la contrepartie, qui est ce qui rend l'assertion précédente non
    // triviale : ce qui sort du balayage des coupés entre dans celui des
    // activés attendus.
    expect(augmenté.presentTables.length).toBe(
      livré.presentTables.length - (extra === undefined ? 0 : moduleTableNames(extra).length),
    )
  })
})

/**
 * **Les comptes de la suite** (critère 2, décision 3 du plan).
 *
 * Une suite « verte » sous profil minimal ne dit rien si la moitié des cas se
 * sont sautés. Cette session a mesuré deux fois ce que coûte un saut
 * silencieux — 288 cas sautés faute de base, sans un mot.
 */
describe('les comptes de la suite sous le profil', () => {
  // Mesuré par la recherche de s26, sur ce dépôt : profil complet 1806/8,
  // profil minimal 1803/11. Ce sont des repères, pas des seuils : les seuils
  // sont un plancher et une part, pour qu'une story qui ajoute des cas ne casse
  // pas la recette.
  const mesuré = { total: 1814, passed: 1803, skipped: 11, failed: 0 }

  it('accepte l’exécution mesurée par la recherche', () => {
    expect(() => assertSuiteCounts(mesuré)).not.toThrow()
  })

  it('refuse un cas en échec', () => {
    expect(() => assertSuiteCounts({ ...mesuré, passed: 1802, failed: 1 })).toThrow(/échec/)
  })

  it('refuse un effondrement du nombre de cas exécutés', () => {
    // Le plancher, pas l'égalité : c'est un effondrement qu'il attrape — une
    // suite qui ne collecte plus rien, un `include` cassé —, pas la dérive
    // normale d'un dépôt qui grandit.
    expect(() => assertSuiteCounts({ total: 40, passed: 40, skipped: 0, failed: 0 })).toThrow(
      /plancher/,
    )
  })

  /**
   * **La panne la plus probable de la recette, et la garde qui l'attrape.**
   *
   * Mesuré à la revue de s26 : `DATABASE_URL` sur un port mort rend 1 505 cas
   * exécutés et 339 sautés sur 1 846 (plus deux échecs, retirés ici pour isoler
   * la garde qui attrape le cas même sans eux). Le plancher **laisse passer** —
   * cinq cas au-dessus —, la part de sautés refuse. Le commentaire
   * d'`EXECUTED_FLOOR` dit cela ; ce cas est ce qui l'empêche de devenir faux.
   */
  it('attrape la recette sans base par la part de sautés, et non par le plancher', () => {
    const sansBase = { total: 1846, passed: 1505, skipped: 339, failed: 0 }

    expect(sansBase.passed).toBeGreaterThan(EXECUTED_FLOOR)
    expect(() => assertSuiteCounts(sansBase)).toThrow(/sautés/)
  })

  it('refuse une suite verte dont la moitié des cas se sont sautés', () => {
    // Le faux vert que la recherche nomme : rien ne rougit, et pourtant rien
    // n'a été vérifié.
    expect(() =>
      assertSuiteCounts({ total: 3600, passed: 1800, skipped: 1800, failed: 0 }),
    ).toThrow(/sautés/)
  })

  it('journalise les comptes plutôt que de dire « verte »', () => {
    const report = suiteReport(mesuré)

    expect(report).toContain('1803')
    expect(report).toContain('11')
  })
})

/**
 * **Le dépôt de travail n'est jamais touché** (décision 1 du plan, ADR 041).
 *
 * La recette écrit dans `config/features.ts`, un fichier suivi par git : c'est
 * la différence avec s25, dont l'amorçage n'écrivait nulle part. Elle travaille
 * donc dans une copie, et le vérifie plutôt que de l'affirmer.
 */
describe('l’arbre de travail, avant et après la recette', () => {
  it('accepte un arbre inchangé, sale ou propre', () => {
    expect(() => assertWorkingTreeUnchanged([], [])).not.toThrow()
    expect(() =>
      assertWorkingTreeUnchanged(['?? docs/plans/s26.md'], ['?? docs/plans/s26.md']),
    ).not.toThrow()
  })

  it('refuse un fichier que la recette a modifié, en le nommant', () => {
    expect(() => assertWorkingTreeUnchanged([], [' M config/features.ts'])).toThrow(
      /config\/features\.ts/,
    )
  })

  it('refuse un fichier que la recette a fait disparaître', () => {
    expect(() => assertWorkingTreeUnchanged([' M generated/schema/index.ts'], [])).toThrow(
      /generated\/schema\/index\.ts/,
    )
  })
})

describe('le journal du balayage', () => {
  it('dit combien de routes, d’entrées et de tables ont été balayées', () => {
    const report = sweepReport(
      sweepProfile({ profileId: 'essai', available: [...ESSAI], enabled: ['auth', 'alpha'] }),
    )

    // Un « aucune trace trouvée » sans compte ne se distingue pas d'un
    // balayage vide.
    expect(report).toContain('routes attendues absentes      : 2')
    expect(report).toContain('entrées de navigation absentes : 1')
    expect(report).toContain('tables attendues absentes      : 1')
    expect(report).toContain('tables attendues présentes     : 2')
  })
})

/**
 * **L'environnement du clone**, et le défaut que la première exécution de la
 * recette a rendu visible.
 *
 * Mesuré : la recette passait `process.env` au clone. Or elle appelle
 * `loadRootEnv()` pour savoir où écoute PostgreSQL, ce qui **verse le `.env` du
 * poste dans son propre processus** — et un `.env` déjà exporté l'emporte sur
 * le fichier. Le clone recevait donc les variables du poste par-dessus le
 * `.env` qu'il venait de dériver de `.env.example`. Résultat sur ce poste :
 * `PAYMENTS_LOCAL_MODE` du clone contre le `STRIPE_SECRET_KEY` du poste — refus
 * de l'environnement —, `NODE_ENV=development` héritée là où Vitest aurait posé
 * `test`, et 338 cas sautés faute de base joignable. Aucun de ces échecs ne
 * disait quoi que ce soit du profil, et un lecteur pressé y aurait lu un défaut
 * de modularité qui n'existe pas.
 *
 * La liste des variables à retirer est **dérivée du schéma** (`ENV_KEYS`) :
 * écrite à la main, elle serait fausse à la première variable ajoutée.
 */
describe('l’environnement passé au clone', () => {
  const parent = {
    PATH: '/usr/bin',
    HOME: '/home/dev',
    NODE_ENV: 'development',
    STRIPE_SECRET_KEY: 'sk_test_du_poste',
    DATABASE_URL: 'postgres://postgres:postgres@localhost:5436/app',
  }

  const child = cloneEnvironment(parent, {
    databaseUrl: 'postgres://postgres:postgres@localhost:5436/profil_minimal_1',
    appKeys: ['NODE_ENV', 'DATABASE_URL', 'STRIPE_SECRET_KEY'],
  })

  it('ne transmet aucune variable d’application du poste', () => {
    expect(child.STRIPE_SECRET_KEY).toBeUndefined()
    expect(child.NODE_ENV).toBeUndefined()
  })

  it('conserve ce dont un sous-processus a besoin pour exister', () => {
    expect(child.PATH).toBe('/usr/bin')
    expect(child.HOME).toBe('/home/dev')
  })

  it('pose la base vierge de l’exécution, et pas celle du poste', () => {
    expect(child.DATABASE_URL).toBe(
      'postgres://postgres:postgres@localhost:5436/profil_minimal_1',
    )
  })

  /**
   * **Les variables qui désactivent la validation, retirées elles aussi.**
   *
   * `NEXT_PHASE` et `SKIP_ENV_VALIDATION` ne sont pas dans le schéma — elles
   * sont posées par l'outillage — mais `@repo/config` les lit : l'une d'elles
   * fait sauter `assertStartupEnv` entièrement (`isBuildPhase`). Un poste ou un
   * runner qui exporterait `SKIP_ENV_VALIDATION=1` verrait donc le clone
   * démarrer **sans valider** le `.env` que la recette vient de dériver, en
   * silence, et la recette mesurerait autre chose que ce qu'elle annonce.
   *
   * Le parent est construit **depuis `BUILD_ENV_KEYS`** : une clé de build
   * ajoutée demain est couverte sans que ce cas change.
   */
  it('retire les variables qui désactivent la validation d’environnement', () => {
    const child = cloneEnvironment(
      Object.fromEntries([
        ['PATH', '/usr/bin'],
        ...BUILD_ENV_KEYS.map((key) => [key, 'valeur du poste'] as const),
      ]),
      { databaseUrl: 'postgres://x/y', appKeys: CLONE_STRIPPED_ENV_KEYS },
    )

    expect(Object.keys(child)).toEqual(['PATH', 'DATABASE_URL'])
  })

  /**
   * **Le site du défaut est le point de composition**, pas la fonction : celle-ci
   * retire ce qu'on lui donne. Ce qui pouvait être faux — et l'était — est la
   * liste que la recette lui passe.
   */
  it('est la liste que la recette passe réellement au clone', () => {
    const recipe = readFileSync(
      fileURLToPath(new URL('../scripts/minimal-profile.ts', import.meta.url)),
      'utf8',
    )

    expect(recipe).toContain('appKeys: CLONE_STRIPPED_ENV_KEYS')
  })

  it('retire chaque variable que le schéma d’environnement déclare', () => {
    // La garde d'inertie : `appKeys` vient de `ENV_KEYS`, donc du schéma. Une
    // liste vide laisserait tout passer et les trois cas ci-dessus seraient
    // écrits pour rien.
    expect(ENV_KEYS.length).toBeGreaterThan(5)

    const fromSchema = cloneEnvironment(
      Object.fromEntries(ENV_KEYS.map((key) => [key, 'valeur du poste'])),
      { databaseUrl: 'postgres://x/y', appKeys: ENV_KEYS },
    )

    expect(Object.keys(fromSchema)).toEqual(['DATABASE_URL'])
  })
})

/**
 * **Le job de CI** (critère 7), et les deux gardes héritées de s25.
 *
 * Le balayage des `if:` de niveau job vit dans `tests/golden-path.test.ts` et
 * s'applique à **tous** les jobs de ce fichier, celui-ci compris : il n'est pas
 * repris ici. Ce qui est vérifié ici est propre à s26 — le job existe, il est
 * bloquant, et il téléverse le dossier que la recette conserve réellement.
 */
describe('le job de CI de la recette (critère 7)', () => {
  const workflow = readFileSync(
    fileURLToPath(new URL('../.github/workflows/ci.yml', import.meta.url)),
    'utf8',
  )

  it('lance la commande unique du profil, sans condition ni tolérance', () => {
    expect(workflow).toContain('run: pnpm test:minimal-profile')
    // Ni `continue-on-error`, ni `if:` de niveau job : la recette bloque la CI
    // ou elle ne sert à rien. La garde générale sur les `if:` de job est celle
    // de s25 (`tests/golden-path.test.ts`).
    const job = workflow.slice(
      workflow.indexOf('  profil-minimal:'),
      workflow.indexOf('\n  secrets:'),
    )

    expect(job.length).toBeGreaterThan(0)
    expect(job).not.toContain('continue-on-error')
    expect(job).not.toMatch(/^ {4}if:/m)
  })

  it('téléverse le dossier de traces que la recette conserve, hors de celui que `pnpm test:e2e` efface', () => {
    // Le constat F8 de s25 : le job téléversait un dossier qui n'existait pas,
    // parce que Playwright écrit dans le clone que la commande détruit.
    expect(MINIMAL_PROFILE_TRACES_DIRECTORY).not.toMatch(/^test-results(\/|$)/)
    expect(workflow).toContain(`path: ${MINIMAL_PROFILE_TRACES_DIRECTORY}/`)
  })
})
