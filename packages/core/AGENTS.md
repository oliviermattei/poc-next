# packages/core — règles locales

Le **contrat de module** (ADR 007) et le registre qui le lit. C'est le point le
plus structurant du dépôt : chaque module applicatif s'y conforme, et un champ
ajouté après coup oblige à rouvrir tous les modules déjà écrits. Le contrat est
donc complet dès le premier module, quitte à ce que des déclarations soient
vides.

Les garanties qui vivent ici ne sont pas de même nature. Les deux premières sont
tenues par le compilateur, les suivantes à la construction du registre :

| Garantie | Où elle est tenue | Ce qui échoue si on la viole |
|---|---|---|
| Un identifiant de module inconnu est refusé | le **compilateur** (`config/features.ts` est typée depuis l'annuaire) | `pnpm typecheck` |
| Une catégorie de données sans politique de rétention est refusée | le **compilateur** (`retention` est indexée par `dataCategories`) | `pnpm typecheck` |
| Un template d'email sans version dans une locale livrée est refusé | le **compilateur** (`emails[].locales` est indexé par les locales de `messages`) | `pnpm typecheck` |
| Requis manquant, cycle, auto-référence, identifiant en double | `resolveEnabledModules`, à la construction du registre | `pnpm test`, et le démarrage de l'application |
| Template d'email incomplet, clé de navigation sans traduction, collision de route entre deux modules | `assertDeclarationsAreComplete`, à la construction du registre | `pnpm test`, et le démarrage de l'application |
| Un point de composition qui ne déclare pas les locales de l'application | le **compilateur** (`buildRegistry` exige `locales`), et un refus à l'exécution pour l'appelant qui ignore les types | `pnpm typecheck`, `pnpm test` |
| Un module qui ne déclare pas ce qu'il publie (`publicUrls`, s53) | le **compilateur** (la clé est obligatoire comme les quatorze autres) | `pnpm typecheck`, et `tests/module-registry.test.ts` qui compile réellement le refus |

`locales` est **obligatoire** dans `buildRegistry`, et ce n'est pas du confort :
c'est contre les locales de l'**application** — jamais celles du module — qu'un
template d'email ou un libellé de navigation incomplet est refusé (faille
mesurée en revue de s06). Tant que le paramètre était facultatif, l'oublier
ramenait silencieusement la référence au module, c'est-à-dire à une règle vraie
par construction qui ne refuse jamais rien : la revue de s09 a retiré `locales`
du point de composition de l'application sans faire rougir une seule commande.
Un registre d'essai déclare donc explicitement les locales contre lesquelles il
veut être jugé.

Les garanties de typage ne doivent **jamais** être dégradées en vérification
d'exécution : une contrainte portée par le compilateur ne se contourne pas, une
validation au démarrage se découvre en production. Les deux dernières lignes ne
sont pas du typage par choix mais par nécessité — le graphe des requis et les
collisions entre modules ne sont connus qu'une fois l'annuaire assemblé.

`requires` est typée `readonly string[]` et non `readonly ModuleId[]` : l'union
des identifiants vient de l'annuaire de `config/features.ts`, qui importe les
modules. La typer depuis cette union fermerait le cycle. Une faute de frappe
dans un requis est donc attrapée à la construction du registre, pas à la
compilation — asymétrie assumée avec `enabledModules`, écrite dans le contrat.

## Ce que le socle donne à indexer (s53, ADR 054)

`src/syndication.ts` porte le plan de site, la politique des robots et la règle
du préfixe de langue. Ces fonctions vivaient dans le `domain` du module
`marketing` : elles sont montées ici parce que `apps/web/app/robots.ts` et
`apps/web/app/sitemap.ts` ne doivent connaître **aucun** module par son nom, et
qu'elles n'ont jamais rien eu de marketing — des chemins entrent, des URL
sortent.

