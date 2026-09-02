# packages/modules/storage — règles locales

Le module de fichiers (s18). Il possède **une** table, `storage_file`, et il est
le premier appelant réel du port `Storage`.

## Les invariants qu'il tient, et la commande qui rougit

| Invariant | Où il vit | Ce qui le tient |
|---|---|---|
| le type déclaré par le client ne décide de rien | `domain/avatar.ts` — `validateStoredAvatar` | `packages/modules/storage/src/domain/storage-rules.test.ts` |
| un SVG, un HTML, un GIF, un PDF ne sont pas des avatars | `domain/avatar.ts` — `detectImageType` | idem |
| la taille réelle prime sur la taille annoncée | `domain/avatar.ts` | idem |
| la clé d'objet ne contient **rien** du client | `domain/avatar.ts` — `avatarKeyFor` | idem |
| une clé hors du périmètre d'attente de l'appelant rend **404** | `application/storage-use-cases.ts` — `confirmAvatar` | `tests/storage.test.ts` |
| ce qui est servi n'est jamais ce qu'une URL présignée nomme | `domain/avatar.ts` — `servedKeyOf`, `application` — promotion | idem |
| un rejeu de confirmation refuse **sans mentir** sur ce qui s'est passé | `application/storage-use-cases.ts` — `confirmAvatar`, et `apps/web/app/account/avatar-form.tsx` pour le message | idem, et `e2e/storage.spec.ts` |
| écrire, afficher et retirer résolvent **le même** propriétaire | `infrastructure/storage-runtime.ts` — `avatarOfUser` | idem, et `e2e/storage.spec.ts` |
| aucun cache ne garde un avatar | `presentation/storage-routes.ts` | idem |
| le fichier d'un autre périmètre rend **404**, jamais 403 | `application` — `readFile` | idem |
| le remplacement supprime l'objet précédent | `application` — `confirmAvatar` | idem |
| la purge supprime **l'objet**, pas seulement la ligne | `application` — `purge` | idem |
| un module coupé n'expose aucune route ni table | le registre, `generated/` | `tests/module-off.test.ts`, `tests/storage.test.ts` |

## Le contrôle du contenu se fait **après** le téléversement, et c'est structurel

Le téléversement va directement au stockage (critère 2) : les octets ne
traversent jamais l'application. Aucune signature d'URL présignée ne lie un
en-tête `Content-Type` à des octets — la signature garantit seulement que le
client repose l'en-tête qu'il a annoncé. Le seul moment où l'on peut regarder le
contenu est donc **après**, à la confirmation, en le relisant par le port.

### Et il ne suffit pas de le faire une fois : la clé d'attente (ADR 033)

Un contrôle à la confirmation ne vaut que si l'objet vérifié ne peut plus
changer. Or **aucun fournisseur ne révoque une URL présignée** : elle vaut
jusqu'à son échéance. Rejouée avec d'autres octets de même longueur et de même
type, elle réécrivait l'objet que la route de lecture sert — mesuré au navigateur
en revue, avec un SVG servi sous `image/png` (constat F2 ; sans exécution, la
politique de sécurité du contenu et `nosniff` tenant).

D'où deux espaces de clés, et un seul est présignable :

| Espace | Clé | Qui écrit |
|---|---|---|
| attente | `pending/<kind>/<id>/<hasard>.<ext>` | le **navigateur**, par URL présignée |
| servi | `avatars/<kind>/<id>/<hasard>.<ext>` | **le serveur**, à la confirmation, avec les octets qu'il vient de vérifier |

`servedKeyOf` porte le refus et la promotion ensemble : une clé d'attente d'un
autre périmètre, une clé déjà servie, une clé qui remonte dans l'arborescence ne
promeuvent rien, et l'appelant reçoit 404.

Conséquence assumée, et il faut la lire : entre le `PUT` et la confirmation, un
objet non vérifié existe dans le seau, sous `pending/`. Il n'est référencé par
aucune ligne, servi par aucune route, et la confirmation le supprime — qu'elle
l'accepte ou le refuse.

### Les orphelins : **deux préfixes**, et un seul a un remède écrit

