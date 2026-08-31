# Revue anti-hallucination — s17-roles-permissions

Branche `feature/s17-roles-permissions`, commit unique `97b3e8a`.
Diff jugé : `git diff dev...feature/s17-roles-permissions` (26 fichiers, +3047 −69).
Worktree `.claude/worktrees/agent-ab6fc2aed3b754631`, base PostgreSQL `s17`,
parcours sur `E2E_PORT=3117`.

## Ce qui a été exécuté, et non lu

| Commande | Module activé | Module coupé |
|---|---|---|
| `pnpm typecheck --force` | 16/16 | 16/16 |
| `pnpm lint --max-warnings=0` | 0 | 0 |
| `pnpm test` | 1086 passés, 2 ignorés | 1086 passés, 2 ignorés |
| `E2E_PORT=3117 pnpm test:e2e` | 58 passés, 5 ignorés | 52 passés, 11 ignorés |
| `pnpm build --force` | 0 | 0 |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert | — |
| `pnpm db:generate` | « No schema changes » — aucune migration neuve | — |
| `pnpm db:migrate` ×2 | second passage sans effet | — |
| `pnpm ks toggle organizations` ×2 | `git diff --exit-code` propre après retour | — |

Le même fichier de scénarios de permission tourne dans les deux configurations,
sans variante : le total de Vitest est identique activé et coupé (critère 7).

## Mutations — ce que chaque invariant tient réellement

Chaque mutation a été appliquée, mesurée, puis restaurée ; `git diff --exit-code`
vérifié sur le fichier avant la ligne suivante, et l'arbre entier vérifié propre
avant d'écrire ce rapport.

| # | Neutralisation | Cas rouges |
|---|---|---|
| 1 | `allows()` → `return true` | **12** |
| 2 | garde `member.invite` retirée | 2 |
| 3 | garde `invitation.resend` retirée | 1 |
| 4 | garde `invitation.revoke` retirée | 1 |
| 5 | garde `organization.rename` retirée | 1 |
| 6 | garde `member.remove` retirée | 1 |
| 7 | garde `member.set_role` retirée | 3 |
| 8 | non-membre → 403 au lieu de 404 (`renameOrganization`) | 2 |
| 9 | sous-requête de comptage retirée du prédicat de `setMemberRole` | 2 |
| 10 | `lockOrganizationMembership` retiré de la transaction de `setMemberRole` | 1 (voir plus bas) |
| 11 | `findMembership` mémorisé dans le service | 2 |
| 12 | `securityLog({event:'organizations.role_changed'})` retiré | 1 |
| 13 | `notInArray(unremovableRoles)` retiré du `delete` | 1 |
| 14 | `permissions: permissionsOf(access.role)` → `permissionsOf(null)` | **0 en Vitest**, 1 en Playwright |
| 15 | `assignableRoles: assignableRolesFor(...)` → les trois rôles en dur | **0 en Vitest, 0 en Playwright** |
| 16 | `removable` → `true` | 1 |
| 17 | `isOwnershipTransfer` → `false` | 1 |
| 18 | `SUCCEEDED_OWNER_ROLE` → `member` | 1 |
| 19 | `z.enum(ORGANIZATION_ROLES)` → `z.string()` | 1 |
| 20 | `eq(organizationId, …)` retiré de l'`update` de rôle | 1 |
| 21 | écran : `permissions['member.invite']` ignoré | 1 |
| 22 | sous-requête de comptage retirée du `delete` de s16 | 2 |
| 23 | 7ᵉ action `organization.delete` ajoutée à `ORGANIZATION_ACTION` | 2 |
| 24 | `db.select().from(...)` planté dans le module | `pnpm lint` : 2 erreurs |
| 25 | contrôle : prose passée en `label` d'un bouton de ligne | `rendered-text` rouge |

**La course, rejouée.** Verrou retiré du changement de rôle, le cas « garde un
propriétaire quand deux rétrogradations partent ensemble » a été relancé **trois
fois de dix tirages** : `0×10`, puis `1,0,0,0,0,0,0,0,0,0`, puis `0×10` — soit
**29 courses sur 30** laissant l'organisation sans propriétaire. Verrou remis :
10/10 avec exactement un propriétaire. Le taux confirme la mesure de
l'implémenteur.

