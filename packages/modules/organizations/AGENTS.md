# packages/modules/organizations — règles locales

La multi-tenance : créer une organisation, basculer entre les siennes, en
modifier le nom et l'identifiant. **C'est la story qui décide de la forme du
périmètre organisationnel pour tout le reste du produit** — une frontière molle
ici devient une fuite de données quinze stories plus loin.

Module **optionnel**. Coupé, l'application est mono-utilisateur : aucune route,
aucune entrée de navigation, aucune des trois tables sur une base vierge, et
toute donnée est rattachée au compte par la même fonction que lorsqu'il est
activé (`resolveDataOwner`, `@repo/core`).

## Les invariants, et la commande qui tient chacun

Cinq, sur ce qui a été éprouvé jusqu'ici — pas « tous ceux qui existent ».

| Invariant | Comment il est tenu | Ce qui échoue si on le casse |
|---|---|---|
| L'organisation d'un autre répond **404, jamais 403** | `findMembership` porte les deux conditions dans **un seul** ordre ; `null` ne distingue pas « pas membre » de « n'existe pas » | `tests/organizations.test.ts` — le cas rougit à 403 comme à 200 |
| **Un membre retiré cesse aussitôt de résoudre vers l'organisation quittée** | `activeOrganizationIdOf` joint la sélection courante à `organization_member` sur le **compte** ; la ligne de sélection n'est jamais nettoyée, c'est la lecture qui filtre | `tests/organizations.test.ts` — « cesse de résoudre vers une organisation qu'on a quittée » rougit dès que la jointure perd le compte |
| **Une lecture du module passe par sa porte unique** | `infrastructure/scoped-reads.ts` est le seul fichier où `select`, `from` et `execute` sont permis ; chacune de ses fonctions prend le propriétaire en **premier paramètre** | `pnpm lint` — une lecture écrite ailleurs dans le module est refusée, et `tests/lint-rules.test.ts` rejoue la sonde qui l'a prouvé |
| Une écriture ne reçoit **jamais** un identifiant d'organisation nu | `OrganizationAccess` porte une marque de type non exportée ; seul `authorizeOrganization` en produit | `pnpm typecheck` — la fixture `tests/fixtures/typing/forged-organization-access.ts` **doit** échouer, et `tests/module-registry.test.ts` lit le diagnostic |
| Les identifiants **réservés** suivent les écrans réellement servis | la liste est **reçue**, dérivée par `apps/web/lib/organizations.ts` | `tests/organizations.test.ts` — chaque segment de premier niveau de `apps/web/app` doit être refusé |

**Ce que la porte de lecture ne tient pas**, et il faut le lire avant de s'y
fier : la règle de lint ne lit pas le SQL. À l'intérieur de `scoped-reads.ts`,
rien n'oblige un prédicat à porter le compte — ce sont les mutations de
`tests/organizations.test.ts` qui l'éprouvent, sur les quatre lectures qui
existent aujourd'hui. Et un appel dont le nom de méthode n'est pas visible à la
syntaxe (`const { select } = db`) échappe au sélecteur. La garde **borne la
surface à relire à un fichier** ; elle ne remplace pas la relecture.

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

Les trois routes répondent **303 vers l'écran**, pas du JSON. Les formulaires
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
- `@repo/module-auth` dans `src/schema.ts` **uniquement**, pour la table
  `auth_user` que référencent `organization_member` et
  `organization_active_selection`. C'est permis parce que `auth` est déclaré
  dans les `requires` du module (ADR 018) ;
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
- **de lecture de `organization`, `organization_member` ou
  `organization_active_selection` hors de `infrastructure/scoped-reads.ts`** :
  `select`, `from` et `execute` y sont refusés par `pnpm lint`, partout ailleurs
  dans le module — le fichier des repositories compris ;
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
- **de gestion de membres, d'invitation ou de rôle attribué** : c'est s16 et
  s17. s15 n'attribue qu'un rôle, celui du créateur.

## Tests

- `src/domain/organization-rules.test.ts` : les règles pures — forme du nom et
  de l'identifiant, normalisation, identifiants réservés, unicité du motif de
  refus, rôle du créateur. Aucune de ces règles ne se prouve ailleurs ;
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
  chaque couche, et permise dans la porte.
