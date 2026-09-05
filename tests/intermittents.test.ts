import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  COLD_GRAPH_ENTRY_POINTS,
  COLD_GRAPH_MEASURED_WITH_MARGIN,
  INTERMITTENT_CASES,
  type IntermittentCase,
} from './fixtures/intermittents'

const readRepoFile = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8')

const repoPath = (name: string): string => fileURLToPath(new URL(`../${name}`, import.meta.url))

/**
 * **Le compte des cas se dérive, il ne s'écrit pas** (s52, tâche 1).
 *
 * Trois comptes écrits ont vieilli dans la chaîne de cette story, et chacun a
 * été lu comme vérifié par l'agent suivant :
 *
 * | Document | Ce qu'il écrit | Ce que la liste porte |
 * |---|---|---|
 * | `docs/stories.md`, critère 2 | « les trois passent dix fois de suite » | trois, puis huit, puis treize |
 * | `docs/research/s52-*.md` | « sept cas sur quatre fichiers » | huit cas sur **cinq** fichiers |
 * | `docs/plans/s52-*.md` | « onze cas » | treize, une fois `tests/auth.test.ts` compté |
 *
 * D'où cette liste : un seul endroit, et le critère se lit sur elle. Ce fichier
 * ne compte rien non plus — il vérifie un **plancher** (la liste n'est pas
 * vide), que chaque entrée désigne un fichier et un témoin qui existent, et la
 * règle que la story s'est donnée : **on ne corrige pas sur une hypothèse**.
 */
describe('la liste des cas intermittents', () => {
  it('n’est pas vide : une liste vidée rendrait toutes les vérifications vertes sans rien vérifier', () => {
    expect(INTERMITTENT_CASES.length).toBeGreaterThan(0)
  })

  it('désigne des fichiers et des témoins qui existent encore', () => {
    const orphans = INTERMITTENT_CASES.filter((entry) => !existsSync(repoPath(entry.file)))

    expect(orphans.map((entry) => entry.file)).toEqual([])

    const lost = INTERMITTENT_CASES.filter(
      (entry) => !readRepoFile(entry.file).includes(entry.witness),
    )

    expect(lost.map((entry) => `${entry.file} → ${entry.witness}`)).toEqual([])
  })

  it('écrit une cause pour chacun — établie, ou explicitement non établie', () => {
    const mute = INTERMITTENT_CASES.filter((entry) => entry.cause.trim().length === 0)

    expect(mute.map((entry) => entry.id)).toEqual([])
  })

  /**
   * **La règle de la story, rendue exécutable.** « Un cas dont la cause n'est
   * pas établie reste ouvert et nommé ; c'est plus honnête qu'un délai posé au
   * hasard. » Poser un correctif sur une hypothèse est exactement le mode
   * d'échec que P8 documente — un rouge rendu plus rare sans être rendu juste.
   */
  it('ne déclare corrigé aucun cas dont la cause n’est pas établie', () => {
    const guessed = INTERMITTENT_CASES.filter((entry) => entry.corrected && !entry.established)

    expect(guessed.map((entry) => entry.id)).toEqual([])
  })
})

/**
 * **La discipline est renforcée, pas contournée** (s52, tâche 10).
 *
 * `playwright.config.ts` porte `retries: 0` depuis s08, et la raison y est
 * écrite : une reprise transforme un défaut reproductible en badge jaune. Rien
 * ne le vérifiait. Les échappatoires de la même famille — reprendre, sauter,
 * élargir, sérialiser — sont refusées **sur les fichiers de la liste**,
 * c'est-à-dire là où la tentation existe.
 *
 * **Le balayage est fait sur les arguments réels, pas sur une forme d'écriture**
 * (constat de revue). La première version cherchait `test.skip(true` ou
 * `test.skip('` et laissait passer `test.skip()` — la forme idiomatique du saut
 * inconditionnel chez Playwright ; elle lisait la ligne `retries: 0` du fichier
 * de configuration et laissait passer `test.describe.configure({ retries: 3 })`
 * dans le parcours lui-même, ainsi qu'une valeur posée sur un projet. Une garde
 * plus étroite que son nom est ce que P8 décrit : un contrôle bloquant qui finit
 * désarmé.
 *
 * Ce qui reste permis, et pourquoi : un `test.skip(<expression>, '…')`
 * **conditionnel**, qui dérive du catalogue de modules (`e2e/blog.spec.ts`,
 * « module blog coupé »). Il ne saute pas un cas instable, il dit qu'une
 * configuration ne porte pas la surface mesurée. Une condition littérale
 * (`true`) ou un titre de cas n'en est pas une, et un motif sans raison écrite
 * non plus.
 */
