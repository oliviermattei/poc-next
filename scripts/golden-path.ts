import { execFileSync } from 'node:child_process'
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadRootEnv } from '@repo/config/server'
import { createDatabaseClient } from '@repo/db'
import {
  GOLDEN_PATH_EVENT_KINDS,
  missingRecordingKinds,
  readCapturedEvents,
  readRecordings,
  sanitizeStripeEvent,
} from '@repo/payments-testing'
import { sql } from 'drizzle-orm'

import {
  bootstrapEnvFile,
  durationsReport,
  FAILURE_TRACES_DIRECTORY,
  freshDatabaseUrl,
  resolveGoldenPathRegime,
  type GoldenPathRegime,
} from './golden-path-regime'

/**
 * `pnpm test:golden-path` — **clone → premier paiement**, mesuré (s25).
 *
 * Une commande unique (critère 8), deux phases, trois durées :
 *
 * 1. **l'amorçage** — un `git clone` local dans un répertoire temporaire, un
 *    `.env` recopié depuis `.env.example`, `pnpm install`, `pnpm db:migrate` et
 *    `pnpm db:seed` sur une **base créée pour cette exécution** ;
 * 2. **le parcours** — `playwright.golden-path.config.ts`, joué contre le
 *    serveur démarré depuis le clone.
 *
 * ## Pourquoi un clone, et pas l'arbre courant
 *
 * Parce que chronométrer l'amorçage depuis un arbre déjà installé produit un
 * nombre **flatteur et faux**, précisément sur la partie que le boilerplate
 * promet de raccourcir : `pnpm install` sur un `node_modules` chaud rend en
 * secondes ce qui prend des minutes sur un clone neuf.
 *
 * Le cache pnpm est laissé **chaud**, délibérément : c'est la situation d'un
 * acheteur qui a déjà utilisé pnpm, et un cache froid mesurerait sa bande
 * passante. **Ce que la mesure exclut est journalisé à côté du chiffre** — un
 * nombre sans ses conditions est une publicité, pas une mesure.
 *
 * ## Le régime de paiement est explicite, et il n'y a aucun repli
 *
 * `GOLDEN_PATH_PAYMENTS` est **obligatoire** (`recorded | simulated | live`).
 * Sous `recorded`, la commande vérifie **avant de cloner quoi que ce soit** que
 * chaque nature d'événement attendue a son enregistrement, et **échoue en
 * nommant** celles qui manquent. Elle ne bascule jamais sur le simulateur :
 * ADR 048, et c'est l'interdit central de cette story.
 *
 * ## Ce que cette commande ne fait pas
 *
 * Elle ne juge pas les trente minutes du PRD. Elle les cite à côté du total, et
 * c'est tout : un rouge à la trente-et-unième minute transformerait une
 * promesse commerciale en régression de CI, sur une machine dont personne ne
 * contrôle la charge.
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const RECORDINGS_DIRECTORY = join(REPO_ROOT, 'tests', 'fixtures', 'stripe-events')

/** Le port du serveur éphémère du parcours doré, distinct de celui de `test:e2e`. */
const PORT = process.env.GOLDEN_PATH_PORT ?? '3110'

const run = (command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): void => {
  execFileSync(command, [...args], { cwd, env, stdio: 'inherit' })
}

