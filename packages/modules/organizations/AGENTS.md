# packages/modules/organizations — règles locales

La multi-tenance : créer une organisation, basculer entre les siennes, en
modifier le nom et l'identifiant (s15) ; puis y **inviter** quelqu'un, accepter,
révoquer, renvoyer, et **retirer** un membre (s16) ; puis décider **qui a le
droit de quoi** — la matrice des rôles, le changement de rôle et le transfert de
propriété (s17). **C'est le module qui décide de la forme du périmètre
organisationnel pour tout le reste du produit** — une frontière molle ici devient
une fuite de données quinze stories plus loin.

Module **optionnel**. Coupé, l'application est mono-utilisateur : aucune route,
aucune entrée de navigation, aucune des **quatre** tables sur une base vierge, et
toute donnée est rattachée au compte par la même fonction que lorsqu'il est
activé (`resolveDataOwner`, `@repo/core`).

## Les invariants, et la commande qui tient chacun

Ce qui a été éprouvé jusqu'ici — pas « tous ceux qui existent ». **Le tableau
est la liste** : un compte écrit à côté de lui vieillit à la ligne suivante, et
celui qui était ici annonçait « Dix-huit » pour vingt lignes (revue de s17, F2).
Un décompte se lit, il ne s'écrit pas.

| Invariant | Comment il est tenu | Ce qui échoue si on le casse |
|---|---|---|
| L'organisation d'un autre répond **404, jamais 403** | `findMembership` porte les deux conditions dans **un seul** ordre ; `null` ne distingue pas « pas membre » de « n'existe pas » | `tests/organizations.test.ts` — le cas rougit à 403 comme à 200 |
| **Un membre dont le rôle ne suffit pas reçoit 403**, et un non-membre toujours 404 | l'ordre est **autorisation, permission, puis validation** — `accessFrom`, `allows`, et seulement ensuite Zod : aux six portes, sans exception (revue de s17, F5) | `tests/organizations.test.ts` — « rend 403 à un membre de l'organisation, et 404 à qui n'en est pas », et « refuse le droit avant de juger le corps, et journalise ce refus-là aussi » : ce dernier rougit dès que la validation repasse devant |
| **Chaque rôle × chaque action sensible est décidé une fois**, dans le `domain` | `domain/permissions.ts` : `ORGANIZATION_ACTIONS` et `MATRIX`. Les six portes appellent `allows(access.role, …)` juste après l'autorisation | `organization-rules.test.ts` — la matrice complète (3 × 6) ; **et** un témoin de refus par porte dans `tests/organizations.test.ts`, chacun rougissant si sa garde saute |
| **Un `admin` ne retire qu'un `member`** : ni un `owner`, ni un autre `admin` | la borne est **dans le prédicat du `delete`** (`unremovableRolesFor`, passé au repository), pas dans une lecture préalable | `tests/organizations.test.ts` — « refuse à un administrateur de retirer un propriétaire ou un autre administrateur », sur une organisation à **deux** propriétaires : avec un seul, la règle du dernier propriétaire attrapait le cas à la place et la mutation restait verte ; **et** `organization-rules.test.ts` à la règle |
| **Un rôle hors matrice ne permet rien** — il est refusé, pas levé | `allows` replie sur `MATRIX[role] ?? []`. La colonne `role` est un `text not null` **sans contrainte de valeur** : une ligne inconnue est représentable, et le rôle est relu en base à chaque requête | `organization-rules.test.ts` — « refuse un rôle que la matrice ne connaît pas, au lieu de lever » ; `tests/organizations.test.ts` le mesure jusqu'à la route (403, pas 500) |
| **Les affordances de l'écran sont dérivées du rôle de l'appelant, par le serveur** | `viewOrganizations` calcule `permissions` et `assignableRoles` avec les fonctions du `domain`, à partir du rôle porté par l'`OrganizationAccess` | `tests/organizations.test.ts` — « dérive les droits et les rôles offerts du rôle de l'appelant, pour chacun des trois ». Le cas de rendu, lui, les reçoit en paramètres : il éprouve le `.tsx`, jamais le calcul — mesuré, les mettre en dur laissait 1086 cas et 58 parcours au vert (revue de s17, F1) |
| **La matrice ne se compare qu'à un endroit** | `pnpm lint` refuse une comparaison de rôle à un littéral partout dans le module, sauf dans `domain/permissions.ts`. La notion « ce rôle donne la propriété » y est une fonction nommée, `grantsOwnership` | `pnpm lint`, et `tests/lint-rules.test.ts` — quatre emplacements refusés, le fichier qui décide permis. La règle ne voit ni `switch`, ni `includes`, ni comparaison à une variable |
| **Nommer quelqu'un d'autre `owner` est le transfert** : l'ancien devient `admin` | les deux lignes changent dans la **même** transaction, sous le même verrou | `tests/organizations.test.ts` — « transfère la propriété : l'ancien propriétaire devient administrateur » |
| **Une rétrogradation ne retire pas le dernier propriétaire**, y compris sous concurrence | même discipline que le retrait : `pg_advisory_xact_lock` sur la **même** clé, puis un prédicat qui compte les propriétaires dans la même instruction | `tests/organizations.test.ts` — « refuse de rétrograder le dernier propriétaire » **et** « garde un propriétaire quand deux rétrogradations partent ensemble » : dix courses, **9 puis 10 rouges sur 10** sans le verrou |
| **Le pouvoir suit la ligne, pas le jeton de session** | le rôle vient de l'`OrganizationAccess`, relu à chaque requête par `membershipOf` ; rien ne le met en cache | `tests/organizations.test.ts` — « change le pouvoir à l'instant, sur la même session, sans reconnexion ». Mettre `findMembership` en cache fait rougir ce cas et celui du transfert (ADR 030) |
| **Un changement de rôle est journalisé**, avec son acteur — le refus de droit compris | port `SecurityLog`, forme **fermée** (`domain/security-event.ts`) : chaque champ y est nommé, aucun champ libre, et l'interface est la liste. La cible et le rôle passent par Zod ; au refus, ils valent `null` quand le corps n'en nommait pas | `tests/organizations.test.ts` — « journalise le changement de rôle et son refus, avec leur acteur » et « refuse le droit avant de juger le corps, et journalise ce refus-là aussi » |
| **Un membre retiré cesse aussitôt de résoudre vers l'organisation quittée** | `activeOrganizationIdOf` joint la sélection courante à `organization_member` sur le **compte** ; la ligne de sélection n'est jamais nettoyée, c'est la lecture qui filtre | `tests/organizations.test.ts` — « cesse de résoudre vers une organisation qu'on a quittée » rougit dès que la jointure perd le compte |
| **Une lecture du module passe par sa porte unique** | `infrastructure/scoped-reads.ts` est le seul fichier où `select`, `from` et `execute` sont permis ; chacune de ses fonctions prend le propriétaire en **premier paramètre** | `pnpm lint` — une lecture écrite ailleurs dans le module est refusée, et `tests/lint-rules.test.ts` rejoue la sonde qui l'a prouvé |
| Une écriture ne reçoit **jamais** un identifiant d'organisation nu | `OrganizationAccess` porte une marque de type non exportée ; seul `authorizeOrganization` en produit | `pnpm typecheck` — la fixture `tests/fixtures/typing/forged-organization-access.ts` **doit** échouer, et `tests/module-registry.test.ts` lit le diagnostic |
| Les identifiants **réservés** suivent les écrans réellement servis | la liste est **reçue**, dérivée par `apps/web/lib/organizations.ts` | `tests/organizations.test.ts` — chaque segment de premier niveau de `apps/web/app` doit être refusé |
| **Le jeton d'invitation ne se retrouve pas en base** | `infrastructure/invitation-tokens.ts` : 32 octets tirés du générateur du système, **empreinte SHA-256** stockée. Le secret ne vit que dans le lien | `tests/organizations.test.ts` — « la base ne garde que l'empreinte » : le jeton du lien est cherché en clair (0 ligne), son empreinte est cherchée (1 ligne) |
| **Une invitation ne se consomme qu'une fois** | un **seul ordre conditionnel** — empreinte, adresse du destinataire, ni acceptée ni révoquée ni échue — puis l'appartenance en `onConflictDoNothing` sur `organization_member_unique` | `tests/organizations.test.ts` — « se rejoue sans créer une seconde appartenance » |
| **Le lien n'est pas transférable** | l'adresse du destinataire est **dans le prédicat** de la consommation ; le compte connecté est comparé sous sa forme normalisée | `tests/organizations.test.ts` — « refuse un lien émis pour une autre adresse » |
| **Une organisation garde au moins un propriétaire**, y compris sous concurrence | le **prédicat du `delete`** refuse, et un **verrou consultatif porté par la transaction** (`infrastructure/transaction-locks.ts`) sérialise les retraits de la même organisation : le second réévalue son prédicat sur l'état commis par le premier. La règle pure ne fait que nommer le refus | `tests/organizations.test.ts` — « refuse de retirer le dernier propriétaire » (retirer la sous-requête fait rougir) **et** « garde un propriétaire quand deux retraits partent ensemble, à chaque course » : dix courses, neuf rouges sans le verrou |
| **Le quota d'émission compte le renvoi**, sur une fenêtre glissante | une émission = **une ligne** : le renvoi éteint la précédente et en écrit une neuve, datée de l'horloge du module ; les deux portes passent par la même fonction de quota | `tests/organizations.test.ts` — « compte le renvoi dans le quota d'émission » et « rouvre le quota une fois la fenêtre passée » |
| **Le renvoi et le retrait n'agissent que dans l'organisation autorisée** | `organization_id` est dans le prédicat des deux écritures, comme pour la révocation | `tests/organizations.test.ts` — « refuse de renvoyer l'invitation d'une autre organisation » et « refuse de retirer un membre d'une autre organisation » |
| **L'adresse invitée s'efface avec le compte qui la porte** | `purge({kind:'user'})` lit l'adresse sur le compte, puis efface les invitations qui la portent, dans toutes les organisations ; la catégorie `invitation` est déclarée et sa rétention est `erase` | `tests/organizations.test.ts` — « efface l'adresse invitée avec le compte qui la porte » |
| **Aucun `GET` ne consomme un jeton** | la route d'acceptation est un `POST` ; l'écran d'atterrissage rend un `<form method="post">` | `tests/organizations.test.ts` — un `GET` sur le chemin d'acceptation répond 404 et l'invitation reste en attente |
| **Un changement de taille passe chez l'extérieur avant d'être validé — sur les deux écritures où ce l'est jusqu'ici** | `consumeInvitation` et `removeMember` comptent les membres **dans leur transaction**, appellent le `SeatSync` injecté, et lèvent `SeatSyncRefusedError` — donc annulent — sur un refus (s23, ADR 046). Le module ignore qu'il existe une facturation : le couplage est au point de composition. **Aucun nombre écrit ici, la liste est le compte** : la phrase disait « les quatre écritures du module », et il y en a cinq — elle oubliait celle du fondateur. **Balayées, les écritures du module qui changent le nombre de lignes de `organization_member` : `createOrganization`, `consumeInvitation`, `removeMember`, `deleteMembershipsOf`, `deleteOrganization`.** Les deux du milieu synchronisent. `createOrganization` insère le fondateur et **ne synchronise rien** : l'organisation naît dans cette transaction, elle n'a donc pas encore de client de facturation d'où tirer une offre — aucun plafond ne peut y mordre. `deleteMembershipsOf(userId)` — le retrait d'une personne de **toutes** ses organisations, atteint par `purge({kind:'user'})` — ne synchronise rien non plus, et `deleteOrganization` non plus (l'organisation entière disparaît, ses appartenances par cascade). Le premier des deux est le piège de la story qui supprimera un compte (s34) : aujourd'hui aucun défaut n'est expédié — `purgeModules` (`@repo/core`) n'a **aucun appelant hors des tests** —, mais qui câblera la suppression de compte sans l'accrocher laissera un siège facturé jusqu'à `pnpm billing:reconcile` | `tests/billing.test.ts` — « n'ajoute pas le membre quand le fournisseur refuse » et « ne retire pas le membre quand le fournisseur refuse le retrait » : **2 rouges** quand le refus cesse d'annuler. **Rien ne mesure les trois autres sites** — `createOrganization` n'a rien à synchroniser, et les deux autres n'ont rien à mesurer tant que personne ne les appelle |
| **Une invitation en attente n'occupe aucun siège** | `countMembersOf` compte `organization_member`, et rien d'autre ; les invitations vivent dans une autre table | `tests/billing.test.ts` — « ne facture pas l'invitation qui reste en attente » : **3 rouges** quand le comptage y ajoute les invitations vivantes |
| **Un refus de l'extérieur porte son motif, et seul un ajout peut être plafonné** (s47) | `SeatSync` rend un résultat discriminé — `{ok:true}` ou `{ok:false, refusal}` — et reçoit `adds` ; `consumeInvitation` passe `true`, `removeMember` passe `false`. Le cas d'usage **rapporte** le motif reçu, il n'en choisit aucun : replier les deux sur un seul enverrait l'invité réessayer indéfiniment une opération qui ne changera pas d'avis. Un plafond opposé à un retrait enfermerait une organisation au-dessus d'un plafond abaissé | `tests/billing.test.ts` — « n'expulse personne quand le plafond passe sous l'effectif, et laisse retirer » : **1 rouge** quand le retrait passe `adds: true`, **1 rouge** quand le plafond ignore `adds` (les deux re-mesurés). Replier le plafond sur `seat_sync_unavailable` dans `apps/web/lib/seat-sync.ts` : **3 rouges** et non deux — « accepte l'invitation qui atteint le plafond et refuse la suivante », « n'expulse personne quand le plafond passe sous l'effectif, et laisse retirer » et « annule l'écriture sous un motif distinct quand le plafond est atteint ». Le deuxième manquait au compte écrit par s47 |

