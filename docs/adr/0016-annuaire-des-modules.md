# ADR 016 — L'annuaire des modules est statique, et le code d'un module désactivé reste dans le bundle serveur

- Status: accepted
- Date: 2026-08-30

`config/features.ts` porte l'annuaire (`availableModules`, qui importe chaque module) et la liste des activés. C'est l'annuaire statique qui fait échouer la compilation sur un identifiant inconnu (ADR 007). Il a un prix : le code d'un module désactivé est présent dans le bundle serveur (`.next/server/`), mais absent du bundle client (`.next/static/`), et ni ses routes, ni sa navigation, ni ses traductions, ni sa purge, ni son export ne sont dans le registre. Nous gardons l'annuaire statique. « Un module non activé ne laisse aucune trace » s'entend donc ainsi : aucune route joignable, aucune entrée de navigation, aucune table sur une base vierge, aucune purge ni export appelés — l'élimination du code mort côté serveur n'en fait pas partie.

## Considered options

- Annuaire paresseux par imports dynamiques — rejeté : la construction du registre deviendrait asynchrone partout, y compris dans les chemins de rendu synchrones, et la garantie du compilateur disparaîtrait, pour un gain de taille de bundle serveur.
- Générer `config/features.ts` avec les seuls modules activés — rejeté : ce fichier est celui que le propriétaire du projet lit et édite à la main ; un artefact généré n'a rien à y faire.

## Consequences

- Le bundle serveur contient du code inatteignable. Si son poids devient un problème mesuré, la sortie est un annuaire généré, pas un annuaire paresseux.
