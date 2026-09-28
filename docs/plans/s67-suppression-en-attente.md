---
validated: yes
---
# Plan — Story s67-suppression-en-attente

Branch: `feature/s67-suppression-en-attente`
Research: `docs/research/s67-suppression-en-attente.md` — read it first; this plan does not repeat it.
Décision : ADR 074 (la suppression demandée ferme le compte comme un bannissement).

## Target story
Fermer un compte dès la demande de suppression : marquage dans le socle, refus de chaque méthode de connexion indiscernable d'un compte inconnu (message **et** temps), garde dans l'écrivain de session, purge inchangée, fins d'emprunt journalisées, migration rétrocompatible. Six critères : `docs/stories.md`, s67. Sections de `docs/security.md` touchées : §2 (indiscernabilité, l. 30), §3 (journalisation des emprunts, l. 52), §7 (l. 161) — la story cite §3 à tort pour l'indiscernabilité (research, correction de prémisse).

## Tasks (ordered)
1. [x] **Colonne et migration** — `deletion_requested_at timestamptz null` sur `auth_user` (`packages/modules/auth/src/schema.ts`), migration par `pnpm db:generate` (jamais écrite à la main). **Tests** : la suite de schéma de `packages/db` (un schéma sans migration rougit) ; `pnpm db:migrate` deux fois sans effet supplémentaire.
2. [x] **Prédicat unique** — dans `domain/ban.ts` (ou un voisin `domain/sign-in-block.ts`), une règle pure `refusesSignIn({ banned, deletionRequested })` ; le dépôt expose une lecture unique (extension d'`isBanned` → `isSignInBlocked`, fermée par défaut pour un compte inconnu comme aujourd'hui). **Tests** : règle pure (quatre combinaisons) ; dépôt (inconnu, banni, en attente, ouvert).
3. [x] **Les deux gardes** — le crochet `databaseHooks.session.create.before` (`better-auth-service.ts:692-700`) et l'écrivain unique `sessions.create` (`drizzle-auth-repositories.ts:434` : `… and banned = false and deletion_requested_at is null`) consomment le prédicat ; la règle de lint (`tests/lint-rules.test.ts:1239-1294`) exige aussi le nouveau motif. **Tests** : `sessions.create` rend `false` pour un compte en attente ; la règle de lint rougit si le motif manque (cas de mutation déjà présent pour `banned`, à doubler).
4. [x] **Marquer à la demande** — `requestAccountDeletion` (`auth-use-cases.ts:1087-1135`) : après une émission réussie, poser `deletion_requested_at` (zéro ligne touchée si la purge synchrone a déjà effacé le compte : aucune erreur), puis `revokeAllForUser` dont le résultat est **gardé**. Émission refusée : rien posé, rien révoqué. **Tests** (`tests/account-deletion.test.ts`, régime `recording`) : après 202 le compte existe et porte la marque ; **nouveau cas** où l'émission est refusée → 503/`unavailable`, aucune marque, la session répond toujours 200 (constat m7 de la revue de s61).
5. [x] **Refus par méthode, indiscernable** — pour un compte en attente : mot de passe (401 `SIGN_IN_REFUSAL`, même corps qu'un inconnu), lien magique (mesurer d'abord la forme du refus — question ouverte 1 de la research — et la ramener au refus générique si elle diffère), OAuth (même classe d'erreur qu'un compte banni), passkey (`SIGN_IN_REFUSAL`), deuxième facteur (le crochet refuse la création de session). **Tests** (`tests/auth.test.ts`, à côté de « compte banni » l. 1198-1255) : un cas par méthode comparant statut et corps à ceux d'un compte inconnu ; **un test de temps** sur le modèle de l. 1160-1195 (compte en attente avec le bon mot de passe contre compte inconnu, passages entrelacés, même seuil).
6. [x] **Fins d'emprunt journalisées** — `requestAccountDeletion` rend les emprunts fermés (`endedImpersonationsOf`, comme `banAccount` l. 924-930) ; la route qui l'appelle les transmet au même consommateur que le bannissement, et le module `admin` les journalise (`logEndedImpersonations`) ; `auth.account_deletion_requested` porte `details: { sessionsRevoked }`. `packages/modules/admin/AGENTS.md` : la table des fins gagne la ligne « demande de suppression » (journalisée, **oui**) et son décompte suit. **Tests** : `tests/admin.test.ts` — un emprunt en cours sur un compte dont la suppression est demandée est clos **et** journalisé aux deux bouts ; l'événement porte le compte de sessions.
7. [x] **Purge inchangée** — la purge efface un compte marqué ; rejouée, aucun effet supplémentaire. **Tests** : les cas existants de `tests/account-deletion.test.ts` restent verts ; un cas « purge d'un compte marqué, rejouée deux fois, un seul email ».
8. [x] **E2E et documentation** — `e2e/rgpd.spec.ts` : après la demande, une reconnexion par mot de passe avec les bons identifiants est refusée avec le message générique. `packages/modules/auth/AGENTS.md` (l'état « suppression demandée », ses deux gardes, sa règle de lint), `docs/security.md` §2 (le compte en attente est traité comme inconnu). **Vérification** : `tests/agents-md.test.ts`, `E2E_PORT=… pnpm test:e2e`, `pnpm test:socle`.

## Run interdicts
- Pas de route, d'écran ou de commande pour **annuler** une demande de suppression (hors périmètre, ADR 074).
- `banned` ne change pas de sens ; aucun compte en attente n'est marqué `banned`.
- Aucun message ni code d'erreur propre à « compte en cours de suppression » dans une réponse publique.
- La purge (`runAccountPurge`, `purgeAccount`) ne change pas de comportement ; seules ses lectures peuvent voir la nouvelle colonne.
- Le module `auth` n'importe pas le module `admin`.
- Migration générée par `pnpm db:generate`, jamais `push`.
- Ne pas lancer une suite e2e complète pendant qu'une autre worktree en joue une (base partagée) : jouer d'abord les specs ciblées, la suite complète en fin de story.

## The point everything turns on
**L'indiscernabilité en temps.** Un compte en attente avec le bon mot de passe paie le hachage **et** la lecture du prédicat ; un compte inconnu paie un hachage factice (`auth-routes.ts:865-869`). Si l'écart dépasse le seuil du test existant, le refus devient un oracle d'existence d'une suppression en cours. À comparer : le test de temps de la tâche 5 contre celui d'un mauvais mot de passe (l. 1160-1195), sur la même machine, dans la même exécution.
Second point : le lien magique, dont la forme du refus n'a pas été vérifiée. Ne rien supposer : le premier test de la tâche 5 le mesure.

## Files touched
- `packages/modules/auth/src/{schema.ts,domain/ban.ts (ou sign-in-block.ts),application/auth-use-cases.ts,application/ports.ts,infrastructure/drizzle-auth-repositories.ts,infrastructure/better-auth-service.ts,presentation/auth-routes.ts}`, `packages/modules/auth/migrations/*` (générée), `packages/modules/auth/AGENTS.md`
- `packages/modules/admin/{src/application/admin-use-cases.ts (si le consommateur y vit),AGENTS.md}`, `apps/web/lib/admin.ts` ou `apps/web/lib/auth.ts` (le branchement des emprunts fermés)
- `tests/{account-deletion,auth,admin,lint-rules}.test.ts`, `e2e/rgpd.spec.ts`
- `docs/security.md`, `docs/decisions/074-…md`, ce plan

## Test strategy
- **Règle pure** : quatre combinaisons du prédicat.
- **Dépôt / écrivain de session** : refus pour un compte en attente, ouvert par défaut pour personne.
- **Routes** (Vitest avec base) : une preuve d'indiscernabilité par méthode (statut + corps) et une en temps.
- **Cas d'usage** : marquage après émission, rien si émission refusée, emprunts rendus et journalisés, compte de sessions dans l'événement.
- **Lint** : le motif de garde est exigé.
- **E2E** : reconnexion refusée après la demande.
**Mutations attendues en revue** : retirer `deletion_requested_at is null` de l'écrivain → le test d'écrivain et le lint rougissent ; poser la marque avant l'émission → le cas « émission refusée » rougit ; jeter le résultat de `revokeAllForUser` → le test de journalisation rougit ; renvoyer un message propre au lien magique → le cas lien magique rougit.

## Definition of Done
- Une PR, un commit de story portant l'ADR 074 et ce plan (la migration peut être un second commit si on veut pouvoir la reverter seule).
- Les six critères tenus ; `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:socle`, `pnpm db:migrate` rejoué verts.
- Revue passée ; CI verte sur `tous` et `socle` après merge.
