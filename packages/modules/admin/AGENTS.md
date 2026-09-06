# packages/modules/admin — règles locales

L'administration de la **plateforme** : qui a le droit d'administrer le produit
lui-même, et la surface qui bannit un compte (s37a). Module **optionnel** :
coupé, aucune route de back-office n'est montée, aucun rôle de superadmin
n'existe, et plus personne ne peut bannir.

**La décision qui gouverne ce module est l'ADR 058, et elle est contre-intuitive :
l'état « banni » n'est pas ici.** Il vit dans `auth`, avec les comptes, parce que
la connexion appartient au socle et qu'un chemin du socle ne peut pas consulter un
module qui peut être absent. Ce qui vit ici est la **surface** qui change cet
état. Conséquence assumée : module coupé, un compte déjà banni **reste banni** —
le débannir serait un nettoyage, et le nettoyage est au cimetière du PRD.

## Les invariants, et la commande qui tient chacun

Ce qui a été éprouvé jusqu'ici — pas « tous ceux qui existent ». **Le tableau est
la liste** : un compte écrit à côté de lui vieillit à la ligne suivante.

| Invariant | Comment il est tenu | Ce qui échoue si on le casse |
|---|---|---|
| **Un compte qui n'administre pas reçoit 404**, jamais 403 | les routes sont `authenticated` et la garde répond `notFound()` — `RouteProtection.level: 'role'` rendrait 403 au répartiteur, ce qui confirmerait que le back-office existe | `tests/admin.test.ts` — le balayage de **toutes** les routes déclarées, dérivé du contrat |
| **Une plateforme sans superadmin répond 404 à tout le monde** | il n'y a alors aucune ligne, donc `isSuperadmin` est faux pour tous | `tests/admin.test.ts` |
| **Le dernier superadmin ne peut pas être révoqué** | le prédicat compte les restants **dans le `delete`**, sous `pg_advisory_xact_lock` : jamais une lecture qui décide suivie d'une écriture qui obéit. La règle pure `revocationRefusal` **nomme** ensuite le refus, sur des faits lus sous le même verrou — un seul vocabulaire, du refus en base jusqu'au corps de la réponse | `tests/admin.test.ts` (« refuse de révoquer le dernier ») ; mesuré : retirer le prédicat du `delete` rougit 2 cas, neutraliser `revocationRefusal` en rougit 2 dont un d'intégration |
| **Le dernier superadmin ne peut pas être banni** (revue de s37a, F2) | `banRefusal` décide sur des faits lus **sous le même verrou** que la révocation, et le bannissement du socle s'exécute **verrou tenu** : aucune révocation ne se glisse entre la décision et l'écriture. Le refus est un 409, jamais un 404 — l'appelant administre et connaît la cible | `tests/admin.test.ts` (« refuse de bannir le dernier superadmin », « resté seul après la révocation de son pair », « tient le verrou du rôle de plateforme pendant le bannissement ») ; mesuré : neutraliser `banRefusal` rougit 4 cas, retirer le verrou du garde en rougit 1 |
| **La désignation ne nomme que le *premier*** | `designatesFirstSuperadmin` refuse dès qu'il existe un superadmin — sinon révoquer le compte de la variable ne servirait à rien | `admin-rules.test.ts`, et `tests/admin.test.ts` (« ne redésigne personne ») |
| **La désignation est rejouable sans effet supplémentaire** | l'unicité est tenue **par la base** (`admin_platform_role_unique`) et l'insertion est `on conflict do nothing` | `tests/admin.test.ts` (« une seule ligne, quel que soit le nombre d'appels ») |
| **L'accès est décidé avant que le corps soit jugé** | `asSuperadmin` enveloppe `withTarget`, jamais l'inverse : un non-superadmin ne distingue pas un corps valide d'un corps invalide | `tests/admin.test.ts` (« décide de l'accès **avant** de juger le corps ») |
| **Le pouvoir suit la ligne, pas le jeton de session** | le rôle est relu en base à chaque requête ; rien ne le met en cache (ADR 030) | `tests/admin.test.ts` (« administre à l'instant et sans reconnexion ») |
| **Le module ne lit aucune variable d'environnement** | l'adresse désignée arrive par `ConfigureAdminOptions.designatedEmail` | `pnpm lint` (règle transverse `process.env`) |
| **Le module ne lit aucune table de `auth`** | il ne connaît que `AdminAccountsPort` ; le seul import de `@repo/module-auth` est la clé étrangère de `src/schema.ts` | relecture, et le compilateur : rien d'autre n'est exporté vers ce module |
| **Tout décompte de superadmins compte ceux qui peuvent se connecter** (s37b1) | le dépôt lit les identifiants des porteurs du rôle **sous le verrou**, puis demande au port lesquels sont fermés. Trois décomptes partagent cette lecture — révocation, garde-fou de bannissement, désignation. La **promotion ne compte rien** : elle ne lit ni les identifiants ni le port, elle partage le **verrou**, parce que la ligne qu'elle ajoute est comptée par le prédicat de la révocation | `tests/admin.test.ts` — les deux séquences mesurées en revue de `s37a` ; mesuré : ignorer les comptes fermés dans le prédicat de révocation rougit 1 cas, les recompter dans le garde-fou du bannissement en rougit 1, retirer le verrou de la **promotion** rougit le cas concurrent |
| **Une lecture des comptes en échec refuse** | `readState` rend `{ ok: false }`, et les deux gardes répondent `accounts_unavailable` — jamais « personne n'est banni » | `tests/admin.test.ts` (« refuse de bannir quand l'état des comptes n'a pas pu être lu ») ; mesuré : lire l'échec comme « aucun compte fermé » rougit 1 cas |
| **Une session empruntée n'administre jamais** (s37b1) | `asSuperadmin` demande au port si la session de l'appelant est empruntée, **avant** de juger le rôle, et refuse en 404 ; fail-closed si la lecture échoue | `tests/admin.test.ts` (« refuse le back-office à une session empruntée, même quand le compte emprunté administre ») ; mesuré : retirer la garde rougit 1 cas |
| **Emprunter une session fait tourner la session, aux deux bouts** | l'entrée remplace celle de l'appelant, la sortie remplace celle qui était empruntée ; le socle écrit les deux (ADR 064) | `tests/admin.test.ts` (« l'ancienne cesse de valoir ») ; mesuré : ne pas révoquer la session remplacée rougit 1 cas |
| **Aucune session ouverte par ce dépôt n'échappe au refus du socle** (revue s37b1, C1 et MJ1) | l'écriture de session porte la garde **dans son `insert`** (`insert … select … from auth_user where banned = false`) : le crochet de la bibliothèque ne voit pas ce chemin, la condition, si | `tests/admin.test.ts` (« refuse d'emprunter un compte banni ») **et** `tests/lint-rules.test.ts`, qui exige un **seul** écrivain de `auth_session` dans le dépôt ; mesuré : reprendre un `insert().values()` rougit 2 cas |
| **Un emprunt meurt avec le droit qui l'a ouvert** (revue s37b1, C3) | bannir l'emprunteur efface aussi les sessions qu'il **tient** (`revokeAllForUser` filtre les deux sens) ; lui retirer le rôle appelle `endBorrowsBy`. Les deux journalisent la fin | `tests/admin.test.ts` (« éteint la session empruntée quand l'emprunteur est banni », « … quand le rôle de l'emprunteur est révoqué ») |
| **L'échéance d'un emprunt tient** (revue s37b1, C2) | la fenêtre glissante de la bibliothèque ne prolonge jamais une ligne empruntée (`auth/infrastructure/session-refresh-adapter.ts`) : sans cela, la première lecture portait l'heure annoncée à sept jours | `tests/admin.test.ts` (« ne prolonge pas une session empruntée à la première lecture », et son témoin inverse pour les sessions ordinaires) |
| **Un emprunt est journalisé aux deux bouts, sur les fins balayées ci-dessous** | début et fin nomment les deux comptes ; la fin est écrite par la sortie, le bannissement, le retrait du rôle **et** le balayage des échus, qui efface les lignes — donc le rejeu n'émet rien de plus | `tests/admin.test.ts` (« journalise le début et la fin », « compte l'expiration d'un emprunt comme une fin ») et `tests/jobs.test.ts`, qui éprouve la **cadence** du balayage, pas sa seule présence ; mesuré : retirer l'un ou l'autre journal rougit 1 cas chacun, et une cadence annuelle rougit 1 cas |

## Imports autorisés

- `@repo/core` pour le contrat de module, le préfixe de montage et les types de
  route ;
- `@repo/module-auth` **uniquement dans `src/schema.ts`** — la clé étrangère de
  `admin_platform_role` vers `auth_user`, permise parce que `auth` est un
  `requires` déclaré (ADR 018). Ailleurs, c'est la borne qui garde les lectures
  de comptes derrière le port injecté, donc derrière un identifiant plutôt
  qu'une adresse (`docs/security.md` §7). L'exception est
  `tests/admin.test.ts`, qui est une suite, pas le module ;
- `drizzle-orm` pour les déclarations de table et les requêtes ;
- `zod` pour valider ce qui entre par une route, **ou par l'adresse d'un écran**
  (s37b2 : la recherche, la pagination, l'identifiant d'une session visée) ;
- `@repo/ui` pour **tout** ce qui s'affiche, `lucide-react` pour les icônes et
  `react` en `peerDependencies` — **dans `src/presentation/` seulement**,
  arrivés avec s37b2 et ses quatre écrans. Un import de `@radix-ui/*` est refusé
  par `pnpm lint` (ADR 022) : le baril `@repo/ui` est la seule frontière ;
- `@repo/typescript-config` pour la configuration du compilateur
  (`tsconfig.json`).

Ce module n'importe **jamais** `@repo/db` : il reçoit sa connexion de son point
de composition (`apps/web/lib/admin.ts`), sous la forme réduite des opérations
qu'il utilise (ADR 020). La règle est tenue par `pnpm lint`.

## Ne doit jamais contenir

- de règle métier hors de `domain/` — `application/` orchestre,
  `infrastructure/` exécute, `presentation/` traduit en HTTP ;
- de lecture des tables du module `auth` : le port `AdminAccountsPort` est la
  seule surface, et il part d'un identifiant de compte. La seule fonction qui
  parte d'une **adresse** (`findIdByEmail`) n'est appelée qu'avec la valeur de
  la configuration, jamais avec une valeur reçue d'une requête ;
- de **403** sur une route de back-office : un 403 confirme que le back-office
  existe. Le refus est un 404, celui d'une URL inventée. Le 409 de la
  révocation n'y contrevient pas — l'appelant **est** superadmin, il connaît la
  cible ;
- de motif de bannissement dans le journal de sécurité : c'est un texte libre
  écrit par un humain, il peut nommer une personne. Le journal dit qui a banni
  qui, pas pourquoi ;
- de commande de nettoyage : un module activé puis désactivé conserve ses
  tables et ses données.

## Ce que cette tranche ne fait pas

`s37b1` a livré le décompte corrigé et l'**impersonation** (ADR 064) ; `s37b2` a
livré les **écrans** — listes, détails de compte et d'organisation, bandeau
d'impersonation, révocation de session et réinitialisation de mot de passe.
Restent dehors : les inscriptions publiques et l'export (`s37c`), et la
**confirmation d'une action irréversible** — `ConfirmDialog` et `AlertDialog` ne
sont pas livrés par le design system (lacune relevée par `s34b`, toujours
ouverte). La révocation est donc un `Button` `destructive` dont le libellé nomme
l'effet.

## Ce que les écrans ajoutent, et où vit leur garde (s37b2)

**La garde est écrite une fois**, dans `application/admin-use-cases.ts`
(`authorizeBackOffice`) : les routes du module et ses écrans posent la même
question, et deux copies auraient divergé au premier acteur ajouté. Elle refuse
une session **empruntée** avant de juger le rôle, relit le rôle en base, et
journalise le refus — la réponse, elle, ne distingue rien.

**Les écrans sortent par un second point d'entrée**,
`@repo/module-admin/presentation` (ADR 024) : le barril principal ne réexporte
aucun `.tsx`, `config/features.ts` étant lu par `pnpm db:generate` et `pnpm ks`,
qui ne compilent pas de JSX.

**Le back-office lit les organisations par un second port**,
`AdminOrganizationsPort`. Ce module ne déclare pas `organizations` dans ses
`requires` : il ne peut ni l'importer, ni joindre ses tables. Module coupé, ce
port rend des listes vides — **aucune méthode ne dit si le module existe**, et
aucun écran ne porte de condition sur un identifiant de module. Ce qui disparaît
alors est l'**entrée de navigation**, déclarée par `organizations` lui-même sur
la surface `admin` (ADR 066).

| Invariant de s37b2 | Comment il est tenu | Ce qui échoue si on le casse |
|---|---|---|
| **Un écran du back-office répond 404 à qui n'administre pas**, jamais 403 | `authorizeBackOffice`, la même garde que les routes | `tests/admin.test.ts` (« répond 404 à un compte qui n'administre pas, sans lire un seul compte », et deux témoins sur le détail et les organisations) |
| **Un refus n'atteint pas la couche de données** | la garde passe avant la lecture, et le cas compte les appels au port | `tests/admin.test.ts`, même cas |
| **Une lecture en échec refuse au lieu de dire « vide »** | `viewAccounts` rend `unavailable`, l'écran rend une `Alert` | `tests/admin.test.ts` (« refuse la liste quand la lecture des comptes échoue ») |
| **Une révocation de session s'applique côté serveur** | le socle efface la ligne ; le cas mesure que le **cookie ne désigne plus personne** | `tests/admin.test.ts` (« révoque une session, et le serveur cesse de la servir ») |
| **Une session d'un autre compte n'est pas révocable** | la condition est dans l'écriture du socle, pas dans une lecture préalable | `tests/admin.test.ts` (« ne révoque pas la session d'un autre compte ») |
| **Aucune adresse n'entre par le back-office** | la réinitialisation part d'un **identifiant** ; le socle relit l'adresse (`AuthService.requestPasswordResetFor`) | `tests/admin.test.ts` (« déclenche une réinitialisation vers l'adresse du compte visé ») |
| **Une recherche portant `%` ne rend pas la table entière** | les jokers de `like` sont échappés avant d'être liés | `tests/admin.test.ts` et `tests/organizations.test.ts` (« cherche un pour-cent ») |
| **L'entrée « organisations » du back-office disparaît avec son module** | elle est déclarée par `organizations` (`surface: 'admin'`) et dérivée du registre | `pnpm test:minimal-profile`, et `tests/admin.test.ts` (« l'entrée du back-office se dérive du registre ») |
| **La colonne « Droits » distingue réellement un superadmin** | `superadminsAmong` relit la table du rôle pour la page affichée, et la vue en tire `superadmin` ligne par ligne | `tests/admin.test.ts` (« sert une page de comptes, et la recherche la réduit ») — **la ligne manquait** : `superadminsAmong` rendant `[]` laissait toute la suite verte, et l'écran aurait dit « aucun droit » pour tout le monde, superadmins compris (revue de s37b2, constat F5). Le cas mesure les **deux** états ; « faux partout » est ce que le défaut produisait |
| **Le vocabulaire emprunté aux autres modules est traduit** | l'écran construit `admin.subscription.<état>` et `admin.role.<rôle>` depuis des valeurs qui viennent de `billing` et d'`organizations`, et `intl.t` **lève** sur une clé absente | `tests/admin.test.ts` (« le vocabulaire emprunté par le back-office ») — il **dérive** les deux listes de leur module d'origine (`BILLING_DISPLAY_STATES`, `ORGANIZATION_ROLES`) et les locales du contrat de ce module : un septième état d'abonnement ou un quatrième rôle rougit ici au lieu de mettre l'écran en 500 |
| **La coquille n'ouvre aucune lecture pour afficher le bandeau d'emprunt** | l'emprunteur arrive avec la session, dans la résolution que `currentViewer()` a déjà payée (`AuthService.resolveActiveSession`) | `tests/marketing.test.ts` (« n'émet aucune requête propre pour un compte connecté ») pour le coût, et `tests/admin.test.ts` (« rend l'emprunteur avec la session ») pour la lecture elle-même — la colonne `impersonated_by` appartient à ce dépôt, pas à la bibliothèque, et ce second cas est ce qui rend sa traversée opposable |

**Ce que le module coupé emporte avec lui, depuis `s37b1`** : plus aucune
impersonation ne s'ouvre, et une impersonation **en cours ne peut plus être
rendue à la main** — sa route de sortie est ici. Elle expire d'elle-même (une
heure, `AuthPolicy.impersonationTtlSeconds`, et l'échéance tient : la fenêtre
glissante de la bibliothèque ne prolonge pas une ligne empruntée), mais personne
n'émet alors sa fin : le balayage est déclaré par ce module. C'est le prix
assumé d'une surface optionnelle posée sur un état du socle, le même que pour le
bannissement (ADR 058).

