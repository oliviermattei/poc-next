import {
  Project,
  SyntaxKind,
  type ArrayLiteralExpression,
  type Node,
  type SourceFile,
} from 'ts-morph'

/**
 * Édition de la liste `enabledModules` de `config/features.ts`.
 *
 * Ce fichier est **écrit pour être lu** : il porte les commentaires que le
 * propriétaire du projet a mis là, et l'annuaire `availableModules` que le CLI
 * ne touche jamais. Une réécriture par expression régulière tiendrait sur le cas
 * nominal et détruirait un commentaire au premier cas non prévu — d'où l'AST.
 *
 * `ts-morph` sert ici à **lire**, jamais à écrire : ses API de manipulation
 * (`addElement`, `removeElement`, `insertElement`) reformatent la liste selon
 * leurs propres réglages, emportent la virgule finale avec la dernière entrée et
 * détruisent le commentaire de l'entrée suivante. L'écriture est donc un
 * découpage du texte d'origine : chaque entrée est un morceau que l'on déplace
 * ou que l'on retire tel quel, et **tout ce qui n'est pas une entrée — la mise
 * en forme, les fins de ligne, la virgule finale — est recopié à l'octet près**.
 *
 * ## La limite, et elle est réelle
 *
 * Le commentaire d'une entrée **appartient à cette entrée** : celui qui la
 * précède comme celui qui la suit en fin de ligne. Retirer l'entrée l'emporte
 * donc avec elle — le laisser en place le réattribuerait au module voisin, et le
 * fichier documenterait le mauvais module.
 *
 * **Une réactivation ne le rend pas.** L'aller-retour est fait de deux
 * invocations séparées : à la seconde, le texte n'existe plus nulle part, ni
 * dans le fichier ni ailleurs. `writeEnabledModules` le **signale** dans
 * `droppedComments`, et le CLI le dit à l'utilisateur au moment où il le fait
 * (`src/commands.ts`).
 *
 * ## Et une seconde, plus étroite
 *
 * Une liste qui passe par l'**état vide** perd ce que sa dernière entrée
 * portait : sa virgule finale et ses guillemets. `[]` ne dit plus rien de ces
 * deux-là. La forme multiligne, elle, survit — `[` et `]` restent sur deux
 * lignes — et une entrée réinsérée retrouve son indentation. Ce qui est
 * réappliqué est la convention du dépôt : virgule finale sur une liste
 * multiligne, et les guillemets du reste du fichier.
 *
 * Mesuré sur 576 allers-retours (quatre modules, tous les sous-ensembles, sept
 * mises en forme) : 504 identiques à l'octet, 64 non identiques par la perte du
 * commentaire ci-dessus — annoncée —, et 8 par cette seconde limite, toutes sur
 * une liste d'une seule entrée qui passe par l'état vide.
 */

export class FeaturesFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeaturesFileError'
  }
}

const fail = (message: string): never => {
  throw new FeaturesFileError(message)
}

/** Nom de la déclaration éditée. L'annuaire, lui, n'est jamais touché. */
const ENABLED_MODULES = 'enabledModules'

/** Indentation d'une entrée ajoutée à une liste multiligne jusque-là vide. */
const INDENT = '  '

const project = new Project({ useInMemoryFileSystem: true })

let counter = 0

/** Un fichier jetable par analyse : le projet en mémoire ne sert qu'à parser. */
const parse = (source: string): SourceFile =>
  project.createSourceFile(`features-${(counter += 1)}.ts`, source, { overwrite: true })

