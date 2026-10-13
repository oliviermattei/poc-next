# ADR 050 — La limitation de débit est un port ; son magasin absent refuse

- Status: accepted — la clause « la double authentification a un seau par défi, lu par nom exact » est supersédée par l'ADR 051
- Date: 2026-09-03

Deux compteurs écrits deux fois existaient (`public_form_throttle` pour les formulaires publics, `billing_checkout_throttle` pour le paiement invité) : deux implémentations d'une règle de sécurité divergent au premier seuil ajusté. **La limitation de débit devient un port** (`packages/ports/src/rate-limit.ts`), avec une seule implémentation, PostgreSQL, dont la table `rate_limit_window` appartient au module `rate-limit`, du socle non désactivable (`requiredModules`) : le contrat de module est le seul mécanisme du dépôt qui donne à une table un propriétaire et une migration.

**Le refus vit au répartiteur, dérivé du registre.** `dispatchModuleRequest` appelle un garde injecté (`DispatchOptions.rateLimit`) sur toute route où `routeIsRateLimited` est vrai : toute route publique, déclarée ou non, plus toute route qui déclare un `rateLimit`. Une route publique ajoutée est limitée sans que personne y pense. Le répartiteur est fail-closed : sans garde branché, toute route limitée répond 429. La neutralisation n'existe que par injection dans un test (`tests/fixtures/rate-limit.ts`), jamais par une variable d'environnement : une variable qui éteint une protection est une porte, et ce dépôt l'a vérifié avec `SKIP_ENV_VALIDATION`.

**Un magasin indisponible refuse.** C'est une exception assumée au socle de fiabilité (« un tiers absent dégrade ») : le magasin n'est pas un tiers mais la base de l'application, où vivent aussi les sessions. Sa panne coupe déjà la connexion ; laisser passer n'ajouterait qu'une fenêtre sans protection au pire moment.

## Considered options

- **Un seuil par IP seule** — rejeté : `x-forwarded-for` est écrit par l'appelant. La double limitation, par appelant et par compte visé (`maxPerSubject`), est le cœur de la décision, et le seau par compte est le seul qui ne dépende de rien que l'attaquant contrôle.
- **Ne compter que les adresses qui correspondent à un compte** — rejeté : ce serait un oracle d'énumération.
- **Supprimer les deux anciennes tables tout de suite** — rejeté : la version encore en ligne pendant la bascule les écrit toujours (`docs/reliability.md` : cesser d'écrire avant de supprimer).
- **Un seuil nul signifiant « aucune limite »** — rejeté : ce serait la variable de désactivation déguisée ; un seuil nul ou négatif fait échouer le démarrage.
- **Un compteur en mémoire de processus** — rejeté : il se contourne en scalant horizontalement.

## Consequences

- Toute suite qui sert une route publique injecte un garde permissif : c'est le prix du fail-closed.
- `sweep` reçoit l'instant présent et efface les lignes dont `expires_at` est passé, jamais une borne choisie par l'appelant, qui effacerait les seaux encore ouverts des autres routes. Le garde balaie lui-même, et le module déclare une tâche planifiée pour une application au repos.
- Le seau par compte est aussi une arme : saturer le compte de quelqu'un l'empêche de se connecter pendant la fenêtre. Les seuils vivent dans `config/security.ts` ; les seuils par appelant sont larges, parce qu'une installation sans proxy voit toutes ses requêtes venir d'une seule adresse. L'identification de l'appelant par le premier maillon de `x-forwarded-for` reste à durcir (issue #78).
- La table ne contient que des condensats SHA-256 non salés : ce n'est pas une pseudonymisation forte. Le journal, lui, porte l'IP et la route.
- `public_form_throttle` et `billing_checkout_throttle` ne sont plus écrites, mais restent déclarées ; `tests/rate-limiting.test.ts` refuse qu'on les écrive de nouveau. Leur suppression : issue #105.
- Le captcha est déclaré coupé et encadré par le démarrage, sans fournisseur branché (issue #151).
