# ADR 044 — L'essai expire par le temps, et il commence une fois par périmètre

- Status: accepted
- Date: 2026-09-02
- Scope: story s21-trials-and-gating

## Context

s19 déclare `trialDays` sur une offre et le passe en `trialPeriodDays` au
checkout ; le fournisseur ouvre alors l'abonnement en `trialing` avec un
`trial_end`, que le cache stocke (`billing_subscription.trial_end`).

s21 exige deux choses de plus, et l'état livré ne tient ni l'une ni l'autre.

**1. « Un essai expiré retire l'accès » (critère 5).** `grantsAccess` accordait
l'accès à un abonnement `trialing` **sans regarder aucune date**. Le commentaire
l'assumait, au titre du retard possible du cache : « refuser l'accès à un client
que Stripe a renouvelé serait le couper sur **notre** retard ». Le raisonnement
tient pour `active`, il ne tient pas pour un essai — un essai est un droit
d'accès **que personne n'a payé**, et le seul événement qui le termine peut se
perdre. C'est même ce que la commande de réconciliation existe pour rattraper
(ADR 034 §3) : un droit d'accès ne peut pas attendre une réconciliation.

**2. « Une période d'essai donne accès jusqu'à son terme » — une fois.** Mesuré
dans `stripe@22.6.1` (`esm/resources/Checkout/Sessions.d.ts`, champ
`subscription_data.trial_period_days`) : le fournisseur n'a **aucune** mémoire
d'essai par client. C'est un nombre que l'appelant pose à chaque ouverture de
session. Un périmètre qui essayait, laissait expirer, puis rouvrait un checkout
recevait quatorze jours de plus — offre après offre, indéfiniment.

## Decision

### 1. Le terme d'un essai est opposable **localement**

`grantsAccess` : un abonnement `trialing` n'accorde l'accès que tant que
`now < trialEnd`. C'est la même mécanique que l'annulation programmée, déjà
écrite : la tolérance au retard du cache s'efface devant une **échéance**, et un
essai en est une. **Aucun événement du fournisseur n'a besoin d'arriver** — le
temps passe, et l'accès se ferme.

`trialEnd` absent d'une ligne `trialing` ne devrait pas exister ; le terme
retombe alors sur `currentPeriodEnd`. L'accès reste ainsi **borné** au lieu de
devenir perpétuel sur une lacune du cache.

`displayStateOf` suit : un essai périmé s'affiche `expired`, pas « période
d'essai ». Dire « essai en cours » à quelqu'un qui n'a plus rien le laisse
chercher pourquoi ses fonctionnalités ont disparu.

### 2. L'essai est accordé **une fois par périmètre**, et la trace est le cache

`trialDaysFor(offerTrialDays, subscriptions)` rend `null` dès qu'un abonnement
du client porte un `trial_end`. `openCheckout` l'appelle sur les abonnements
qu'il lit déjà pour la garde `already_subscribed` — une seule lecture, deux
décisions.

**Aucune table nouvelle.** La trace d'un essai accordé est déjà en cache, et
elle est **reconstructible depuis le fournisseur** : `listSubscriptions` rend
`trialEnd`, donc `pnpm billing:reconcile` la réécrit comme le reste (ADR 034
§3). Conséquence directe : aucune donnée personnelle de plus, donc aucune
catégorie à déclarer dans `dataCategories`, aucune politique de rétention,
aucune purge ni aucun export à rouvrir.

## Considered options

**Sur l'expiration**

- *Attendre l'événement du fournisseur* — c'est l'état livré, et c'est le
  défaut : l'essai restait ouvert d'une durée indéterminée si l'événement se
  perdait. Un webhook perdu est le cas que l'ADR 034 déclare possible et que la
  réconciliation rattrape — donc trop tard pour un droit d'accès.
- *Appeler le fournisseur au moment de la question* — rejeté pour la même raison
  que le rejeu d'objet à chaque webhook (ADR 034) : un appel réseau sur le
  chemin de chaque route réservée, sans limitation de débit avant s28.
