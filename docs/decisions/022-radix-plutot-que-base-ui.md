# ADR 022 — Radix UI plutôt que Base UI, jusqu'à sa première version stable

- Status: accepted
- Date: 2026-08-31
- Scope: framing
- Supersède l'ADR 009 (socle de composants Base UI). L'ADR 010 reste en vigueur et fonde cette décision.

## Context
L'ADR 009 a retenu Base UI comme socle des composants shadcn/ui, sur un argument d'alignement de marché : MakerKit et Supastarter y étaient passés, et rester sur Radix revenait à bâtir un boilerplate neuf sur le socle que les concurrents quittaient.

Au moment d'implémenter s08 — la première story d'interface, celle qui crée `packages/ui` — la vérification du registre npm donne un fait que l'ADR 009 n'avait pas établi : **`@base-ui-components/react` n'a jamais publié de version stable.** Quatorze versions publiées, toutes en `alpha`, `beta` ou `rc` ; l'étiquette `latest` pointe sur `1.0.0-rc.0`. `@radix-ui/react-dialog` est en `1.1.23`, stable de longue date.

L'ADR 010 est explicite : « le boilerplate vise les dernières majeures stables de ses dépendances, **jamais les versions candidates ni les canaries** », et rejette « suivre les versions candidates pour être en avance » au motif que « les régressions amont se paieraient sur chaque projet dérivé ».

Deux ADR acceptées se contredisent donc, et l'objectif du propriétaire — un boilerplate *production grade* — tranche dans le même sens que l'ADR 010.

## Decision
`packages/ui` est bâti sur **Radix UI**. Base UI est adopté dès qu'il publie une majeure stable, par un ADR successeur.

Conséquence de forme, et c'est ce qui rend la décision réversible à coût borné : aucun module applicatif n'importe Radix directement. `packages/ui` reste la seule frontière avec le socle de composants, comme l'ADR 009 l'avait déjà posé — cette clause-là survit intacte.

## Considered options
- **Base UI en version candidate** — rejeté : contredit frontalement l'ADR 010 sur la fondation de toute l'interface d'un produit destiné à être revendu. Une régression amont dans une préversion se paierait sur chaque projet dérivé, et un acheteur qui ouvre le dépôt y verrait une préversion au cœur de son interface.
- **Attendre la stabilisation de Base UI avant de livrer s08** — rejeté : bloque trente-huit stories sur un calendrier qu'on ne contrôle pas, alors que s08 est sur le chemin critique.
- **Se passer de socle de composants** (composants entièrement maison) — rejeté : l'accessibilité des primitives — menus, dialogues, popovers, navigation au clavier — est précisément ce qu'un socle apporte et ce qu'on écrirait mal.
- **Maintenir les deux socles en parallèle** — rejeté : double la surface de test et de maintenance pour un bénéfice nul tant que Base UI n'est pas stable.

## Consequences
Facilité : socle éprouvé, écosystème d'exemples le plus fourni, alignement avec la majorité des composants shadcn/ui publiés. Le risque de régression amont revient à celui d'une bibliothèque mûre.
Difficulté : le dépôt diverge de MakerKit et Supastarter sur ce point précis, ce qui pourrait se voir dans une comparaison de grille.
À surveiller : la publication d'une majeure stable de Base UI. C'est le déclencheur de l'ADR successeur, et l'isolement dans `packages/ui` est ce qui garde ce basculement à un coût de migration borné plutôt qu'à un refactor traversant.
