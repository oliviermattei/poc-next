---
story: s34-account-deletion
validated: yes
---

# Plan — s34-account-deletion

> Planifié contre `dev` au commit `31fb2c2`, sur une recherche du même jour. **Le critère 4 a été corrigé avant ce plan**, sur mesure : il citait un exemple que le produit contredit.

## Ce que la story est réellement

`purgeModules` existe dans le socle (`packages/core/src/registry.ts:401`), parcourt les modules **en ordre inverse** — l'ADR 029 veut que `requires` ordonne la purge — et **n'est appelée par rien**. Balayage sur `apps/` et `packages/` hors tests : aucun appelant.

C'est le motif exact que `s33` vient de fermer sur la clé `jobs`. **s34 branche `purgeModules`**, elle ne l'invente pas. Ce n'est pas « la story qui ajoute un écran de suppression ».

## Trois faits qui changent le travail

**1. La valeur de retour de `purgeModules` ne dit rien.** Elle rend `registry.moduleIds` — **tous** les identifiants, quoi qu'il se soit passé. Si une purge lève, la boucle s'interrompt et l'appelant ne peut pas savoir où. Le critère 2 exige « un module dont la purge échoue interrompt l'opération et la laisse rejouable » : il faut donc que l'appelant sache **ce qui a été purgé**, pas ce qui existe.

**2. Le critère 4 n'a aucun satisfaisant réel.** Une seule des seize catégories déclarées vaut `anonymize` — `demo-notes`, dans `demo-disabled`, jamais activé. Un test qui balaierait les catégories `anonymize` de la configuration livrée serait **vert sans rien vérifier**. Le critère corrigé l'exige explicitement : le mécanisme est éprouvé quand même.

**3. La règle que `s32` a posée est ce que le critère 3 va exercer.** Sa revue avait trouvé qu'une charge utile de notification portait l'adresse d'un tiers, et que la purge efface ce qui est *adressé à* un compte, jamais ce qui le *nomme*. D'où la scission `data`/`stored`. **s34 est la story qui vérifie que la règle tient** : après suppression, aucune ligne conservée ne doit nommer le compte effacé.

## Tâches

- [x] **1. `purgeModules` rend ce qu'elle a purgé.** Aujourd'hui elle rend `registry.moduleIds` sans rapport avec ce qui s'est passé. Elle doit rendre les modules effectivement purgés, dans l'ordre, et l'échec doit nommer **où** il s'est produit. Sans ça, le critère 2 n'est pas tenable. Mutation : lui faire rendre la liste complète après une purge qui lève doit rougir.
- [x] **2. L'idempotence, jouée deux fois.** `docs/reliability.md` : « proven by running it twice and observing one effect, never asserted in a comment. » Le critère 2 dit « laisse l'opération rejouable » — une suppression interrompue puis relancée aboutit **sans double effet**. Test à deux exécutions contre une base réelle, pas une assertion de commentaire.
- [x] **3. La confirmation est vérifiée côté serveur.** Saisie de l'email ou du nom d'organisation. Zod à la frontière, comparaison **serveur** — jamais un test côté client qui déciderait de l'appel. Mutation : déplacer la comparaison au client doit rougir.
- [x] **4. La suppression d'un compte efface partout, et rien ne le nomme plus.** C'est le critère 3, et c'est là que la règle de `s32` est éprouvée : après purge, **aucune ligne conservée ne porte l'identifiant ni l'adresse du compte effacé**. Le balayage est dérivé du contrat — il ne nomme aucun module — et porte son plancher : zéro module balayé rougit.
- [x] **5. Le mécanisme d'anonymisation, éprouvé sans satisfaisant réel.** Une catégorie `anonymize` voit le lien rompu sans qu'aucune donnée identifiante ne subsiste. Aucun module du socle n'en déclare : le test construit donc son propre module de test qui en déclare une, et **assertionne que le balayage réel en a trouvé zéro** plutôt que de faire semblant. Les deux moitiés comptent — le mécanisme marche, et la configuration livrée n'en a pas.
- [x] **6. Sessions révoquées, reconnexion impossible.** Le précédent existe : `s37a` a mesuré la révocation **sur une requête réellement servie**, pas sur la valeur de retour de l'appel. Reprendre cette forme.
- [x] **7. L'email de confirmation, et son moment.** Le critère ne tranche pas s'il part avant ou après. **Avant** : la suppression peut encore échouer, l'utilisateur reçoit un email faux. **Après** : l'adresse n'existe plus dans le produit. Décision à écrire, pas à subir — retenir l'adresse avant l'effacement et envoyer après, comme `organizations.purge` le fait déjà pour les invitations (précédent de s16).
- [x] **8. Avec ou sans le module de jobs.** Le critère 9 hérite du mécanisme livré par `s33` : module coupé, l'émission s'exécute dans la requête appelante, et un cas le mesure déjà. `createRecordingJobs` attendait son premier appelant — c'est ici.
- [x] **9. La suppression d'organisation : membres retirés, abonnement annulé.** Appel sortant vers le fournisseur de paiement, donc **délai explicite** et échec qui interrompt (`docs/reliability.md` §3). Le dernier propriétaire doit d'abord transférer ou supprimer : le message le précise, et le refus est un cas, pas une note.
- [x] **10. Un module non activé n'est pas appelé et ne laisse pas d'orphelins.** `pnpm test:minimal-profile` dérive déjà cette famille du contrat ; vérifier qu'il **balaie effectivement** la suppression plutôt que de le supposer.

## Si le plan déborde

Dix tâches, c'est la limite. La ligne de coupe, si l'exécution montre qu'il en faut plus : *la suppression de compte* d'un côté — tâches 1 à 8 —, *la suppression d'organisation* de l'autre — 9, plus l'annulation chez le fournisseur et la règle du dernier propriétaire. La seconde ne close seule que si la première a livré le mécanisme.

## Ce que la story ne fait pas

Elle ne change pas la rétention de `billing` : la décision du 05/09 est écrite dans les notes de la story. Elle n'ajoute pas de commande de restauration — ce serait `eject`, qui est au cimetière.

## Sections de `docs/security.md` touchées

Confirmation vérifiée **côté serveur** · Zod à la frontière · sessions révoquées et rotation · 404 plutôt que 403 sur la ressource d'autrui (supprimer l'organisation d'un tiers) · aucun secret ni donnée personnelle dans le journal de l'opération.