const gitLines = (args: readonly string[]): string[] =>
  execFileSync('git', [...args], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

/**
 * Le clone, **plus l'état du plan de travail**.
 *
 * `git clone` ne connaît que `HEAD` : sur une branche en cours d'écriture, il
 * mesurerait le code d'avant. Les fichiers modifiés et les fichiers non suivis
 * (hors ignorés) sont donc recopiés par-dessus, et **le journal dit combien**.
 * Un arbre propre — la CI, ou l'après-commit — en recopie zéro, et le clone est
 * alors exactement ce qu'un acheteur obtiendrait.
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

/**
 * Crée la base **vierge** de cette exécution (critère 2).
 *
 * Sur le même serveur que celui du dépôt : l'isolation porte sur la base, pas
 * sur PostgreSQL. Le nom porte l'horodatage — deux exécutions consécutives ne
 * partagent donc rien, et la seconde ne voit rien de la première.
 */
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

const main = async (): Promise<void> => {
  const regime = resolveGoldenPathRegime(process.env)

  console.log(`Parcours doré — régime de paiement : ${regime.kind}.`)

  if (regime.kind === 'live') {
    await captureAgainstRealKeys(regime)

    return
  }

  if (regime.kind === 'recorded') {
    const missing = missingRecordingKinds(
      readRecordings(RECORDINGS_DIRECTORY),
      GOLDEN_PATH_EVENT_KINDS,
    )

    if (missing.length > 0) {
      // **L'échec nommé, avant tout le reste** : ni clone, ni installation, ni
      // base — la commande dit ce qui manque et s'arrête. Elle ne bascule
      // jamais sur le simulateur (ADR 048).
      throw new Error(
        `Le régime enregistré n’a pas d’enregistrement pour ${missing.length} événement(s) : ` +
          `${missing.join(', ')}. Attendus dans ${RECORDINGS_DIRECTORY}. ` +
          'Capturez-les contre les clés de test du fournisseur — ' +
          'GOLDEN_PATH_PAYMENTS=live GOLDEN_PATH_CAPTURE_FROM=<fichier .ndjson ou dossier ' +
          'd’événements bruts> pnpm test:golden-path — puis versionnez-les. Il n’existe aucun repli vers le ' +
          'simulateur : une CI verte sur des formes que nous avons écrites nous-mêmes aurait ' +
          'cessé de vérifier ce qu’elle prétend vérifier.',
      )
    }
  }

  loadRootEnv()

  const ambient = process.env.DATABASE_URL

  if (ambient === undefined || ambient === '') {
    throw new Error(
      'DATABASE_URL n’est pas connue : le parcours doré crée sa base vierge sur le serveur du ' +
        'dépôt, il ne devine pas où celui-ci écoute.',
    )
  }

  const name = `parcours_dore_${Date.now()}`
  const databaseUrl = freshDatabaseUrl(ambient, name)
  const workspace = mkdtempSync(join(tmpdir(), 'parcours-dore-'))
  const clone = join(workspace, 'clone')

  const started = Date.now()

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

    await withMaintenanceConnection(ambient, `create database "${name}"`)

    const cloneEnv: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl }

    run('pnpm', ['install', '--frozen-lockfile'], clone, cloneEnv)
    run('pnpm', ['db:migrate'], clone, cloneEnv)
    run('pnpm', ['db:seed'], clone, cloneEnv)

    const bootstrapMs = Date.now() - started
    const journeyStarted = Date.now()

    run(
      'pnpm',
      ['exec', 'playwright', 'test', '--config', 'playwright.golden-path.config.ts'],
      clone,
      {
        ...cloneEnv,
        E2E_PORT: PORT,
        ...(regime.kind === 'recorded'
          ? { PAYMENTS_RECORDED_EVENTS: join(clone, 'tests', 'fixtures', 'stripe-events') }
          : {}),
      },
    )

    console.log('')
    console.log(durationsReport({ bootstrapMs, journeyMs: Date.now() - journeyStarted }))
  } finally {
    keepFailureTraces(clone)
    rmSync(workspace, { recursive: true, force: true })
    // La base part avec le répertoire : une exécution qui laisserait la sienne
    // derrière elle rendrait « base vierge » faux à la trentième exécution.
    await withMaintenanceConnection(ambient, `drop database if exists "${name}" with (force)`).catch(
      (error: unknown) => {
        console.warn(`La base ${name} n’a pas pu être supprimée : ${String(error)}`)
      },
    )
  }
}

/**
 * **Le régime réel** (critère 7) — clés de test, jamais en CI, jamais par
 * défaut.
 *
 * C'est lui qui **produit** les enregistrements que la CI rejoue. Il fait deux
 * choses, et dit ce qu'il ne fait pas :
 *
 * 1. il éprouve les clés contre le vrai fournisseur, en réutilisant la recette
 *    écrite en s19 (`packages/adapters/stripe/src/stripe-live.test.ts`) — même
 *    régime, même refus d'une clé de production, aucun paiement encaissé ;
 * 2. si `GOLDEN_PATH_CAPTURE_FROM` désigne des événements **bruts** — le
 *    fichier NDJSON de `stripe listen --print-json`, ou un dossier de fichiers
 *    `.json` —, il les **assainit** et les versionne comme enregistrements.
 *
 * **Ce qu'il ne fait pas, et il faut le lire avant de croire le critère 7
 * satisfait : il n'exécute pas le scénario.** Il ne clone rien, ne crée aucune
 * base, n'ouvre aucun navigateur. Le critère demande que « le même scénario
 * s'exécute contre les clés de test » ; ce qui est livré ici éprouve les clés
 * et capture les formes, ce qui débloque le régime `recorded` — mais l'écart au
 * critère est réel et il est nommé plutôt que masqué par « il ne manque que les
 * clés ». Le rejouer entièrement contre Stripe demande en plus une adresse
 * email réelle : la variante invité fabrique `…@guest.local`, qu'un vrai
 * fournisseur refusera.
 *
 * Il n'ouvre pas non plus le tunnel de webhooks à votre place. Cette partie
 * demande vos clés et votre `stripe listen` ; le harnais n'a ni l'un ni
 * l'autre, et prétendre le contraire serait la pire des fausses assurances.
 */
