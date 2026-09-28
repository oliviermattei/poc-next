---
validated: yes
---
# Plan — Story s63-application-sous-app

Branch: `feature/s63-application-sous-app`
Research: `docs/research/s63-application-sous-app.md` — read it first; this plan does not repeat it.
ADR: `docs/decisions/077-une-ligne-de-la-table-des-anciens-chemins-nomme-son-module.md` (amende le signal « servi » de l'ADR 075).
Pas de design : aucun écran ne change d'apparence.

## Target story
Servir les derniers écrans applicatifs sous `/app` (`/app/onboarding`, `/app/notifications`, `/app/premium`), 308 depuis les anciens chemins via la table, console et API intactes, un test dérivé qui empêche un écran applicatif de rester à la racine, e2e / golden-path / minimal-profile verts.

## Decisions (ne pas re-décider)
| Sujet | Décision |
|---|---|
| Déplacement | `git mv` de `apps/web/app/(app)/{notifications,onboarding,premium}` vers `apps/web/app/(app)/app/`. Imports relatifs corrigés (un niveau de plus). Contenu inchangé. |
| Constantes | `NOTIFICATIONS_SCREEN_PATH = '/app/notifications'`, `ONBOARDING_SCREEN_PATH = '/app/onboarding'`, `DEMO_PREMIUM_SCREEN_PATH = '/app/premium'`. Aucun consommateur ne réécrit la chaîne. |
| Table | Forme `Record<string, { target: string; module: string }>` ; trois lignes : `/notifications` → notifications, `/onboarding` → onboarding, `/premium` → `demo-enabled`. Lignes existantes : `/account` et `/app/settings/account` → `auth`, `/organizations` → `organizations`, `/billing` → `billing`. |
| Garde | `legacyScreenTarget(path, registry: Pick<ModuleRegistry,'moduleIds'>)` : cible si `moduleIds.includes(module)`, sinon `null` (ADR 077). Le proxy passe `moduleRegistry` inchangé. |
| Fixture | `tests/fixtures/legacy-screen-paths.json` : **inchangée** (elle contient déjà les trois chemins ; ils passent de « servis » à « redirigés »). |
| Réservations | `APPLICATION_SEGMENTS` garde `notifications`, `onboarding`, `premium` (anciens chemins redirigés, comme `account`) ; commentaires réécrits en conséquence. |
| Littéraux | `tests/legacy-paths.test.ts:204-209` : `ROOTS` += `packages/modules/notifications/src`, `packages/modules/onboarding/src`, `packages/modules/demo-enabled/src`. Littéraux e2e `'/premium'` (`golden-path.spec.ts:175,185`, `billing.spec.ts:227,245,264,266`) → constante ou helper de `e2e/support/locale.ts`. `tests/notifications.test.ts:1182,1238` : chaînes de test d'un `hrefForPage` injecté — les aligner sur la constante. |
| Critère 4 | Nouveau cas dans `tests/zones.test.ts` : toute page sous `(app)/` est sous `(app)/app/` — dérivé du disque. |
| Critère 1 (dérivé) | Nouveau cas (dans `tests/zones.test.ts` ou `tests/module-registry.test.ts`) : chaque entrée de navigation du registre complet de niveau `authenticated|role|entitlement`, hors surface `console` et hors `href` commençant par `MODULE_ROUTE_PREFIX`, a un `href` sous `/app`. |
| Console, API | Aucun fichier sous `(console)/` ni `apps/web/app/api/` ne bouge ; aucune ligne console dans la table. |

## Tasks (ordered)
1. [x] **Table + garde (ADR 077)** : nouvelle forme, nouvelle signature, `apps/web/proxy.ts` adapté si besoin. Tests : `tests/legacy-paths.test.ts` — :148-200 réécrit sur `moduleIds` (les deux moitiés restent : une ligne redirigée, une abandonnée, sur le registre socle) ; nouveau cas « chaque module nommé existe dans l'annuaire ».
2. [x] **Déplacements + constantes** (trois dossiers, trois constantes, imports relatifs). Vérif : `pnpm typecheck` ciblé sur `apps/web`, tests existants des trois modules (`tests/notifications.test.ts`, `tests/onboarding.test.ts`, `tests/billing.test.ts` pour premium) — seuls les chemins attendus changent.
3. [x] **Trois lignes de table** ; `ROOTS` du test des littéraux étendu ; `APPLICATION_SEGMENTS` commentaires.
4. [x] **Tests dérivés** (critères 1 et 4) dans `tests/zones.test.ts`.
5. [x] **E2E** : littéraux `'/premium'` → constante ; `e2e/support/locale.ts` si un chemin y est construit ; vérifier `onboarding.spec.ts`, `golden-path.spec.ts` (déjà sur constante). Ne pas lancer (ship).
6. [x] **Docs** : `docs/architecture.md` (écrans de l'application sous `/app`), `AGENTS.local.md` (layout : « `/app` est l'application » — ajouter que tout écran applicatif y vit), `apps/web/AGENTS.md` (lignes :`/notifications`, `/onboarding`).
7. [x] **Vérification** : `pnpm typecheck`, `pnpm lint`, `pnpm test` (une fois en fin), `pnpm test:minimal-profile`, `GOLDEN_PATH_PAYMENTS=simulated pnpm test:golden-path` ; `docs/verif/s63-application-sous-app.md`. Contrôle navigateur rapide : `/onboarding` → 308 `/app/onboarding`, `/fr/premium` → `/fr/app/premium`, cloche → `/app/notifications`.

## Run interdicts
- `apps/web/app/(console)/**` et `apps/web/app/api/**` : diff vide.
- `tests/fixtures/legacy-screen-paths.json` : diff vide.
- Aucune entrée de navigation ajoutée (la barre latérale ne change pas).
- Aucun `redirects()` dans `next.config.ts` ; aucune redirection hors de la table.
- Chemins d'API des modules (`PATHS` de `notification-routes.ts:45-49`, `onboarding-routes.ts:40-41`) : inchangés.
- Pas de chaîne `'/app/notifications'`, `'/app/onboarding'`, `'/app/premium'` hors des trois constantes (et des tests qui les éprouvent).

## The point everything turns on
Le changement de garde de la table (ADR 077). Trois endroits où il peut être faux : (a) un module coupé doit toujours donner `null` — comparer le socle (`buildRegistry` avec `requiredModules`) : `/organizations`, `/billing`, `/notifications`, `/onboarding`, `/premium` abandonnés, `/account` redirigé ; (b) l'identifiant écrit dans la table doit être l'`id` réel du module (`'demo-enabled'`, pas `'demo'`) — le test d'annuaire le tient ; (c) `test:minimal-profile` coupe `notifications` : son ancien chemin doit répondre 404, pas 308 vers un 404. Second risque : un littéral oublié qui marche par un saut de plus (critère 5) — le filet des littéraux doit couvrir les trois modules.

## Files touched
`apps/web/lib/legacy-paths.ts`, `apps/web/proxy.ts` (si la signature l'exige), `apps/web/app/(app)/app/{notifications,onboarding,premium}/page.tsx` (déplacés), `packages/modules/notifications/src/domain/notification.ts`, `packages/modules/onboarding/src/domain/onboarding.ts`, `packages/modules/demo-enabled/src/presentation/demo-item-routes.ts`, `apps/web/lib/organizations.ts` (commentaires), `tests/{legacy-paths,zones,notifications}.test.ts`, `e2e/{billing.spec.ts,golden-path/golden-path.spec.ts}`, docs.

## Test strategy
Budget 25 ; visé ~6 cas neufs ou réécrits.
- **Garde** (`tests/legacy-paths.test.ts`, 2 réécrits + 1 neuf) : socle → redirigés/abandonnés attendus ; proxy suit la configuration (existant, couvre les trois nouvelles lignes par itération) ; modules nommés ∈ annuaire.
- **Servi ou redirigé** (existant :47, :61) : couvre les trois chemins sans nouveau cas.
- **Dérivés** (`tests/zones.test.ts`, 2 neufs) : aucune page de `(app)` hors `app/` ; entrées protégées hors console/API sous `/app`.
- **Littéraux** : `ROOTS` étendu (cas existant).
- **Neutralisations à prouver** : garde qui rend toujours la cible → cas socle rougit ; remettre `premium/` sous `(app)/` → cas zones rougit ; remettre `'/premium'` littéral dans `apps/web` → filet rougit.
- **E2E / golden-path** : au ship (`pnpm test:e2e`) ; `pnpm test:golden-path` (critère 7, hors commandes du ship) est **joué en fin d'Execute** avec `GOLDEN_PATH_PAYMENTS=simulated`, et consigné au record.

## Definition of Done
Critères 1-7 ; `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:minimal-profile`, `pnpm test:golden-path` (simulated) verts, consignés dans `docs/verif/s63-application-sous-app.md` ; neutralisations constatées ; ADR 077 ; un commit, PR vers `dev`, revue sans critique.