`indexableUrls(registry, context)` agrège **une seule source** : la quinzième
clé du contrat, `publicUrls`. Elle ne lit **pas** les entrées de navigation
publiques, et c'est une décision mesurée : la configuration livrée en porte
plusieurs que personne ne contribue au plan de site, dont `/sign-in`, `/pricing`
et une route d'API. **Leur nombre n'est pas écrit ici** — il valait cinq à
l'écriture de cette ligne, huit à la revue de s31 — : `tests/syndication.test.ts`
le dérive du registre. `public` est un niveau de **protection**, pas une décision
d'indexation (`docs/security.md` §7).

`renderFeed(input)` construit le **flux RSS 2.0**, et il est ici depuis s31
(ADR 065). Il vivait dans le `domain` du module `blog`, seul à en avoir un ; le
changelog en réclamant un aussi, l'y laisser lui aurait imposé
`requires: ['blog']` — un produit qui coupe le blog aurait perdu ses notes de
version. `renderBlogFeed` en est devenue une enveloppe. Ce qu'il fait, et ce
qu'il ne fait pas : il échappe les cinq entités XML, range du plus récent au plus
ancien, écrit `dc:creator` **seulement** quand l'entrée porte un auteur, et il
ne lit ni disque ni `APP_URL` — les URL absolues arrivent par l'appelant. Ce que
mesure la suite est que le document servi est **analysable** par
`@rowanmanning/feed-parser` ; le dépôt n'embarque aucun **validateur**, et la
nuance est un cas de `tests/blog.test.ts` pour qu'elle ne se regonfle pas.

`carriesLocalePrefix` est la règle d'`apps/web/proxy.ts`, écrite ici depuis
qu'elle a un second appelant : `publicPath` préfixe sans condition, `/api…`
compris, et une contribution vers une route montée serait sinon annoncée sous
une langue que rien ne sert (constat M3 de la revue de s29).

Une entrée de navigation déclare aussi sa **surface** (`surface`, s31, ADR 066) :
la barre latérale de l'application (`'app'`, le défaut) ou le pied de page du site
public (`'footer'`). `visibleNavigation(registry, session, surface)` filtre sur
elle, et les deux ensembles sont disjoints — une entrée de pied de page dans la
barre latérale mettrait un lien de service au rang des fonctionnalités du
produit. Le champ est **facultatif**, à la différence de `protection` : son
défaut est ce qu'avaient les modules écrits avant lui, là où `protection` n'a pas
de défaut sûr. Ce n'est **pas** une décision d'indexation : `publicUrls` reste la
seule source du plan de site (ADR 054).

Le contrat porte aussi la **protection** des routes **et** des entrées de
navigation, et les deux sont lues : `dispatchModuleRequest` refuse une route non
satisfaite, `visibleNavigation` retire l'entrée correspondante. La règle
elle-même (`satisfiesProtection`) est écrite une seule fois, dans
`src/protection.ts` — deux implémentations divergeraient au premier rôle ajouté.

**Quatre niveaux depuis s21** : `public`, `authenticated`, `role`, et
`entitlement` — réservé à une offre payante (ADR 043). Le quatrième est le seul
que `satisfiesProtection` ne tranche **pas** entièrement, et il faut le savoir
avant d'y toucher : elle en répond la moitié « session » — sans session, 401
comme une route authentifiée —, l'autre moitié étant asynchrone (savoir quelles
offres un périmètre détient demande une lecture, que le filtre de navigation ne
peut pas attendre). Cette seconde moitié vit dans `dispatchModuleRequest`, elle
est **fail-closed** (`DispatchOptions.resolveFeatures` absent ⇒ 403), et elle
répond **403 et non 404** : l'existence d'une fonctionnalité vendue est
publique, seul son usage est réservé. Un appelant qui prendrait
`satisfiesProtection` pour la garde entière n'aurait aucun gating — c'est
pourquoi il n'y a qu'un appelant côté serveur, et que le refus est éprouvé au
répartiteur (`tests/module-registry.test.ts`).

