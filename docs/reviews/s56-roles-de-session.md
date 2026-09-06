# Review — s56-roles-de-session

> Contexte neuf. Diff jugé : `git diff dev...feature/s56-roles-de-session`, 1 commit, 20 fichiers.

## Ce que la revue a joué elle-même

| Commande | Résultat |
|---|---|
| `pnpm test` | **vert** — 2779 verts, 14 sautés, 94 fichiers |
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | verts |
| `pnpm test:sans-env` | vert — 2779 verts, 98 fichiers |
| `pnpm test:minimal-profile` | **vert**, et c'est celui qui porte la charge : le profil minimal coupe `admin` et garde `demo-enabled`, donc exactement « un module déclare `role`, celui qui l'accorde est parti » |
| `E2E_PORT=3156 pnpm test:e2e` | 115 verts, 8 sautés, **1 échec** : `e2e/passkeys.spec.ts` (délai de 30 s) |
| les trois specs concernées, isolées | 10/10 verts, dont le nouveau cas de route réservée |

**Sur les instabilités** : l'implémenteur a vu `i18n.spec.ts` et `storage.spec.ts`, la revue a vu `passkeys.spec.ts`. **Trois specs différentes sur trois passages, ce n'est pas la famille P39bis** — celle-là était une collision déterministe, toujours au même endroit. Le nouveau cas crée ses propres comptes et ne touche que `admin_platform_role`, déjà purgé avant ce diff. Lu comme de la charge à quatre travailleurs ; reste un échec ouvert qu'un humain doit surveiller.

## Mutations — 7, chacune au site où le défaut vivrait

| # | Neutralisation | Rouges |
|---|---|---|
| M1 | `satisfiesProtection` → `roles.length > 0` (**élargit**) | **1** — le cas « un **autre** rôle » |
| M2 | `.where(eq(userId))` retiré du dépôt de rôles (**lit trop large**) | **2**, contre un vrai PostgreSQL |
| M3 | `declaresRoleProtection` → `true` (branchement inconditionnel) | **1** |
| M4 | `roles:` remis à `[]` | **2** |
| M5 | branche `role → 404` retirée | **2** |
| M6 | la branche « module coupé » rend `['superadmin']` (**un module coupé accorde**) | **1** |
| M7 | `DEMO_PLATFORM_ROLE` → `'admin'` (rôle inaccordable) | **0 dans `pnpm test`**, **1 en navigateur** |

**Les trois mutations qui vont dans le sens dangereux — élargir, pas retirer — mordent toutes** (M1, M2, M6). C'est l'axe que cette story devait tenir, et elle le tient.

## Le rapport de l'implémenteur, vérifié

1. **« Le plan nommait le mauvais garde » — vrai, les deux moitiés.** Le cas de rendu authentifié de `tests/marketing.test.ts` double `currentViewer`, donc `resolveActiveSession` n'y est jamais appelé ; le cas qui compte les requêtes SQL est anonyme et construit `configureAuth` **sans** `platformRolesOf`. L'affirmation de la tâche 3 du plan était fausse. M3 prouve que le garde de remplacement mord, et il est posé **au point de composition**.
2. **404 au répartiteur** : comportement vérifié, paperasse absente — constat 1.
3. **Le littéral `superadmin` du module de démonstration** : exact. Le seul site d'insertion écrit `SUPERADMIN_ROLE` et rien d'autre.
4. **La mutation d'élargissement rougit désormais à la règle**, et non plus seulement au répartiteur.

## Conformité au plan

Les 8 tâches sont faites, et **les deux interdits sont respectés**, vérifiés à la main : les 9 déclarations de protection du back-office sont toujours `authenticated`, et la troisième raison survivante est réelle — le refus d'une **session empruntée** est décidé *avant* le jugement du rôle, ce qu'un niveau déclaré ne sait pas exprimer. Aucun vocabulaire de rôle inventé.

**Un seul consommateur de la nouvelle valeur**, confirmé par balayage : `protection.ts:44`. Peupler `roles` change le comportement d'exactement un prédicat, et d'aucune réponse.

## Constats

