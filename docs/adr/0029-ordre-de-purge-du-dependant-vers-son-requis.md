# ADR 029 — La purge parcourt les modules du dépendant vers son requis

- Status: accepted
- Date: 2026-08-31

`purgeModules` (`packages/core/src/registry.ts`) parcourt les modules activés dans l'ordre **inverse** du graphe `requires` : le dépendant avant son requis. Le montage des routes et les migrations gardent l'ordre direct.

La raison : le module `organizations` doit effacer les invitations adressées au compte purgé, et la seule chose qui relie une invitation à ce compte est l'adresse, lue sur le compte. Purgé après `auth`, qui supprime `auth_user`, il n'a plus rien à lire, et l'adresse survit à l'effacement. C'est aussi le sens des clés étrangères — un dépendant référence son requis (ADR 018) — donc l'ordre où une suppression ne dépend d'aucune cascade. `tests/module-registry.test.ts` vérifie les deux ordres ensemble.

## Considered options

- **Ajouter l'adresse au `ModuleScope`** — rejeté : le périmètre désigne, il ne transporte pas ; une donnée personnelle voyagerait dans tous les modules.
- **Recopier l'adresse dans une colonne du module** — rejeté : la même donnée personnelle à deux endroits, deux purges à synchroniser.
- **Lire l'adresse plus tôt, par un second appel du contrat (`prepare`)** — rejeté : rouvrirait le contrat de tous les modules (ADR 007).
- **S'en remettre à la rétention** — rejeté comme seule réponse : elle borne une durée de vie, elle ne répond pas à une demande d'effacement.

## Consequences

Deux ordres coexistent dans le registre — direct pour monter et migrer, inverse pour effacer. L'export garde l'ordre direct, puisqu'il ne détruit rien ; si un module se met à dériver son export de celui d'un autre, la question se rouvre.