Un objet qu'aucune ligne ne nomme échappe à `purge`, qui n'efface que les clés
portées par des lignes — alors que le module déclare `retention: { file:
'erase' }`. Deux chemins y mènent, ils ne vivent pas sous le même préfixe, et ils
ne prennent pas le même remède. C'est ce qui a été balayé ; ce n'est pas une
liste de ce qui existe.

| Chemin | Préfixe | Remède |
|---|---|---|
| téléverser sans jamais confirmer, ou rejouer l'URL présignée après coup | `pending/` | une **expiration d'âge du préfixe entier** (24 h suffisent). Sans risque : aucun objet servi n'y vit |
| **promotion interrompue** — `storage.write` a réussi, `replaceAvatar` n'a pas enregistré | `avatars/` | **aucun aujourd'hui.** Une expiration d'âge ramasserait les avatars légitimes, qui sont vieux par construction |

Le second a été **mesuré** en revue, base coupée entre les deux opérations :
l'objet servi reste, l'objet d'attente a déjà été supprimé, aucune ligne ne le
nomme. La fenêtre est étroite — deux appels — et elle n'est pas nulle. Le remède
qui lui correspond est une **réconciliation** entre les objets du seau et les
lignes de `storage_file` (`docs/reliability.md` §5 : « tout état qui peut
diverger d'un système externe a une commande de réconciliation »), et cette
commande n'existe pas dans ce dépôt.

**Une forme rendrait cet orphelin impossible plutôt que ramassable, et elle
n'est pas implémentée ici** — la nommer est le travail de la story qui la
prendra : inverser l'ordre, enregistrer la ligne sur la clé servie **avant** de
promouvoir. Une panne laisserait alors une ligne qui désigne un objet absent,
c'est-à-dire l'état que le code sait déjà traiter — `readFile` rend 404 quand
l'objet a disparu, et `purge` efface la ligne. L'orphelin invisible devient une
ligne visible. Ce n'est pas une décision prise : elle déplace la fenêtre, elle
demande de reprendre la suppression de l'objet précédent, et elle appartient à
un ADR, pas à ce fichier.

Le geste d'exploitation, lui, est écrit dans `.env.example`. L'ADR 032 et
l'ADR 033 nomment la dette du côté `pending/` — elles sont acceptées, donc
immuables : **la portée réelle est ce tableau-ci**.

## Le module ne connaît ni `auth`, ni `organizations`

`requires: ['auth']` est déclaré — sans compte il n'y a personne pour posséder
un fichier, et c'est cette déclaration qui place la purge de ce module **avant**
celle de `auth` (ADR 029, ordre inverse du graphe). Mais **aucune clé étrangère**
n'existe, et les deux absences ont chacune leur raison :

- vers `organization` : elle obligerait à déclarer `organizations` en requis, donc
  rendrait le stockage indisponible en mode mono-utilisateur (ADR 018) ;
- vers `auth_user` : elle serait permise, et une cascade effacerait **la ligne
  sans l'objet**. Le fichier survivrait à la suppression du compte sans plus rien
  pour le désigner — c'est le défaut de s16 sur une adresse, retourné.

Ce que le module reçoit de son point de composition, faute de pouvoir le
calculer : `ownerOf` (le périmètre de l'avatar d'un compte) et `readableScopes`
(les périmètres de lecture, compte plus organisations). Même patron que
`emailOfScope` pour `marketing` et `reservedSlugs` pour `organizations`.

**`ownerOf` est la seule source d'appartenance, et les trois chemins la
rejouent** : `presign`, `confirm` et `remove` par les routes, l'affichage par
`avatarOfUser`. Ce n'est pas de l'élégance — la première écriture donnait
`dataOwnerOf` à l'écriture et fabriquait un `{ kind: 'user' }` à l'affichage :
dès qu'une organisation était active, l'avatar partait dans un périmètre que
l'écran ne lisait pas, et « Retirer » effaçait la ressource **partagée** de
l'organisation en rendant 204, sans aucune garde de rôle (constat F1 de la
revue). L'application livrée résout donc l'avatar sur **la personne**, et le
périmètre organisation, qui reste dans le `domain`, n'est atteignable par aucun
écran de cette story.

