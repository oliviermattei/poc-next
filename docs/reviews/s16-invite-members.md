# Revue — s16-invite-members

Branche `feature/s16-invite-members`, commit unique `74a73a8`, 40 fichiers.
Worktree `/Users/olivier/www/boilerplate/.claude/worktrees/agent-a92452e436f2c8543`, base Postgres `s16`.
Diff jugé : `git diff dev...feature/s16-invite-members`. Base de branche `cf9f480`.

Ce qui suit est ce que **cette revue** a balayé, avec les cas nommés — jamais
« tout ce qui existe ». Chaque mutation et chaque sonde a été défaite dans la
commande qui l'a posée, et `git diff --exit-code` vérifié propre avant la ligne
suivante comme avant la rédaction de ce rapport.

## 1. Les commandes, exécutées ici

Aucun résultat repris d'un résumé.

| Commande | `organizations` activé | `organizations` coupé (`pnpm ks toggle`) |
|---|---|---|
| `pnpm typecheck --force` | 0 (16 paquets) | — |
| `pnpm lint --max-warnings=0` | 0 | 0 |
| `pnpm test` | 957 passés, 2 ignorés, 31 fichiers | 957 passés, 2 ignorés |
| `E2E_PORT=3116 pnpm test:e2e` | 51 passés, 3 ignorés | — |
| `pnpm build --force` | 0 ; **toutes** les routes en `ƒ` (dynamiques), `/invitations/accept` comprise | — |
| `pnpm run audit` | 0 (« 1 avis, aucun au seuil élevé qui ne soit couvert ») | — |

Aller-retour `pnpm ks toggle organizations` : arbre vérifié propre, aucune
migration supplémentaire régénérée.

## 2. Migration et coupure : mesurées

Deux bases vierges créées pour la revue, puis **supprimées** (`s16_review`, `s16_off`).

- `s16_review`, module activé : premier `pnpm db:migrate` applique `auth (1)`,
  `organizations (2)`, `demo-enabled (1)` ; second passage — « Rien à appliquer :
  aucune migration en attente ». Neuf tables, dont `organization_invitation` ;
- `s16_off`, module coupé : « auth (1), demo-enabled (1) », **aucune** des quatre
  tables du module ;
- `0001_cynical_kitty_pryde.sql` ne contient que `CREATE TABLE`,
  `ALTER TABLE … ADD CONSTRAINT` et `CREATE (UNIQUE) INDEX` — additif,
  rien de destructif (`docs/reliability.md` §4).

## 3. Les mutations, et le rouge qu'elles produisent

Treize neutralisations, chacune restaurée dans la même commande.

| # | Ce qui est neutralisé | Rouges |
|---|---|---|
| M1 | `consumeInvitation` perd `accepted_at is null` | **1** |
| M2 | `consumeInvitation` perd `email = ?` (le lien devient transférable) | **1** |
| M3 | `removeMember` perd la sous-requête du dernier propriétaire | **1** |
| M4 | `liveInvitationsOf` perd `organization_id` | **7** |
| M5 | `memberIdentitiesOf` perd `organization_id` | **1** |
| M6 | `invitation-tokens.digest` rend le jeton en clair | **1** |
| M7 | le refus des routes passe de 404 à 403 | **5** |
| M8 | la route d'acceptation répond en `GET` | **14** |
| M9 | `exceedsInvitationQuota` rend toujours `false` | **2** |
| M10 | `invitationsIssuedSince` perd `created_at >= since` (fenêtre glissante) | **0** — constat F4 |
| M11 | `refreshInvitation` perd `organization_id` | **0** — constat F3 |
| M12 | `revokeInvitation` perd `organization_id` | **1** |
| M13 | `removeMember` perd `organization_id` | **0** — constat F3 |

M12 contre M11 et M13 : la même garde de périmètre est éprouvée sur la
révocation et ne l'est ni sur le renvoi ni sur le retrait. C'est une asymétrie,
pas une politique.

## 4. Les sondes de concurrence, créées / exécutées / supprimées

Fichiers de sonde écrits dans `tests/` puis `e2e/`, exécutés, **supprimés** ;
`git diff --exit-code` propre après chacun. Aucune ligne résiduelle laissée dans
la base `s16` (vérifié : 0 compte, 0 organisation, 0 invitation de sonde).