const enabledModulesArray = (file: SourceFile): ArrayLiteralExpression => {
  const declaration = file.getVariableDeclaration(ENABLED_MODULES)

  if (declaration === undefined) {
    return fail(
      `config/features.ts ne déclare pas « ${ENABLED_MODULES} » : le CLI n’a rien à éditer.`,
    )
  }

  // `enabledModules` est écrite `[…] as const satisfies readonly …[]` : c'est ce
  // qui fait refuser un identifiant inconnu par le **compilateur**. On traverse
  // donc les enveloppes de typage pour atteindre la liste, plutôt que de
  // descendre à l'aveugle dans le premier tableau venu.
  let expression = declaration.getInitializer()

  for (;;) {
    const inner =
      expression?.asKind(SyntaxKind.AsExpression)?.getExpression() ??
      expression?.asKind(SyntaxKind.SatisfiesExpression)?.getExpression() ??
      expression?.asKind(SyntaxKind.ParenthesizedExpression)?.getExpression()

    if (inner === undefined) {
      break
    }

    expression = inner
  }

  const array = expression?.asKind(SyntaxKind.ArrayLiteralExpression)

  if (array === undefined) {
    return fail(
      `« ${ENABLED_MODULES} » n’est pas une liste littérale dans config/features.ts : le CLI refuse de réécrire ce qu’il ne sait pas relire.`,
    )
  }

  return array
}

const literalId = (element: Node): string => {
  const literal = element.asKind(SyntaxKind.StringLiteral)

  if (literal === undefined) {
    return fail(
      `« ${ENABLED_MODULES} » contient l’élément « ${element.getText()} », qui n’est pas un identifiant littéral. Le CLI refuse d’écrire dans une liste qu’il ne peut pas relire à l’identique.`,
    )
  }

  return literal.getLiteralValue()
}

const literalIds = (array: ArrayLiteralExpression): readonly string[] =>
  array.getElements().map(literalId)

/** Les identifiants activés, lus dans le texte du fichier. */
export function readEnabledModules(source: string): readonly string[] {
  return literalIds(enabledModulesArray(parse(source)))
}

/**
 * Un morceau de texte qui **appartient** à une entrée, et qui la suit partout.
 *
 * - `lead` : les commentaires que le propriétaire a écrits au-dessus d'elle ;
 * - `body` : le littéral, guillemets d'origine compris ;
 * - `tail` : le commentaire de fin de ligne, après la virgule.
 *
 * Ce qui reste — les retours à la ligne, l'indentation, la virgule finale — est
 * une propriété de la **liste**, pas de l'entrée : il ne bouge pas quand elle
 * bouge.
 */
interface Slot {
  readonly id: string
  readonly lead: string
  readonly body: string
  /** Ce qui sépare le littéral de sa virgule. Vide en pratique. */
  readonly preComma: string
  readonly tail: string
}

interface Layout {
  /** Le texte jusqu'au crochet ouvrant inclus. */
  readonly before: string
  /** Entre le crochet ouvrant et la première entrée. */
  readonly open: string
  /** Entre l'entrée `i` et l'entrée `i + 1`. */
  readonly between: readonly string[]
  readonly trailingComma: boolean
  /** Entre la dernière entrée et le crochet fermant. */
  readonly close: string
  /** Le texte à partir du crochet fermant. */
  readonly after: string
  readonly slots: readonly Slot[]
  readonly quote: string
}

const NEWLINE = /\r?\n/

/**
 * Guillemets à utiliser pour un identifiant ajouté.
 *
 * Repris de la liste quand elle n'est pas vide, sinon du premier littéral de
 * chaîne du fichier — les imports, en pratique. Une valeur en dur imposerait un
 * style au propriétaire et ferait échouer l'aller-retour sur un fichier écrit
 * autrement.
 */
const quoteOf = (file: SourceFile, array: ArrayLiteralExpression): string => {
  const sample =
    array.getElements()[0]?.asKind(SyntaxKind.StringLiteral) ??
    file.getFirstDescendantByKind(SyntaxKind.StringLiteral)

  return sample?.getText().startsWith('"') === true ? '"' : "'"
}

/**
 * Où commencent les commentaires qui appartiennent à une entrée : après le
 * retour à la ligne qui suit la virgule précédente.
 *
 * Ce qui reste sur la ligne de la virgule appartient à l'entrée **précédente** —
 * c'est son commentaire de fin de ligne, et le confondre avec celui de la
 * suivante fait documenter le mauvais module.
 */
