# ADR 044 — L'essai expire par le temps, et il commence une fois par périmètre

- Status: accepted
- Date: 2026-09-02

Un essai est un droit d'accès que personne n'a payé, et le seul événement du fournisseur qui le termine peut se perdre ; la réconciliation (ADR 034) le rattraperait, mais trop tard pour un droit d'accès. `grantsAccess` n'accorde donc l'accès à un abonnement `trialing` que tant que `now < trialEnd` : le terme est opposable localement, sans événement ni tâche planifiée. Un `trialing` sans `trial_end` retombe sur `currentPeriodEnd`, pour rester borné sans couper un essai légitime ; `displayStateOf` affiche un essai périmé comme `expired`.

Le fournisseur n'a aucune mémoire d'essai par client : `trial_period_days` est posé à chaque ouverture de checkout, et un périmètre pouvait enchaîner les essais. `trialDaysFor` rend `null` dès qu'un abonnement du client porte un `trial_end` ; `openCheckout` l'applique sur les abonnements qu'il lit déjà pour sa garde `already_subscribed`. La trace est le cache d'abonnements, reconstructible par `pnpm billing:reconcile` : aucune table, aucune donnée personnelle ni catégorie de données de plus.

## Considered options

- **Une table `billing_trial`** — rejeté : elle duplique ce que le cache porte, n'est pas reconstructible depuis le fournisseur, et ouvre une catégorie de données, une rétention, une purge et un export pour une information dérivable.
- **Une marque dans `metadata` chez le fournisseur** — rejeté : `metadata` se modifie depuis le tableau de bord, et l'essai deviendrait falsifiable (ADR 034).
- **Refuser le second checkout** — rejeté : un périmètre dont l'essai a expiré doit pouvoir payer ; c'est l'essai qui est consommé, pas le droit de souscrire.

## Consequences

- « Une fois par périmètre » est littéral : un compte qui crée plusieurs organisations obtient plusieurs essais (ADR 025), et un périmètre dont le cache a été purgé à la suppression de compte en retrouve un. Rattacher l'essai à une personne demanderait de conserver une donnée que l'effacement doit emporter ; un projet qui redoute l'abus le tranche par une ADR.
- Deux checkouts simultanés peuvent encore accorder deux essais au même périmètre (issue #97).
