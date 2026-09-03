import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { resolveBillingConfig } from '../apps/web/lib/billing-config'
import { parseEnv } from '@repo/config'
import { measuredStep, type StepMeasurement } from '../e2e/support/steps'
import {
  bootstrapEnvFile,
  durationsReport,
  expectedEventIdPrefix,
  FAILURE_TRACES_DIRECTORY,
  freshDatabaseUrl,
  recordedEventsDirectoryFor,
  resolveGoldenPathRegime,
  verifyEventIdMark,
} from '../scripts/golden-path-regime'

/**
 * Le harnais du **parcours doré** (s25) — tout ce qui s'éprouve sans navigateur.
 *
 * Un seul fichier, comme partout dans ce dépôt : le coût d'une suite est
 * dominé par le fichier, pas par l'assertion.
 */

describe('le délai par étape (critère 8)', () => {
  it('nomme l’étape dépassée, et pas seulement la durée', async () => {
    const measured: StepMeasurement[] = []

    await expect(
      measuredStep(
        'souscription d’une offre',
        10,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 200))
        },
        measured,
      ),
    ).rejects.toThrow(/souscription d’une offre/)
  })

  it('rend le résultat de l’étape et sa durée quand elle tient dans son budget', async () => {
    const measured: StepMeasurement[] = []

    const value = await measuredStep('inscription', 5_000, async () => 'ok', measured)

    expect(value).toBe('ok')
    expect(measured.map((entry) => entry.name)).toEqual(['inscription'])
    expect(measured[0]?.durationMs).toBeGreaterThanOrEqual(0)
  })
})

/**
 * Le choix du régime de paiement, **au démarrage de l'application**.
 *
 * C'est le seul endroit où un repli du régime enregistré vers le simulateur
 * pourrait se glisser sans qu'on le voie : la configuration décide, et une
 * configuration qui « arrange » un enregistrement absent le ferait en silence.
 */
describe('le régime de paiement du parcours doré (ADR 048)', () => {
  const anEnv = (values: Record<string, string>) =>
    parseEnv({
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/app',
      EMAIL_LOCAL_CAPTURE: '1',
      ...values,
    })

  it('porte le dossier d’enregistrements quand il est demandé', () => {
    const config = resolveBillingConfig(
      anEnv({ PAYMENTS_LOCAL_MODE: '1', PAYMENTS_RECORDED_EVENTS: '/tmp/enregistrements' }),
    )

    expect(config).toEqual({
      kind: 'local',
      webhookSecret: expect.any(String),
      recordedEventsDirectory: '/tmp/enregistrements',
    })
  })

  it('ne porte aucun dossier quand personne ne l’a demandé — le régime simulé reste un choix', () => {
    const config = resolveBillingConfig(anEnv({ PAYMENTS_LOCAL_MODE: '1' }))

    expect(config).toEqual({ kind: 'local', webhookSecret: expect.any(String) })
  })

  it('refuse un dossier d’enregistrements sans le mode qui les rejoue', () => {
    // Sans `PAYMENTS_LOCAL_MODE`, la variable serait posée et **sans effet** :
    // le port serait le vrai fournisseur, et personne ne saurait que le rejeu
    // n’a pas eu lieu.
    expect(() =>
      resolveBillingConfig(
        anEnv({
          STRIPE_SECRET_KEY: 'sk_test_x',
          STRIPE_WEBHOOK_SECRET: 'whsec_x',
          PAYMENTS_RECORDED_EVENTS: '/tmp/enregistrements',
        }),
      ),
    ).toThrow(/PAYMENTS_RECORDED_EVENTS/)
  })

  it('refuse le rejeu enregistré sous NODE_ENV=production, comme le mode local lui-même', () => {
    expect(() =>
      resolveBillingConfig(
        anEnv({
          NODE_ENV: 'production',
          PAYMENTS_LOCAL_MODE: '1',
          PAYMENTS_RECORDED_EVENTS: '/tmp/enregistrements',
        }),
      ),
    ).toThrow(/production/)
  })
})

/**
 * **Le choix du régime, à l'entrée de la commande** (critères 6 et 7, ADR 048).
 *
 * C'est ici que se joue l'interdit central : il ne doit exister aucun chemin
 * par lequel une exécution qui croit rejouer des enregistrements se retrouve à
 * simuler, ni aucune CI verte sur le simulateur.
 */