### Comment un emprunt se termine — les sept fins balayées

**Ce tableau est ce qui a été balayé** — les écritures qui effacent une ligne de
`auth_session` portant un emprunteur —, pas la liste de ce qui existe. Une
huitième fin ouverte par une story suivante ne s'y inscrira pas toute seule.

| Fin | Journalisée ? |
|---|---|
| la sortie explicite (`/admin/impersonation/stop`) | **oui** |
| le bannissement de l'emprunteur ou de l'emprunté (`revokeAllForUser`) | **oui** |
| le retrait du rôle de l'emprunteur (`endBorrowsBy`) | **oui** |
| le balayage horaire des emprunts échus | **oui** |
| un emprunt échu **présenté** à la bibliothèque avant le balayage : `getSession` efface une session expirée | **non** — et c'est le cas pour lequel le balayage n'est pas fait : un emprunt abandonné n'est présenté par personne, le cookie portant `Max-Age=3600` |
| l'**effacement du compte** de l'emprunteur ou de l'emprunté (`purgeAccount`, s34, et la cascade de `auth_user`) | **non**, délibérément : la purge efface le compte que l'événement nommerait, et la cascade ferme les mêmes lignes sans passer par du code |
| le **changement d'adresse** de l'emprunteur : il révoque toutes ses sessions, emprunts compris (s37b1) | **non** — le module `admin` n'est pas dans ce chemin |

