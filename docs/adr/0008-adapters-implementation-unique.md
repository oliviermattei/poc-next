# ADR 008 — Une seule implémentation par port

- Status: accepted
- Date: 2026-08-30

Changer de fournisseur ne doit jamais toucher au domaine, mais livrer plusieurs fournisseurs par capacité double les webhooks et les tests à maintenir pour un bénéfice de grille comparative. Chaque dépendance externe est donc un port (`packages/ports`) avec une seule implémentation livrée et testée (`packages/adapters`) : Resend (mail), S3 / R2 (stockage), Stripe (paiement), Inngest (tâches), Sentry (erreurs), PostHog (analytics), PostgreSQL (limitation de débit, ADR 050). Ajouter un fournisseur revient à écrire une implémentation, sans modifier le domaine.

## Considered options

- Plusieurs implémentations par port — rejeté, pour la raison ci-dessus.
- Aucun port, appels directs aux SDK — rejeté : changer de fournisseur devient un refactor traversant, et la logique métier n'est plus testable sans réseau.
- Redis comme magasin de limitation de débit — rejeté : imposerait un service de plus à tout projet, alors que la base est déjà là.

## Consequences

- Les doublures de test (enregistrements en CI, capture locale des emails) sont des outils, pas des fournisseurs : elles ne justifient jamais un adapter SMTP ou MinIO, qui restent au graveyard.
- Chaque port doit fonctionner en local sans clé de fournisseur (`docs/reliability.md` §2) ; le magasin de limitation de débit, n'ayant pas de clé, refuse au lieu de dégrader (ADR 050).
