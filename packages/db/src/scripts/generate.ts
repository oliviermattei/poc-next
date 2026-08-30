import { execFileSync } from 'node:child_process'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { buildRegistry } from '@repo/core'

import { availableModules, enabledModules } from '../../../../config/features'
import drizzleConfig from '../../drizzle.config'
import { planModuleSchemaBarrels } from '../barrel'
import { assertNoForbiddenModuleReferences } from '../references'

/**
 * `pnpm db:generate` — génération des migrations, module par module.
 *
 * Ce fichier est un **point de composition** : c'est lui, et non la
 * bibliothèque, qui lit `config/features.ts`. `@repo/db` reçoit des modules, il
 * ne connaît pas la configuration — sans quoi aucun test ne pourrait en
 * composer une autre.
 *
 * Trois étapes, dans cet ordre, et l'ordre est la garantie :
 *
 * 1. **Refuser les références inter-modules interdites**, avant d'écrire quoi
 *    que ce soit. Une clé étrangère vers un module qui n'est pas requis rend ce
 *    module silencieusement non désactivable ; la refuser après avoir écrit le
 *    SQL reviendrait à la refuser trop tard.
 * 2. **Écrire les barils** des modules activés, et supprimer ceux qui ne le
 *    sont plus. Le dossier est versionné et comparé à sa régénération : il ne
 *    peut pas diverger sans que la suite de tests rougisse.
 * 3. **Générer les migrations, un dossier par module.** Jamais un dossier
 *    unique : « activer un module génère ses migrations sans toucher à celles
 *    des autres » n'est vrai que si les autres ne sont pas réécrites.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const GENERATED_SCHEMA_DIR = join(REPO_ROOT, 'generated', 'schema')
const DRIZZLE_KIT = join(REPO_ROOT, 'node_modules', '.bin', 'drizzle-kit')

const registry = buildRegistry({
  available: [...availableModules],
  enabled: [...enabledModules],
})

// L'annuaire complet, et non les seuls modules activés : c'est ce qui permet de
// **nommer** le module propriétaire d'une table référencée alors qu'il n'est pas
// activé, au lieu de se contenter d'un « table inconnue ».
assertNoForbiddenModuleReferences(availableModules)

const barrels = planModuleSchemaBarrels(registry.modules)

await mkdir(GENERATED_SCHEMA_DIR, { recursive: true })

const expectedFiles = new Set(barrels.map((barrel) => barrel.file))

for (const name of await readdir(GENERATED_SCHEMA_DIR)) {
  // `.gitkeep` garde le dossier versionné quand aucun module n'est activé.
  if (name === '.gitkeep' || expectedFiles.has(name)) {
    continue
  }

  await rm(join(GENERATED_SCHEMA_DIR, name), { recursive: true })
  console.info(`Baril retiré : ${name}`)
}

for (const barrel of barrels) {
  await writeFile(join(GENERATED_SCHEMA_DIR, barrel.file), barrel.content, 'utf8')
}

/**
 * Le baril réexporte-t-il réellement les tables du contrat ?
 *
 * Le nom du package est une **convention** (`@repo/module-<id>`), pas une
 * déclaration du contrat. Une convention qu'on ne vérifie pas produit un baril
 * vide, donc « 0 tables », donc aucune migration — exactement le symptôme
 * silencieux que cette story ferme. La comparaison porte sur l'**identité** des
 * objets : un homonyme ne suffit pas.
 */
for (const barrel of barrels) {
  const module = registry.modules.find((candidate) => candidate.id === barrel.moduleId)
  const reexported: Record<string, unknown> = await import(
    pathToFileURL(join(GENERATED_SCHEMA_DIR, barrel.file)).href
  )

  for (const [name, table] of Object.entries(module?.schema ?? {})) {
    if (reexported[name] !== table) {
      throw new Error(
        `Baril incohérent pour le module « ${barrel.moduleId} » : la table « ${name} » ` +
          `n’est pas celle que le contrat déclare. Le package « @repo/module-${barrel.moduleId} » ` +
          `doit réexporter les tables de son schéma.`,
      )
    }
  }
}

for (const barrel of barrels) {
  const module = registry.modules.find((candidate) => candidate.id === barrel.moduleId)

  if (module?.migrations == null) {
    console.info(`Module « ${barrel.moduleId} » : aucune migration déclarée, rien à générer.`)
    continue
  }

  // Chemins **relatifs** à la racine du dépôt : passé un chemin absolu,
  // `drizzle-kit` le préfixe de `./` et ne retrouve plus son propre instantané
  // (`ENOENT: .//…/meta/0000_snapshot.json`), ce qui casse la seconde
  // génération et donc l'idempotence.
  execFileSync(
    DRIZZLE_KIT,
    [
      'generate',
      // Dialecte et casse viennent de `drizzle.config.ts` : deux déclarations
      // divergeraient, et une casse différente renommerait des colonnes.
      '--dialect',
      drizzleConfig.dialect,
      '--casing',
      drizzleConfig.casing ?? 'snake_case',
      '--schema',
      relative(REPO_ROOT, join(GENERATED_SCHEMA_DIR, barrel.file)),
      '--out',
      module.migrations,
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  )
}
