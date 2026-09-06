# Research — Story s56-roles-de-session

> Vérifiée contre la branche par défaut au commit `8e3678f`, en lecture seule. Aucune base, aucun conteneur, aucun worktree.

## Les cinq faits structurants

1. **Un seul appelant ment, et le domaine est déjà correct.** `sessionOf` (`packages/modules/auth/src/domain/session.ts:23`) reçoit un compte et **recopie ses rôles** : `return { userId: account.userId, roles: [...account.roles] }`. Rien n'est à changer dans le domaine. C'est son unique appelant qui écrit `roles: []` en dur — `better-auth-service.ts:1210`, dans `resolveActiveSession`, sous un commentaire annonçant que « les rôles arriveront avec s17 ». La story tient donc en une valeur à fournir, pas en un mécanisme à construire.

2. **Le module d'authentification ne peut pas lire les rôles lui-même, et le dépôt a déjà résolu ce problème trois fois.** Les rôles de plateforme vivent dans `admin_platform_role` (`packages/modules/admin/src/schema.ts:28`), et c'est `admin` qui déclare `requires: ['auth']`, pas l'inverse : `auth` qui lirait `admin` fermerait le cycle. Le patron existe, écrit noir sur blanc dans `AuthDependencies` (`application/ports.ts:493`) pour `purgeScope`, `soleOwnerships` et `releaseOrganizations` : *« Le module ne connaît pas le registre — il ne peut pas… Il reçoit donc la fonction, exactement comme il reçoit son mailer, et le point de composition de l'application la branche. »* Et la conséquence module coupé y est déjà écrite : *« la liste est vide… **par la valeur, jamais par une condition sur un nom de module** »*. `s56` ajoute une quatrième fonction de cette famille ; elle n'invente rien.

3. **La lecture existe déjà, du bon côté.** `PlatformRoleRepository.superadminsAmong(userIds)` (`admin/src/application/ports.ts:41`) répond exactement à la question « lesquels de ces comptes sont superadmins », et `s37b2` s'en sert déjà pour la colonne des droits. Ce que `s56` demande est la même lecture pour **un** compte, au moment où sa session est résolue.

4. **Le seul consommateur du niveau est une ligne.** `packages/core/src/protection.ts:44` : `return protection.level !== 'role' || session.roles.includes(protection.role)`. Deux modules déclarent aujourd'hui une protection `role` — les deux routes du module de démonstration (`demo-item-routes.ts:91` et `:157`, rôle `admin`). Le back-office, lui, ne s'appuie pas dessus : `s37b2` a délibérément posé ses routes en `authenticated` avec sa propre garde, **parce que** le niveau ne fonctionnait pas.

5. **Le coût de la lecture tombe sur le chemin le plus chaud du produit.** `resolveActiveSession` est appelé à chaque requête servie par le répartiteur et à chaque rendu authentifié. `s37b2` vient précisément de **retirer** deux requêtes de ce chemin (constat F3 de sa revue) ; y rajouter une lecture de rôles sans y penser rendrait ce gain. Le compteur de requêtes de `tests/marketing.test.ts` couvre désormais un rendu authentifié — il rougira, et c'est tant mieux.

## Points d'ancrage

- `packages/modules/auth/src/infrastructure/better-auth-service.ts:1197-1215` — `resolveActiveSession`, et le `roles: []` à remplacer.
- `packages/modules/auth/src/domain/session.ts:23` — `sessionOf`, déjà correct.
- `packages/modules/auth/src/application/ports.ts:493-560` — `AuthDependencies` et les trois fonctions injectées qui servent de patron.
- `packages/modules/admin/src/application/ports.ts:41` — `superadminsAmong`.
- `packages/core/src/protection.ts:44` — l'unique consommateur.
- `packages/modules/demo-enabled/src/presentation/demo-item-routes.ts:91,157` — les deux seules routes `role` du dépôt.
- `apps/web/lib/auth.ts:90` — `configureAuth`, le point de composition qui branchera la fonction.

## Pièges & contraintes

- **Le sens du défaut s'inverse au correctif.** Aujourd'hui le tableau vide **refuse** tout : une erreur ferme. Demain il ouvre. Chaque critère doit donc porter son cas négatif — la mutation utile n'est pas « les rôles ne sont pas lus » mais « les rôles sont lus trop largement ».
- **Une session en cours ne doit pas garder un rôle retiré.** Le critère 5 l'exige, et `docs/security.md` aussi : la révocation s'applique côté serveur. Si les rôles sont lus à chaque résolution, c'est acquis ; s'ils sont mis en cache dans la session, ça ne l'est pas — et c'est exactement le compromis que la performance pousse à prendre.
- **404 et non 403.** Le répartiteur répond 403 à une protection `role` non satisfaite (`registry.ts`), ce que `s37a` puis `s37b2` ont contourné en gardant dans le module. Rendre le niveau fonctionnel **ne change pas** cette règle : le plan doit dire ce que le répartiteur répond, et pourquoi c'est acceptable pour une route de démonstration et pas pour un back-office.
- **Le module `admin` coupé ne doit rien ouvrir** : la fonction injectée rend une liste vide, par la valeur.
- **Ne pas confondre avec les permissions d'organisation** : `packages/modules/organizations/src/domain/permissions.ts:14` prend soin d'écrire qu'elles ne sont **pas** ce niveau-là.

## Questions ouvertes

- **Les rôles sont-ils lus à chaque résolution de session, ou portés par la session ?** La première est correcte pour le critère 5 et coûte une requête sur le chemin chaud ; la seconde est rapide et périme. Le plan doit trancher et mesurer ce qu'il choisit — `tests/marketing.test.ts` compte désormais les requêtes d'un rendu authentifié.
- **Le niveau `role` prend-il des rôles autres que `superadmin` ?** `admin_platform_role.role` est un `text` libre et son index d'unicité est `(userId, role)` : rien ne limite le vocabulaire. Décider si `s56` expose tous les rôles trouvés ou seulement ceux d'un vocabulaire déclaré.
- **Que deviennent les deux routes du module de démonstration ?** Elles sont aujourd'hui inatteignables. Une fois le niveau fonctionnel, elles deviennent le seul exemple exécutable du mécanisme — donc le lieu naturel du parcours de bout en bout du critère 4.

## Complexité réelle

Notée **2** dans `docs/stories.md`. **Ma note : 2.** Le domaine est correct, la lecture existe, le patron d'injection est écrit et utilisé trois fois. Ce qui coûte n'est pas le code : c'est de tenir les cas négatifs, puisque le correctif transforme un défaut qui ferme en un défaut qui ouvrirait.
