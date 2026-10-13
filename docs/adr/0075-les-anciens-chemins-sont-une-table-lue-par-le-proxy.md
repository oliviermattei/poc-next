# ADR 075 — Les anciens chemins d'écran sont une table, lue par le proxy

- Status: accepted
- Date: 2026-09-28

Des écrans changent d'adresse (`/account`, `/organizations`, `/billing` sous `/app/settings/*`, puis d'autres sous `/app`), alors que leurs anciens chemins vivent dans des favoris, des emails déjà envoyés et des retours de paiement en vol. Les redirections permanentes de l'application sont donc une table unique, `LEGACY_SCREEN_PATHS` (`apps/web/lib/legacy-paths.ts`) : ancien chemin interne → `{ target, module }`. `apps/web/proxy.ts` la lit sur le chemin interne (préfixe de langue retiré) et répond 308 vers la cible re-préfixée dans la langue de la requête, requête conservée.

Chaque ligne nomme le module qui sert son écran, et `legacyScreenTarget` ne redirige que si ce module est dans `registry.moduleIds` ; un module coupé laisse l'ancien chemin répondre 404 plutôt que d'envoyer vers un second 404. Le signal est le module, pas la navigation, parce que des écrans déplacés (centre de notifications, parcours d'intégration) n'ont par décision aucune entrée de navigation.

## Considered options

- **`redirects()` de `next.config.ts`** — rejeté : `output: 'standalone'` fige cette configuration au build, la cible ne pourrait pas dépendre des modules activés, et son ordre avec la réécriture de langue du proxy n'est pas maîtrisé.
- **Une page par ancien chemin qui appelle `permanentRedirect`** — rejeté : un fichier d'écran par redirection, qui réserve un segment et doit être rangé dans une zone.
- **Une clé de contrat « écrans », ou une entrée de navigation pour chaque écran déplacé** — rejeté : la table porte elle-même l'information, et une entrée ferait paraître dans la barre latérale des écrans qui n'y ont pas leur place.

## Consequences

Chaque déplacement d'écran ajoute une ligne à la table et son ancien chemin à `tests/fixtures/legacy-screen-paths.json` ; `tests/legacy-paths.test.ts` exige que chaque chemin de l'inventaire soit servi ou redirigé, et que chaque module nommé existe dans l'annuaire. La cible est toujours une constante exportée par le module, jamais une valeur lue dans la requête : pas de redirection ouverte. Les segments redirigés restent réservés aux organisations (`APPLICATION_SEGMENTS`). Un écran dont le module est activé mais qui répond 404 pour une autre raison (une fonctionnalité que `config/gating.ts` ne réserve plus) redirige vers ce 404 : accepté.
