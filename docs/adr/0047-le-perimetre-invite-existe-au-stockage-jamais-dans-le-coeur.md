# ADR 047 — Le périmètre invité existe au stockage, jamais dans le cœur

- Status: accepted
- Date: 2026-09-03
- Scope: story s24-guest-checkout

## Context

`s24-guest-checkout` demande qu'un visiteur sans compte puisse payer. Deux règles
déjà écrites s'y opposent frontalement.

**L'ADR 034 §1** impose que la ligne `billing_customer` soit écrite « pendant
l'ouverture du checkout […] **jamais** à la réception de
`checkout.session.completed` ». Elle achète une garantie nommée : « tout
événement `customer.subscription.*` résout son propriétaire par
`provider_customer_id`, quel que soit son ordre d'arrivée. […] il n'y a pas de
tampon d'événements orphelins. »

**Le critère 5** de la story impose qu'« un paiement abandonné ne crée ni compte
ni droit d'accès ».

Un visiteur anonyme n'a pas de compte à rattacher à l'ouverture du tunnel, et on
n'a pas le droit d'en créer un avant le paiement. La voie évidente — rattacher à
la réception du webhook — viole le « jamais » de l'ADR 034 et **rouvre le tampon
d'événements orphelins** : un `customer.subscription.created` arrivé avant que
`checkout.session.completed` soit traité n'aurait aucun propriétaire.

## Decision

Le périmètre invité existe **au stockage du module `billing`**, et nulle part
ailleurs.

`billing_customer.scope_kind` / `scope_id` sont deux colonnes de **texte**, sans
clé étrangère (ADR 018). Un checkout invité y écrit `scope_kind = 'guest'` et un
`scope_id` opaque, non devinable, à l'ouverture du tunnel — donc **au moment
qu'exige l'ADR 034**, dont la garantie d'ordre est préservée intacte :
`provider_customer_id` ne change jamais, et tout événement continue d'y résoudre
son propriétaire.

À la réception de `checkout.session.completed`, la ligne est **promue** :
`scope_kind` passe à `'user'` et `scope_id` à l'identifiant du compte, créé ou
retrouvé par l'adresse du paiement. La promotion est une mise à jour idempotente
— l'unicité de `provider_customer_id` interdit qu'un rejeu fabrique une seconde
ligne.

Le type `ModuleScope` de `packages/core/src/module.ts:215` **n'est pas touché**.
Il garde ses deux formes, `user` et `organization`.

## Considered options

- **Ajouter un troisième cas `guest` à `ModuleScope`** — rejeté : ce type est
  partagé par la purge et l'export de **tous** les modules. Un troisième cas
  obligerait à rouvrir chaque module déjà écrit pour lui faire traiter un
  périmètre qui n'a ni donnée à exporter ni donnée à purger. Le coût est
  proportionnel au nombre de modules, pour une notion qui n'appartient qu'à un
  seul.
- **Rattacher à la réception du webhook** — rejeté : viole explicitement
  l'ADR 034 §1, et rouvre le désordre de rattachement que celui-ci avait
  supprimé. Le coût ne se voit pas en développement, où les événements arrivent
  dans l'ordre ; il se voit en production, sur les paiements dont l'abonnement
  précède la session.
- **Créer un compte « provisoire » avant le paiement, puis l'effacer si le
  paiement échoue** — rejeté : viole le critère 5 (un abandon aurait créé un
  compte), et l'effacement est un chemin destructeur dont le PRD ne veut pas.
  Il ouvrirait aussi une fabrique de comptes non sollicités depuis une route
  publique.
- **Un ADR successeur à l'ADR 034** — rejeté : l'ADR 034 n'est pas remplacé, il
  est **respecté**. Sa règle d'ordre continue de s'appliquer telle quelle ; cette
  décision ne fait qu'étendre ce qu'un périmètre a le droit d'être dans une
  colonne de texte.

## Consequences

- **La garantie d'ordre de l'ADR 034 survit sans exception.** C'est le point de
  cette décision, et ce qui la distingue du rattachement au webhook.
- **Un paiement abandonné laisse une ligne `billing_customer` orpheline** :
  périmètre invité, aucun compte, aucun droit. Ce n'est ni un compte ni un droit
  d'accès, donc le critère 5 est tenu — mais ces lignes s'accumulent et rien ne
  les nettoie. Leur rétention doit être déclarée au contrat du module, comme
  toute catégorie de données.
- **Le `scope_id` invité doit être opaque et non devinable.** Il est écrit avant
  tout paiement et vit dans une ligne que le webhook retrouvera : un identifiant
  prévisible permettrait de viser la ligne d'un autre.
- **Une requête qui lit « le client de ce périmètre » doit ignorer les invités**
  partout où elle sert un compte. Un `scope_kind` non filtré rendrait une ligne
  invitée là où on attend un utilisateur.
- Ce que cette décision ne tranche pas : ce que fait le lien envoyé à une adresse
  **qui possède déjà un compte**. C'est une question d'authentification, pas de
  périmètre.
