/**
 * Le contrat de module (ADR 007).
 *
 * Un module est l'unité de composition du produit : il déclare tout ce que
 * l'application doit savoir de lui, et l'application ne sait rien d'autre. Un
 * module non activé n'est jamais lu, donc n'expose ni route, ni navigation, ni
 * traduction, et ses fonctions de purge et d'export ne sont pas appelées.
 *
 * **Toutes les clés sont obligatoires dès le premier module**, quitte à être
 * vides. C'est la leçon que le PRD a déjà payée trois fois : ajouter `purge`,
 * `export` ou `retention` après vingt modules obligerait à rouvrir les vingt.
 * Un module sans donnée personnelle déclare `dataCategories: []` et
 * `retention: {}` — il le déclare, il ne l'omet pas.
 *
 * Deux garanties de ce fichier sont portées par le **compilateur**, et ce n'est
 * pas un détail d'implémentation :
 *
 * 1. `retention` est indexée par `dataCategories` : déclarer une catégorie de
 *    données sans dire ce que devient cette donnée à la suppression ne compile
 *    pas.
 * 2. `emails[].locales` est indexé par les locales de `messages` : un template
 *    livré sans version dans une locale livrée ne compile pas.
 *
 * `tests/fixtures/typing/` compile réellement ces deux refus, et
 * `tests/module-registry.test.ts` lit les diagnostics : une contrainte de
 * typage que personne n'a vue échouer n'existe pas.
 */

/** Traductions d'un module pour une locale : clé plate → texte. */
export type ModuleMessages = Readonly<Record<string, string>>

/**
 * Niveau de protection d'une route ou d'une entrée de navigation
 * (`docs/security.md` §3).
 *
 * Il est **déclaré**, pas déduit : sans cela, chaque module réinventerait sa
 * garde et le socle de sécurité ne serait vérifiable que par relecture. Une
 * route dont la protection n'est pas déclarée n'existe pas — le champ est
 * obligatoire.
 */
export type RouteProtection =
  | { readonly level: 'public' }
  | { readonly level: 'authenticated' }
  | { readonly level: 'role'; readonly role: string }
  /**
   * **Réservée à une offre payante** (s21, ADR 043).
   *
   * Le module **nomme** une fonctionnalité ; il ne dit pas quelle offre
   * l'ouvre, et il n'importe donc pas le module de facturation. C'est
   * `config/gating.ts` qui fait la correspondance, et le point de composition
   * de l'application qui donne au répartiteur de quoi y répondre
   * (`DispatchOptions.resolveFeatures`).
   *
   * Ce niveau **implique une session** : sans elle, le répartiteur répond 401
   * comme pour une route authentifiée, faute de savoir de quel périmètre
   * parler. Avec elle et sans le droit, il répond **403** — l'existence de la
   * fonctionnalité est publique, seul son usage est réservé, à la différence de
   * la ressource d'une autre organisation qui rend 404 (`docs/security.md` §3).
   */
  | { readonly level: 'entitlement'; readonly feature: string }

/** Méthodes HTTP qu'un module peut déclarer. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * Session de l'appelant, telle que le registre la voit.
 *
 * Aucun module d'authentification n'existe encore (s07) : le résolveur de
 * session du répartiteur renvoie `null` par défaut, et toute route non publique
 * est donc refusée. C'est le sens fermé : une route protégée n'est jamais
 * servie faute de savoir qui appelle.
 */
export interface ModuleSession {
  readonly userId: string
  readonly roles: readonly string[]
}

/**
 * Contexte passé au gestionnaire d'une route.
 *
 * `session` est `null` pour une route publique appelée anonymement. Pour une
 * route `authenticated` ou `role`, le répartiteur garantit qu'elle ne l'est
 * pas : il refuse avant d'appeler le gestionnaire.
 */
export interface ModuleRouteContext {
  readonly session: ModuleSession | null
}

