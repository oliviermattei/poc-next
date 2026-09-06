import { BUILD_ENV_KEYS, ENV_KEYS } from '@repo/config'
import type { NavigationSurface } from '@repo/core'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { z } from 'zod'

/**
 * **Les règles de la recette du profil minimal** (s26), isolées de la commande
 * qui les exécute — même forme que `scripts/golden-path-regime.ts` face à
 * `scripts/golden-path.ts`, et pour la même raison : une règle enfermée dans un
 * script n'est éprouvable qu'en lançant le script, donc en pratique jamais.
 *
 * ## L'interdit central : aucun module n'est nommé ici
 *
 * Ce fichier ne connaît ni `organizations`, ni `billing`, ni `i18n`, ni aucun
 * autre identifiant. Le profil fournit **la liste des modules à couper** ; tout
 * le reste — quelles routes ne doivent pas répondre, quelles entrées de
 * navigation ne doivent pas paraître, quelles tables ne doivent pas exister —
 * est **dérivé du contrat** que chaque module déclare déjà (`routes`,
 * `navigation`, `schema`).
 *
 * C'est le critère 8 de la story, et c'est ce qui le rend vrai par construction
 * plutôt que par discipline : un harnais qui vérifierait l'absence de trois
 * modules nommés passerait aujourd'hui et serait faux au module suivant — au
 * moment précis où plus personne ne regarderait.
 *
 * ## Et le second piège : un balayage vide passe
 *
 * Si la dérivation rend zéro route, zéro entrée et zéro table à vérifier, tout
 * est vert et rien n'est prouvé. `assertSweepIsNotEmpty` refuse ce cas, et
 * `assertNoTablesOfCutModules` exige en plus que les tables des modules
 * **activés** soient là : sur une base qui n'aurait pas migré, l'absence des
 * autres ne prouverait rien.
 */

/** Refus d'un profil ou d'une vérification. Son message nomme toujours le fautif. */
export class MinimalProfileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MinimalProfileError'
  }
}

const fail = (message: string): never => {
  throw new MinimalProfileError(message)
}

const quote = (value: string): string => `« ${value} »`

/**
 * Le profil, tel que `config/profiles.ts` le déclare : **une liste de modules à
 * couper, et rien d'autre**.
 *
 * Pas de routes attendues, pas de tables attendues, pas d'exceptions : tout
 * cela se dérive. Un profil qui porterait ces listes serait à maintenir à
 * chaque module ajouté, et c'est exactement le harnais que la story interdit.
 */
export interface ModuleProfile {
  /** Nom du profil, journalisé par la recette. */
  readonly id: string
  /** Les modules coupés. Vide : le profil vaut la configuration livrée. */
  readonly cut: readonly string[]
}

/**
 * Ce contre quoi un profil est validé : l'annuaire du dépôt et son socle non
 * désactivable, **reçus** et jamais lus ici — c'est la discipline de
 * `@repo/core`, sans laquelle aucun test ne pourrait éprouver un annuaire que
 * le dépôt ne contient pas.
 */
export interface ProfileContext {
  readonly available: readonly { readonly id: string }[]
  readonly required: readonly string[]
}

/**
 * Zod à la frontière, comme partout (`AGENTS.md`, « Rules that bite ») : le
 * profil est un fichier que le propriétaire édite, donc une entrée.
 */
const profileSchema = z.object({
  id: z.string().min(1),
  cut: z.array(z.string().min(1)),
})

/**
 * Rend le profil, ou refuse **en nommant** ce qui cloche.
 *
 * Trois refus, et ils disent trois choses différentes :
 *
 * 1. la forme — ce n'est pas un profil ;
 * 2. un identifiant que l'annuaire ne connaît pas : le plus probable est une
 *    faute de frappe, et sans ce refus elle serait silencieuse — un module
 *    « coupé » qui n'existe pas ne coupe rien, et la recette resterait verte en
 *    ne vérifiant pas ce qu'elle annonce ;
 * 3. un module du socle (ADR 021) : le couper produirait une application sans
 *    comptes, et le critère 6 — inscription et connexion de bout en bout —
 *    n'aurait plus de sens.
 */
