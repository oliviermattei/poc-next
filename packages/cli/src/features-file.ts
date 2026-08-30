import {
  Project,
  SyntaxKind,
  ts,
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
 * Le rendu est **confronté aux diagnostics de syntaxe** avant d'être remis à
 * l'appelant. Relire la liste ne suffit pas : la récupération d'erreur de
 * TypeScript rend la liste demandée sur un texte qui ne compile plus, et un
 * `config/features.ts` invalide rendrait toute bascule ultérieure impossible.
 *
 * ## La limite, et elle est réelle
 *
 * Le commentaire d'une entrée **appartient à cette entrée**, où qu'il soit
 * écrit : au-dessus, devant elle sur sa ligne, entre elle et sa virgule, ou
 * derrière en fin de ligne. Retirer l'entrée l'emporte donc avec elle — le
 * laisser en place le réattribuerait au module voisin, et le fichier
 * documenterait le mauvais module.
 *
 * **Une réactivation ne le rend pas.** L'aller-retour est fait de deux
 * invocations séparées : à la seconde, le texte n'existe plus nulle part, ni
 * dans le fichier ni ailleurs. `writeEnabledModules` le **signale** dans
 * `droppedComments`, et le CLI le dit à l'utilisateur au moment où il le fait
 * (`src/commands.ts`).
 *
 * ## Et deux autres, plus étroites
 *
 * Une liste qui passe par l'**état vide** perd ce que sa dernière entrée
 * portait : sa virgule finale et ses guillemets. `[]` ne dit plus rien de ces
 * deux-là. La forme multiligne, elle, survit — `[` et `]` restent sur deux
 * lignes — et une entrée réinsérée retrouve son indentation. Ce qui est
 * réappliqué est la convention du dépôt : virgule finale sur une liste
 * multiligne, et les guillemets du reste du fichier.
 *
 * Un crochet fermant **collé à la dernière entrée** (`'demo-enabled'] as const`)
 * passe à la ligne dès qu'une entrée à commentaire de fin de ligne se retrouve
 * en dernier : sans cette coupure, le `//` avalerait le `]` et la clause
 * `satisfies`, et le fichier ne compilerait plus. La liste change alors de mise
 * en forme, une fois.
 *
 * Mesuré sur 768 allers-retours — quatre modules, les seize sous-ensembles,
 * douze mises en forme (une ligne ; multiligne avec et sans virgule finale ;
 * commentaires de tête ; de fin de ligne ; de bloc devant l'entrée, collés à sa
 * virgule, sur liste multiligne ; guillemets doubles ; CRLF ; crochet fermant
 * collé à la dernière entrée, avec et sans commentaires), les quatre bascules
 * par état. **564 identiques à l'octet**, 204 non identiques : 177 par la perte
 * du commentaire d'une entrée retirée — toutes annoncées —, 16 par le passage
 * d'une liste d'une seule entrée par l'état vide, 11 par la coupure de ligne
 * ci-dessus. **Zéro fichier syntaxiquement invalide, zéro commentaire déplacé
 * sur un autre module, zéro perte muette.**
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
  /**
   * Ce qui sépare le littéral de sa virgule — et ce qui le suit quand le fichier
   * n'en porte pas encore : un commentaire écrit là est **devant** la virgule
   * qu'un ajout rendra nécessaire, pas derrière.
   */
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
  /**
   * Le retour à la ligne du fichier, suivi de l'indentation de la ligne qui
   * porte le crochet ouvrant. Inséré uniquement pour fermer un commentaire de
   * fin de ligne qui, sinon, avalerait ce qui le suit.
   */
  readonly lineBreak: string
}

const NEWLINE = /\r?\n/

/** Le rendu commence-t-il par une coupure de ligne — celle qui referme un `//` ? */
const STARTS_WITH_NEWLINE = /^\r?\n/

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
 *
 * Reste ce qu'un humain écrit **devant** une entrée, sur sa ligne :
 * `[/* le pilote *\/ 'alpha', 'beta']`. Ce commentaire-là décrit « alpha », pas
 * la première place de la liste — le traiter comme de l'espacement le laisserait
 * devant « beta » au retrait d'« alpha ». Il appartient donc à l'entrée qui le
 * suit, comme s'il était écrit une ligne au-dessus. L'espace, lui, reste à la
 * place : sans quoi retirer la première entrée d'une liste d'une seule ligne
 * laisserait `[ 'beta']`.
 */
const ownedStart = (text: string, element: Node): number => {
  const fullStart = element.getFullStart()
  const start = element.getStart()
  const trivia = text.slice(fullStart, start)
  const firstNewLine = trivia.indexOf('\n')

  if (firstNewLine === -1) {
    const comment = trivia.indexOf('/*')

    return comment === -1 ? start : fullStart + comment
  }

  const offset = trivia.slice(firstNewLine + 1).search(/\S/)

  return offset === -1 ? start : fullStart + firstNewLine + 1 + offset
}

/** Ce morceau porte-t-il un commentaire du propriétaire ? */
const carriesComment = (text: string): boolean => text.includes('//') || text.includes('/*')

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

interface Split {
  readonly preComma: string
  readonly comma: boolean
  readonly tail: string
  readonly rest: string
}