describe('le régime du parcours doré', () => {
  const anEnvironment = (values: Record<string, string | undefined> = {}) => ({
    GOLDEN_PATH_PAYMENTS: undefined,
    CI: undefined,
    STRIPE_SECRET_KEY: undefined,
    STRIPE_WEBHOOK_SECRET: undefined,
    ...values,
  })

  it('exige un régime explicite, et nomme les trois valeurs possibles', () => {
    expect(() => resolveGoldenPathRegime(anEnvironment())).toThrow(/GOLDEN_PATH_PAYMENTS/)
  })

  it('refuse une valeur qu’il ne connaît pas, plutôt que d’en choisir une', () => {
    expect(() =>
      resolveGoldenPathRegime(anEnvironment({ GOLDEN_PATH_PAYMENTS: 'stripe' })),
    ).toThrow(/stripe/)
  })

  it('accepte le simulateur hors CI : c’est son emploi, pas un repli', () => {
    expect(resolveGoldenPathRegime(anEnvironment({ GOLDEN_PATH_PAYMENTS: 'simulated' }))).toEqual({
      kind: 'simulated',
    })
  })

  it('refuse le simulateur en CI : une CI verte sur des formes écrites à la main ne vérifie rien', () => {
    expect(() =>
      resolveGoldenPathRegime(anEnvironment({ GOLDEN_PATH_PAYMENTS: 'simulated', CI: 'true' })),
    ).toThrow(/simulateur/)
  })

  it('accepte le rejeu enregistré, en CI comme ailleurs', () => {
    expect(
      resolveGoldenPathRegime(anEnvironment({ GOLDEN_PATH_PAYMENTS: 'recorded', CI: 'true' })),
    ).toEqual({ kind: 'recorded' })
  })

  it('refuse de mélanger le rejeu enregistré et une clé de fournisseur', () => {
    expect(() =>
      resolveGoldenPathRegime(
        anEnvironment({ GOLDEN_PATH_PAYMENTS: 'recorded', STRIPE_SECRET_KEY: 'sk_test_x' }),
      ),
    ).toThrow(/STRIPE_SECRET_KEY/)
  })

  it('refuse le régime réel sans ses variables, en les nommant', () => {
    expect(() => resolveGoldenPathRegime(anEnvironment({ GOLDEN_PATH_PAYMENTS: 'live' }))).toThrow(
      /STRIPE_SECRET_KEY/,
    )
  })

  /**
   * **Les variables exigées sont celles qui servent** (constat F3 de la revue).
   *
   * Le refus réclamait `STRIPE_WEBHOOK_SECRET`, que rien de cette recette ne
   * lit, et se taisait sur `STRIPE_LIVE_PRICE_ID`, dont
   * `packages/adapters/stripe/src/stripe-live.test.ts` a besoin. Poser
   * exactement les deux variables réclamées échouait donc plus loin sur une
   * troisième jamais demandée — le mode de défaillance que le message prétend
   * éviter.
   */
  it('exige l’offre de la recette, et non un secret de webhook que rien ne lit', () => {
    expect(() =>
      resolveGoldenPathRegime(
        anEnvironment({ GOLDEN_PATH_PAYMENTS: 'live', STRIPE_SECRET_KEY: 'sk_test_x' }),
      ),
    ).toThrow(/STRIPE_LIVE_PRICE_ID/)

    expect(
      resolveGoldenPathRegime(
        anEnvironment({
          GOLDEN_PATH_PAYMENTS: 'live',
          STRIPE_SECRET_KEY: 'sk_test_x',
          STRIPE_LIVE_PRICE_ID: 'price_x',
        }),
      ),
    ).toEqual({ kind: 'live', apiKey: 'sk_test_x', priceId: 'price_x' })
  })

  it('refuse une clé de production : cette recette ne touche que le mode test', () => {
    expect(() =>
      resolveGoldenPathRegime(
        anEnvironment({
          GOLDEN_PATH_PAYMENTS: 'live',
          STRIPE_SECRET_KEY: 'sk_live_x',
          STRIPE_LIVE_PRICE_ID: 'price_x',
        }),
      ),
    ).toThrow(/sk_test_/)
  })

  it('refuse le régime réel en CI : les deux régimes ne se mélangent jamais', () => {
    expect(() =>
      resolveGoldenPathRegime(
        anEnvironment({
          GOLDEN_PATH_PAYMENTS: 'live',
          CI: 'true',
          STRIPE_SECRET_KEY: 'sk_test_x',
          STRIPE_LIVE_PRICE_ID: 'price_x',
        }),
      ),
    ).toThrow(/CI/)
  })
})

/**
 * **La marque que le serveur doit laisser derrière lui** (constat F1 de la
 * revue de s25).
 *
 * C'est le filet qui manquait : la chaîne « régime demandé → variable
 * transmise au serveur → source d'événements » n'avait aucun maillon gardé à
 * son extrémité. Retirer la transmission laissait le serveur simuler pendant
 * que la commande annonçait « recorded », et la CI restait verte.
 *
 * La règle est ici, pure ; le parcours doré lui donne les identifiants
 * réellement écrits par la route de webhook (`billing_webhook_event`).
 */
