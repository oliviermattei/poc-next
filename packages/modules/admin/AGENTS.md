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
- `zod` pour valider ce qui entre par une route ;
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

Les listes, les détails d'utilisateur et d'organisation et l'impersonation sont
`s37b` ; les inscriptions publiques, `s37c`. Aucune entrée de navigation ne mène
au back-office, faute d'écran à servir.

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
| bannir un superadmin qui **n'est pas** le dernier — permis, c'est de la modération entre pairs — puis révoquer son pair : la révocation compte des **lignes**, elle ne sait pas laquelle appartient à un compte banni | **ouvert** | **non** : la ligne du banni reste, le décompte rend 1, la désignation ne se redéclenche jamais |

**L'asymétrie est ce qu'il faut retenir** : la purge se répare toute seule, le
bannissement brique. C'est pour cela que le garde-fou du bannissement a été posé
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
  couvrent ;
- ce qui traverse la base, le répartiteur et le module `auth` :
  `tests/admin.test.ts` à la racine du dépôt.
