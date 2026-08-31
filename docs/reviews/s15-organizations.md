# Revue — s15-organizations

Branche `feature/s15-organizations`, commit unique `520d49b`, 50 fichiers.
Worktree `/Users/olivier/www/boilerplate/.claude/worktrees/agent-a4dd02e79f7c4b5d6`, base `s15`.
Diff jugé : `git diff dev...feature/s15-organizations`. Base de branche `df3bb2f`.

Ce qui suit est ce que **cette revue** a balayé, avec les cas nommés. Jamais
« tout ce qui existe ». Chaque mutation a été restaurée dans la commande qui
l'a posée, et l'arbre vérifié propre (`git diff --exit-code`) avant la ligne
suivante.

## 1. Les commandes, exécutées ici

Aucun résultat repris d'un résumé.

| Commande | `organizations` activé | `organizations` coupé (`pnpm ks toggle organizations`) |
|---|---|---|
| `pnpm typecheck` | 0 | — |
| `pnpm lint` | 0 | 0 |
| `pnpm test` | 811 passés, 2 ignorés, 30 fichiers | 811 passés, 2 ignorés |
| `pnpm test:e2e` (`E2E_PORT=3115`) | 36 passés, 3 ignorés | `e2e/organizations.spec.ts` : 1 passé (« l'écran n'existe pas », 404 réel), 2 ignorés |
| `pnpm build` (`--force`, sans cache) | 0 | — |
| `pnpm run audit` | 0 (« 1 avis, aucun au seuil élevé qui ne soit couvert ») | — |

Après la bascule aller-retour, `git diff --exit-code` propre : `config/features.ts`
et `generated/schema/` reviennent à l'identique, et la régénération ne produit
aucune migration supplémentaire.

## 2. Migration : mesurée, pas déduite

Base **vierge** créée pour la revue (`s15_review`), module activé :

- premier `pnpm db:migrate` — « Migrations appliquées : auth (1), organizations (1), demo-enabled (1) » ;
- second passage — « Rien à appliquer » ; aucune migration rejouée ;
- tables présentes : `organization`, `organization_member`, `organization_active_selection`, plus celles d'`auth` et de `demo-enabled`.

Seconde base vierge (`s15_off`), module **coupé** : « auth (1), demo-enabled (1) »,
et **aucune** des trois tables. `auth_session` n'a aucune colonne
`active_organization_id` : la trace du plugin écarté n'existe nulle part.

Le SQL de `0000_married_absorbing_man.sql` ne contient que des `CREATE TABLE`,
`ALTER TABLE … ADD CONSTRAINT` et `CREATE INDEX` — rien de destructif, rien qui
casse la version en ligne (`docs/reliability.md` §4).

## 3. Les mutations, et le rouge qu'elles produisent

Sept neutralisations. Chacune restaurée dans la même commande.

| # | Ce qui est neutralisé | Rouges |
|---|---|---|
| M1 | `findMembership` perd `eq(organizationMember.userId, …)` — le prédicat devient l'organisation seule | **3** |
| M2 | le refus des routes passe de 404 à 403 | **2** |
| M3 | `parseOrganizationDraft` ne confronte plus les identifiants réservés | **7** |
| M4 | `resolveDataOwner` rend toujours `{kind:'user'}` | **6** |
| M5 | `OrganizationAccess` perd sa marque de type | **3** (dont la fixture de typage, qui compile alors) |
| M6a | `'account'` retiré de `APPLICATION_SEGMENTS` | **0** — voir §4 |
| M6b | `'legal'` retiré de `APPLICATION_SEGMENTS` | **1** |
| M7 | `prepareModuleServices()` retiré du répartiteur | **0** en `pnpm test`, **2** en `pnpm test:e2e` |

## 4. Le vert de M6a est expliqué, et l'explication tient

