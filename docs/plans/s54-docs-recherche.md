---
story: s54-docs-recherche
validated: yes
---

# Plan — s54-docs-recherche

> Planifié contre `dev` au commit `3e06a70`. **La recherche a été vérifiée contre la branche de `s30`, pas contre `dev`** — elle le dit en première ligne et demande une revérification après la fusion. Faite : ses cinq faits tiennent, avec une précision sur le cinquième.

## Revérification des points d'ancrage, sur `dev`

| Fait | État sur `dev` |
|---|---|
| 2. `resolveDocsCatalog` rend `{ pages, sections, index }`, valeur pure | **tient** — `application/docs-catalog.ts:62`, exporté par le barrel |
| 3. `routeIsRateLimited` rend `true` pour toute route `public` sans qu'elle le déclare | **tient** (ADR 050) |
| 4. le module `docs` déclare `routes: []` | **tient** — `module.ts:56` |
| 5. `Command` est déclaré par le design system et absent de `packages/ui` | **tient, et c'est pire que ça** : mesuré le 06/09, **16 des 32 composants** du tableau sont absents. La note en tête de ce tableau le dit désormais, et tranche la conduite : une story qui a besoin d'un composant absent **le livre dans `packages/ui`** |

## Les deux décisions que ce plan prend

**1. L'index est statique, et la recherche ne passe par aucune route.** Le critère l'impose déjà (« construit au build et servi statiquement »), mais la recherche donne l'argument le plus fort, et il n'est pas la performance : une route `public` est **limitée à 120 requêtes/60 s par appelant** par dérivation (ADR 050, fail-closed). Raisonnable pour un formulaire, absurde pour une frappe au clavier. Un index statique interrogé côté client échappe entièrement à la question — et laisse `routes: []`, donc le balayage du profil minimal inchangé.

**2. `Command` est copié de shadcn/ui dans `packages/ui`.** Copier n'est pas inventer : `s29` l'a fait pour `Pagination`, `s30` pour `Breadcrumb`, `s37b2` le fait en ce moment pour `Table`. Le design system le désigne nommément comme la palette de recherche de la documentation.

## Tâches

- [x] **1. `Command` dans `packages/ui`.** Copie shadcn/ui sur Radix (ADR 022), jetons existants, thème sombre. Rien d'autre n'est livré dans `packages/ui` par cette story.
- [x] **2. La passe croisée, sur le catalogue et non sur le disque.** C'est le mécanisme neuf de la story : `s29` et `s30` valident chaque fichier **isolément** et n'ont jamais croisé deux fichiers. La passe prend `resolveDocsCatalog`, déjà pur — un second balayage du disque divergerait, et c'est le risque que la note de `s31` nomme pour les pipelines MDX. **Corrigé à la revue (M2)** : « n'ont jamais croisé deux fichiers » est faux. `resolveDocsCatalog` croise déjà deux fichiers depuis `s30`, dans la fonction même qui a été étendue — une section sans `section.json` dans la langue par défaut, une page écrite seulement dans une traduction. Ce qui est neuf n'est pas le croisement mais sa **nature** : un lien est une référence *écrite par l'auteur*, de cible arbitraire, résolue contre le catalogue entier, là où ces deux refus cherchent un fichier que les coordonnées de la page désignent.
- [x] **3. Un lien interne mort fait échouer le build**, en nommant **le fichier fautif et la cible manquante** — les deux, le critère l'exige. Mutation : un lien vers une page inexistante doit rougir en nommant les deux.
- [x] **4. L'index de recherche, construit au build.** Dérivé du catalogue, une entrée par page servie.
- [x] **5. Le plafond de taille, posé et mesuré.** Le critère n'en fixe aucun ; un index servi au client est téléchargé par **chaque visiteur**, donc la promesse « sans service externe » se paierait ailleurs. Poser un plafond, le mesurer, et faire rougir son dépassement. Sans cela, la story tient son critère et rate son intention.
- [x] **6. La recherche respecte la locale servie.** Une page absente dans la langue courante n'est **pas** proposée comme si elle y était. Mutation : ignorer la locale doit rougir — c'est exactement le défaut majeur que la revue de `s31` a trouvé sur la page du changelog, et il se reproduit ici si personne ne l'écrit.
- [x] **7. L'écran de recherche**, composé de `Command` et de rien d'autre de neuf.
- [x] **8. Module coupé** : aucun index, aucun écran, rien ne casse. `routes: []` reste vrai, donc la garantie tient par la navigation et par l'absence d'index. `pnpm test:minimal-profile` le mesure sans nommer le module.

## Ce que la story ne fait pas

Aucun service de recherche externe, aucune route de recherche, aucune indexation à la requête. Pas de recherche dans le blog ni dans le changelog — le critère parle de la documentation.

## Sections de `docs/security.md` touchées

Aucune route neuve, donc aucune surface publique ajoutée — c'est le principal effet de la décision 1. L'index est du contenu public déjà servi ; vérifier qu'il ne porte **que** ce qui est déjà public (titres, extraits, adresses), et rien qui vienne d'un fichier non publié.
