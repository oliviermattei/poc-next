import type { ModuleExportPayload, ModuleScope } from './module'
import { exportModules, type ModuleRegistry } from './registry'

/**
 * **L'archive d'un périmètre** (s35) — la forme que prend « toutes mes données ».
 *
 * Elle est construite ici, dans le socle, pour la même raison que l'exécution
 * des tâches y vit (s33) : elle doit répondre **quelle que soit** la
 * configuration des modules, et son contenu est dérivé du registre — le seul
 * endroit qui sache quels modules sont activés. Aucun module ne peut la
 * construire sans importer le registre, ce qui inverserait la dépendance qui
 * fait toute la modularité.
 *
 * ## Ce que l'archive contient, et ce qu'elle ne contient pas
 *
 * Elle est **entièrement en JSON**, et c'est une décision (s35, tâche 5) :
 *
 * - un seul module rend autre chose que des lignes — `storage`, qui possède des
 *   fichiers. Son export rend déjà un **manifeste** (identifiant, usage, type
 *   de contenu, taille, date), sans la clé d'objet, qui nommerait l'emplacement
 *   d'un objet dans un seau (`docs/security.md` §5). Les octets n'entrent donc
 *   pas dans l'archive : ils restent derrière les URL signées du module, et
 *   l'archive dit **ce qui existe**, pas ce qu'il pèse en pièces jointes ;
 * - une empreinte par fichier aurait demandé de **lire chaque objet** au moment
 *   de l'export — autant d'appels réseau sortants dans une requête — et de
 *   changer la forme de l'export d'un module existant, ce que le plan de s35
 *   exclut explicitement. Le manifeste est donc celui que `storage` rend déjà.
 *
 * **Ce que le manifeste ne permet donc pas** (ADR 062), et il faut le lire avant
 * de s'y fier : la personne constate qu'un fichier existe, son poids et sa date,
 * mais elle ne peut **ni le télécharger depuis l'archive, ni vérifier** que le
 * fichier qu'elle obtiendra par ailleurs est bien celui que le manifeste
 * décrit — il n'y a pas d'empreinte à comparer.
 *
 * La décision complète, avec ses options rejetées : `docs/decisions/062-…`.
 *
 * ## Pourquoi une liste et non un objet indexé
 *
 * `modules` est un tableau : il porte **l'ordre du registre**, celui dans lequel
 * les exports ont été appelés, et un objet indexé le perdrait au premier
 * sérialiseur qui trie ses clés.
 */
export const DATA_EXPORT_FORMAT_VERSION = 1

/** Ce qu'un module a rendu, avec les catégories qu'il déclare détenir. */
export interface DataExportModuleEntry {
  readonly id: string
  /**
   * Les catégories déclarées au contrat, **portées dans l'archive**.
   *
   * Sans elles, personne ne peut confronter ce qu'un module dit détenir à ce
   * qu'il a rendu : c'est ce qui rend `auditDataCategoryCoverage` possible, et
   * c'est aussi ce qui dit à la personne qui lit l'archive de quelles données
   * il s'agit.
   */
  readonly dataCategories: readonly string[]
  readonly payload: ModuleExportPayload
}

/** L'archive d'un périmètre, telle qu'elle est remise. */
export interface DataExportArchive {
  readonly formatVersion: number
  /** Instant de construction, en ISO 8601 — injecté, jamais lu de l'horloge ici. */
  readonly generatedAt: string
  readonly scope: { readonly kind: ModuleScope['kind']; readonly id: string }
  readonly modules: readonly DataExportModuleEntry[]
}

/**
 * Le refus est celui d'`exportModules`, transmis mot pour mot — mêmes noms de
 * champs que `PurgeModulesOutcome`, pour que l'appelant n'ait qu'un vocabulaire.
 */
export type BuildDataExportArchiveOutcome =
  | { readonly ok: true; readonly archive: DataExportArchive }
  | {
      readonly ok: false
      readonly exported: readonly string[]
      readonly failed: string
      readonly message: string
    }

export interface BuildDataExportArchiveOptions {
  readonly now?: () => Date
}

/** L'identifiant du périmètre, quelle que soit sa forme. */
export const scopeIdOf = (scope: ModuleScope): string =>
  scope.kind === 'user' ? scope.userId : scope.organizationId

/**
 * Construit l'archive du périmètre — **entière, ou pas du tout**.
 *
 * Le refus est celui d'`exportModules`, transmis tel quel : un module qui lève
 * arrête la construction en se nommant. Une archive amputée serait pire qu'un
 * échec, parce que la personne qui la reçoit n'a aucun moyen de savoir ce qui
 * lui manque.
 */
