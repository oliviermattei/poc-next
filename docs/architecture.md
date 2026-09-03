# Architecture — killer-boilerplate

> Décidée sur documents : le dépôt ne contient aucun code applicatif. Le squelette est produit par s01 et s02 à travers le pipeline, pas avant. Chaque décision structurante ci-dessous est adossée à un ADR dans `docs/decisions/`.

## Stack

| Couche | Choix | ADR |
|---|---|---|
| Langage | TypeScript strict | 001 |
| Framework | Next.js (App Router, React Server Components) | 001 |
| UI | Tailwind CSS v4 (configuration en CSS) + shadcn/ui sur **Radix UI** (Base UI n'a jamais publié de version stable — ADR 022), composants copiés dans `packages/ui` | 001, 022 |
| Monorepo | Turborepo + pnpm | 002 |
| Base de données | PostgreSQL 16+, Drizzle ORM, migrations SQL versionnées | 003 |
| Provider base | Neon par défaut, PostgreSQL conteneurisé (Coolify) supporté et testé | 003 |
| Authentification | Better Auth (plugins `organization`, `admin`, `two-factor`, `passkey`) | 004 |
| Couche API | Hono monté dans Next, contrats oRPC, TanStack Query | 005 |
| Architecture interne | Clean architecture à quatre couches par module | 006 |
| Composition | Contrat de module + `config/features.ts` | 007 |
| Providers | Resend, S3/R2, Stripe, Inngest, Sentry, PostHog, compteur PostgreSQL | 008 |
| Versions | Dernières majeures stables : Next 16, React 19, Tailwind v4, **TypeScript 7**, pnpm 10+, Node 20.10+ | 010, 011 |
| Tests | Vitest (unitaire), Playwright (end-to-end) | — |
| CI/CD | GitHub Actions ; Vercel en cible de référence, Docker et Coolify documentés | — |

## Repo structure

```
apps/
  web/                     Application Next.js — rendu, layouts, montage du serveur Hono
    app/api/[[...route]]/  Route handler attrape-tout : point de montage unique de l'API
config/                    Configuration éditée par le propriétaire du projet
  features.ts              Modules activés (typé, validé au démarrage)
  billing.ts               Offres : mode, prix, intervalle, essai, siège
  gating.ts                Fonctionnalités réservées : quelles offres les ouvrent (ADR 043)
  marketing.ts             Sections de la page d'accueil, contenu et ordre
packages/
  core/                    Contrat de module, registre, validation de configuration
  db/                      Client Drizzle, composition des schémas, exécution des migrations
  api/                     Serveur Hono racine, contrats oRPC, middlewares partagés
  ui/                      Design system : composants shadcn, tokens, primitives
  ports/                   Interfaces des dépendances externes, un fichier par capacité
                           (mail, storage, paiement, jobs, analytics, monitoring,
                           limitation de débit). Aucune dépendance d'exécution.
  adapters/                Une implémentation par port, **un package par adapter** :
                           resend, s3, stripe, inngest, sentry, posthog,
                           ratelimit-postgres. C'est le SDK qu'il faut isoler.
  emails/                  Rendu React Email des templates déclarés par les modules
  mailer-testing/          Doublure d'enregistrement et capture locale — **outils de
                           test, pas des fournisseurs** (ADR 008)
  modules/                 Un package par module applicatif
    auth/ organizations/ billing/ storage/ i18n/ marketing/ blog/ docs/ changelog/
    notifications/ jobs/ gdpr/ admin/ onboarding/ waitlist/ feedback/ roadmap/ …
tooling/                   Configurations partagées : eslint, typescript, tailwind, vitest
docs/                      PRD, stories, architecture, design system, décisions, recherches,
                           plans, revues
```

Un module non activé n'est pas importé par l'application : son package existe dans le dépôt, mais ni ses routes, ni sa navigation, ni ses migrations n'entrent dans la composition.

## Patterns & conventions

### Les quatre couches d'un module
```
packages/modules/<module>/src/
  domain/          Entités et règles métier pures. Aucune importation de framework, d'ORM ou de SDK.
  application/     Cas d'usage et ports. Dépend de domain uniquement.
  infrastructure/  Repositories Drizzle, appels aux adapters. Dépend de application et domain.
  presentation/    Routes Hono, contrats oRPC, composants React, navigation. Dépend de application et domain.
  module.ts        Déclaration du contrat de module.
  schema.ts        Tables Drizzle du module.
  migrations/      Migrations SQL du module.
  messages/        fr.json, en.json.
  emails/          Templates React Email et leurs locales.
```

Règle de dépendance : `presentation → application → domain` et `infrastructure → application → domain`. `infrastructure` et `presentation` ne se connaissent pas. La règle est **vérifiée par lint en CI**, pas par la relecture (ADR 006).

### Le contrat de module
```ts
interface ModuleDefinition {
  id: string
  requires: readonly string[]         // et non ModuleId[] : voir ci-dessous
  schema: DrizzleSchema
  migrations: MigrationsDir
  routes: readonly ModuleRoute[]      // ADR 017 — forme transitoire jusqu'à Hono
  navigation: readonly NavEntry[]     // chacune avec son niveau de protection
  messages: Record<Locale, Messages>
  emails: readonly EmailTemplate[]    // chacun avec ses locales
  webhooks: readonly WebhookHandler[]
  jobs: readonly ModuleJob[]          // tâches planifiées : identifiant + expression cron
  dataCategories: readonly DataCategory[]
  purge: (scope: UserScope | OrgScope) => Promise<void>
  export: (scope: UserScope | OrgScope) => Promise<ExportPayload>
  retention: Record<DataCategory, 'erase' | 'anonymize'>
}
```
Toutes les clés sont obligatoires dès le premier module, quitte à être vides (ADR 007). `jobs` est déclarative comme `routes` et `webhooks` : l'ordonnanceur de s33 se branche sur le registre, jamais sur un enregistrement à l'import — sinon la tâche planifiée d'un module non activé s'exécuterait. `requires` est typée `string[]` et non `ModuleId[]` : l'union des identifiants vient de l'annuaire, qui importe les modules ; la typer fermerait le cycle, et un requis mal orthographié est donc refusé à la construction du registre. `retention` est indexée par `dataCategories` : une catégorie déclarée sans politique ne compile pas. `routes` porte une forme transitoire (ADR 017), et l'annuaire statique de `config/features.ts` a sa propre conséquence documentée (ADR 016). Les ajouter plus tard obligerait à rouvrir chaque module déjà écrit.

### Règles transverses
- **Nommage** : fichiers en `kebab-case`, types et composants en `PascalCase`, fonctions et variables en `camelCase`, tables et colonnes en `snake_case`.
- **Validation** : Zod à chaque frontière — environnement, entrées de routes, webhooks, configuration.
- **Environnement** : aucune lecture directe de `process.env` hors du module de configuration. `.env.example` est exhaustif et vérifié par un test.
- **Migrations** : `drizzle-kit generate` uniquement, jamais `push` en production. Une migration doit être rétrocompatible avec la version encore en ligne.
- **Erreurs** : jamais de message distinguant « compte inconnu » de « mot de passe invalide ». Un accès à une ressource d'une autre organisation renvoie 404, jamais 403.
- **Permissions** : vérifiées côté serveur. Masquer un bouton n'est pas une permission.
- **Tests** : Vitest pour le domaine et l'application, Playwright pour les parcours. Deux régimes d'intégration tierce, jamais mélangés — doublure d'enregistrement et rejeu d'événements en CI (bloquants), clés de test réelles hors CI avant chaque ship.
- **Parcours doré** (s25, ADR 048) : `pnpm test:golden-path` mesure « clone → premier paiement » — clone local, `.env` depuis l'exemple, installation, migration et seed sur une **base créée pour l'exécution**, puis le parcours au navigateur et ses deux variantes. Le régime de paiement est **obligatoire et explicite** (`GOLDEN_PATH_PAYMENTS=recorded | simulated | live`) :

  | Régime | Ce qu'il joue | Où |
  |---|---|---|
  | `recorded` | des **formes enregistrées** chez le fournisseur, aucun appel sortant | CI (bloquant) et poste |
  | `simulated` | les formes **écrites à la main** de `@repo/payments-testing` | poste seulement — **refusé en CI** |
  | `live` | les **clés de test** réelles, et c'est lui qui **capture** les enregistrements — il **n'exécute pas le scénario** | poste, avant chaque ship — **jamais en CI** |

  **Le régime demandé doit se lire dans ce que le serveur a traité** : les événements écrits par la route de webhook portent la marque de leur source (`evt_rec_…` pour un rejeu, `evt_local_…` pour le simulateur), et la commande exige d'y retrouver celle du régime demandé. Sans ce signal positif, une exécution annonçant `recorded` pouvait être verte en ayant tourné sur le simulateur, la variable n'étant transmise au serveur par rien que personne ne gardait.

  **En CI, le job est armé par la donnée, jamais par un drapeau** : un job sonde cherche un enregistrement versionné (`hashFiles`, au niveau d'une **étape** — un `if:` de job est évalué avant tout `checkout` et GitHub y rejette la fonction, avec le fichier entier), et le parcours doré dépend de sa réponse. Tant que `tests/fixtures/stripe-events/` ne porte aucun enregistrement, il ne s'exécute pas ; à la première capture versionnée, il s'exécute et il est bloquant. `tests/golden-path.test.ts` garde les deux règles.

  **Un enregistrement absent fait échouer l'exécution en le nommant, jamais de repli sur le simulateur.** Un repli laisserait la CI verte en ayant cessé de vérifier ce qu'elle prétend vérifier ; c'est la même règle que « un port ne retombe jamais silencieusement sur un remplaçant local ». La commande **mesure** les trente minutes du PRD, elle ne les juge pas : un rouge à la trente-et-unième minute ferait d'une promesse commerciale une régression de CI. Elle n'entre pas dans `pnpm test:e2e` — chaque story paierait l'amorçage complet.
- **Commits** : un commit par story, message impératif en français, portant la recherche, le design et le plan de la story.

## Data model

Entités principales, par module propriétaire. Aucune table n'est partagée entre modules : les références inter-modules passent par l'identifiant et un port.

| Module | Entités |
|---|---|
| `auth` | `user`, `session`, `account` (fournisseurs OAuth), `verification`, `two_factor`, `backup_code`, `passkey` |
| `organizations` | `organization`, `member` (rôle owner/admin/member), `invitation` |
| `billing` | `customer`, `subscription`, `one_time_purchase`, `entitlement`, `webhook_event` (idempotence) |
| `storage` | `file` (propriétaire, type MIME, taille, clé de stockage) |
| `notifications` | `notification`, `notification_preference` |
| `marketing` | `public_subscription` (email + **source** : newsletter, waitlist), `contact_message` |
| `gdpr` | `deletion_request`, `export_request`, `consent` |
| `feedback` | `feedback_item` |
| `roadmap` | `roadmap_item`, `roadmap_vote` |
| `onboarding` | `onboarding_progress` |
| `ratelimit` | `rate_limit_window` (compteur partagé entre instances) |

Deux règles structurantes :
- **Le propriétaire d'une donnée est résolu par une fonction unique.** Selon que le module `organizations` est activé ou non, une donnée appartient à une organisation ou directement à un utilisateur. Le code appelant est identique dans les deux cas.
- **Une clé étrangère vers un autre module n'est permise que si ce module est un `requires` déclaré** (ADR 018). Toute autre référence inter-modules est refusée à la génération, les deux modules nommés. Le couplage cesse ainsi d'être silencieux : désactiver la cible sous sa source est déjà refusé par la validation de configuration. Contrepartie à traiter en s34/s35 : une telle clé impose un **ordre de purge**, inverse de l'ordre du graphe.

## Integration points

| Besoin | Port | Implémentation livrée | Story |
|---|---|---|---|
| Email transactionnel | `Mailer` | Resend | s06 |

**Forme du port, posée en s06 et valable pour les cinq suivants** : un port ne lève jamais, il rend un résultat discriminé (`{ok:true,…} | {ok:false,error}`). Une exception remonte aussi à l'appelant, mais *par défaut* — celui qui l'oublie rend un 500 et rien dans le type ne le lui rappelle. Le résultat discriminé impose la gestion au compilateur. Les doublures de test remplacent le **réseau**, jamais le SDK : la sérialisation, les en-têtes et le traitement de la réponse du fournisseur restent exercés.
| Authentification | — (bibliothèque) | Better Auth | s07 |
| Fichiers | `Storage` | S3 / Cloudflare R2 (API compatible S3) | s18 |
| Paiement | `Payments` | Stripe (checkout, portail, webhooks) | s19 |
| Jobs et cron | `Jobs` | Inngest, avec repli synchrone si le module est coupé | s33 |
| Erreurs | `Monitoring` | Sentry (source maps au build) | s39 |
| Analytique | `Analytics` | PostHog, chargée après consentement | s39 |
| Limitation de débit | `RateLimiter` | Compteur PostgreSQL, Redis documenté | s28 |

Chaque port doit fonctionner en développement local **sans clé d'API** : capture locale des emails, stockage sur disque, jobs synchrones, analytique inerte.

## Design / UX

Le design system global est capturé dans `docs/design-system.md` par `/ks-design-system`, à partir de `packages/ui`. Les écrans de chaque story dérivent de ce système ; inventer un composant ou un token hors système est interdit, un besoin non couvert se signale comme « design system gap ».

Écrans structurants, par ordre d'apparition : écrans d'authentification (s07), shell de tableau de bord avec navigation issue des modules actifs (s08), paramètres de compte (s08) et d'organisation (s15), page d'accueil sectionnée (s10), page de tarifs dérivée de `config/billing.ts` (s22), back-office superadmin (s37).

## Socles transverses

Trois référentiels s'appliquent à **toute** story, au même titre que la règle de dépendance des couches. Ils ne sont pas des phases : ce sont des contraintes permanentes, opposables en revue, et chacun de leurs contrôles nomme la vérification qui échoue s'il est violé.

| Socle | Référentiel | ADR | Portée |
|---|---|---|---|
| Sécurité | `docs/security.md` | 012 | En-têtes et politique de sécurité du contenu, sessions, autorisation, entrées/sorties, secrets, chaîne d'approvisionnement, journalisation et abus |
| Fiabilité | `docs/reliability.md` | 014 | Idempotence, dégradation, délais et reprises, migrations rétrocompatibles, observabilité |
| Dépôt orienté agents | `AGENTS.md` racine + par package | 013 | Règles localisées, contraintes exécutables, génération plutôt que devinette |

Le plan d'une story nomme les sections applicables ; la revue les vérifie en mutant le code, pas en lisant les intentions. Un manquement est un finding **critical**, au même rang qu'une régression fonctionnelle.

Conséquence directe sur le contrat de module : une route déclarée par un module indique son niveau de protection (publique, authentifiée, réservée à un rôle, réservée à une offre payante — ADR 043). Sans cela, le §3 du socle de sécurité serait invérifiable autrement que par relecture.

## Points de vigilance repris des revues

- **s03 est la story la plus risquée du projet.** Le contrat de module conditionne les quarante suivantes.
- **Le lint de frontières est ce qui sépare une architecture d'une intention.** S'il est désactivé, la clean architecture disparaît en quelques stories.
- **La limitation de débit arrive en s28.** Tous les états livrables antérieurs exposent inscription, invitations, téléversement et checkout anonyme sans limite : ne pas mettre un projet réel en production avant cette story.
- **`e2e/modules.spec.ts` n'est pas agnostique à la configuration** : le fichier échoue quand les deux modules de démonstration sont activés (`expect(disabledModules.length).toBeGreaterThan(0)`). La suite Vitest, elle, est agnostique depuis le correctif F7 de s04. **À traiter avant s26** : une recette de modularité qui doit exclure un fichier de test ou tolérer des rouges connus cesse de prouver quoi que ce soit.
- **Trou d'accessibilité assumé depuis s02** : `eslint-config-next` a dû être abandonné (il tire `eslint-plugin-react@7.37.5`, qui appelle une API supprimée par ESLint 10 et interrompt le lint). Remplacé par `@next/eslint-plugin-next` et `eslint-plugin-react-hooks`. **`jsx-a11y` n'est donc plus couvert.** Vérifié en s08 : aucune version compatible ESLint 10 n'existe (dernière publication 6.10.2, octobre 2024, pair plafonné à `^9`). L'accessibilité repose donc sur les primitives Radix, sur des assertions de rôle et de navigation au clavier dans les parcours, et sur la vérification visuelle tracée en revue — c'est écrit dans `packages/ui/AGENTS.md`. À rétablir dès qu'une version compatible paraît.
- **ADR 006 n'est enforcé qu'à moitié** : la règle de dépendance entre couches l'est, la **pureté du `domain`** (aucun framework, aucun ORM, aucun SDK) ne l'est pas encore. Le mécanisme réel est `boundaries/dependencies` avec un sélecteur `to: { module: { origin, source } }` **et `checkAllOrigins: true`** — sans cette option, qui vaut `false` par défaut, les dépendances externes ne sont jamais examinées et la règle est inerte (mesuré en s03 dans `dist/Rules/Dependencies.js`). `boundaries/external` est déprécié ; la liste de refus est tranchée en s03, avec le premier module réel.
- **Deux points restent ouverts et devront être tranchés en Research** : l'accès au consentement quand le module marketing est coupé (finding F57), et le découpage éventuel de s37, la plus grosse story restante.