`'account'` retiré, la suite reste verte : `moduleRegistry.navigation` contient
`/account` et `/sign-in`, déclarés par le module `auth`
(`packages/modules/auth/src/presentation/auth-routes.ts`), et le point de
composition réserve le premier segment de chaque `href`. La couverture est donc
réellement redondante pour ces deux-là. M6b le confirme par la négative :
`'legal'`, qu'aucune navigation ne porte, fait rougir immédiatement. Les
segments réellement portés par la liste écrite, aujourd'hui, sont donc `api`,
`forgot-password`, `legal`, `reset-password`, `sign-up`, `verify-email`
(`organizations` étant couvert par la navigation du module quand il est activé).

## 5. La prémisse de la rotation : attaquée, et le résultat est double

**Ce qui tient.** Le jeton de session ne porte **aucune** autorité
organisationnelle, et c'est vérifiable : `auth_session` n'a pas de colonne
d'organisation sur une base fraîchement migrée, aucun cookie n'est posé par le
module, l'organisation active est une ligne `organization_active_selection` dont
la clé primaire est le **compte**. `docs/security.md` §2 n'énumère d'ailleurs
pas la bascule d'organisation parmi les élévations de privilège. **L'absence de
rotation n'est pas un constat** : il n'y a rien à faire tourner, et une rotation
ne changerait rien à une ligne indexée par compte.

**Ce qui ne tient pas** — mesuré par une sonde jetable (créée, exécutée,
supprimée ; arbre vérifié propre) qui retire la ligne d'appartenance, exactement
le geste de s16 :

| Chemin | Après retrait de l'appartenance |
|---|---|
| `POST /organizations/switch` | **404** ✔ |
| `POST /organizations/update` | **404** ✔ |
| `viewOrganizations().current` | `null` ✔ |
| `activeOrganizationId(userId)` | **rend encore l'organisation quittée** ✘ |
| `dataOwnerOf(session)` | **`{kind:'organization', organizationId:<l'organisation quittée>}`** ✘ |

`findActiveOrganizationId` lit `organization_active_selection` **seule**, sans
jointure sur `organization_member`. La phrase écrite quatre fois dans le diff —
`packages/modules/organizations/src/schema.ts`, `packages/modules/organizations/AGENTS.md`,
`docs/research/s15-organizations.md` §3, message du commit — « l'appartenance
est relue à chaque requête, dans le prédicat de la lecture » est donc vraie des
trois routes du module et **fausse du chemin qui résout le propriétaire d'une
donnée**, c'est-à-dire du seul chemin que les stories suivantes emprunteront.

L'asymétrie est le symptôme : la même valeur est filtrée par l'appartenance
quand elle est **affichée** (`viewOrganizations` cherche l'active parmi les
appartenances) et non filtrée quand elle sert de **périmètre**.

## 6. « L'oubli du périmètre est impossible » : mesuré, et l'affirmation est trop large

Sonde : un fichier ajouté dans `infrastructure/` du module, qui lit
`organization` par un identifiant venu du corps de la requête, sans aucune
condition d'appartenance. `pnpm typecheck` (0), `eslint` sur le fichier (0),
`pnpm test` (811 verts). Rien ne l'arrête, rien ne le signale. Fichier supprimé,
arbre vérifié propre.