describe('les échappatoires refusées sur les cas de la liste', () => {
  /**
   * Le fichier **sans ses commentaires**, les chaînes conservées.
   *
   * Nécessaire dans les deux sens, et mesuré : `playwright.config.ts` explique
   * en commentaire pourquoi `retries: 0` refuse de peindre en jaune — lu tel
   * quel, ce commentaire fait rougir la garde de la reprise ; et un
   * `test.slow()` cité dans un commentaire d'exemple la ferait rougir de même.
   * Le balayage suit les chaînes pour ne pas couper une URL sur son `//`.
   */
  const withoutComments = (source: string): string => {
    let output = ''
    let index = 0

    while (index < source.length) {
      const pair = source.slice(index, index + 2)

      if (pair === '//') {
        while (index < source.length && source[index] !== '\n') {
          index += 1
        }

        continue
      }

      if (pair === '/*') {
        const close = source.indexOf('*/', index + 2)

        index = close === -1 ? source.length : close + 2

        continue
      }

      const character = source[index] ?? ''

      if (character === "'" || character === '"' || character === '`') {
        const quote = character

        output += character
        index += 1

        while (index < source.length) {
          const inner = source[index] ?? ''

          output += inner
          index += 1

          if (inner === '\\') {
            output += source[index] ?? ''
            index += 1
          } else if (inner === quote) {
            break
          }
        }

        continue
      }

      output += character
      index += 1
    }

    return output
  }

  /**
   * Les arguments de chaque appel à `callee`, tels qu'ils sont écrits.
   *
   * Le balayage compte les parenthèses en sautant les chaînes : c'est ce qui
   * permet de distinguer « aucun argument » de « une condition et sa raison »,
   * là où un motif d'expression régulière ne voit qu'un texte.
   */
  const callsTo = (source: string, callee: string): readonly string[] => {
    const opening = new RegExp(`(?<![.\\w])${callee.replaceAll('.', '\\.')}\\s*\\(`, 'g')
    const found: string[] = []

    for (const match of source.matchAll(opening)) {
      let depth = 1
      let quote: string | null = null
      let index = (match.index ?? 0) + match[0].length
      const from = index

      while (index < source.length && depth > 0) {
        const character = source[index] ?? ''

        if (quote !== null) {
          if (character === '\\') {
            index += 1
          } else if (character === quote) {
            quote = null
          }
        } else if (character === "'" || character === '"' || character === '`') {
          quote = character
        } else if (character === '(') {
          depth += 1
        } else if (character === ')') {
          depth -= 1
        }

        index += 1
      }

      found.push(source.slice(from, index - 1))
    }

    return found
  }

  /** Les appels interdits quelle que soit leur forme. */
  const FORBIDDEN = [
    { callee: 'test.slow', why: 'triple le budget sans nommer de cause' },
    { callee: 'test.fixme', why: 'retire le cas de la mesure' },
    { callee: 'test.setTimeout', why: 'élargit le budget du cas' },
    {
      callee: 'test.describe.configure',
      why: 'porte la reprise et le mode sériel — les deux échappatoires que la story refuse',
    },
    { callee: 'test.describe.skip', why: 'saute un bloc entier, sans condition' },
    { callee: 'test.describe.fixme', why: 'même chose, sous un autre nom' },
  ]

  /** Une condition qui n'en est pas une : rien, un littéral, un titre. */
  const isUnconditional = (argumentsText: string): boolean => {
    const written = argumentsText.trim()

    if (written === '') {
      return true
    }

    const [first = ''] = written.split(',')
    const condition = first.trim()

    return (
      written.split(',').length < 2 ||
      condition === 'true' ||
      /^['"`]/.test(condition)
    )
  }

  const specs = [...new Set(INTERMITTENT_CASES.map((entry) => entry.file))].filter((file) =>
    file.endsWith('.spec.ts'),
  )

  it('couvre au moins un parcours : un balayage vide serait vert sans rien vérifier', () => {
    expect(specs.length).toBeGreaterThan(0)
  })

  it('n’en laisse aucune dans les parcours de la liste', () => {
    const found = specs.flatMap((file) => {
      const source = withoutComments(readRepoFile(file))

      const banned = FORBIDDEN.filter((escape) => callsTo(source, escape.callee).length > 0).map(
        (escape) => `${file} : ${escape.callee}() ${escape.why}`,
      )

      const skips = callsTo(source, 'test.skip')
        .filter(isUnconditional)
        .map((written) => `${file} : test.skip(${written}) saute le cas sans condition dérivée`)

      return [...banned, ...skips]
    })

    expect(found).toEqual([])
  })

  /**
   * **Toute** valeur de reprise, et non la première ligne rencontrée : une
   * reprise posée sur un projet s'appliquerait à la suite entière sans que la
   * ligne de tête change.
   */
  it('ne laisse aucune reprise armée dans la configuration des parcours', () => {
    const armed = [
      ...withoutComments(readRepoFile('playwright.config.ts')).matchAll(/retries\s*:\s*([^,\n]+)/g),
    ]
      .map((match) => (match[1] ?? '').trim())
      .filter((value) => value !== '0')

    expect(armed).toEqual([])
  })
})

/**
 * **La cause A s'applique à tous ses appelants, ou elle s'explique** (constat de
 * revue).
 *
 * Deux surfaces portaient le délai explicite, deux autres non — `tests/admin.test.ts`
 * l'avait toujours, `tests/jobs.test.ts` est arrivé avec s33 — et rien ne les
 * nommait. Une cause appliquée à la moitié de ses sites est une cause à moitié
 * fermée, et le prochain appelant l'aurait rejointe en silence.
 *
 * La liste des appelants est donc **balayée sur le disque**, jamais écrite :
 * chacun porte le délai, ou figure dans `COLD_GRAPH_MEASURED_WITH_MARGIN` avec
 * son chiffre. Un cinquième force une décision.
 */
describe('les fichiers qui chargent le graphe de `apps/web`', () => {
  const testFiles = readdirSync(fileURLToPath(new URL('.', import.meta.url)), {
    recursive: true,
  })
    .map(String)
    .filter((name) => name.endsWith('.test.ts'))
    .map((name) => `tests/${name.replaceAll('\\', '/')}`)

  const callers = testFiles.filter((file) =>
    COLD_GRAPH_ENTRY_POINTS.some((entry) => readRepoFile(file).includes(entry)),
  )

  it('en trouve : un balayage vide serait vert sans rien vérifier', () => {
    expect(callers.length).toBeGreaterThan(0)
  })

  it('les munit tous du délai explicite, ou les exempte avec leur mesure', () => {
    const undecided = callers.filter(
      (file) =>
        !readRepoFile(file).includes('COLD_GRAPH_TIMEOUT_MS') &&
        COLD_GRAPH_MEASURED_WITH_MARGIN[file] === undefined,
    )

    expect(undecided).toEqual([])
  })

  it('ne garde aucune exemption qui ne corresponde plus à un appelant', () => {
    const stale = Object.keys(COLD_GRAPH_MEASURED_WITH_MARGIN).filter(
      (file) => !callers.includes(file),
    )

    expect(stale).toEqual([])
  })
})

/**
 * Ce que la liste dit de son propre état, à l'instant du commit. Ce cas ne
 * gèle rien : il refuse seulement qu'une entrée soit vide de sens.
 */
describe('l’état de chaque cas', () => {
  const openCases: readonly IntermittentCase[] = INTERMITTENT_CASES.filter(
    (entry) => !entry.corrected,
  )

  it('nomme le régime sous lequel chaque cas ouvert a été observé', () => {
    const silent = openCases.filter((entry) => entry.regime.trim().length === 0)

    expect(silent.map((entry) => entry.id)).toEqual([])
  })
})
