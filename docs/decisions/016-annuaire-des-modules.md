# ADR 016 — L'annuaire des modules est statique, et le code d'un module désactivé reste dans le bundle serveur

- Status: accepted
- Date: 2026-08-30
- Scope: framing

## Context
`config/features.ts` porte deux choses : l'**annuaire** (`availableModules`, qui importe chaque module) et la **liste des activés**. C'est l'annuaire statique qui rend possible la garantie exigée par l'ADR 007 — un identifiant inconnu doit faire échouer la **compilation**, pas le démarrage.

Conséquence mesurée en revue de s03 : le code d'un module désactivé est présent dans `.next/server/chunks/`. Il est **absent de `.next/static/`**, donc aucune fuite vers le client. Ses routes, sa navigation, ses traductions, sa purge et son export sont absents du registre : rien n'est joignable, rien n'est appelé.

Cela crée une tension apparente avec la formule du PRD, « un module non activé ne laisse aucune trace ».

## Decision
L'annuaire reste statique et importe tous les modules disponibles. La formule du PRD s'entend au sens des **critères qui la définissent** : aucune route joignable, aucune entrée de navigation, aucune table sur une base vierge, aucune fonction de purge ou d'export appelée. L'élimination du code mort n'en fait pas partie et n'est visée par aucun critère de s03 ni de s26.

## Considered options
- **Annuaire paresseux, imports dynamiques** — rejeté : rendrait la construction du registre asynchrone partout, y compris dans les chemins de rendu synchrones, et ferait perdre la garantie compilateur qui est l'angle même du produit. Un coût architectural majeur pour un bénéfice de taille de bundle serveur.
- **Générer `config/features.ts` avec les seuls modules activés** — rejeté : ce serait un artefact généré au cœur de la configuration éditée par le propriétaire, exactement ce que s04 accepte pour le baril de schémas mais qui n'a pas de sens pour un fichier destiné à être lu et modifié à la main.
- **Ne rien documenter** — rejeté : la limite serait redécouverte à chaque revue, et interprétée comme un manquement à la promesse du PRD.

## Consequences
Facilité : la garantie compilateur tient, `config/features.ts` reste lisible et éditable en une ligne par s05.
Difficulté : le bundle serveur contient du code inatteignable. Sur un projet qui désactive vingt modules, cela se mesurera.
À surveiller : si le poids du bundle serveur devient un problème réel — mesuré, pas supposé — la sortie est un `eject` (cimetière du PRD) ou un annuaire généré, pas un annuaire paresseux.
