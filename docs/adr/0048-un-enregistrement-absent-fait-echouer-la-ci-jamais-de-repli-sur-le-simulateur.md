# ADR 048 — Un enregistrement absent fait échouer la CI, jamais de repli sur le simulateur

- Status: accepted
- Date: 2026-09-03

## Context

Le parcours doré doit rejouer en CI des **événements webhook Stripe enregistrés**, sans appel réseau sortant. Les événements du simulateur (`packages/payments-testing`, `evt_local_*`) portent les champs que **nous** avons jugés nécessaires : un simulateur ne peut pas détecter sa propre dérive. Le jour où le fournisseur renomme un champ ou change une forme, le simulateur reste vert et la production casse — c'est le mode de défaillance que le rejeu d'enregistrements existe pour fermer.

La tentation est écrite d'avance : quand un enregistrement manque, retomber sur le simulateur. Le dépôt a déjà refusé cette forme pour les ports : un mode local est **explicite**, jamais déduit.

## Decision

**Un enregistrement attendu et absent fait échouer le parcours doré, en nommant l'événement manquant.** Il n'existe aucun repli du régime enregistré vers le simulateur.

Les deux régimes se choisissent explicitement :

- **CI** — rejeu des enregistrements de `tests/fixtures/stripe-events/`, aucun appel sortant.
- **Hors CI, sur commande explicite** — clés de test réelles (`packages/adapters/stripe/src/stripe-live.test.ts`). C'est ce régime qui **produit** les enregistrements.

Le simulateur garde son emploi — développement local et parcours qui n'ont pas besoin de fidélité au fournisseur — et ne remplace jamais un enregistrement manquant.

Les enregistrements sont **assainis avant d'être versionnés** : les identifiants du compte de test sont remplacés par des valeurs stables et inertes. Ce qui est versionné est la **forme** de l'événement, qui est ce qui dérive.

## Considered options

- **Retomber sur le simulateur quand l'enregistrement manque** — rejeté : la CI resterait verte en ayant cessé de vérifier ce qu'elle prétend vérifier, et rien ne le dirait.
- **Appeler le vrai Stripe en CI** — rejeté : la CI dépendrait d'un tiers et d'un secret, échouerait pour des raisons étrangères au code, et mélangerait les deux régimes.
- **Générer les enregistrements depuis le schéma OpenAPI du fournisseur** — rejeté : ce serait un second simulateur, qui dériverait de la même façon.

## Consequences

- **Le job de CI du parcours doré est armé par la présence d'un enregistrement**, pas par un drapeau (`.github/workflows/ci.yml`, jobs `enregistrements` et `parcours-dore`). Tant que `tests/fixtures/stripe-events/` n'en porte aucun, le job ne tourne pas : la garantie de cette ADR n'est **pas encore active**. Produire les enregistrements demande des clés de test réelles, donc un geste humain (#106).
- **Un enregistrement périme** : il fige la forme du jour où il a été pris. Réenregistrer reste un geste périodique, et sa date s'écrit à côté des fichiers. Ni la fréquence, ni ce qui doit rougir quand un enregistrement devient trop vieux ne sont tranchés ici.