**Les chemins qui pourraient contourner le verrou**, cherchés puis sondés (dix
tirages chacun, sonde jetable, arbre vérifié propre après) : retrait de soi +
rétrogradation de l'autre propriétaire ; transfert + auto-rétrogradation ;
transfert + retrait de la cible. **Un propriétaire restant à chaque course dans
les trois cas** — la clé de verrou étant l'organisation, les trois voies d'écriture
se sérialisent entre elles. La révocation d'invitation ne touche aucun rôle.

**404 indiscernable, mesuré sur la route neuve.** `POST /organizations/members/role`
par un non-membre, sur une organisation existante et sur un identifiant inventé :
même statut (404), même corps (`{"error":"not_found"}`), et médianes sur 40
échantillons chacune dans un écart inférieur à 50 %. L'ordre `accessFrom` puis
`allows` est tenu : la mutation 8 le prouve dans les deux sens.

**Le pouvoir suit la ligne, pas le jeton** (ADR 026 réattaqué dans le sens
montant). Mémoriser `findMembership` fait rougir « change le pouvoir à l'instant »
et le transfert. En navigateur réel, le même contexte, le même cookie, sans
reconnexion : le membre promu voit la carte d'invitation après un simple
rechargement, la reperd après rétrogradation, et son appel direct sur
`/api/modules/organizations/invite` reçoit 403. Aucune directive de cache sur
`apps/web/app/organizations/page.tsx`, `ModuleSession.roles` reste `[]` en
production. **L'argument de l'ADR 026 tient encore ici.**

**La suppression d'organisation.** Ajouter `organization.delete` à
`ORGANIZATION_ACTION` fait rougir deux cas de matrice, comme l'ADR l'annonce.

**Vérification visuelle refaite.** Sonde Playwright jetable (créée, exécutée,
supprimée ; arbre vérifié propre). `/organizations` à 1280 px et 390 px, thèmes
clair et sombre : débordement horizontal **0 px** partout. Écran d'un `member` à
390 px : ni carte « Invitations », ni carte « Paramètres », ni bouton de rôle, ni
« Retirer » sur la ligne du propriétaire — seul « Quitter l'organisation ». La
première capture sombre montrait le bouton de transfert en plein clair : c'était
un **survol** de la souris restée sur place, corrigé en déplaçant le pointeur puis
en relevant les styles calculés — `outline` rend bien `bg lab(2.75381 0 0)` avec
bordure claire, distinct du primaire `lab(98.26 0 0)`. Le tableau de mesures de
`docs/designs/s17-roles-permissions.md` est confirmé.

## Constats

### F1 — majeur — La dérivation des affordances par le serveur n'est tenue par aucun cas

Remplacer `assignableRoles: assignableRolesFor(access, identity)` par les trois
rôles en dur dans `viewOrganizations`
(`packages/modules/organizations/src/application/organization-use-cases.ts`)
laisse **tout vert** : 1086 cas Vitest et 58 parcours Playwright. En production,
un simple `member` se verrait alors offrir « Administrateur », « Membre » et
« Transférer la propriété » sur **chaque** ligne, y compris la sienne et celle du
propriétaire, chacun refusé par un 403 nu. C'est exactement ce que le critère 2
interdit (« son déclencheur est masqué dans l'interface ») et ce que le module
s'interdit à lui-même (« promettre puis refuser est un écran cassé »,
`domain/permissions.ts`).

Le cas de rendu qui porte ce nom — « n'offre un bouton de rôle que sur les lignes
qui en reçoivent un » — reçoit `assignableRoles` **en paramètre** : il éprouve le
`.tsx`, jamais le calcul. Son jumeau `permissions` est dans le même état :
`permissionsOf(access.role)` → `permissionsOf(null)` est vert en Vitest, et n'est
attrapé que par un seul parcours Playwright. La mutation annoncée par la tâche 8
du plan (« rendre `permissions` toujours vrai → les cas de rendu rougissent »)
n'est donc vraie que si on la lit côté écran ; côté serveur, elle est verte.

Le code de production est correct ; c'est le filet qui est plus étroit que son
nom. Il manque un cas de câblage qui lit `viewOrganizations` pour les trois rôles
et confronte `permissions` et `assignableRoles` aux fonctions du `domain`.

### F2 — majeur — Quatre mesures fausses écrites par ce commit

