import type {
  AnyModuleDefinition,
  EmailTemplate,
  ModuleExportPayload,
  ModuleMessages,
  ModuleJob,
  ModuleRoute,
  ModuleScope,
  ModuleSession,
  NavigationEntry,
  WebhookHandler,
} from './module'
import { entitlementFeatureOf } from './entitlement'
import { satisfiesProtection } from './protection'
import { assertDeclarationsAreComplete, resolveEnabledModules } from './validate'

/**
 * Le registre : ce que l'application sait des modules, et rien de plus.
 *
 * Il n'agrège **que** les modules activés. C'est là que se joue la promesse du
 * produit : un module absent de `config/features.ts` n'a pas de route dans la
 * table de routage, pas d'entrée dans la navigation, pas de traduction, et sa
 * purge n'est pas dans la liste des purges à faire. Il n'y a nulle part un
 * `if (moduleActivé)` — il n'y a rien du tout, ce qui est plus fort.
 */

export interface RegistryRoute extends ModuleRoute {
  readonly moduleId: string
}

/** Une entrée de navigation prête à l'affichage : sa clé est déjà qualifiée. */
export interface RegistryNavigationEntry extends NavigationEntry {
  readonly moduleId: string
}

export interface RegistryEmailTemplate {
  readonly moduleId: string
  readonly template: EmailTemplate
}

export interface RegistryWebhookHandler {
  readonly moduleId: string
  readonly handler: WebhookHandler
}

export interface RegistryJob {
  readonly moduleId: string
  readonly job: ModuleJob
}

export interface ModuleRegistry {
  /** Les modules activés, dans l'ordre du graphe : un requis avant son requérant. */
  readonly modules: readonly AnyModuleDefinition[]
  readonly moduleIds: readonly string[]
  readonly routes: readonly RegistryRoute[]
  readonly navigation: readonly RegistryNavigationEntry[]
  /** Traductions fusionnées par locale, chaque clé préfixée par son module. */
  readonly messages: Readonly<Record<string, ModuleMessages>>
  readonly emails: readonly RegistryEmailTemplate[]
  readonly webhooks: readonly RegistryWebhookHandler[]
  /** Tâches planifiées à ordonnancer. Vide tant qu'aucun module activé n'en déclare. */
  readonly jobs: readonly RegistryJob[]
}

/** Clé de traduction qualifiée : deux modules peuvent nommer leur clé pareil. */
export const qualifyMessageKey = (moduleId: string, key: string): string =>
  `${moduleId}.${key}`

/**
 * Construit le registre depuis l'annuaire et la liste des modules activés.
 *
 * La configuration est **reçue**, jamais lue ici : `@repo/core` ne connaît pas
 * `config/features.ts`. Sans cela, aucun test ne pourrait construire un second
 * registre, et la modularité ne serait vérifiable que dans l'état où le dépôt
 * se trouve.
 */