export async function buildDataExportArchive(
  registry: ModuleRegistry,
  scope: ModuleScope,
  options: BuildDataExportArchiveOptions = {},
): Promise<BuildDataExportArchiveOutcome> {
  const outcome = await exportModules(registry, scope)

  if (!outcome.ok) {
    return outcome
  }

  const now = options.now ?? (() => new Date())

  return {
    ok: true,
    archive: {
      formatVersion: DATA_EXPORT_FORMAT_VERSION,
      generatedAt: now().toISOString(),
      scope: { kind: scope.kind, id: scopeIdOf(scope) },
      modules: registry.modules.map((module) => ({
        id: module.id,
        dataCategories: [...module.dataCategories],
        payload: outcome.payloads[module.id] ?? {},
      })),
    },
  }
}

/**
 * Ce qu'une catégorie de données déclarée devient dans l'archive.
 *
 * Deux issues, et **aucune troisième** : elle est exportée, ou elle est exceptée
 * avec sa raison écrite. C'est la décision que la tâche 3 de s35 rend visible —
 * le contrat autorise `dataCategories: ['x']` avec `export: async () => ({})`,
 * et **rien ne vérifiait que les trois clés s'accordent**.
 */
export interface DataCategoryException {
  readonly moduleId: string
  readonly category: string
  /** Pourquoi cette catégorie ne sort pas dans l'archive. Vide, elle est refusée. */
  readonly reason: string
}

export type DataCategoryFinding =
  /** Un module déclare des catégories et n'a rien rendu : décision jamais prise. */
  | { readonly kind: 'not-exported'; readonly moduleId: string; readonly categories: readonly string[] }
  /** Une exception sans raison écrite : une exception tacite n'en est pas une. */
  | { readonly kind: 'unexplained-exception'; readonly moduleId: string; readonly category: string }
  /**
   * Une exception dont le module **est activé** mais ne déclare plus cette
   * catégorie : elle a vieilli. Un module absent du registre ne produit aucun
   * constat — son exception est dormante, pas périmée.
   */
  | { readonly kind: 'stale-exception'; readonly moduleId: string; readonly category: string }

/**
 * **Le garde d'accord entre `dataCategories`, `purge` et `export`** (s35, ADR 063).
 *
 * Il ne lit pas les noms des clés d'une charge utile : `billing` déclare
 * `subscription` et rend `subscriptions`, `marketing` déclare
 * `contact-message` et rend `messages` — une correspondance par le nom serait
 * une couverture par sous-chaîne, c'est-à-dire une illusion. Ce qu'il mesure est
 * ce qui se mesure : **un module qui dit détenir des données personnelles et
 * n'en rend aucune** n'a pas pris de décision, il en a hérité une par silence.
 *
 * L'exception est le seul moyen de dire « c'est voulu », et elle exige une
 * raison. Ajouter une catégorie sans l'exporter ni l'excepter rend un constat.
 *
 * La table des exceptions est **reçue**, jamais écrite ici : `@repo/core` ne
 * connaît aucun module par son nom.
 */
export function auditDataCategoryCoverage(input: {
  readonly archive: DataExportArchive
  readonly exceptions: readonly DataCategoryException[]
}): readonly DataCategoryFinding[] {
  const findings: DataCategoryFinding[] = []
  const declared = new Map(
    input.archive.modules.map((entry) => [entry.id, entry.dataCategories] as const),
  )

  for (const exception of input.exceptions) {
    const categories = declared.get(exception.moduleId)

    /**
     * **Une exception dont le module n'est pas dans ce registre est dormante,
     * pas périmée.**
     *
     * Chaque configuration est un produit livrable : `pnpm test:minimal-profile`
     * coupe des modules, et l'archive n'a alors aucune entrée pour eux. Sans
     * cette ligne, la table d'exceptions serait « périmée » dans toute
     * configuration qui coupe le module qu'elle nomme — mesuré.
     *
     * Ce que ce choix coûte : une exception nommant un module **supprimé du
     * dépôt** n'est jamais constatée. Ce garde accorde un registre et une table,
     * il ne vérifie pas l'existence des modules.
     */
    if (categories === undefined) {
      continue
    }

    if (!categories.includes(exception.category)) {
      findings.push({
        kind: 'stale-exception',
        moduleId: exception.moduleId,
        category: exception.category,
      })

      continue
    }

    if (exception.reason.trim() === '') {
      findings.push({
        kind: 'unexplained-exception',
        moduleId: exception.moduleId,
        category: exception.category,
      })
    }
  }

  for (const entry of input.archive.modules) {
    const excepted = input.exceptions
      .filter((exception) => exception.moduleId === entry.id && exception.reason.trim() !== '')
      .map((exception) => exception.category)
    const remaining = entry.dataCategories.filter((category) => !excepted.includes(category))

    if (remaining.length > 0 && Object.keys(entry.payload).length === 0) {
      findings.push({ kind: 'not-exported', moduleId: entry.id, categories: remaining })
    }
  }

  return findings
}
