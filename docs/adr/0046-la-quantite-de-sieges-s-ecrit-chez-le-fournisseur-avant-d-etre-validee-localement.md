# ADR 046 — La quantité de sièges s'écrit chez le fournisseur avant d'être validée localement

- Status: accepted
- Date: 2026-09-03
- Scope: story s23-seat-billing

## Context

Le critère 6 de `s23-seat-billing` dit : « Un échec de synchronisation Stripe
n'ajoute pas le membre : l'opération est atomique et rejouable. »

Deux systèmes sans transaction commune. L'ordre des écritures n'est pas un détail
d'implémentation : il **choisit le mode de défaillance résiduel**, et les deux
possibles ne coûtent pas la même chose à la même personne.

- Écrire d'abord chez le fournisseur, valider ensuite en base : un échec Stripe
  n'ajoute rien — c'est le critère. Mais si la validation locale échoue **après**
  un succès Stripe, le fournisseur compte un siège qui n'existe pas : le client
  est **surfacturé**.
- Écrire d'abord en base, synchroniser ensuite : un échec Stripe laisse un membre
  ajouté et non facturé — nous perdons du revenu. Le client n'est jamais lésé.
  Mais cela **contredit frontalement le critère 6**, qui exige que le membre ne
  soit pas ajouté.

Aucun ordre n'élimine le résidu ; les deux le déplacent. La question est donc :
lequel, et qui le paie.

## Decision

L'ordre suit le critère : **la quantité est écrite chez le fournisseur avant que
l'ajout du membre soit validé localement**, dans cette séquence exacte —

1. ouvrir la transaction et y insérer l'adhésion, sans valider ;
2. appeler le port de paiement, avec une clé d'idempotence dérivée de
   l'organisation et de la quantité visée, jamais d'un compteur ;
3. échec du port → **annuler** la transaction : aucun membre ajouté, critère 6
   tenu, et l'appel est rejouable parce que la clé d'idempotence converge ;
4. succès → valider la transaction.

Le résidu — validation locale en échec après un succès fournisseur — est **assumé
et borné** : il surfacture au plus un siège, il est détecté par
`pnpm billing:reconcile` (critère 7), et la correction est une écriture vers le
fournisseur, jamais un effacement local.

La clé d'idempotence porte la **quantité visée**, pas un incrément. Un rejeu
converge donc vers le même état au lieu de compter deux fois — c'est ce qui rend
l'opération « rejouable » au sens de `docs/reliability.md` §1.

## Considered options

- **Écrire en base d'abord, synchroniser ensuite** — rejeté : contredit le
  critère 6 mot pour mot. C'est pourtant l'ordre dont le résidu est le plus
  acceptable moralement (nous perdons du revenu plutôt que le client n'en perde).
  S'il fallait un jour revenir dessus, ce serait par un ADR successeur **et** une
  réécriture du critère, pas par une dérive d'implémentation.
- **Tenir l'appel réseau à l'intérieur de la transaction de base** — c'est ce que
  fait la décision, et c'est son seul coût réel : une transaction reste ouverte
  le temps d'un aller-retour HTTP. Accepté parce que l'appel porte un délai
  d'expiration explicite (`docs/reliability.md` §3) et que l'alternative — un
  état intermédiaire visible par une autre requête — serait pire.
- **Une file d'attente : ajouter le membre, publier un événement, synchroniser
  plus tard** — rejeté : la synchronisation différée rend le critère 3 (« la
  quantité est toujours égale au nombre de membres après toute opération »)
  faux entre l'ajout et le traitement. Et les notifications temps réel comme
  l'usage sont au cimetière du PRD ; introduire un bus ici l'entrouvrirait.
- **Ne rien synchroniser et tout laisser à la réconciliation** — rejeté : la
  facture serait juste une fois par jour et fausse le reste du temps, et le
  critère 2 demande l'effet à l'ajout.

## Consequences

- Le résidu de surfacturation existe. Il doit être **écrit dans le code**, à
  l'endroit où la transaction est validée, et non seulement dans cet ADR : le
  prochain agent qui lit la séquence doit savoir pourquoi elle est dans cet
  ordre.
- `pnpm billing:reconcile` cesse d'être un confort et devient **le filet de cette
  décision**. Sa panne n'est plus bénigne.
- La réconciliation écrit désormais **vers** le fournisseur pour la quantité,
  alors que la doctrine de l'ADR 034 fait du local un cache du fournisseur. Le
  sens de vérité dépend donc du champ : le statut vient du fournisseur, la
  quantité va vers lui. C'est explicite, et c'est le genre de subtilité qu'un
  agent inverse s'il n'est pas prévenu.
- Ce que cet ADR ne tranche pas : le **proratage** appliqué par le fournisseur
  quand la quantité change en cours de période. C'est un choix de facturation,
  pas d'architecture.
