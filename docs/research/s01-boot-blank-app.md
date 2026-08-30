# Research — Story s01-boot-blank-app

## The five structuring facts

1. **Il n'y a rien à analyser : le dépôt ne contient aucun code applicatif.** 54 fichiers, tous de pipeline (`.claude/`, `templates/`, `docs/`), aucun `package.json`, aucun lockfile. La `codebase-analysis` ne produit donc aucune convention extraite : les conventions viennent de `docs/architecture.md` et de `AGENTS.md:126-148`, pas du code.
2. **s01 ne livre ni tests ni CI** — `docs/stories.md:60` place explicitement le harnais de qualité en s02. Or trois critères de s01 (`.env.example` vérifié par un test, `db:migrate` idempotent, `db:seed` rejouable) parlent de tests. C'est la tension principale de cette story, à trancher au plan.
3. **La forme de configuration de `drizzle-kit` a changé entre versions et la documentation publique mélange les deux.** Les exemples en ligne montrent encore `driver: 'pg'` + `generate:pg` (ancien) tandis que les versions récentes utilisent `dialect: 'postgresql'` + `dbCredentials: { url }` + `generate`. Écrire `drizzle.config.ts` de mémoire est le piège d'hallucination le plus probable de cette story.
4. **Le monorepo n'a pas besoin d'exister en entier.** `docs/architecture.md:24-46` décrit onze emplacements sous `packages/`, mais s01 n'en a besoin que d'un (`packages/db`) plus `apps/web`. Créer les autres vides serait du décor, et le contrat de module qui les justifie n'arrive qu'en s03.
5. **`/api/health` doit interroger la base, pas seulement répondre 200.** Le critère dit « répond 200 avec l'état de la connexion base de données » (`docs/stories.md:54`) : une route statique passerait le test sans rien prouver, et c'est précisément la route qui sert de vérification au déploiement en s27.

## Target story

`s01-boot-blank-app` — complexité annoncée 3, aucune dépendance, première story du projet.

**As a** Dev **I want** cloner le dépôt et obtenir une application qui démarre, connectée à Postgres **so that** je puisse construire dessus sans plomberie préalable.

Critères d'acceptation (`docs/stories.md:47-54`) :
1. `pnpm install && pnpm dev` démarre Next.js sans erreur sur un dépôt fraîchement cloné
2. Une variable d'environnement manquante ou malformée fait échouer le démarrage avec un message nommant la variable fautive (Zod)
3. `.env.example` liste toutes les variables lues par le schéma ; un test échoue si une variable du schéma en est absente
4. `pnpm db:migrate` applique les migrations sur une base vide et est idempotent au second lancement
5. `pnpm db:seed` peuple la base de développement et est rejouable sans erreur
6. `docker compose up` fournit un Postgres local utilisable, sans installation Postgres sur la machine
7. `/api/health` répond 200 avec l'état de la connexion base de données

## Current state of the code

Aucun code applicatif. Contenu du worktree :

| Chemin | Rôle |
|---|---|
| `AGENTS.md` | Règles du dépôt ; section « Technical conventions » (`AGENTS.md:126-148`) remplie par `/ks-architect` |
| `CLAUDE.md` | Une ligne : `@AGENTS.md` |
| `.gitignore` | `node_modules/`, `.env`, `.env.local`, `.DS_Store`, `.worktrees/` |
| `docs/` | prd, stories, architecture, design-system, reviews, decisions (10 ADR) |
| `templates/` | Gabarits du pipeline |
| `.claude/`, `.killer-saas/` | Commandes, agents, skills |

Pas de `package.json`, pas de `pnpm-workspace.yaml`, pas de `turbo.json`, pas de `.env*`, aucun remote git.

## Anchor points

Rien n'existe : cette story crée les points d'ancrage de toutes les suivantes. Cibles imposées par `docs/architecture.md:24-46` :

| À créer | Rôle | Consommé ensuite par |
|---|---|---|
| `package.json`, `pnpm-workspace.yaml`, `turbo.json` | Racine du monorepo | toutes |
| `apps/web/` | Application Next.js | s08 (shell), s10 (marketing) |
| `apps/web/app/api/health/route.ts` | Sonde de santé | s27 (déploiement) |
| `packages/db/` | Client Drizzle, composition des schémas, migrations | s04 (migrations par module), tous les modules |
| `packages/db/src/env.ts` ou `packages/config/` | Validation Zod de l'environnement | s02 (test `.env.example`), tous |
| `docker-compose.yml` | Postgres local | s02 (CI), s27 (compose de production) |
| `drizzle.config.ts` | Configuration drizzle-kit | s04 |
| `.env.example` | Contrat d'environnement | s02, s27 |

Le point d'ancrage le plus contraignant est `packages/db` : s04 devra y composer les schémas **par module** et n'appliquer que les migrations des modules activés. Un `packages/db` écrit en supposant un schéma unique et monolithique devra être rouvert en s04.

## Verified APIs / functions

Vérifié via Context7 sur la documentation à jour (`/drizzle-team/drizzle-orm-docs`, `/vercel/next.js`) :

