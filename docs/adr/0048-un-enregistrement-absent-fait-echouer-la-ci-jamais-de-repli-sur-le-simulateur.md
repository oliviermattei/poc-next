# ADR 048 — Un enregistrement absent fait échouer la CI, jamais de repli sur le simulateur

- Status: accepted
- Date: 2026-09-03

Le parcours doré rejoue en CI des **événements webhook Stripe enregistrés**, sans appel sortant. Les événements du simulateur (`packages/payments-testing`, `evt_local_*`) portent les champs que nous avons jugés nécessaires : un simulateur ne détecte pas sa propre dérive, et le jour où le fournisseur change une forme, il reste vert pendant que la production casse.

**Un enregistrement attendu et absent fait échouer le parcours doré, en nommant l'événement manquant** ; il n'existe aucun repli vers le simulateur, comme un mode local de port est toujours explicite, jamais déduit. Les deux régimes se choisissent : en CI, le rejeu de `tests/fixtures/stripe-events/` ; hors CI et sur commande, les clés de test réelles (`packages/adapters/stripe/src/stripe-live.test.ts`), qui **produisent** les enregistrements. Ceux-ci sont assainis avant d'être versionnés : les identifiants du compte de test deviennent des valeurs stables et inertes, et ce qui est versionné est la forme de l'événement. Le simulateur garde le développement local et les parcours qui n'ont pas besoin de fidélité au fournisseur.

## Considered options

- **Retomber sur le simulateur quand l'enregistrement manque** — rejeté : la CI resterait verte en ayant cessé de vérifier ce qu'elle prétend vérifier.
- **Appeler le vrai Stripe en CI** — rejeté : la CI dépendrait d'un tiers et d'un secret, et échouerait pour des raisons étrangères au code.
- **Générer les enregistrements depuis le schéma OpenAPI du fournisseur** — rejeté : ce serait un second simulateur, qui dériverait de la même façon.

## Consequences

- Le job du parcours doré est armé par la **présence** d'un enregistrement, pas par un drapeau (`.github/workflows/ci.yml`, jobs `enregistrements` et `parcours-dore`). Tant que `tests/fixtures/stripe-events/` n'en porte aucun, la garantie de cette ADR n'est pas active ; les produire demande des clés de test réelles, donc un geste humain (issue #106).
- Un enregistrement fige la forme du jour où il a été pris : réenregistrer reste un geste périodique, dont ni la fréquence ni l'alerte de péremption ne sont tranchées.
