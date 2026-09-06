import { parse as parseYaml } from 'yaml'

/**
 * **Les règles du régime « sans `.env` »** (s55), isolées de la commande qui les
 * exécute — même forme que `scripts/socle-rules.ts` face à `scripts/socle.ts`,
 * et pour la même raison : une règle enfermée dans un script n'est éprouvable
 * qu'en lançant le script, donc en pratique jamais.
 *
 * ## L'interdit central : aucune variable n'est nommée ici
 *
 * Ce fichier ne connaît le nom d'aucune variable d'environnement. Ce que la CI
 * fournit à `pnpm test` est **dérivé de `.github/workflows/ci.yml`**, c'est-à-dire
 * de la seule définition qu'en ait ce dépôt. Une seconde liste, écrite ici,
 * vieillirait à côté du workflow au premier ajout — et c'est très exactement le
 * défaut que cette story existe pour empêcher, appliqué à elle-même.
 *
 * Et la CI ne fournit pas *rien* : reproduire l'absence **totale** ferait rougir
 * des fichiers corrects, et une porte qui rougit à tort finit désarmée (P8).
 */

export class SansEnvConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SansEnvConfigurationError'
  }
}

const fail = (message: string): never => {
  throw new SansEnvConfigurationError(message)
}

const quote = (value: string): string => `« ${value} »`

/**
 * La suite unitaire, et elle seule : `pnpm test:e2e`, `pnpm test:socle` et les
 * autres recettes portent leur propre environnement, et les confondre ferait
 * fournir au régime des variables que `pnpm test` n'a jamais reçues en CI.
 */
const TEST_COMMAND = /\bpnpm test(?![\w:-])/

interface WorkflowShape {
  readonly jobs?: Readonly<Record<string, JobShape>>
}

interface JobShape {
  readonly env?: Readonly<Record<string, unknown>>
  readonly steps?: readonly { readonly run?: unknown }[]
}

/**
 * **Ce que la CI fournit à la suite unitaire**, lu dans son fichier de workflow.
 *
 * Trois refus, et le troisième est le plancher de la commande entière :
 *
 * 1. **aucun job ne joue `pnpm test`** — la dérivation n'a pas de source, et un
 *    ensemble deviné vaudrait moins que rien ;
 * 2. **plusieurs jobs la jouent** — lequel décrit le régime ? Plutôt que de
 *    choisir en silence, on refuse en les nommant ;
 * 3. **le job ne déclare aucune variable** — la commande reproduirait alors
 *    l'absence *totale*, ferait rougir des fichiers que la CI accepte, et
 *    finirait désarmée. Le « balayage vide » de s26, transposé.
 */
export function ciTestJobEnvironment(workflow: string): Readonly<Record<string, string>> {
  const parsed = parseYaml(workflow) as WorkflowShape | null
  const jobs = Object.entries(parsed?.jobs ?? {})

  const playing = jobs.filter(([, job]) =>
    (job.steps ?? []).some((step) => typeof step.run === 'string' && TEST_COMMAND.test(step.run)),
  )

  if (playing.length === 0) {
    fail(
      `Aucun job du workflow ne joue ${quote('pnpm test')} : le régime sans ${quote('.env')} ` +
        'n’a alors aucune source d’où dériver ce que la CI fournit, et un ensemble deviné ' +
        'ferait rougir des fichiers corrects.',
    )
  }

  if (playing.length > 1) {
    fail(
      `Plusieurs jobs du workflow jouent ${quote('pnpm test')} — ` +
        `${playing.map(([name]) => quote(name)).join(', ')}. Lequel décrit le régime ? ` +
        'La dérivation refuse plutôt que de choisir en silence.',
    )
  }

  const [name, job] = playing[0] as [string, JobShape]
  const declared = Object.entries(job.env ?? {})

  if (declared.length === 0) {
    fail(
      `Le job ${quote(name)} joue ${quote('pnpm test')} sans déclarer aucune variable ` +
        'd’environnement. La commande reproduirait l’absence totale, qui n’est pas le régime ' +
        'de la CI : elle rougirait sur des fichiers corrects, et une porte qui rougit à tort ' +
        'finit désarmée.',
    )
  }

  return Object.fromEntries(declared.map(([key, value]) => [key, String(value)]))
}

