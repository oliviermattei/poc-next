# ADR 014 — Un socle de fiabilité s'applique à chaque changement

- Status: accepted
- Date: 2026-08-30

Un dépôt prêt pour la production doit survivre à un webhook rejoué, à un service tiers indisponible, à une migration jouée pendant qu'une ancienne version sert encore du trafic, à une tâche qui échoue au milieu. Traités au cas par cas, ces sujets produisent une politique de reprise par module, ou aucune. Ils sont donc décrits dans `docs/reliability.md` — idempotence, dégradation, délais et reprises, migrations et compatibilité, observabilité — avec le même statut que le socle de sécurité (ADR 012) : chaque contrôle nomme le test qui échoue s'il est violé, et un manquement bloque la fusion.

Deux principes structurent le reste : toute opération déclenchée par l'extérieur (webhook, tâche, import, reprise manuelle) est rejouable sans effet supplémentaire ; l'indisponibilité d'un service tiers dégrade, elle ne casse pas, sauf si la fonction n'a aucun sens sans lui.

## Considered options

- Se reposer sur les garanties des fournisseurs (Stripe rejoue, Inngest réessaie) — rejeté : ces garanties sont la raison d'être idempotent, pas un substitut. Stripe rejoue précisément parce que le destinataire doit absorber un doublon.

## Consequences

- L'idempotence a un coût (clé stockée, contrainte d'unicité, vérification avant effet de bord) qui paraîtra disproportionné sur un CRUD trivial.
- « Idempotent » se prouve par un test — exécuter deux fois, constater un seul effet —, jamais par un commentaire.