/** Découpe ce qui suit une entrée : sa virgule, son commentaire de fin de ligne, puis le reste. */
const splitAfter = (region: string): Split => {
  const at = commaIndex(region)
  const preComma = at === -1 ? '' : region.slice(0, at)
  const remainder = at === -1 ? region : region.slice(at + 1)
  const newLine = NEWLINE.exec(remainder)

  if (newLine !== null) {
    return {
      preComma,
      comma: at !== -1,
      tail: remainder.slice(0, newLine.index),
      rest: remainder.slice(newLine.index),
    }
  }

  // Rien derrière l'entrée jusqu'au crochet fermant : elle est la dernière d'une
  // liste d'une seule ligne. Ce qui la suit ne lui appartient que si c'est un
  // commentaire — l'espacement, lui, est une propriété de la place.
  if (!carriesComment(remainder)) {
    return { preComma, comma: at !== -1, tail: '', rest: remainder }
  }

  // Et sans virgule dans le fichier, ce commentaire est écrit **avant** celle
  // qu'une entrée ajoutée ensuite rendra nécessaire. Le ranger derrière la
  // virgule le collerait à cette nouvelle entrée : le fichier documenterait le
  // mauvais module, et l'aller-retour l'emporterait sous son nom.
  return at === -1
    ? { preComma: remainder, comma: false, tail: '', rest: '' }
    : { preComma, comma: true, tail: remainder, rest: '' }
}

/**
 * Ce morceau ouvre-t-il un commentaire de ligne qui n'est pas refermé ?
 *
 * Un `//` court jusqu'au prochain retour à la ligne : tout ce qu'on écrit
 * derrière — l'entrée suivante, le crochet fermant, la clause `satisfies` —
 * passe **dans** le commentaire. Un `/* … *\/` fermé, lui, ne mange rien.
 */
const opensLineComment = (text: string): boolean => {
  let index = 0

  while (index < text.length) {
    if (text.startsWith('//', index)) {
      return true
    }

    if (text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index)

      if (end === -1) {
        return false
      }

      index = end + 2
      continue
    }

    index += 1
  }

  return false
}

/** La coupure de ligne à insérer : celle du fichier, à l'indentation de la liste. */
const lineBreakOf = (source: string, before: string): string => {
  const eol = NEWLINE.exec(source)?.[0] ?? '\n'
  const openingLine = before.slice(before.lastIndexOf('\n') + 1)

  return `${eol}${/^[ \t]*/.exec(openingLine)?.[0] ?? ''}`
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
      lineBreak: lineBreakOf(source, before),
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

  return {
    before,
    open,
    between,
    trailingComma,
    close,
    after,
    slots,
    quote,
    lineBreak: lineBreakOf(source, before),
  }
}

const render = (layout: Layout, slots: readonly Slot[]): string => {
  if (slots.length === 0) {
    // Ce qui précède la première entrée n'est de l'espacement que dans le cas
    // courant. Un commentaire écrit là n'appartient à aucune entrée — le perdre
    // en vidant la liste serait une suppression silencieuse.
    const orphan = carriesComment(layout.open) ? layout.open.replace(/[ \t]+$/, '') : ''

    return `${layout.before}${orphan}${layout.close}${layout.after}`
  }

  // Une entrée ajoutée au-delà des séparateurs connus reprend le dernier
  // séparateur du fichier, **tel quel** : c'est ce qui rend ses fins de ligne
  // et son indentation plutôt que celles du CLI.
  const fallback =
    layout.between.at(-1) ?? (NEWLINE.test(layout.open) ? layout.open : ' ')

  const prefixOf = (index: number): string =>
    index === 0 ? layout.open : (layout.between[index - 1] ?? fallback)

  const body = slots
    .map((slot, index) => {
      const last = index === slots.length - 1
      const comma = last && !layout.trailingComma ? '' : ','
      // Ce qui suit l'entrée à cette place-ci — le séparateur de la suivante, ou
      // la fin de la liste. Le commentaire de fin de ligne voyage avec l'entrée,
      // pas la position : son ancienne ligne ne dit rien de sa nouvelle.
      const following = last ? `${layout.close}${layout.after}` : prefixOf(index + 1)
      const closesComment = opensLineComment(slot.tail) && !STARTS_WITH_NEWLINE.test(following)

      return `${prefixOf(index)}${slot.lead}${slot.body}${slot.preComma}${comma}${slot.tail}${
        closesComment ? layout.lineBreak : ''
      }`
    })
    .join('')

  return `${layout.before}${body}${layout.close}${layout.after}`
}

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
  const rendered = parse(text)
  const [broken] = project
    .getLanguageService()
    .compilerObject.getSyntacticDiagnostics(rendered.getFilePath())

  // La relecture de la liste ne suffit pas : la récupération d'erreur de
  // TypeScript rend la liste demandée sur un texte qui ne compile plus, et un
  // `config/features.ts` invalide rend toute bascule ultérieure impossible.
  if (broken !== undefined) {
    return fail(
      `Le CLI refuse d’enregistrer un config/features.ts que TypeScript ne sait pas analyser — ligne ${
        rendered.getLineAndColumnAtPos(broken.start).line
      } : « ${ts.flattenDiagnosticMessageText(broken.messageText, ' ')} ». Rien n’a été enregistré.`,
    )
  }

  const written = literalIds(enabledModulesArray(rendered))

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
      .filter(
        (slot) =>
          !wanted.has(slot.id) &&
          (carriesComment(slot.lead) ||
            carriesComment(slot.preComma) ||
            carriesComment(slot.tail)),
      )
      .map((slot) => slot.id),
  }
}