**Ce que la porte de lecture ne tient pas**, et il faut le lire avant de s'y
fier : la règle de lint ne lit pas le SQL. À l'intérieur de `scoped-reads.ts`,
rien n'oblige un prédicat à porter le compte — ce sont les mutations de
`tests/organizations.test.ts` qui l'éprouvent. **Éprouvés jusqu'ici, sur ces
sept prédicats** : `membershipOf`, `activeOrganizationIdOf`,
`memberIdentitiesOf`, `liveInvitationsOf`, `invitationsIssuedSince` (le
périmètre et la fenêtre), `invitationByDigest`, plus ceux du renvoi et du
retrait par leurs écritures ; `membershipsOf`, `membersOf` et
`invitationsAddressedTo` ne le sont pas. `countMembersOf` (s23) n'est pas un
prédicat de propriété mais un **comptage** : il ne sert aucune donnée à un
appelant, il produit la quantité facturée, et ce que sa mutation doit faire
rougir est dans `tests/billing.test.ts`. Et un appel dont le nom de méthode
n'est pas visible à la syntaxe (`const { select } = db`) échappe au sélecteur.
La garde **borne la surface à relire à un fichier** ; elle ne remplace pas la
relecture.

**La porte s'est élargie d'un cran, et d'un seul** (revue de s16, F1) :
`infrastructure/transaction-locks.ts` peut appeler `execute`, pour prendre un
`pg_advisory_xact_lock` — un verrou qui ne lit aucune table et tombe avec la
transaction. `select` et `from` y restent refusés, et `execute` reste refusé
partout ailleurs dans le module ; `tests/lint-rules.test.ts` éprouve les trois.
L'argument « la porte de lecture refuse un verrou » qui avait servi à laisser la
course ouverte ne tient donc plus : une contrainte que le module s'est donnée à
lui-même ne prime pas sur un critère d'acceptation.

