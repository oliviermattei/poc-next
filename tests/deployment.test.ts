import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { BUILD_ENV_KEYS, ENV_KEYS } from '@repo/config'

import { COLD_GRAPH_TIMEOUT_MS } from './fixtures/intermittents'

/**
 * **Le délai de ce fichier, explicite et mesuré** (s52, cause A).
 *
 * Ce fichier charge `apps/web/instrumentation`, donc `startup.ts` et tous les
 * points de composition, chaque fois précédé d'un `vi.resetModules()` qui force
 * la re-transformation complète. Le défaut de Vitest est 5 000 ms — exactement
 * la valeur des expirations observées : mesuré à saturation du processeur, le
 * premier import du graphe coûte 6 875 à 7 576 ms contre 1 507 ms à vide. Le
 * détail de la mesure et la raison du chiffre sont sur la constante.
 *
 * Posé sur le **fichier** et non sur un cas nommé : le coût tombe sur le
 * premier cas qui touche le graphe, et l'ordre des blocs n'est pas figé.
 */
vi.setConfig({ testTimeout: COLD_GRAPH_TIMEOUT_MS })

const readRepoFile = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8')

/**
 * Un motif de `.dockerignore`, rendu en expression régulière.
 *
 * Ce que cette traduction couvre, décrit plutôt que promis : les segments
 * littéraux, `*` (qui ne traverse pas `/`), `?`, et `**` (qui traverse). Elle
 * ne couvre ni les classes `[a-z]`, ni l'échappement `\\*` — il n'y en a
 * aucune dans le fichier à ce jour. Docker applique le **dernier** motif qui
 * correspond, `!` niant l'exclusion ; et exclure un dossier exclut son contenu,
 * d'où la comparaison sur chaque préfixe du chemin.
 */
const dockerPatternToRegExp = (pattern: string): RegExp => {
  const segments = pattern
    .replace(/^\.\//, '')
    .replace(/\/+$/, '')
    .split('/')

  let body = ''

  segments.forEach((segment, index) => {
    const last = index === segments.length - 1

    if (segment === '**') {
      // `**` traverse les séparateurs ; en position finale, il prend le reste.
      body += last ? '.*' : '(?:[^/]+/)*'

      return
    }

    body += segment
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')

    if (!last) {
      body += '/'
    }
  })

  return new RegExp(`^${body}$`)
}

/** Le chemin serait-il retiré du contexte de build ? */
const isIgnoredByDocker = (path: string): boolean => {
  const patterns = readRepoFile('.dockerignore')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))

  const segments = path.split('/')
  const prefixes = segments.map((_, index) => segments.slice(0, index + 1).join('/'))

  let ignored = false

  for (const pattern of patterns) {
    const negated = pattern.startsWith('!')
    const expression = dockerPatternToRegExp(negated ? pattern.slice(1) : pattern)

    if (prefixes.some((prefix) => expression.test(prefix))) {
      ignored = !negated
    }
  }

  return ignored
}

/**
 * **La garde de démarrage, au point que la sortie autonome atteint.**
 *
 * `apps/web/next.config.ts` valide l'environnement au chargement, et
 * `tests/env-wiring.test.ts` énumère là-bas les états qu'il refuse. Mais
 * `output: 'standalone'` (s27) sérialise la configuration dans `server.js` :
 * **`next.config.ts` n'est plus exécuté au démarrage du serveur**. La frontière
 * était déjà écrite dans `packages/config/src/env.ts` (constats N15/N16 de s01),
 * et mesurée ici : le serveur autonome démarrait avec un environnement
 * entièrement vide, `/api/health` répondant 503 pour toujours.
 *
 * `apps/web/instrumentation.ts` est le point que Next appelle une fois au
 * démarrage du serveur, en `next dev`, en `next start` **et** en sortie
 * autonome. Un seul témoin de refus ici : l'énumération des états refusés vit
 * à la règle, dans `tests/env-wiring.test.ts`. Ce cas-ci prouve que la règle
 * est invoquée du tout.
 */
