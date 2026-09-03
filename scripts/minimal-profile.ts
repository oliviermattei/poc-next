import { execFileSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readEnabledModules, writeEnabledModules } from '@repo/cli'
import { loadRootEnv } from '@repo/config/server'
import { createDatabaseClient, listDatabaseTables } from '@repo/db'
import { sql } from 'drizzle-orm'

import { humanDuration } from '../e2e/support/steps'
import { availableModules, enabledModules, requiredModules } from '../config/features'
import { minimalProfile } from '../config/profiles'
import { bootstrapEnvFile, freshDatabaseUrl } from './golden-path-regime'
import {
  applyProfile,
  assertNoTablesOfCutModules,
  assertProfileWasApplied,
  assertSuiteCounts,
  assertSweepIsNotEmpty,
  assertWorkingTreeUnchanged,
  cloneEnvironment,
  CLONE_STRIPPED_ENV_KEYS,
  MINIMAL_PROFILE_TRACES_DIRECTORY,
  readSuiteCounts,
  suiteReport,
  sweepProfile,
  sweepReport,
} from './minimal-profile-rules'

/**
 * `pnpm test:minimal-profile` — **la promesse de modularité, éprouvée** (s26).
 *
 * Symétrique du parcours doré de s25 : celui-là prouve que le socle complet
 * mène à un paiement, celui-ci que le socle réduit ne traîne rien — « aucune
 * route morte, aucune entrée de nav orpheline, aucune table inutilisée »
 * (critère de succès n°4 du PRD).
 *
 * ## Ce qu'elle fait, dans l'ordre
 *
 * 1. **valide le profil** contre l'annuaire et le socle, et **dérive** du
 *    contrat des modules ce qui devra être absent — routes, entrées de
 *    navigation, tables. Rien n'est écrit à la main : c'est le critère 8 ;
 * 2. **clone** le dépôt dans un répertoire temporaire, y recopie l'état du plan
 *    de travail, y pose un `.env` dérivé de `.env.example`, et y applique le
 *    profil par `writeEnabledModules` ;
 * 3. **installe, génère, migre** sur une base **créée pour cette exécution** ;
 * 4. **lit le schéma réel** de cette base (`information_schema`) et confronte
 *    les tables présentes au profil (critère 5) ;
 * 5. **joue la suite complète** dans le clone, et **journalise les comptes** de
 *    cas exécutés et sautés (critère 2) ;
 * 6. **joue les parcours** du profil sur un serveur réellement démarré :
 *    routes injoignables, navigation sans entrée orpheline, inscription et
 *    connexion de bout en bout (critères 3, 4, 6).
 *
 * ## Pourquoi une copie, et pas l'arbre courant
 *
 * Parce que le profil s'écrit dans `config/features.ts`, un fichier **suivi par
 * git** — c'est la différence avec le parcours doré, qui n'écrivait nulle part.
 * Une recette qui basculerait le dépôt de travail et mourrait en cours
 * laisserait un diff que personne n'a demandé, et ADR 041 interdit précisément
 * les écritures pilotées par agent sur un arbre sale. La restauration du CLI
 * reste un filet ; travailler dans une copie supprime le sujet.
 *
 * L'arbre de travail est comparé **avant et après**, et une seule fois de plus
 * dès la fin de l'amorçage : une recette qui écrirait au mauvais endroit doit
 * le dire en une minute, pas au bout de dix.
 *
 * ## Ce qu'elle ne fait pas
 *
 * Elle ne supprime aucune table d'un module coupé, et il n'existe aucune
 * commande pour le faire : un module activé puis désactivé **conserve** ses
 * données, et les effacer serait `eject`, au cimetière du PRD. Le critère 5
 * porte sur une base **vierge**, c'est-à-dire sur ce qu'un projet neuf obtient.
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Le port du serveur éphémère de cette recette, distinct des deux autres. */
const PORT = process.env.MINIMAL_PROFILE_PORT ?? '3120'

/**
 * L'environnement est un dictionnaire simple, et pas un `NodeJS.ProcessEnv` :
 * Next augmente ce type d'un `NODE_ENV` obligatoire, que l'environnement du
 * clone n'a délibérément pas (`cloneEnvironment`).
 */
