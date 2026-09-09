# ADR 071 — Un bloc de mesure dit lui-même pourquoi il est absent

- Status: accepted
- Date: 2026-09-10
- Scope: story s60-back-office-autonome

## Context

Le tableau de bord du back-office montre, sur un seul écran, des chiffres qui
appartiennent à quatre modules : les comptes et leurs connexions (`auth`), les
organisations (`organizations`), les inscriptions publiques (`marketing`), les
achats et le revenu récurrent (`billing`). Le module `admin` ne déclare aucun
d'eux dans ses `requires` : il ne peut ni les importer, ni joindre leurs tables
(ADR 018).

Les quatre ports existants (comptes, organisations, revenu, inscriptions) ont
tous la même forme : `{ ok: true, … } | { ok: false }`. Elle suffit à un **écran
dédié**, qui répond 404 quand son module est coupé — l'entrée de navigation
disparaît avec le module, et l'écran n'est jamais atteint. Elle ne suffit pas à
un tableau de bord : celui-ci est servi dans **toutes** les configurations, et un
bloc doit pouvoir ne pas exister sans que cela ressemble à un zéro. Facturation
coupée, un port qui rend « revenu vide » ferait afficher « 0 € » à un projet qui
n'a pas de facturation ; base injoignable, il ferait afficher « 0 € » à un projet
qui encaisse.

## Decision

**Le port des mesures rend, pour chaque bloc, l'un de trois états** :

| état | ce que l'écran fait | ce que ça veut dire |
|---|---|---|
| `ok` | il affiche | la mesure a été lue |
| `absent` | il n'affiche **rien** | la source n'est pas montée dans ce projet |
| `unavailable` | il affiche une **alerte** | la lecture a échoué |

`absent` est décidé par le **point de composition** de l'application, seul
endroit du dépôt qui sait qu'un module s'appelle `billing`. Le module
d'administration ne le sait pas : il reçoit un bloc et le rend.

Les cinq lectures partent ensemble et aucune n'arrête les autres : un tableau de
bord n'a pas de raison de disparaître parce qu'un fournisseur ne répond pas.

## Considered options

- **Réutiliser la forme des quatre ports existants** (`ok` / pas `ok`) — rejetée :
  elle confond « pas de facturation dans ce projet » et « la base n'a pas
  répondu », et c'est précisément la distinction qui décide entre ne rien
  afficher et alerter.
- **Une clé `dashboard` au contrat de module**, chaque module déclarant son bloc
  — écartée pour cette story, et c'est la piste à rouvrir si un troisième écran
  agrège des modules. Elle demande de rouvrir le contrat (ADR 069 en donne le
  critère) et de faire porter du rendu à chaque module ; le besoin d'aujourd'hui
  est de **lire**, pas de composer.
- **Un port par module** (un cinquième, un sixième, un septième…) — rejetée : les
  quatre blocs répondent à la même question — « qu'est-ce qui s'est passé dans
  cette fenêtre » — et partagent leur fenêtre. Quatre ports auraient quatre fois
  la même signature.
- **Que le module lise l'état du registre** — rejetée : elle ferait entrer un
  identifiant de module dans le code d'un autre module, ce que tout le dépôt
  s'interdit.

## Consequences

**Plus facile** : couper un module retire son bloc sans qu'aucun écran ne change ;
ajouter une mesure revient à ajouter une méthode au port et un bloc à l'écran.

**Plus difficile** : chaque bloc a désormais trois chemins à tenir plutôt que
deux, et un cas de test par chemin. C'est le prix de la distinction.

**À surveiller** : la tentation de rendre `absent` depuis le module — par
exemple en lisant si une lecture rend vide. Ce serait deviner une configuration
à partir d'une donnée, et un projet neuf sans aucun client passerait pour un
projet sans facturation.