export function parseModuleProfile(input: unknown, context: ProfileContext): ModuleProfile {
  const parsed = profileSchema.safeParse(input)

  if (!parsed.success) {
    return fail(
      `Profil invalide : ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(racine)'} — ${issue.message}`)
        .join(' ; ')}.`,
    )
  }

  const known = new Set(context.available.map((module) => module.id))
  const socle = new Set(context.required)

  for (const id of parsed.data.cut) {
    if (!known.has(id)) {
      fail(
        `Le profil ${quote(parsed.data.id)} coupe ${quote(id)}, qu’aucun module de l’annuaire ne ` +
          `déclare. Modules connus : ${[...known].join(', ')}.`,
      )
    }

    if (socle.has(id)) {
      fail(
        `Le profil ${quote(parsed.data.id)} coupe ${quote(id)}, qui appartient au socle non ` +
          'désactivable (ADR 021). Un profil ne choisit que parmi les modules optionnels.',
      )
    }
  }

  if (new Set(parsed.data.cut).size !== parsed.data.cut.length) {
    fail(`Le profil ${quote(parsed.data.id)} nomme deux fois le même module : ${parsed.data.cut.join(', ')}.`)
  }

  return { id: parsed.data.id, cut: parsed.data.cut }
}

/**
 * Ce que la dérivation lit d'un module : **exactement les quatre champs que son
 * contrat déclare déjà**.
 *
 * Structurel, et pas `AnyModuleDefinition` : ce qui compte est de pouvoir
 * éprouver la dérivation sur un annuaire que le dépôt ne contient pas — la même
 * discipline que `buildRegistry`, qui reçoit sa configuration au lieu de la
 * lire. Une définition réelle reste assignable.
 */
export interface ProfileModule {
  readonly id: string
  readonly requires: readonly string[]
  readonly routes: readonly { readonly method: string; readonly path: string }[]
  readonly navigation: readonly {
    readonly id: string
    readonly href: string
    /**
     * La surface où l'entrée est rendue (s31, ADR 066). Absente : la barre
     * latérale. Le type vient du contrat — **le seul import de `@repo/core` de
     * ce fichier, et il est de type** : réécrire l'union ici la ferait vieillir
     * à côté d'elle le jour où une troisième surface existe.
     */
    readonly surface?: NavigationSurface
  }[]
  /** Tables Drizzle, indexées par nom d'export — la forme du contrat. */
  readonly schema: Record<string, unknown>
}

/** Une route qui ne doit **pas** répondre, et le module qui la déclare. */
export interface SweptRoute {
  readonly moduleId: string
  readonly method: string
  readonly path: string
}

/** Une entrée de navigation qui ne doit **pas** paraître. */
export interface SweptEntry {
  readonly moduleId: string
  readonly entryId: string
  readonly href: string
  /**
   * La surface déclarée (s31), **transportée telle quelle**.
   *
   * Sans elle, « le lien disparaît du pied de page » ne serait pas dérivable :
   * la recette ne saurait pas dans quelle région de la page chercher l'absence,
   * et devrait nommer un module pour le savoir.
   */
  readonly surface?: NavigationSurface
}

/** Une table, et le module qui la déclare. */
export interface SweptTable {
  readonly moduleId: string
  readonly table: string
}

/**
 * Ce que la recette a **dérivé** du registre, et qu'elle va vérifier.
 *
 * Rien ici n'est écrit à la main : les trois listes viennent des contrats des
 * modules **non activés**, et `presentTables` de ceux qui le sont.
 */
export interface ProfileSweep {
  readonly profileId: string
  readonly cutModuleIds: readonly string[]
  readonly enabledModuleIds: readonly string[]
  /** Les routes des modules coupés : chacune doit rendre 404 (critère 3). */
  readonly routes: readonly SweptRoute[]
  /** Les entrées de navigation des modules coupés : aucune ne doit être rendue (critère 4). */
  readonly navigation: readonly SweptEntry[]
  /** Les tables des modules coupés : aucune ne doit exister (critère 5). */
  readonly absentTables: readonly SweptTable[]
  /**
   * Les tables des modules **activés**.
   *
   * Elles ne sont pas décoratives : sur une base qui n'aurait pas migré,
   * l'absence des autres ne prouverait rien. C'est le contrôle qui distingue
   * « aucune table de trop » de « aucune table du tout ».
   */
  readonly presentTables: readonly SweptTable[]
}

/**
 * Le nom **physique** des tables d'un module.
 *
 * Lu sur les objets Drizzle, comme `assertNoForbiddenModuleReferences` : le nom
 * d'export n'est pas le nom de la table, et c'est le second qui existe dans
 * `information_schema`. Un module sans table en rend zéro, ce qui est une
 * réponse et non un défaut — la garde de balayage vide est ailleurs.
 *
 * L'import est **dynamique par le type**, pas par la valeur : `PgTable` sert de
 * garde d'instance, et `getTableConfig` de lecture. Les deux viennent de
 * `drizzle-orm/pg-core`, comme dans `packages/db/src/references.ts`.
 */
export const moduleTableNames = (module: ProfileModule): readonly string[] =>
  Object.values(module.schema)
    .filter((candidate): candidate is PgTable => candidate instanceof PgTable)
    .map((table) => getTableConfig(table).name)

/**
 * **Tout se dérive de « ce qui n'est pas activé »**, jamais de la liste du
 * profil.
 *
 * La nuance porte tout le critère 8. Le profil dit ce qu'il coupe ; la
 * configuration livrée, elle, n'active déjà pas certains modules de l'annuaire
 * (`demo-disabled` dans ce dépôt). Un balayage fondé sur la liste du profil les
 * manquerait — et il faudrait le modifier au module suivant, ce que le
 * critère 8 interdit.
 */
export function sweepProfile(input: {
  readonly profileId: string
  readonly available: readonly ProfileModule[]
  readonly enabled: readonly string[]
}): ProfileSweep {
  const enabled = new Set(input.enabled)
  const cut = input.available.filter((module) => !enabled.has(module.id))
  const kept = input.available.filter((module) => enabled.has(module.id))

  return {
    profileId: input.profileId,
    cutModuleIds: cut.map((module) => module.id),
    enabledModuleIds: kept.map((module) => module.id),
    routes: cut.flatMap((module) =>
      module.routes.map((route) => ({
        moduleId: module.id,
        method: route.method,
        path: route.path,
      })),
    ),
    navigation: cut.flatMap((module) =>
      module.navigation.map((entry) => ({
        moduleId: module.id,
        entryId: entry.id,
        href: entry.href,
        ...(entry.surface === undefined ? {} : { surface: entry.surface }),
      })),
    ),
    absentTables: cut.flatMap((module) =>
      moduleTableNames(module).map((table) => ({ moduleId: module.id, table })),
    ),
    presentTables: kept.flatMap((module) =>
      moduleTableNames(module).map((table) => ({ moduleId: module.id, table })),
    ),
  }
}

/**
 * **Un balayage vide passe pour de mauvaises raisons.**
 *
 * Si la dérivation ne rend ni route, ni entrée, ni table, les trois
 * vérifications qui suivent sont vertes et n'ont rien vérifié. Ce refus est la
 * seule protection contre ce faux vert, et il nomme les modules coupés qui ne
 * déclarent rien : la réponse est de couper un module qui déclare quelque
 * chose, jamais d'assouplir la garde.
 *
 * Le contrôle porte sur le **total**, pas sur chaque catégorie : un module sans
 * table ou sans navigation est légitime, et exiger les trois rendrait un profil
 * honnête impossible à écrire.
 */
export function assertSweepIsNotEmpty(sweep: ProfileSweep): void {
  const swept = sweep.routes.length + sweep.navigation.length + sweep.absentTables.length

  if (swept > 0) {
    return
  }

  fail(
    `Le profil ${quote(sweep.profileId)} ne balaie rien : les modules coupés — ` +
      `${sweep.cutModuleIds.join(', ') || 'aucun'} — ne déclarent ni route, ni entrée de ` +
      'navigation, ni table. Les vérifications qui suivent seraient vertes sans rien vérifier.',
  )
}

/**
 * **Le schéma réel confronté au profil** (critère 5).
 *
 * Deux refus, et le second est celui qu'on oublie :
 *
 * 1. une table d'un module coupé **existe** — c'est la trace que le produit
 *    promet de ne pas laisser ;
 * 2. une table d'un module **activé** manque — la base n'a pas migré, et
 *    l'absence des autres ne prouve alors rien du tout.
 *
 * `tables` vient de `listDatabaseTables` (`packages/db/src/introspect.ts`),
 * c'est-à-dire d'`information_schema` : les fichiers de migration ne disent que
 * ce qu'on a écrit, pas ce qu'un import transitif a créé.
 */
export function assertNoTablesOfCutModules(input: {
  readonly sweep: ProfileSweep
  readonly tables: readonly string[]
}): void {
  const present = new Set(input.tables)

  const leaked = input.sweep.absentTables.filter((entry) => present.has(entry.table))

  if (leaked.length > 0) {
    fail(
      `Le profil ${quote(input.sweep.profileId)} coupe des modules dont la base porte encore les ` +
        `tables : ${leaked
          .map((entry) => `${entry.table} (module ${quote(entry.moduleId)})`)
          .join(', ')}. Sur une base vierge, une migration d’un module coupé a été jouée.`,
    )
  }

  const missing = input.sweep.presentTables.filter((entry) => !present.has(entry.table))

  if (missing.length > 0) {
    fail(
      `La base ne porte pas les tables des modules activés : ${missing
        .map((entry) => `${entry.table} (module ${quote(entry.moduleId)})`)
        .join(', ')}. L’absence des tables des modules coupés ne prouve alors rien — une base ` +
        'qui n’a pas migré n’en porte aucune.',
    )
  }
}

/**
 * La liste `enabledModules` telle que le profil la rend, ou un refus qui nomme
 * le module resté en l'air.
 *
 * Le refus n'est pas une redite de `resolveEnabledModules` : il arrive **avant**
 * la première écriture, alors que l'autre survient à la construction du
 * registre, c'est-à-dire après un clone et une installation.
 */
export function applyProfile(input: {
  readonly available: readonly ProfileModule[]
  readonly enabled: readonly string[]
  readonly required: readonly string[]
  readonly profile: ModuleProfile
}): readonly string[] {
  const profile = parseModuleProfile(input.profile, {
    available: input.available,
    required: input.required,
  })
  const cut = new Set(profile.cut)
  const next = input.enabled.filter((id) => !cut.has(id))
  const kept = new Set(next)

  for (const module of input.available) {
    if (!kept.has(module.id)) {
      continue
    }

    for (const requirement of module.requires) {
      if (cut.has(requirement)) {
        fail(
          `Le profil ${quote(profile.id)} coupe ${quote(requirement)}, que le module ` +
            `${quote(module.id)} requiert et qui reste activé. Coupez aussi ${quote(module.id)}, ` +
            'ou laissez son requis en place.',
        )
      }
    }
  }

  return next
}

/**
 * **La copie porte-t-elle réellement le profil ?** — l'ancre qui manquait.
 *
 * Tout ce que la recette vérifie ensuite est dérivé du registre **monté** dans
 * la copie : ces vérifications sont vraies d'elles-mêmes, et un module que
 * l'écriture aurait laissé activé n'en ferait broncher aucune. Le cas qui
 * l'illustre est celui d'un module qui ne déclare ni route, ni entrée de
 * navigation, ni table — il n'apparaît alors dans aucun balayage, et son
 * maintien serait invisible.
 *
 * La comparaison porte sur des **ensembles** : `writeEnabledModules` préserve
 * l'ordre du propriétaire, qui n'a pas à valoir celui de `enabledModules`.
 */
export function assertProfileWasApplied(input: {
  readonly profileId: string
  /** Ce que la recette a décidé d'activer. */
  readonly expected: readonly string[]
  /** Ce que la copie active réellement, relu dans son `config/features.ts`. */
  readonly actual: readonly string[]
}): void {
  const expected = new Set(input.expected)
  const actual = new Set(input.actual)

  const surplus = input.actual.filter((id) => !expected.has(id))
  const missing = input.expected.filter((id) => !actual.has(id))

  if (surplus.length === 0 && missing.length === 0) {
    return
  }

  fail(
    `La copie n’active pas ce que le profil ${quote(input.profileId)} a calculé : ` +
      `${surplus.length > 0 ? `encore activé(s) — ${surplus.join(', ')} ; ` : ''}` +
      `${missing.length > 0 ? `manquant(s) — ${missing.join(', ')} ; ` : ''}` +
      'les vérifications qui suivent sont dérivées du registre monté, elles seraient donc vraies ' +
      'd’elles-mêmes et ne diraient rien de ce module.',
  )
}

/**
 * Ce que la recette lit du rapport de la suite.
 *
 * `vitest run --reporter=json` en rend exactement ces quatre nombres, sous ces
 * noms. Ils sont relus par Zod comme le reste — un rapport dont la forme aurait
 * changé rendrait `undefined`, et `undefined >= plancher` est faux d'une façon
 * qu'on ne remarque pas.
 */
export interface SuiteCounts {
  readonly total: number
  readonly passed: number
  readonly skipped: number
  readonly failed: number
}

const vitestReportSchema = z.object({
  numTotalTests: z.number().int().nonnegative(),
  numPassedTests: z.number().int().nonnegative(),
  numPendingTests: z.number().int().nonnegative(),
  numFailedTests: z.number().int().nonnegative(),
})

/** Les comptes, lus dans le rapport JSON de Vitest. */
export function readSuiteCounts(report: unknown): SuiteCounts {
  const parsed = vitestReportSchema.safeParse(report)

  if (!parsed.success) {
    return fail(
      'Le rapport de la suite n’a pas la forme attendue de `vitest run --reporter=json` : ' +
        `${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}. Sans comptes, ` +
        'la recette ne peut pas distinguer une suite verte d’une suite qui s’est sautée.',
    )
  }

  return {
    total: parsed.data.numTotalTests,
    passed: parsed.data.numPassedTests,
    skipped: parsed.data.numPendingTests,
    failed: parsed.data.numFailedTests,
  }
}

/**
 * **Le plancher de cas exécutés**, et ce qu'il attrape *vraiment*.
 *
 * Il attrape un **effondrement de la collecte** : un `include` cassé, une
 * configuration qui ne collecte plus rien, un sous-processus qui rend zéro et
 * sort en 0.
 *
 * Il n'attrape **pas** la panne la plus probable de cette recette — une base
 * injoignable. Mesuré sur ce dépôt (revue de s26) : `DATABASE_URL` sur un port
 * mort rend 1 505 cas exécutés, soit cinq **au-dessus** de ce plancher. C'est
 * `MAX_SKIPPED_SHARE` qui refuse ce cas, avec ses 339 cas sautés, et
 * `tests/minimal-profile.test.ts` épingle exactement cette répartition — sans
 * quoi la phrase ci-dessus serait une affirmation que rien ne vérifie.
 *
 * Un plancher plutôt qu'une égalité : figer un compte ferait rougir la recette
 * à la première story qui ajoute un test.
 */
export const EXECUTED_FLOOR = 1_500

/**
 * **La part maximale de cas sautés.**
 *
 * C'est la garde que le plancher ne donne pas : une suite peut rester
 * volumineuse et se sauter à moitié. Mesuré sous le profil minimal : 11 cas
 * sautés sur 1 814, soit 0,6 % — la marge jusqu'à 5 % est large, et elle ne
 * fige aucun compte.
 */
export const MAX_SKIPPED_SHARE = 0.05

/**
 * Le verdict sur l'exécution de la suite sous le profil.
 *
 * Trois refus : un cas en échec, un effondrement du nombre de cas exécutés, une
 * proportion de cas sautés qui rend le vert sans valeur.
 */
export function assertSuiteCounts(counts: SuiteCounts): void {
  if (counts.failed > 0) {
    fail(
      `La suite compte ${counts.failed} cas en échec sous le profil : la promesse de modularité ` +
        'n’est pas tenue, et le compte des sautés ne dit rien tant que celui-ci n’est pas nul.',
    )
  }

  if (counts.passed < EXECUTED_FLOOR) {
    fail(
      `La suite n’a exécuté que ${counts.passed} cas sous le profil, sous le plancher de ` +
        `${EXECUTED_FLOOR}. Une suite verte qui ne collecte plus rien est verte pour la pire des ` +
        'raisons.',
    )
  }

  if (counts.total > 0 && counts.skipped / counts.total > MAX_SKIPPED_SHARE) {
    fail(
      `${counts.skipped} cas sautés sur ${counts.total} sous le profil, au-delà de la part ` +
        `admise (${Math.round(MAX_SKIPPED_SHARE * 100)} %). Un profil qui ferait sauter la moitié ` +
        'de la suite sans le dire donnerait un vert sans valeur.',
    )
  }
}

/**
 * Les comptes, journalisés — jamais un simple « suite verte ».
 *
 * **Aucun repère chiffré n'est imprimé ici.** La première écriture en portait un
 * (les comptes mesurés par la recherche), et il était faux d'une trentaine de
 * cas au moment de la revue : rien ne tenait ce nombre à jour, et un lecteur le
 * lisait pourtant comme une mesure du jour. Ce que la ligne dit désormais est ce
 * que le fichier sait vraiment — les seuils, qui sont dérivés des constantes
 * ci-dessus.
 */
export const suiteReport = (counts: SuiteCounts): string =>
  [
    'Suite complète sous le profil — comptes',
    `  exécutés : ${counts.passed}`,
    `  sautés   : ${counts.skipped} (part admise : ${Math.round(MAX_SKIPPED_SHARE * 100)} %)`,
    `  échecs   : ${counts.failed}`,
    `  collectés: ${counts.total}`,
    `  seuils   : plancher de ${EXECUTED_FLOOR} cas exécutés, ` +
      `${Math.round(MAX_SKIPPED_SHARE * 100)} % de cas sautés au plus. Des seuils, pas des ` +
      'repères : un compte du dépôt d’hier vieillirait ici sans que rien ne le dise.',
  ].join('\n')

/**
 * **L'arbre de travail est le même avant et après** (décision 1 du plan).
 *
 * La recette écrit dans `config/features.ts`, fichier suivi par git : une
 * recette qui basculerait le dépôt et mourrait en cours laisserait un diff que
 * personne n'a demandé, et ADR 041 interdit précisément les écritures pilotées
 * par agent sur un arbre sale.
 *
 * La comparaison porte sur `git status --porcelain`, donc sur la **différence**
 * et non sur la propreté : un arbre déjà sale — une story en cours d'écriture —
 * doit pouvoir lancer la recette. Ce qui est refusé est ce que la recette a
 * changé.
 */
export function assertWorkingTreeUnchanged(
  before: readonly string[],
  after: readonly string[],
): void {
  const wasThere = new Set(before)
  const isThere = new Set(after)
  const appeared = after.filter((line) => !wasThere.has(line))
  const gone = before.filter((line) => !isThere.has(line))

  if (appeared.length === 0 && gone.length === 0) {
    return
  }

  fail(
    'La recette a modifié l’arbre de travail, qu’elle ne doit jamais toucher — elle travaille ' +
      `dans une copie.${appeared.length > 0 ? ` Apparu : ${appeared.join(' ; ')}.` : ''}` +
      `${gone.length > 0 ? ` Disparu : ${gone.join(' ; ')}.` : ''}`,
  )
}

/**
 * **Ce que la recette a balayé**, journalisé à côté du verdict.
 *
 * Un « aucune trace trouvée » sans compte ne se distingue pas d'un balayage
 * vide. Les nombres sont dérivés, jamais écrits : ils suivent le profil et
 * l'annuaire sans que personne y touche.
 */
export const sweepReport = (sweep: ProfileSweep): string =>
  [
    `Profil ${quote(sweep.profileId)} — ce qui a été balayé`,
    `  modules coupés   : ${sweep.cutModuleIds.length} (${sweep.cutModuleIds.join(', ') || 'aucun'})`,
    `  modules activés  : ${sweep.enabledModuleIds.length} (${sweep.enabledModuleIds.join(', ') || 'aucun'})`,
    `  routes attendues absentes      : ${sweep.routes.length}`,
    `  entrées de navigation absentes : ${sweep.navigation.length}`,
    `  tables attendues absentes      : ${sweep.absentTables.length}`,
    `  tables attendues présentes     : ${sweep.presentTables.length}`,
  ].join('\n')

/**
 * **Où les traces d'une recette en échec sont conservées**, et pourquoi pas
 * sous `test-results/`.
 *
 * Playwright écrit ses traces dans le clone temporaire, que la recette
 * détruit : elle les recopie donc ici avant de le supprimer. C'est le constat
 * F8 de la revue de s25, hérité plutôt que repayé — le job de CI téléversait un
 * dossier qui n'avait jamais existé à la racine.
 *
 * Hors de `test-results/`, qui est l'`outputDir` par défaut de Playwright et
 * que `pnpm test:e2e` **efface au démarrage** : une trace conservée là et
 * balayée par la suite suivante ne se distingue pas d'une trace jamais écrite.
 *
 * Déclaré ici plutôt que dans la commande : le job de CI téléverse ce chemin,
 * et `tests/minimal-profile.test.ts` vérifie qu'ils désignent le même dossier.
 */
export const MINIMAL_PROFILE_TRACES_DIRECTORY = 'test-results-profil-minimal'

/**
 * **Les variables hors schéma qui arment une recette d'envoi ou de paiement
 * réel.**
 *
 * Elles ne sont dans aucun schéma — ce sont des drapeaux de recette, lus
 * directement par les suites concernées — mais laissées passer, elles feraient
 * jouer au clone une suite qui appelle un tiers, sans la clé correspondante
 * puisque celle-là est retirée. L'échec parlerait de Resend ou de Stripe, pas du
 * profil : exactement le mode d'échec que `cloneEnvironment` existe pour fermer.
 *
 * Trouvées par un balayage de `process.env.` sur les fichiers `.ts`/`.tsx`
 * suivis, hors `docs/` : ces cinq-là, lues par
 * `packages/adapters/resend/src/resend-live.test.ts`,
 * `packages/adapters/stripe/src/stripe-live.test.ts` et le SDK Resend
 * (`getDefaultBaseUrl`). **Aucune commande ne tient cette liste à jour** : un
 * sixième drapeau ajouté demain passerait, et la garde qui compte reste celle
 * du schéma, qui est dérivée.
 */
const LIVE_RECIPE_ENV_KEYS = [
  'STRIPE_LIVE_TEST',
  'STRIPE_LIVE_PRICE_ID',
  'RESEND_LIVE_TEST',
  'EMAIL_LIVE_TO',
  'RESEND_BASE_URL',
] as const

/**
 * **Ce que la recette retire de l'environnement du clone.**
 *
 * `ENV_KEYS` seul ne suffit pas : `@repo/config` lit aussi `BUILD_ENV_KEYS`
 * (`NEXT_PHASE`, `SKIP_ENV_VALIDATION`), et ces deux-là **désactivent la
 * validation d'environnement** (`isBuildPhase`). Un poste ou un runner qui
 * exporterait `SKIP_ENV_VALIDATION=1` verrait le clone démarrer sans valider le
 * `.env` qu'il vient de dériver — en silence, et la recette mesurerait alors
 * autre chose que ce qu'elle annonce.
 *
 * Les deux ensembles sont **dérivés** de `@repo/config`, jamais recopiés : une
 * variable ajoutée au schéma ou à la garde de build est couverte sans qu'une
 * ligne bouge ici.
 */
export const CLONE_STRIPPED_ENV_KEYS: readonly string[] = [
  ...ENV_KEYS,
  ...BUILD_ENV_KEYS,
  ...LIVE_RECIPE_ENV_KEYS,
]

/**
 * **L'environnement du clone : celui du système, et rien de l'application.**
 *
 * Le clone porte son propre `.env`, dérivé de `.env.example` — c'est le geste
 * que la recette éprouve. Or un `.env` ne l'emporte jamais sur une variable
 * déjà exportée : passer `process.env` tel quel au sous-processus recouvrirait
 * ce fichier par la configuration du poste, et la recette mesurerait alors la
 * machine de son auteur.
 *
 * Mesuré à la première exécution : `PAYMENTS_LOCAL_MODE` du clone contre le
 * `STRIPE_SECRET_KEY` du poste — l'environnement refusé, donc 338 cas sautés
 * faute de base joignable —, et `NODE_ENV=development` héritée là où Vitest
 * aurait posé `test`, ce qui armait une garde de `next-intl` réservée au
 * développement. Quinze cas rouges, aucun ne parlant du profil.
 *
 * `appKeys` est reçu plutôt que lu, comme partout ici : la liste de la recette
 * est `CLONE_STRIPPED_ENV_KEYS`, et les tests en éprouvent d'autres. Ce qui
 * reste — `PATH`, `HOME`, `TMPDIR`… — est ce sans quoi un sous-processus
 * n'existe pas.
 */
export function cloneEnvironment(
  parent: Readonly<Record<string, string | undefined>>,
  options: {
    /** La base **créée pour cette exécution** : la seule variable posée. */
    readonly databaseUrl: string
    /** Les variables que le schéma d'environnement déclare (`ENV_KEYS`). */
    readonly appKeys: readonly string[]
  },
): Record<string, string | undefined> {
  const application = new Set<string>(options.appKeys)

  const kept = Object.fromEntries(
    Object.entries(parent).filter(([key]) => !application.has(key)),
  )

  // Le type de retour n'est **pas** `NodeJS.ProcessEnv` : Next l'augmente d'un
  // `NODE_ENV` obligatoire, or son absence est précisément ce qu'on veut — le
  // sous-processus la choisit alors lui-même (Vitest pose `test`), et le `.env`
  // du clone fournit le reste.
  return { ...kept, DATABASE_URL: options.databaseUrl }
}
