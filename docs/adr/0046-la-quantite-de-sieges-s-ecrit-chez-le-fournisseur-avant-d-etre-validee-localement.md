# ADR 046 — La quantité de sièges s'écrit chez le fournisseur avant que l'appartenance soit validée

- Status: accepted
- Date: 2026-09-03

Une organisation facturée au siège change d'effectif dans notre base et de quantité chez le fournisseur, sans transaction commune : l'ordre des écritures choisit le défaut résiduel. Nous écrivons **d'abord chez le fournisseur** : le module `organizations` insère l'appartenance dans une transaction non validée, appelle `seatSync` (`syncSeats` du module `billing`, câblé par `apps/web/lib/seat-sync.ts`), puis valide sur `ok` et annule sur un refus. La clé d'idempotence dérive du périmètre, de l'abonnement et de la **quantité visée**, jamais d'un incrément : un rejeu converge.

La raison : ajouter un membre accorde un accès, et cet accès doit être couvert par un siège facturé. Dans l'ordre inverse, chaque panne du fournisseur ferait des membres non facturés jusqu'à une correction, et le fournisseur ne pourrait plus rien refuser — or le refus porte aussi le plafond de sièges de l'offre (`seat_limit_reached`, distinct de `seat_sync_unavailable`). Un fournisseur muet n'ajoute ni ne retire personne, et le geste se rejoue. Le défaut qui reste — validation locale en échec après un succès fournisseur — surfacture au plus un siège ; `pnpm billing:reconcile` le corrige en écrivant vers le fournisseur (`alignSeats`), jamais en effaçant une appartenance.

## Considered options

- **Écrire en base d'abord, synchroniser ensuite** — rejeté : un membre sans siège payé, et plus aucun moyen d'opposer un refus ou un plafond à l'ajout. C'est pourtant l'ordre dont le défaut lèse le moins le client ; y revenir passe par une ADR qui le remplace.
- **Une file : ajouter, publier, synchroniser plus tard** — rejeté : la quantité serait fausse entre l'ajout et le traitement, et un bus entrouvrirait ce que le PRD met au cimetière.
- **Tout laisser à la réconciliation** — rejeté : la facture ne serait juste qu'une fois par passage.

## Consequences

- Pour la quantité, le sens de vérité s'inverse : le statut vient du fournisseur (ADR 034), la quantité va vers lui. La réconciliation écrit donc chez le fournisseur, et sa panne n'est plus bénigne.
- Une transaction et le verrou d'appartenance restent ouverts pendant l'appel HTTP (issue #101). Le proratage chez le fournisseur n'est pas tranché ici (issue #102) ; la suppression de compte ne synchronise pas encore les sièges (issue #100).