**1. major — la décision 403 → 404 est livrée sans ADR, et deux justifications écrites disent désormais le contraire.** `packages/core/src/registry.ts` change la sémantique de refus d'une primitive partagée pour tout un niveau de protection — la même classe de décision que l'ADR 043 a consignée pour `entitlement`. Aucun ADR dans le diff, et deux documents sont maintenant faux : l'ADR 058 (« le répartiteur répond **403**… la garde vit donc dans le module ») et `packages/modules/admin/AGENTS.md:22` (« rendrait 403, ce qui confirmerait que le back-office existe »), dans la table que ce fichier appelle lui-même « la liste » de ses invariants. **Le comportement est juste** ; ce qui manque est la trace durable — et la vraie raison survivante de garder le back-office en `authenticated`, la session empruntée, ne vit que dans un commentaire de source.

**2. minor — des phrases périmées dans des fichiers que le diff touche lui-même** : le docstring de `satisfiesProtection` dit encore que le répartiteur traduit en 401 ou 403 ; `packages/core/AGENTS.md` énumère les quatre niveaux sans mentionner la règle nouvelle et bien plus surprenante ; `packages/modules/auth/AGENTS.md` énumère les fonctions injectées sans `platformRolesOf`, qui est pourtant une clé **obligatoire** ; un commentaire de `e2e/minimal-profile/` affirme que 404 est réservé à « aucune route ne correspond ».

**3. minor — une absence assertée sans témoin d'anti-vacuité** (`e2e/admin.spec.ts:296`) : `locator.all()` n'attend pas, donc une navigation qui n'aurait pas rendu renvoie `[]` et l'assertion passe pour la mauvaise raison.

**4. minor, et c'est le plus instructif — le garde du « rôle inaccordable » n'existe que dans la suite navigateur.** Mesuré : avec `DEMO_PLATFORM_ROLE = 'admin'`, `pnpm test` est **entièrement vert — 2779 cas** — tout en livrant exactement le défaut que cette story existe pour fermer : un garde que personne ne peut satisfaire. `tests/module-registry.test.ts` dérive le rôle attendu depuis la route, donc il **suit** la divergence au lieu de l'attraper. Seul le navigateur rougit. La branche `tous` de la CI le joue, donc la porte existe ; la branche `socle` non.

**Observation** : le plan disait « un produit qui n'utilise pas le niveau ne paie rien » — vrai, mais **la configuration livrée l'utilise** (`demo-enabled` est activé par défaut), donc chaque résolution authentifiée paie une lecture indexée de plus. Coût assumé et honnête — c'est lui qui fait tenir le critère 5 — mais un lecteur pourrait lire la phrase comme « le défaut est gratuit ».

## Régressions

`e2e/modules.spec.ts` est le seul consommateur de l'ancien 401, et son attente est réellement **dérivée** du niveau déclaré, pas réécrite en constante. Aucun écran ne mène à une route protégée par un rôle. Un effet de bord systémique à connaître : 404 confond désormais « module non activé » et « rôle non porté » — aucun balayage de modularité n'en est affaibli aujourd'hui, car ils dérivent leurs listes des modules coupés.

## Non vérifié

- **Aucun écran ouvert à la main** : le critère 5 n'est mesuré que par l'attribut `href`. Geste humain : se connecter comme superadmin désigné et confirmer que l'entrée est réellement rendue, puis qu'elle disparaît pour un compte ordinaire.
- **L'échec de `passkeys.spec.ts`** en suite complète : vert en isolation, mais personne n'a établi le taux d'instabilité de référence sur `dev`.
- **`pnpm test:socle` non joué** ; il ne rejoue pas les parcours navigateur, donc il n'aurait pas couvert le constat 4.
- **Aucune mesure de temps sur le nouveau 404** : une requête anonyme sur une route à rôle répond après une tentative de résolution de session, là où une URL inventée répond avant le limiteur. Corps et en-têtes identiques ; seul un canal temporel pourrait distinguer.
- **L'interaction impersonation × niveau `role` est raisonnée, pas exercée.** Atteignable seulement pour la route de démonstration, donc exposition pratique nulle — mais c'est un raisonnement, pas une commande.

Max severity: major
Ship allowed: yes
