# ADR 018 — Une clé étrangère inter-modules est permise si et seulement si la cible est un requis déclaré

- Status: accepted
- Date: 2026-08-30
- Scope: framing
- Supersède la clause « clé étrangère » de l'ADR 007 (§ Consequences). Le reste de l'ADR 007 reste en vigueur.

## Context
L'ADR 007 écrivait : « une clé étrangère d'un module vers un module optionnel le rend **silencieusement** non désactivable. s04 la refuse à la génération. » `AGENTS.md` et `docs/architecture.md` en avaient tiré une formulation absolue — aucune clé étrangère inter-modules, jamais, les références passent par un identifiant et un port.

s04 devait implémenter cette garde et a buté sur la dérivation : le plan parlait d'autoriser une référence « vers un module du socle (`auth`) », mais aucun module de socle n'existe, le contrat ne porte aucun marqueur de socle, et écrire `const SOCLE = ['auth']` aurait été exactement la liste en dur que le plan interdit.

La revue a vérifié le comportement réel plutôt que le texte : `resolveEnabledModules` refuse déjà une configuration où un requis n'est pas activé, en nommant les deux modules. Le mot décisif de l'ADR 007 est donc **« silencieusement »**.

## Decision
Une clé étrangère d'un module `A` vers une table d'un module `B` est permise **si et seulement si `B` appartient à la clôture transitive des `requires` de `A`**. Toute autre référence inter-modules est refusée à la génération, en nommant les deux modules et la table.

La règle est **dérivée des déclarations**, sans aucune liste de modules en dur. Elle vaudra pour `auth` sans le nommer : un module qui référence l'authentification déclare `auth` dans ses `requires`.

## Considered options
- **Aucune clé étrangère inter-modules, jamais** (la lettre d'`AGENTS.md` avant cet ADR) — rejeté. Elle interdit un couplage que le registre rend déjà sûr, et pousse à référencer par identifiant nu : on perd l'intégrité référentielle offerte par la base sans gagner en séparabilité, puisque `requires` exprime déjà la dépendance. Elle aurait en revanche évité le risque de purge décrit plus bas.
- **Liste de modules « socle » référençables** — rejeté : liste en dur, interdite par le plan, et impossible à écrire aujourd'hui puisque le contrat ne porte pas la notion de socle.
- **Aucune garde, confiance à la revue** — rejeté : c'est le mode d'échec que l'ADR 007 nomme, et une clé étrangère oubliée rend un module non désactivable sans qu'aucune commande n'échoue.

## Consequences
Facilité : l'intégrité référentielle reste disponible entre modules liés, et le couplage est **déclaré** au lieu d'être découvert. Désactiver `B` sous `A` est déjà refusé par la validation de configuration, avec un message nommant les deux.
Difficulté, et c'est le vrai coût : **une clé étrangère inter-modules impose un ordre de purge.** Purger les lignes de `B` avant celles de `A` violera la contrainte, et `requires` ne dit rien de cet ordre. La règle stricte évitait ce problème ; celle-ci le reporte sur s34 et s35, qui devront purger dans l'ordre inverse du graphe et le prouver.
À surveiller : le jour où deux modules déclareront la même table physique, l'attribution de propriétaire de la garde devient fausse. C'est un défaut connu, distinct de cette décision, à corriger dans la garde elle-même.
