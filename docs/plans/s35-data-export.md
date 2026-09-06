---
story: s35-data-export
validated: yes
---

# Plan — s35-data-export

> Planifié contre `dev` au commit `1bf09ce`, sur une recherche du même jour. **`s34` n'est pas déclarée dépendance de cette story et l'est en pratique** : elle livre le mécanisme que le critère 7 réclame, et elle a payé un constat *critique* pour l'apprendre.

## Ce que la story est réellement

`exportModules` (`packages/core/src/registry.ts:413`) est **le troisième contrat que le socle déclare et que rien n'appelle** — après la clé `jobs` (fermée par `s33`) et `purgeModules` (fermée par `s34`). s35 la branche.

Et elle ne gère **aucun échec** : elle parcourt en ordre direct et, si un module lève, tout est perdu sans que l'appelant sache où. C'est le défaut que `purgeModules` portait avant `s34` — **et il pèse plus lourd ici** : un export qui omet silencieusement un module est pire qu'un échec, parce que la personne croit avoir reçu l'ensemble de ses données.

## Trois décisions à prendre, et deux sont déjà informées

### 1. Un export partiel est un échec, pas une archive

Le critère 1 dit « appelle la fonction d'export de **chaque** module activé ». Si un module échoue, l'archive ne doit pas être livrée amputée : la personne exerce un droit à la portabilité et ne peut pas savoir ce qui manque. **Refuser en nommant le module**, comme `purgeModules` le fait depuis `s34`, et laisser la demande rejouable.

### 2. Le critère 7 est une revendication, pas une lecture

« Une demande déjà en cours n'en déclenche pas une seconde. » Deux lectures concurrentes se voient l'une l'autre : c'est exactement ce que la revue de `s34` a établi par mesure, au prix d'un constat critique. **Reprendre la forme de `releaseMemberships`** — une transaction courte qui revendique ou refuse — et non son code.

### 3. Une catégorie qui s'efface mais ne s'exporte pas : à trancher et à rendre visible

Dès la fusion de `s34`, `admin` déclarera `dataCategories: ['grant-authorship']` avec `export: async () => ({})`. Le contrat le permet ; **rien ne vérifie que `dataCategories`, `purge` et `export` s'accordent**. Pour ce cas la réponse n'est pas évidente — la ligne appartient au bénéficiaire, l'auteur du geste est un tiers. Trancher, et poser le garde qui rend la décision **visible** plutôt que tacite.

## Tâches

- [x] **1. `exportModules` rend ce qu'elle a produit, et nomme où elle s'est arrêtée.** Résultat discriminé, comme `purgeModules` depuis `s34`. Mutation : rendre une charge partielle sans signaler l'échec doit rougir.
- [x] **2. Le plancher du critère 1.** Six modules déclarent au moins une catégorie et exportent réellement ; huit déclarent zéro et rendent `{}`, ce qui est cohérent. Le test dérive la liste des modules **qui doivent produire quelque chose** et refuse un balayage vide — sans ce plancher, une archive vide passe au vert.
- [x] **3. Le garde d'accord entre `dataCategories`, `purge` et `export`.** Chaque catégorie déclarée est soit produite par l'export, soit **nommée en exception avec sa raison**. `admin`/`grant-authorship` est la première, et la décision de la tâche 3 s'écrit là. Mutation : ajouter une catégorie sans l'exporter ni l'excepter doit rougir.
- [x] **4. La revendication de demande en cours.** Une transaction courte qui revendique ou refuse, sous verrou. Test **concurrent**, pas séquentiel : `s34` a montré qu'un cas séquentiel laisse la mutation verte.
- [x] **5. L'archive et son schéma exécutable.** Le critère 6 demande qu'un test **valide l'archive produite** contre le schéma — donc produire une vraie archive, pas décrire une forme. Les fichiers de `storage` sont le seul contenu non-JSON : ils entrent par un **manifeste**, et la décision est écrite. *Livré : le manifeste est celui que `storage` rend déjà — identifiant, usage, type de contenu, taille, date. **Ni chemin, ni empreinte**, contrairement à ce que cette ligne proposait : la clé d'objet nommerait un emplacement dans un seau (`docs/security.md` §5) et une empreinte demanderait de lire chaque objet — autant d'appels réseau sortants dans la requête — donc de changer la forme de l'export d'un module existant, ce que ce plan exclut par ailleurs. Ce que le manifeste ne permet donc pas de vérifier est écrit dans l'ADR 062.*
- [x] **6. Où vit l'archive, et qui la purge.** C'est une donnée personnelle en transit. Si elle vit dans le stockage, elle hérite de sa purge ; sinon elle **survit à l'effacement du compte** — et `s34` vient de fermer trois trous de cette forme exacte. Décision écrite, et un test qui la tient.
- [x] **7. Le lien signé, à durée limitée, et son expiration côté serveur.** Frontière **publique** : signature vérifiée avant tout effet, expiration jamais décidée par le client, et la route est limitée en débit par le répartiteur. Le lien donne accès à **toutes** les données d'une personne — c'est la surface la plus sensible de la story.
- [x] **8. Le lien expiré ne télécharge plus.** Critère 4, et c'est une mutation évidente : avancer l'horloge au-delà de la validité doit rougir si le refus disparaît.
- [x] **9. L'export d'organisation réservé à un `owner`.** 404 et non 403 pour un non-membre (`docs/security.md` §3) ; refus pour un membre non-propriétaire.
- [x] **10. Avec ou sans le module de tâches.** Le critère 2 hérite du mécanisme de `s33`. Et **corriger le commentaire d'`apps/web/lib/jobs.ts:121`** : il affirme que `purgeModules` et `exportModules` « sont exécutées » — faux à l'écriture, à moitié vrai depuis `s34`, et cette story le rend vrai.

## Ce que la story ne fait pas

Elle n'ajoute pas d'écran — s'il en faut un, il suivra la ligne de `s34b`. Elle ne change pas la forme de l'export d'un module existant.

## Si le plan déborde

Dix tâches, c'est la limite. Ligne de coupe : *l'archive et son schéma* (1 à 6) d'un côté, *le lien, son expiration et l'envoi* (7 à 9) de l'autre. La seconde ne close seule que si la première a livré.

## Sections de `docs/security.md` touchées

Frontière publique signée · expiration vérifiée côté serveur · limitation de débit sur une route publique · 404 plutôt que 403 · Zod à la frontière · **aucune donnée personnelle qui survive à l'effacement du compte**.