**Le répartiteur porte aussi la limitation de débit** (s28, ADR 050), et il est
**fail-closed** comme sur les fonctionnalités réservées : `routeIsRateLimited`
dit qu'une route est limitée dès qu'elle est `public` **ou** qu'elle déclare un
`rateLimit`, et sans `DispatchOptions.rateLimit` branché, une telle route répond
**429 avec `Retry-After`**. La couverture est donc **dérivée du registre**, jamais
énumérée : une route publique ajoutée demain est limitée sans que personne y
pense. `@repo/core` ne compte rien et ne connaît aucun seuil — il reçoit un garde,
comme il reçoit `resolveSession` et `resolveFeatures`. C'est aussi ce qui rend la
limitation neutralisable **par injection uniquement**, sans variable
d'environnement exploitable en production. L'ordre est une règle : la limitation
vient **après** l'appariement de la route — un chemin inconnu répond 404 sans
toucher au compteur, sinon n'importe quelle URL inventée y écrirait une ligne —
et **avant** la résolution de session, qui lit la base à chaque requête.

Une entrée de navigation `entitlement` reste **visible** à toute session, et
c'est une décision : le critère de s21 demande une invitation à souscrire, pas
une disparition.

**Ce qui a été prouvé par mutation** sur le gating (s21) — le compte est le
nombre de cas passés au rouge, mesurés le 2 septembre 2026.

Les trois premières par `pnpm vitest run packages/core/src/entitlement.test.ts`
(17 cas verts sans mutation), les deux dernières par
`pnpm vitest run tests/module-registry.test.ts` (62 cas verts sans mutation) —
c'est là que le refus vit :

| Mutation | Rouges |
|---|---|
| `assertGatesCoverRoutes` ne refuse plus rien | 2 |
| `allowsFeature` accorde toujours | 3 |
| accepter une offre absente du catalogue dans `parseFeatureGates` | 1 |
| le répartiteur accorde quand aucun résolveur n'est branché | 1 |
| retirer la garde d'`entitlement` du répartiteur | 3 |

Ces comptes sont ceux des cas passés au rouge sur les mutations **posées** — pas
un inventaire de ce qui est couvert.

`src/entitlement.ts` porte la règle de gating — `FeatureGate`,
`parseFeatureGates`, `allowsFeature`, `entitledFeatureIds`,
`assertGatesCoverRoutes`. Elle est ici, et pas dans le module de facturation,
pour la raison qui y a mis `resolveDataOwner` : **elle doit répondre quand ce
module est coupé**. `@repo/core` ne connaît donc ni offre, ni abonnement, ni
achat — il reçoit des chaînes et en dérive des fonctionnalités.
`assertGatesCoverRoutes` ferme le défaut symétrique de celui de s17 : une action
absente de la matrice n'était refusée par personne, une fonctionnalité absente
des déclarations serait refusée à **tout le monde**, et le démarrage la nomme.

La clé `jobs` déclare les tâches planifiées d'un module. Elle est **déclarative**
comme `routes` et `webhooks` : l'ordonnanceur de s33 se branchera sur le
registre, jamais sur un enregistrement à l'import — une tâche qui s'enregistre
en se chargeant s'exécuterait pour un module que la configuration n'active pas.

## Imports autorisés

- `@repo/ports` **en type seulement**, et une seule raison le justifie : le
  répartiteur de tâches (`src/jobs.ts`, s33) classe un échec en code du port
  `Jobs` et écrit dans son journal. C'est le port qui décide de quel côté tombe
  chaque code — transitoire ou définitif —, et le redéclarer ici ferait deux
  vérités pour la règle « ne jamais rejouer une validation »
  (`docs/reliability.md` §3). `@repo/ports` n'a **aucune** dépendance
  d'exécution : ce package reste une feuille du graphe de production ;
- rien d'autre à l'exécution. Il ne connaît ni Drizzle, ni Next, ni la base de
  données ;
- `@repo/typescript-config` pour la configuration du compilateur ;
- `vitest` dans les fichiers de test.

Le contrat décrit le schéma d'un module comme un simple
`Record<string, unknown>` — la structure exacte des tables appartient au module
et à `@repo/db`. C'est ce qui permettra à la composition de schémas de
s04 de consommer un module sans que `@repo/core` dépende de l'ORM.

## Ne doit jamais contenir

- de règle métier : les règles vivent dans le `domain/` d'un module ;
- d'accès à la base, au réseau ou au système de fichiers : le registre est une
  structure de données, pas un service ;