La formulation d'origine de cette story — « la forme qui rend l'oubli du
périmètre organisationnel **impossible** » — était fausse, et la revue l'a
mesurée : un fichier neuf lisant `organization` par un identifiant du corps de
la requête passait `typecheck`, `lint` et 811 tests. C'est le genre de phrase
qui fait qu'un agent suivant cesse de chercher (ADR 013). Ce tableau dit ce que
chaque commande refuse, et rien de plus.

## Ce qu'une écriture d'appartenance tient ouvert (s23, ADR 046)

L'ADR accepte qu'« une transaction reste ouverte le temps d'un aller-retour
HTTP ». Ce que le code livré tient est **plus cher que cette phrase**, et le
prix est écrit ici parce qu'un ADR est immuable :

- **deux** allers-retours, pas un : `updateSubscriptionQuantity`
  (`@repo/adapter-stripe`) relit l'abonnement — la quantité vit sur sa **ligne**,
  dont l'identifiant n'est connu que par lecture — puis l'écrit. Chacun a son
  propre budget de reprise (`apps/web/lib/billing.ts` : deux essais de 4 s,
  séparés d'un recul d'au plus 300 ms), soit **~8,3 s par appel et ~16,6 s pour
  les deux**, transaction ouverte pendant tout ce temps ;
