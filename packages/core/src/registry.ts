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
  PublicUrl,
  PublicUrlContext,
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

/** Une URL publique contribuée par un module, avec le module qui la donne. */
export interface RegistryPublicUrl extends PublicUrl {
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
  /**
   * Les URL publiques des modules activés (s53, ADR 054).
   *
   * **Une fonction, pas une liste**, et les deux raisons sont mesurées : les URL
   * d'un article n'existent qu'après lecture du contenu, et `app/sitemap.ts`
   * est un gestionnaire de route `force-dynamic` — un plan de site figé à la
   * construction du registre le serait aussi à celle du build, où `APP_URL`
   * n'est pas validée. Le contexte (les langues **servies**) arrive donc à
   * l'appel, pas à la composition.
   */
  readonly publicUrls: (context: PublicUrlContext) => readonly RegistryPublicUrl[]
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
    publicUrls: (context) =>
      modules.flatMap((module) =>
        module.publicUrls(context).map((url) => ({ ...url, moduleId: module.id })),
      ),
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

/**
 * **Ce que le garde de limitation rend au répartiteur** (s28, ADR 050).
 *
 * Volontairement pauvre : autorisé ou non, et dans combien de secondes
 * réessayer. Le répartiteur ne sait ni quel seau a refusé, ni de combien — il
 * n'en a pas besoin, et une réponse publique n'a rien à en dire
 * (`docs/security.md` §7).
 */
export interface RouteRateLimitVerdict {
  readonly allowed: boolean
  /** Ce que porte l'en-tête `Retry-After`. Doit suivre la fenêtre réelle. */
  readonly retryAfterSeconds: number
}

/**
 * Le garde de limitation, **injecté** comme `resolveSession` et
 * `resolveFeatures`.
 *
 * Même sens de dépendance, et pour la même raison : `@repo/core` ne connaît ni
 * `config/security.ts`, ni la base, ni le module qui compte. Il reçoit la
 * réponse du point de composition de l'application.
 *
 * C'est aussi ce qui rend la limitation **neutralisable par injection dans les
 * tests, sans variable d'environnement exploitable en production** (critère 8
 * de s28). Une neutralisation par variable serait une porte ; celle-ci n'existe
 * pas hors du processus de test, qui construit son propre garde.
 */
export type RouteRateLimitGuard = (input: {
  readonly route: RegistryRoute
  readonly request: Request
}) => Promise<RouteRateLimitVerdict>

/**
 * **Quelles routes sont limitées** — dérivé, jamais énuméré.
 *
 * Toute route **publique** l'est, qu'elle le déclare ou non : c'est ce qui rend
 * impossible d'en oublier une, et c'est la propriété que
 * `tests/rate-limiting.test.ts` compte au lieu de la supposer. Une route non
 * publique ne l'est que si elle le demande — l'invitation et le téléversement
 * le demandent, parce qu'une session n'est pas une limite.
 */
export const routeIsRateLimited = (route: ModuleRoute): boolean =>
  route.rateLimit !== undefined || route.protection.level === 'public'

/**
 * Ce que rend un refus quand **aucun garde n'est branché**.
 *
 * Le répartiteur est fail-closed sur la limitation comme il l'est sur les
 * fonctionnalités réservées : pas de garde, pas de passage. Un défaut inverse —
 * laisser passer — ferait d'un oubli de câblage une absence totale de
 * limitation que rien ne signalerait, en production comprise. Ici, l'oubli est
 * immédiatement visible : toutes les routes publiques répondent 429.
 */
const RETRY_AFTER_WITHOUT_GUARD = 60

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
  /**
   * Le garde de limitation de débit (s28). **Fail-closed** : absent, toute
   * route limitée répond 429.
   */
  readonly rateLimit?: RouteRateLimitGuard
  readonly prefix?: string
}

/**
 * Le refus de limitation : **429 avec `Retry-After`** (critère 1 de s28).
 *
 * La valeur suit la fenêtre réelle, elle n'est pas une constante — un
 * `Retry-After` figé ment, et un client honnête qui le croit réessaie trop tôt.
 * Le corps ne dit rien d'autre : ni quel seau a refusé, ni de combien.
 */
