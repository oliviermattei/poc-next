# ADR 069 — Les données de démonstration sont la première clé facultative du contrat de module

- Status: accepted
- Date: 2026-09-07
- Scope: story s58-donnees-de-demonstration

## Context

`pnpm db:seed` imprimait « Aucun seed à exécuter » et sortait **0**, sur une base
migrée dont toutes les tables du schéma public étaient à zéro ligne. Le produit
s'ouvrait donc sur des écrans vides, et rien ne le signalait. Pour semer, il faut
que chaque module dise ce qu'il sème : les tables appartiennent aux modules, un
jeu de données écrit à côté d'eux casserait en silence au premier changement de
schéma et survivrait à la coupure de son module.

Le contrat de module (ADR 007) tranche la question inverse : **« Le contrat est
complet dès le premier module, quitte à ce que certaines déclarations soient
vides »**, et son option « Contrat minimal étendu au fil des besoins » est
**rejetée** en toutes lettres — « ajouter `purge`, `export` ou `retention` après
vingt modules obligerait à tous les rouvrir ». Quinze clés obligatoires ont été
ajoutées sur cette base, la dernière (`publicUrls`, ADR 054) au prix de la
réouverture de tous les modules alors écrits.

Une seizième clé obligatoire pour les données de démonstration coûterait la même
réouverture, cette fois de dix-neuf modules, pour y poser dix-neuf tableaux
vides. La story a donc rendu `seeds` **facultative**, et l'a fait **en prose**
dans le règlement racine et dans `docs/architecture.md` : la revue a relevé qu'un
ADR ne s'amende pas, il se supersède, et que tout changement comparable du
contrat en a eu un (024, 054, 059, 066/067).

## Decision

**`seeds` est facultative, et c'est la première clé du contrat à l'être avec
`NavigationEntry.surface`.** Le registre l'agrège pour les modules qui la
déclarent (`module.seeds ?? []`) ; un module qui n'en déclare pas ne contribue
aucune entrée et n'a pas eu à être rouvert.

**Ce qui distingue `seeds` des quinze autres, et c'est le critère, pas le
confort.** Chacune des quinze répond à une question dont l'**absence de réponse
est un défaut** : un module qui ne déclare pas `retention` détient des données
personnelles sans politique ; un module qui ne déclare pas `purge` rend la
suppression de compte incomplète ; un module qui ne déclare pas `publicUrls`
laisse le plan de site ignorer ce qu'il publie. Le tableau vide y est une
**décision** — « je ne publie rien », « je ne détiens rien » — et l'obligation de
l'écrire est ce qui force la décision plutôt que le silence.

`seeds` ne répond à aucune question de ce genre. Un module sans données de
démonstration n'est pas incomplet : il est **silencieux**. Rien dans le produit
n'est faux parce qu'il ne sème pas — aucune donnée personnelle n'est orpheline,
aucune obligation légale n'est en suspens, aucune page n'est incohérente. La
seule conséquence est un écran de moins peuplé pour qui découvre le produit,
c'est-à-dire exactement la portée de la clé. **Une clé est obligatoire quand
l'omettre laisse un défaut sans propriétaire ; elle est facultative quand
l'omettre ne laisse que du silence.**

**Le critère qui forcerait une seizième clé obligatoire**, écrit ici pour que la
prochaine ne se décide pas au cas par cas : une clé nouvelle est **obligatoire**
dès qu'un module qui l'omettrait produirait un défaut que personne ne détecte
depuis l'extérieur du module — une donnée non purgée, une route non protégée, un
contenu non indexé, une catégorie sans rétention. Elle peut être facultative
seulement si son absence est **observable et inoffensive** : observable, parce
que le manque se voit à l'usage ; inoffensive, parce qu'aucune garantie du dépôt
n'en dépend. `seeds` passe les deux ; `publicUrls` n'aurait passé ni l'un ni
l'autre.

## Considered options

- **Une seizième clé obligatoire, `seeds: []` partout** — rejeté : dix-neuf
  modules rouverts pour y écrire le même tableau vide, et une revue de plus à
  chaque module futur pour une clé qui ne décide rien quand elle est vide. C'est
  le coût que l'ADR 054 a payé une fois pour une clé dont le vide *est* une
  décision ; le payer pour une clé dont le vide ne décide rien serait acheter la
  cohérence de la forme au prix de la cohérence du sens.
- **Un fichier de seed hors des modules** (par exemple `packages/db/src/seeds/`)
  — rejeté pour trois raisons mesurées : il vieillirait à côté d'un schéma qu'il
  ne voit pas changer, il survivrait à la coupure du module dont il écrit les
  tables — donc `pnpm test:minimal-profile` échouerait, ou pire, ne le verrait
  pas — et il obligerait un point unique à connaître le schéma de tous les
  modules, ce que les bornes de `eslint.config.ts` interdisent par ailleurs aux
  modules entre eux.
- **Un module `demo` qui sème pour les autres** — rejeté : il devrait importer
  le schéma de chaque module qu'il peuple, donc déclarer `requires` sur tous, ce
  qui rendrait chacun d'eux non désactivable tant qu'il est activé. La modularité
  est le premier angle du PRD ; un module qui épingle tous les autres la
  contredit.
- **Superséder l'ADR 007** — rejeté : sa décision porte sur le module comme unité
  de composition, dont la clause « le contrat est complet dès le premier module »
  n'est qu'un attendu parmi d'autres. La superséder ferait passer pour caduc ce
  qui reste vrai des quinze clés. Le présent ADR **déplace une clause précise**
  de 007 — « quitte à ce que certaines déclarations soient vides » ne vaut plus
  comme règle sans exception — et laisse le reste debout, exactement comme
  l'ADR 067 a déplacé la borne par comptage de l'ADR 066 sans le superséder.
- **Ne rien décider et laisser le commentaire de `packages/core/src/module.ts`
  argumenter** — rejeté, c'est l'état que la revue a refusé. Un commentaire
  n'énumère pas les options écartées et ne se relit pas au moment où quelqu'un
  proposera la seizième clé.

## Consequences

**Ce qui devient plus facile.** Un module qui veut peupler ses écrans de
démonstration ajoute une clé ; les autres ne bougent pas. La commande dérive du
registre — un module coupé n'est pas dans le registre, donc son seed n'existe
pas — et `pnpm test:minimal-profile` joue `pnpm db:seed` dans une copie où des
modules sont coupés.

**Ce qui devient plus difficile.** Le contrat n'est plus homogène : « toutes les
clés sont obligatoires » cesse d'être vrai, et un agent qui lit un module sans
`seeds` ne peut plus distinguer *« ce module ne sème rien »* de *« ce module a
oublié de semer »*. C'est le prix exact de l'optionalité, et il n'est pas nul.
Ce qui l'amortit : `runSeeders` refuse un seed **déclaré** qui n'écrit aucune
ligne sur une base vide, en le nommant — l'oubli reste possible avant la
déclaration, jamais après. Ce que rien ne tient : un module qui n'aurait jamais
dû être silencieux. Aucune commande ne peut le savoir ; seule une revue le peut.

**Ce qu'il faut surveiller.** La clé facultative **suivante**. Deux exceptions se
regardent encore comme des exceptions ; à la troisième, la règle du contrat n'est
plus « tout est obligatoire sauf » mais « chaque clé décide », et c'est ce
jour-là qu'il faudra un ADR pour redire laquelle des deux formes le contrat
suit. Le critère ci-dessus est ce qui doit être opposé à toute nouvelle clé,
dans un sens comme dans l'autre.
