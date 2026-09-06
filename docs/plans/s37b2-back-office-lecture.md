---
story: s37b2-back-office-lecture
validated: yes
---

# Plan — s37b2-back-office-lecture

> Planifié contre `dev` au commit `6eeaa49`. La recherche est celle de `s37b` (`docs/research/s37b-back-office.md`), datée de `8d8539a`. Sa **tranche sécurité est livrée** : `s37b1` a corrigé le décompte sur les trois surfaces et livré l'impersonation. Ce qui reste ici est ce que la recherche appelle « le poids de cette tranche » : **le module n'a aucun écran**.

## Le fait qui décide de la première tâche

`Table` et `DataTable` sont annoncés par `docs/design-system.md` et **n'existent pas** — 16 des 32 composants nommés sont dans ce cas, mesuré le 06/09, et la note en tête de ce tableau le dit maintenant. Un back-office est fait de listes.

Le design (`docs/designs/s37b2-back-office-lecture.md`) tranche : **`Table` est livré dans `packages/ui`**, copie shadcn/ui sur Radix (ADR 022), pas réécrit dans le module. `DataTable` ne l'est pas : `Pagination`, `Input` et `EmptyState` composent déjà, et un composé sur un seul appelant serait la généralisation que le cimetière refuse.

## Tâches

- [x] **1. `Table` dans `packages/ui`.** Copie shadcn/ui sur Radix, thème sombre et jetons existants, aucun jeton neuf. Rien d'autre n'est livré dans `packages/ui` par cette story.
- [x] **2. La lecture des comptes, derrière le port.** Liste paginée avec recherche, **par le port injecté** — `packages/modules/admin/src/schema.ts:23` pose une borne : ce module lit les comptes par identifiant, jamais par une lecture directe d'`auth`. `s37b1` a élargi `AdminAccountsPort` ; l'élargir encore se fait par la même porte.
- [x] **3. `/admin/users` — la liste.** Recherche, pagination, quatre états. **Un non-superadmin reçoit 404, pas 403** : le répartiteur répond 403 à une protection `role` non satisfaite, ce qui confirmerait l'existence du back-office, donc la garde vit dans le module — la forme établie par `s37a`. Mutation : rendre la garde permissive doit rougir en nommant le 404 attendu.
- [x] **4. `/admin/users/<id>` — le détail.** Organisations, droits d'accès, sessions actives.
- [x] **5. Les deux actions du critère 3** : révoquer une session, déclencher une réinitialisation de mot de passe. La révocation s'applique **côté serveur** (`docs/security.md`) : le test mesure qu'une session révoquée ne sert plus, pas qu'un bouton a été cliqué.
- [x] **6. Les organisations, liste et détail — et leur disparition.** Membres, rôles, offre, état d'abonnement. **L'entrée du back-office se dérive du registre** : module `organizations` coupé, elle disparaît sans qu'aucun fichier ne nomme le module. C'est la forme que `s31` vient d'établir pour le pied de page ; `pnpm test:minimal-profile` doit la tenir.
- [x] **7. Le bandeau d'impersonation, permanent.** Il vit dans la **coquille applicative**, pas dans une page — c'est ce qui le fait survivre à une navigation complète. Le test navigue d'un écran à un autre et le mesure encore présent ; le mesurer sur un seul rendu ne prouverait rien.
- [x] **8. Le module coupé, et la navigation.** `adminNavigation` cesse de contribuer, aucune route ne répond. Vérifier que **la route publique n'existe pas** plutôt que de répondre 404 par la garde — la nuance est celle que `s39` vient de payer en CI.

## Ce que la story ne fait pas

Aucune écriture sur un compte hormis les deux actions du critère 3. Pas d'export (c'est `s37c`, optionnelle). Pas de `DataTable`, pas de `ConfirmDialog` — la lacune de la confirmation d'action irréversible est **reportée**, comme `s34b` l'avait déjà relevée, et non comblée en freestyle.

## Sections de `docs/security.md` touchées

**404 plutôt que 403** pour un non-superadmin. **Autorisation vérifiée côté serveur** — un écran caché n'est pas une garde. **Révocation appliquée côté serveur.** Zod aux frontières de recherche et de pagination. Aucune adresse en clair là où un identifiant suffit (la borne d'import du module).