- une **seconde connexion du même pool** : la synchronisation lit le client et
  ses abonnements (`customerForScope`, `subscriptionsOfCustomer`) sur une autre
  connexion pendant que la transaction en retient une. Le pool de
  `packages/db/src/client.ts` vaut `max: 10` et `connectionTimeoutMillis: 5_000`
  — la concurrence utile des écritures d'appartenance tombe donc à **cinq**, la
  sixième attend 5 s puis échoue ;
- sur le **retrait** seulement, le verrou consultatif de l'organisation
  (`lockOrganizationMembership`) est tenu pendant toute cette attente : les
  retraits et rétrogradations de la **même** organisation se mettent en file
  derrière. L'acceptation d'invitation, elle, ne prend pas ce verrou.

Le pire cas dépasse donc les **dix secondes d'une fonction serverless** que
`apps/web/lib/billing.ts` invoque précisément pour dimensionner son budget. Le
mode de défaillance reste sain — l'épuisement du pool lève une exception qui
n'est **pas** un `SeatSyncRefusedError` : elle remonte et annule, rien n'est
corrompu et personne n'est surfacturé — mais c'est une dégradation réelle, et
elle est **raisonnée, pas observée** : personne n'a encore lancé une douzaine
d'acceptations simultanées contre un fournisseur lent.

