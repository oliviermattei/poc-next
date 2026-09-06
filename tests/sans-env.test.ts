import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  assertCanaryRan,
  assertSweptFiles,
  CANARY_TITLE,
  ciTestJobEnvironment,
  HIDDEN_FILE_KEY,
  hideFileFromReads,
  hiddenFilePath,
  sansEnvEnvironment,
  sansEnvVariables,
  undeclaredVariables,
} from '../scripts/sans-env-rules'

/**
 * **Le régime « sans `.env` », mesuré au lieu d'être écrit** (s55).
 *
 * Un fichier de `tests/` qui atteint la configuration d'authentification sans
 * déclarer `AUTH_SECRET` et `APP_URL` est vert sur un poste — le `.env` du dépôt
 * les fournit — et rouge en CI, où le job n'apporte que trois variables. Trois
 * stories consécutives l'ont vécu ; la règle était écrite trois fois, et aucune
 * commande ne la vérifiait.
 *
 * Ce que ces cas éprouvent est **la dérivation**, pas la commande : l'ensemble
 * que le régime fournit est lu dans `.github/workflows/ci.yml`, jamais recopié.
 * Une liste écrite dans le script vieillirait à côté du workflow — le défaut que
 * la story existe pour empêcher, appliqué à elle-même.
 */

const WORKFLOW = readFileSync(
  fileURLToPath(new URL('../.github/workflows/ci.yml', import.meta.url)),
  'utf8',
)

/** Un workflow d'essai : la dérivation s'éprouve sur une forme, pas sur ce dépôt. */
const workflowOf = (options: {
  readonly env?: readonly string[]
  readonly run?: string
  readonly job?: string
}): string =>
  [
    'jobs:',
    `  ${options.job ?? 'quality'}:`,
    ...(options.env === undefined
      ? []
      : ['    env:', ...options.env.map((line) => `      ${line}`)]),
    '    steps:',
    '      - name: Une étape',
    `        run: ${options.run ?? 'pnpm test'}`,
  ].join('\n')

describe('l’environnement que la CI fournit à `pnpm test`, dérivé de son workflow', () => {
  it('lit le bloc `env:` du job qui joue la suite', () => {
    expect(
      ciTestJobEnvironment(workflowOf({ env: ["ALPHA: '1'", 'BETA: deux'] })),
    ).toEqual({ ALPHA: '1', BETA: 'deux' })
  })

  it('suit le workflow quand il gagne ou perd une variable', () => {
    // Le cas qui compte : la dérivation existe pour que la commande **suive**
    // le workflow. Une liste recopiée dans le script resterait la même sur ces
    // deux formes.
    const gagnee = ciTestJobEnvironment(
      workflowOf({ env: ["ALPHA: '1'", 'BETA: deux', 'GAMMA: trois'] }),
    )
    const perdue = ciTestJobEnvironment(workflowOf({ env: ["ALPHA: '1'"] }))

    expect(Object.keys(gagnee)).toContain('GAMMA')
    expect(Object.keys(perdue)).not.toContain('BETA')
  })

  it('ignore un job qui ne joue pas la suite, et son environnement', () => {
    // `pnpm test:e2e` n'est pas `pnpm test` : le job des parcours porte son
    // propre bloc `env:`, et le confondre ferait fournir au régime des
    // variables que la suite unitaire n'a jamais reçues.
    expect(() =>
      ciTestJobEnvironment(
        workflowOf({ env: ["ALPHA: '1'"], run: 'pnpm test:e2e', job: 'parcours' }),
      ),
    ).toThrow(/pnpm test/)
  })

  it('refuse un job qui joue la suite sans déclarer aucune variable', () => {
    // Le plancher de la commande entière : la CI ne fournit pas *rien*, et un
    // régime qui reproduirait l'absence totale rougirait sur des fichiers que
    // la CI accepte. Une porte qui rougit à tort finit désarmée (P8).
    expect(() => ciTestJobEnvironment(workflowOf({}))).toThrow(/quality/)
  })

  it('refuse un workflow où rien ne joue la suite', () => {
    expect(() => ciTestJobEnvironment(workflowOf({ env: ["ALPHA: '1'"], run: 'pnpm build' }))).toThrow(
      /pnpm test/,
    )
  })

  it('refuse deux jobs qui la jouent, plutôt que d’en choisir un en silence', () => {
    const deux = [
      workflowOf({ env: ["ALPHA: '1'"] }),
      workflowOf({ env: ["BETA: '2'"], job: 'autre' }).replace('jobs:\n', ''),
    ].join('\n')

    expect(() => ciTestJobEnvironment(deux)).toThrow(/autre/)
  })

  /**
   * **Le fichier réel** : c'est ce cas qui rougit le jour où la CI change ce
   * qu'elle fournit sans que la commande suive.
   */
  it('dérive du workflow du dépôt un ensemble non vide', () => {
    const environment = ciTestJobEnvironment(WORKFLOW)

    expect(Object.keys(environment).length).toBeGreaterThan(0)
    expect(Object.values(environment).every((value) => typeof value === 'string')).toBe(true)
  })
})

