# Research — Story s37c-inscriptions-publiques

> Vérifiée contre la branche par défaut au commit `cf0d2fc`, en lecture seule, complétée par un balayage de tout l'arbre.

## Les six faits structurants

1. **L'index qui sert cette story existe, et son commentaire la nomme.** `public_subscription_source_idx` porte : *« La question que le back-office de s37 posera : qui est inscrit à quoi. »* L'index est là depuis `s11`. **La requête, elle, n'existe pas.**

2. **Aucun code de production hors du module marketing ne lit ces deux tables.** Balayage de tout l'arbre : hors du module, les seules occurrences sont le baril généré, le test transverse et de la documentation. La lecture doit donc passer par un **port**, comme `s37b2` l'a fait pour les comptes et les organisations.

3. **Les ports du module ne savent pas répondre à la question.** Ils exposent l'écriture, le marquage de livraison, et **`listByEmail` / `deleteByEmail`** — la lecture d'**une** adresse, pour l'export et la purge d'un visiteur. **Il n'existe ni lecture globale, ni lecture par source.** C'est l'élargissement à faire, et c'est exactement la forme que `s37b1` puis `s37b2` ont établie.

4. **Le back-office n'a aucun chemin d'export, d'aucune sorte.** Balayage du module `admin` sur `csv`, `zip`, `archive`, `content-disposition`, `attachment`, `téléchargement` : **zéro occurrence**. Ses neuf routes sont des actions, son propre `export` de contrat est vide par conception.

5. **L'export de `s35` répond à une autre question, sur un autre axe.** Il produit un **objet JSON**, jamais un fichier — pas de zip, pas de CSV (ADR 062) — et il est **lié à une portée** (un compte, une organisation), alimenté par la clé `export` de chaque module. « Tous les inscrits à telle source » est une question d'**administration**, pas de portée personnelle. Ce qui est réutilisable est la **forme de livraison** : `content-disposition`, `cache-control: no-store`, et la discipline du refus entier plutôt que du résultat tronqué.

6. **Il n'existe aucun écrivain CSV dans le dépôt**, donc aucun assainisseur d'injection de formule. C'est la moitié qui doit être écrite, et c'est la seule surface **de sécurité** de la story.

## Points d'ancrage

- `packages/modules/marketing/src/schema.ts` — les deux tables, leurs index, et le commentaire qui nomme cette story.
- `packages/modules/marketing/src/application/ports.ts` — `listByEmail` / `deleteByEmail`, et l'absence d'une lecture par source.
- `packages/modules/admin/src/presentation/back-office-screens.tsx` — le cadre, la garde unique, la `Table`, la pagination fenêtrée.
- `packages/modules/auth/src/presentation/auth-routes.ts:1786` — la seule route du dépôt qui matérialise un fichier, et ses trois en-têtes.
- `docs/stories.md:335` — `s11` a **délibérément reporté** « la consultation ou l'export CSV des inscrits » à cette tranche.

## Pièges & contraintes

- **L'injection de formule est le risque réel.** Une cellule commençant par `=`, `+`, `-` ou `@` est exécutée par un tableur à l'ouverture. Les adresses et les messages de contact viennent d'**inconnus** : c'est une entrée hostile qui traverse un fichier que quelqu'un ouvrira sur son poste. Assainir, et le mesurer sur le fichier produit.
- **404 et non 403** pour un non-superadmin, sur le chemin HTTP réel — la forme que `s37a`, `s37b1` et `s37b2` ont établie.
- **Une seule garde.** `s37b2` a livré `authorize`, appelée par les routes et par les vues, et la revue a vérifié qu'il n'en existe aucune seconde copie. Cette story ne doit pas en créer une.
- **Le module `marketing` coupé** : l'entrée disparaît du back-office, dérivée du registre, sans qu'aucun fichier ne nomme le module — la forme de `s31` puis de `s37b2`.
- **Les messages de contact ne sont pas des inscriptions.** La story parle d'« inscriptions publiques » ; les deux tables sont voisines et distinctes. Décider explicitement si l'écran couvre les deux, et l'écrire.

## Questions ouvertes

- **CSV ou JSON ?** La story dit « exporter » sans nommer le format ; `s11` a écrit « export CSV ». Le CSV est ce qu'un exploitant ouvre ; il est aussi le seul qui demande un assainisseur. **À trancher au plan, avec sa raison.**
- **L'export porte-t-il la sélection en cours** (source, recherche, pagination) ou tout ? Un export qui ignore le filtre affiché surprend ; un export qui le suit doit le dire.
- **Une limite de volume ?** Rien ne borne aujourd'hui le nombre d'inscriptions. Un export qui matérialise tout en mémoire tiendra jusqu'à ce qu'il ne tienne plus.

## Complexité réelle

Notée **2** dans `docs/stories.md`. **Ma note : 2**, à condition que l'écran reste une liste dans le cadre existant et que l'export soit un CSV assaini. Elle passerait à 3 si le plan voulait un format d'archive, une pagination d'export ou un travail de fond — trois choses qu'aucun critère ne demande.
