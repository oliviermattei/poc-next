# packages/emails — règles locales

Les **templates React Email** et leur rendu. C'est le seul package du couple
port/adapters qui connaît React : le rendu est **injecté** dans les
implémentations de `Mailer` (`EmailRenderer` dans `@repo/ports`), jamais hérité.
C'est ce qui permet à `@repo/adapter-resend` de ne dépendre que du SDK Resend,
et aux outils de `@repo/mailer-testing` de n'avoir aucune dépendance.

## Le partage des rôles avec le contrat de module

| Ce qui vit où | Qui le déclare |
|---|---|
| Le **texte** d'un email, par locale (`subject`, `body`) | le module, dans `emails` de son contrat (ADR 007) |
| La **mise en page** | `TransactionalEmail`, ici, commune à tous les modules |
| Le **catalogue** des templates rendables | le registre : seuls les modules activés y sont |

Un composant React par template obligerait chaque module à embarquer React et à
réinventer une mise en page, pour une différence que personne n'a demandée. Le
jour où un module en aura besoin (un bouton, un tableau de facture), il
déclarera son composant et le rendu le préférera — pas avant.

Les identifiants de template sont **qualifiés par module**
(`demo-enabled.welcome`), comme les clés de traduction : le contrat ne garantit
pas leur unicité globale — `assertDeclarationsAreComplete` la vérifie pour les
routes, pas pour les emails.

## Deux refus qui comptent

- **Une donnée manquante lève.** La tolérance produirait un email portant
  « Bonjour {name} », visible du destinataire et de personne d'autre. Un email
  qui ne part pas se remarque ; un email fautif qui part, non.
- **Les données sont des enfants de texte, jamais du HTML brut.** Un nom
  d'utilisateur ou d'organisation vient d'une saisie : interpolé sans
  échappement, il ferait de chaque email un vecteur d'injection. React échappe ;
  `dangerouslySetInnerHTML` est interdit ici.

## Les templates s'écrivent avec `createElement`, pas en JSX

Trois transpileurs lisent ce dépôt et ils ne s'accordent pas :

| Transpileur | Ce qu'il fait d'un `.tsx` |
|---|---|
| Turbopack / SWC (`next build`) | runtime automatique — fonctionne |
| Vite (`pnpm test`) | runtime automatique — fonctionne |
| esbuild via `tsx` (`pnpm db:*`, `pnpm run audit`) | runtime **classique** : `React.createElement`, et `React` n'est pas défini |

`tsx` **honore** `jsx` — mais pas celui du package. Ce qui a été mesuré avec le
`tsx@4.23.13` du dépôt, sur un `.tsx` réel (chaque ligne exécutée, pas déduite) :

| Réglage, et d'où le processus est lancé | Résultat |
|---|---|
| aucun réglage | échec, runtime classique |
| `jsx: "react-jsx"` dans le `tsconfig.json` résolu **depuis le `cwd`**, dont l'`include` couvre le fichier | **fonctionne**, y compris via `extends` du préset du dépôt |
| le même réglage dans le `tsconfig.json` du package, `tsx` étant lancé depuis la racine | échec |
| `jsx` dans le `tsconfig.json` racine, dont l'`include` ne couvre pas `packages/**` | échec |
| `TSX_TSCONFIG_PATH` vers un `tsconfig.json` qui pose `jsx` | **fonctionne** |
| pragma `/** @jsxImportSource react */` seul | échec — il choisit la source d'import, pas le runtime |
| pragma `/** @jsxRuntime automatic @jsxImportSource react */` | **fonctionne** — sans aucun `tsconfig.json`, et quel que soit le répertoire de lancement |

Ce tableau porte sur les mécanismes essayés, pas sur tous ceux qui existent :
la dernière ligne a été ajoutée après coup (revue de s06, G7), et une prochaine
version de `tsx` peut en ajouter d'autres. Le mesurer avant de l'écrire reste la
seule règle.

Autrement dit : sous `tsx`, le runtime JSX est décidé par le `tsconfig.json`
résolu depuis le **répertoire courant du processus**, et seulement si son
`include` couvre le fichier. Un package importé par du code serveur partagé ne
contrôle ni l'un ni l'autre : `pnpm run audit` s'exécute depuis la racine,
`pnpm db:*` depuis `packages/db`, et les deux chargeraient ce fichier sous un
réglage différent.

Le seul mécanisme qu'un package contrôle réellement est donc le **pragma
complet** — mais il se réécrit en tête de chaque fichier, et l'oublier une fois
casse un script au chargement, pas au test ni au build. `createElement` ne
dépend d'aucun réglage de compilateur ni d'aucun en-tête : il n'y a rien à
oublier, d'où qu'on le lance.

(La version précédente de cette règle affirmait qu'« aucun moyen n'existe, les
trois ont été essayés » : deux des trois fonctionnent en réalité, et ce qui
avait été essayé était le `tsconfig.json` **racine**, qui ne gouverne pas
`packages/emails/src/**`. Relevé en revue de s06, F4.)

Un `.tsx` ici n'échouerait ni au test, ni au build, mais au premier script
exécuté par `tsx` qui charge le mailer (une graine qui envoie un email, un
ordonnanceur), sur un « React is not defined » que rien ne rattache au fichier
fautif.

`apps/web` garde ses `.tsx` : seul Next les compile. Ce package est importé par
du code serveur partagé, il n'a pas ce luxe. La contrainte est faible en
pratique — il n'y a **qu'un** composant, la mise en page commune, et les modules
déclarent du texte, pas des composants.

## Imports autorisés

- `@repo/ports` pour la forme du rendu (`EmailRenderer`, `RenderedEmail`) ;
- `@repo/core` pour le type des templates déclarés au contrat ;
- `@react-email/components` pour les composants et `render` — **asynchrone** en
  1.0.12, relevé dans le paquet installé ;
- `react` et `react-dom`, requis par le rendu ;
- `@repo/module-demo-enabled` **en dépendance de développement uniquement** :
  le test de rendu exerce le template de démonstration tel que le module le
  déclare, plutôt qu'une copie qui vieillirait ;
- `@repo/typescript-config` pour la configuration du compilateur ;
- `vitest` dans les fichiers de test.

Aucun SDK de fournisseur : ce package ne sait pas qu'un email s'envoie.

## Ne doit jamais contenir

- de `dangerouslySetInnerHTML`, ni d'interpolation de donnée dans du HTML brut ;
- de texte d'email en dur : le texte appartient au module qui l'envoie, avec ses
  locales ;
- de lecture de `process.env`, de disque ou de réseau : rendre est une fonction ;
- de connaissance d'un module en particulier — le catalogue est **reçu**.

## Tests

`src/render.test.ts` (`pnpm test`). Les cas appellent le rendu et affirment sur
le HTML et le texte produits, jamais sur l'arbre de composants — c'est le
comportement observable, et il survit à un changement de mise en page.

Ce que la suite **ne voyait pas** et qu'une vérification manuelle a attrapé : le
runtime JSX. Vitest compile comme Next, donc un `.tsx` y passait vert et cassait
sous `tsx`. D'où la règle ci-dessus, et d'où l'habitude à garder — charger le
mailer une fois à la main avant de conclure.

**Prouvé par mutation** : tolérer une donnée manquante → 1 cas rouge ; injecter
le corps en HTML brut → 1 ; ignorer la locale demandée → 2 ; tolérer un template
inconnu → 1.
