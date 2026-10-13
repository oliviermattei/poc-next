# ADR 069 — Les données de démonstration sont la première clé facultative du contrat de module

- Status: accepted
- Date: 2026-09-07

`pnpm db:seed` doit peupler une base migrée, et seules les modules savent quoi écrire dans leurs tables : un jeu de données écrit à côté d'eux casserait au premier changement de schéma et survivrait à la coupure de son module. Le contrat porte donc une clé `seeds`, que le registre agrège (`module.seeds ?? []`). Elle est **facultative** — la seule clé de `ModuleDefinition` à l'être —, ce qui déplace une clause de l'ADR 007 (« le contrat est complet dès le premier module, quitte à ce que certaines déclarations soient vides ») sans superséder le reste.

Le critère, à opposer à toute nouvelle clé dans un sens comme dans l'autre : une clé est **obligatoire** quand l'omettre laisse un défaut que personne ne détecte depuis l'extérieur du module (une donnée non purgée, une catégorie sans rétention, un contenu non indexé) — le tableau vide y est une décision qu'il faut forcer. Elle peut être **facultative** quand son absence est observable et inoffensive. Un module sans données de démonstration n'est pas incomplet, il est silencieux : `seeds` passe le critère, `publicUrls` (ADR 054) ne l'aurait pas passé.

## Considered options

- **`seeds: []` obligatoire partout** — rejeté : rouvrir tous les modules pour écrire un tableau vide qui ne décide rien.
- **Un dossier de seeds hors des modules** — rejeté : il vieillirait à côté d'un schéma qu'il ne voit pas changer, survivrait à la coupure du module dont il écrit les tables, et devrait connaître le schéma de tous les modules.
- **Un module `demo` qui sème pour les autres** — rejeté : il devrait déclarer `requires` sur chacun, donc les rendre tous non désactivables.

## Consequences

Un agent qui lit un module sans `seeds` ne distingue plus « ne sème rien » de « a oublié de semer ». Ce qui l'amortit : `runSeeders` (`packages/db/src/seed.ts`) refuse, en le nommant, un seed déclaré qui n'écrit aucune ligne sur une base vide. Un module coupé n'est pas dans le registre, donc son seed n'existe pas ; `pnpm test:minimal-profile` joue `pnpm db:seed` avec des modules coupés. À la prochaine clé facultative, la règle du contrat cesse d'être « tout est obligatoire sauf » : c'est le moment d'une ADR qui redit laquelle des deux formes il suit.