const ownedStart = (text: string, element: Node): number => {
  const fullStart = element.getFullStart()
  const start = element.getStart()
  const trivia = text.slice(fullStart, start)
  const firstNewLine = trivia.indexOf('\n')

  if (firstNewLine === -1) {
    return start
  }

  const offset = trivia.slice(firstNewLine + 1).search(/\S/)

  return offset === -1 ? start : fullStart + firstNewLine + 1 + offset
}

/**
 * La virgule qui suit une entrée, cherchée **hors commentaire** : une virgule
 * dans `// coupable, en démo` n'en est pas une.
 */
const commaIndex = (region: string): number => {
  let index = 0

  while (index < region.length) {
    if (region[index] === ',') {
      return index
    }

    if (region.startsWith('//', index)) {
      const end = region.indexOf('\n', index)

      if (end === -1) {
        return -1
      }

      index = end + 1
      continue
    }

    if (region.startsWith('/*', index)) {
      const end = region.indexOf('*/', index)

      if (end === -1) {
        return -1
      }

      index = end + 2
      continue
    }

    index += 1
  }

  return -1
}

/** Découpe ce qui suit une entrée : sa virgule, son commentaire de fin de ligne, puis le reste. */
const splitAfter = (
  region: string,
): { readonly preComma: string; readonly comma: boolean; readonly tail: string; readonly rest: string } => {
  const at = commaIndex(region)
  const preComma = at === -1 ? '' : region.slice(0, at)
  const remainder = at === -1 ? region : region.slice(at + 1)
  const newLine = NEWLINE.exec(remainder)

  return newLine === null
    ? { preComma, comma: at !== -1, tail: '', rest: remainder }
    : {
        preComma,
        comma: at !== -1,
        tail: remainder.slice(0, newLine.index),
        rest: remainder.slice(newLine.index),
      }
}

const readLayout = (source: string): Layout => {
  const file = parse(source)
  const array = enabledModulesArray(file)
  const elements = array.getElements()
  const [first] = elements
  const quote = quoteOf(file, array)
  const innerStart = array.getStart() + 1
  const closeStart = array.getEnd() - 1
  const before = source.slice(0, innerStart)
  const after = source.slice(closeStart)

  if (first === undefined) {
    // Une liste vide ne dit plus comment elle s'écrivait. Ce qu'il en reste — un
    // retour à la ligne et l'indentation du crochet fermant — suffit pourtant à
    // savoir si elle était multiligne, et à y réinsérer une entrée à sa place.
    const inner = source.slice(innerStart, closeStart)
    const shape = /(\r?\n)([ \t]*)$/.exec(inner)

    return {
      before,
      open: shape === null ? '' : `${shape[1]}${shape[2]}${INDENT}`,
      between: [],
      trailingComma: shape !== null,
      close: inner,
      after,
      slots: [],
      quote,
    }
  }

  const slots: Slot[] = []
  const between: string[] = []
  let trailingComma = false
  let close = ''

  const open = source.slice(innerStart, ownedStart(source, first))

  for (const [index, element] of elements.entries()) {
    const start = ownedStart(source, element)
    const next = elements[index + 1]
    const region = source.slice(element.getEnd(), next === undefined ? closeStart : ownedStart(source, next))
    const { preComma, comma, tail, rest } = splitAfter(region)

    slots.push({
      id: literalId(element),
      lead: source.slice(start, element.getStart()),
      body: element.getText(),
      preComma,
      tail,
    })

    if (next === undefined) {
      trailingComma = comma
      close = rest
    } else {
      between.push(rest)
    }
  }

  return { before, open, between, trailingComma, close, after, slots, quote }
}