/**
 * **Ce que le régime remet à la suite** : les noms viennent du workflow, les
 * valeurs du poste quand il en a une.
 *
 * La CI écrit sa base à elle (`localhost:5432`), et la recopier ici ferait
 * sauter les cas d'intégration — donc mesurer un régime plus étroit que celui
 * de la CI, ce qui est la même faute que le mesurer plus large. Une variable que
 * le poste ne connaît pas garde la valeur du workflow : c'est ce qui fait de
 * `EMAIL_LOCAL_CAPTURE` et `PAYMENTS_LOCAL_MODE` des drapeaux hérités de la CI
 * et non des choix locaux.
 *
 * Une valeur locale **vide vaut absente**, comme partout dans ce dépôt : c'est
 * la forme naturelle d'une variable déclarée mais non renseignée.
 */
export function sansEnvVariables(input: {
  readonly workflow: string
  readonly local: Readonly<Record<string, string | undefined>>
}): Readonly<Record<string, string>> {
  const fromCi = ciTestJobEnvironment(input.workflow)

  return Object.fromEntries(
    Object.entries(fromCi).map(([name, value]) => {
      const local = input.local[name]

      return [name, local === undefined || local === '' ? value : local]
    }),
  )
}

/** La variable par laquelle la commande dit au préambule quel fichier retirer. */
export const HIDDEN_FILE_KEY = 'SANS_ENV_HIDDEN_FILE'

/**
 * **L'environnement du sous-processus : celui du système, et rien de
 * l'application.**
 *
 * Même geste que `cloneEnvironment` (`scripts/minimal-profile-rules.ts`) et
 * même raison : un `AUTH_SECRET` exporté par le shell — ou chargé par un parent
 * distrait — rendrait la commande verte sur le fichier même qu'elle existe pour
 * attraper. Retirer le `.env` du disque ne suffit pas si la configuration du
 * poste voyage dans l'environnement.
 *
 * `appKeys` est reçu plutôt que lu : c'est la discipline des autres recettes, et
 * sans elle aucun test ne pourrait éprouver un autre schéma que celui du dépôt.
 */
export function sansEnvEnvironment(input: {
  readonly parent: Readonly<Record<string, string | undefined>>
  readonly appKeys: readonly string[]
  readonly variables: Readonly<Record<string, string>>
  readonly hiddenFile: string
}): Record<string, string | undefined> {
  const application = new Set<string>(input.appKeys)

  const kept = Object.fromEntries(
    Object.entries(input.parent).filter(([key]) => !application.has(key)),
  )

  return { ...kept, ...input.variables, [HIDDEN_FILE_KEY]: input.hiddenFile }
}

/** La forme minimale de `node:fs` dont le retrait a besoin. */
export interface FileReader {
  existsSync: (path: string) => boolean
  readFileSync: (path: string, ...rest: never[]) => unknown
}