La marque de type protège les opérations **qui la déclarent** : sur les neuf
méthodes de `OrganizationRepository`, deux exigent un `OrganizationAccess`
(`renameOrganization`, `setActiveOrganization`) ; les sept autres —
`findMembership`, `listMemberships`, `createOrganization`,
`findActiveOrganizationId`, `deleteMembershipsOf`, `deleteOrganization`,
`listMembersOf` — prennent des chaînes nues. C'est défendable pour chacune
prise isolément ; ce qui ne l'est pas, c'est la formulation « la forme qui rend
l'oubli du périmètre organisationnel **impossible** plutôt que déconseillé »
(recherche §4.2, reprise par l'`AGENTS.md` du module). Elle est fausse pour une
lecture neuve, et c'est exactement le genre de phrase qui fait qu'un agent
suivant cesse de chercher (ADR 013).

## 7. Constats

### F1 — critique — le propriétaire résolu peut être une organisation qu'on a quittée

`dataOwnerOf(session)` rend un périmètre organisation sans vérifier
l'appartenance (§5). Aujourd'hui aucun chemin du produit ne l'exploite : aucune
story n'a encore de donnée rattachée à une organisation, et aucun retrait de
membre n'existe avant s16. Le défaut est donc **latent, pas exploitable dans ce
diff**. Il est classé critique parce que :

- c'est le critère central de la story (« toute donnée rattachée à une
  organisation n'est lisible que par ses membres ») et
  `docs/security.md` §3 nomme cette fonction unique ;
- l'invariant contraire est **écrit** à quatre endroits du diff, et s16 —
  dont un critère est « un membre retiré perd immédiatement l'accès » — le
  lira comme acquis ;
- le correctif est dans le périmètre de cette voie et tient en une jointure :
  `findActiveOrganizationId` doit lire la sélection **jointe** à
  `organization_member`, comme `viewOrganizations` le fait déjà en aval.

Conséquence à ne pas confondre avec la rotation : rotation et jointure ne
traitent pas le même problème, et la première reste sans objet (§5).

### F2 — majeur — un invariant présenté comme exécutable ne l'est pas

§6. Aucune commande n'échoue quand une lecture neuve oublie le périmètre. Soit
la garde devient exécutable (une règle de lint sur les lectures de `organization`
hors du prédicat conjoint, ou un port qui n'expose plus d'identifiant nu), soit
le texte de `packages/modules/organizations/AGENTS.md` et de la recherche est
ramené à ce qui est vrai : « les deux écritures existantes ne peuvent pas être
appelées sans autorisation ».

### F3 — majeur — le diff contredit l'ADR 004 sans ADR qui le supersède

`docs/decisions/004-better-auth.md` (accepté, cadrage) écrit noir sur blanc :
« Better Auth, avec ses plugins `organization`, `admin`, `two-factor` ». Le diff
écarte le plugin `organization`. **La mesure qui justifie l'écart est exacte** :
vérifiée dans le paquet installé, `better-auth@1.7.2`,
`dist/plugins/organization/organization.mjs` lignes 856-871, le plugin déclare
`schema.session.fields.activeOrganizationId` — donc une colonne sur
`auth_session`, table du module `auth`, qui survivrait à la coupure du module et
ferait tomber le critère « tables absentes d'une base vierge ». La décision est
bonne ; c'est sa **forme** qui manque. `AGENTS.md` : « Immutable : a change
means a new ADR superseding the old one ». Une déviation consignée dans la
recherche et le plan n'est pas un ADR, et cette décision engage s16, s17 et s23.

### F4 — mineur — `apps/web/AGENTS.md` nomme une fonction qui n'existe pas

Le nouveau paragraphe écrit « `currentOwner()` l'appelle ». La fonction livrée
est `dataOwnerOf(session)` ; `currentOwner` n'existe nulle part dans le code. Le
plan consigne le renommage (écart n°4) mais le document du package n'a pas
suivi. C'est une API inventée dans le fichier que le prochain agent lira en
premier.

### F5 — mineur — le garde-fou de prose est desserré globalement

`tests/rendered-text.test.ts` ajoute `role`, `create`, `switch` et `update` à
`TECHNICAL_PROPS`. La liste est **globale** : désormais, sur n'importe quel
écran du dépôt, une propriété nommée `role`, `create`, `switch` ou `update`
échappe au contrôle « aucun texte affiché ne vient d'ailleurs que des
catalogues ». `role` est justifié (il y a un vrai `role="alert"`) ; les trois
autres sont des noms très communs pour trois URL qui auraient pu s'appeler
`createAction`, `switchAction`, `updateAction` et ne rien desserrer.

### F6 — mineur — une vérification cochée dont il ne reste aucune trace

Les tâches 8 et 10 du plan annoncent « le rendu navigateur consigné » et « la
capture visuelle des deux thèmes et de 390 px ». `docs/designs/s15-organizations.md`
ne porte ni capture, ni tableau de mesure, et le diff n'en contient aucune. La
case est cochée ; la revue ne peut ni la confirmer ni l'infirmer.

### F7 — mineur — le sélecteur peut afficher « Aucune organisation » comme organisation courante

Quand un compte a des appartenances mais aucune sélection active valide,
`OrganizationsScreen` passe `intl.t(K.emptyTitle)` en libellé **courant** du
`OrgSwitcher`. Aucun chemin actuel n'y mène (la création pose toujours l'active),
mais c'est précisément l'état d'un membre retiré (F1) ou d'un compte invité (s16).