ADR 013 nomme cette famille comme celle qui a déjà piégé ce dépôt trois fois :
une phrase mesurée que l'agent suivant lit comme vérifiée et cesse de vérifier.
Quatre, ici, toutes introduites par cette story :

1. `packages/modules/organizations/AGENTS.md` l. 18 annonce **« Dix-huit »**
   invariants ; le tableau qui suit en porte **20** (l. 22 à 41).
2. `docs/decisions/030-…` §1 : « **Cinq occurrences** de `roles` au total,
   **toutes citées** » puis cinq fichiers. Mesuré : **11 occurrences sur 6
   fichiers** — `packages/modules/auth/src/domain/auth-rules.test.ts` (l. 140,
   144) manque. La conclusion tirée reste vraie ; la liste qui la soutient
   affirme une exhaustivité qu'elle n'a pas.
3. ADR 030, « Decision » : l'événement est journalisé « avec son acteur, son
   organisation, sa cible et **les deux rôles** » ; la tâche 7 du plan écrit
   « rôle avant, rôle après ». `OrganizationSecurityEvent`
   (`src/domain/security-event.ts`) ne porte **qu'un** `role`, celui demandé. Le
   rôle précédent n'est nulle part. `docs/security.md` §7 n'exige que l'acteur —
   la conformité au socle tient ; c'est l'ADR et le plan qui décrivent un code
   qui n'existe pas.
4. `src/domain/security-event.ts` et le tableau d'AGENTS.md parlent d'une forme
   fermée à **« cinq champs nommés »** ; l'interface en porte **six**
   (`event`, `actor`, `organizationId`, `target`, `role`, `transfersOwnership`).

Aucune n'introduit de défaut de comportement. Toutes rendent la prochaine story
plus fausse qu'elle ne le croit.

### F3 — mineur — `allows()` lève au lieu de refuser sur un rôle hors matrice

`allows(role, action)` fait `MATRIX[role].includes(action)`. `organization_member.role`
est un `text NOT NULL` **sans contrainte de valeur** (`src/schema.ts:66`,
migrations 0000 et 0001). Mesuré, avec une ligne portant `role = 'superadmin'` :
`POST /organizations/update` lève `TypeError: Cannot read properties of undefined
(reading 'includes')` au lieu de refuser. C'est un échec en 500, pas une
autorisation accordée — mais cette fonction est celle que s18, s19, s24, s33 et
s35 appelleront avec un rôle **relu en base**, sans revérifier. Un
`MATRIX[role] ?? []` la rendrait fail-closed, et un cas le tiendrait.

### F4 — mineur — La règle « aucune comparaison de rôle hors de `domain/permissions.ts` » est fausse dès son commit

La tâche 8 du plan exige « **aucune comparaison de rôle dans le `.tsx`** », et
l'AGENTS.md écrit par cette story inscrit « Ne doit jamais contenir : de
comparaison de rôle hors de `domain/permissions.ts` … un `role === 'owner'` dans
un cas d'usage, un repository ou un `.tsx` ». Trois contre-exemples dans le même
diff :

- `src/presentation/organizations-screen.tsx:240` — `variant={role === 'owner' ? 'outline' : 'ghost'}` ;
- `src/domain/message-keys.ts:163` et `:166` — `role === 'owner' ? … : …`.

Aucune de ces comparaisons ne décide d'une permission (variante de bouton, clé de
libellé), et aucune commande ne fait échouer la règle : c'est de la documentation,
pas une règle (ADR 013). Soit la règle se restreint à ce qu'elle protège
réellement — la **matrice** —, soit l'ordre d'affichage et la variante rejoignent
`ASSIGNABLE_ORDER` dans le `domain`, où le premier vit déjà.

### F5 — mineur — La validation avant la permission rend à un appelant sans droit l'écran d'erreur que l'ADR refuse

Mesuré sur un `member` de l'organisation :

- corps `{organizationId, userId, role:'pas-un-role'}` → **303** vers
  `/organizations?error=invalid_role`, **aucun** événement de sécurité ;
- corps `{organizationId, userId, role:'admin'}` → **403**, un événement
  `organizations.role_change_refused` ;
- corps `{organizationId, role:'admin'}` (sans `userId`) → **303**
  `?error=invalid_role`, message « Ce rôle n'existe pas » — qui ne décrit pas le
  défaut.