/**
 * **Le mécanisme du régime : le fichier devient introuvable, pas invisible.**
 *
 * P25bis l'a établi — désarmer les variables du shell ne reproduit rien, puisque
 * `loadRootEnv()` relit le fichier sur le disque quel que soit l'environnement.
 * La forme fidèle est donc « pas de `.env` du tout ».
 *
 * Trois mécanismes ont été mesurés sur ce dépôt (s55), et deux sont écartés :
 *
 * 1. **renommer le `.env`** — le plus fidèle (les sous-processus le perdent
 *    aussi), et le seul qui bascule le dépôt : une commande interrompue laisse
 *    le poste sans sa configuration, ce que les autres recettes refusent
 *    explicitement (« elle travaille dans une copie, elle ne bascule jamais le
 *    dépôt ») ;
 * 2. **déplacer le répertoire courant** hors du dépôt, ou dans une forêt de
 *    liens sans `.env` — mesuré : 26 cas rouges avec la forêt comme racine de
 *    Vitest, 2 avec le dépôt comme racine, tous sur des fichiers corrects. Le
 *    répertoire courant n'est pas neutre ici : `findRootEnvPath()` en dépend, et
 *    `tests/env-wiring.test.ts` l'éprouve ;
 * 3. **rendre le fichier absent à la lecture**, ce que fait cette fonction :
 *    chemins, résolution de modules et répertoire courant restent ceux de
 *    `pnpm test`, et les deux régimes rendent **les mêmes comptes de cas passés
 *    et sautés**. Aucun nombre n'est écrit ici : il vieillirait à la première
 *    story — celui de la première rédaction avait vieilli dans le commit qui
 *    l'introduisait —, et `pnpm test:sans-env` journalise le sien à chaque
 *    exécution, à comparer à celui de `pnpm test`.
 *
 * Deux choses qu'elle **ne** couvre **pas**, et que seule la première option
 * couvrirait :
 *
 * - un sous-processus lancé par un cas (`pnpm ks`, ESLint, `drizzle-kit`) lit le
 *   disque avec son propre `node:fs` et retrouve donc le `.env`. Son
 *   environnement, lui, reste celui du régime (`sansEnvEnvironment`) ;
 * - un lecteur qui prendrait `node:fs` par un **import ESM nommé**
 *   (`import { readFileSync } from 'node:fs'`) lit un espace de noms figé à la
 *   première importation : la modification porte sur `module.exports`, donc sur
 *   la vue CommonJS — celle de `dotenv`, c'est-à-dire le chemin de P25bis, le
 *   seul par lequel ce dépôt lise un `.env` aujourd'hui. Le cas canari de
 *   `tests/sans-env.test.ts` lit par `createRequire` pour cette raison.
 */
export function hideFileFromReads(fs: FileReader, hidden: string): void {
  const existsSync = fs.existsSync.bind(fs)
  const readFileSync = fs.readFileSync.bind(fs)

  fs.existsSync = (path: string, ...rest: never[]): boolean =>
    path === hidden ? false : existsSync(path, ...(rest as []))

  fs.readFileSync = (path: string, ...rest: never[]): unknown => {
    if (path === hidden) {
      const error: NodeJS.ErrnoException = new Error(
        `ENOENT: no such file or directory, open '${hidden}'`,
      )
      error.code = 'ENOENT'
      error.errno = -2
      error.path = hidden

      throw error
    }

    return readFileSync(path, ...rest)
  }
}

/**
 * Le fichier que le préambule doit retirer, **refusé s'il n'est pas dit**.
 *
 * Sans ce refus, un préambule chargé hors de la commande ne cacherait rien : la
 * suite tournerait avec le `.env` du poste, sous le nom du régime qui ne l'a pas
 * — un vert qui ne dit rien, exactement ce que la story combat.
 */
export function hiddenFilePath(source: Readonly<Record<string, string | undefined>>): string {
  const path = source[HIDDEN_FILE_KEY]

  if (path === undefined || path === '') {
    return fail(
      `Le préambule du régime sans ${quote('.env')} a été chargé sans ${quote(HIDDEN_FILE_KEY)} : ` +
        'il ne retirerait aucun fichier, et la suite lirait le `.env` du poste sous le nom du ' +
        'régime qui ne l’a pas. Lancer `pnpm test:sans-env`, qui pose cette variable.',
    )
  }

  return path
}

/** Un fichier de la suite, réduit à ce que le rapport de Vitest en dit d'utile. */
export interface SuiteFileResult {
  readonly name: string
  readonly failed: boolean
  readonly messages: readonly string[]
}