- *Une tâche planifiée qui ferme les essais échus* — rejeté : elle ajoute un
  ordonnanceur (s33) au chemin d'un droit d'accès, et entre deux passages
  l'accès resterait ouvert. Une règle pure sur l'instant courant n'a pas de
  fenêtre.
- *Fermer sèchement un `trialing` sans `trial_end`* — rejeté : une lacune du
  cache couperait un essai légitime. Le repli sur la fin de période borne sans
  punir.

**Sur l'unicité**

- *Une table `billing_trial` par périmètre* — rejeté : elle stocke ce que le
  cache porte déjà, elle n'est pas reconstructible depuis le fournisseur sans
  travail supplémentaire, et elle ouvre une catégorie de données, une politique
  de rétention, une purge et un export pour une information dérivable. C'est
  aussi une seconde vérité à réconcilier.
- *Poser une marque dans `metadata` chez le fournisseur* — rejeté par l'ADR 034 :
  `metadata` est modifiable depuis le tableau de bord, et un essai falsifiable
  décide alors de qui accède à quoi gratuitement.
- *Compter les essais au lieu de les interdire* — rejeté : « combien d'essais »
  est un quota, et les quotas quantitatifs sont hors périmètre de la story et au
  cimetière du PRD.
- *Refuser le second checkout au lieu de retirer l'essai* — rejeté : un
  périmètre dont l'essai a expiré doit pouvoir **payer**. C'est l'essai qui est
  consommé, pas le droit de souscrire.

## Consequences

- Le sixième critère de s20 est intact : la garde d'abonnement ne lit que les
  abonnements, celle d'achat que les achats, et l'essai n'entre dans aucune des
  deux — il ne change que le nombre de jours envoyé au fournisseur.
- La réconciliation reste la source de vérité : un `trial_end` relu du
  fournisseur rétablit la mémoire d'essai d'un périmètre, même après une perte
  de cache. **Rejoué** par `tests/billing.test.ts` (« retrouve la mémoire
  d'essai par la réconciliation, cache perdu ») : le cache est effacé, l'essai
  redevient disponible, `reconcile()` le referme. Retirer `trial_end` du mappage
  de l'adaptateur fait rougir ce cas.
- **Ce qui reste ouvert, et que personne ne vérifie** : un compte qui crée
  **plusieurs organisations obtient plusieurs essais**. « Une fois par
  périmètre » est écrit tel quel, et le code le tient exactement : la trace est
  cherchée sur les abonnements du **client de ce périmètre**, et deux
  organisations sont deux clients. C'est la conséquence directe du modèle de
  périmètre (ADR 025), pas un contournement à colmater ici : la lier au compte
  demanderait de rattacher l'essai à une personne plutôt qu'au client facturé,
  donc de conserver une donnée que la purge de ce périmètre ne peut pas
  effacer. Un projet qui vend cher et redoute l'abus devra ouvrir un ADR, et y
  décider ce qu'il rattache au compte.
- **Ce qui reste ouvert, et que personne ne vérifie non plus** : un périmètre
  dont le cache d'abonnements a été purgé (suppression de compte, s34) retrouve un
  essai. C'est la conséquence assumée de « la trace est le cache » — l'effacer
  fait partie du droit à l'effacement, et le retenir ailleurs demanderait de
  conserver une donnée rattachée à une personne effacée. Un projet qui voudrait
  l'inverse devra ouvrir un ADR, et y décider ce qu'il conserve d'un compte
  supprimé.
- **Ce qui reste ouvert aussi** : un essai qui court n'est jamais converti par
  nous. C'est le fournisseur qui facture au terme, et notre cache l'apprend par
  l'événement — ou par la réconciliation. L'accès, lui, ne dépend d'aucun des
  deux tant que l'essai court, et se ferme au terme si aucun ne vient : c'est
  exactement la propriété recherchée.