/**
 * Une route déclarée par un module.
 *
 * Le chemin est celui du module, monté par l'application sous un préfixe
 * unique. Il ne porte pas de segment dynamique : le routeur riche (Hono, ADR
 * 005) arrive avec la couche API, et inventer ici un second mécanisme de
 * routage serait à jeter.
 */
/**
 * **La limitation de débit d'une route** (s28, ADR 050).
 *
 * Facultative, et cette asymétrie avec `protection` est délibérée : toute route
 * **publique** est limitée qu'elle le déclare ou non, par la politique
 * `default`. La couverture est donc **dérivée du registre**, jamais d'une liste
 * à tenir à jour — une route publique ajoutée demain est limitée sans que
 * personne y pense, et l'oubli n'est pas un mode d'échec possible.
 *
 * Ce champ sert à dire autre chose que le défaut :
 *
 * - **une politique nommée**, quand le défaut ne convient pas — un webhook que
 *   le fournisseur rejoue en rafale, un formulaire public plus serré ;
 * - **le compte visé**, sans lequel il n'y a pas de double limitation. C'est le
 *   seul moyen d'arrêter le bourrage d'identifiants distribué : dix mille
 *   adresses, un essai chacune, sur le même compte — chaque seau d'appelant
 *   reste sous son seuil ;
 * - **une route non publique à limiter quand même** — l'invitation et le
 *   téléversement sont authentifiés et nommés par la story ; une session n'est
 *   pas une limite.
 *
 * Le nom de la politique est une `string` et non une union : les seuils vivent
 * dans `config/security.ts`, que `@repo/core` ne lit pas. Un nom inconnu est
 * refusé **au démarrage** par `assertPoliciesCoverRoutes`, qui nomme la route.
 */
export interface RouteRateLimit {
  /** Nom de la politique, résolue dans `config/security.ts`. */
  readonly policy: string
  /**
   * Le champ du corps qui porte le compte visé — `email` sur la connexion.
   *
   * Absent, seul le seau de l'appelant compte. Présent et vide dans la requête,
   * de même : inventer une valeur créerait un seau que personne ne partage,
   * c'est-à-dire aucune limite.
   */
  readonly subjectField?: string
  /**
   * Les **noms exacts** des cookies qui peuvent porter le compte visé, quand le
   * corps ne le porte pas.
   *
   * La vérification de double authentification n'envoie qu'un code à six
   * chiffres et n'a délibérément pas de session : sans cela, son seul seau
   * serait celui de l'appelant, c'est-à-dire un en-tête que l'attaquant écrit.
   * Le cookie de défi, lui, est posé et signé par le serveur.
   *
   * **Des noms exacts, et non un suffixe.** Une correspondance par suffixe se
   * contourne par un leurre posé en tête de l'en-tête `Cookie`, que l'appelant
   * écrit intégralement : le limiteur compte le leurre pendant que la
   * bibliothèque valide le vrai cookie. C'est le constat C1 de la re-revue de
   * s28, mesuré contre l'application démarrée.
   *
   * Plusieurs noms sont déclarés parce que le nom réel dépend d'une
   * configuration que la déclaration de route ne connaît pas — elle est faite à
   * l'import, sans environnement. Quand **plus d'un** est présent dans la
   * requête, la limitation **refuse** au lieu de choisir : deviner rouvrirait le
   * contournement dans la moitié des déploiements.
   *
   * **Le nom exact ne suffit pas : la valeur doit l'être aussi.** Le constat M1
   * de la troisième revue de s28 a montré la même faute sur l'autre axe — le
   * limiteur bucketisait la sous-chaîne brute quand le serveur lit une valeur
   * déguillemetée puis décodée. Ce que le seau porte est la valeur **telle que
   * le serveur la lira** ; c'est le module de limitation qui la produit, et
   * c'est là que la règle est écrite (`packages/modules/rate-limit/AGENTS.md`).
   */
  readonly subjectCookies?: readonly string[]
}