/**
 * **Ce que l'échec doit dire : quel fichier, et quelle variable.**
 *
 * Un rouge qui annonce « quelque chose manque » coûte le même aller-retour que
 * la CI, et la commande n'aurait alors aucune raison d'exister. Les noms sont
 * cherchés dans les messages d'échec, et **confrontés au schéma reçu** : rien
 * n'est deviné, et une variable ajoutée au schéma est couverte sans qu'une ligne
 * bouge ici.
 *
 * Les bornes du motif ne sont pas décoratives : `APP_URL` est contenu dans
 * `NEXT_PUBLIC_APP_URL`, et la couverture par sous-chaîne nommerait la mauvaise
 * variable à quelqu'un venu corriger un fichier.
 *
 * C'est un **rapport**, pas le verdict : le verdict est le code de sortie de
 * Vitest. Un échec qui ne cite aucune variable reste un échec.
 */
export function undeclaredVariables(
  files: readonly SuiteFileResult[],
  appKeys: readonly string[],
): readonly { readonly name: string; readonly variables: readonly string[] }[] {
  const named = files
    .filter((file) => file.failed)
    .map((file) => ({
      name: file.name,
      variables: appKeys.filter((key) =>
        file.messages.some((message) =>
          new RegExp(`(?<![A-Z0-9_])${key}(?![A-Z0-9_])`).test(message),
        ),
      ),
    }))

  return named.filter((file) => file.variables.length > 0)
}

/**
 * **Le titre du cas canari**, écrit une seule fois : `tests/sans-env.test.ts` le
 * porte comme titre, la commande le cherche dans le rapport. Deux écritures
 * divergeraient, et la commande chercherait un cas que plus personne ne joue.
 */
export const CANARY_TITLE = 'le canari : le `.env` du poste est réellement illisible sous le régime'

/**
 * **Le préambule était-il en vigueur ?**
 *
 * Tout le régime tient à une ligne de `vitest.sans-env.config.ts` — le
 * `setupFiles` qui charge `scripts/sans-env-setup.ts`. Neutralisée, la suite
 * tourne **avec** le `.env` du poste, aucun cas ne rougit pour la bonne raison,
 * et la commande journalise ses fichiers balayés en ne reproduisant rien. C'est
 * le défaut de s26, s48 puis s51, une quatrième fois, et il a été mesuré ici :
 * la revue de s55 a neutralisé cette ligne, remis le défaut cible dans
 * `tests/notifications.test.ts`, et le fichier est **passé**.
 *
 * `hiddenFilePath` ne ferme que le sens inverse — un préambule chargé sans
 * savoir quoi retirer. Celui-ci ferme « la commande tourne, le préambule ne se
 * charge jamais » : le canari est un cas de la suite, donc son absence du
 * rapport est constatable.
 */
export function assertCanaryRan(titles: readonly string[]): void {
  if (titles.includes(CANARY_TITLE)) {
    return
  }

  fail(
    `Le cas canari ${quote(CANARY_TITLE)} n’a pas tourné : rien ne prouve alors que le ` +
      'préambule qui retire le `.env` ait été en vigueur, et la suite a pu tourner avec la ' +
      'configuration du poste sous le nom du régime qui ne l’a pas. Vérifier le `setupFiles` de ' +
      '`vitest.sans-env.config.ts` et la présence du cas dans `tests/sans-env.test.ts`.',
  )
}

/**
 * **Le balayage a-t-il eu lieu ?**
 *
 * Une suite qui ne trouve aucun fichier sort verte : c'est le défaut trouvé en
 * s26, puis en s48, puis en s51, et il est d'autant plus probable ici que la
 * commande passe un `--config` et un `--root` à Vitest. Zéro fichier balayé est
 * un échec, jamais un succès silencieux.
 */
export function assertSweptFiles(count: number): void {
  if (count > 0) {
    return
  }

  fail(
    'La suite n’a balayé aucun fichier de test : la commande sortirait verte sans avoir rien ' +
      'vérifié. Vérifier la configuration passée à Vitest et ses motifs d’inclusion.',
  )
}