## Une session n'est pas une limite (s28, ADR 050)

L'invitation et sa relance sont **authentifiées** et pourtant limitées en débit :
elles déclarent un `rateLimit` au contrat, ce que le répartiteur applique. Un
compte légitime suffit sinon à arroser mille adresses d'emails d'invitation, et
la protection par défaut du répartiteur ne couvre que les routes **publiques**.

L'invitation porte en plus un seau **par compte visé** (`subjectField: 'email'`),
qui borne ce qu'une même adresse peut recevoir toutes organisations confondues.
Les seuils sont dans `config/security.ts` (politique `invitation`), jamais ici.

## Deux choses qui ressemblent à des bugs et n'en sont pas

**Un `member` peut quitter l'organisation**, alors que le critère 2 dit qu'il ne
peut pas « retirer un membre ». Se retirer soi-même n'est pas une action
d'administration : c'est le geste de la personne sur sa propre appartenance, et
sans lui un membre serait captif de l'organisation qui l'a invité. La règle est
explicite et vient **en premier** dans `removalPermission` et dans
`unremovableRolesFor` ; la règle du dernier propriétaire, elle, continue de
s'appliquer — un propriétaire unique ne part pas. Arbitrage validé à la revue de
s17 ; le cas est « laisse un simple membre quitter l'organisation ».

**Une organisation sans propriétaire est ingouvernable, et rien ici ne la
répare.** `member.set_role` est réservé au propriétaire : sans propriétaire,
personne ne peut en nommer un, et l'organisation est figée à vie. L'état est
**inatteignable par les routes** — le prédicat de l'`update` et celui du
`delete` comptent les propriétaires sous le même verrou, et trois croisements de
concurrence ont été sondés à la revue.

Il reste **productible par la base**, et c'est le piège de la story qui
supprimera un compte (s34) : `organization_member.user_id` référence
`auth_user.id` en `onDelete: 'cascade'`
(`src/schema.ts:62-64`). Effacer le compte du dernier propriétaire efface sa
ligne d'appartenance sans que rien ne compte les propriétaires restants —
l'organisation survit, ses membres aussi, et plus personne ne peut nommer un
rôle, renommer, inviter, révoquer ni retirer. `docs/reliability.md` §5 demande
une **commande de réconciliation** pour tout état qui peut diverger : elle
appartient à s34, avec sa suppression, et pas à s17. La nommer ici est le seul
moyen que l'agent de s34 la trouve **avant** d'écrire sa purge, et non après.

## Ce que Better Auth aurait fait, et pourquoi ce n'est pas fait

Son plugin `organization` ajoute `activeOrganizationId` à la table `session`
(`node_modules/better-auth/dist/plugins/organization/organization.mjs`,
l. 856-871), c'est-à-dire à `auth_session`, qui appartient au module `auth`. La
colonne survivrait à la coupure du module — exactement le comportement MakerKit
que la story nomme comme « à ne pas reproduire » — et
`packages/db/src/references.ts` refuse déjà qu'une table appartienne à deux
modules. L'organisation active est donc **une table à nous**
(`organization_active_selection`), et le cookie de session n'en sait rien.

La décision est consignée dans **l'ADR 025**, qui supersède l'ADR 004 sur ce
seul point : 004 (accepté, cadrage) imposait le plugin, et un changement de
décision s'écrit dans un ADR superséquent, jamais en place.

