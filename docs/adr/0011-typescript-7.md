# ADR 011 — TypeScript 7

- Status: accepted
- Date: 2026-08-30
- Scope: framing
- Supersedes: la clause TypeScript de l'ADR 010 (« TypeScript 5.9+ »). Le reste de l'ADR 010 reste en vigueur.

## Context
L'ADR 010 pose le principe « dernières majeures stables » et ajoute que « démarrer une majeure en retard, c'est naître obsolète ». Il nomme pourtant « TypeScript 5.9+ », un instantané pris au moment du cadrage. La revue de s01 (finding F10) a relevé la contradiction : `typescript@7.0.2` est publié en `latest` sur npm, précédé d'une série `7.0.x-rc` — c'est une majeure stable, pas une préversion — tandis que le dépôt épingle `^5.9`.

L'implémenteur a refusé de trancher seul, à juste titre : adopter TypeScript 7 est une décision de cadrage, pas un détail d'implémentation d'une story de squelette.

## Decision
TypeScript 7. Le dépôt suit `latest`, conformément au principe de l'ADR 010, et cesse d'épingler une majeure nommée dans un document — c'est le lockfile qui fige la version exacte.

## Considered options
- **Rester en `^5.9`** — rejeté : contredit le principe même de l'ADR 010 sur le produit dont la fraîcheur est un argument de vente. Un acheteur qui ouvre le boilerplate en 2026 et y trouve la majeure précédente en tire une conclusion immédiate sur le reste.
- **Attendre que Next et drizzle-kit publient une compatibilité explicite** — rejeté comme position par défaut : c'est une attente sans échéance ni critère, sur un dépôt qui n'a aujourd'hui que cinq packages et douze tests. Le coût d'un retour arrière est au plus bas maintenant ; il ne fera que croître.
- **Ne nommer aucune version, s'en remettre au principe de l'ADR 010** — rejeté : la revue a montré qu'un principe sans arbitrage explicite se résout silencieusement en faveur du statu quo.

## Consequences
Facilité : alignement avec le principe posé, et accès au compilateur natif — les temps de `tsc --noEmit` sont l'un des coûts récurrents d'un monorepo qui grossira jusqu'à une quarantaine de packages.
Difficulté : TypeScript 7 supprime des options de `tsconfig` obsolètes et durcit certaines vérifications. Les paquets tiers dont les fichiers `.d.ts` sont générés par une majeure antérieure peuvent produire de nouveaux diagnostics, en particulier ceux consommés en `skipLibCheck: false`.
À surveiller : la compatibilité de Next 16, drizzle-kit et Vitest. Le critère de retour arrière est explicite — si `pnpm exec tsc --noEmit` échoue sur du code correct à cause d'une dépendance et non du dépôt, on revient à `^5.9` par un ADR successeur, en nommant le paquet fautif. Cette porte de sortie est cheap tant que le dépôt est petit ; elle doit être empruntée ou refermée avant que les modules se multiplient.