describe('la marque du régime dans les événements traités', () => {
  const anIdentifier = (prefix: string): string => `${prefix}checkout_cs_x`

  it('distingue les deux régimes par leur marque', () => {
    expect(expectedEventIdPrefix({ kind: 'recorded' })).not.toBe(
      expectedEventIdPrefix({ kind: 'simulated' }),
    )
  })

  it('ne juge pas le régime réel : il n’exécute pas le scénario', () => {
    expect(() =>
      expectedEventIdPrefix({ kind: 'live', apiKey: 'sk_test_x', priceId: 'price_x' }),
    ).toThrow(/live/)
  })

  it('accepte une exécution dont les événements portent la marque demandée', () => {
    expect(() =>
      verifyEventIdMark({ kind: 'recorded' }, [
        anIdentifier(expectedEventIdPrefix({ kind: 'recorded' })),
      ]),
    ).not.toThrow()
  })

  it('refuse une exécution qui annonce le rejeu et livre des formes simulées', () => {
    // **Le faux vert de la revue** : `recorded` demandé, simulateur exécuté.
    expect(() =>
      verifyEventIdMark({ kind: 'recorded' }, [
        anIdentifier(expectedEventIdPrefix({ kind: 'simulated' })),
      ]),
    ).toThrow(/recorded/)
  })

  it('refuse une exécution où aucun événement de paiement n’a été traité', () => {
    // Un signal **positif** : « aucun événement » ne prouve pas le rejeu, il
    // prouve qu'aucun paiement n'a abouti.
    expect(() => verifyEventIdMark({ kind: 'recorded' }, [])).toThrow(/aucun/)
  })
})

/**
 * **Le régime est décidé par la commande, jamais par l'ambiance** (constat F1
 * de la revue de s25).
 *
 * Playwright **fusionne** `process.env` dans l'environnement du serveur qu'il
 * démarre — `{ ...process.env, ...webServer.env }`, mesuré dans
 * `playwright/lib/runner/index.js`. Une variable omise de la configuration
 * n'est donc pas absente du serveur : elle est celle du shell. C'est ce qui
 * rendait la mesure M3 de la revue trompeuse — la ligne retirée, le serveur
 * recevait quand même le dossier, et l'exécution rejouait réellement.
 *
 * Ce qui reste vrai du constat, et que ce cas garde : **rien** ne posait le
 * régime de façon décidée. Un `PAYMENTS_RECORDED_EVENTS` oublié dans un shell
 * ferait rejouer des enregistrements sous un régime annoncé `simulated`,
 * c'est-à-dire mélangerait les deux régimes par héritage.
 */
describe('l’environnement des serveurs de parcours', () => {
  it('transmet le dossier quand le régime enregistré est demandé', () => {
    expect(
      recordedEventsDirectoryFor({
        GOLDEN_PATH_PAYMENTS: 'recorded',
        PAYMENTS_RECORDED_EVENTS: '/tmp/enregistrements',
      }),
    ).toBe('/tmp/enregistrements')
  })

  it('efface un dossier hérité de l’ambiance sous un autre régime', () => {
    // Mesuré avant ce correctif : cinq événements `evt_rec_…` traités par une
    // exécution qui annonçait `simulated`, parce que Playwright fusionne
    // `process.env` dans l’environnement du serveur.
    expect(
      recordedEventsDirectoryFor({
        GOLDEN_PATH_PAYMENTS: 'simulated',
        PAYMENTS_RECORDED_EVENTS: '/tmp/enregistrements',
      }),
    ).toBe('')
  })

  it('pose le dossier d’enregistrements, même vide, plutôt que de laisser l’ambiance décider', async () => {
    const { default: goldenPath } = await import('../playwright.golden-path.config')
    const server = goldenPath.webServer

    if (server === undefined || Array.isArray(server)) {
      throw new Error('`playwright.golden-path.config.ts` ne démarre plus un serveur unique.')
    }

    expect(Object.keys(server.env ?? {})).toContain('PAYMENTS_RECORDED_EVENTS')
  })

  it('n’en laisse hériter aucun à `pnpm test:e2e`, qui n’a pas de régime à annoncer', async () => {
    const { webServerEnv } = await import('../playwright.config')

    // La suite principale joue les formes **simulées**, et rien d'autre. Mesuré
    // par la revue avant ce correctif : `PAYMENTS_RECORDED_EVENTS=<dossier>
    // pnpm exec playwright test e2e/billing.spec.ts` rendait treize parcours
    // verts en ayant rejoué des enregistrements — onze événements `evt_rec_…`
    // écrits dans le journal d'idempotence de la base du poste, alors qu'il n'y
    // en avait aucun avant. La suite avait changé de source d'événements sans
    // que rien ne le dise. Vide vaut absente pour `resolveBillingConfig`.
    expect(webServerEnv().PAYMENTS_RECORDED_EVENTS).toBe('')
  })
})

