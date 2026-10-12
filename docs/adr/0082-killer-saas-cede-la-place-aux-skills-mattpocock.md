# ADR 082 — killer-saas cède la place aux skills mattpocock

- Status: accepted
- Date: 2026-10-12
- Scope: framing (spec #187)

## Context
Le boilerplate a été construit avec une méthode maison, killer-saas : des
commandes slash préfixées `ks`, quatre sous-agents, six skills, des gabarits,
un binaire, et un pipeline en six phases par story
(recherche → maquette → plan → exécution → revue → livraison) qui écrivait un
fichier par phase sous `docs/`. Il a livré l'essentiel du produit, mais le
propriétaire du projet n'en est pas satisfait : la gestion de projet est
devenue un foutoir.

L'état des lieux du 12/10/2026 (`docs/agents/etat-des-lieux.md`) l'a mesuré :

- **Le suivi ne suivait pas.** Les défauts relevés vivaient dans les rapports
  de revue, et la règle « un major ouvert devient une issue à la livraison »
  est arrivée tard. Quatre issues seulement étaient encore ouvertes, alors que
  73 revues de story finissaient par un `Max severity: major` pour 38 d'entre
  elles. Relire tous les fichiers du pipeline a produit **110 issues**.
- **Le volume noie le signal.** Environ 350 artefacts de pipeline, 60 fichiers
  de méthode, un journal de 148 Ko, et deux fichiers de consignes de plus de
  220 lignes chacun où les règles du projet se mêlent à celles de la méthode.
- **La méthode bloque son remplaçant.** Sa règle absolue, « aucun code hors
  pipeline », fait refuser à un agent un ticket qui ne passe pas par elle.
- **Les ADR sont invisibles pour les autres outils**, rangées dans
  un dossier à part au format `NNN-slug.md`, quand les skills d'ingénierie lisent
  `docs/adr/NNNN-slug.md`.

## Decision
Retirer killer-saas entièrement et travailler avec les skills mattpocock :
`/grill-with-docs` → `/to-spec` → `/to-tickets` → `/implement` ou
`/implement-spec` → `/code-review` → une PR vers `dev`, fusionnée en squash.
Le travail se suit dans les issues GitHub, plus dans des fichiers.

Ce qui appartient au projet reste, sans perte :

- les règles de jugement, dans `CODING_STANDARDS.md` (lu par `/code-review`) :
  contrat de module, quatre couches, règles des ports, règles qui mordent, et
  les principes de test repris de la méthode — un test qui reste vert quand on
  supprime sa règle est pire qu'aucun test, et un test se prouve par
  neutralisation ;
- les bases sécurité et fiabilité (`docs/security.md`, `docs/reliability.md`),
  bloquantes pour une fusion au même titre qu'une régression fonctionnelle ;
- le harnais de tests et la référence des commandes (`docs/commands.md`) ;
- le PRD et son cimetière, l'architecture, les `AGENTS.md` de paquet ;
- les ADR, déplacées par `git mv` dans `docs/adr/` sur quatre chiffres, sans
  changer leur numéro ni leur contenu — à une exception près : un renvoi vers
  un fichier ou une commande de la méthode retirée est remplacé par une
  formulation sans chemin, qui renvoie à l'historique git ; aucune raison,
  option, décision ni conséquence ne change. « ADR 069 » désigne toujours la
  même décision. Le gabarit MADR est rangé avec elles (`docs/adr/template.md`) ;
- le CLI de modules (`pnpm ks`) et le serveur MCP, qui font partie du produit
  malgré leur nom.

Ce qui part : les commandes, agents, skills, gabarits et le binaire de la
méthode ; tous les artefacts du pipeline (recherches, plans, revues, fiches de
vérification, maquettes, le fichier des stories, le fichier d'état, le journal
de la méthode) ;
la règle absolue et le mode Quick Fix ; les identifiants de story et les
branches par story ; la porte `Ship allowed` ; le budget de tests chiffré ; la
machinerie de lots, de budget et de conflits, et les ports par worktree ; la
règle d'un commit par story.

## Considered options
- **Garder killer-saas** — rejeté : le propriétaire du projet n'en veut plus,
  et l'état des lieux montre que son coût (fichiers à écrire, à relire, à
  tenir à jour) ne se traduisait pas en suivi : la plupart des défauts qu'il
  relevait n'avaient pas d'issue.
- **Forker et élaguer killer-saas** (garder les portes, retirer les phases
  lourdes) — rejeté : on garderait une méthode maison à maintenir seul, avec
  son binaire, ses gabarits et ses règles, alors que le besoin réel — une spec,
  des tickets, une revue — est déjà couvert par des skills maintenues ailleurs.
  Ce qui valait d'être gardé, ce sont des principes, pas une machinerie : ils
  passent dans `CODING_STANDARDS.md`.
- **Passer aux skills mattpocock** — retenu : une chaîne courte, des tickets
  dans GitHub, une revue qui lit les règles du projet dans un seul fichier.

## Consequences
Facilité : une seule méthode dans le dépôt ; un agent implémente un ticket sans
le refuser ; les consignes tiennent en trois documents courts et sans
recouvrement (`AGENTS.md`, `CODING_STANDARDS.md`, `docs/commands.md`) ; les
skills trouvent les ADR et choisissent le bon numéro suivant.

Difficulté : plus aucune porte mécanique entre une revue et une fusion — la
discipline repose sur la revue de la PR. Les recherches, plans et revues de
s01 à s68 ne se lisent plus que dans l'historique git ; l'état des lieux cite
leurs liens figés à un commit.

À surveiller : les pointeurs vers les fichiers supprimés. `tests/agents-md.test.ts`
vérifie que chaque fichier de `docs/adr/` suit `NNNN-slug.md` et que chaque
« ADR NNN » citée dans un fichier suivi a son fichier, et qu'aucun fichier
suivi ne cite un emplacement retiré de la méthode.