Rien de l'organisation ni de ses membres ne fuit : l'appelant est déjà membre et
le vocabulaire des rôles est sur son écran. Deux conséquences tout de même. La
première : l'ADR 030 rejette explicitement « 303 vers l'écran avec un motif
traduit » parce qu'« un motif traduit dans l'URL décrirait la politique à qui la
sonde » — l'ordre inversé le réintroduit sur cette route précise, pour un appelant
qui n'a aucun droit. La seconde : une sonde d'élévation qui envoie toujours un
rôle malformé n'entre **jamais** dans le journal du §7. Le gain revendiqué —
nommer la cible dans l'événement de refus — s'obtiendrait aussi en gardant
l'ordre et en journalisant la cible telle qu'elle est arrivée.

### F6 — mineur — Deux résidus dans les filets

- `tests/rendered-text.test.ts` garde `'field'` dans `technicalProps` de l'écran
  des organisations ; `RowAction` n'a plus cette prop depuis ce commit
  (`fields`). Entrée morte dans l'allowlist d'un garde-fou. Les trois entrées
  neuves (`setMemberRole`, `setRoleAction`, `fields`), elles, sont portantes :
  les retirer fait rougir. Vérifié aussi qu'elles n'ouvrent pas de trou — de la
  prose glissée dans un `label` rougit toujours.
- `InvitationsCard` est masquée sur la seule permission `member.invite`, alors
  que la carte porte aussi `invitation.resend` et `invitation.revoke`. Aucun rôle
  actuel ne dissocie les trois ; un rôle futur qui révoquerait sans inviter
  perdrait la liste sans que rien ne le dise.

## Arbitrages qui appartiennent au propriétaire du produit

1. **`member.set_role` réservé au seul `owner`.** Le plan ne tranchait pas ;
   l'ADR 030 documente le choix, ses raisons et la ligne unique à changer. Le
   critère 3 énumère ce qu'un `admin` peut faire sans y mettre le rôle : lecture
   défendable, plus stricte que MakerKit. À valider.
2. **Un `admin` peut retirer un autre `admin`.** Le critère 3 dit « retirer des
   *members* ». L'implémentation va au-delà de la lettre et le cas de domaine
   l'assume explicitement. Non discuté dans l'ADR.
3. **Un `member` peut quitter l'organisation** alors que le critère 2 dit qu'il
   ne peut pas « retirer un membre ». Justifié comme un geste sur sa propre
   appartenance ; sans cela un membre serait captif.
4. **Une organisation sans propriétaire est désormais ingouvernable à vie** —
   `member.set_role` exige un propriétaire, et il n'existe aucune commande de
   réconciliation. L'état est **inatteignable par l'API** (trois voies de
   concurrence sondées, dix tirages chacune), mais `organization_member.user_id`
   cascade sur la suppression de `auth_user` : s34 pourra le produire.
   `docs/reliability.md` §5 demande une commande de réconciliation pour tout état
   divergent — à porter par s34, pas ici, mais à ne pas perdre.

## Non vérifié — dit plutôt que sous-entendu

Ce n'est pas la liste de ce qui existe ; ce sont les gestes que je n'ai pas faits,
sur les points que cette story engage.

- **La CI GitHub Actions** n'a pas tourné : tout ci-dessus est mesuré sur un
  poste, un seul processus Node, une seule base.
- **Plusieurs instances applicatives** : le verrou est porté par PostgreSQL donc
  partagé par construction, mais je n'ai mesuré qu'un processus. Geste humain :
  rejouer la course avec deux serveurs sur la même base.
- **Un niveau d'isolation autre que `read committed`** — jamais essayé.
- **La collision de clé de verrou** (`hashtext` sur 32 bits) : conséquence
  annoncée « attente inutile », non mesurée.
- **Un seul moteur de rendu (Chromium)**, aucun lecteur d'écran réel, aucun
  contraste calculé. Le parcours **au clavier seul** sur les trois boutons d'une
  même ligne n'a pas été rejoué : geste humain attendu, avec trois membres à
  l'écran, vérifier que les boutons s'annoncent distinctement.
- **Le module `organizations` avec `i18n` coupé** — configuration jamais essayée,
  déjà signalée non vérifiée par s15 et s16.
