# ADR 047 — Le périmètre invité existe au stockage de `billing`, jamais dans le cœur

- Status: accepted
- Date: 2026-09-03

Un visiteur sans compte peut payer, et un paiement abandonné ne doit créer ni compte ni droit d'accès. L'ADR 034 impose pourtant que la ligne `billing_customer` soit écrite à l'ouverture du checkout, jamais à la réception de `checkout.session.completed` : c'est ce qui permet à tout événement `customer.subscription.*` de résoudre son propriétaire par `provider_customer_id`, quel que soit son ordre d'arrivée. Rattacher l'invité au webhook rouvrirait le tampon d'événements orphelins.

Le périmètre invité existe donc **au stockage du module `billing`**, et nulle part ailleurs. `billing_customer.scope_kind` / `scope_id` sont du texte sans clé étrangère (ADR 018) : un checkout invité y écrit `scope_kind = 'guest'` (`GUEST_SCOPE_KIND`) et un `scope_id` opaque, non devinable, à l'ouverture du tunnel — au moment qu'exige l'ADR 034, dont la garantie d'ordre survit intacte. À `checkout.session.completed`, la ligne est **promue** vers le compte créé ou retrouvé par l'adresse du paiement ; l'unicité de `provider_customer_id` rend la promotion idempotente. `ModuleScope` (`packages/core`) garde ses deux formes, `user` et `organization`.

## Considered options

- **Un troisième cas `guest` dans `ModuleScope`** — rejeté : ce type est partagé par la purge et l'export de tous les modules ; chacun devrait traiter un périmètre qui n'appartient qu'à un seul.
- **Un compte provisoire créé avant le paiement, effacé s'il échoue** — rejeté : un abandon aurait créé un compte, l'effacement est un chemin destructeur, et une route publique deviendrait une fabrique de comptes.

## Consequences

- Un paiement abandonné laisse une ligne invitée qu'aucune purge n'atteint : aucun périmètre ne la nomme. Elle n'est ni un compte ni un droit, et elle est déclarée comme catégorie `guest-checkout` du module ; aucune commande de nettoyage ne doit exister.
- Le `scope_id` invité doit rester imprévisible, et toute lecture de « client de ce périmètre » qui sert un compte doit ignorer les lignes invitées.
- Le lien envoyé après paiement dépend de l'adresse : définition de mot de passe si aucun compte n'existe, magic link sinon (`apps/web/lib/guest-account.ts`).