**Ce que le journal des emprunts ne garantit pas, dit plutôt que sous-entendu** :
les trois dernières lignes du tableau ci-dessus ferment un emprunt **sans**
émettre son événement de fin. Aucune ne laisse d'accès ouvert — la session est
effacée dans les trois cas ; ce qui manque est la ligne de journal, et elle
manque pour une raison écrite à chaque fois.

**L'impersonation passe outre le second facteur du compte emprunté**, et c'est
inhérent à la fonctionnalité telle qu'elle est demandée : la ligne de session est
écrite directement, aucun défi n'est posé au compte emprunté — il n'est pas là
pour y répondre. Un superadmin entre donc chez un client protégé par un second
facteur sans le présenter. Ce que cela veut dire pour qui décide d'activer ce
module : le rôle de superadmin **vaut** le second facteur de tous les comptes du
produit, et c'est le rôle lui-même qu'il faut protéger.

### Les chemins vers une plateforme inadministrable

L'état redouté est **« plus aucun superadmin capable de se connecter »**, et il
n'existe aucune commande qui le répare : il faut une écriture en base à la main.
Le tableau ci-dessous est ce qui a été **balayé** — les quatre écritures qui
retirent le rôle ou empêchent son porteur d'entrer —, pas la liste de ce qui
existe. Un cinquième chemin ouvert par une story suivante ne s'y inscrira pas
tout seul.