export function buildRegistry(configuration: {
  readonly available: readonly AnyModuleDefinition[]
  readonly enabled: readonly string[]
  /** Le socle non désactivable, transmis tel quel à la validation (ADR 021). */
  readonly required?: readonly string[]
  /**
   * Les locales **de l'application** (`config/i18n.ts`), transmises comme le
   * socle : `@repo/core` ne les lit pas, il les reçoit. C'est contre cet
   * ensemble — et non contre les locales du module — que les templates d'email
   * et les libellés de navigation sont contrôlés.
   *
   * **Obligatoire**, et le mot compte : facultatif, il retombait en silence sur
   * les locales du module, c'est-à-dire exactement sur la faille de s06 que ce
   * paramètre existe pour fermer. Un point de composition qui l'oubliait ne
   * faisait rougir aucune commande (revue de s09). Le compilateur refuse
   * désormais l'omission, et `buildRegistry` la refuse aussi à l'exécution,
   * pour la porte que le compilateur ne garde pas.
   */
  readonly locales: readonly string[]
}): ModuleRegistry {
  const modules = resolveEnabledModules(configuration)

  assertDeclarationsAreComplete(modules, configuration.locales)

  const messages: Record<string, Record<string, string>> = {}

  for (const module of modules) {
    for (const [locale, catalog] of Object.entries(module.messages)) {
      const merged = messages[locale] ?? {}

      for (const [key, value] of Object.entries(catalog)) {
        merged[qualifyMessageKey(module.id, key)] = value
      }

      messages[locale] = merged
    }
  }

  const navigation = modules
    .flatMap((module) =>
      module.navigation.map((entry) => ({
        ...entry,
        moduleId: module.id,
        labelKey: qualifyMessageKey(module.id, entry.labelKey),
      })),
    )
    // Ordre déclaré, puis module, puis entrée : deux modules qui choisissent le
    // même rang ne doivent pas produire une navigation qui change d'ordre d'un
    // démarrage à l'autre.
    .sort(
      (left, right) =>
        left.order - right.order ||
        left.moduleId.localeCompare(right.moduleId) ||
        left.id.localeCompare(right.id),
    )

  return {
    modules,
    moduleIds: modules.map((module) => module.id),
    routes: modules.flatMap((module) =>
      module.routes.map((route) => ({ ...route, moduleId: module.id })),
    ),
    navigation,
    messages,
    emails: modules.flatMap((module) =>
      module.emails.map((template) => ({ moduleId: module.id, template })),
    ),
    webhooks: modules.flatMap((module) =>
      module.webhooks.map((handler) => ({ moduleId: module.id, handler })),
    ),
    jobs: modules.flatMap((module) => module.jobs.map((job) => ({ moduleId: module.id, job }))),
  }
}

/**
 * Préfixe unique sous lequel l'application monte les routes des modules.
 *
 * Un point de montage, pas un fichier de route par module : c'est ce qui fait
 * qu'un module non activé n'expose **rien**. Un fichier `route.ts` par module
 * qui répondrait `notFound()` serait une route exposée qui répond 404 — la
 * différence se voit dans le manifeste des routes de l'application.
 */
export const MODULE_ROUTE_PREFIX = '/api/modules'

export interface DispatchOptions {
  /**
   * Résout la session de l'appelant. Absent, personne n'est authentifié : toute
   * route non publique est refusée. Le module d'authentification (s07) branchera
   * ici sa propre résolution.
   */
  readonly resolveSession?: (request: Request) => Promise<ModuleSession | null>
  /**
   * Les fonctionnalités réservées que **cette session** a le droit d'utiliser
   * (s21, ADR 043).
   *
   * Même forme et même raison que `resolveSession` : `@repo/core` ne connaît
   * aucun module, et surtout pas celui qui vend. Il **reçoit** la réponse du
   * point de composition de l'application, qui interroge la facturation quand
   * elle est montée et accorde tout quand elle ne l'est pas (critère 6).
   *
   * **Absent, rien n'est accordé** : c'est le sens fermé, le même que celui de
   * `resolveSession` avant s07. Un point de composition qui l'oublie casse une
   * fonctionnalité payante ; l'inverse — accorder par défaut — offrirait
   * gratuitement ce que le produit vend, et personne ne s'en apercevrait.
   */
  readonly resolveFeatures?: (session: ModuleSession) => Promise<ReadonlySet<string>>
  readonly prefix?: string
}

const refuse = (error: string, status: number): Response =>
  // Aucun détail : ni le module, ni la raison exacte. Une réponse d'erreur
  // publique ne renseigne pas sur ce qui existe (socle de sécurité §7).
  Response.json({ error }, { status })

/**
 * Achemine une requête vers la route du module qui la déclare.
 *
 * Deux refus, et ils ne disent pas la même chose :
 * - **404** — aucune route activée ne correspond. C'est la réponse pour l'URL
 *   d'un module non activé : sa route n'est pas montée, elle n'existe pas.
 * - **401 / 403** — la route existe, la protection déclarée n'est pas
 *   satisfaite. Le gestionnaire n'est **pas** appelé : le refus n'atteint ni la
 *   règle métier, ni la persistance.
 *
 * L'appariement porte sur le couple (chemin, méthode) : une méthode qu'aucune
 * route ne déclare sur un chemin connu répond **404, et non 405** (ADR 017).
 * Un 405 énumère implicitement les méthodes acceptées, ce que le §7 du socle de
 * sécurité refuse. Chaque module hérite de ce choix : c'est écrit ici pour qu'il
 * en hérite sciemment, et `tests/module-registry.test.ts` l'épingle.
 */
