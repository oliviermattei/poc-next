# ADR 009 — Base UI comme socle des composants shadcn/ui

- Status: accepted
- Date: 2026-08-30
- Scope: framing

## Context
shadcn/ui n'est pas une bibliothèque mais un ensemble de composants copiés dans le dépôt, bâtis sur un socle sans style. Deux socles coexistent : Radix UI, sur lequel shadcn s'est construit, et Base UI, porté par l'équipe MUI avec des contributeurs venus de Radix et de Floating UI. Le choix engage l'accessibilité, les API de composition et la quantité d'exemples disponibles.

## Decision
Base UI, dans `packages/ui`. Aucun module applicatif n'importe Base UI directement : les composants passent tous par `packages/ui`, qui est la seule frontière avec le socle.

## Considered options
- Radix UI — rejeté malgré son avantage d'écosystème : c'est le socle historique, le mieux documenté, mais les deux cibles les plus sérieuses du marché (MakerKit et Supastarter) sont passées à Base UI. Rester sur Radix reviendrait à construire un boilerplate neuf sur le socle que les concurrents quittent.
- DaisyUI (choix ShipFast) — rejeté : composants stylés par classes, thématisation par thèmes prédéfinis. Rapide à démarrer, mais la personnalisation profonde passe par de la surcharge CSS et le code des composants n'appartient pas au projet.
- Bibliothèque packagée (MUI, Mantine, Chakra) — rejeté avec l'ADR 001 : le code n'appartient pas au projet.

## Consequences
Facilité : API de composition plus cohérentes, accessibilité maintenue en amont, alignement avec l'état actuel du marché.
Difficulté : écosystème d'exemples plus mince que Radix. Sur un composant exotique, il faudra lire la doc plutôt que copier une réponse trouvée en ligne.
À surveiller : l'isolement dans `packages/ui` est ce qui rend ce choix réversible. Le jour où un module importe Base UI directement, changer de socle redevient un refactor traversant.