const render = (layout: Layout, slots: readonly Slot[]): string => {
  if (slots.length === 0) {
    return `${layout.before}${layout.close}${layout.after}`
  }

  // Une entrée ajoutée au-delà des séparateurs connus reprend le dernier
  // séparateur du fichier, **tel quel** : c'est ce qui rend ses fins de ligne
  // et son indentation plutôt que celles du CLI.
  const fallback =
    layout.between.at(-1) ?? (NEWLINE.test(layout.open) ? layout.open : ' ')

  const body = slots
    .map((slot, index) => {
      const prefix = index === 0 ? layout.open : (layout.between[index - 1] ?? fallback)
      const last = index === slots.length - 1
      const comma = last && !layout.trailingComma ? '' : ','

      return `${prefix}${slot.lead}${slot.body}${slot.preComma}${comma}${slot.tail}`
    })
    .join('')

  return `${layout.before}${body}${layout.close}${layout.after}`
}

const carriesComment = (text: string): boolean => text.includes('//') || text.includes('/*')

/**
 * Le résultat d'une écriture : le texte, et **ce que l'écriture a changé sans
 * qu'on le lui demande**.
 *
 * Les deux champs existent pour être dits à l'utilisateur : une normalisation
 * silencieuse d'un fichier qu'il édite à la main est exactement ce qu'ADR 019
 * interdit.
 */
export interface EnabledModulesEdit {
  readonly text: string
  /** Entrées déjà présentes que l'ordre canonique a déplacées (ADR 019). */
  readonly reordered: readonly string[]
  /** Entrées retirées dont le commentaire du propriétaire est parti avec elles. */
  readonly droppedComments: readonly string[]
}

/**
 * Rend le texte du fichier où `enabledModules` vaut exactement `next`, **dans
 * cet ordre**.
 *
 * L'ordre est celui que l'appelant demande, et `planToggle` le dérive de
 * l'annuaire : c'est l'ordre canonique d'ADR 019. Écrire dans cet ordre est ce
 * qui rend le critère 8 atteignable — un aller-retour, ce sont deux invocations
 * séparées, et à la seconde la position d'origine d'une entrée retirée n'existe
 * plus nulle part.
 *
 * L'écriture est relue avant d'être rendue : rendre une liste différente de
 * celle qu'on a demandée est le seul mode d'échec qu'un appelant ne verrait pas.
 */
export function writeEnabledModules(source: string, next: readonly string[]): EnabledModulesEdit {
  if (new Set(next).size !== next.length) {
    return fail(
      `Le CLI refuse d’écrire deux fois le même identifiant dans « ${ENABLED_MODULES} » : « ${next.join(', ')} ».`,
    )
  }

  const layout = readLayout(source)
  const bySlot = new Map(layout.slots.map((slot) => [slot.id, slot]))
  const wanted = new Set(next)

  const slots = next.map(
    (id) =>
      bySlot.get(id) ?? {
        id,
        lead: '',
        body: `${layout.quote}${id}${layout.quote}`,
        preComma: '',
        tail: '',
      },
  )

  const text = render(layout, slots)
  const written = readEnabledModules(text)

  if (written.length !== next.length || written.some((id, index) => id !== next[index])) {
    return fail(
      `L’écriture de « ${ENABLED_MODULES} » n’a pas rendu la liste demandée : « ${next.join(', ')} » demandé, « ${written.join(', ')} » écrit. Rien n’a été enregistré.`,
    )
  }

  // Le déplacement est jugé **contre le fichier d'origine**, jamais contre la
  // liste demandée : c'est la demande qui porte la normalisation, donc la
  // comparer à elle-même ne verrait jamais rien bouger.
  const keptBefore = layout.slots.map((slot) => slot.id).filter((id) => wanted.has(id))
  const keptAfter = next.filter((id) => bySlot.has(id))

  return {
    text,
    reordered: keptBefore.filter((id, index) => keptAfter[index] !== id),
    droppedComments: layout.slots
      .filter((slot) => !wanted.has(slot.id) && (carriesComment(slot.lead) || carriesComment(slot.tail)))
      .map((slot) => slot.id),
  }
}