- **Le journal de sécurité en production** : seul le double injecté par la suite
  a été lu ; `consoleSecurityLog` n'a jamais été observé sur un vrai flux de
  sortie, ni confronté à un collecteur.
- **La purge et l'export** n'ont pas été rejoués contre le nouveau champ de rôle :
  ils ne changent pas dans ce diff, mais l'export d'organisation rend les rôles.
- **`describe.runIf(databaseReachable)`** : sans base, toute la moitié « câblage »
  de ce rapport s'évapore en silence. Rien dans ce diff ne le change, et rien ne
  le signale non plus.

## Verdict

Le cœur de la story tient et il tient par des commandes : les six portes rougissent
une à une, le partage 403/404 est mesuré jusqu'au corps et au temps, l'invariant du
dernier propriétaire résiste à trois croisements de concurrence, et l'argument de
l'ADR 026 a été réattaqué dans le sens montant puis vérifié par mutation et en
navigateur. Aucun constat critique : rien n'accorde un droit qui ne devrait pas
l'être.

Restent deux constats majeurs qui ne bloquent pas l'expédition mais qu'il faut
reprendre au cycle suivant : un invariant d'écran que le serveur calcule et que
personne n'éprouve (F1), et quatre mesures fausses écrites dans les documents que
la story suivante lira comme vérifiées (F2).

## Clôture — le tour de correction, constat par constat

Commit `b077f36`, sur la même branche, après `97b3e8a`. Tout ci-dessous est
mesuré sur ce poste, une base `s17`, un processus Node ; chaque mutation a été
appliquée, comptée, puis restaurée, et `git diff` vérifié propre avant la ligne
suivante.

| Commande | Module activé | Module coupé |
|---|---|---|
| `pnpm typecheck` | 16/16 | 16/16 |
| `pnpm lint --max-warnings=0` | 0 | 0 |
| `pnpm test` | 1097 passés, 2 ignorés | 1097 passés, 2 ignorés |
| `E2E_PORT=3117 pnpm test:e2e` | 58 passés, 5 ignorés | 52 passés, 11 ignorés |
| `pnpm build` | 0 | 0 |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert | 1 avis, idem |
| `pnpm ks toggle organizations` ×2 | arbre propre au retour | — |
| `pnpm db:migrate` ×2, `pnpm db:generate` | second passage sans effet, aucune migration neuve | — |

Onze cas de plus qu'à la revue (1086 → 1097), aucun fichier de test neuf.

