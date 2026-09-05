/**
 * Ce module n'a **aucun cas d'usage** : sa règle — trouver la tâche déclarée,
 * la dédupliquer, la reprendre, la journaliser — vit dans `@repo/core`, parce
 * qu'elle doit répondre quand ce module-ci est **coupé** (critère 8 de s33).
 *
 * C'est la même raison qui a mis `resolveDataOwner` et `allowsFeature` dans le
 * socle plutôt que dans le module qui les emploie. Le fichier reste, vide et
 * dit pourquoi : un dossier de couche absent se lit comme un oubli.
 */
export {}
