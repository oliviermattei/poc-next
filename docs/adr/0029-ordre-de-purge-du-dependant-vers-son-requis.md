# ADR 029 — La purge parcourt les modules du dépendant vers son requis

- Status: accepted
- Date: 2026-08-31
- Scope: story s16-invite-members

## Context

`purgeModules` (`packages/core/src/registry.ts`) appelait la purge de chaque
module activé **dans l'ordre du graphe** — un requis avant son requérant, le
même ordre que le montage des routes et que l'application des migrations
(ADR 019, « l'ordre d'exécution vient du tri du graphe `requires` »).

La revue de s16 a mesuré ce que cet ordre coûte. Le module `organizations` doit
effacer `organization_invitation.email` : l'adresse d'une personne qui n'a pas
nécessairement de compte, déclarée depuis dans ses `dataCategories`. La seule
chose qui relie cette ligne au compte purgé, c'est **l'adresse elle-même**, lue
sur le compte (`emailOf`). Or `auth` — son requis — purge en supprimant
`auth_user`. Purgé après lui, `organizations` n'a plus rien à lire : l'adresse
d'une personne survivait à l'effacement de son compte (constat F6, mesuré :
1 ligne avant, 1 après).

Le module ne peut pas s'en sortir seul. Il ne peut pas garder une copie de
l'adresse — ce serait la même donnée personnelle, dupliquée. Il ne peut pas
lire `auth_user` par adresse — c'est précisément l'interdit qui rend l'absence
d'énumération de comptes structurelle (`docs/security.md` §7). Et une clé
étrangère ne peut pas porter le destinataire d'une invitation, puisqu'il n'a
souvent pas de compte.

## Decision

**`purgeModules` parcourt les modules activés dans l'ordre inverse du graphe :
le dépendant avant son requis.** Le registre, lui, ne change pas : `modules` et
`moduleIds` gardent l'ordre du graphe, et le montage comme les migrations
gardent le leur.

C'est le seul ordre dans lequel un module peut encore résoudre ce que son requis
détient au moment d'effacer. C'est aussi le sens des clés étrangères — un
dépendant référence son requis, jamais l'inverse (ADR 018) —, donc l'ordre dans
lequel une suppression ne dépend d'aucune cascade pour ne pas violer une
contrainte.

`tests/module-registry.test.ts` le tient : deux modules d'essai, `b` requiert
`a`, la purge doit les appeler dans l'ordre `b` puis `a`, et le montage rester
`a` puis `b`.

## Considered options

- **Garder l'ordre du graphe et faire lire l'adresse plus tôt** — rejeté : il
  n'existe aucun point où un module pourrait « lire plus tôt ». Le contrat ne
  donne qu'un appel, `purge(scope)`, et l'ajout d'un second (un `prepare`)
  rouvrirait les quatorze clés de tous les modules déjà écrits (ADR 007).
- **Ajouter l'adresse au `ModuleScope`** — rejeté : `ModuleScope` désigne un
  **périmètre** (`{kind:'user', userId}`), pas une charge utile. Y mettre
  l'adresse ferait voyager une donnée personnelle dans tous les modules, dont
  ceux qui n'en ont aucun usage, et le jour où un module aura besoin d'un autre
  champ la question se reposera à l'identique.
- **Recopier l'adresse dans une colonne du module** — rejeté : c'est la même
  donnée personnelle, à deux endroits, avec deux purges à tenir synchronisées.
- **Laisser la rétention s'en charger** (une tâche planifiée efface les
  invitations échues) — rejeté comme **seule** réponse : la rétention borne la
  durée de vie, elle ne répond pas à une demande d'effacement. Les deux sont
  complémentaires, et la tâche n'existe pas encore.
- **Ne rien changer et documenter la limite** — rejeté : « une adresse survit à
  l'effacement du compte » est un défaut, pas une limite acceptable, et le
  documenter aurait produit exactement la phrase qui fait qu'un agent suivant
  cesse de chercher (ADR 013).

## Consequences

**Plus facile.** Un module peut, pendant sa purge, lire ce que ses requis
détiennent encore : c'est ce qui permet à `organizations` d'effacer les
invitations adressées au compte. Une suppression n'a plus besoin d'une cascade
pour tomber dans le bon ordre.

**Plus difficile.** Deux ordres coexistent désormais dans le registre — direct
pour monter et migrer, inverse pour effacer. Confondre les deux est le piège, et
c'est pourquoi un cas les vérifie **ensemble** dans le même test.

**À surveiller.** L'export, lui, garde l'ordre direct : il ne détruit rien, donc
l'ordre ne change pas son résultat. Si un module se met un jour à dériver son
export de ce qu'un autre a déjà rendu, la question devra être rouverte.
