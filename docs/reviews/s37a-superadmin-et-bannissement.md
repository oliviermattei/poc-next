# Revue — s37a-superadmin-et-bannissement

Diff jugé : `git diff dev...feature/s37a-superadmin-et-bannissement` (commit `5a930b9`, 50 fichiers, +3752/−4).

## Ronde 1

### Suites exécutées par le relecteur

| Commande | Résultat |
|---|---|
| `pnpm test` | **2233 passés, 8 sautés**, 73 fichiers |
| `pnpm lint` | aucun problème |
| `pnpm typecheck` | 28/28 |
| `pnpm build` | succès |
| `pnpm test:minimal-profile` | **exit 0** — **joué par le relecteur, que l'implémenteur n'avait pas joué**. 7 modules coupés dont `admin`, 19 routes et 6 entrées balayées, 2230 exécutés, 5 parcours verts, arbre intact |

Les 27 cas d'`admin` tournent sur un PostgreSQL réel, aucun sauté (vérifié en rapport détaillé), et le port de comptes est câblé aux **vrais** cas d'usage d'`auth`, pas à une doublure.

### Ce qui tient, vérifié à la source

**Le point d'accroche du refus est le bon.** `databaseHooks.session.create.before` est réel dans `better-auth@1.7.2`, et `internal-adapter.mjs:309` est le **seul** appel `createWithHooks(data, "session", …)` : tout chemin de connexion le traverse.

**Le raisonnement 404 contre 403 est juste contre le code réel.** `registry.ts:349` répond 403 à une protection `role` non satisfaite — ce qui confirmerait l'existence du back-office. D'où des routes `authenticated` et un garde de superadmin dans le module, qui répond 404 avec un corps **identique octet pour octet** à celui d'une route non montée.

**Le garde-fou du dernier superadmin est réellement sans course.** Le `delete` est une instruction unique dont le `WHERE` porte le prédicat de comptage, dans une transaction, sous `pg_advisory_xact_lock` pris **avant**. Une révocation concurrente bloque, ré-évalue après validation, voit 1, refuse. C'est bien un prédicat dans l'écriture, pas une lecture qui décide suivie d'une écriture qui obéit.

**L'oracle d'énumération est fermé, et le décalage de temps n'est pas exploitable.** Le refus d'un compte banni est comparé à celui d'un compte inconnu sur le statut **et le corps JSON complet**. Lecture de `sign-in.mjs` : compte inconnu et absence d'identifiant hachent tous deux le mot de passe puis échouent, mot de passe faux échoue à la vérification — **aucun des trois n'atteint la création de session**, donc aucun ne paie la lecture `isBanned`. Le décalage distingue « banni avec identifiants valides » de « mot de passe faux » ; il ne distingue pas « le compte existe » de « il n'existe pas », qui est ce que la base de sécurité exige.

**Contrat complet : quinze clés**, `publicUrls: () => []` comprise, malgré le contournement de `ks scaffold`. Renumérotage de l'ADR en 058 **complet** : 12 références, zéro reste en 057.

### Table de mutation

| # | Site | Rouge |
|---|---|---|
| 1 | `notFound()` → 403 | **8** |
| 2 | retrait du prédicat de comptage dans le `delete` | **2** |
| 3 | neutralisation du refus à la connexion | **2** |
| 4 | `banAccount` cesse de révoquer, en continuant d'annoncer `revokedSessions: 1` | **1** — sur une requête `/change-name` **réellement servie** avec le cookie vivant, qui rend 200 au lieu de 401. Le compte complaisant n'a pas sauvé la mutation |
| 5 | `revocationRefusal` → `null` | **2, et ce sont ses propres tests unitaires** ← F1 |
| 6 | le hook nomme le bannissement (`FORBIDDEN`, message explicite) | **0** ← F4 |

### Constats

**F1 — majeur — la règle du dernier superadmin dans `domain/` est du code mort, et deux documents citent son test comme un garde.** `revocationRefusal()` n'est appelée que par son propre test ; la vraie règle est réimplémentée en SQL dans le dépôt Drizzle, avec **deux vocabulaires pour une règle** (`'last-superadmin'` contre `'last_superadmin'`). Elle n'est même pas exportée. La mutation 5 le prouve : la neutraliser ne rougit que `admin-rules.test.ts`. Ce qui en fait un constat et non une broutille, ce sont les deux affirmations bâties dessus — la table d'invariants du `AGENTS.md` du module cite ce fichier « à la règle », et `platform-role.ts:78` écrit « la règle est ici, pure ». La règle n'y est pas ; seulement une copie.

**F2 — majeur — un superadmin peut bannir un superadmin, y compris le dernier, et rien ne répare le résultat.** `banAccount` ne vérifie aucun rôle de plateforme. Le superadmin unique qui se bannit obtient : sessions révoquées, connexion refusée par le socle, **et sa ligne toujours dans `admin_platform_role`** — donc `countSuperadmins()` renvoie 1 et la désignation ne se redéclenche jamais. **Plateforme définitivement inadministrable, aucune commande ne la répare.** C'est mot pour mot le dommage que le plan invoque pour justifier la tâche 5, atteignable en un clic sur la route voisine de la même story.