| Sonde | Mesure |
|---|---|
| A — deux acceptations **simultanées** du même lien | une seule appartenance écrite, la seconde répond `error=invitation_accepted`. **La consommation atomique tient sous concurrence réelle** |
| B — deux propriétaires se retirent **simultanément**, 25 courses | **23 organisations sur 25 se retrouvent sans aucun propriétaire** |
| F — **une seule session**, deux soumissions parallèles (retirer l'autre propriétaire et se retirer), 20 courses | **16 sur 20 sans propriétaire**, et 15 sur 20 **sans aucun membre** |
| G — état résultant | aucune route de s16 ne promeut un membre : l'organisation reste sans gouvernance |
| C — 19 invitations puis 6 concurrentes, quota 20 | **21 écrites**. Dépassement borné, conforme à ce que l'ADR 026 annonce |
| D — 50 renvois consécutifs de la même invitation | **50 emails partis, aucun refus** |
| E — temps de réponse d'`invite`, 40 tirages par cas | médiane **2,21 ms** pour une adresse qui a un compte, **2,10 ms** pour une adresse inconnue ; statut et `Location` identiques |
| H — `purge({kind:'user'})` d'un compte invité | l'adresse invitée **survit** dans `organization_invitation` (1 ligne avant, 1 après) ; l'export utilisateur ne porte que `memberships` et `activeOrganizationId` |

## 5. Vérification visuelle, refaite ici

Sonde Playwright jetable (créée, exécutée, supprimée ; arbre propre), Chromium,
`next dev` sur `E2E_PORT=3116`, avec une adresse invitée volontairement longue.

| Écran | Largeur | Thème | Débordement horizontal | Fond `<body>` |
|---|---|---|---|---|
| `/organizations` | 1280 | clair | 0 px | `lab(100 0 0)` |
| `/organizations` | 1280 | sombre | 0 px | `lab(2.75 0 0)` |
| `/organizations` | 390 | clair | 0 px | `lab(100 0 0)` |
| `/organizations` | 390 | sombre | 0 px | `lab(2.75 0 0)` |
| `/invitations/accept` | 1280 / 390 | clair et sombre | 0 px | — |

Le débordement corrigé par l'implémenteur est bien fermé, dans les deux thèmes
et aux deux largeurs, y compris avec une adresse de 90 caractères. En-tête de
l'écran d'acceptation : `cache-control: no-cache, must-revalidate`.

Ce que la capture montre en plus, et qui n'était pas mesuré : voir F5.

## 6. Constats

### F1 — critique — une organisation peut perdre tous ses propriétaires, et un seul compte suffit

Critère 7 de la story : « Le dernier propriétaire d'une organisation ne peut pas
être retiré. » Le prédicat du `delete` compte les propriétaires dans la même
instruction, ce qui ferme la fenêtre d'une requête **isolée** — M3 le prouve.
Sous l'isolation par défaut de PostgreSQL, il ne ferme rien du tout dès qu'il y
a deux ordres en vol.

Ce que la revue a mesuré, contre la vraie base :

- deux propriétaires qui se retirent l'un l'autre en parallèle : **23 courses sur
  25** laissent l'organisation sans propriétaire ;
- **une seule session** qui envoie en parallèle « retirer l'autre propriétaire »
  et « me retirer » : **16 sur 20** laissent l'organisation sans propriétaire, et
  **15 sur 20** sans aucun membre. Deux clics rapprochés sur deux boutons de
  l'écran suffisent — aucun outil, aucun second compte ;
- l'état est **irrécupérable dans le produit** : s16 ne pose aucune route qui
  promeuve un membre en propriétaire (c'est s17), et le membre restant conserve
  le rôle `member`.

L'ADR 026 nomme la fenêtre (« À surveiller — la règle du dernier propriétaire
sous concurrence ») et la présente comme le cas de deux propriétaires distincts
agissant simultanément. Deux choses le rendent insuffisant : le taux mesuré
(80–92 %, pas une course rare) et le fait qu'un **seul** acteur y accède. Surtout,
`packages/modules/organizations/AGENTS.md` inscrit l'invariant dans le tableau
« Les invariants, et la commande qui tient chacun » — « Une organisation garde au
moins un propriétaire » — alors qu'aucune commande ne le tient. C'est exactement
la phrase qui fait qu'un agent suivant cesse de chercher (ADR 013).

La raison invoquée pour ne pas le fermer — « le fermer demanderait un verrou de
ligne, c'est-à-dire une lecture dans le chemin d'écriture, que la porte de
lecture refuse » — est une contrainte que le module s'est donnée à lui-même
(`eslint.config.ts`, bloc `organizationPerimeter`, et son `ignores`). Elle ne
peut pas primer sur un critère d'acceptation. Un `select … for update` sur la
ligne d'`organization` dans la transaction du retrait, une sérialisation par
`pg_advisory_xact_lock`, ou simplement l'exécution du retrait en
`repeatable read`, sont tous des gestes du chemin d'écriture ; le premier
demande d'élargir la porte, les deux autres non.

Un test qui mord : deux `removeMember` lancés par `Promise.all` sur une
organisation à deux propriétaires, puis `count(*) where role = 'owner'` — il
rougit aujourd'hui, quatre fois sur cinq.

### F2 — majeur — le renvoi d'invitation n'est borné par rien, et le quota annoncé n'est pas un quota d'émission

Mesuré : **50 `POST /organizations/invitations/resend` consécutifs sur la même
invitation envoient 50 emails**, sans un seul refus. `resendInvitation` ne
consulte pas le quota, et `invitationsIssuedSince` compte `created_at`, que le
renvoi ne touche pas — c'est écrit en toutes lettres dans `scoped-reads.ts`
(« un renvoi n'est pas une émission de plus »).

Le problème n'est pas l'arbitrage, c'est ce qui en est dit. L'ADR 026 écrit :
« Ce qui est posé à la place est un **quota d'émission par organisation**
(20 par heure), compté dans la table des invitations », et justifie ce quota par
« une invitation est un moyen d'expédier du courrier depuis le domaine du
produit, et la réputation d'envoi est le seul actif qu'on ne récupère pas »
(repris dans `domain/invitation.ts` et dans l'`AGENTS.md` du module). L'actif
nommé n'est pas protégé : n'importe quel membre invite une adresse quelconque une
fois, puis la bombarde sans limite. Ce n'est pas la limitation de débit de s28
(la route est `authenticated`, et `docs/architecture.md` reporte s28 pour les
points d'entrée **publics**) — c'est le contrôle que cette story dit avoir posé.

Deux issues, l'une ou l'autre : compter le renvoi dans la fenêtre, ou ramener le
texte de l'ADR et de l'`AGENTS.md` à ce qui est vrai (« un quota de **création**
d'invitations », et dire que le renvoi n'est borné par rien avant s28).

### F3 — majeur — deux prédicats de périmètre sans aucun filet

M11 et M13 : retirer `organization_id` du `where` de `refreshInvitation` **et**
de `removeMember` laisse les 957 tests verts.

La production est juste ; le filet est plus étroit que son nom, et ce qu'il
laisserait passer est de la multi-tenance :

- `refreshInvitation` sans périmètre : un membre de l'organisation A, en
  fournissant `organizationId = A` (qui passe `accessFrom`) et l'`invitationId`
  d'une invitation de B, ferait **tourner le jeton** de B — l'invité de B perd
  son lien — et déclencherait un email vers l'adresse de B ;
- `removeMember` sans périmètre : le même appelant supprimerait l'appartenance de
  sa cible dans **toutes** les organisations où elle est membre.

L'asymétrie est le symptôme : le cas jumeau existe et mord pour
`revokeInvitation` (M12, 1 rouge, cas « refuse d'agir sur l'invitation d'une
autre organisation »). Le plan (tâche 4) n'annonçait de mutation que sur la
révocation ; les deux voisines ont été écrites sans leur cas.

Le fichier `scoped-reads.ts` dit lui-même que « la règle de lint ne lit pas le
SQL » et que c'est la mutation qui éprouve les prédicats. Elle ne les éprouve pas
tous.

### F4 — majeur — la fenêtre glissante du quota n'est vérifiée par rien

M10 : `invitationsIssuedSince` sans `created_at >= since` — 957 verts. Le quota
devient alors **à vie** : une organisation qui a émis 20 invitations depuis sa
création ne pourrait plus jamais en émettre une seule, et aucune commande ne le
dirait.

C'est le point que l'implémenteur signale avoir travaillé exprès — écrire
`created_at` depuis l'horloge du module « pour rendre la fenêtre observable ». Le
choix de l'horloge applicative est défendable ici (la même horloge injectée
décide de l'échéance et du comptage ; deux horloges rendraient la fenêtre
inobservable, et les colonnes sont en `timestamptz`, donc sans piège de fuseau).
Ce qui manque, c'est le cas qui l'observe : avancer l'horloge d'une heure et
vérifier qu'une 21ᵉ invitation passe.

### F5 — majeur — à 390 px, on ne lit plus quelle invitation on révoque

Capture prise ici, `/organizations`, 390 px, thème sombre et clair, deux
invitations en attente : la ligne rend l'adresse tronquée à **un ou deux
caractères** (« c. », « u. »), suivie du badge de statut et des deux boutons
« Renvoyer » / « Révoquer ». Deux invitations deviennent visuellement
indiscernables, alors que la ligne porte une action destructive.

La cause est dans `organizations-screen.tsx` : le libellé est
`min-w-0 flex-1 truncate` dans un conteneur `flex-wrap`. Avec `flex-basis: 0`, le
libellé « tient » toujours et ne provoque jamais le retour à la ligne que
`flex-wrap` était censé offrir ; il absorbe seul toute la compression.
`docs/design-system.md` demande d'ailleurs que « les tableaux passent en liste de
cartes » sous `md`, ce que cette ligne ne fait pas.

La vérification visuelle consignée dans `docs/designs/s16-invite-members.md` est
**honnête** — elle mesure `scrollWidth`/`clientWidth`, le thème appliqué et le
fond calculé, et ces trois mesures sont exactes, je les ai refaites. Elle ne
mesure simplement pas la lisibilité, et c'est ce qui a échappé. Classé majeur et
non mineur parce que le geste que l'écran propose alors est la révocation d'une
invitation qu'on ne peut pas identifier.

### F6 — majeur — un nouveau stockage de données personnelles n'est ni catégorisé ni purgé

`organization_invitation.email` porte l'adresse d'une personne qui **n'a pas
nécessairement de compte** — c'est même le cas nominal du critère 2. Le contrat
du module (`module.ts`) déclare toujours
`dataCategories: ['organization', 'membership']` et
`retention: { organization: 'erase', membership: 'erase' }`. Mesuré (sonde H) :

- après `purge({ kind: 'user' })` du compte invité, la ligne d'invitation et son
  adresse **sont toujours là** (1 avant, 1 après) ;
- `export({ kind: 'user' })` ne rend que `memberships` et `activeOrganizationId` :
  les invitations adressées à ce compte n'y figurent pas.

`docs/architecture.md` : « `retention` est indexée par `dataCategories` : une
catégorie déclarée sans politique ne compile pas ». La garde tient l'inverse
— une catégorie **non déclarée** ne coûte rien —, et le cas
`tests/organizations.test.ts` « déclare une politique de rétention pour chacune
de ses catégories » ne confronte pas les tables aux catégories. Il manque une
catégorie `invitation`, sa politique, et le geste de purge/export correspondant.

### F7 — mineur — trois tables devenues quatre, dans deux fichiers restés en arrière

`packages/modules/organizations/src/index.ts` (« aucune des **trois** tables sur
une base vierge ») et le corps du commentaire de tête de `src/schema.ts`
(« sur une base vierge dont la configuration ne nomme pas ce module, aucune des
**trois** n'est créée ») — alors que le titre du même commentaire dit « quatre,
et pas une de plus » et que l'`AGENTS.md` du module a été corrigé. Un chiffre
faux dans le fichier que le prochain agent ouvre en premier.

### F8 — mineur — dérive de plan, en noms et en périmètre

Le diff fait ce que le plan demande, et un peu plus :

- tâche 3 annonce **trois** lectures (`pendingInvitationsOf`,
  `invitationsIssuedSince`, `invitationByDigest`) et « `membersOf` existe déjà,
  elle est réemployée ». Livrées : **cinq** — `liveInvitationsOf` (renommée),
  `invitationsIssuedSince`, `invitationByDigest`, plus `memberIdentitiesOf` et
  `emailOf`, que le plan ne demande pas. Les deux sont justifiées (nommer un
  membre par son adresse, et lire l'adresse du compte qui accepte) et vivent bien
  dans la porte ; la dérive est dans le document, pas dans le code ;
- tâche 6 annonce l'option `generateToken` ; livrée : `tokens`, une fabrique
  `InvitationTokenFactory` (meilleure forme — `generate` et `digest` restent
  ensemble) ;
- le plan écrit « aucune modification … de `generated/` » ; `generated/schema/organizations.ts`
  est modifié d'une ligne. C'est la régénération mécanique du baril par
  `pnpm ks`, inévitable dès qu'une table est ajoutée : c'est la phrase du plan
  qui était fausse.

### F9 — mineur — « `@repo/module-auth` … nulle part ailleurs » est de la documentation, pas une règle

L'`AGENTS.md` du module élargit l'autorisation d'importer `@repo/module-auth` de
`src/schema.ts` seul à `schema.ts` **et** `infrastructure/scoped-reads.ts`.
**L'élargissement est bon** : la jointure part toujours d'un identifiant de
compte (`memberIdentitiesOf`, `emailOf`), jamais d'une adresse — le module ne
sait donc pas répondre à « existe-t-il un compte pour cette adresse ? », et c'est
ce qui rend l'absence d'énumération structurelle plutôt que surveillée. Elle vit
dans le fichier dont `pnpm lint` borne déjà la surface.

Ce qui manque est la commande : aucune règle ESLint ni aucun test ne vise
`@repo/module-auth` dans ce module (vérifié, `eslint.config.ts` ne le nomme
nulle part). Un troisième fichier qui l'importerait demain ne ferait rougir rien.
Soit la règle devient exécutable, soit le texte dit « convention, non tenue par
une commande ».

**La porte de lecture, elle, mord toujours** : `tests/lint-rules.test.ts` rejoue
la sonde de la revue de s15 et exige le refus dans quatre emplacements
(`infrastructure/`, `application/`, `presentation/`, et le fichier des
repositories lui-même), l'autorise dans `scoped-reads.ts`, et vérifie que les
deux interdits communs (`@repo/db`, `<form>` sans `method`) n'ont pas été écrasés
par la reprise de `no-restricted-syntax`. Les cinq cas sont verts.

## 7. Ce qui a été instruit et n'est **pas** un constat

### 7.1 L'absence de rotation d'identifiant de session : la réciproque tient, et pour une raison de plus que celle écrite

La preuve opposable de l'ADR 026 est la réciproque. Attaquée sous quatre angles :

1. **Aucune autorité en cache nulle part.** `ModuleSession` porte `userId` et
   `roles` ; `auth_session` n'a aucune colonne d'organisation ; l'appartenance est
   relue à chaque requête par `membershipOf` **et** par `activeOrganizationIdOf`
   (jointe sur le compte depuis le tour de correction de s15). Aucun mémo
   applicatif : le singleton `organizationsService` ne retient que la connexion,
   le mailer et les identifiants réservés.
2. **Aucune réponse mise en cache.** `pnpm build` rend **toutes** les routes en
   `ƒ` (server-rendered on demand), `/invitations/accept` et `/organizations`
   comprises ; l'écran d'acceptation répond
   `cache-control: no-cache, must-revalidate` (mesuré au navigateur).
3. **Le retrait tombe pour la même session, sans reconnexion** — mesuré au nœud
   (`activeOrganizationId` → `null`, `memberships` → `[]`, `dataOwnerOf` →
   `{kind:'user'}`, la ligne de sélection restant en base) et **au navigateur**,
   dans le même contexte Playwright, sans reconnexion.
4. **La fixation de session est fermée par ailleurs, et l'ADR ne le dit pas.**
   L'attaque que la rotation prévient consiste à faire élever une session que
   l'attaquant contrôle. Ici elle échoue par construction : l'adresse du
   destinataire est **dans le prédicat** de la consommation, donc une session
   implantée — dont le compte porte l'adresse de l'attaquant — ne consomme rien.
   C'est un argument plus fort que celui écrit, et il mériterait de figurer dans
   l'ADR.

Ici l'acceptation **ajoute** un droit là où la bascule de s15 n'en changeait que
la portée ; la conclusion reste la même parce que le droit ajouté est une ligne
relue, pas une valeur portée par le jeton. L'absence de rotation est un constat
qui tient.

### 7.2 Le jeton d'invitation

- 32 octets de `randomBytes`, empreinte SHA-256 en base64url ; **le jeton du lien
  ne se retrouve pas en base** (cas nommé, et M6 le fait rougir) ;
- **rejeu** : deux acceptations **réellement simultanées** (sonde A) → une seule
  appartenance, la seconde reçoit `invitation_accepted` ;
- **lien transféré** : l'adresse est dans le prédicat (M2 → rouge) ; un compte
  tiers reçoit `invitation_other_recipient` ;
- **révoquée puis recréée** : index unique **partiel** sur
  `(organization_id, email) where accepted_at is null and revoked_at is null` —
  une invitation révoquée libère la place, une invitation vivante la refuse
  (traduite en `already_invited` sur la **contrainte nommée**, pas sur le seul
  code SQLSTATE) ;
- **renvoi** : tourne l'empreinte sur la même ligne, l'ancien lien meurt (cas
  nommé, vert) ;
- **adresse changée entre l'envoi et l'acceptation** : le changement d'adresse du
  module `auth` exige la confirmation d'un jeton envoyé à la **nouvelle** adresse
  (`confirmEmailChange`), donc nul ne peut s'attribuer l'adresse invitée pour
  voler le lien. Le cas légitime — l'invité change d'adresse — échoue **fermé**,
  avec le message qui dit quoi faire.

### 7.3 Pas d'énumération de comptes

Message et destination identiques (cas nommé), et **temps mesuré ici**, 40
tirages par cas : médiane 2,21 ms pour une adresse qui a un compte, 2,10 ms pour
une adresse qui n'en a pas. Même ordre de grandeur, et pour une raison
structurelle : le module n'a **aucune** lecture de `auth_user` par adresse — la
seule est `emailOf(userId)`. Le refus `already_member` compare la liste des
membres de l'organisation, que l'appelant voit déjà à l'écran.

### 7.4 404 et jamais 403

M7 : 5 rouges, sur les trois routes de s15 et les deux routes neuves qui
prennent un `organizationId`. Le refus est le **même objet** pour « l'organisation
d'un autre » et « une organisation qui n'existe pas », parce que c'est le même
ordre SQL unique. L'invitation d'une autre organisation, elle, rend
`invitation_unknown` — indiscernable d'une invitation inexistante (cas nommé).

### 7.5 Aucune injection dans l'email, aucun secret dans un journal

- `to` est l'adresse validée par `z.email()` après normalisation : ni retour à la
  ligne ni caractère d'en-tête ne la traverse ;
- sujet et corps passent par la **même** interpolation puis par
  `TransactionalEmail`, qui pose les valeurs en **enfants de texte** : React les
  échappe. Un nom d'organisation ne peut pas devenir du balisage ;
- le nom d'organisation est un texte libre (1–64 caractères, retours à la ligne
  non refusés) interpolé dans le **sujet**. L'adaptateur Resend poste du JSON,
  donc aucune surface d'injection d'en-tête n'a été trouvée par cette voie ; ce
  n'est pas éprouvé contre un vrai fournisseur (§8) ;
- aucun `console.` ni logger dans `packages/modules/organizations/src` ; la porte
  de lecture ne sélectionne jamais `token_hash` (`invitationQuery` énumère ses
  colonnes) ; le jeton en clair ne quitte pas `deliver`, sinon par le lien.

### 7.6 Rejouabilité

Migration rejouée (« Rien à appliquer »), acceptation rejouée (une appartenance,
`onConflictDoNothing` sur `organization_member_unique`), révocation rejouée (même
refus, rien de plus écrit), purge rejouée, bascule rejouée. Module coupé : aucune
route, aucune navigation, aucun catalogue, aucune des quatre tables.

### 7.7 Le dépassement de quota sous concurrence

Mesuré : 21 invitations écrites pour un quota annoncé de 20, avec 6 requêtes
parallèles. Borné par la concurrence, conforme à ce que l'ADR 026 écrit sous
« À surveiller ». **Ce n'est pas un constat** — c'est le comportement documenté,
et il est petit. Ce qui l'est, c'est F2 (le renvoi hors quota) et F4 (la fenêtre
non éprouvée).

### 7.8 Les tests, lus comme du code de production

Rien de décoratif trouvé sur ces cas : aucune assertion sur une classe CSS, une
structure DOM ou un libellé statique. Les deux entrées ajoutées à
`tests/rendered-text.test.ts` déclarent leurs `technicalProps` **sur l'écran**
(l'acquis du constat F5 de s15) : la liste globale ne se desserre pas. Les
fixtures posent deux membres et deux invitations exprès, pour que les deux formes
de chaque ligne soient rendues. Les cas du `domain` ne sont pas rejoués par les
cas de câblage.

## 8. Non vérifié

Dit plutôt que sous-entendu, et ce n'est pas la liste de ce qui existe :

- **la chaîne complète du critère 2** — « par un nouvel utilisateur, elle enchaîne
  sur l'inscription puis l'ajoute ». L'écran d'atterrissage anonyme est éprouvé au
  navigateur (nom de l'organisation, deux chemins, aucune acceptation offerte) ;
  la suite — inscription, vérification d'adresse, retour sur le lien, acceptation —
  n'est jouée par aucun parcours. **Geste humain attendu** : la faire de bout en
  bout, avec une adresse jamais vue ;
- **un envoi réel** — aucune clé Resend ; tout passe par la capture locale. Le
  sujet interpolé n'a donc jamais atteint un vrai fournisseur ;
- **la CI GitHub Actions** — tout a tourné localement, macOS et Postgres 16 en
  conteneur ; rien sur un runner ;
- **plusieurs instances** — le quota est partagé parce qu'il est en base, mais
  aucune mesure n'a été faite avec deux processus ;
- **un niveau d'isolation autre que celui du conteneur local** — F1 a été mesuré
  sur `read committed` par défaut ; le taux serait différent ailleurs, la
  propriété non ;
- **un lecteur d'écran réel**, **le contraste calculé**, **le clavier seul** sur
  les deux cartes neuves. **Geste humain attendu** : parcourir `/organizations` à
  la tabulation, avec deux invitations et deux membres ;
- **le second moteur** — Chromium seul, comme tout le dépôt ;
- **le module `organizations` avec `i18n` coupé** — configuration non essayée,
  déjà signalée non vérifiée par la revue de s15 ;
- **`pnpm dev`** — l'application n'a été démarrée que par Playwright
  (`next dev` sur le port 3116).

**Gestes humains à faire avant de refermer F1 et F5** : sur une organisation à
deux propriétaires, cliquer « Retirer » sur les deux lignes coup sur coup dans un
vrai navigateur, puis recharger et vérifier qu'il reste un propriétaire ; ouvrir
`/organizations` à 390 px avec deux invitations en attente et essayer de dire
laquelle on révoque ; garder un œil sur la boîte de réception en appuyant dix
fois sur « Renvoyer ».

## 9. Restauration

Treize mutations et cinq sondes (quatre fichiers de test créés dans `tests/`, un
dans `e2e/`), toutes défaites dans la commande qui les a posées ;
`git diff --exit-code` propre après chacune et avant la rédaction de ce rapport,
`HEAD` toujours sur `74a73a8`. Deux bases jetables créées puis **supprimées**
(`s16_review`, `s16_off`). Aucune ligne de sonde laissée dans la base `s16`
(0 compte, 0 organisation, 0 invitation `probe-%`, revérifié). Aller-retour
`pnpm ks toggle organizations` refermé, `config/features.ts` et `generated/`
identiques.


---

# Clôture — tour de correction, commit `d2ddcf1`

Écrit par l'implémenteur, à la demande de l'arbitrage. Ce qui suit est ce que
**ce tour** a fermé et ce qu'il a mesuré, constat par constat — pas « tout ce
qui existe ». Chaque mutation a été défaite dans la commande qui l'a posée, et
l'arbre vérifié propre avant le commit.

## Les commandes, rejouées ici

| Commande | `organizations` activé | `organizations` coupé |
|---|---|---|
| `pnpm typecheck` | 0 (16 paquets) | 0 (16 paquets) |
| `pnpm lint --max-warnings=0` | 0 | 0 |
| `pnpm test` | **977** passés, 2 ignorés, 31 fichiers | **977** passés, 2 ignorés |
| `E2E_PORT=3116 pnpm test:e2e` | **52** passés, 3 ignorés | 47 passés, 8 ignorés |
| `pnpm build` | 0 | 0 |
| `pnpm run audit` | 0 (« 1 avis, aucun au seuil élevé qui ne soit couvert ») | — |

957 → 977 tests : **vingt cas ajoutés**, aucun supprimé. `pnpm db:migrate`
rejoué : « Rien à appliquer : aucune migration en attente ». Aucune migration
neuve — ce tour ne change pas le schéma. Aller-retour
`pnpm ks toggle organizations` refermé : `config/features.ts` et `generated/`
identiques après retour.

## Les mutations de ce tour, et le rouge qu'elles produisent

| # | Ce qui est neutralisé | Rouges |
|---|---|---|
| N1 | le retrait perd son verrou consultatif | **1** — le cas de course, 9 tirages rouges sur 10 |
| N2 | `refreshInvitation` perd `organization_id` (M11 de la revue) | **1** (0 avant) |
| N3 | `removeMember` perd `organization_id` (M13 de la revue) | **1** (0 avant) |
| N4 | `invitationsIssuedSince` perd `created_at >= since` (M10) | **1** (0 avant) |
| N5 | le renvoi ne consulte plus le quota | **1** |
| N6 | la purge n'efface plus les invitations adressées au compte | **1** |
| N7 | le fichier des verrous perd la borne (`select`/`from` permis) | **1** |
| N8 | la borne sur `@repo/module-auth` disparaît | **5** |
| N9 | le fichier des verrous retiré des `ignores` du premier bloc | **0** — ligne redondante, **supprimée** plutôt que gardée |

N9 est le seul rouge attendu qui n'est pas venu : le bloc suivant reprenait déjà
le fichier en entier, donc l'entrée d'`ignores` ne tenait rien. Elle a été
retirée, avec la raison écrite à sa place.

## Constat par constat

**F1 — fermé.** Le retrait s'exécute dans une transaction qui prend d'abord
`pg_advisory_xact_lock(hashtext(<organisation>))`. Le verrou ne lit aucune table,
tombe avec la transaction, et est partagé entre processus puisqu'il est tenu par
PostgreSQL. Le cas est **reproductible par construction** : dix courses bornées,
deux connexions réveillées avant la mesure, les deux requêtes lancées dans le
même tour de boucle, une **seule** session (« retirer l'autre » et « me
retirer »). Tirages mesurés : sans le verrou, **9 rouges sur 10** ; avec,
**10 sur 10** laissent exactement un propriétaire. La porte de lecture s'élargit
d'un cran borné — `execute` dans `infrastructure/transaction-locks.ts`,
`select`/`from` toujours refusés là, `execute` toujours refusé ailleurs — et les
trois cas de `tests/lint-rules.test.ts` le tiennent. Le tableau « la commande qui
tient chacun » de l'`AGENTS.md` du module est corrigé : la ligne nomme désormais
le verrou **et** le cas de course. ADR 026 amendé (avant tout ship) : l'argument
« la porte de lecture refuse un verrou » y est nommé comme faux, avec les taux
mesurés par la revue.

**F2 — fermé, par la voie retenue.** Une émission d'invitation est **une ligne** :
le renvoi éteint la précédente — révoquée, empreinte remplacée par celle d'un
jeton que personne n'a reçu, donc l'ancien lien répond toujours « inconnu » — et
en écrit une neuve, datée de l'horloge du module. Le quota compte donc le renvoi
sans changer sa requête. Conséquence assumée et écrite dans l'ADR : l'identifiant
d'une invitation change à chaque renvoi. L'autre voie — réécrire l'ADR en « quota
de création » — n'a pas été prise.

**F3 — fermé.** Deux cas ajoutés, jumeaux de celui de la révocation : renvoyer
l'invitation d'une autre organisation (aucun email parti, jeton de l'autre
organisation toujours utilisable ensuite) et retirer un membre d'une autre
organisation (les deux appartenances intactes). Les deux mutations exactes de la
revue rougissent maintenant, une chacune.

**F4 — fermé.** Quota atteint, horloge avancée d'une heure et une milliseconde,
la 21ᵉ invitation passe et la ligne est écrite. La mutation M10 rougit.

**F5 — fermé.** `basis-full` sous `sm`, `sm:flex-1 sm:basis-auto` au-delà. Mesuré
au navigateur à 390 px : largeur rendue du libellé **8,98 px avant**, **≥ 200 px
après** (assertion), adresse courte non tronquée (`scrollWidth ≤ clientWidth`),
débordement horizontal toujours nul. Consigné dans `docs/designs/`, avec la
raison pour laquelle la mesure d'origine était honnête et insuffisante.

**F6 — fermé, et il a coûté un ADR.** Catégorie `invitation` déclarée, rétention
`erase`, purge qui lit l'adresse **sur le compte** puis efface les invitations
qui la portent dans toutes les organisations, export qui les rend. Vérifié en
**exécutant** la purge : 1 ligne avant, 0 après, et rejouée sans effet
supplémentaire. La cause profonde était l'ordre de purge du registre : purgé
après son requis, ce module n'avait plus d'adresse à lire. `purgeModules`
parcourt désormais le dépendant avant son requis — **ADR 029**, avec son cas
dans `tests/module-registry.test.ts` qui vérifie **ensemble** l'ordre de purge
(inverse) et l'ordre de montage (direct).

**F7 — fermé.** « trois tables » devenues quatre dans `src/index.ts` et dans le
corps du commentaire de `src/schema.ts`.

**F8 — fermé dans le document.** Le plan dit maintenant ce qui a été livré :
cinq lectures et non trois, `liveInvitationsOf` plutôt que `pendingInvitationsOf`
(le nom du plan mentait — la lecture rend aussi les échues), `tokens` plutôt que
`generateToken`, et la phrase sur `generated/` corrigée : la régénération du
baril est mécanique et inévitable.

**F9 — fermé par une commande.** `pnpm lint` refuse `@repo/module-auth` partout
dans le module sauf dans `src/schema.ts` et
`src/infrastructure/scoped-reads.ts`, avec sept cas dans
`tests/lint-rules.test.ts` (cinq emplacements refusés, deux permis) et un cas de
reprise, parce qu'en configuration plate cette déclaration en remplace une autre.

**§7.1 — l'argument manquant est écrit.** L'ADR 026 porte désormais le quatrième
angle nommé par la revue : la fixation de session est fermée **par
construction**, l'adresse du destinataire étant dans le prédicat de consommation
— une session implantée ne consomme rien. Rien de ce que la revue a validé n'a
été défait : l'absence de rotation, la consommation atomique, la non-énumération
et le 404-jamais-403 gardent leurs cas, tous verts.

## Ce que ce tour n'a pas vérifié

Dit plutôt que sous-entendu, et ce n'est pas la liste de ce qui existe :

- **la chaîne complète du critère 2** (inscription enchaînée depuis le lien) —
  toujours pas jouée de bout en bout ; geste humain attendu, inchangé ;
- **un envoi réel** — capture locale uniquement, aucune clé Resend ;
- **la CI GitHub Actions**, y compris la configuration `socle` annoncée : tout a
  tourné localement, macOS, Postgres 16 en conteneur ;
- **plusieurs instances** — le verrou consultatif est porté par PostgreSQL, donc
  partagé par construction, mais aucune mesure n'a été faite à deux processus ;
- **un autre niveau d'isolation** que le `read committed` par défaut ;
- **le clavier seul, un lecteur d'écran, le contraste calculé** sur les deux
  cartes ; **un second moteur** que Chromium ;
- **la course sur le quota** (21 lignes pour 20) : inchangée, documentée dans
  l'ADR, non fermée — le dépassement reste borné par la concurrence ;
- **`pnpm dev`** — l'application n'a été démarrée que par Playwright.

## Restauration

Neuf mutations, toutes défaites dans la commande qui les a posées ; aucune
sauvegarde résiduelle, arbre vérifié avant le commit. Aucune base jetable créée
ce tour. `HEAD` sur `d2ddcf1`.

---

Max severity: none
Ship allowed: yes
