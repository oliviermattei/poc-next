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