**s16 n'a pas changé cette décision, et elle a été réattaquée.** Accepter une
invitation ajoute un droit, donc c'est une élévation de privilège au sens
courant ; `docs/security.md` §2 n'énumère pourtant que trois cas de rotation
(connexion, second facteur, fin d'impersonation), et la ligne
`organization_member` est relue à **chaque** requête. Faire tourner
l'identifiant de session ne retirerait ni n'ajouterait aucun droit ; la preuve
opposable est la réciproque, et elle est mesurée : *la même session perd l'accès
à l'instant où la ligne disparaît* (`tests/organizations.test.ts`, « fait perdre
l'accès immédiatement, à la **même** session »). L'ADR 026 porte la décision et
les options rejetées, dont celle qui aurait demandé un point d'entrée dans le
module `auth` — point d'entrée qui n'existe pas.

Conséquence à connaître, écrite plutôt que sous-entendue : **le jeton de session
ne porte aucune autorité organisationnelle.** L'appartenance est relue à chaque
requête, dans le prédicat de la lecture — **les trois routes du module comme le
chemin qui résout le propriétaire d'une donnée**. La revue de s15 avait relevé
que ce second chemin, lui, ne la relisait pas : `findActiveOrganizationId` lisait
`organization_active_selection` seule. C'est corrigé, et la jointure est
éprouvée par mutation. Le jeu de droits attaché à un identifiant de session est
donc identique avant et après une bascule ; la rotation d'identifiant que
`docs/security.md` §2 impose à l'élévation de privilège n'a pas d'objet ici — et
l'obtenir demanderait un point d'entrée dans le module `auth`, qui n'existe pas
(`docs/research/s15-organizations.md` §3).

**s17 l'a réattaquée une troisième fois, dans le sens montant.** Promouvoir
quelqu'un `admin` ou `owner` **augmente** son pouvoir : c'est le cas typique de
la fixation de session, et l'argument de s16 — « l'adresse du destinataire est
dans le prédicat de consommation, une session implantée ne consomme rien » — n'y
répond pas, puisque c'est un tiers déjà propriétaire qui décide de l'élévation.
Ce qui tient est plus simple et il est **mesuré** : le jeton ne gagne rien parce
qu'il ne porte rien, et la propriété opposable est la réciproque **dans les deux
sens** — la même session gagne le droit puis le reperd, sans reconnexion
(`tests/organizations.test.ts`, « change le pouvoir à l'instant, sur la même
session »). Mettre `findMembership` en cache fait rougir ce cas. **ADR 030**
porte la décision, ses options rejetées, et les trois faits qui la rouvriraient.

**Seconde conséquence, celle qui piège la story suivante.** L'organisation
active a le **compte** pour clé primaire, pas la session : il n'y a qu'une
organisation active par compte, dernière bascule gagnante. Deux onglets ouverts
sur deux organisations différentes du même compte convergent donc à la requête
suivante — aucune fuite entre locataires, les deux organisations sont les
siennes. Mais **une écriture qui dérive son propriétaire de `dataOwnerOf` peut
atterrir dans l'organisation basculée dans l'autre onglet**, alors que l'écran
affichait la première. Une story qui écrit de la donnée d'organisation depuis un
écran doit donc confirmer le périmètre qu'elle a **affiché**, et non se contenter
du périmètre courant au moment de la soumission. C'est le prix de la persistance
« entre deux sessions » exigée par le critère 2 (ADR 025).

## Les formulaires n'ont pas de JavaScript

Les **neuf** routes répondent **303 vers l'écran** ou, depuis s17, **403** quand
le rôle ne suffit pas — jamais du JSON de succès. Les formulaires
sont donc des `<form method="post">` natifs, sans composant client : il n'y a
aucune fenêtre pré-hydratation à couvrir, puisque la soumission native **est**
le chemin nominal. Le `method` reste écrit en toutes lettres — `pnpm lint` le
refuse autrement.

**Le sélecteur de bascule est la seule exception, et elle est bornée.** Son menu
est portalisé : Radix ne monte son contenu qu'à l'ouverture, qui est un état
React. Sans script, le déclencheur ne s'ouvre pas. Le repli est un `<noscript>`
posé **dans le même `<form method="post">`** — les mêmes options en boutons de
soumission natifs, l'organisation courante exclue puisque le déclencheur la
porte déjà. `e2e/organizations.spec.ts` le parcourt dans un contexte
`javaScriptEnabled: false` ; aucun rendu statique ne peut le prouver, un moteur
seul décide d'afficher un `<noscript>`.

La destination d'une redirection est une **constante** du module, jamais un
paramètre (`docs/security.md` §4). La protection contre la soumission
intersite est celle du cookie de session, `SameSite=Strict`, posé par le module
`auth`.

Le refus est rapporté par un **code** dans l'URL (`?error=slug_unavailable`),
jamais par une phrase : la traduction appartient au catalogue du module.
`slug_unavailable` couvre l'identifiant réservé **et** l'identifiant déjà pris
— deux motifs distincts feraient du formulaire de création un test d'existence
d'organisation (`docs/security.md` §7).

## Imports autorisés

- `@repo/core` pour le contrat de module, le préfixe de montage et la
  qualification des clés de traduction ;
- `@repo/module-auth` dans `src/schema.ts` **et dans
  `src/infrastructure/scoped-reads.ts`**, nulle part ailleurs — et c'est
  désormais `pnpm lint` qui le tient (`no-restricted-imports`, bloc
  `organizationPerimeter`), avec sept cas dans `tests/lint-rules.test.ts` : cinq
  emplacements refusés, deux permis. Jusqu'au tour de correction, la phrase
  n'était tenue par aucune commande (revue de s16, F9). Dans le premier,
  pour la table `auth_user` que référencent `organization_member`,
  `organization_active_selection` et `organization_invitation` ; dans le second,
  pour la **jointure qui donne un nom lisible à un membre** (s16) —
  `organization_member` ne porte qu'un identifiant de compte, et une liste de
  membres sans adresse n'est pas une liste. C'est permis parce que `auth` est
  déclaré dans les `requires` du module (ADR 018).

  Deux bornes, et ce sont elles qui rendent cette jointure acceptable : elle part
  **toujours d'un identifiant de compte**, jamais d'une adresse — le module ne
  sait donc pas répondre à « existe-t-il un compte pour cette adresse ? », et
  l'absence d'énumération est structurelle (`docs/security.md` §7) ; et elle ne
  sort pas de la porte de lecture, dont `pnpm lint` borne la surface ;
- `@repo/ports` pour le port `Mailer` (s06), dans `src/application/` : un port
  est l'interface d'une dépendance externe, il vit dans `application` et son
  implémentation n'entre jamais ici. Le module ignore qu'il existe Resend et une
  capture locale — c'est `apps/web/lib/mailer.ts` qui décide, et lui seul ;
- `@repo/ui` pour **tout** ce qui s'affiche, dans `src/presentation/`
  uniquement : un import de `@radix-ui/*` ici est refusé par `pnpm lint`
  (ADR 022) ;
- `drizzle-orm` dans `src/schema.ts` et dans `infrastructure/` uniquement ;
- `zod` pour la validation, y compris dans `domain/` où c'est la seule
  bibliothèque tierce admise ;
- `node:crypto` dans `infrastructure/` pour les identifiants ;
- `react` — déclaré en `peerDependencies` — et `lucide-react` par `@repo/ui`,
  dans `src/presentation/` uniquement ;
- `@repo/typescript-config`, `@types/node`, `@types/react` et `typescript` pour
  la compilation ;
- `vitest` dans les fichiers de test.

Sens des dépendances, vérifié par `pnpm lint` :
`presentation → application → domain` et `infrastructure → application →
domain`. `infrastructure` et `presentation` ne se connaissent pas — c'est
pourquoi les routes reçoivent un **accès différé** au service, et que
`src/module.ts`, hors des couches, est le seul fichier qui les connaisse toutes.

## Ne doit jamais contenir

- **d'import de `@repo/db`** : la connexion est **injectée** par le point de
  composition (ADR 020). `tests/module-registry.test.ts` le refuse ;
- **de liste d'identifiants réservés écrite ici** : les routes du système sont
  celles de l'application. Une liste écrite dans le module serait fausse dès
  l'écran suivant ;
- **de lecture de `organization`, `organization_member`,
  `organization_active_selection` ou `organization_invitation` hors de
  `infrastructure/scoped-reads.ts`** : `select`, `from` et `execute` y sont
  refusés par `pnpm lint`, partout ailleurs dans le module — le fichier des
  repositories compris. Seule exception, bornée et éprouvée :
  `infrastructure/transaction-locks.ts` obtient `execute`, et rien d'autre ;
- **de vérification d'appartenance préalable à une lecture ou à une écriture** :
  l'autorisation est dans le prédicat, en un seul ordre. Une vérification
  suivie d'une opération laisse la fenêtre où l'on sert la donnée d'autrui ;
- **de 403 sur une organisation dont l'appelant n'est pas membre** : 404, et
  rien d'autre. Le 403 est réservé au **membre** dont le rôle ne suffit pas
  (s17, critère 6) — il sait déjà que l'organisation existe, et le lui cacher ne
  protégerait rien. La ligne de partage est l'appartenance, jamais le rôle ;
- **de compte lu ailleurs que dans la session** : les routes prennent
  `context.session.userId`, jamais un champ du corps ;
- **de vérification d'unicité par `select` avant l'écriture** : c'est la
  contrainte de la base qui décide, et sa violation qui est traduite
  (`docs/reliability.md` §1) ;
- **de texte affiché écrit en dur**, quelle qu'en soit la forme, ni de clé de
  traduction composée dans un `.tsx` : les clés à valeur variable (rôle, motif
  de refus) sont dérivées par des fonctions nommées de
  `src/domain/message-keys.ts` ;
- **de couleur Tailwind brute** ni **de primitive de design system** : un
  besoin non couvert est un *design system gap* à signaler dans la story ;
- **de renvoi hors quota** : le renvoi est une **émission**, donc il passe par
  le quota comme l'invitation. Mesuré avant correction : cinquante renvois
  consécutifs partaient sans un seul refus (revue de s16, F2). Une émission =
  une ligne, et c'est ce que la fenêtre compte ;
- **de donnée personnelle non déclarée** : `organization_invitation.email` est
  l'adresse d'une personne souvent sans compte. Elle a sa catégorie
  (`invitation`), sa politique (`erase`) et sa purge, éprouvée en **exécutant**
  la purge (revue de s16, F6) ;
- **de comparaison de rôle hors de `domain/permissions.ts`** : la matrice est
  écrite une fois. Un `role === 'owner'` dans un cas d'usage, un repository ou
  un `.tsx` la ferait exister à deux endroits, et le second serait celui qui
  ment. L'écran lit `view.permissions` et `members[].assignableRoles`, calculés
  par le serveur avec les fonctions qui gardent aussi les routes. **C'est
  `pnpm lint` qui le tient depuis le tour de correction de s17** : jusque-là la
  phrase était démentie trois fois dans le commit qui l'écrivait — le `.tsx` de
  l'écran et deux fois `domain/message-keys.ts` —, et la règle a fait apparaître
  deux occurrences de plus que la revue n'avait pas nommées, dans
  `domain/invitation.ts`. Une notion dérivée du rôle est une **fonction nommée**
  du fichier qui décide (`grantsOwnership`). Ce que la règle ne voit pas : un
  `switch (role)`, un `includes`, une comparaison à une variable, et un rôle
  ajouté à `ORGANIZATION_ROLES` sans être ajouté au sélecteur ;
- **de choix de rôle à l'invitation** : `INVITED_ROLE` reste `member`, **fixe**.
  Le rôle se change après l'entrée, par la route de s17 — ce qui le fait passer
  par la permission, le verrou et le journal. Un champ de rôle dans le
  formulaire d'invitation contournerait les trois ;
- **de garde de rôle posée dans `RouteProtection`** : le niveau `role` du contrat
  de module interroge `ModuleSession.roles`, une liste de **plateforme** (vide en
  production, réservée au superadmin de s37). Un rôle d'organisation dépend de
  *quelle* organisation ; l'y ranger reproduirait ce que l'ADR 025 refuse
  (ADR 030). Les neuf routes restent `authenticated` ;
- **de jeton d'invitation en clair en base** : `token_hash` porte une empreinte
  SHA-256, et rien d'autre. La porte de lecture n'expose jamais cette colonne ;
- **de lecture d'un compte par son adresse** : les lectures partent d'un
  identifiant. C'est ce qui empêche l'invitation de devenir un test d'existence
  de compte ;
- **de consommation de jeton en `GET`** : un aperçu de lien suit les `GET`.
  L'acceptation est une soumission.

## Tests

- `src/domain/organization-rules.test.ts` : les règles pures — forme du nom et
  de l'identifiant, normalisation, identifiants réservés, unicité du motif de
  refus, rôle du créateur, puis (s16) la forme et la normalisation d'une adresse
  invitée, la précédence des statuts d'invitation, l'échéance, la règle du
  dernier propriétaire et le quota, puis (s17) la **matrice complète** rôle ×
  action, les bornes de l'`admin`, les rôles assignables et le motif de refus
  d'un changement de rôle. Aucune de ces règles ne se prouve ailleurs, et les cas
  de s16 comme de s17 vivent dans **ce** fichier plutôt que dans un second :
  c'est la même unité, et un fichier de plus coûte un environnement complet ;
- `tests/organizations.test.ts` à la racine : le **câblage** — base réelle,
  répartiteur, 404 contre 403, périmètre organisationnel, purge rejouée, module
  coupé, et la dérivation des identifiants réservés confrontée aux écrans du
  disque ;
- `e2e/organizations.spec.ts` : le parcours complet dans un navigateur, y
  compris la persistance de l'organisation courante **entre deux sessions** et
  la bascule **sans JavaScript**. Ses attentes sont dérivées de l'état du
  module : le fichier passe dans les deux configurations ;
- `tests/lint-rules.test.ts` : la porte de lecture unique, éprouvée en rejouant
  la sonde de la revue — la lecture non périmétrée doit être refusée dans
  chaque couche, et permise dans la porte ; l'élargissement du fichier des
  verrous et sa borne ; et l'import de `@repo/module-auth`, refusé partout sauf
  dans les deux fichiers nommés plus haut ;
- `tests/module-registry.test.ts` : l'ordre de purge du registre — le dépendant
  avant son requis (ADR 029), sans lequel ce module n'a plus d'adresse à lire
  quand il doit effacer une invitation.
