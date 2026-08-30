# ADR 008 — Adapters à implémentation unique, providers par défaut

- Status: accepted
- Date: 2026-08-30
- Scope: framing

## Context
Le PRD reproche aux cibles leur bloat : Supastarter livre cinq providers de paiement et huit d'analytics, dont l'immense majorité ne sert jamais et doit pourtant être maintenue. Il impose en contrepartie que changer de provider n'oblige jamais à toucher au domaine.

## Decision
Chaque dépendance externe est un **port** défini dans `application`, avec **une seule implémentation livrée et testée**. Ajouter un provider revient à écrire une classe, sans modifier le domaine.

Bundle par défaut : Resend (mail), S3 / Cloudflare R2 (storage), Stripe (paiement), Inngest (jobs), Sentry (erreurs), PostHog (analytics), PostgreSQL (limitation de débit).

Le magasin de la limitation de débit est PostgreSQL par défaut — la base est déjà là, et cela évite un septième service tiers. Une implémentation Redis est documentée pour les déploiements à forte charge.

Les doublures de test (enregistrement en CI, capture locale des emails) sont des outils de test, pas des providers : elles ne rendent pas légitime l'ajout d'un adapter SMTP ou MinIO, qui restent au cimetière.

## Considered options
- Plusieurs implémentations par port (choix Supastarter) — rejeté : double la surface de webhooks et de tests pour un bénéfice de grille comparative, pas d'usage.
- Aucun port, appels directs aux SDK (choix ShipFast) — rejeté : changer de provider devient un refactor traversant, et la logique métier n'est plus testable sans réseau.
- Redis comme magasin de limitation par défaut — rejeté : impose un service supplémentaire à tout projet généré, y compris ceux qui n'en ont pas besoin.

## Consequences
Facilité : sept dépendances externes, toutes isolées derrière un port et remplaçables en une classe.
Difficulté : le compteur de limitation en PostgreSQL demande une attention particulière aux verrous et à la purge des fenêtres expirées.
À surveiller : la dépendance à sept services tiers reste assumée mais réelle. Chaque port doit fonctionner en développement local sans clé d'API.