export interface ModuleRoute {
  readonly method: HttpMethod
  readonly path: string
  readonly protection: RouteProtection
  /** Voir `RouteRateLimit`. Absent sur une route publique : politique `default`. */
  readonly rateLimit?: RouteRateLimit
  readonly handler: (
    request: Request,
    context: ModuleRouteContext,
  ) => Response | Promise<Response>
}

/**
 * Une entrée de navigation déclarée par un module.
 *
 * `labelKey` est une clé de traduction, jamais un libellé en dur : la
 * navigation d'un module traduit doit l'être aussi. `protection` sert la même
 * raison que sur une route — afficher l'entrée d'un écran auquel on n'a pas
 * accès divulgue son existence et promet ce qu'on refusera ensuite.
 *
 * Ce champ est **lu**, pas seulement déclaré : `visibleNavigation` retire les
 * entrées qu'une session ne satisfait pas, avec le prédicat qui décide aussi du
 * sort des routes. Une déclaration que personne ne lit est une règle qu'aucune
 * commande ne fait échouer (ADR 013).
 *
 * `href` doit mener à quelque chose que l'application sert réellement. Tant
 * qu'aucun mécanisme de page de module n'existe, c'est la route montée du
 * module ; un chemin d'écran qui répondrait 404 ferait de l'entrée un mensonge.
 */
export interface NavigationEntry {
  readonly id: string
  readonly href: string
  readonly labelKey: string
  readonly order: number
  readonly protection: RouteProtection
}

/** Sujet et corps d'un template d'email, pour une locale. */
export interface EmailTemplateContent {
  readonly subject: string
  readonly body: string
}

/**
 * Un template d'email et ses locales.
 *
 * `TLocale` est celui des `messages` du module : un template livré dans moins
 * de locales que le module ne compile pas.
 */
export interface EmailTemplate<TLocale extends string = string> {
  readonly id: string
  readonly locales: Readonly<Record<TLocale, EmailTemplateContent>>
}

/**
 * Événement entrant, tel qu'un module le reçoit.
 *
 * `id` n'est pas décoratif : le socle de fiabilité impose l'idempotence par
 * identifiant d'événement. Sans lui au contrat, chaque module inventerait sa
 * clé de rejeu.
 */
export interface WebhookEvent {
  readonly id: string
  readonly type: string
  /** Charge utile non validée : Zod à la frontière, dans le module. */
  readonly payload: unknown
}

/**
 * Un gestionnaire de webhook déclaré par un module.
 *
 * **Aucun répartiteur ne les appelle encore**, et cela décide de la forme :
 * `WebhookEvent` porte un `payload` **déjà parsé**, alors qu'une signature de
 * fournisseur se vérifie sur les **octets bruts** de la requête. Passer par ce
 * contrat obligerait donc à parser avant de vérifier, ce que
 * `docs/security.md` §4 interdit.
 *
 * Un module qui reçoit aujourd'hui un rappel signé le fait donc par une
 * **route déclarée**, publique, dont la garde est la signature — et il laisse
 * `webhooks: []`. C'est le cas de `billing` (s19). Ce n'est pas de la paresse,
 * c'est la seule forme qui tienne, et
 * `tests/module-registry.test.ts` porte le fil de détente : il rougit dès que le
 * `handle` d'un gestionnaire de webhook est **invoqué** dans `apps/web` ou dans
 * `packages/core/src` — à côté de `dispatchModuleRequest`, où un répartiteur
 * naîtrait le plus naturellement —, et ces modules doivent alors être rouverts.
 * Le motif cherché étant l'invocation elle-même, il ne s'écrit pas ici : ce
 * commentaire ferait rougir le cas qu'il décrit.
 */
export interface WebhookHandler {
  readonly id: string
  readonly source: string
  readonly eventTypes: readonly string[]
  readonly handle: (event: WebhookEvent) => Promise<void>
}