describe('l’amorçage mesuré (critères 4 et 5)', () => {
  it('reprend `.env.example` tel quel, en n’y changeant que la base de données', () => {
    const written = bootstrapEnvFile(
      ['# commentaire', 'DATABASE_URL=postgres://postgres:postgres@localhost:5432/app', 'APP_URL=http://localhost:3000'].join(
        '\n',
      ),
      'postgres://postgres:postgres@localhost:5435/parcours_dore_1',
    )

    expect(written).toContain('APP_URL=http://localhost:3000')
    expect(written).toContain('DATABASE_URL=postgres://postgres:postgres@localhost:5435/parcours_dore_1')
    // L'ancienne valeur ne survit pas : deux `DATABASE_URL` dans un `.env`
    // laisseraient la dernière gagner, et « la dernière » n'est pas une règle.
    expect(written).not.toContain('localhost:5432/app')
  })

  it('refuse un exemple qui ne déclare aucune base : l’amorçage ne l’inventerait pas', () => {
    expect(() => bootstrapEnvFile('APP_URL=http://localhost:3000', 'postgres://x/y')).toThrow(
      /DATABASE_URL/,
    )
  })

  it('dérive le nom de la base vierge sans toucher au serveur qui l’héberge', () => {
    expect(
      freshDatabaseUrl('postgres://postgres:postgres@localhost:5435/app', 'parcours_dore_42'),
    ).toBe('postgres://postgres:postgres@localhost:5435/parcours_dore_42')
  })

  it('journalise les trois durées **et** ce que la mesure exclut', () => {
    const report = durationsReport({ bootstrapMs: 120_000, journeyMs: 60_000 })

    expect(report).toContain('amorçage')
    expect(report).toContain('parcours')
    expect(report).toContain('total')
    // Un nombre sans ses conditions est une publicité, pas une mesure.
    expect(report).toContain('cache pnpm chaud')
    expect(report).toContain('navigateur')
    // Le repère du PRD est cité, jamais appliqué : le harnais mesure, il ne juge pas.
    expect(report).toContain('30 min')
  })

  it('ne journalise aucun secret, même quand le régime réel en porte', () => {
    expect(durationsReport({ bootstrapMs: 1, journeyMs: 1 })).not.toMatch(/sk_test|sk_live|whsec_/)
  })
})

/**
 * **L'armement du job de CI**, et la seule faute de cette story qu'aucune
 * commande locale n'attrapait.
 *
 * `if: ${{ hashFiles(…) }}` posé au **niveau d'un job** ne se contente pas de
 * ne jamais s'armer : GitHub rejette le **fichier entier** (« Unrecognized
 * function: 'hashFiles' »). Ce dépôt n'a qu'un workflow — rejeté, il emporte le
 * typage, le lint, `pnpm test`, `pnpm test:e2e`, l'audit de dépendances **et**
 * le scan de secrets, c'est-à-dire tout ce que le socle de sécurité exige de
 * bloquant, sur chaque poussée.
 *
 * La cause est structurelle, et c'est pourquoi la règle ne se contourne pas :
 * un `if:` de job est évalué **avant** qu'une machine soit allouée et avant
 * tout `checkout`, donc `hashFiles` n'a aucun espace de travail où résoudre son
 * motif. GitHub n'y autorise que `github`, `needs`, `vars` et `inputs`.
 * Mesuré par `actionlint` (image `rhysd/actionlint`) sur la version fautive :
 * « calling function "hashFiles" is not allowed here », suivi des huit
 * emplacements où elle l'est — tous des **étapes**.
 *
 * Ce que ce balayage lit, décrit plutôt que promis : sous la clé `jobs:`, les
 * lignes `if:` indentées de quatre espaces — le niveau d'un job — et le job qui
 * les précède. Il ne lit ni un `if:` d'étape, ni une forme multiligne
 * (`if: >`) : il n'y en a aucune à ce jour, et s'il en naissait une, ce
 * balayage ne la verrait pas.
 */