const captureAgainstRealKeys = async (
  regime: Extract<GoldenPathRegime, { kind: 'live' }>,
): Promise<void> => {
  // **Les variables sont posées depuis le régime résolu**, et non héritées au
  // hasard de l'ambiance : c'est ce qui fait que l'ensemble exigé par le refus
  // est exactement l'ensemble employé ici (constat F3 de la revue).
  run(
    'pnpm',
    ['exec', 'vitest', 'run', 'packages/adapters/stripe/src/stripe-live.test.ts'],
    REPO_ROOT,
    {
      ...process.env,
      STRIPE_LIVE_TEST: '1',
      STRIPE_SECRET_KEY: regime.apiKey,
      STRIPE_LIVE_PRICE_ID: regime.priceId,
    },
  )

  const source = process.env.GOLDEN_PATH_CAPTURE_FROM

  if (source === undefined || source === '') {
    console.log(
      [
        '',
        'Clés de test éprouvées. Les enregistrements, eux, se capturent en deux gestes :',
        '',
        `  1. stripe listen --forward-to http://localhost:${PORT}/api/modules/billing/webhook \\`,
        '       --print-json > /tmp/evenements.ndjson',
        '  2. déroulez le parcours (souscription, achat unique), puis :',
        '     GOLDEN_PATH_PAYMENTS=live GOLDEN_PATH_CAPTURE_FROM=/tmp/evenements.ndjson \\',
        '       pnpm test:golden-path',
        '',
        'GOLDEN_PATH_CAPTURE_FROM accepte le fichier NDJSON écrit ci-dessus, ou un dossier',
        'contenant un fichier .json par événement brut. Un chemin absent est refusé en le nommant.',
      ].join('\n'),
    )

    return
  }

  const capturedAt = new Date().toISOString().slice(0, 10)

  mkdirSync(RECORDINGS_DIRECTORY, { recursive: true })

  for (const raw of readCapturedEvents(source)) {
    const recording = sanitizeStripeEvent(raw, capturedAt)

    writeFileSync(
      join(RECORDINGS_DIRECTORY, `${recording.kind}.json`),
      `${JSON.stringify(recording, null, 2)}\n`,
      'utf8',
    )

    console.log(`Enregistrement écrit : ${recording.kind}.json (capturé le ${capturedAt}).`)
  }
}

/**
 * **Les traces d'un parcours en échec, sorties du clone avant qu'il ne
 * disparaisse** (constat F8 de la revue).
 *
 * Playwright les écrit dans le clone temporaire, que le `finally` détruit :
 * l'étape de téléversement de la CI pointait donc sur un dossier qui n'a jamais
 * existé à la racine. Elles sont recopiées ici, sous un nom que le job connaît
 * — `FAILURE_TRACES_DIRECTORY`, déclaré une fois et vérifié contre le workflow
 * —, et le dossier est ignoré par git. Il est **hors de `test-results/`** :
 * Playwright y efface tout au démarrage de `pnpm test:e2e`.
 *
 * Ne lève jamais : une trace absente — le cas normal d'une exécution verte — ne
 * doit pas masquer le résultat du parcours.
 */
const keepFailureTraces = (clone: string): void => {
  const produced = join(clone, 'test-results')
  const kept = join(REPO_ROOT, FAILURE_TRACES_DIRECTORY)

  try {
    // **Les traces sont les sous-dossiers**, un par cas en échec. Playwright
    // écrit aussi `.last-run.json` sur une exécution verte : compter les
    // entrées ferait recopier un dossier qui ne porte aucune trace, et
    // annoncerait dans le journal une conservation qui n'a rien conservé.
    if (!readdirSync(produced, { withFileTypes: true }).some((entry) => entry.isDirectory())) {
      return
    }

    rmSync(kept, { recursive: true, force: true })
    mkdirSync(dirname(kept), { recursive: true })
    cpSync(produced, kept, { recursive: true })

    console.log(`Traces du parcours conservées dans ${kept}.`)
  } catch {
    // Aucune trace produite : le parcours est passé, ou Playwright n'a rien écrit.
  }
}

await main()