Deux points que la déclaration manque. D'abord le `AGENTS.md` du module annonce « **deux** gardes n'existent pas encore » et en énumère deux — or il existe une **troisième** route vers le même état : `purgeAccount` supprime la ligne `auth_user`, et `admin_platform_role.user_id` est en `cascade`. Pas encore vivante, mais la story RGPD la rendra vivante. Ensuite, cette troisième route **se répare toute seule** (le compte retombe à 0, la désignation se redéclenche) là où le bannissement, lui, brique — ce qui mérite d'être écrit.

**F3 — mineur — un appelant anonyme lit l'existence de `/api/modules/admin/*`.** Comportement de toute route `authenticated` du dépôt ; ce que la story ferme, c'est la distinction entre un compte qui administre et un compte qui n'administre pas. Correctement borné, consigné pour `s37b`.

**F4 — mineur — « le bannissement ne se nomme jamais » n'est éprouvé que sur le chemin du mot de passe.** La mutation 6 laisse la suite verte parce que `genericSignInRefusal` réécrit 401 **et** 403 sur `/sign-in/email`. Défense en profondeur correcte, mais la formulation générique sur les chemins **sans** réécriture repose entièrement sur un littéral non testé. Vérifié chemin par chemin : `passkey/verify-authentication` est sûr ; **`magic-link/verify` renvoie la réponse brute**, donc un compte banni cliquant un lien magique verrait le rendu de la bibliothèque. Aujourd'hui le message est « identifiants invalides », donc rien ne fuit — mais rien n'empêche la prochaine édition de ce littéral, et aucun test ne le verrait.

**F5 — mineur — `docs/architecture.md:15` contredit un ADR accepté dans le même commit.** La ligne annonce Better Auth avec les greffons `organization`, `admin`, `two-factor`, `passkey`. L'ADR 058 rejette explicitement le greffon `admin`, mesure à l'appui ; l'ADR 025 avait rejeté `organization`. La ligne était déjà périmée ; cette story en fait une contradiction directe.

**F6 — mineur, préexistant — `packages/cli/src/scaffold-files.ts` annonce treize clés de contrat**, aux lignes 6, 78 et 134. Il en génère quinze correctement. Hors de ce diff, correctement signalé, mais le prochain module échafaudé livrera un `AGENTS.md` portant un compte faux.