describe('le balayage, qui doit avoir eu lieu', () => {
  it('refuse une exécution qui n’a trouvé aucun fichier de test', () => {
    // Le défaut trouvé en s26, puis en s48, puis en s51 : une expression qui
    // cesse de correspondre rend la commande verte en ne vérifiant rien. Ici,
    // un `--config` mal résolu ou un motif d'inclusion changé suffirait.
    expect(() => assertSweptFiles(0)).toThrow(/aucun fichier/)
  })

  it('accepte un balayage qui a porté sur des fichiers', () => {
    expect(() => assertSweptFiles(1)).not.toThrow()
  })
})

describe('l’environnement remis à la suite', () => {
  const workflow = workflowOf({ env: ['DATABASE_URL: postgres://ci', "BETA: '1'"] })

  it('prend la valeur du poste quand il en a une, celle de la CI sinon', () => {
    // La CI écrit sa base à elle. Le poste a la sienne, et la suite doit
    // l'atteindre : ce sont les **noms** qui viennent du workflow, pas les
    // valeurs de tout ce qu'il déclare.
    expect(
      sansEnvVariables({ workflow, local: { DATABASE_URL: 'postgres://poste', BETA: '' } }),
    ).toEqual({ DATABASE_URL: 'postgres://poste', BETA: '1' })
  })

  it('ne laisse passer aucune variable d’application du poste', () => {
    // **Le cœur du régime.** Un `AUTH_SECRET` exporté par le shell — ou chargé
    // depuis le `.env` par un parent distrait — rendrait la commande verte sur
    // le fichier même qu'elle existe pour attraper.
    const child = sansEnvEnvironment({
      parent: { PATH: '/usr/bin', AUTH_SECRET: 'du poste', DATABASE_URL: 'du poste' },
      appKeys: ['AUTH_SECRET', 'APP_URL', 'DATABASE_URL'],
      variables: { DATABASE_URL: 'postgres://poste' },
      hiddenFile: '/dépôt/.env',
    })

    expect(child.AUTH_SECRET).toBeUndefined()
    expect(child.DATABASE_URL).toBe('postgres://poste')
    expect(child.PATH).toBe('/usr/bin')
    expect(child[HIDDEN_FILE_KEY]).toBe('/dépôt/.env')
  })
})

describe('le `.env` retiré de ce que la suite peut lire', () => {
  it('rend le fichier absent, et ne touche à aucun autre', () => {
    const lectures: string[] = []
    const fake = {
      existsSync: (path: string) => {
        lectures.push(path)
        return true
      },
      readFileSync: (path: string) => {
        lectures.push(path)
        return 'AUTH_SECRET=du poste'
      },
    }

    hideFileFromReads(fake, '/dépôt/.env')

    expect(fake.existsSync('/dépôt/.env')).toBe(false)
    expect(() => fake.readFileSync('/dépôt/.env')).toThrow(/ENOENT/)
    expect(fake.readFileSync('/dépôt/.env.example')).toBe('AUTH_SECRET=du poste')
    expect(lectures).toEqual(['/dépôt/.env.example'])
  })

  it('refuse de s’installer sans savoir quel fichier retirer', () => {
    // Sans ce refus, un préambule chargé hors de la commande ne cacherait rien
    // et la suite tournerait **avec** le `.env` du poste, sous le nom du régime
    // qui ne l'a pas.
    expect(() => hiddenFilePath({})).toThrow(new RegExp(HIDDEN_FILE_KEY))
    expect(hiddenFilePath({ [HIDDEN_FILE_KEY]: '/dépôt/.env' })).toBe('/dépôt/.env')
  })
})

