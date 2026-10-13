# ADR 022 — Radix UI plutôt que Base UI comme socle des composants

- Status: accepted
- Date: 2026-08-31

`packages/ui` est bâti sur Radix UI. Base UI avait d'abord été retenu, pour suivre MakerKit et Supastarter qui y étaient passés ; il n'avait publié aucune version stable au moment de créer `packages/ui` (`@base-ui-components/react` plafonnait à `1.0.0-rc.0`), et l'ADR 010 exclut les versions candidates : une régression amont dans une préversion se paierait sur chaque projet dérivé, au cœur de son interface.

Aucun module applicatif n'importe Radix directement : les composants passent tous par `packages/ui`, seule frontière avec le socle. C'est ce qui garde réversible ce choix — un changement de socle reste une migration de `packages/ui`, pas un refactor traversant.

Base UI publie depuis une majeure stable, sous le nom `@base-ui/react`. La bascule n'est pas automatique : elle se décide par une ADR qui remplace celle-ci.

## Considered options

- **Composants entièrement maison, sans socle** — rejeté : l'accessibilité des primitives (menus, dialogues, popovers, navigation au clavier) est précisément ce qu'un socle apporte et ce qu'on écrirait mal.
- **Maintenir les deux socles en parallèle** — rejeté : double la surface de test et de maintenance sans bénéfice.
- **DaisyUI, ou une bibliothèque packagée (MUI, Mantine, Chakra)** — rejeté : le code des composants n'appartiendrait pas au projet (ADR 001).