| Chemin | État | Se répare seul ? |
|---|---|---|
| révoquer le rôle du dernier superadmin | **fermé** : prédicat de comptage dans le `delete`, sous verrou | — |
| bannir le compte du dernier superadmin (revue de s37a, F2) | **fermé** : `banRefusal` sous le même verrou, bannissement exécuté verrou tenu | — |
| `purgeAccount` (`auth`) efface la ligne `auth_user` du dernier superadmin, et `admin_platform_role.user_id` est en `cascade` : le rôle part avec le compte, sans garde. **Vivant depuis s34** : `POST /api/modules/auth/delete-account` appelle `purgeModules`, et c'est la cascade qui emporte le rôle | **ouvert** | **oui** : le décompte retombe à 0, donc la désignation par `SUPERADMIN_EMAIL` se redéclenche |
| bannir un superadmin qui **n'est pas** le dernier — permis, c'est de la modération entre pairs — puis **se bannir** ou **révoquer son pair** : la révocation et le garde-fou comptaient des **lignes**, ils ne savaient pas laquelle appartient à un compte banni | **fermé depuis s37b1** : les trois écritures comptent les superadmins **capables de se connecter**, l'état « banni » venant du port sous le verrou | — |
| promouvoir un compte **banni** pendant qu'une révocation est en vol : la ligne neuve était comptée comme un survivant par le prédicat du `delete` | **fermé depuis s37b1** : `grantSuperadmin` prend le même verrou consultatif que les deux autres écritures | — |