| Neutralisation | Cas rouges |
|---|---|
| `assignableRoles: assignableRolesFor(...)` → les trois rôles en dur | **1** (était 0) |
| `permissions: permissionsOf(access.role)` → `permissionsOf(null)` | **1** en Vitest (était 0) |
| `unremovableRolesFor` : `['owner', 'admin']` → `['owner']` | 2 |
| `allows` : `(MATRIX[role] ?? [])` → `MATRIX[role]` | 2 |
| validation replacée **avant** la permission dans `setMemberRole` | 1 |
| `securityLog` retiré du refus de permission | 2 |
| `grantsOwnership(role)` → `role === 'owner'` dans l'écran | `pnpm lint` : 1 erreur `no-restricted-syntax` |
| règle de comparaison de rôle absente (état d'avant) | `tests/lint-rules.test.ts` : 4 cas |

**F1 — fermé.** `tests/organizations.test.ts`, « dérive les droits et les rôles
offerts du rôle de l'appelant, pour chacun des trois » : la vue **servie** par
`viewOrganizations` est confrontée à `permissionsOf` et `assignableRolesFor` pour
les trois rôles, plus trois ancres concrètes (un `member` ne se voit offrir aucun
rôle nulle part et ne peut rien ; un `owner` s'en voit offrir sur les lignes des
autres, aucun sur la sienne). Les deux mutations qui étaient vertes rougissent
chacune d'un cas. Le cas de rendu, lui, reste ce qu'il est : une épreuve du
`.tsx`.

**F2 — les quatre mesures, plus une cinquième.** Le compte d'invariants disparaît
de l'`AGENTS.md` : le tableau est la liste, un décompte se lit. Le balayage de
`roles` de l'ADR 030 est remesuré avec sa commande et sa date — `rg -n '\broles\b'
-g '*.ts' -g '*.tsx' packages apps config tests`, **21 occurrences sur 11
fichiers**, dont une seule produit la valeur en exécution ; `auth-rules.test.ts`
y est nommé. « Les deux rôles » devient le rôle demandé, dans l'ADR et dans la
tâche 7 du plan. « Cinq champs nommés » devient l'interface elle-même, aux **deux**
emplacements qui le portaient (`domain/security-event.ts` et
`infrastructure/console-security-log.ts`). Cinquième, non relevée par ce rapport
et trouvée en corrigeant : `domain/permissions.ts` annonçait « les huit routes »
pour neuf.

**Arbitrage 1 — validé**, et la validation est consignée dans l'ADR.

**Arbitrage 2 — restreint.** `unremovableRolesFor` rend `['owner', 'admin']` pour
un `admin` ; la borne reste dans le prédicat du `delete`, jamais dans une lecture
préalable. Le cas de câblage vise une organisation à deux propriétaires **et** un
second administrateur : sans la borne, les deux retraits passeraient. Le tableau
d'affordances de `docs/designs/s17-roles-permissions.md` a changé d'une case.

**Arbitrages 3 et 4 — écrits là où on les cherchera.** « Quitter n'est pas
retirer » et « une organisation sans propriétaire est ingouvernable » ont chacun
leur paragraphe dans l'`AGENTS.md` du module et dans l'ADR 030, avec le mécanisme
exact : `organization_member.user_id` référence `auth_user.id` en
`onDelete: 'cascade'` (`src/schema.ts:62-64`), donc supprimer le compte du dernier
propriétaire efface son appartenance sans que rien ne compte les propriétaires
restants ; l'organisation survit, et plus personne ne peut nommer un rôle,
renommer, inviter, révoquer ni retirer. La commande de réconciliation qu'exige
`docs/reliability.md` §5 appartient à **s34**, nommée ici pour être trouvée avant
sa purge.

**F3 — fermé.** `allows` replie sur `MATRIX[role] ?? []`. Éprouvé à la règle et
jusqu'à la route : une ligne portant `role = 'superadmin'` reçoit 403, plus un
`TypeError`.

**F4 — la phrase est devenue une commande.** `eslint.config.ts` refuse la
comparaison d'un rôle à un littéral partout dans le module sauf dans
`domain/permissions.ts` ; sept cas dans `tests/lint-rules.test.ts` (quatre
emplacements refusés, le fichier qui décide permis, un autre module non jugé, la
reprise des interdits qu'un bloc plat aurait écrasés). La règle a fait apparaître
**deux occurrences que ce rapport n'avait pas nommées** — `domain/invitation.ts`
l. 276 et 280, la règle du dernier propriétaire —, ce qui porte à cinq les
comparaisons trouvées, sur les cinq que la règle voit. Ce qu'elle ne voit pas est
écrit : `switch`, `includes`, comparaison à une variable, rôle ajouté sans
sélecteur. La notion partagée est une fonction nommée du `domain`,
`grantsOwnership`.

**F5 — l'ordre est le même aux six portes.** Autorisation, permission,
validation. Un `member` qui envoie un rôle malformé reçoit **403** et non plus un
303 traduit, et son geste entre au journal ; la cible et le rôle y sont extraits
du corps **par Zod**, `null` quand ils ne valident pas. La forme de l'événement
reste fermée. L'ADR 030 et l'`AGENTS.md` décrivent désormais le code qui existe.

**F6 — première puce fermée**, `'field'` retiré ; la suite de rendu reste verte,
et les trois entrées neuves restent portantes. **Seconde puce non traitée** :
`InvitationsCard` est toujours masquée sur la seule permission `member.invite`.
Aucun rôle actuel ne dissocie les trois, et le tour de correction ne l'a pas
demandé — à reprendre le jour où un rôle révoquerait sans inviter.

**Ce que ce tour n'a pas fait**, dit plutôt que sous-entendu : la CI n'a pas
tourné, la course n'a pas été rejouée (aucun code de concurrence n'a bougé), rien
n'a été mesuré à deux processus ni sous un autre niveau d'isolation, aucune
vérification navigateur neuve n'a été faite — le seul changement visible à
l'écran est la disparition d'un bouton « Retirer » sur la ligne d'un `admin` vue
par un `admin`, couverte par le cas de câblage et par le tableau du design.

Max severity: major
Ship allowed: yes