/**
 * Une tâche planifiée déclarée par un module.
 *
 * Elle est **déclarée**, pas enregistrée à l'import : c'est exactement ce que le
 * registre fait pour les routes et les webhooks, et pour la même raison — une
 * tâche qui s'enregistre en se chargeant s'exécuterait pour un module que la
 * configuration n'active pas. s33 branchera l'ordonnanceur (Inngest) sur cette
 * liste ; il n'aura pas à rouvrir les modules écrits d'ici là.
 *
 * `schedule` est une expression cron. Le contrat ne la valide pas : c'est
 * l'ordonnanceur qui la refusera, en nommant la tâche.
 */
export interface ModuleJob {
  readonly id: string
  readonly schedule: string
  readonly run: () => Promise<void>
}

/**
 * Périmètre d'une purge ou d'un export.
 *
 * Les deux formes existent dès maintenant parce que le propriétaire d'une
 * donnée dépend de l'activation du module organisations, et que le code
 * appelant doit être identique dans les deux cas (`docs/architecture.md`).
 */
export type ModuleScope =
  | { readonly kind: 'user'; readonly userId: string }
  | { readonly kind: 'organization'; readonly organizationId: string }

/** Ce qu'un module rend de ses données pour un périmètre donné. */
export type ModuleExportPayload = Readonly<Record<string, unknown>>

/**
 * Ce que devient une catégorie de données à la suppression du compte ou de
 * l'organisation : effacée, ou anonymisée (conservée sans rattachement).
 */
export type RetentionAction = 'erase' | 'anonymize'

/**
 * Le contrat, au complet.
 *
 * Les paramètres de type ne sont pas de la décoration : ce sont eux qui
 * transforment deux règles de revue en erreurs de compilation.
 *
 * - `TId` garde l'identifiant littéral, d'où `config/features.ts` tire l'union
 *   des identifiants connus ;
 * - `TCategory` indexe `retention` par `dataCategories` ;
 * - `TLocale` indexe les locales des emails par celles de `messages` ;
 * - `TSchema` préserve le type des tables Drizzle à travers la déclaration,
 *   pour que la composition de s04 ne les élargisse pas en
 *   `Record<string, unknown>`.
 */
export interface ModuleDefinition<
  TId extends string = string,
  TCategory extends string = string,
  TLocale extends string = string,
  TSchema extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Identifiant stable du module, en `kebab-case`. */
  readonly id: TId
  /**
   * Modules dont celui-ci a besoin. Activer un module sans ses requis échoue à
   * la validation, en nommant le manquant : c'est ce qui remplace la reprise
   * d'un « et si tel module est coupé ? » dans chaque story.
   *
   * `readonly string[]` et non `readonly ModuleId[]`, et l'asymétrie avec
   * `enabledModules` est assumée : l'union des identifiants est dérivée de
   * l'annuaire de `config/features.ts`, qui **importe** les modules. Typer
   * `requires` depuis cette union fermerait le cycle module → configuration →
   * module. Conséquence à connaître : une faute de frappe dans un requis n'est
   * pas attrapée par le compilateur mais à la construction du registre, qui
   * nomme le module introuvable et empêche le démarrage.
   */
  readonly requires: readonly string[]
  /**
   * Tables Drizzle du module, indexées par nom d'export.
   *
   * Volontairement typé structurellement : `@repo/core` ne dépend pas de l'ORM,
   * et cette forme est exactement celle que `composeSchema` consomme.
   */
  readonly schema: TSchema
  /**
   * Dossier des migrations SQL du module, ou `null` s'il n'en a aucune.
   *
   * Le contrat **déclare** ; il n'assemble pas. La composition des migrations
   * par module et le journal par module appartiennent à s04.
   */
  readonly migrations: string | null
  readonly routes: readonly ModuleRoute[]
  readonly navigation: readonly NavigationEntry[]
  readonly messages: Readonly<Record<TLocale, ModuleMessages>>
  readonly emails: readonly EmailTemplate<TLocale>[]
  readonly webhooks: readonly WebhookHandler[]
  /** Tâches planifiées du module. Celles d'un module non activé ne sont pas dans le registre. */
  readonly jobs: readonly ModuleJob[]
  /**
   * Catégories de données personnelles détenues par le module.
   *
   * C'est la liste qui rend `retention` vérifiable : sans elle, « une catégorie
   * déclarée sans politique » ne veut rien dire.
   */
  readonly dataCategories: readonly TCategory[]
  /** Politique de rétention, une entrée obligatoire par catégorie déclarée. */
  readonly retention: Readonly<Record<TCategory, RetentionAction>>
  /** Efface les données du périmètre. Appelée uniquement si le module est activé. */
  readonly purge: (scope: ModuleScope) => Promise<void>
  /** Rend les données du périmètre. Appelée uniquement si le module est activé. */
  readonly export: (scope: ModuleScope) => Promise<ModuleExportPayload>
}