**Et depuis `s37b1`, une réparation existe là où il n'y en avait aucune** : le
décompte de la **désignation** compte lui aussi les comptes capables de se
connecter, si bien qu'une plateforme dont tous les porteurs du rôle sont fermés
redevient désignable par `SUPERADMIN_EMAIL`. Elle ne couvre pas tout — si
l'adresse désignée est celle d'un compte lui-même banni, il n'existe toujours
aucune commande, et il faut une écriture à la main.

**L'asymétrie est ce qu'il faut retenir** : la purge se répare toute seule, le
bannissement briquait. C'est pour cela que le garde-fou du bannissement a été posé
et que celui de la purge n'a jamais été écrit — s34 a rendu le chemin vivant
sans en ajouter un, et la réparation reste la redésignation par
`SUPERADMIN_EMAIL`. **Ce que rien ne vérifie**, dit plutôt que sous-entendu :
aucun test n'exécute « le **dernier** superadmin supprime son compte » ; le
raisonnement repose sur la cascade déclarée dans `src/schema.ts` et sur le
décompte de `SUPERADMIN_EMAIL`, pas sur une mesure.

## `granted_by` : la colonne que la cascade n'atteint pas (s34, constat F1)

`admin_platform_role.granted_by` porte l'identifiant du superadmin **qui a
promu**, et il n'a **aucune** clé étrangère — délibérément : effacer le
promoteur ne doit ni emporter la promotion, ni la bloquer. La conséquence
n'avait pas été tirée : la purge du module était vide, si bien que l'identifiant
d'un compte effacé survivait sur **chaque** rôle qu'il avait accordé. C'est la
colonne qui a fait mentir l'invariant de s34 — « aucune ligne conservée ne porte
l'identifiant du compte effacé » —, et le balayage ne l'avait pas vue parce
qu'aucun cas n'écrivait une telle ligne.