describe('l’armement du job de CI du parcours doré', () => {
  const workflow = (): string =>
    readFileSync(fileURLToPath(new URL('../.github/workflows/ci.yml', import.meta.url)), 'utf8')

  /** Les `if:` posés au niveau d'un job, avec le job qui les porte. */
  const jobLevelConditions = (): { job: string; expression: string }[] => {
    const found: { job: string; expression: string }[] = []
    let inJobs = false
    let job = ''

    for (const line of workflow().split('\n')) {
      if (line === 'jobs:') {
        inJobs = true
        continue
      }

      if (!inJobs) {
        continue
      }

      const declared = /^ {2}([A-Za-z_][\w-]*):\s*$/.exec(line)

      if (declared !== null) {
        job = declared[1] ?? ''
        continue
      }

      const condition = /^ {4}if:\s*(.+)$/.exec(line)

      if (condition !== null) {
        found.push({ job, expression: condition[1] ?? '' })
      }
    }

    return found
  }

  /** Ce qu'une expression appelle et ce qu'elle déréférence, littéraux exclus. */
  const referencesOf = (expression: string): { functions: string[]; contexts: string[] } => {
    const body = expression
      .replace(/^\$\{\{/, '')
      .replace(/\}\}\s*$/, '')
      .replace(/'[^']*'/g, "''")

    return {
      functions: [...body.matchAll(/([A-Za-z_][\w-]*)\s*\(/g)].map((match) => match[1] ?? ''),
      contexts: [...body.matchAll(/(?:^|[^.\w])([A-Za-z_][\w-]*)\s*\./g)].map(
        (match) => match[1] ?? '',
      ),
    }
  }

  // Les seuls contextes disponibles dans `jobs.<job_id>.if`, plus les fonctions
  // générales et les quatre fonctions d'état. `hashFiles`, `secrets`, `env`,
  // `steps`, `matrix` et `runner` n'en sont pas : ils font rejeter le fichier.
  const CONTEXTS = new Set(['github', 'needs', 'vars', 'inputs'])
  const FUNCTIONS = new Set([
    'always',
    'success',
    'failure',
    'cancelled',
    'contains',
    'startsWith',
    'endsWith',
    'format',
    'join',
    'toJSON',
    'fromJSON',
  ])

  it('n’emploie, au niveau d’un job, que ce que GitHub y rend disponible', () => {
    const conditions = jobLevelConditions()

    // Garde contre l'inertie : un balayage qui ne trouve rien rendrait la
    // boucle suivante vraie sur zéro condition.
    expect(conditions.length).toBeGreaterThan(0)

    for (const { job, expression } of conditions) {
      const { functions, contexts } = referencesOf(expression)

      for (const name of functions) {
        expect(FUNCTIONS.has(name), `\`${job}\` appelle \`${name}()\` dans son \`if:\` de job`).toBe(
          true,
        )
      }

      for (const name of contexts) {
        expect(CONTEXTS.has(name), `\`${job}\` lit \`${name}\` dans son \`if:\` de job`).toBe(true)
      }
    }
  })

  it('reste armé par la donnée : un job sonde mesure les enregistrements, le parcours en dépend', () => {
    const source = workflow()
    const condition = jobLevelConditions().find((entry) => entry.job === 'parcours-dore')

    // L'armement lui-même : le parcours ne s'exécute que sur la sortie d'un
    // autre job, jamais sur un drapeau posé à la main.
    expect(condition?.expression).toMatch(/needs\.enregistrements\.outputs\./)
    expect(source).toMatch(/^ {4}needs: enregistrements$/m)

    // Et ce que ce job mesure : l'existence d'un enregistrement, `hashFiles`
    // étant appelé là où GitHub l'autorise — au niveau d'une étape.
    expect(source).toMatch(
      /^ {8,}[A-Z_]+: \$\{\{ hashFiles\('tests\/fixtures\/stripe-events\/\*\.json'\) \}\}$/m,
    )
  })

  /**
   * Le constat F8 de la première revue, une seconde fois : le job téléversait
   * un dossier qui n'existait pas. Il existe désormais — la commande recopie
   * les traces hors du clone qu'elle détruit —, mais il vivait sous
   * `test-results/`, que **Playwright efface au démarrage** de `pnpm test:e2e`
   * (son `outputDir` par défaut). Une trace conservée puis balayée par la suite
   * suivante ne se distingue pas d'une trace jamais écrite.
   */
  it('téléverse le dossier de traces que la commande conserve, hors de celui que `pnpm test:e2e` efface', () => {
    expect(FAILURE_TRACES_DIRECTORY).not.toMatch(/^test-results(\/|$)/)
    expect(workflow()).toContain(`path: ${FAILURE_TRACES_DIRECTORY}/`)
  })
})