describe('la validation au démarrage, sur le chemin de la sortie autonome', () => {
  const BUILD_PHASE = 'phase-production-build'

  /**
   * Tout ce que la garde lit, déclaré en entier : un cas qui n'annonce que
   * `DATABASE_URL` ne passerait que sur un poste dont le `.env` complète le
   * reste (revue de s06, G1). La chaîne vide vaut absence, et c'est la seule
   * forme qui tienne — `loadRootEnv` repeuplerait une variable supprimée.
   */
  const stubEverything = (databaseUrl: string): void => {
    vi.stubEnv('DATABASE_URL', databaseUrl)
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('EMAIL_FROM', '')
    vi.stubEnv('EMAIL_LOCAL_CAPTURE', '1')
    vi.stubEnv('AUTH_SECRET', 'x'.repeat(40))
    vi.stubEnv('APP_URL', 'http://localhost:3000')
    vi.stubEnv('STORAGE_S3_BUCKET', '')
    vi.stubEnv('STORAGE_S3_REGION', '')
    vi.stubEnv('STORAGE_S3_ACCESS_KEY_ID', '')
    vi.stubEnv('STORAGE_S3_SECRET_ACCESS_KEY', '')
    vi.stubEnv('STORAGE_LOCAL_DIRECTORY', '.storage')
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '')
    vi.stubEnv('PAYMENTS_LOCAL_MODE', '1')
    vi.stubEnv('INNGEST_EVENT_KEY', '')
    vi.stubEnv('INNGEST_SIGNING_KEY', '')
    vi.stubEnv('INNGEST_BASE_URL', '')
    vi.stubEnv('JOBS_LOCAL_RUNNER', '1')
    vi.stubEnv('NEXT_PHASE', '')
    vi.stubEnv('SKIP_ENV_VALIDATION', '')
    // Le runtime que Next pose sur le serveur : c'est celui-là que la garde
    // couvre. Sur *edge*, `register` ne fait rien et n'importe rien.
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
  }

  /**
   * **Le processus doit mourir, pas seulement se plaindre.**
   *
   * Mesuré sur la première version : `register` levait, Next journalisait
   * « Failed to prepare server » puis `unhandledRejection` — et **laissait le
   * processus vivant**, à répondre 500 sur chaque requête. Un conteneur dans
   * cet état est « running » pour son orchestrateur : c'est un déploiement
   * cassé qui a l'air vert, exactement ce que `docs/reliability.md` interdit.
   */
  const registerWithFatalExit = async (): Promise<{
    exitCodes: number[]
    logged: string
  }> => {
    vi.resetModules()

    const exitCodes: number[] = []
    const logged: string[] = []

    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCodes.push(code ?? 0)

      // Le vrai `process.exit` ne rend jamais la main : sans cette
      // interruption, la suite du code s'exécuterait comme si de rien n'était.
      throw new Error('process.exit')
    }) as never)
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    })

    const { register } = await import('../apps/web/instrumentation')

    try {
      await register()
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'process.exit') {
        throw error
      }
    }

    return { exitCodes, logged: logged.join('\n') }
  }

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('refuse le démarrage sur une `DATABASE_URL` malformée : il sort en erreur, en la nommant', async () => {
    stubEverything('mysql://oops@localhost/x')

    const { exitCodes, logged } = await registerWithFatalExit()

    expect(exitCodes).toEqual([1])
    expect(logged).toMatch(/DATABASE_URL/)
  })

  it('démarre sur un environnement bien formé', async () => {
    stubEverything('postgres://app:app@127.0.0.1:1/app')

    const { exitCodes } = await registerWithFatalExit()

    expect(exitCodes).toEqual([])
  })

  it('laisse passer la phase de build, qui n’a pas les variables d’exécution', async () => {
    // `next build` exécute lui aussi l'instrumentation, dans ses processus de
    // génération. La garde y hérite de la même échappatoire que `next.config` —
    // `AGENTS.md` : « le build n'a pas besoin des variables d'exécution ».
    stubEverything('mysql://oops@localhost/x')
    vi.stubEnv('NEXT_PHASE', BUILD_PHASE)

    const { exitCodes } = await registerWithFatalExit()

    expect(exitCodes).toEqual([])
  })
})