### À lire avant d'écrire l'écran d'avatar d'organisation

Deux choses sont vraies aujourd'hui et cesseront de l'être ce jour-là. Aucune
n'est un défaut maintenant ; les deux sont des angles morts de la suite.

**1. Il y a un quatrième chemin d'appartenance, et il ne passe pas par
`ownerOf`.** `src/module.ts` convertit lui-même `ModuleScope → FileOwner` pour
`purge` et `export`, sans le `ownerOf` injecté. C'est la forme juste : ces deux
opérations sont pilotées par le périmètre que le registre leur donne, pas par la
session. Mais les deux résolutions coïncident **seulement parce que** `ownerOf`
est l'identité sur un compte. Le jour où l'écriture pourra viser une
organisation, elles pourront diverger — un avatar écrit dans un périmètre que la
purge ne parcourt pas — et **rien ne rougirait** : `tests/storage.test.ts`
injecte son propre `writeOwner`, et le seul filet qui voie le vrai `ownerOf` est
`e2e/storage.spec.ts`, qui n'exerce que l'affichage. Ce qu'il faut donc poser
avec cet écran : un cas qui écrit sous le périmètre d'organisation **par le vrai
point de composition**, puis purge ce périmètre et vérifie que l'objet a disparu.

**2. Le critère 5 est aujourd'hui vrai à vide.** « Un fichier d'organisation
n'est lisible que par ses membres » est tenu par le contrôle de périmètre de
`readFile`, et ce contrôle est éprouvé — avec des propriétaires **injectés** par
le test. Or aucun chemin livré n'écrit un fichier d'organisation : il n'existe,
en usage, aucun fichier auquel ce contrôle s'applique. Une propriété vérifiée sur
des propriétaires injectés seulement n'est pas une propriété vérifiée en usage.
Le premier écran qui écrira pour une organisation devra donc aussi apporter la
garde de rôle qui va avec — s17 refuse à un `member` les autres actions
d'organisation, et un avatar partagé est une ressource de la même nature.

## La lecture passe par l'application, l'écriture ne passe pas par elle

ADR 032. **L'asymétrie est le cœur de la story**, et elle a deux motifs mesurés :

- `img-src 'self'` (s45) refuse une image servie par le domaine du seau, et
  `config/security.ts` — le seul endroit d'où une source peut entrer — appartient
  à une autre story ;
- une URL présignée de lecture est une capacité **détachée de l'appartenance** :
  émise pour un membre, elle continue de valoir après son départ. La lecture
  servie par l'application relit l'appartenance à chaque requête.

## La route de téléversement local

`PUT /api/modules/storage/local-upload` est déclarée en permanence — une route
conditionnelle serait un `if (module activé)` déguisé — mais elle **répond 404**
quand le point de composition n'a pas monté le stockage sur disque. Un
déploiement muni d'un vrai seau n'expose donc aucun point d'entrée d'écriture de
plus. Elle est `authenticated` comme les quatre autres.

## Imports autorisés

- `@repo/core` pour le contrat de module, `ModuleRoute` et `ModuleScope` ;
- `@repo/ports` pour le port `Storage` — **jamais** un adapter, jamais un SDK :
  le module ignore s'il parle à un seau ou à un dossier ;
- `drizzle-orm` dans `infrastructure/` uniquement, sur la connexion **injectée** ;
- `zod` pour valider les corps de requête (`docs/security.md` §4) — c'est une
  bibliothèque pure, et le `domain` a le droit de la connaître ;
- `@repo/typescript-config` pour la configuration du compilateur ;
- `vitest` dans les fichiers de test.

## Ne doit jamais contenir

- d'appel réseau : `eslint.config.ts` refuse `fetch` dans un module hors de sa
  porte bornée, et ce module n'en a pas — c'est **l'adapter** qui parle au
  fournisseur ;
- de composant React : l'écran qui téléverse appelle `fetch`, donc il vit dans
  `apps/web`, comme `app/public-form.tsx` (s11) et `app/auth-form.tsx` (s07).
  Ce module n'a pas de second point d'entrée de présentation (ADR 024) ;
