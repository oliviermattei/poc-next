# Research — Story s67-suppression-en-attente

> Vérifiée contre la branche par défaut au commit `7c5b33c`, en lecture seule (sous-agent de lecture, chaque fichier ouvert). Rien n'a été exécuté.

## The five structuring facts
1. **Le bannissement donne déjà toute la forme** (ADR 058) : colonnes `banned`, `banned_at`, `banned_reason` sur `auth_user` (`packages/modules/auth/src/schema.ts:74-83`) ; règle pure `refusesSignIn({banned})` (`domain/ban.ts:67-69`) ; crochet Better Auth `databaseHooks.session.create.before` qui lève `APIError('UNAUTHORIZED', { message: 'Invalid email or password' })` (`better-auth-service.ts:692-700`) ; **écrivain unique** de session `sessions.create` avec `insert(authSession).select(… where id = userId and banned = false)` (`drizzle-auth-repositories.ts:415-440`, garde l. 434) ; et une règle de lint qui exige cet écrivain et ce motif (`tests/lint-rules.test.ts:1239-1294`, motifs l. 1287-1288). « En attente de suppression » s'y branche : même lieu, même forme.
2. **`requestAccountDeletion`** (`auth-use-cases.ts:1028-1136`) : validation → confirmation (`auth.account_deletion_refused` si écart) → propriétés d'organisation → `jobs.emit('auth.purge-account', key 'purge-account:<userId>')` (l. 1087-1097) ; émission refusée → `unavailable` et rien d'autre (l. 1099-1111) ; puis `revokeAllForUser` (l. 1126) **dont le résultat est jeté** — les emprunts qu'il ferme ne sont ni extraits ni journalisés ; puis `auth.account_deletion_requested` **sans détails** (l. 1128-1133).
3. **La purge est idempotente par absence** : `runAccountPurge` (l. 1138-1290) sort si `users.findById` rend `null` (l. 1155-1163) ; `purgeAccount` révoque, efface les jetons, puis `users.deleteById` (l. 1292-1349) ; les tables filles sont en `onDelete: 'cascade'`. Marquer le compte ne change rien à ce chemin.
4. **L'indiscernabilité n'est prouvée que pour le mot de passe** : `tests/auth.test.ts:1198-1255` compare un compte banni à un compte inconnu (statut et corps) **par mot de passe seulement** ; aucun test de bannissement pour lien magique, OAuth, passkey ou 2FA ; aucun test de **temps** pour un compte banni. Le temps d'un compte inconnu contre un mauvais mot de passe est mesuré (`tests/auth.test.ts:1160-1195`, 9 passages entrelacés, écart < 50 % de la plus grande médiane).
5. **La journalisation des fins d'emprunt existe et se réutilise** : `revokeAllForUser` rend `{id, userId, impersonatedBy}` (`drizzle-auth-repositories.ts:360-368`) ; `endedImpersonationsOf` (`auth-use-cases.ts:71-78`) les extrait, et `banAccount` les rend (`:924-930`) pour que le module `admin` les journalise (`logEndedImpersonations`, `admin-use-cases.ts:344-354`). La table des fins est dans `packages/modules/admin/AGENTS.md:198-217` (« les sept fins balayées »).

## Target story
Voir `docs/stories.md`, s67 (six critères) : marquer le compte en attente dans la même opération que la mise en file ; refuser chaque méthode de connexion comme un compte inconnu, en message et en temps ; garde dans l'écrivain de session ; purge inchangée et rejouable ; fins d'emprunt journalisées, table à jour, compte de sessions dans l'événement ; migration rétrocompatible.

**Correction de prémisse** : la story cite `docs/security.md` §3 pour l'indiscernabilité ; elle est en **§2** (l. 30 : « Messages d'erreur indistinguables entre compte inconnu et mot de passe invalide, y compris en temps de réponse ») et **§7** (l. 161). Le §3 porte le 404 (l. 49) et la journalisation des emprunts (l. 52).

