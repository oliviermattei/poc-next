---
story: s17-roles-permissions
validated: yes
---

# Plan — s17-roles-permissions

Recherche : `docs/research/s17-roles-permissions.md`.
Design : `docs/designs/s17-roles-permissions.md` (+ `.html`).

**Sections des socles engagées** — `docs/security.md` **§2** (élévation de
privilège et rotation d'identifiant de session : l'argument de l'ADR 026
réattaqué dans le sens montant, recherche §6, et tranché dans un ADR à part),
**§3** (vérification serveur systématique ; masquer un déclencheur n'est pas une
permission ; **404 pour l'organisation d'autrui, 403 pour un rôle insuffisant** —
recherche §4 ; propriétaire de la donnée résolu par une fonction unique dans les
deux configurations ; chaque combinaison rôle × action sensible couverte par un
test d'API), **§4** (Zod à chaque frontière, y compris le rôle demandé ;
redirection à destination constante), **§7** (le changement de rôle est un
événement de sécurité journalisé avec son acteur).
`docs/reliability.md` **§1** (le changement de rôle est rejouable sans effet
supplémentaire ; l'invariant du dernier propriétaire tient sous concurrence, par
le **même** verrou consultatif que le retrait — recherche §5), **§4** (aucune
migration : s17 n'ajoute ni table ni colonne).

**Aucun nouveau fichier de test.** Les règles pures entrent dans
`packages/modules/organizations/src/domain/organization-rules.test.ts`, le
câblage dans `tests/organizations.test.ts`, le rendu dans
`tests/rendered-text.test.ts`, le parcours dans `e2e/organizations.spec.ts`.
Ouvrir un second fichier pour la même unité coûte un environnement complet et ne
prouve rien de plus.

**Aucune migration**, et c'est vérifié : `organization_member.role` existe déjà
en `text not null` (`src/schema.ts:66`), les trois rôles sont déjà nommés
(`domain/organization.ts:26`). `pnpm db:generate` ne doit produire aucun fichier.
`generated/` ne bouge pas, et cette fois c'est vrai — la régénération du baril
n'a lieu que si une table est ajoutée (correction du constat F8 de s16).

**Ce que ce plan ne fait pas**, et ce n'est pas un oubli : aucun choix de rôle à
l'invitation (`INVITED_ROLE` reste `member`, fixe — le rôle se change après
l'entrée, par la route de s17) ; aucune suppression d'organisation (elle n'est
dans aucun critère de s17, et le critère 3 la nomme seulement comme ce qu'un
`admin` ne peut pas faire — elle n'existe pour personne aujourd'hui) ; aucun rôle
plateforme (`RouteProtection.level: 'role'` reste réservé à s37, recherche §3) ;
aucune modification du module `auth`, de `config/features.ts`, de `generated/`,
de `apps/web/middleware`, de `config/security.ts`, de `playwright.config.ts` ni
de `docs/STATE.md`.

---

## Tâches

- [x] **1. La matrice, écrite une fois et pure** — `src/domain/permissions.ts` :
  `ORGANIZATION_ACTIONS` (`organization.rename`, `member.invite`,
  `invitation.resend`, `invitation.revoke`, `member.remove`, `member.set_role`),
  `allows(role, action)` où **`role: OrganizationRole | null`** et `null` signifie
  « aucune organisation, le compte est propriétaire de sa donnée » → tout permis
  (critère 7, recherche §11) ; `permissionsOf(role)` qui rend l'enregistrement
  complet ; `removalPermission({actorRole, actorUserId, targetUserId, targetRole})`
  (se retirer soi-même est toujours permis ; un `admin` ne touche pas un `owner`) ;
  `roleChangePermission({actorRole, actorUserId, targetUserId, targetRole, nextRole})`
  (un `admin` ne modifie ni un `owner`, ni ne nomme un `owner`) ;
  `assignableRolesFor(...)` — les rôles qu'un appelant peut poser sur une ligne,
  rôle courant exclu. Cas ajoutés à `src/domain/organization-rules.test.ts` : la
  matrice **complète** rôle × action (3 × 6), les bornes de l'`admin`, le retrait
  de soi par un `member`, et l'absence d'organisation qui permet tout.
  *Mutation* : faire rendre `true` à `allows` pour `member` ; retirer la borne
  « un admin ne modifie pas un owner ».

- [x] **2. Le refus 403, distinct du 404** —
  `src/application/organization-use-cases.ts` : `OrganizationOutcome` gagne
  `{ status: 'forbidden' }` ; `src/presentation/organization-routes.ts` le traduit
  en `403 { error: 'forbidden' }`, à côté du `404 { error: 'not_found' }`
  existant. **L'ordre reste autorisation d'abord, permission ensuite** : un
  non-membre reçoit 404 avant que le rôle ne soit consulté (recherche §4).
  Cas dans `tests/organizations.test.ts` : l'organisation d'autrui rend toujours
  **404** même pour une action que l'appelant n'aurait pas le droit de faire.
  *Mutation* : évaluer la permission avant `accessFrom` → le cas 404 rougit.

- [x] **3. Les cinq portes existantes, gardées** — `inviteMember`,
  `resendInvitation`, `revokeInvitation`, `renameOrganization`, `removeMember`
  consultent `allows(access.role, …)` juste après `accessFrom`, avant toute
  validation et toute écriture. `removeMember` passe par `removalPermission` :
  quitter reste permis à tous, retirer autrui non. Cas dans
  `tests/organizations.test.ts` : **un témoin de refus par porte** — un `member`
  reçoit 403 et **rien n'est écrit ni envoyé** —, plus le témoin positif de
  l'`admin` (il invite et il retire) et sa borne (403 en retirant un `owner`).
  La matrice n'est pas rejouée ici : elle est éprouvée à la règle (tâche 1).
  *Mutation* : retirer la garde d'une porte → son témoin rougit.

- [x] **4. Le changement de rôle, et le transfert de propriété** — une route de
  plus, `POST /organizations/members/role`, `authenticated`, champs
  `organizationId`, `userId`, `role` (Zod, `z.enum(ORGANIZATION_ROLES)` — un rôle
  inconnu est refusé en `invalid_role`). Écriture dans
  `infrastructure/drizzle-organization-repositories.ts`, **dans une transaction
  qui prend d'abord `lockOrganizationMembership`** — le même verrou, la même clé
  que le retrait, ce qui sérialise aussi une rétrogradation contre un retrait :
  - nommer `owner` quelqu'un d'autre **est** le transfert : la cible devient
    `owner` et l'appelant `admin`, dans la même transaction (critère 4) ;
  - tout autre changement porte le compte des propriétaires **dans le prédicat de
    l'`update`** (`role <> 'owner' or (select count(*) …) > 1`), jamais dans une
    lecture préalable.
  La règle pure ne fait que **nommer** le refus (`not_a_member`, `last_owner`),
  comme `removalRefusal`. Cas : promotion, rétrogradation, transfert (l'ancien
  propriétaire devient `admin`), rôle inconnu refusé, rétrogradation du dernier
  propriétaire refusée, rejeu sans effet supplémentaire.
  *Mutation* : retirer la sous-requête du prédicat → « refuse de rétrograder le
  dernier propriétaire » rougit.

- [x] **5. La course, fermée et mesurée** — cas dans
  `tests/organizations.test.ts` : deux propriétaires, **une seule session**, deux
  soumissions parallèles de rétrogradation, N courses bornées, deux connexions
  réveillées avant la mesure. Attendu : exactement un propriétaire à **chaque**
  course. Le nombre de tirages et le taux sans verrou sont consignés dans le
  rapport.
  *Mutation* : retirer `lockOrganizationMembership` de la transaction du
  changement de rôle → le cas rougit, et on dit combien de tirages sur combien.

- [x] **6. Le pouvoir suit la ligne, pas le jeton** — cas dans
  `tests/organizations.test.ts` : un `admin` qui invite, rétrogradé en `member`
  par le propriétaire, **perd le droit à l'instant, sur la même session, sans
  reconnexion** — le jumeau montant de « fait perdre l'accès immédiatement » de
  s16. C'est la propriété opposable qui permet de ne pas faire tourner
  l'identifiant de session (recherche §6). **ADR 030** écrit ici : la matrice, le
  partage 403/404, le transfert atomique, et le réexamen de l'ADR 026 quand le
  pouvoir augmente.
  *Mutation* : mettre le rôle en cache dans le service → le cas rougit.

- [x] **7. Le changement de rôle est un événement de sécurité** —
  `src/domain/security-event.ts` (forme **fermée** : événement, acteur,
  organisation, cible, rôle demandé, transfert ou non — aucun champ libre, donc
  aucun emplacement où glisser un secret, recherche §8), port `SecurityLog` dans
  `application/ports.ts`, `infrastructure/console-security-log.ts` par défaut,
  injectable par `configureOrganizations`. Deux événements :
  `organizations.role_changed` et `organizations.role_change_refused`.
  Cas : le journal reçoit l'acteur, la cible et le rôle demandé ; **aucun secret
  n'y entre** (la forme le rend impossible, et le cas le dit).
  *Mutation* : ne plus journaliser le changement → le cas rougit.
  **Corrigé au tour de revue** : cette tâche annonçait « rôle avant, rôle après ».
  Il n'y a **qu'un** rôle, celui demandé — le précédent demanderait une lecture
  avant l'écriture, que ce module refuse partout ailleurs (revue de s17, F2).

- [x] **8. L’écran ne décide de rien** — `OrganizationsView` gagne
  `permissions`, `OrganizationMemberView` gagne `assignableRoles`, tous deux
  calculés dans `viewOrganizations` par les fonctions de la tâche 1 ;
  `EMPTY_ORGANIZATIONS_VIEW.permissions` est celui de « aucune organisation »,
  c'est-à-dire tout permis (critère 7). `organizations-screen.tsx` masque la carte
  « Invitations », la carte « Paramètres » et les boutons de ligne selon ces
  données — **aucune comparaison de rôle dans le `.tsx`**. Nouvelles clés de
  catalogue (`members.makeRole` par rôle, `members.transfer`, leurs variantes
  nommant la cible, `error.invalid_role`) dérivées par
  `domain/message-keys.ts`, jamais composées dans un `.tsx`.
  Cas : rendu de l'écran pour les trois rôles — le `member` ne voit ni le
  formulaire d'invitation ni celui des paramètres, l'`owner` voit les deux.
  *Mutation* : rendre `permissions` toujours vrai → les cas de rendu rougissent.

- [x] **9. Le parcours, dans un navigateur** — `e2e/organizations.spec.ts` : un
  propriétaire promeut un invité en administrateur, l'invité voit alors la carte
  « Invitations » qu'il ne voyait pas, puis il est rétrogradé et la perd — sans
  reconnexion. Et **l'appel direct** : le même compte, une fois `member`, poste
  sur la route d'invitation et reçoit **403**. Attentes dérivées de
  `organizations.available`, le fichier passe dans les deux configurations.

- [x] **10. Les documents qui changent avec le code** —
  `packages/modules/organizations/AGENTS.md` : la matrice, la commande qui tient
  chaque invariant neuf, le 403 contre le 404 (le « jamais 403 » du module
  devient « jamais 403 **à un non-membre** »), la borne du journal, et la ligne
  « aucune garde de rôle » qui disparaît puisqu'elle est fausse à partir d'ici.
  `docs/decisions/030-…` (numéro **réservé** : 026 à 029 sont pris, 028 appartient
  à une voie non fusionnée). Vérification visuelle consignée dans
  `docs/designs/s17-roles-permissions.md`, avec les nombres.

---

## Vérifications finales

`pnpm typecheck`, `pnpm lint --max-warnings=0`, `pnpm test`,
`E2E_PORT=3117 pnpm test:e2e`, `pnpm build`, `pnpm run audit` — module
`organizations` **activé** et **coupé**, puis remis en marche ; `pnpm db:migrate`
rejoué deux fois sans effet supplémentaire ; `pnpm db:generate` sans migration
neuve ; vérification navigateur aux deux thèmes et à 390 px.

---

## Tour de correction (revue `docs/reviews/s17-roles-permissions.md`)

Constats et arbitrages repris avant fusion. Chaque case cochée a sa mutation ou
sa mesure dans la section de clôture du rapport de revue.

- [x] **F1 — la dérivation serveur des affordances est tenue par un cas.**
  `tests/organizations.test.ts`, « dérive les droits et les rôles offerts du rôle
  de l'appelant, pour chacun des trois » : la vue **servie** est confrontée à
  `permissionsOf` et `assignableRolesFor` pour les trois rôles, avec des ancres
  concrètes. *Mutations* : les trois rôles en dur, puis `permissionsOf(null)`.
- [x] **F2 — les quatre mesures fausses.** Le compte d'invariants de
  l'`AGENTS.md` disparaît au profit du tableau lui-même ; le balayage de `roles`
  de l'ADR 030 est remesuré, avec sa commande et sa date ; « les deux rôles »
  devient le rôle demandé ; « cinq champs nommés » devient l'interface elle-même
  (deux emplacements). Un cinquième, non relevé par la revue, corrigé au passage :
  « les huit routes » dans `domain/permissions.ts`, pour neuf.
- [x] **Arbitrage 2 — un `admin` ne retire plus un autre `admin`.**
  `unremovableRolesFor` rend `['owner', 'admin']` ; la borne reste dans le
  prédicat du `delete`. *Mutation* : revenir à `['owner']`.
- [x] **Arbitrages 3 et 4 — écrits là où on les cherchera.** « Quitter n'est pas
  retirer » et « une organisation sans propriétaire est ingouvernable, et la
  cascade `auth_user` → `organization_member` la rend productible par s34 » sont
  dans l'`AGENTS.md` du module et dans l'ADR 030, avec la ligne de schéma.
- [x] **F3 — `allows` refuse un rôle hors matrice** au lieu de lever
  (`MATRIX[role] ?? []`), éprouvé à la règle et jusqu'à la route.
- [x] **F4 — « aucune comparaison de rôle hors de `permissions.ts` » devient une
  commande.** Sélecteurs `no-restricted-syntax` dans `eslint.config.ts`, cas dans
  `tests/lint-rules.test.ts`, `grantsOwnership` dans le `domain` ; les cinq
  occurrences du module (trois nommées par la revue, deux trouvées par la règle)
  passent par elle.
- [x] **F5 — l'ordre est le même aux six portes** : autorisation, permission,
  validation. Le refus de droit est journalisé avec la cible et le rôle extraits
  par Zod, `null` quand le corps n'en nommait pas.
- [x] **F6 — `'field'` retiré de l'exemption de `tests/rendered-text.test.ts`.**
  La prop n'existe plus depuis la story elle-même.
