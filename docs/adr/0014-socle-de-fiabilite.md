# ADR 014 — Socle de fiabilité

- Status: accepted
- Date: 2026-08-30
- Scope: framing

## Context
L'ADR 012 impose un socle de sécurité. La fiabilité pose le même problème et n'était couverte nulle part : un boilerplate production grade doit survivre à un webhook rejoué, à un service tiers indisponible, à une migration jouée pendant qu'une ancienne version sert encore du trafic, à un job qui échoue au milieu.

Les stories traitent ces cas au coup par coup — idempotence des webhooks en s19, réconciliation des sièges en s23, repli synchrone des jobs en s33 — mais rien ne les relie ni ne les impose aux stories futures. Sans référentiel, chaque module réinventera sa politique de reprise, ou n'en aura aucune.

## Decision
Un **socle de fiabilité**, décrit dans `docs/reliability.md`, s'applique à toute story au même titre que le socle de sécurité. Il couvre cinq domaines : idempotence, dégradation, délais et reprises, migrations et compatibilité, observabilité opérationnelle.

Comme pour la sécurité, chaque contrôle nomme la commande ou le test qui échoue s'il est violé, et un manquement est un finding **critical** en revue.

Deux principes structurent le reste :
- **Toute opération déclenchée par l'extérieur est rejouable sans effet supplémentaire.** Webhooks, jobs, imports, reprises manuelles.
- **L'indisponibilité d'un service tiers dégrade, elle ne casse pas.** Aucun port ne doit rendre l'application inutilisable quand son implémentation est injoignable, sauf si la fonction n'a aucun sens sans lui.

## Considered options
- **Traiter la fiabilité story par story** — rejeté : c'est l'état actuel, et il produit des politiques divergentes. Le PRD applique déjà le raisonnement inverse à `purge`, `export` et `retention`.
- **Une story « robustesse » en fin de parcours** — rejeté pour la même raison que l'audit de sécurité tardif : on ne rétrofite pas l'idempotence dans quarante modules.
- **Se reposer sur les garanties des fournisseurs** (Stripe rejoue, Inngest réessaie) — rejeté : leurs garanties sont des raisons d'être idempotent, pas des substituts. Stripe rejoue précisément parce que le destinataire doit savoir absorber un doublon.

## Consequences
Facilité : une politique unique, opposable en revue ; les modules héritent d'un comportement au lieu de l'inventer.
Difficulté : l'idempotence a un coût — clé d'idempotence stockée, contrainte d'unicité, vérification avant effet de bord. Sur un CRUD trivial, cela paraîtra disproportionné.
À surveiller : la tentation de déclarer « idempotent » une opération qui ne l'est pas. Le socle exige une preuve par test — exécuter deux fois, constater un seul effet — pas une affirmation dans un commentaire.