## Current state of the code
- Aucune colonne `pendingDeletion`/`deleted_at` ; le compte vit jusqu'à la purge.
- `isBanned` (`drizzle-auth-repositories.ts:164-173`) rend `true` pour un compte inconnu — la garde est fermée par défaut.
- Refus par méthode : mot de passe → `genericSignInRefusal` réécrit 401/403 en `SIGN_IN_REFUSAL` (`domain/credentials.ts:150-153, 176-178`) ; passkey → `SIGN_IN_REFUSAL` sur toute réponse non ok (`auth-routes.ts:1564-1566`) ; OAuth → `onAPIError.errorURL` puis `/sign-in?oauth=<classe>` (`better-auth-service.ts:710`, `auth-routes.ts:666-690`) ; lien magique → réponse de la bibliothèque rendue telle quelle (`auth-routes.ts:909-935`), forme du refus **non vérifiée** ; 2FA → repose sur le même crochet de création de session.
- Migrations : `packages/modules/auth/migrations/`, noms drizzle-kit ; l'ajout de `banned` est `0004_sweet_la_nuit.sql` (`ADD COLUMN … DEFAULT false NOT NULL`). Génération : `pnpm db:generate` ; un schéma sans migration fait rougir `pnpm test` (`packages/db/AGENTS.md:8-40`).

## Anchor points
- `schema.ts` : une colonne nullable (ex. `deletion_requested_at timestamptz`), plus sa migration générée.
- Un prédicat unique « la connexion est refusée » (bannissement **ou** suppression demandée) consommé par le crochet (`better-auth-service.ts:692-700`) et par l'écrivain de session (`drizzle-auth-repositories.ts:434`), et la règle de lint étendue au nouveau motif.
- `requestAccountDeletion` : marquer après une émission réussie, garder le résultat de `revokeAllForUser`, rendre les emprunts fermés et compter les sessions dans l'événement.
- Le module `admin` journalise les fins rendues (même chemin que `banAccount`), et sa table gagne la ligne.

## Verified APIs / functions
- `jobs.emit(...)` → `{ ok }` ; `sessions.revokeAllForUser(userId)` → lignes supprimées ; `endedImpersonationsOf(rows)` ; `logEndedImpersonations` (admin).
- `SecurityEventInput {event, actor, details?}` (`domain/security-event.ts:112-116`) ; `sessionsRevoked` n'est pas masqué par `describeSecurityEvent`.
- Harnais : `recordingJobs`, `jobsRegime` (`tests/account-deletion.test.ts:202-469`), `servedWithCookie` (l. 552) ; test existant de révocation à la demande l. 1300-1339.

## Traps & constraints
- **Ordre émission / marquage** : sous `JOBS_LOCAL_RUNNER=1` la purge peut s'exécuter **pendant** `emit` ; marquer après coup touchera zéro ligne, ce qui est sans effet et doit le rester (pas d'erreur).
- **Un compte inconnu et un compte en attente doivent coûter le même temps** : un compte en attente avec le bon mot de passe paie le hachage **plus** la lecture de garde ; un compte inconnu paie un hachage factice (`auth-routes.ts:865-869`). Le test de temps doit comparer ces deux-là, sur le modèle de `tests/auth.test.ts:1160-1195`.
- **Le module `admin` est optionnel** : `auth` ne peut pas l'importer. Les emprunts fermés remontent comme pour `banAccount` — valeur rendue, journalisée par qui la consomme ; module `admin` coupé, rien à journaliser (il n'existe pas d'emprunt sans `admin`).
- **Base partagée** avec le worktree de s62 : ne pas jouer deux suites e2e complètes en même temps.

## Open questions
1. Le lien magique d'un compte en attente : la bibliothèque rend-elle un refus générique ou une erreur distincte ? Non vérifié — à mesurer en premier test.
2. Faut-il aussi refuser la **réinitialisation de mot de passe** pour un compte en attente (elle ne crée pas de session, mais envoie un email) ? Hors critères ; à noter.

## Real complexity
Cotée **3**, confirmée **3** : une colonne, un prédicat, deux gardes existantes à étendre, une journalisation à rebrancher. Le coût est dans les tests (une preuve d'indiscernabilité par méthode de connexion, en message et en temps), pas dans le code.
