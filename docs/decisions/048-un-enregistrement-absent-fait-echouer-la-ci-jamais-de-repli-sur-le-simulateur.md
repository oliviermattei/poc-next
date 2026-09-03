# ADR 048 — Un enregistrement absent fait échouer la CI, jamais de repli sur le simulateur

- Status: accepted
- Date: 2026-09-03
- Scope: story s25-golden-path-e2e

## Context

Le critère 6 de `s25-golden-path-e2e` demande qu'en CI le parcours doré rejoue
des **événements webhook Stripe enregistrés**, sans appel réseau sortant.
`AGENTS.md` pose la même règle pour tout le dépôt.

La recherche a établi qu'aucun enregistrement n'existe : les événements viennent
d'un simulateur écrit à la main (`packages/payments-testing/src/local-payments.ts`,
`evt_local_*`), dont les champs sont ceux que **nous** avons jugés nécessaires.

Un simulateur ne peut pas détecter sa propre dérive. Le jour où le fournisseur
renomme un champ, ajoute une contrainte ou change une forme, le simulateur reste
vert et la production casse. C'est précisément le mode de défaillance que le
rejeu d'enregistrements existe pour fermer.

La tentation est donc écrite d'avance : quand aucun enregistrement n'est
disponible, retomber sur le simulateur. Le parcours resterait vert, la CI
resterait verte, et personne ne saurait que la garantie a disparu.

Le dépôt a déjà tranché une question de cette forme, pour les ports : « Un port
qui retombe silencieusement sur un remplaçant local ne peut plus distinguer un
envoi réel d'un envoi capturé, y compris en production. » Le mode local doit être
**explicite**, jamais déduit.

## Decision

**Un enregistrement absent fait échouer le parcours doré, en nommant l'événement
manquant.** Il n'existe aucun repli automatique du régime enregistré vers le
simulateur.

Les deux régimes restent séparés et se choisissent **explicitement** :

- **CI** — rejeu des enregistrements. Aucun appel sortant. Si un événement
  attendu n'a pas d'enregistrement, la commande échoue et le dit. Bloquant.
- **Hors CI, sur commande explicite** — clés de test réelles, comme le fait déjà
  `packages/adapters/stripe/src/stripe-live.test.ts` depuis s19. C'est ce régime
  qui **produit** les enregistrements que la CI rejoue.

Le simulateur `payments-testing` garde son emploi actuel — le développement local
et les parcours qui n'ont pas besoin de fidélité au fournisseur — et n'est jamais
substitué à un enregistrement manquant.

Les enregistrements sont **assainis avant d'être versionnés** : les identifiants
de client, de session et d'abonnement du compte de test sont remplacés par des
valeurs stables et inertes. Ce qui est versionné est la **forme** de l'événement,
qui est ce qui dérive ; pas les identifiants, qui n'apprennent rien et exposent
un compte réel.

## Considered options

- **Retomber sur le simulateur quand l'enregistrement manque** — rejeté : c'est
  la panne silencieuse que tout le reste du dépôt refuse. La CI resterait verte
  en ayant cessé de vérifier ce qu'elle prétend vérifier, et rien ne le dirait.
- **Sauter le parcours doré quand les enregistrements manquent** — rejeté pour la
  même raison, en pire : un test sauté ne rougit pas, et cette session a déjà
  mesuré ce que coûtent 288 tests qui se sautaient en silence.
- **Appeler le vrai Stripe en CI** — rejeté : rend la CI dépendante d'un tiers et
  d'un secret, la fait échouer pour des raisons étrangères au code, et mélange
  les deux régimes que la story interdit nommément de mélanger.
- **Générer les enregistrements depuis le schéma OpenAPI du fournisseur** —
  rejeté : ce serait un second simulateur, dérivant de la même façon, avec une
  couche d'outillage en plus.

## Consequences

- **La CI ne peut pas passer sans enregistrements.** Les produire est donc un
  prérequis de cette story, pas un raffinement ultérieur — et cela demande une
  exécution contre les clés de test réelles, c'est-à-dire un geste humain avec
  des secrets que le harnais n'a pas.
- **Un enregistrement périme.** Le jour où le fournisseur change une forme,
  l'enregistrement versionné ne le sait pas non plus : il fige la forme du jour
  où il a été pris. Ce qu'il apporte n'est pas l'actualité, c'est qu'un
  changement de **notre** lecture devient visible. Réenregistrer reste un geste
  périodique, et sa date doit être écrite à côté des fichiers.
- **Le régime réel devient une obligation avant chaque ship** (critère 7), donc
  une modification du processus et non seulement du code.
- Ce que cette décision ne tranche pas : la **fréquence** de réenregistrement, ni
  ce qui doit rougir quand un enregistrement devient trop vieux.
