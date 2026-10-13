# ADR 082 — killer-saas cède la place aux skills mattpocock

- Status: accepted — la clause qui déplaçait les ADR « sans changer leur contenu » et le gabarit MADR obligatoire sont supersédés par l'ADR 084
- Date: 2026-10-12

Le boilerplate a été construit avec une méthode maison, killer-saas : des commandes slash préfixées `ks`, des sous-agents, des gabarits, un binaire et un pipeline en six phases par story qui écrivait un fichier par phase sous `docs/`. Il a livré l'essentiel du produit, mais le suivi ne suivait pas — les défauts relevés vivaient dans des rapports de revue et presque aucun n'avait d'issue —, des centaines d'artefacts noyaient le signal, et la règle absolue « aucun code hors pipeline » faisait refuser à un agent tout ticket qui ne passait pas par elle (`docs/agents/etat-des-lieux.md`). killer-saas est retiré entièrement. Le travail suit la chaîne des skills mattpocock — `/grill-with-docs` → `/to-spec` → `/to-tickets` → `/implement` ou `/implement-spec` → `/code-review` → une PR vers `dev`, fusionnée en squash — et se suit dans les issues GitHub, plus dans des fichiers.

Ce qui appartient au projet reste : les règles de jugement dans `CODING_STANDARDS.md` (lu par `/code-review`), y compris les principes de test repris de la méthode ; les bases `docs/security.md` et `docs/reliability.md`, bloquantes pour une fusion ; le harnais de tests et `docs/commands.md` ; le PRD et son cimetière, l'architecture, les `AGENTS.md` de paquet ; le CLI de modules (`pnpm ks`) et le serveur MCP, qui font partie du produit malgré leur nom ; les ADR, déplacées dans `docs/adr/NNNN-slug.md` sans changer de numéro, pour que les skills les trouvent — leur contenu a ensuite été nettoyé par l'ADR 084. Ce qui part : les commandes, agents, skills, gabarits et binaire de la méthode, tous les artefacts du pipeline, la règle absolue, les identifiants et branches de story, la porte `Ship allowed` et le budget de tests chiffré.

## Considered options

- **Forker et élaguer killer-saas** (garder les portes, retirer les phases lourdes) — rejeté : une méthode maison à maintenir seul, avec son binaire et ses gabarits, alors que le besoin réel — une spec, des tickets, une revue — est couvert par des skills maintenues ailleurs. Ce qui valait d'être gardé, ce sont des principes ; ils sont dans `CODING_STANDARDS.md`.

## Consequences

Plus aucune porte mécanique entre une revue et une fusion : la discipline repose sur la revue de la PR. Les recherches, plans et revues de la méthode ne se lisent plus que dans l'historique git. `tests/agents-md.test.ts` vérifie que chaque fichier de `docs/adr/` suit `NNNN-slug.md`, que chaque « ADR NNN » citée dans un fichier suivi a son fichier, et qu'aucun fichier suivi ne cite un emplacement retiré de la méthode.