## 8. Ce qui a été instruit et n'est pas un constat

- **404 contre 403, et l'inexistant** — statut et corps identiques (test
  existant), et **temps** mesuré ici, 40 tirages par cas : médiane 0,70 ms pour
  « existe mais je n'en suis pas membre », 0,62 ms pour « n'existe pas ». Même
  ordre de grandeur, et pour une raison structurelle : c'est le **même** ordre
  SQL unique dans les deux cas.
- **`apps/web/lib/module-services.ts`**, pièce hors plan — justifiée et
  couverte. Le répartiteur monte les routes mais ne construit rien ; sans elle
  la première soumission répond 500. Elle dit *comment* construire sans
  construire, ce qui préserve le 404 sans base (`tests/organizations.test.ts`,
  cas « une requête qu'aucune route ne sert »). M7 montre que la retirer ne fait
  rougir aucun test de nœud mais **fait rougir deux parcours Playwright**, et la
  CI exécute `pnpm test:e2e` : la règle a bien une commande. À surveiller, sans
  en faire un constat : rien n'oblige le prochain module persistant à s'y
  déclarer.
- **`tests/module-migrations.test.ts`** — le fichier n'est pas touché par la
  story. Sa remise à zéro ne porte que sur `demo_items`, `demo_notes` et les
  journaux des **deux modules de démonstration** (`availableForTests` vaut
  `[demoEnabledModule, demoDisabledModule]`) : le journal d'`organizations` n'est
  jamais touché. Bruit de recette antérieur, hors périmètre. Effet de bord réel
  et connu : après `pnpm test`, la base partagée n'a plus `demo_items` jusqu'au
  prochain `pnpm db:migrate`.
- **Deux onglets, deux organisations** — la sélection a le **compte** pour clé
  primaire (`setActiveOrganization` fait `onConflictDoUpdate` sur `user_id`) :
  il n'y a qu'une organisation active par compte, dernière bascule gagnante, et
  les deux onglets convergent à la requête suivante. Aucune fuite entre
  locataires — les deux organisations sont les siennes. Conséquence à connaître
  pour la suite : une écriture qui dérivera son propriétaire de `dataOwnerOf`
  pourra atterrir dans l'organisation basculée dans l'**autre** onglet. C'est le
  prix de la persistance « entre deux sessions » exigée par le critère 2 ; il
  n'est écrit nulle part.
- **Contrat, couches, ADR 018/020/024** — quatorze clés, `requires: ['auth']`,
  deux points d'entrée (`.` et `./presentation`), aucun import de `@repo/db`,
  clés étrangères vers `auth_user` permises par le requis déclaré. Tous les
  imports et symboles du diff ont été ouverts et vérifiés dans leur fichier
  cible (`@repo/core` : `defineModule`, `dispatchModuleRequest`, `buildRegistry`,
  `qualifyMessageKey`, `MODULE_ROUTE_PREFIX`, `ModuleScope`, `ModuleSession` —
  tous présents dans `packages/core/src/index.ts`).
- **Purge et export** — rejoués deux fois dans la suite, un seul effet ; la
  cascade porte l'ordre inverse du graphe que l'ADR 018 signale.

## 9. Ce que la fusion exposera

`dev` a reçu s12 (OAuth) depuis `df3bb2f`. Deux points concrets :

1. **`apps/web/app/oauth/` existe sur `dev`** et `oauth` n'est pas dans
   `APPLICATION_SEGMENTS`. Après fusion, le cas dérivé de
   `tests/organizations.test.ts` (« réserve « oauth », que l'application sert
   déjà ») **rougira** — la garde fait son travail —, et tant qu'il n'est pas
   corrigé une organisation pourrait s'appeler `oauth`. À traiter à la fusion,
   pas ici.
2. **`apps/web/AGENTS.md` est modifié des deux côtés**, dans le même paragraphe
   d'imports autorisés : conflit textuel certain.

Fichiers chauds également touchés des deux côtés à surveiller : `package.json`
racine, `generated/schema/index.ts`, `config/features.ts` (s15 seul), `eslint.config.ts`
et `packages/config/src/index.ts` (s12 seul).

## 10. Non vérifié

Dit plutôt que sous-entendu :

- **Le rendu visuel de l'écran.** Aucune capture n'a été prise dans cette revue,
  et il n'en existe aucune dans le dépôt (F6). Les parcours Playwright prouvent
  que les formulaires, la bascule et le refus fonctionnent ; ils ne prouvent
  rien du thème sombre, du 390 px, ni du contraste. **Geste humain attendu** :
  ouvrir `/organizations` en clair et en sombre, à 1280 px et à 390 px, avec
  zéro, une et trois organisations.
- **Le clavier et l'aide technique.** Le menu `OrgSwitcher` a un nom accessible
  et ses options sont des boutons de soumission, vérifié dans le code ; la
  navigation au clavier dans le menu Radix portalisé, et l'annonce du
  changement, n'ont pas été éprouvées. **Geste humain attendu** : parcourir
  l'écran au clavier seul.
- **Le comportement sans JavaScript.** Les deux formulaires sont natifs, mais
  le sélecteur de bascule exige React (le parcours l'admet et le contourne par
  `toPass`). Aucun test ne mesure ce que voit un utilisateur sans JavaScript :
  il aura une liste d'organisations sans moyen de basculer.
- **La concurrence réelle.** L'unicité du slug est portée par la base, ce qui
  est le bon choix, mais deux créations simultanées n'ont pas été jouées.
- **La CI GitHub Actions.** Tout a été exécuté localement, sur macOS et
  Postgres 16 en conteneur ; rien n'a tourné sur un runner.
- **Le module `organizations` avec `i18n` coupé** — configuration non essayée.
- **`pnpm dev`** — l'application n'a été démarrée que par Playwright.

## 11. Restauration

Sept mutations et deux sondes, toutes défaites dans la commande qui les a
posées ; `git diff --exit-code` propre après chacune, et avant la rédaction de
ce rapport. Deux bases jetables créées pour la revue (`s15_review`, `s15_off`) —
elles ne sont utilisées par aucune voie. Une ligne résiduelle laissée dans la
base `s15` par la mutation M3 (une organisation d'identifiant `account`,
créée parce que la règle était neutralisée) a été **retirée**, et l'absence
revérifiée.

---

# Clôture — tour de correction, commit `fa6adf5`

Sept constats, sept fermetures, constat par constat. Chaque correction a été
écrite test d'abord, chaque mutation a été **restaurée dans la commande qui l'a
posée**, et `git diff --stat` vérifié après chacune.

## Constat par constat

### F1 — critique — fermé

`activeOrganizationIdOf` (`infrastructure/scoped-reads.ts`) joint la sélection
courante à `organization_member` sur **le compte**. La ligne de sélection n'est
pas nettoyée : c'est la lecture qui porte l'appartenance, comme les trois routes
du module.

Cas ajouté à `tests/organizations.test.ts` — « cesse de résoudre vers une
organisation qu'on a quittée » : un fondateur, un second membre posé comme s16
le posera, la bascule du second, puis le retrait de **sa seule** appartenance.
La sélection est toujours en base (assertion explicite), `activeOrganizationId`
rend `null`, `dataOwnerOf` retombe sur `{kind:'user'}`, et le fondateur, lui,
résout toujours.

Le premier jet de ce test était **trop étroit** et a été corrigé avant d'être
gardé : il supprimait le seul membre, si bien qu'une jointure sur la seule
organisation restait verte. Le second membre est ce qui fait mordre.

### F2 — majeur — fermé, et la limite est écrite

Les lectures du module vivent dans `infrastructure/scoped-reads.ts`, **seul
fichier où `select`, `from` et `execute` sont permis** — `eslint.config.ts`,
bloc `organizationPerimeter`. Chacune des quatre lectures prend le propriétaire
en premier paramètre. Le fichier des repositories ne lit plus rien : il délègue.

Preuve directe, celle que la revue demandait : **la sonde du relecteur,
réintroduite telle quelle** dans `infrastructure/`, fait échouer `pnpm lint` —
2 erreurs, message « Périmètre organisationnel (revue s15, F2) ». Sonde
supprimée, arbre vérifié propre.

Ce que la garde **ne** tient pas, écrit dans le fichier, dans l'`AGENTS.md` du
module et dans `eslint.config.ts` : elle ne lit pas le SQL (le prédicat de
compte est éprouvé par mutation, pas par le lint), elle ne voit pas un appel
dont le nom de méthode est masqué (`const { select } = db`), et sa portée est
**ce module**. Elle borne la surface à relire à un fichier ; elle ne remplace
pas la relecture.

Les quatre endroits qui affirmaient trop sont corrigés là où ils étaient écrits :
`organization-access.ts`, `schema.ts`, `packages/modules/organizations/AGENTS.md`,
et la recherche (§3 et §4, par des encadrés « corrigé après la revue » plutôt
que par une réécriture silencieuse). Le message du commit d'origine ne peut pas
être réécrit ; celui de `fa6adf5` porte le démenti.

### F3 — majeur — fermé

`docs/decisions/025-organisation-active-hors-plugin-better-auth.md`, format
MADR, cinq options rejetées avec leur raison (le plugin tel quel, le plugin avec
sa colonne déplacée, un cookie signé, l'organisation dans l'URL, un plugin
maison). L'ADR 004 porte désormais
« Status: accepted — l'emploi du plugin `organization` est supersédé par
l'ADR 025 » : sa décision sur Better Auth comme socle, et sur ses trois autres
plugins, n'est pas touchée. Numéro 025 vérifié libre sur **toutes** les
branches locales (`git ls-tree` sur les huit).

### F4 — mineur — fermé

`apps/web/AGENTS.md` nomme `dataOwnerOf(session)`, dit d'où elle vient, pourquoi
elle reçoit la session au lieu de la lire, et ce qu'elle rend après un retrait
de membre.

### F5 — mineur — fermé

`create`, `switch` et `update` sortent de `TECHNICAL_PROPS`. `AcceptanceRules`
gagne `screenProps`, alimenté par un champ `technicalProps` **de l'entrée
d'écran** : l'écran des organisations déclare les siens, aucun autre écran n'en
hérite. `role` reste global — c'est un attribut HTML réel, et la revue le jugeait
justifié.

### F6 — mineur — fermé

`docs/designs/s15-organizations.md` porte deux sections neuves : « Vérification
visuelle — mesurée, pas déclarée » (neuf cas, débordement horizontal et thème
appliqué relevés) et « Le clavier seul, sur le menu portalisé ». Les images ne
sont pas versionnées, les **nombres** le sont, et la sonde qui les produit est
décrite. Non vérifié, dit : aucun lecteur d'écran réel, aucun calcul de
contraste, un seul moteur.

### F7 — mineur — fermé

Clé `current.none` (« Choisir une organisation » / « Choose an organization »),
posée en libellé du déclencheur quand aucune sélection n'est courante alors que
le compte a des appartenances. L'état vide reste l'état vide.

## Les trois arbitrages

1. **F3** — ADR rédigé (ci-dessus).
2. **Sélection active par compte** — la conséquence est écrite, aux deux
   endroits demandés : ADR 025 (« À surveiller — la conséquence de la sélection
   par compte ») et `packages/modules/organizations/AGENTS.md` (« Seconde
   conséquence, celle qui piège la story suivante »). Formulée en consigne pour
   la story suivante : une écriture depuis un écran confirme le périmètre
   qu'elle a **affiché**.
3. **JavaScript** — la bascule fonctionne désormais sans script. Le repli est un
   `<noscript>` **dans le `<form method="post">` déjà présent** : les mêmes
   options en boutons de soumission natifs, l'organisation courante exclue
   (deux boutons du même nom seraient indiscernables — mesuré, Playwright a
   refusé la première version en « strict mode violation »). Aucun composant,
   aucun jeton, rien d'inline — la CSP interdit `unsafe-inline`, donc pas de
   `<style>` masquant le déclencheur ; conséquence assumée et écrite : sans
   script, le déclencheur reste visible et inerte à côté du repli.

## Les mutations de ce tour, et le rouge de chacune

| # | Ce qui est neutralisé | Rouges |
|---|---|---|
| M-F1a | la jointure de `activeOrganizationIdOf` est retirée | **1** |
| M-F1b | la jointure reste, mais perd `organizationMember.userId = selection.userId` | **1** — verte avant que le test ne soit renforcé, c'est ce qui l'a fait renforcer |
| M-F2a | le bloc `organizationPerimeter` est retiré de la configuration ESLint | **4** |
| M-F2b | la reprise des sélecteurs du bloc précédent est retirée (piège de la configuration plate) | **2** |
| M-F2c | *pas une mutation, une preuve directe* : la sonde du relecteur réintroduite | `pnpm lint` échoue, 2 erreurs |
| M-F5a | l'exception `technicalProps` de l'écran des organisations est retirée | **1** (3 offenders nommés) |
| M-F5b | la même exception est déclarée sur **un autre** écran | **1** |
| M-F7 | le déclencheur reprend `emptyTitle` | **1** |
| M-JS | *l'ordre TDD tient lieu de mutation* : le parcours `javaScriptEnabled: false` a été écrit et **vu rouge** avant le `<noscript>` | **1** parcours |

## Commandes, ce tour

| Commande | `organizations` activé | `organizations` coupé |
|---|---|---|
| `pnpm typecheck` | 0 | 0 |
| `pnpm lint --max-warnings=0` | 0 | 0 |
| `pnpm test` | 822 passés, 2 ignorés, 30 fichiers | 822 passés, 2 ignorés |
| `pnpm test:e2e` (`E2E_PORT=3115`) | 37 passés, 3 ignorés | 35 passés, 5 ignorés |
| `pnpm build` | 0 | 0 |
| `pnpm run audit` | 0 (« 1 avis, aucun au seuil élevé qui ne soit couvert ») | — |
| `pnpm db:migrate` ×2 | « Rien à appliquer » au second passage | — |

Après l'aller-retour `pnpm ks toggle organizations`, `config/features.ts` et
`generated/` reviennent **à l'identique** (`git diff --stat` vide sur ces
chemins), et aucune migration supplémentaire n'est produite.

## Ce que ce tour n'a pas vérifié

Dit plutôt que sous-entendu, et ce n'est pas la liste de ce qui existe :

- **la CI GitHub Actions** — tout a tourné localement, macOS, Postgres 16 en
  conteneur ;
- **un lecteur d'écran réel** — le clavier est mesuré, l'annonce du changement
  d'organisation après navigation ne l'est pas ;
- **le contraste** — aucune valeur calculée ; seuls le thème appliqué et
  l'absence de débordement sont mesurés ;
- **un second moteur** — Chromium seul ;
- **la concurrence réelle** sur la création d'un même identifiant — inchangé
  depuis le premier tour ;
- **le module `organizations` avec `i18n` coupé** — configuration non essayée ;
- **les points §9 du rapport d'origine** (ce que la fusion exposera : `oauth`
  absent de `APPLICATION_SEGMENTS`, conflit textuel sur `apps/web/AGENTS.md`) —
  ils restent entiers, ils se traitent à la fusion.

Max severity: none
Ship allowed: yes
