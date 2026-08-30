import {
  IndentationText,
  Project,
  QuoteKind,
  SyntaxKind,
  type ArrayLiteralExpression,
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
 * Rend le texte du fichier où `enabledModules` vaut exactement `next`.
 *
 * Les retraits d'abord, les ajouts ensuite, et une analyse par opération : une
 * insertion faite avant un retrait invaliderait les positions sur lesquelles le
 * retrait s'appuie.
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

  for (const id of next) {
    if (present.has(id)) {
      continue
    }

    const file = parse(text)
    const array = enabledModulesArray(file)
    const quote = quoteOf(file, array)

    array.addElement(`${quote}${id}${quote}`)

    text = file.getFullText()
  }

  return text
}
