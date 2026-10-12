# ADR 017 — `ModuleRoute[]` est une forme de transition jusqu'à Hono

- Status: accepted
- Date: 2026-08-30
- Scope: framing

## Context
L'ADR 005 retient Hono monté dans Next comme couche API. Mais s03, qui pose le contrat de module, avait interdiction d'introduire Hono : la couche API appartient à sa propre story. Le contrat devait pourtant déclarer des routes dès maintenant, puisque c'est ce qui rend un module désactivable.

L'implémentation livre donc `routes: readonly ModuleRoute[]` — des descripteurs maison (`method`, `path`, `protection`, gestionnaire) appariés exactement, sans segment dynamique — plutôt que le `HonoRouter` annoncé par `docs/architecture.md`.

## Decision
`ModuleRoute[]` est assumée comme **forme de transition**, et cette ADR le consigne pour que personne ne la prenne pour la forme finale.

Quand Hono sera introduit, la clé `routes` du contrat changera de type. La migration touchera les modules existants, mais elle est bornée : chaque module expose une liste de descripteurs, dont la conversion en sous-routeur Hono est mécanique.

Deux limites connues de la forme actuelle, à ne pas contourner par un mécanisme parallèle :
- **aucun segment dynamique** (`/items/:id`) — le premier module réel qui en aura besoin déclenche l'introduction de Hono, il n'invente pas un second routeur ;
- **404 sur méthode non appariée** plutôt que 405, choix cohérent avec le §7 du socle de sécurité (ne pas divulguer les méthodes acceptées).

## Considered options
- **Introduire Hono en s03** — rejeté : la story avait un interdit explicite, et mélanger le contrat de module avec la couche API aurait rendu la story la plus structurante du projet encore plus large.
- **Déclarer `routes` en `unknown` en attendant** — rejeté : aucune garantie, aucun montage possible, et le critère « un module non activé n'expose aucune route » serait invérifiable.
- **Inventer un routeur maison complet** (segments dynamiques compris) — rejeté : ce serait du code à jeter, et deux mécanismes de routage concurrents dans le même dépôt.

## Consequences
Facilité : le contrat est complet et vérifiable dès s03, sans anticiper une story qui n'existe pas encore.
Difficulté : une migration de type est due, sur tous les modules écrits d'ici là.
À surveiller : le premier besoin de segment dynamique. C'est le signal d'introduire Hono, pas d'étendre `ModuleRoute`.