Le module déclare donc **une** catégorie de données, `grant-authorship`, en
rétention **`anonymize`** — la seule du dépôt à ce jour. `anonymize` et non
`erase` parce que les deux mots ne décrivent pas la même ligne : effacer la
ligne retirerait son rôle à un tiers et pourrait rendre la plateforme
inadministrable. Ce qui part est le **lien**, pas la donnée, et
`PlatformRoleRepository.forgetGranter` est ce qui le rompt.

Le **rôle** lui-même n'a pas de catégorie et n'en a pas besoin : `user_id` est
en cascade, il n'y a rien à décider de son sort. La commande qui échoue si tout
cela cesse d'être vrai : `pnpm test`, cas « ne survit sur aucun rôle accordé
après l'effacement du promoteur » (`tests/account-deletion.test.ts`) — vider la
purge du module le fait rougir.

Fermer le quatrième chemin demanderait que la révocation sache ce que ce module
ne sait pas : l'état « banni » vit dans `auth` (ADR 058) et n'est atteignable
que par `AdminAccountsPort`, qui ne l'expose pas. C'est un élargissement du port
— donc une décision de `s37b`, qui ouvre le back-office sur des listes de
comptes —, jamais une lecture directe des tables du socle.

## Tests

- les règles pures : `src/domain/admin-rules.test.ts`, à côté du code qu'elles
  couvrent — la règle du décompte lui-même (« quels comptes ne peuvent pas
  ouvrir de session ») vit dans le socle, avec l'état qu'elle lit :
  `packages/modules/auth/src/domain/ban.ts` ;
- ce qui traverse la base, le répartiteur et le module `auth` :
  `tests/admin.test.ts` à la racine du dépôt.