- de connaissance d'un module particulier — aucun `if (moduleId === 'billing')`.
  Ce qui varie par module se déclare au contrat ;
- **de commande de nettoyage** : un module désactivé conserve ses tables et ses
  données. Les supprimer serait `eject`, au cimetière du PRD ;
- de dépendance vers `config/features.ts` : le registre **reçoit** la
  configuration, il ne la lit pas lui-même. Sans quoi il devient impossible d'en
  construire un autre dans un test.

## Tests

Ce qui traverse le dépôt — contrat, validation, registre, modules de
démonstration, montage dans `apps/web` — vit dans `tests/` à la racine
(`tests/module-registry.test.ts`, `tests/module-off.test.ts`). Un test propre à
ce package vit dans `src/**/*.test.ts` : c'est le cas de
`src/protection.test.ts`, qui énumère la règle d'accès là où elle est écrite.
Ses appelants — la navigation de `apps/web`, le répartiteur — prouvent qu'ils
l'appellent ; ils ne rejouent pas la matrice.

Les contraintes portées par le compilateur ne se prouvent pas avec
`expectTypeOf` : elles se prouvent en compilant réellement des fichiers qui
doivent échouer (`tests/fixtures/typing/`). Une contrainte de typage qu'aucune
commande n'a vue échouer n'existe pas.

## L'export d'un périmètre (s35)

`exportModules` rend une **forme discriminée** depuis s35, comme un port : lire
les charges sans avoir écarté l'échec ne compile pas. Un module qui lève arrête
la construction en se nommant, et rien n'est livré — un export partiel est pire
qu'un échec, parce que la personne qui reçoit l'archive n'a aucun moyen de
savoir ce qui lui manque.

**Elle est la sœur de `PurgeModulesOutcome` (s34), et les deux se lisent avec le
même vocabulaire** : la branche d'échec porte `failed` (le module fautif),
`message` (ce qu'il a dit) et la liste de ce qui a abouti — `purged` là,
`exported` ici. La **seule** asymétrie est la branche de succès : une purge n'a
rien à rendre que la liste de ce qu'elle a fait, un export **est** ce qu'il rend.
`payloads` porte donc les données, et la liste des modules lus s'en dérive.

`src/data-export.ts` porte deux fonctions de plus, et aucune ne connaît de
module par son nom :

- `buildDataExportArchive` assemble l'enveloppe — version de format, date,
  périmètre, une entrée par module activé avec ses `dataCategories` et sa
  charge. L'archive est **entièrement en JSON** : le seul module qui possède des
  octets, `storage`, n'en rend qu'un manifeste, sans clé d'objet et **sans
  empreinte** — la personne qui la reçoit constate qu'un fichier existe, pas ce
  qu'il contient (`docs/decisions/062-…`) ;
- `auditDataCategoryCoverage` confronte les catégories déclarées à ce que
  l'export produit (`docs/decisions/063-…`). Le contrat autorise
  `dataCategories: ['x']` avec `export: async () => ({})`, et **rien ne
  vérifiait que les trois clés s'accordent** — `admin` est arrivé exactement dans
  cet état à la fusion de s34. Une catégorie déclarée est désormais soit
  exportée, soit **exceptée avec sa raison écrite** ; la table des exceptions est
  reçue et vit dans `tests/data-export.test.ts`, une seizième clé du contrat
  obligeant à rouvrir les seize modules déjà écrits pour y déclarer `{}`. La
  commande qui échoue est `pnpm test`, en nommant le module et la catégorie.

Le garde ne compare **pas** les noms des clés d'une charge utile aux noms des
catégories : `billing` déclare `subscription` et rend `subscriptions`,
`marketing` déclare `contact-message` et rend `messages`. Une correspondance par
le nom serait une couverture par sous-chaîne, c'est-à-dire une illusion. Ce qu'il
mesure est ce qui se mesure : un module qui dit détenir des données personnelles
et n'en rend aucune. **Il travaille donc par module, pas par catégorie**, et il
ne voit que les catégories **déclarées** — une donnée personnelle qu'aucune
catégorie ne nomme lui est invisible.
