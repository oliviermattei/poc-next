---
story: s56-roles-de-session
validated: yes
---

# Plan — s56-roles-de-session

> Planifié contre `dev` au commit `043e57b`, qui porte la recherche de cette story. Elle est datée de `8e3678f`, un commit de documentation en arrière : rien à revérifier.

## Ce que la story est vraiment

Pas un mécanisme à construire — **une valeur à fournir**. `sessionOf` (`auth/src/domain/session.ts:23`) recopie déjà les rôles qu'on lui donne. Son unique appelant écrit `roles: []` en dur (`better-auth-service.ts:1210`), sous un commentaire annonçant que « les rôles arriveront avec s17 ». `s17` est livrée depuis longtemps, et elle a livré autre chose.

Et le patron pour fournir cette valeur est **déjà écrit trois fois** dans `AuthDependencies` (`application/ports.ts:493`), pour `purgeScope`, `soleOwnerships` et `releaseOrganizations` : *« Le module ne connaît pas le registre — il ne peut pas… Il reçoit donc la fonction, exactement comme il reçoit son mailer »*, avec la conséquence module coupé posée **par la valeur, jamais par une condition sur un nom de module**. `s56` ajoute la quatrième.

## La décision qui compte : où se paie la lecture

La recherche pose la question et refuse de la trancher seule. Voici la réponse, et sa raison.

**Ni à chaque requête, ni jamais : seulement quand le produit s'en sert.** Lire les rôles à chaque résolution de session est correct pour le critère 5 (un rôle retiré ferme immédiatement) mais ajoute une requête sur **le chemin le plus chaud du produit** — celui dont `s37b2` vient de retirer deux requêtes il y a deux heures. Les porter dans la session serait rapide et périmerait, ce qui rate le critère 5.

La sortie est de **dériver du registre** : si aucun module activé ne déclare de protection `role`, personne ne peut consulter `session.roles`, et la lecture ne sert à rien. Le point de composition le sait — il construit le registre — donc il branche la fonction **ou la constante vide**, sans qu'aucun fichier n'écrive un nom de module ni un nombre. Un produit qui n'utilise pas le niveau ne paie rien ; celui qui l'utilise paie une lecture par résolution, et sa révocation est immédiate.

`tests/marketing.test.ts` compte désormais les requêtes d'un rendu **authentifié** (`s37b2`, constat F3) : c'est cette commande qui rougira si la dérivation est ratée.

## Tâches

- [x] **1. La quatrième fonction injectée.** `platformRolesOf(userId)` dans `AuthDependencies`, documentée comme ses trois sœurs, et branchée au point de composition. Module `admin` coupé : liste vide **par la valeur**.
- [x] **2. `resolveActiveSession` cesse de mentir.** Le `roles: []` en dur disparaît. Mutation : le remettre doit rougir en nommant une route servie à qui la porte.
- [x] **3. La dérivation du registre.** La lecture n'est branchée que si un module activé déclare au moins une protection `role`. Rien n'écrit de nom de module. Mutation : brancher inconditionnellement doit rougir sur le **compteur de requêtes** d'un rendu authentifié.
- [x] **4. Une route `role` est servie à son porteur, et répond 404 aux autres.** Les deux routes du module de démonstration sont aujourd'hui inatteignables : elles deviennent le seul exemple exécutable du mécanisme. **Attention** : le répartiteur répond **403** à une protection `role` non satisfaite — le plan ne change pas cette règle ici, mais le critère 2 demande 404. Trancher dans la story : soit le répartiteur répond 404 pour ce niveau comme pour les autres, soit le critère se lit sur la garde du module. **Écrire la décision et sa raison** ; ne pas la laisser au lecteur. → **Tranché : 404 pour tout le monde, anonyme compris.** La décision, ses options rejetées et la raison survivante de laisser le back-office en `authenticated` vivent dans `docs/decisions/068-une-route-reservee-a-un-role-repond-404-a-tout-le-monde.md` (écrit en ronde de correction, constat 1 de la revue).
- [x] **5. L'entrée de navigation suit.** Rendue pour le porteur, absente pour les autres, **mesurée sur le rendu** et non sur le registre.
- [x] **6. Un rôle retiré ferme, sans nouvelle connexion.** Mesuré côté serveur : la même session, après retrait, ne sert plus. C'est le critère qui interdit de mettre les rôles en cache.
- [x] **7. Les cas négatifs, partout.** Le correctif **inverse la charge du défaut** : jusqu'ici un tableau vide refusait tout, donc une erreur fermait ; désormais une erreur ouvre. Chaque critère porte son cas négatif — un compte sans rôle, un rôle voisin, un rôle retiré — et les mutations vont dans ce sens : élargir, jamais restreindre.
- [x] **8. Module `admin` coupé, rien ne s'ouvre.** Aucune route `role` ne devient accessible par défaut. `pnpm test:minimal-profile` le tient sans nommer le module.

## Ce que la story ne fait pas

Elle ne déplace pas la garde du back-office : `s37b2` a posé ses routes en `authenticated` avec sa propre garde **parce que** ce niveau ne fonctionnait pas, et les rebasculer serait une seconde story, pas un effet de bord de celle-ci. Elle n'invente pas de vocabulaire de rôles : `admin_platform_role.role` est un `text` libre, et ce qui n'est pas superadmin aujourd'hui n'existe pas.

## Sections de `docs/security.md` touchées

**Autorisation vérifiée côté serveur** — c'est le cœur de la story. **Révocation appliquée côté serveur** : un rôle retiré ferme sans attendre une reconnexion. **404 plutôt que 403** : la tâche 4 tranche laquelle des deux lectures s'applique au niveau `role`, et l'écrit.