const run = (
  command: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string | undefined>,
): void => {
  execFileSync(command, [...args], { cwd, env: env as NodeJS.ProcessEnv, stdio: 'inherit' })
}

const gitLines = (args: readonly string[]): string[] =>
  execFileSync('git', [...args], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

/** L'état de l'arbre de travail, tel que `git status --porcelain` le rend. */
const workingTree = (): readonly string[] => gitLines(['status', '--porcelain'])

/**
 * Le clone, **plus l'état du plan de travail**.
 *
 * `git clone` ne connaît que `HEAD` : sur une branche en cours d'écriture, il
 * mesurerait le code d'avant. Les fichiers modifiés et les fichiers non suivis
 * (hors ignorés) sont donc recopiés par-dessus, et **le journal dit combien**.
 * Repris tel quel du parcours doré : deux implémentations de ce geste
 * divergeraient, et c'est un piège que s25 a déjà payé.
 */
const cloneRepository = (destination: string): number => {
  run('git', ['clone', '--local', '--no-hardlinks', REPO_ROOT, destination], REPO_ROOT, process.env)

  const changed = gitLines(['ls-files', '--modified', '--others', '--exclude-standard'])
  const deleted = new Set(gitLines(['ls-files', '--deleted']))

  for (const file of deleted) {
    rmSync(join(destination, file), { force: true })
  }

  for (const file of changed) {
    if (deleted.has(file)) continue

    mkdirSync(dirname(join(destination, file)), { recursive: true })
    cpSync(join(REPO_ROOT, file), join(destination, file))
  }

  return changed.length - deleted.size
}

const withMaintenanceConnection = async (
  databaseUrl: string,
  statement: string,
): Promise<void> => {
  const connection = createDatabaseClient({
    connectionString: freshDatabaseUrl(databaseUrl, 'postgres'),
  })

  try {
    await connection.db.execute(sql.raw(statement))
  } finally {
    await connection.close()
  }
}

/** Les tables réellement présentes dans la base de cette exécution. */
const tablesOf = async (databaseUrl: string): Promise<readonly string[]> => {
  const connection = createDatabaseClient({ connectionString: databaseUrl, maxConnections: 1 })

  try {
    return await listDatabaseTables({ db: connection.db })
  } finally {
    await connection.close()
  }
}

/**
 * **Les traces d'une recette en échec, sorties du clone avant qu'il ne
 * disparaisse** — le constat F8 de la revue de s25, hérité plutôt que repayé.
 *
 * Playwright les écrit dans le clone temporaire, que le `finally` détruit : un
 * job de CI qui téléverserait `test-results/` à la racine pointerait sur un
 * dossier qui n'a jamais existé. Elles sont recopiées sous le nom que le
 * workflow connaît (`MINIMAL_PROFILE_TRACES_DIRECTORY`), **hors** de
 * `test-results/`, que `pnpm test:e2e` efface à son démarrage.
 *
 * Ne lève jamais : une trace absente — le cas normal d'une exécution verte — ne
 * doit pas masquer le résultat de la recette.
 */
const keepFailureTraces = (clone: string): void => {
  const produced = join(clone, 'test-results')
  const kept = join(REPO_ROOT, MINIMAL_PROFILE_TRACES_DIRECTORY)

  try {
    // Les traces sont les **sous-dossiers**, un par cas en échec : Playwright
    // écrit aussi `.last-run.json` sur une exécution verte, et compter les
    // entrées annoncerait une conservation qui n'a rien conservé.
    if (!readdirSync(produced, { withFileTypes: true }).some((entry) => entry.isDirectory())) {
      return
    }

    rmSync(kept, { recursive: true, force: true })
    mkdirSync(dirname(kept), { recursive: true })
    cpSync(produced, kept, { recursive: true })

    console.log(`Traces de la recette conservées dans ${kept}.`)
  } catch {
    // Aucune trace produite : la recette est passée, ou Playwright n'a rien écrit.
  }
}

const main = async (): Promise<void> => {
  // **Le profil d'abord, avant tout le reste** : un identifiant inconnu ou un
  // module du socle fait échouer ici, en une seconde, plutôt qu'après un clone
  // et une installation complète.
  const nextEnabled = applyProfile({
    available: [...availableModules],
    enabled: [...enabledModules],
    required: [...requiredModules],
    profile: minimalProfile,
  })

  const sweep = sweepProfile({
    profileId: minimalProfile.id,
    available: [...availableModules],
    enabled: nextEnabled,
  })

  // Un balayage vide passerait pour de mauvaises raisons : tout serait vert, et
  // rien n'aurait été vérifié.
  assertSweepIsNotEmpty(sweep)

  console.log(sweepReport(sweep))
  console.log('')

  loadRootEnv()

  const ambient = process.env.DATABASE_URL

  if (ambient === undefined || ambient === '') {
    throw new Error(
      'DATABASE_URL n’est pas connue : la recette du profil minimal crée sa base vierge sur le ' +
        'serveur du dépôt, elle ne devine pas où celui-ci écoute.',
    )
  }

  const before = workingTree()
  const name = `profil_minimal_${Date.now()}`
  const databaseUrl = freshDatabaseUrl(ambient, name)
  const workspace = mkdtempSync(join(tmpdir(), 'profil-minimal-'))
  const clone = join(workspace, 'clone')

  const started = Date.now()

  let failure: unknown

  try {
    const overlaid = cloneRepository(clone)

    console.log(
      overlaid === 0
        ? 'Clone local de HEAD, arbre propre : aucun fichier recopié par-dessus.'
        : `Clone local de HEAD, plus ${overlaid} fichier(s) du plan de travail recopiés par-dessus.`,
    )

    writeFileSync(
      join(clone, '.env'),
      bootstrapEnvFile(readFileSync(join(clone, '.env.example'), 'utf8'), databaseUrl),
      'utf8',
    )

    // **L'application du profil, dans la copie.** `writeEnabledModules` est
    // celle du CLI : elle préserve les commentaires du propriétaire et refuse
    // d'enregistrer un fichier que TypeScript ne saurait plus analyser.
    const featuresPath = join(clone, 'config', 'features.ts')
    const edit = writeEnabledModules(readFileSync(featuresPath, 'utf8'), nextEnabled)

    writeFileSync(featuresPath, edit.text, 'utf8')

    // **Ce que la copie active réellement, relu sur son disque.** Tout ce qui
    // suit est dérivé du registre monté dans la copie, donc vrai de lui-même :
    // un module que l'écriture aurait laissé en place — celui qui ne déclare ni
    // route, ni entrée, ni table en particulier — ne ferait broncher aucune
    // vérification. Celle-ci est la seule qui confronte les deux.
    assertProfileWasApplied({
      profileId: minimalProfile.id,
      expected: nextEnabled,
      actual: readEnabledModules(readFileSync(featuresPath, 'utf8')),
    })

    console.log(
      `Profil « ${minimalProfile.id} » appliqué dans la copie : ${nextEnabled.length} module(s) ` +
        `activé(s), ${sweep.cutModuleIds.length} coupé(s).`,
    )

    // **Le contrôle qui arrive tôt** : une recette qui écrirait dans l'arbre de
    // travail plutôt que dans la copie doit le dire ici, et non après dix
    // minutes d'installation et de parcours.
    assertWorkingTreeUnchanged(before, workingTree())

    await withMaintenanceConnection(ambient, `create database "${name}"`)

    // **Le clone n'hérite d'aucune variable d'application du poste.** Il porte
    // son propre `.env`, dérivé de `.env.example`, et un `.env` ne l'emporte
    // jamais sur une variable déjà exportée : `loadRootEnv()` ci-dessus a versé
    // le fichier du poste dans ce processus, et le transmettre recouvrirait
    // exactement ce que la recette éprouve.
    const cloneEnv = cloneEnvironment(process.env, {
      databaseUrl,
      appKeys: CLONE_STRIPPED_ENV_KEYS,
    })

    run('pnpm', ['install', '--frozen-lockfile'], clone, cloneEnv)
    // Les barils de `generated/schema/` sont dérivés de `config/features.ts` :
    // sans cette régénération, la garde de divergence de s04 rougirait pour la
    // bascule qu'on vient de faire exprès.
    run('pnpm', ['db:generate'], clone, cloneEnv)
    run('pnpm', ['db:migrate'], clone, cloneEnv)

    const bootstrapMs = Date.now() - started

    // **Critère 5** — le schéma **réel**, pas les fichiers de migration.
    const tables = await tablesOf(databaseUrl)

    assertNoTablesOfCutModules({ sweep, tables })

    console.log('')
    console.log(
      `Schéma réel de la base vierge : ${tables.length} table(s). ` +
        `${sweep.absentTables.length} table(s) de modules coupés vérifiées absentes, ` +
        `${sweep.presentTables.length} table(s) de modules activés vérifiées présentes.`,
    )

    run('pnpm', ['db:seed'], clone, cloneEnv)

    // **Critère 2** — la suite complète, et ses comptes.
    const summary = join(workspace, 'suite.json')
    const suiteStarted = Date.now()

    run(
      'pnpm',
      // Deux rapporteurs : celui de l'œil, pour que l'échec d'un cas se lise
      // dans le journal de la recette, et celui de la machine, pour les
      // comptes. Un seul rapport JSON laisserait un échec sans aucun détail.
      [
        'exec',
        'vitest',
        'run',
        '--reporter=default',
        '--reporter=json',
        `--outputFile.json=${summary}`,
      ],
      clone,
      cloneEnv,
    )

    const counts = readSuiteCounts(JSON.parse(readFileSync(summary, 'utf8')))

    assertSuiteCounts(counts)

    console.log('')
    console.log(suiteReport(counts))

    const suiteMs = Date.now() - suiteStarted
    const journeyStarted = Date.now()

    // **Critères 3, 4 et 6** — sur un serveur réellement démarré depuis le
    // clone : les tests de nœud prouvent la règle, pas le montage.
    run(
      'pnpm',
      ['exec', 'playwright', 'test', '--config', 'playwright.minimal-profile.config.ts'],
      clone,
      { ...cloneEnv, E2E_PORT: PORT },
    )

    console.log('')
    console.log(
      [
        'Recette du profil minimal — durées mesurées',
        `  amorçage (clone, .env, profil, install, generate, migrate) : ${humanDuration(bootstrapMs)}`,
        `  suite complète                                            : ${humanDuration(suiteMs)}`,
        `  parcours du profil (navigateur)                           : ${humanDuration(Date.now() - journeyStarted)}`,
        '',
        'Ce que la mesure exclut : le cache pnpm est laissé chaud, le navigateur de Playwright',
        'est déjà téléchargé, et le serveur PostgreSQL est déjà démarré — seule la **base** est',
        'créée par la recette.',
      ].join('\n'),
    )
  } catch (error) {
    failure = error
  } finally {
    keepFailureTraces(clone)
    rmSync(workspace, { recursive: true, force: true })
    // La base part avec le répertoire : une exécution qui laisserait la sienne
    // derrière elle rendrait « base vierge » faux à la trentième exécution, et
    // le critère 5 avec.
    await withMaintenanceConnection(
      ambient,
      `drop database if exists "${name}" with (force)`,
    ).catch((error: unknown) => {
      console.warn(`La base ${name} n’a pas pu être supprimée : ${String(error)}`)
    })
  }

  // **Le dernier mot est pour l'arbre de travail**, échec compris : c'est la
  // promesse de la décision 1 du plan, et elle vaut surtout quand la recette
  // meurt en cours — c'est alors qu'un fichier basculé resterait derrière elle.
  //
  // Le constat est **journalisé** plutôt que levé quand la recette a déjà
  // échoué : une exception posée par-dessus une autre remplacerait la cause par
  // sa conséquence, et le lecteur chercherait au mauvais endroit.
  try {
    assertWorkingTreeUnchanged(before, workingTree())
  } catch (error) {
    if (failure === undefined) {
      throw error
    }

    console.error(String(error))
  }

  if (failure !== undefined) {
    throw failure
  }
}

await main()