describe('l’échec, qui doit nommer le fichier et la variable', () => {
  const appKeys = ['AUTH_SECRET', 'APP_URL', 'DATABASE_URL', 'RESEND_API_KEY']

  it('nomme le fichier en échec et les variables citées par son message', () => {
    // Le critère : un rouge qui dit « quelque chose manque » coûte le même
    // aller-retour que la CI. Le message doit permettre de corriger sans
    // relancer.
    expect(
      undeclaredVariables(
        [
          {
            name: 'tests/notifications.test.ts',
            failed: true,
            messages: [
              'Error: Authentification non configurée : renseignez AUTH_SECRET (32 caractères) ' +
                'et APP_URL (l’URL publique).',
            ],
          },
        ],
        appKeys,
      ),
    ).toEqual([{ name: 'tests/notifications.test.ts', variables: ['AUTH_SECRET', 'APP_URL'] }])
  })

  it('ne nomme pas une variable dont un autre nom la contient', () => {
    // Le piège de la couverture par sous-chaîne : `APP_URL` est contenu dans
    // `NEXT_PUBLIC_APP_URL`, et confondre les deux nommerait la mauvaise
    // variable à quelqu'un qui vient corriger un fichier.
    expect(
      undeclaredVariables(
        [{ name: 'tests/x.test.ts', failed: true, messages: ['renseignez NEXT_PUBLIC_APP_URL'] }],
        appKeys,
      ),
    ).toEqual([])
  })

  it('ignore un fichier vert, et un échec qui ne parle d’aucune variable', () => {
    expect(
      undeclaredVariables(
        [
          { name: 'tests/vert.test.ts', failed: false, messages: ['AUTH_SECRET'] },
          { name: 'tests/autre.test.ts', failed: true, messages: ['expected 1 to be 2'] },
        ],
        appKeys,
      ),
    ).toEqual([])
  })
})

describe('le préambule, dont rien ne prouvait qu’il était en vigueur', () => {
  it('refuse un rapport où le cas canari n’a pas tourné', () => {
    // **Le plancher qui manquait**, et c'est le central : tout le régime tient à
    // une ligne de `vitest.sans-env.config.ts`. Neutralisée, la suite tourne
    // **avec** le `.env` du poste et la commande journalise ses fichiers balayés
    // en ne reproduisant rien — le défaut de s26, s48 et s51, une troisième fois.
    expect(() => assertCanaryRan(['un autre cas', 'encore un autre'])).toThrow(/canari/)
  })

  it('accepte un rapport où il a tourné', () => {
    expect(() => assertCanaryRan(['un autre cas', CANARY_TITLE])).not.toThrow()
  })

  /**
   * **Le canari lui-même**, balayé par la suite dans les deux régimes.
   *
   * Sans la variable, c'est `pnpm test` qui joue : le `.env` du poste doit rester
   * lisible, et il n'y a rien d'autre à vérifier. Avec elle, c'est
   * `pnpm test:sans-env` : le fichier doit être introuvable, et s'il ne l'est pas
   * le régime ment sur ce qu'il mesure.
   *
   * La lecture passe par `createRequire` parce que c'est **la vue que le
   * préambule modifie** — celle de `dotenv`, chargé en CommonJS, donc celle du
   * chemin de P25bis. Un `import { readFileSync } from 'node:fs'` lit un espace
   * de noms figé à la première importation et ne verrait jamais le retrait.
   */
  it(CANARY_TITLE, () => {
    const fs = createRequire(import.meta.url)('node:fs') as {
      existsSync: (path: string) => boolean
      readFileSync: (path: string, encoding: string) => string
    }

    const hidden = process.env[HIDDEN_FILE_KEY]

    if (hidden === undefined) {
      expect(fs.existsSync(fileURLToPath(new URL('../.env.example', import.meta.url)))).toBe(true)
      return
    }

    expect(fs.existsSync(hidden)).toBe(false)
    expect(() => fs.readFileSync(hidden, 'utf8')).toThrow(/ENOENT/)
  })
})