| Élément | Fait vérifié |
|---|---|
| Route handler App Router | Fichier `route.ts` dans `app/`, export de fonctions nommées par méthode HTTP. `export async function GET() { return Response.json({ … }) }`. Les méthodes non implémentées renvoient 405 ; `HEAD` délègue à `GET`, `OPTIONS` est auto-implémentée. |
| `create-next-app --api` | Génère un `route.ts` d'exemple dans `app/` — utile comme point de départ de `/api/health`. |
| Migration programmatique | `import { migrate } from 'drizzle-orm/node-postgres/migrator'` puis `await migrate(db)`. C'est la voie pour `pnpm db:migrate` sans dépendre du binaire drizzle-kit en production. |
| `drizzle-kit migrate` | Lit les `.sql` du dossier de migrations, consulte la table de journal des migrations, n'applique que les nouvelles, découpe le SQL sur `--> statement-breakpoint`. **L'idempotence du critère 4 est donc fournie par l'outil**, pas à écrire à la main — mais elle doit être prouvée par un test qui lance la commande deux fois. |
| `drizzle-kit generate` | Génère les migrations SQL depuis le schéma. Approche « code first » : le schéma TypeScript fait foi, le SQL est un artefact versionné. |

## Traps & constraints

- **Configuration `drizzle.config.ts` : ne pas l'écrire de mémoire.** La documentation publique mélange l'ancienne forme (`driver: 'pg'`, `dbCredentials.connectionString`, `generate:pg`) et l'actuelle (`dialect: 'postgresql'`, `dbCredentials.url`, `generate`). Après installation, lire la version réellement installée et suivre sa forme. Une config à l'ancienne forme échoue avec un message peu explicite.
- **La validation d'environnement ne doit pas casser le build.** Un schéma Zod évalué à l'import module fait échouer `next build` en CI et en conteneur, où `DATABASE_URL` n'est pas toujours présente. Prévoir un mode « build » qui ne valide pas, ou une validation paresseuse au premier accès.
- **Le critère 3 impose que le schéma soit la source de vérité.** Le test compare `.env.example` aux clés du schéma Zod : ce dernier doit donc exposer la liste de ses clés de façon énumérable, ce qui exclut un `z.object` construit dynamiquement.
- **Le seed doit être rejouable, pas seulement exécutable.** `onConflictDoNothing` ou des identifiants déterministes ; un seed à identifiants aléatoires passe une fois puis duplique.
- **`docker compose up` doit être suffisant.** Prévoir un `healthcheck` sur le service Postgres, sinon `db:migrate` lancé juste après échoue sur une base qui n'écoute pas encore.
- **Pilote de connexion.** Neon en production (ADR 003) et Postgres conteneurisé en local n'utilisent pas le même pilote ni la même stratégie de connexions. `packages/db` doit encapsuler ce choix derrière un point d'entrée unique dès maintenant — c'est la promesse de portabilité Coolify de l'ADR 003.
- **Interdit explicite (`docs/stories.md:63`, `AGENTS.md`)** : jamais `drizzle-kit push` ; les migrations sont des fichiers SQL versionnés.
- **Aucun remote git** : sans incidence sur cette phase, bloquant pour `/ks-ship`.

## Open questions

1. **Quelle part du monorepo s01 crée-t-elle ?** Recommandation issue du fait n°4 : racine + `apps/web` + `packages/db` uniquement. `packages/core`, `ports`, `adapters`, `ui`, `modules` arrivent avec la story qui les justifie. À trancher au plan.
2. **Où vit la validation d'environnement ?** `packages/config` dédié, ou `packages/db/src/env.ts` étendu ensuite. Le critère 3 (test sur `.env.example`) et l'interdit « aucun `process.env` hors du module de configuration » (`AGENTS.md`) plaident pour un package dédié dès le départ.
3. **Bibliothèque de validation d'environnement** : `@t3-oss/env-nextjs` (gère la séparation serveur/client, mais une dépendance de plus) ou un schéma Zod maison (une trentaine de lignes, entièrement possédées). L'esprit du PRD — « du code qu'on a écrit et qu'on comprend » — penche pour le second.
4. **Comment tester sans le harnais de s02 ?** Trois critères exigent une vérification automatisée alors que Vitest arrive en s02. Options : installer Vitest en s01 pour ces seuls tests, ou livrer des scripts de vérification et déplacer l'assertion en s02. La première évite de laisser trois critères invérifiables au ship.
5. **Profondeur de `/api/health`** : `SELECT 1` suffit-il, ou faut-il aussi remonter le nombre de migrations appliquées ? Le critère dit « l'état de la connexion » — `SELECT 1` le satisfait ; s27 pourrait vouloir davantage.

## Real complexity

**Verdict : 3**, conforme au score annoncé — mais pour une raison différente de celle qu'on croit.

Aucune tâche n'est individuellement difficile : tout est du câblage documenté. La difficulté est ailleurs, dans deux décisions dont les conséquences portent sur les quarante-trois stories suivantes : la forme de `packages/db` (qui doit accueillir une composition par module en s04) et l'emplacement de la validation d'environnement (qui devient une règle transverse).

Deux facteurs pourraient faire dériver vers 4, à surveiller au plan :
- si s01 crée l'intégralité du squelette `packages/*` au lieu du strict nécessaire ;
- si la question 4 (tester sans le harnais de s02) se résout en installant tout Vitest, ce qui empiète sur s02.

Pas de proposition de découpage : le verdict n'est pas 5, et le découpage s01/s02 recommandé par la revue des stories a déjà été appliqué.