**F7 — mineur, latent — la lecture fermée-par-défaut du bannissement tourne hors de la transaction de better-auth.** `isBanned` lit par une connexion distincte du pool alors que l'adaptateur est configuré `transaction: true`. Tout passe aujourd'hui (105 cas d'`auth` verts, parcours navigateur compris), donc la bibliothèque n'enveloppe pas création d'utilisateur et création de session dans une transaction unique. Si une version future le faisait, la lecture manquerait la ligne non validée, `isBanned` renverrait son `true` fermé-par-défaut, et **toute inscription échouerait**. La suite l'attraperait à la montée de version — d'où mineur, mais nommé pour qui montera `better-auth`.

### Non vérifié

Aucun écran dans cette tranche (`adminNavigation = []`). **Le temps n'a pas été mesuré** — le raisonnement suit le flot de contrôle de la bibliothèque. **Le comportement d'un compte banni sur lien magique et sur retour OAuth n'a jamais été exercé** : c'est là que F4 deviendrait visible. La révocation concurrente a été raisonnée, jamais exécutée. `test:e2e`, `test:golden-path` et `test:socle` non joués. L'image de production n'a jamais été construite ni démarrée.


## Ronde 2 — après correction de F1, F2 et F5

Diff jugé à `dd9eacd` (51 fichiers, +4124/−5).

| Commande | Résultat |
|---|---|
| `pnpm test` | **2238 passés, 8 sautés**, 73 fichiers |
| `pnpm lint` · `pnpm typecheck` | exit 0 · 28/28 |
| `pnpm test:minimal-profile` | **3 exécutions, 3 × exit 0** — 7 modules coupés dont `admin`, 13 tables absentes, 12 présentes, arbre intact |

### Les quatre mutations, re-posées à leur site

| # | Site | Rouge |
|---|---|---|
| M1 | `banRefusal` → `null` | **4** (2 unitaires + 2 d'intégration) |
| M2 | `revocationRefusal` cesse de nommer `not_superadmin` | **2**, dont **1 d'intégration** — la règle n'est plus du code mort |
| M3 | prédicat de comptage retiré du `delete` | **2**, les deux d'intégration |
| M4 | verrou retiré de `banUnlessLastSuperadmin` | **1** — le cas de sérialisation |

**F1 est fermé.** Un seul vocabulaire : `RevokeOutcome.error` **est** le type du `domain`, tenu par le compilateur du refus en base jusqu'au corps 409. La règle est nommée **après** l'écriture refusée — et la mesure de l'implémenteur est reproduite : placée *avant*, retirer le prédicat du `delete` ne rougissait **aucun** test, le filet atomique partait non éprouvé.

**La forme du garde de F2 tient.** `banUnlessLastSuperadmin` prend `pg_advisory_xact_lock(hashtext('superadmin'))` en premier, lit sur l'exécuteur de la transaction, appelle `ban()` **verrou tenu**. Même clé que la révocation, donc les deux gestes sérialisent. M4 le prouve par la mesure.

**F5 est fermé.** `docs/architecture.md:15` est exact, vérifié ligne à ligne : `magicLink`, `withTwoFactorOnEverySignIn(twoFactor(…))`, `passkey`, et `genericOAuth` **uniquement** sous le fournisseur de développement. La correction de la couche API faite sur `dev` a survécu au rebase intacte.

### Constats de ronde 2

**F8 — majeur — le décompte porte sur des lignes de rôle, pas sur des superadmins capables de se connecter.** Mesuré par le relecteur, sonde jouée contre PostgreSQL puis retirée : deux superadmins A et B, `banAccount(B)` → **200**, puis `banAccount(A)` → **200**. État final : 2 lignes de rôle, `auth_user.banned = [true, true]`. **Plus personne ne peut se connecter, le décompte rend 2, la désignation ne se redéclenche jamais.** Aucune révocation en jeu — c'est un chemin distinct de celui que le tableau documente, et c'est le garde ajouté à cette ronde qui laisse passer le second geste. Troisième surface du même aveuglement : `grantSuperadmin` ne vérifie pas non plus l'état banni.

**Décision : report assumé vers `s37b`, avec sa portée corrigée.** La cause est unique — `readFacts` compte `admin_platform_role` et l'état `banned` vit dans le socle, hors de portée d'`AdminAccountsPort` (ADR 058). Le correctif est l'élargissement du port, une décision de forme. Le critère d'acceptation de `s37b` a été **réécrit sur `dev`** (`ad4c9b6`) pour porter sur *tout* décompte — révocation, garde-fou de bannissement et promotion — parce que sa première rédaction, qui n'imputait l'aveuglement qu'à la révocation, aurait laissé ce chemin ouvert. Majeur et non critique : l'acteur est un superadmin authentifié, il faut deux gestes délibérés, ni élévation de privilège ni corruption de données.

**F9 — mineur — quatre des sept événements de sécurité ne sont assertés nulle part** : `admin.account_banned`, `admin.account_ban_refused`, `admin.account_unbanned`, `admin.access_refused`. Seul le trio des changements de rôle est épinglé.

**F10 — mineur — le cas de sérialisation échoue *ouvert*.** L'attente de 300 ms peut devenir verte sans verrou sur une machine chargée. La direction de la fragilité est la bonne (vérifié : verrou tenu, la révocation ne *peut pas* aboutir, et la limitation de débit est neutralisée par injection), mais le cas peut cesser de protéger en silence.

**F11 — mineur — la branche « module coupé » du témoin de démarrage n'assertionne qu'une absence** : `expect(said).not.toContain('SUPERADMIN_EMAIL')` passe quoi qu'il arrive, y compris si rien n'avait averti. Aucun signal positif n'atteste que la garde a tourné.

**F12 — mineur, corrigé sur `dev`** : la ligne des quatre couches d'`AGENTS.md` annonçait encore « routes Hono, contrats oRPC ». Corrigée en `ad4c9b6`.

### L'intermittent, caractérisé plutôt que relancé

**Non reproduit** — 3 exécutions, 3 verts. Le mécanisme se lit dans le dépôt : `vitest.config.ts` ne pose **aucun `testTimeout`**, donc 5 000 ms par défaut — exactement la valeur des deux expirations observées ; trois fichiers de `tests/` chargent le même graphe lourd (`apps/web/next.config` → `next`, `@next/mdx`, `next-intl/plugin`, et surtout `apps/web/lib/startup.ts` qui tire tous les points de composition), chacun précédé d'un `vi.resetModules()` qui force la re-transformation complète ; et `test:minimal-profile` travaille dans un **clone neuf**, donc cache de transformation froid, à côté de la compilation Next et des parcours navigateur de la même recette.

Famille : *tout test qui atteint `apps/web/lib/startup.ts` par `next.config`*. Cette story l'aggrave à la marge — elle ajoute le troisième appelant et étend le graphe. La porte serait un délai explicite sur ces trois imports, **jamais une reprise**, qui le cacherait. Consigné pour `s52-derniers-intermittents`.

### Non vérifié en ronde 2

`pnpm build`, `test:e2e`, `test:golden-path`, `test:socle` non joués. Aucun écran dans cette tranche. **Le temps n'a jamais été mesuré.** Le comportement d'un compte banni sur **lien magique** et sur **retour OAuth** n'a jamais été exercé. La concurrence n'est éprouvée que sur un seul entrelacement — bannissement contre bannissement, et promotion contre bannissement (`grantSuperadmin` ne prend **pas** le verrou) ne sont couverts par aucun cas.

Max severity: major
Ship allowed: yes