/**
 * Un module quelconque, tel que le registre le manipule.
 *
 * Les champs indexés (`messages`, `retention`, `schema`) sont des types
 * anonymes : une déclaration concrète leur reste assignable, là où une
 * interface ne le serait pas.
 */
export type AnyModuleDefinition = ModuleDefinition

/**
 * Déclare un module.
 *
 * Passer par cette fonction plutôt que par une annotation est ce qui préserve
 * les littéraux : `id` reste `'billing'` et non `string`, les catégories et les
 * locales restent des unions fermées. Une simple annotation
 * `: ModuleDefinition` élargirait tout et désarmerait les deux contraintes du
 * compilateur.
 *
 * `NoInfer` dit d'où vient la vérité : les catégories sont celles de
 * `dataCategories`, les locales celles de `messages`, et ni `retention` ni
 * `emails` ne peuvent élargir l'union par leur seule présence.
 *
 * Mesuré, parce qu'une garantie qu'on n'a pas vue mordre n'en est pas une : le
 * retirer ne change rien aujourd'hui — les quatre fixtures de
 * `tests/fixtures/typing/` échouent toujours, l'inférence par type mappé
 * inverse étant de priorité plus basse que celle de `dataCategories`. Il est
 * conservé parce que c'est une **priorité d'inférence du compilateur** qui nous
 * sauve, pas une propriété du contrat : elle peut changer de version en
 * version, la déclaration non.
 */
export function defineModule<
  const TId extends string,
  const TCategory extends string,
  const TLocale extends string,
  const TSchema extends Record<string, unknown>,
>(definition: {
  readonly id: TId
  readonly requires: readonly string[]
  readonly schema: TSchema
  readonly migrations: string | null
  readonly routes: readonly ModuleRoute[]
  readonly navigation: readonly NavigationEntry[]
  readonly messages: Readonly<Record<TLocale, ModuleMessages>>
  readonly emails: readonly EmailTemplate<NoInfer<TLocale>>[]
  readonly webhooks: readonly WebhookHandler[]
  readonly jobs: readonly ModuleJob[]
  readonly dataCategories: readonly TCategory[]
  readonly retention: Readonly<Record<NoInfer<TCategory>, RetentionAction>>
  readonly purge: (scope: ModuleScope) => Promise<void>
  readonly export: (scope: ModuleScope) => Promise<ModuleExportPayload>
}): ModuleDefinition<TId, TCategory, TLocale, TSchema> {
  return definition
}

/**
 * L'union des identifiants d'un annuaire de modules.
 *
 * C'est ce type qui fait de « un identifiant inconnu ne compile pas » une
 * propriété du compilateur : `config/features.ts` déclare sa liste
 * `satisfies readonly ModuleIdOf<typeof availableModules>[]`.
 */
export type ModuleIdOf<TModules extends readonly AnyModuleDefinition[]> =
  TModules[number]['id']