/**
 * **Les migrations avant le basculement du trafic** (critère 3 de la story).
 *
 * Un conteneur distinct les joue, et l'application ne démarre que s'il a
 * **réussi**. Ce n'est ni un `postinstall` — qui les jouerait à l'installation,
 * hors de tout déploiement — ni une étape du démarrage de l'application, qui
 * ferait basculer le trafic sur une version dont le schéma a échoué à moitié.
 *
 * Ce que ce balayage lit, décrit plutôt que promis : les blocs de service de
 * premier niveau de `docker-compose.prod.yml`, repérés par leur indentation de
 * deux espaces sous `services:`. Il ne comprend pas le YAML — il n'y a pas
 * d'analyseur dans ce dépôt, et `tests/golden-path.test.ts` balaie déjà
 * `ci.yml` de la même façon. Une réécriture du fichier en YAML de flux
 * (`{a: 1}`) échapperait à ce balayage ; il n'y en a aucune à ce jour.
 */
describe('la pile de production', () => {
  const COMPOSE = 'docker-compose.prod.yml'
  const ENVIRONMENT_ANCHOR = 'x-application-environment'

  /** Les lignes d'un service, sans son nom. */
  const serviceBlock = (name: string): string => {
    const lines = readRepoFile(COMPOSE).split('\n')
    const start = lines.findIndex((line) => line === `  ${name}:`)

    if (start === -1) {
      throw new Error(`Aucun service \`${name}\` dans \`${COMPOSE}\`.`)
    }

    const rest = lines.slice(start + 1)
    const end = rest.findIndex((line) => /^ {0,2}\S/.test(line))

    return (end === -1 ? rest : rest.slice(0, end)).join('\n')
  }

  it('ne démarre l’application qu’après des migrations réussies', () => {
    const web = serviceBlock('web')

    // `service_completed_successfully` est le seul état qui interrompe : avec
    // `service_started`, l'application démarrerait pendant que les migrations
    // tournent, et une migration en échec ne l'empêcherait pas de servir un
    // schéma à moitié appliqué.
    expect(web).toMatch(/migrate:\s*\n\s*condition: service_completed_successfully/)

    // Et les migrations attendent une base qui écoute : sinon elles échouent
    // sur une connexion refusée, et l'application ne démarre jamais.
    expect(serviceBlock('migrate')).toMatch(/postgres:\s*\n\s*condition: service_healthy/)
  })

  it('sert l’application sur un port configurable, jamais figé', () => {
    // Critère 2. Le port du poste appartient à l'exploitant : le figer dans le
    // fichier oblige à l'éditer pour héberger deux piles sur une machine.
    expect(serviceBlock('web')).toMatch(/^ {6}- '\$\{[A-Z_]+(:-\d+)?\}:\d+'$/m)
  })

  /**
   * **Les conteneurs reçoivent la configuration, et pas seulement
   * l'interpolation du fichier** (constat F5 de la revue de s27).
   *
   * Mesuré : `env_file` seul ne sert que l'exploitant qui **écrit un fichier**.
   * Une plateforme qui *exporte* ses variables — c'est le chemin que le guide
   * Coolify recommande — interpole correctement `${APP_PORT}` et ne donne
   * **rien** aux conteneurs, qui démarrent alors sur une configuration vide.
   * Mesuré aussi, et c'est ce qui interdit de cumuler les deux : une entrée
   * `environment: - CLE` dont la variable n'est pas posée à l'interpolation
   * **efface** la valeur venue d'`env_file` — la variable disparaît de
   * l'environnement du conteneur.
   *
   * Une seule voie, donc : l'interpolation. Elle est alimentée par
   * `--env-file`, par le `.env` que Compose lit par défaut, ou par les
   * variables exportées par la plateforme.
   *
   * La liste est **dérivée** d'`ENV_KEYS`, dans les deux sens : une variable
   * ajoutée au schéma et non transmise ferait démarrer les conteneurs sans
   * elle, et une variable transmise qui n'existe plus mentirait à l'exploitant.
   */
  it('transmet aux conteneurs exactement les variables du schéma, ni plus ni moins', () => {
    const lines = readRepoFile(COMPOSE).split('\n')
    const start = lines.findIndex((line) => line.startsWith(`${ENVIRONMENT_ANCHOR}:`))

    if (start === -1) {
      throw new Error(`Aucun bloc \`${ENVIRONMENT_ANCHOR}\` dans \`${COMPOSE}\`.`)
    }

    const keys: string[] = []

    for (const line of lines.slice(start + 1)) {
      const entry = /^ {2}([A-Z][A-Z0-9_]*): \$\{([A-Z][A-Z0-9_]*)(?::-[^}]*)?\}$/.exec(line)

      if (entry === null) {
        break
      }

      // La clé et la variable interpolée sont la même : `CLE: ${AUTRE}` ferait
      // recevoir au conteneur la valeur d'une autre variable.
      expect(entry[2], `\`${entry[1] ?? ''}\` reçoit la valeur d’une autre variable`).toBe(entry[1])
      keys.push(entry[1] ?? '')
    }

    expect([...keys].sort()).toEqual([...ENV_KEYS].sort())

    // Et les deux conteneurs le reçoivent : le bloc seul ne prouve rien s'il
    // n'est référencé nulle part. `migrate` en a besoin autant que `web` —
    // `pnpm db:migrate` ouvre la base par `getEnv`, qui valide tout le schéma.
    for (const service of ['web', 'migrate']) {
      expect(
        serviceBlock(service),
        `le service \`${service}\` ne reçoit pas la configuration`,
      ).toMatch(new RegExp(`environment: \\*${ENVIRONMENT_ANCHOR.slice(2)}`))
    }
  })

  it('n’écrit aucun secret : tout vient de l’environnement de l’exploitant', () => {
    const source = readRepoFile(COMPOSE)

    expect(source).not.toMatch(/\b(sk_live|sk_test|pk_live|whsec_|AKIA|re_)[A-Za-z0-9_-]+/)
  })
})