- de `@repo/db` (ADR 020) : la connexion est injectée ;
- de nom de fichier venu du client, nulle part : ni dans la clé, ni dans la
  table, ni dans une réponse. Il n'est pas assaini — **il n'est pas lu** ;
- de clé d'objet dans une réponse d'erreur ou un journal : elle porte
  l'identifiant du propriétaire.

## Tests

`src/domain/storage-rules.test.ts` pour les règles pures ; `tests/storage.test.ts`
à la racine pour ce qui traverse les packages (câblage, base, purge réelle) ;
`e2e/storage.spec.ts` pour ce qu'aucun test de nœud ne voit.

**Sans base, `tests/storage.test.ts` le dit** plutôt que d'exploser : les cas qui
en dépendent sont `describe.runIf`, ceux qui parlent de modularité s'exécutent
quand même — la doublure d'`auth` ne lit alors pas la connexion —, et un dernier
cas, « la base de données de la suite est joignable », échoue en nommant
`docker compose up -d`. Même forme que `tests/organizations.test.ts`. Une pile
`Cannot read properties of undefined` à la place, c'est un agent qui croit avoir
cassé le module alors qu'il n'a pas de Postgres.

**Ce qui a été prouvé par mutation** — le compte est le nombre de cas passés au
rouge, et le nombre de lignes du tableau est le nombre de neutralisations
essayées. Dans le `domain`, **trois** :

| Neutralisation | Cas rouges |
|---|---|
| `validateStoredAvatar` rend le type déclaré | 2 |
| garde de préfixe retirée de `keyBelongsTo` | 2 |
| barre oblique finale retirée de `scopePrefix` | 3 |

Dans le câblage (`tests/storage.test.ts`), **quatorze** — les huit de la
première écriture, les quatre posées par les corrections de la revue, et les
deux du tour de clôture :

| Neutralisation | Cas rouges |
|---|---|
| contrôle de périmètre retiré de `readFile` | 2 |
| garde de périmètre retirée de `confirmAvatar` (`servedKeyOf` contournée) | 1 |
| objet hostile laissé dans le stockage après un refus | 1 |
| purge qui supprime la ligne sans l'objet | 1 |
| objet précédent non supprimé au remplacement | 1 |
| `localUpload === null` → sert au lieu de 404 | 1 |
| repli silencieux sur le stockage local sans configuration | 2 |
| promotion retirée : la clé présignée devient la clé servie | 5 |
| `avatarOfUser` fabrique son propre `{ kind: 'user' }` | 1 |
| `cache-control` → `public, max-age=31536000` | 1 |
| garde d'origine du seau retirée (`config/security.ts`) | 1 |
| refus du stockage local sous `NODE_ENV=production` retiré | 1 |
| motif d'un rejeu confondu avec une clé inconnue (`already_confirmed` retiré) | 1 |
| `already_confirmed` rendu sans comparer la clé servie de la ligne | 1 |

Et au navigateur, **trois** — visibles nulle part ailleurs :

| Neutralisation | Parcours rouges |
|---|---|
| jeton de fraîcheur retiré de `fileUrl` | 1 |
| `ownerOf` rendu à `dataOwnerOf` (l'organisation active) | 1 |
| branche du rejeu retirée d'`avatar-form.tsx` (tout 404 redevient « envoi invalide ») | 1 |

La première est ce qui l'a fait trouver : un remplacement laissait le même
`src`, donc la même image à l'écran, alors que la base et le stockage étaient
corrects. La seconde est le constat F1 : sous une organisation courante, la
photo du compte disparaissait de `/account`. La troisième tient le **message**
d'un envoi rejoué, qui vit dans l'application et non dans le module : aucun test
de nœud ne voit les trois.

Le message est le seul morceau de ce module dont le filet soit **uniquement** au
navigateur — le dépôt n'a pas d'environnement de rendu de composants, et il n'en
gagne pas un pour ce cas. Le contrat que ce parcours suppose, lui, est tenu côté
nœud : `tests/storage.test.ts` fixe le couple « 404 + `already_confirmed` », le
parcours fixe ce que l'écran en fait.
