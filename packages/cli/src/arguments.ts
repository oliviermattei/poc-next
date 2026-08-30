/**
 * L'analyse de la ligne de commande, sans dépendance.
 *
 * Deux commandes et trois drapeaux ne justifient pas une bibliothèque
 * (`docs/security.md` §6 : une dépendance se justifie par une story, pas par une
 * commodité). Ce qui compte ici est le **refus** : un drapeau inconnu arrête la
 * commande au lieu d'être ignoré. Une faute de frappe silencieusement absorbée
 * ferait exécuter autre chose que ce que l'appelant — humain ou agent — croit
 * avoir demandé, et `--with-requiers` activerait alors un module sans son requis.
 */
export class ArgumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArgumentError'
  }
}

interface CommonOptions {
  /** Sortie lisible par une machine (ADR 013). Implique le mode non interactif. */
  readonly json: boolean
  readonly withRequirements: boolean
  readonly applyMigrations: boolean
}

/**
 * Union discriminée, pour que « toggle » porte son identifiant dans le type :
 * un `moduleId` nullable obligerait chaque appelant à une conversion, c'est-à-
 * dire à refaire à la main la garantie que cette fonction vient de donner.
 */
export type ParsedArguments =
  | ({ readonly command: 'list' } & CommonOptions)
  | ({ readonly command: 'toggle'; readonly moduleId: string } & CommonOptions)

const FLAGS = {
  '--json': 'json',
  '--with-requires': 'withRequirements',
  '--apply-migrations': 'applyMigrations',
} as const

export const USAGE = [
  'Usage : ks <commande> [options]',
  '',
  '  ks list                     liste les modules, leur état et leurs requis',
  '  ks toggle <module>          inverse l’état d’un module dans config/features.ts',
  '',
  'Options :',
  '  --json                      sortie lisible par une machine (implique le mode non interactif)',
  '  --with-requires             autorise l’activation des requis manquants',
  '  --apply-migrations          autorise l’application des migrations générées',
].join('\n')

export function parseArguments(argv: readonly string[]): ParsedArguments {
  const flags = { json: false, withRequirements: false, applyMigrations: false }
  const positional: string[] = []

  for (const argument of argv) {
    if (!argument.startsWith('-')) {
      positional.push(argument)
      continue
    }

    const key = FLAGS[argument as keyof typeof FLAGS]

    if (key === undefined) {
      throw new ArgumentError(`Option inconnue « ${argument} ».\n\n${USAGE}`)
    }

    flags[key] = true
  }

  const [command, moduleId, ...extra] = positional

  if (command !== 'list' && command !== 'toggle') {
    throw new ArgumentError(
      `Commande ${command === undefined ? 'manquante' : `inconnue « ${command} »`}.\n\n${USAGE}`,
    )
  }

  if (extra.length > 0) {
    throw new ArgumentError(`Argument en trop « ${extra[0]} ».\n\n${USAGE}`)
  }

  if (command === 'list') {
    if (moduleId !== undefined) {
      throw new ArgumentError(`« ks list » ne prend pas d’argument.\n\n${USAGE}`)
    }

    return { command, ...flags }
  }

  if (moduleId === undefined) {
    throw new ArgumentError(`« ks toggle » attend un identifiant de module.\n\n${USAGE}`)
  }

  return { command, moduleId, ...flags }
}
