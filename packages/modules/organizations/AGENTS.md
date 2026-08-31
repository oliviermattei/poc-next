# packages/modules/organizations — règles locales

La multi-tenance : créer une organisation, basculer entre les siennes, en
modifier le nom et l'identifiant (s15) ; puis y **inviter** quelqu'un, accepter,
révoquer, renvoyer, et **retirer** un membre (s16). **C'est le module qui décide
de la forme du périmètre organisationnel pour tout le reste du produit** — une
frontière molle ici devient une fuite de données quinze stories plus loin.

Module **optionnel**. Coupé, l'application est mono-utilisateur : aucune route,
aucune entrée de navigation, aucune des **quatre** tables sur une base vierge, et
toute donnée est rattachée au compte par la même fonction que lorsqu'il est
activé (`resolveDataOwner`, `@repo/core`).

## Les invariants, et la commande qui tient chacun

Treize, sur ce qui a été éprouvé jusqu'ici — pas « tous ceux qui existent ».

| Invariant | Comment il est tenu | Ce qui échoue si on le casse |
|---|---|---|
| L'organisation d'un autre répond **404, jamais 403** | `findMembership` porte les deux conditions dans **un seul** ordre ; `null` ne distingue pas « pas membre » de « n'existe pas » | `tests/organizations.test.ts` — le cas rougit à 403 comme à 200 |
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

**Ce que la porte de lecture ne tient pas**, et il faut le lire avant de s'y
fier : la règle de lint ne lit pas le SQL. À l'intérieur de `scoped-reads.ts`,
rien n'oblige un prédicat à porter le compte — ce sont les mutations de
`tests/organizations.test.ts` qui l'éprouvent. **Éprouvés jusqu'ici, sur ces
sept prédicats** : `membershipOf`, `activeOrganizationIdOf`,
`memberIdentitiesOf`, `liveInvitationsOf`, `invitationsIssuedSince` (le
périmètre et la fenêtre), `invitationByDigest`, plus ceux du renvoi et du
retrait par leurs écritures ; `membershipsOf`, `membersOf` et
`invitationsAddressedTo` ne le sont pas. Et un appel dont le nom de méthode
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

Les **huit** routes répondent **303 vers l'écran**, pas du JSON. Les formulaires
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
  rien d'autre ;
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
- **de garde de rôle** : s16 n'en pose aucune. N'importe quel membre peut
  inviter et retirer, et le rôle attribué à un invité est `member`, **fixe**
  (`INVITED_ROLE`). Choisir le rôle et restreindre l'action sont des
  permissions : c'est s17, et c'est écrit ici pour que ce ne soit pas lu comme
  un oubli ;
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
  dernier propriétaire et le quota. Aucune de ces règles ne se prouve ailleurs,
  et les cas de s16 vivent dans **ce** fichier plutôt que dans un second : c'est
  la même unité, et un fichier de plus coûte un environnement complet ;
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
