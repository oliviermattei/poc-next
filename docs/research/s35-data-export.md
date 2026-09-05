# Research — Story s35-data-export

> Vérifiée contre `dev` au commit `1c808e3`, en lecture seule. Aucune base, aucun conteneur, aucun worktree. **Un fait porte sur `feature/s34-account-deletion` (PR 29, non fusionnée)** et il est signalé comme tel.

## Les cinq faits structurants

1. **`exportModules` est la symétrique exacte de `purgeModules` avant `s34` : définie, réexportée, appelée par rien.** `packages/core/src/registry.ts:413` la définit, `index.ts:30` la réexporte, et le balayage sur `apps/` et `packages/` hors tests ne trouve **aucun appelant**. C'est le troisième membre de la même famille — après la clé `jobs` du contrat (fermée par `s33`) et `purgeModules` (fermée par `s34`). **s35 la branche ; elle ne l'invente pas.**

2. **Un commentaire livré par `s33` est déjà à moitié faux, et cette story le rend vrai ou entièrement faux.** `apps/web/lib/jobs.ts:121` écrit : « Le précédent existe et **il est exécuté** : `purgeModules` et `exportModules` sont synchrones depuis s03. » `purgeModules` est exécutée depuis `s34` ; `exportModules` ne l'est pas. La phrase était fausse quand elle a été écrite, elle est à moitié vraie aujourd'hui, et elle sera vraie quand cette story livrera — ou fausse dans l'autre moitié si elle ne le fait pas. À corriger dans tous les cas.

3. **`admin` déclarera une catégorie de données que son export ne produit pas** — dès la fusion de la PR 29. Mesuré sur la branche : `dataCategories: ['grant-authorship']`, `retention: { 'grant-authorship': 'anonymize' }`, `purge` réelle, et `export: async () => ({})`. Le contrat le permet : `dataCategories` liste, `purge` efface, `export` restitue, et **rien ne vérifie que les trois s'accordent**. C'est la question que cette story doit trancher — une catégorie qui s'efface mais ne s'exporte pas est-elle un défaut, ou une décision ? Pour `grant-authorship` la réponse n'est pas évidente : la ligne appartient au bénéficiaire, l'auteur du geste est un tiers. **À trancher explicitement, avec un garde qui rende la décision visible.**

4. **Les catégories déclarées se comptent, et le compte est le plancher du critère 1.** Balayage des seize modules : **six** déclarent au moins une catégorie et exportent réellement (`auth` 2, `billing` 4, `marketing` 2, `notifications` 2, `organizations` 3, `storage` 1, plus les deux modules de démonstration), **huit** déclarent zéro catégorie et rendent `{}` — ce qui est cohérent. Un test du critère 1 qui balaierait « les modules qui exportent » sans plancher passerait au vert sur une archive vide.

5. **Un seul module exporte autre chose que du JSON.** `storage` rend des fichiers (`export: (scope) => …useCases.export(ownerOf(scope))`). Le critère 6 exige « un schéma JSON documenté [qui] décrit le contenu de l'archive » : la place des fichiers dans ce schéma est la vraie question de forme de cette story, et elle n'est pas dans les critères.

## Target story

Sept critères : une demande appelle l'export de **chaque module activé** et produit une archive · construite en tâche de fond si le module de tâches est activé, synchrone sinon · fournie par un lien à durée limitée envoyé par email · le lien expiré ne télécharge plus · l'export d'organisation réservé à un `owner` · un schéma JSON documenté, et un test qui **valide l'archive produite contre ce schéma** · une demande déjà en cours n'en déclenche pas une seconde.

Dépendances déclarées : `s33` (fusionnée), `s18`, `s19`, `s17` — toutes fusionnées. **`s34` n'est pas déclarée dépendance et devrait l'être en pratique** : elle livre le mécanisme de revendication que le critère 7 réclame (voir pièges).

## Points d'ancrage

- `packages/core/src/registry.ts:413` — `exportModules`, sa signature et son ordre.
- `apps/web/lib/auth.ts` et `apps/web/lib/organizations.ts` — les deux points de composition que `s34` a câblés pour la purge ; l'export suit le même chemin.
- `packages/modules/storage/src/module.ts:74` — le seul export qui rend des octets.
- `packages/modules/auth/src/emails/` — les cinq modèles, dont le lien d'export sera le sixième.
- `packages/core/src/jobs.ts` — le répartiteur, et la classification transitoire/définitive dont le critère 2 hérite.

## Pièges & contraintes

- **Le critère 7 est le mécanisme que `s34` vient de construire, et il ne se code pas deux fois.** « Une demande déjà en cours n'en déclenche pas une seconde » est une revendication, pas une lecture : deux lectures concurrentes se voient l'une l'autre. `s34` a payé une ronde de revue et un constat *critique* pour l'apprendre. Reprendre `releaseMemberships` comme forme, pas comme code.
- **Un lien à durée limitée est une frontière publique.** Il porte un jeton, il est envoyé par email, et il donne accès à **toutes** les données d'une personne. Signature vérifiée avant tout effet, expiration côté serveur, et la route est publique donc **limitée en débit par le répartiteur** — c'est la base de sécurité, pas une option.
- **L'archive est une donnée personnelle en transit.** Où vit-elle entre la construction et le téléchargement ? Si c'est le stockage, elle hérite de sa purge ; sinon elle survit à l'effacement du compte, et `s34` vient de fermer trois trous de cette forme exacte.
- **Le critère 6 demande une validation, pas une description.** « Un test valide l'archive produite contre ce schéma » : le schéma doit être exécutable, et le test doit **produire** une archive réelle plutôt que d'en décrire une.
- **`admin` exporte `{}` en déclarant une catégorie** (fait 3). Ne pas le découvrir à l'implémentation.

## Questions ouvertes

- **Une catégorie qui s'efface mais ne s'exporte pas : défaut ou décision ?** Le cas est `grant-authorship`. Trancher, et rendre la décision **vérifiable** — un garde qui compare `dataCategories` aux clés que l'export produit, avec ses exceptions nommées, est la forme qui empêche la prochaine de passer inaperçue.
- **Où vivent les fichiers dans le schéma JSON ?** Chemin, contenu encodé, ou manifeste séparé. Décide la forme de l'archive.
- **Où l'archive est-elle stockée, et qui la purge ?**
- **Le lien expire-t-il par durée, par usage, ou les deux ?** Le critère ne dit que la durée.

## Complexité réelle

Notée **3** dans `docs/stories.md`. **Ma note : 4.**

Sept critères, une archive à construire, un schéma exécutable, un lien signé à durée limitée sur une frontière **publique**, un mécanisme de revendication, et une question de forme non tranchée (les fichiers dans le schéma). La note de 3 suppose « l'export existe déjà, il ne reste qu'à zipper » — or ce qui existe est un contrat que rien n'appelle, comme `purgeModules` avant `s34`, qui était notée 3 et a coûté quatre rondes de revue.

**Ligne de découpe si le plan dépasse dix tâches** : *l'archive et son schéma* d'un côté — qui close « mes données sortent, et leur forme est vérifiable » —, *le lien, son expiration et l'envoi* de l'autre. La seconde ne close seule que si la première a livré.
