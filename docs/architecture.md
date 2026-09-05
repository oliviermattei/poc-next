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
| Couche API | **`dispatchModuleRequest` de `@repo/core`**, contrats `ModuleRoute` + Zod, TanStack Query | 005, 017 |

> **Divergence mesurée le 05/09.** L'ADR 005 a choisi Hono et oRPC, l'ADR 017 a présenté `ModuleRoute` comme une « forme transitoire jusqu'à Hono ». **Ni l'un ni l'autre n'a été livré** : zéro import `@orpc/*`, zéro import `hono`, zéro dépendance déclarée, sur douze modules et quarante stories. Les tableaux ci-dessous décrivaient l'intention comme si c'était l'état — ils ont fait écrire « contrats oRPC » dans le plan de s32, que l'implémenteur a eu raison d'ignorer. Le transport réel est le répartiteur de `@repo/core`. Reprendre la décision demande un ADR, pas une correction de prose.
| Architecture interne | Clean architecture à quatre couches par module | 006 |
| Composition | Contrat de module + `config/features.ts` | 007 |
| Providers | Resend, S3/R2, Stripe, Inngest, Sentry, PostHog, compteur PostgreSQL | 008 |
| Versions | Dernières majeures stables : Next 16, React 19, Tailwind v4, **TypeScript 7**, pnpm 10+, Node 20.10+ | 010, 011 |
| Tests | Vitest (unitaire), Playwright (end-to-end) | — |
| CI/CD | GitHub Actions ; Vercel en cible de référence, Docker et Coolify documentés | — |

## Repo structure

```
apps/
  web/                     Application Next.js — rendu, layouts, montage du répartiteur de modules
    app/api/[[...route]]/  Route handler attrape-tout : point de montage unique de l'API
config/                    Configuration éditée par le propriétaire du projet
  features.ts              Modules activés (typé, validé au démarrage)
  billing.ts               Offres : mode, prix, intervalle, essai, siège
  gating.ts                Fonctionnalités réservées : quelles offres les ouvrent (ADR 043)
  profiles.ts              Profils de configuration : quels modules optionnels un profil coupe (s26)
  marketing.ts             Sections de la page d'accueil, contenu et ordre
packages/
  core/                    Contrat de module, registre, validation de configuration
  db/                      Client Drizzle, composition des schémas, exécution des migrations
  api/                     Contrats de routes et middlewares partagés (le serveur Hono de l'ADR 005 n'a jamais été livré)
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
Dockerfile                 Image de production, trois étapes (build, migrations, exécution)
docker-compose.prod.yml    Pile de production : base, migrations, application
.dockerignore              Ce qui n'entre jamais dans le contexte de build, `.env` en tête
```

Un module non activé n'est pas importé par l'application : son package existe dans le dépôt, mais ni ses routes, ni sa navigation, ni ses migrations n'entrent dans la composition.

## Patterns & conventions