export async function dispatchModuleRequest(
  registry: ModuleRegistry,
  request: Request,
  options: DispatchOptions = {},
): Promise<Response> {
  const prefix = options.prefix ?? MODULE_ROUTE_PREFIX
  const { pathname } = new URL(request.url)

  if (!pathname.startsWith(prefix)) {
    return refuse('not_found', 404)
  }

  const path = pathname.slice(prefix.length).replace(/\/$/, '') || '/'
  const route = registry.routes.find(
    (candidate) => candidate.path === path && candidate.method === request.method,
  )

  if (route === undefined) {
    return refuse('not_found', 404)
  }

  const session = (await options.resolveSession?.(request)) ?? null

  if (!satisfiesProtection(route.protection, session)) {
    // La même règle décide de la visibilité d'une entrée de navigation ; seule
    // la traduction du refus est propre au transport : 401 quand on ne sait pas
    // qui appelle, 403 quand on le sait et que ça ne suffit pas.
    return session === null ? refuse('unauthorized', 401) : refuse('forbidden', 403)
  }

  /**
   * **La seconde moitié de la protection réservée à une offre** (ADR 043).
   *
   * `satisfiesProtection` a déjà exigé une session — sans elle, il n'y a pas de
   * périmètre dont parler, et le refus est un 401 comme pour toute route
   * authentifiée. Reste la question qui demande une lecture, donc de
   * l'asynchrone : ce périmètre détient-il une offre qui ouvre cette
   * fonctionnalité ?
   *
   * **403 et non 404** : l'existence de la fonctionnalité est publique — le
   * catalogue d'offres la vend —, seul son usage est réservé. La règle des 404
   * (`docs/security.md` §3) protège l'existence de la ressource **d'autrui**,
   * ce qui n'est pas le cas ici.
   *
   * **Fail-closed** : pas de résolveur, pas d'accès.
   */
  const feature = entitlementFeatureOf(route.protection)

  if (feature !== null && session !== null) {
    const granted = await options.resolveFeatures?.(session)

    if (granted === undefined || !granted.has(feature)) {
      return refuse('forbidden', 403)
    }
  }

  return await route.handler(request, { session })
}

/**
 * Purge les données du périmètre dans **chaque module activé**, et rend la liste
 * de ceux qui ont été appelés.
 *
 * Un module non activé n'est pas dans la liste : sa fonction de purge n'est pas
 * appelée, et son absence ne provoque aucune erreur — il n'y a rien à ignorer.
 *
 * **L'ordre est celui du graphe, à l'envers : le dépendant avant son requis**
 * (ADR 029). C'est le seul ordre dans lequel un module peut encore résoudre ce
 * que son requis détient — et c'est aussi le sens des clés étrangères, un
 * dépendant référençant son requis (ADR 018). Mesuré en s16 : purgé après
 * `auth`, le module `organizations` ne pouvait plus lire l'adresse du compte
 * effacé, et l'adresse d'une personne survivait dans une invitation en attente.
 * Le montage, lui, garde l'ordre direct : une route d'un requis existe avant
 * celles de son dépendant.
 */
export async function purgeModules(
  registry: ModuleRegistry,
  scope: ModuleScope,
): Promise<readonly string[]> {
  for (const module of [...registry.modules].reverse()) {
    await module.purge(scope)
  }

  return registry.moduleIds
}

/** Export des données du périmètre, module activé par module activé. */
export async function exportModules(
  registry: ModuleRegistry,
  scope: ModuleScope,
): Promise<Readonly<Record<string, ModuleExportPayload>>> {
  const payloads: Record<string, ModuleExportPayload> = {}

  for (const module of registry.modules) {
    payloads[module.id] = await module.export(scope)
  }

  return payloads
}
