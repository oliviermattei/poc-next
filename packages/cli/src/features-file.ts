import {
  IndentationText,
  Project,
  QuoteKind,
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
 * Les réglages de manipulation ne sont pas décoratifs, ils sont la condition de
 * l'identité octet pour octet. Mesuré sur `ts-morph@28` : sans
 * `useTrailingCommas`, insérer dans une liste multiligne à virgule finale rend
 * une liste **sans** virgule finale et mal indentée — le fichier reste valide,
 * mais le toggle inverse ne rend plus un fichier identique, et c'est exactement
 * le critère de la story.
 *
 * Ce qui est en dehors de la liste n'est jamais réécrit : `ts-morph` n'édite que
 * les nœuds désignés, et rend le reste du texte tel quel.
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

const project = new Project({
  useInMemoryFileSystem: true,
  manipulationSettings: {
    indentationText: IndentationText.TwoSpaces,
    quoteKind: QuoteKind.Single,
    useTrailingCommas: true,
  },
})

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

const literalIds = (array: ArrayLiteralExpression): readonly string[] =>
  array.getElements().map((element) => {
    const literal = element.asKind(SyntaxKind.StringLiteral)

    if (literal === undefined) {
      return fail(
        `« ${ENABLED_MODULES} » contient l’élément « ${element.getText()} », qui n’est pas un identifiant littéral. Le CLI refuse d’écrire dans une liste qu’il ne peut pas relire à l’identique.`,
      )
    }

    return literal.getLiteralValue()
  })

/** Les identifiants activés, lus dans le texte du fichier. */
export function readEnabledModules(source: string): readonly string[] {
  return literalIds(enabledModulesArray(parse(source)))
}

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
 * Le séparateur qui précède une entrée : un espace sur une liste d'une ligne,
 * un retour à la ligne suivi de l'indentation sur une liste multiligne.
 *
 * Il est **relevé sur le fichier** plutôt que déduit des réglages : c'est le
 * propriétaire qui décide de la mise en forme de sa liste, et l'aller-retour
 * doit rendre la sienne, pas celle du CLI.
 */
const separatorBefore = (text: string, element: Node): string => {
  const trivia = text.slice(element.getFullStart(), element.getStart())
  const lastNewLine = trivia.lastIndexOf('\n')

  return lastNewLine === -1 ? ' ' : `\n${trivia.slice(lastNewLine + 1)}`
}

/**
 * Où insérer une entrée pour qu'elle prenne la place que le retrait a libérée :
 * **avant les commentaires de l'entrée suivante**, mais **après un commentaire
 * de fin de ligne** de l'entrée précédente.
 *
 * La distinction est la seule qui compte ici, et `ts-morph` ne la fait pas :
 * `insertElement` remplace tout le texte entre l'entrée précédente et la
 * suivante, ce qui **détruit le commentaire** que le propriétaire a mis au-dessus
 * de l'entrée suivante. D'où le placement calculé sur les positions de l'AST —
 * pas une recherche de motif dans le texte, et jamais une écriture non relue :
 * `writeEnabledModules` réanalyse le résultat avant de le rendre.
 */
const anchorBefore = (text: string, element: Node): number => {
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
 * Rend le texte du fichier où `enabledModules` vaut exactement `next`.
 *
 * Les retraits d'abord, les ajouts ensuite, et une analyse par opération : une
 * insertion faite avant un retrait invaliderait les positions sur lesquelles le
 * retrait s'appuie.
 *
 * Chaque ajout est **inséré à sa position dans `next`**, jamais apposé en fin de
 * liste. Appendre ne rend le fichier d'origine que lorsque l'entrée basculée est
 * la dernière : sur toute autre, le toggle inverse rendrait une liste réordonnée,
 * c'est-à-dire un fichier différent — et le critère qui décide de cette story est
 * l'identité octet pour octet.
 *
 * Ce que la fonction ne sait pas faire : **déplacer** une entrée déjà présente.
 * Elle le dit au lieu d'écrire une liste qui n'est pas celle qu'on lui a
 * demandée.
 */
export function writeEnabledModules(source: string, next: readonly string[]): string {
  const current = readEnabledModules(source)
  const wanted = new Set(next)
  const present = new Set(current)

  let text = source

  for (const id of current) {
    if (wanted.has(id)) {
      continue
    }

    const file = parse(text)
    const array = enabledModulesArray(file)

    array.removeElement(
      array
        .getElements()
        .findIndex((element) => element.asKind(SyntaxKind.StringLiteral)?.getLiteralValue() === id),
    )

    text = file.getFullText()
  }

  // `next` est parcourue de gauche à droite : les insertions déjà faites
  // occupent leur position définitive, donc l'index de `next` est aussi l'index
  // dans la liste en cours d'écriture.
  for (const [index, id] of next.entries()) {
    if (present.has(id)) {
      continue
    }

    const file = parse(text)
    const array = enabledModulesArray(file)
    const quote = quoteOf(file, array)
    const entry = `${quote}${id}${quote}`
    const following = array.getElements()[index]

    if (following === undefined) {
      // En fin de liste, `ts-morph` fait le travail : c'est lui qui rend la
      // virgule finale que le retrait du dernier élément avait emportée.
      array.addElement(entry)

      text = file.getFullText()
      continue
    }

    const anchor = anchorBefore(text, following)

    text = `${text.slice(0, anchor)}${entry},${separatorBefore(text, following)}${text.slice(anchor)}`
  }

  const written = readEnabledModules(text)

  if (written.length !== next.length || written.some((id, index) => id !== next[index])) {
    return fail(
      `Le CLI ne sait pas réordonner « ${ENABLED_MODULES} » : il retire et il insère. Demandé « ${next.join(', ')} », écrit « ${written.join(', ')} ».`,
    )
  }

  return text
}