const tooManyRequests = (retryAfterSeconds: number): Response =>
  Response.json(
    { error: 'rate_limited' },
    { status: 429, headers: { 'retry-after': String(retryAfterSeconds) } },
  )

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

  /**
   * **La limitation vient avant tout le reste** (s28), et l'ordre est la règle.
   *
   * Avant la résolution de session : celle-ci lit la base à chaque requête, et
   * c'est précisément le coût qu'un martèlement cherche à faire payer. Avant le
   * gestionnaire, donc avant la bibliothèque d'authentification : le refus
   * n'atteint ni la règle métier, ni la persistance.
   *
   * Après l'appariement de la route, en revanche : un chemin qui n'existe pas
   * répond 404 sans toucher au compteur. L'inverse ferait du magasin une
   * surface d'attaque à part entière — n'importe quelle URL inventée y écrirait
   * une ligne.
   */
  if (routeIsRateLimited(route)) {
    const verdict = (await options.rateLimit?.({ route, request })) ?? {
      allowed: false,
      retryAfterSeconds: RETRY_AFTER_WITHOUT_GUARD,
    }

    if (!verdict.allowed) {
      return tooManyRequests(verdict.retryAfterSeconds)
    }
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
 * Ce que rend une purge : **ce qu'elle a fait**, jamais ce qui existe (s34).
 *
 * `purged` est la liste des modules **effectivement purgés**, dans l'ordre où
 * ils l'ont été. En échec, elle s'arrête avant le module fautif, que `failed`
 * nomme — c'est ce qui rend le critère 2 exprimable : « un module dont la purge
 * échoue interrompt l'opération et la laisse rejouable ». Sans le nom du module
 * et sans la liste de ce qui a abouti, un rejeu ne peut rien dire de ce qu'il
 * retrouvera.
 *
 * `message` vient de l'erreur levée par le module. Il est destiné à un journal
 * et à un appelant qui décide, jamais à une réponse HTTP : rien n'y garantit
 * l'absence de détail interne.
 */
export type PurgeModulesOutcome =
  | { readonly ok: true; readonly purged: readonly string[] }
  | {
      readonly ok: false
      readonly purged: readonly string[]
      readonly failed: string
      readonly message: string
    }

/**
 * Purge les données du périmètre dans **chaque module activé**, et rend ce
 * qu'elle a purgé.
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
 *
 * **Elle ne lève pas, et elle ne continue pas non plus** : un module qui échoue
 * arrête l'opération là — poursuivre effacerait les données que le module
 * fautif devait encore résoudre, et l'ordre inverse n'aurait plus de sens. Le
 * rejeu est ce qui répare : chaque purge de module est un effacement
 * conditionnel, donc un second passage ne retrouve rien de ce qui est déjà
 * parti (`docs/reliability.md` §1).
 */
export async function purgeModules(
  registry: ModuleRegistry,
  scope: ModuleScope,
): Promise<PurgeModulesOutcome> {
  const purged: string[] = []

  for (const module of [...registry.modules].reverse()) {
    try {
      await module.purge(scope)
    } catch (thrown) {
      return {
        ok: false,
        purged,
        failed: module.id,
        message: thrown instanceof Error ? thrown.message : String(thrown),
      }
    }

    purged.push(module.id)
  }

  return { ok: true, purged }
}

/**
 * Ce que rend un export de périmètre : **tout, ou le nom de ce qui a manqué**.
 *
 * La forme est discriminée comme celle d'un port (`AGENTS.md`) : le compilateur
 * force l'appelant à écarter l'échec avant de lire les charges, si bien qu'une
 * archive amputée ne peut pas être livrée par distraction.
 *
 * **Sœur de `PurgeModulesOutcome`, et volontairement**. La branche d'échec porte
 * les mêmes trois champs, sous les mêmes noms : ce qui a abouti, le module
 * fautif (`failed`), ce qu'il a dit (`message`). Deux formes différentes pour la
 * même idée obligeraient chaque appelant à apprendre deux vocabulaires.
 *
 * **La seule asymétrie est la branche de succès**, et elle a sa raison : une
 * purge n'a rien à rendre que la liste de ce qu'elle a fait, un export **est**
 * ce qu'il rend. `payloads` porte donc les données, et la liste des modules
 * lus s'en dérive — l'écrire en plus serait un second compte à tenir juste.
 */
export type ExportModulesOutcome =
  | {
      readonly ok: true
      readonly payloads: Readonly<Record<string, ModuleExportPayload>>
    }
  | {
      readonly ok: false
      /** Les modules déjà lus au moment de l'échec : une trace, pas une archive. */
      readonly exported: readonly string[]
      /** Le module qui a levé. Sans son nom, l'échec est irréparable. */
      readonly failed: string
      /** Ce que le module a dit, tel quel — jamais une charge utile. */
      readonly message: string
    }

/**
 * Export des données du périmètre, module activé par module activé.
 *
 * **Un export partiel est un échec, pas une archive** — et c'est plus lourd ici
 * que pour la purge. Une purge qui s'arrête laisse des données qu'un rejeu
 * effacera ; une archive qui s'arrête est **remise à une personne** qui exerce
 * son droit à la portabilité et qui n'a aucun moyen de savoir ce qui lui
 * manque. Le refus nomme donc le module, et la demande reste rejouable : rien
 * n'est écrit ici, l'appelant peut redemander.
 *
 * L'ordre est **direct** — celui du graphe, le requis avant son dépendant —,
 * contrairement à `purgeModules` qui le renverse. Une lecture n'a pas la
 * contrainte d'une suppression : rien ne disparaît pendant qu'on lit.
 */
export async function exportModules(
  registry: ModuleRegistry,
  scope: ModuleScope,
): Promise<ExportModulesOutcome> {
  const payloads: Record<string, ModuleExportPayload> = {}
  const exported: string[] = []

  for (const module of registry.modules) {
    try {
      payloads[module.id] = await module.export(scope)
    } catch (thrown) {
      return {
        ok: false,
        exported,
        failed: module.id,
        message: thrown instanceof Error ? thrown.message : String(thrown),
      }
    }

    exported.push(module.id)
  }

  return { ok: true, payloads }
}