### Les quatre couches d'un module
```
packages/modules/<module>/src/
  domain/          Entités et règles métier pures. Aucune importation de framework, d'ORM ou de SDK.
  application/     Cas d'usage et ports. Dépend de domain uniquement.
  infrastructure/  Repositories Drizzle, appels aux adapters. Dépend de application et domain.
  presentation/    Routes `ModuleRoute`, composants React, navigation. Dépend de application et domain.
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
  routes: readonly ModuleRoute[]      // ADR 017 — présentée comme transitoire ; c'est la forme réelle et durable
  navigation: readonly NavEntry[]     // chacune avec son niveau de protection
  publicUrls: (context: PublicUrlContext) => readonly PublicUrl[]  // ce que le module donne à indexer (ADR 054)
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
Toutes les clés sont obligatoires dès le premier module, quitte à être vides (ADR 007). `jobs` est déclarative comme `routes` et `webhooks` : l'ordonnanceur de s33 se branche sur le registre, jamais sur un enregistrement à l'import — sinon la tâche planifiée d'un module non activé s'exécuterait. `requires` est typée `string[]` et non `ModuleId[]` : l'union des identifiants vient de l'annuaire, qui importe les modules ; la typer fermerait le cycle, et un requis mal orthographié est donc refusé à la construction du registre. `retention` est indexée par `dataCategories` : une catégorie déclarée sans politique ne compile pas. `routes` porte une forme transitoire (ADR 017), et l'annuaire statique de `config/features.ts` a sa propre conséquence documentée (ADR 016). `publicUrls` est la seule clé qui soit une **fonction** (ADR 054) : les URL d'un contenu découvert à la lecture n'existent pas à l'import, et `app/sitemap.ts` est un gestionnaire `force-dynamic` — un tableau déclaré serait figé au build, où aucune `APP_URL` n'est validée. C'est elle, et **non** les entrées de navigation publiques, qui décide de ce qui entre dans `sitemap.xml` et `robots.txt` : `public` est un niveau de protection, pas une décision d'indexation. Les ajouter plus tard obligerait à rouvrir chaque module déjà écrit.

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
- **Recette du profil minimal** (s26) : `pnpm test:minimal-profile` est le symétrique du parcours doré — celui-là prouve que le socle complet mène à un paiement, celle-ci que le socle réduit ne traîne rien (**critère de succès n°4 du PRD** : « aucune route morte, aucune entrée de nav orpheline, aucune table inutilisée »). Elle applique le profil de `config/profiles.ts` dans un **clone**, migre une **base créée pour l'exécution**, puis vérifie six choses : aucune route d'un module coupé ne répond, aucune entrée de navigation orpheline n'est rendue, aucune table d'un module coupé n'existe dans le **schéma réel** de la base (`information_schema`, jamais les fichiers de migration), la suite complète passe, ses **comptes** de cas exécutés et sautés sont journalisés, et l'inscription puis la connexion fonctionnent de bout en bout.

  **Un profil ne déclare que la liste des modules coupés.** Tout le reste est dérivé du contrat que chaque module publie déjà (`routes`, `navigation`, `schema`), et le balayage porte sur **tout module non activé** — pas seulement sur ceux que le profil nomme, sinon un module que la configuration livrée n'active déjà pas passerait au travers. C'est ce qui rend vrai « ajouter un module désactivé au profil ne demande aucune modification du harnais » : c'est une ligne dans `config/profiles.ts`, et rien d'autre nulle part.

  **Trois refus valent d'être connus**, parce qu'ils ferment autant de faux verts :

  | Refus | Le faux vert qu'il ferme |
  |---|---|
  | balayage vide | des modules coupés qui ne déclarent ni route, ni entrée, ni table rendraient les vérifications vertes sans rien vérifier |
  | table d'un module **activé** absente | sur une base qui n'a pas migré, l'absence des tables des modules coupés ne prouve rien |
  | part de cas sautés au-delà de 5 % | une suite « verte » dont la moitié s'est sautée en silence ; le compte exécuté a en plus un plancher |

  Elle travaille **dans une copie**, et le vérifie : `config/features.ts` est suivi par git, et une recette qui basculerait le dépôt puis mourrait laisserait un diff que personne n'a demandé (ADR 041). L'arbre de travail est comparé dès la fin de l'amorçage et à nouveau à la sortie, échec compris. Le clone ne reçoit **aucune variable d'application du poste** — la liste est dérivée du schéma d'environnement —, sans quoi le `.env` qu'il vient de dériver de `.env.example` serait recouvert par la configuration de la machine, et la recette mesurerait celle-ci.

  Elle n'entre pas dans `pnpm test:e2e` — chaque story paierait le clone et l'installation —, et son job de CI est **bloquant, sans condition**.
- **Recette de la configuration socle** (s48) : `pnpm test:socle` est la troisième recette de cette famille, et elle répond à une question que les deux autres ne posent pas — *la moitié « socle » de la matrice de CI est-elle verte ?* La CI joue deux configurations (`modules: tous` et `modules: socle`) ; la seconde n'était reproductible **nulle part** hors du runner, et une CI rouge cinq commits durant, dont l'unique cause vivait dans cette branche-là, s'est constatée après le push. `pnpm test:minimal-profile` ne la remplace pas : elle joue le profil de `config/profiles.ts`, qui coupe **un autre ensemble** de modules (deux d'écart, mesuré en s48).

  **Deux listes sont dérivées de `.github/workflows/ci.yml`, aucune n'est recopiée** : les modules coupés, lus dans l'étape gardée par `matrix.modules == 'socle'`, et les **étapes `run:` du job gardé**. Chacune de ces étapes est **soit rejouée, soit exclue avec sa raison écrite** ; une étape que la répartition ne classe pas fait échouer la commande en la nommant, si bien qu'un job qui gagne une étape force une décision au lieu d'hériter du silence. La commande **journalise ce qu'elle exclut et pourquoi**, à côté de ses durées — l'idiome du parcours doré, et la raison pour laquelle aucune liste d'étapes n'est recopiée ici : elle vieillirait à côté du code.

  Comme la recette du profil minimal, elle travaille **dans une copie** et le vérifie : couper un module réécrit `config/features.ts` et `generated/`, tous suivis par git. Ce qu'elle ne prouve pas : elle tourne sur le poste et non sur un runner Ubuntu, et elle ne provisionne pas le navigateur des parcours.
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

**Forme du port, posée en s06 et valable pour les suivants** : un port ne lève jamais, il rend un résultat discriminé (`{ok:true,…} | {ok:false,error}`). Une exception remonte aussi à l'appelant, mais *par défaut* — celui qui l'oublie rend un 500 et rien dans le type ne le lui rappelle. Le résultat discriminé impose la gestion au compilateur. Les doublures de test remplacent le **réseau**, jamais le SDK : la sérialisation, les en-têtes et le traitement de la réponse du fournisseur restent exercés.
| Authentification | — (bibliothèque) | Better Auth | s07 |
| Fichiers | `Storage` | S3 / Cloudflare R2 (API compatible S3) | s18 |
| Paiement | `Payments` | Stripe (checkout, portail, webhooks) | s19 |
| Jobs et cron | `Jobs` | Inngest, avec repli synchrone si le module est coupé | s33 |
| Erreurs | `Monitoring` | Sentry (source maps au build) | s39 |
| Analytique | `Analytics` | PostHog, chargée après consentement | s39 |
| Limitation de débit | `RateLimiter` | Compteur PostgreSQL (`rate_limit_window`), une seule implémentation | s28 |

Chaque port doit fonctionner en développement local **sans clé d'API** : capture locale des emails, stockage sur disque, jobs synchrones, analytique inerte.

**`RateLimiter` est le quatrième port livré** (s28, ADR 050), et le seul dont le
« fournisseur » est la base de l'application. Trois conséquences le distinguent
des trois autres, et elles sont écrites parce qu'elles dérogent :

- **il n'a pas de mode local sans clé**, parce qu'il n'a pas de clé : son magasin
  est `DATABASE_URL`, déjà exigée de toute application qui démarre ;
- **un magasin indisponible refuse**, là où le socle de fiabilité fait dégrader
  un tiers absent. Le raisonnement complet est dans l'ADR 050 : si la base est
  absente, la connexion ne fonctionne pas davantage — les sessions y vivent ;
- **il est appelé par le répartiteur, pas par les modules.** `dispatchModuleRequest`
  limite toute route **publique** du registre, plus toute route qui déclare un
  `rateLimit`, et il est **fail-closed** : sans garde injecté, une route limitée
  répond 429. La couverture est donc dérivée du registre, jamais énumérée — et
  neutralisable **par injection uniquement**, sans variable d'environnement
  (critère 8 de la story).

Sa table appartient au module `rate-limit`, **du socle non désactivable** : le
dépôt n'a qu'un mécanisme pour qu'une table ait un propriétaire, une migration et
un journal de migration. `public_form_throttle` (s11) et
`billing_checkout_throttle` (s24) ne sont plus écrites et restent en place,
inertes ; leur suppression est une story ultérieure (ADR 050).

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

## Déploiement (s27)

`docs/deployment.md` porte la chaîne complète : l'image, la pile, la checklist des variables et les guides Coolify et Vercel. Trois faits y sont structurants pour le reste du dépôt.

**L'application a deux points de démarrage, et un seul texte les garde** (ADR 049). `apps/web/lib/startup.ts` est appelé par `next.config.ts` (développement, build) **et** par `apps/web/instrumentation.ts` (chaque instance de serveur). Le second existe parce que `output: 'standalone'` sérialise la configuration Next dans `server.js` : `next.config.ts` n'est plus exécuté au démarrage du serveur, et sans ce second point l'image démarrerait **sans valider son environnement**.

**L'étape d'exécution n'hérite pas de la permissivité de l'étape de construction.** L'échappatoire de validation (`NEXT_PHASE`, `SKIP_ENV_VALIDATION`) est portée par la commande de build du `Dockerfile`, jamais par un `ENV` d'étape. Posée dans une étape, elle est héritée par toutes celles qui en descendent — et l'image démarre alors en production sans rien vérifier.

**Les migrations sont un conteneur distinct, joué avant le basculement du trafic.** `web` dépend de `migrate` par `service_completed_successfully` : une migration en échec empêche la nouvelle version de démarrer, et aucun trafic n'atteint un schéma à moitié appliqué. **Ce n'est pas une continuité de service** — mesuré sur une pile déjà en service, `docker compose up -d --build` recrée le conteneur `web` *avant* de jouer les migrations, si bien qu'une migration en échec laisse la pile sans rien qui réponde. Jouer `run --rm migrate` d'abord, ou basculer en bleu-vert, sont les deux formes qui ne coupent pas ; `docs/deployment.md` porte les trois états mesurés. Les migrations restent rétrocompatibles avec la version encore en ligne (`docs/reliability.md` §4).

## Points de vigilance repris des revues

- **s03 est la story la plus risquée du projet.** Le contrat de module conditionne les quarante suivantes.
- **Le lint de frontières est ce qui sépare une architecture d'une intention.** S'il est désactivé, la clean architecture disparaît en quelques stories.
- **La limitation de débit est livrée (s28, ADR 050).** Les états livrables antérieurs à cette story exposaient inscription, invitations, téléversement et checkout anonyme sans limite. Ce qui reste ouvert : le **captcha est encadré mais pas branché** — aucun fournisseur n'est livré —, et les deux tables de compteur d'avant s28 attendent la story qui les supprimera.
- **`e2e/modules.spec.ts` n'est pas agnostique à la configuration** : le fichier échoue quand les deux modules de démonstration sont activés (`expect(disabledModules.length).toBeGreaterThan(0)`). La suite Vitest, elle, est agnostique depuis le correctif F7 de s04. **À traiter avant s26** : une recette de modularité qui doit exclure un fichier de test ou tolérer des rouges connus cesse de prouver quoi que ce soit.
- **Trou d'accessibilité assumé depuis s02** : `eslint-config-next` a dû être abandonné (il tire `eslint-plugin-react@7.37.5`, qui appelle une API supprimée par ESLint 10 et interrompt le lint). Remplacé par `@next/eslint-plugin-next` et `eslint-plugin-react-hooks`. **`jsx-a11y` n'est donc plus couvert.** Vérifié en s08 : aucune version compatible ESLint 10 n'existe (dernière publication 6.10.2, octobre 2024, pair plafonné à `^9`). L'accessibilité repose donc sur les primitives Radix, sur des assertions de rôle et de navigation au clavier dans les parcours, et sur la vérification visuelle tracée en revue — c'est écrit dans `packages/ui/AGENTS.md`. À rétablir dès qu'une version compatible paraît.
- **ADR 006 n'est enforcé qu'à moitié** : la règle de dépendance entre couches l'est, la **pureté du `domain`** (aucun framework, aucun ORM, aucun SDK) ne l'est pas encore. Le mécanisme réel est `boundaries/dependencies` avec un sélecteur `to: { module: { origin, source } }` **et `checkAllOrigins: true`** — sans cette option, qui vaut `false` par défaut, les dépendances externes ne sont jamais examinées et la règle est inerte (mesuré en s03 dans `dist/Rules/Dependencies.js`). `boundaries/external` est déprécié ; la liste de refus est tranchée en s03, avec le premier module réel.
- **Deux points restent ouverts et devront être tranchés en Research** : l'accès au consentement quand le module marketing est coupé (finding F57), et le découpage éventuel de s37, la plus grosse story restante.
