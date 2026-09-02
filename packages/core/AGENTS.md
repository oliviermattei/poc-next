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

- rien à l'exécution : ce package est une feuille du graphe, sans dépendance de
  production. Il ne connaît ni Drizzle, ni Next, ni la base de données ;
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
