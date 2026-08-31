/**
 * Le baril de schéma d'un module : le chaînon qui rend ses tables visibles à
 * `drizzle-kit generate`.
 *
 * `drizzle-kit@0.31.10` n'inspecte que les **exports de premier niveau** du
 * fichier qu'on lui désigne — sa fonction interne `prepareFromExports` parcourt
 * `Object.values(exports)` et ne retient que les valeurs qui sont elles-mêmes
 * des `PgTable`, sans descendre dans aucun objet. Mesuré sur le binaire
 * installé : un fichier exportant `const appSchema = { demoItems, demoNotes }`
 * fait dire « 0 tables » à `generate`, là où deux réexports à plat font dire
 * « 2 tables ». C'est le finding N3, ouvert depuis s01.
 *
 * Le baril est donc **généré**, jamais écrit à la main : il est produit depuis
 * `config/features.ts` par `pnpm db:generate`, et il réexporte exactement les
 * tables que le **contrat** du module déclare. La distinction n'est pas
 * cosmétique : réexporter le fichier de schéma en bloc (`export * from …`)
 * ferait entrer en base une table qu'un module exporte sans l'avoir déclarée,
 * c'est-à-dire une table dont ni la purge, ni l'export, ni la rétention ne
 * disent rien.
 */

export interface ModuleSchemaSource {
  readonly id: string
  /** Tables Drizzle du module, indexées par nom d'export — la clé `schema` du contrat. */
  readonly schema: Record<string, unknown>
}

/**
 * Package d'un module, dérivé de son identifiant.
 *
 * Le contrat ne déclare pas le nom du package : la convention du dépôt
 * (`packages/modules/<id>`, publié sous `@repo/module-<id>`) est la seule
 * source. Elle n'est pas prise sur parole — `pnpm db:generate` réimporte le
 * baril qu'il vient d'écrire et compare les tables obtenues à celles du
 * contrat, par identité. Une convention rompue échoue à la génération plutôt
 * que de produire un baril vide.
 */
export const moduleSchemaPackage = (moduleId: string): string => `@repo/module-${moduleId}`

/** Nom du fichier de baril d'un module, stable et dérivé de l'identifiant. */
export const moduleSchemaBarrelFile = (moduleId: string): string => `${moduleId}.ts`

/**
 * Rend le contenu du baril d'un module.
 *
 * Les noms d'export sont triés : le fichier est versionné et comparé à sa
 * régénération, un ordre dépendant de l'itération d'un objet ferait diverger le
 * baril sans qu'aucune table n'ait changé.
 */
export function renderModuleSchemaBarrel(module: ModuleSchemaSource): string {
  const exportNames = Object.keys(module.schema).sort((left, right) => left.localeCompare(right))

  const header = [
    '// Fichier généré par `pnpm db:generate` depuis `config/features.ts`.',
    '// Ne pas éditer à la main : la CI régénère et compare.',
    '//',
    `// Tables déclarées par le module « ${module.id} », réexportées à plat : c'est`,
    "// la seule forme que `drizzle-kit generate` sait lire (exports de premier",
    '// niveau uniquement).',
  ].join('\n')

  if (exportNames.length === 0) {
    return `${header}\n\nexport {}\n`
  }

  return `${header}\n\nexport { ${exportNames.join(', ')} } from '${moduleSchemaPackage(module.id)}'\n`
}

/**
 * Nom du fichier d'agrégat, dans le même dossier que les barils.
 *
 * `index.ts` : c'est lui que `packages/db/src/schema.ts` importe pour
 * construire le schéma **relationnel** du client Drizzle. Les barils par module
 * servent la génération des migrations, l'agrégat sert l'exécution — les deux
 * chemins ne se remplacent pas, et le second manquait depuis s04 (résidu
 * `enabledModuleSchemas = []`, refermé en s07).
 */
export const ENABLED_SCHEMAS_FILE = 'index.ts'

/** Identifiant TypeScript dérivé d'un identifiant de module en `kebab-case`. */
const identifierOf = (moduleId: string): string =>
  moduleId.replace(/-([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase())

/**
 * Rend l'agrégat des schémas des modules activés.
 *
 * Il réexporte les **barils**, jamais les packages de modules directement : la
 * convention de nom de package est appliquée à un seul endroit, et l'agrégat
 * hérite ainsi de la garantie du baril — il ne contient que les tables que le
 * contrat déclare.
 *
 * L'import de type vers `@repo/db` est effacé à la compilation
 * (`verbatimModuleSyntax`) : il n'y a donc aucun cycle à l'exécution entre le
 * package de base de données et son agrégat.
 */
export function renderEnabledSchemasIndex(
  modules: readonly ModuleSchemaSource[],
): string {
  const header = [
    '// Fichier généré par `pnpm db:generate` depuis `config/features.ts`.',
    '// Ne pas éditer à la main : la CI régénère et compare.',
    '//',
    "// L'agrégat des schémas des modules **activés**, tel que le client Drizzle",
    '// le consomme pour la requête relationnelle (`db.query.<table>`). La',
    '// génération des migrations, elle, lit les barils un par un.',
    '',
    "import type { ModuleSchema } from '@repo/db'",
  ].join('\n')

  const sorted = [...modules].sort((left, right) => left.id.localeCompare(right.id))

  if (sorted.length === 0) {
    return `${header}\n\nexport const enabledModuleSchemas = [] as const satisfies readonly ModuleSchema[]\n`
  }

  const imports = sorted
    .map((module) => `import * as ${identifierOf(module.id)} from './${module.id}'`)
    .join('\n')

  const entries = sorted
    .map((module) => `  { id: '${module.id}', schema: ${identifierOf(module.id)} },`)
    .join('\n')

  return (
    `${header}\n${imports}\n\n` +
    `export const enabledModuleSchemas = [\n${entries}\n] as const satisfies readonly ModuleSchema[]\n`
  )
}

export interface ModuleSchemaBarrel {
  readonly moduleId: string
  /** Nom du fichier, relatif au dossier des barils. */
  readonly file: string
  readonly content: string
}

/**
 * Le contenu attendu du dossier des barils pour un jeu de modules activés.
 *
 * C'est la même fonction qui **écrit** le dossier (`pnpm db:generate`) et qui
 * le **vérifie** (la suite de tests, donc la CI). Deux implémentations
 * divergeraient, et la garde ne vaudrait plus rien le jour où elle servirait.
 */
export function planModuleSchemaBarrels(
  modules: readonly ModuleSchemaSource[],
): readonly ModuleSchemaBarrel[] {
  return modules.map((module) => ({
    moduleId: module.id,
    file: moduleSchemaBarrelFile(module.id),
    content: renderModuleSchemaBarrel(module),
  }))
}