/**
 * **L'étape d'exécution n'hérite pas de la permissivité de l'étape de
 * construction.**
 *
 * Le build s'exécute sans les variables d'exécution — `AGENTS.md` l'exige — et
 * ne le peut que par l'échappatoire de `packages/config/src/env.ts` :
 * `NEXT_PHASE` et `SKIP_ENV_VALIDATION`. Posée par un `ENV` d'étape, elle
 * serait héritée par toutes les étapes qui en descendent, et l'image démarrerait
 * en production **sans valider sa configuration** — verte, silencieuse et
 * cassée. C'est le défaut que s26 a trouvé sur les clones, transposé à Docker.
 *
 * La liste des clés est **dérivée** de `BUILD_ENV_KEYS` : une troisième
 * échappatoire ajoutée au module de configuration tombe sous cette garde sans
 * qu'on retouche ce fichier.
 */
describe('l’image de production', () => {
  const dockerfile = (): string => readRepoFile('Dockerfile')

  it('ne pose l’échappatoire de build dans aucune étape : seule la commande de build la porte', () => {
    // Garde contre l'inertie : un balayage qui ne trouve aucune clé rendrait la
    // boucle suivante vraie sur rien.
    expect(BUILD_ENV_KEYS.length).toBeGreaterThan(0)

    const declarations = [...dockerfile().matchAll(/^\s*(?:ENV|ARG)\s+([A-Za-z_][\w]*)/gm)].map(
      (match) => match[1] ?? '',
    )

    for (const key of BUILD_ENV_KEYS) {
      expect(declarations, `\`${key}\` est posée pour toute une étape`).not.toContain(key)
    }
  })

  /**
   * **La sonde de l'image suit le port que l'image rend variable** (constat F4
   * de la revue de s27).
   *
   * `ENV PORT` est surchargeable — c'est ainsi qu'un orchestrateur choisit le
   * port d'écoute. Une sonde qui fige `3000` rend alors un conteneur
   * perpétuellement `unhealthy` **tout en servant correctement** : sur une
   * plateforme qui agit sur la santé, c'est une boucle de redéploiement sur une
   * application qui marche.
   */
  it('sonde le port sur lequel l’image écoute, jamais un port figé', () => {
    const source = dockerfile()

    // Garde contre l'inertie : sans `ENV PORT`, il n'y aurait aucun port
    // variable, et le cas serait vrai sans rien vérifier.
    expect(source).toMatch(/^ENV PORT=/m)

    const healthcheck = /^HEALTHCHECK[\s\S]*?\n\s+CMD (.+)$/m.exec(source)?.[1] ?? ''

    expect(healthcheck).not.toBe('')
    expect(healthcheck).toMatch(/\$\{?PORT/)
  })

  it('recopie les fichiers statiques que la sortie autonome ne trace pas', () => {
    // Dérivé du disque : tout dossier servi tel quel par Next (`public/`) doit
    // être recopié dans l'étape d'exécution. Next ne le trace pas — il n'est
    // importé par aucun module —, et une image de partage qui répond 404 ne
    // montre aucun aperçu (s53).
    const served = fileURLToPath(new URL('../apps/web/public', import.meta.url))

    // Garde contre l'inertie : sans fichier servi, la règle ne dirait rien.
    expect(existsSync(served) && readdirSync(served).length > 0).toBe(true)
    expect(dockerfile()).toContain('/repo/apps/web/public ./apps/web/public')
  })

  it('ne copie aucun `.env` ni aucune clé dans l’image', () => {
    // Le `COPY . .` de l'étape de construction prend le contexte entier : ce
    // n'est pas lui qu'on inspecte, c'est ce que `.dockerignore` en retire.
    for (const path of [
      '.env',
      '.env.local',
      '.env.production',
      '.env.example',
      'apps/web/.env',
      'packages/config/.env.local',
      'certificat.pem',
      'apps/web/cle.pem',
    ]) {
      expect(isIgnoredByDocker(path), `\`${path}\` entrerait dans le contexte de build`).toBe(true)
    }
  })

  it('laisse entrer ce que la construction lit — sans quoi le balayage ci-dessus serait vide de sens', () => {
    // Un `.dockerignore` réduit à `*` satisferait le cas précédent et
    // n'exclurait plus rien de significatif : l'image ne se construirait même
    // pas. Ces chemins-ci sont ceux que l'étape de construction lit vraiment.
    for (const path of [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'config/features.ts',
      'apps/web/next.config.ts',
      'apps/web/instrumentation.ts',
      'packages/config/src/env.ts',
    ]) {
      expect(isIgnoredByDocker(path), `\`${path}\` n’atteindrait pas la construction`).toBe(false)
    }
  })
})

/**
 * **La checklist des variables de production** (critère 4), et la seule forme
 * qui ne mente pas : **dérivée du schéma**, jamais recopiée.
 *
 * `ENV_KEYS` vient de `envShape` (`packages/config/src/env.ts`). Une liste
 * écrite à la main dans un guide de déploiement est fausse à la première
 * variable ajoutée, et personne ne s'en aperçoit — c'est le déploiement suivant
 * qui échoue, sur une variable que la documentation n'a jamais nommée.
 *
 * La comparaison mord **dans les deux sens** : une variable du schéma absente
 * du guide, et une variable documentée qui n'existe plus. Sans le second sens,
 * une variable supprimée du schéma resterait à jamais dans la checklist, et
 * l'exploitant renseignerait une variable que plus rien ne lit.
 */
describe('la checklist des variables de production', () => {
  const GUIDE = 'docs/deployment.md'

  /**
   * Les clés de la première colonne du tableau qui suit un titre.
   *
   * Une colonne de tableau, et non un balayage du texte : un nom contenu dans
   * un autre (`APP_URL` dans `APP_URL_INTERNE`) serait « couvert » par lui, et
   * la garantie serait une illusion.
   */
  const checklistKeys = (heading: string): string[] => {
    const lines = readRepoFile(GUIDE).split('\n')
    const start = lines.indexOf(heading)

    if (start === -1) {
      throw new Error(`Aucun titre \`${heading}\` dans \`${GUIDE}\`.`)
    }

    const keys: string[] = []
    let seenTable = false

    for (const line of lines.slice(start + 1)) {
      if (line.startsWith('#')) {
        break
      }

      const cell = /^\| *`([A-Z][A-Z0-9_]*)` *\|/.exec(line)

      if (cell !== null) {
        seenTable = true
        keys.push(cell[1] ?? '')
        continue
      }

      // Le tableau fini, on s'arrête : la section suivante peut en porter un
      // autre, et les deux ne se mélangent pas.
      if (seenTable && !line.startsWith('|')) {
        break
      }
    }

    return keys
  }

  it('nomme exactement les variables que le schéma déclare, ni plus ni moins', () => {
    expect([...checklistKeys('## Les variables de l’application')].sort()).toEqual(
      [...ENV_KEYS].sort(),
    )
  })

  it('nomme exactement les variables qui désactivent la validation, et dit de ne pas les poser', () => {
    // Elles ne sont pas dans le schéma — c'est l'outillage qui les pose — mais
    // ce sont elles qui font démarrer une image sans vérifier sa configuration.
    // Une checklist de production qui ne les nomme pas laisse l'exploitant les
    // poser « pour que ça passe ».
    expect([...checklistKeys('### Les deux variables à ne jamais poser en production')].sort()).toEqual(
      [...BUILD_ENV_KEYS].sort(),
    )
  })
})
