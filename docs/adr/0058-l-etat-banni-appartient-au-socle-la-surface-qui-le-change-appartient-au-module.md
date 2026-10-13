# ADR 058 — L'état « banni » appartient au socle ; la surface qui le change appartient au module

- Status: accepted — la raison donnée ici aux routes `authenticated` du back-office est remplacée par celle de l'ADR 068
- Date: 2026-09-05

Un compte banni ne doit plus pouvoir se connecter, et un module `admin` coupé ne doit exposer ni route ni rôle de superadmin. Si le bannissement appartenait au module `admin`, le chemin de connexion — du socle — devrait consulter un module qui peut être absent. « Banni » n'est pas une fonctionnalité d'administration mais un **état du compte** : `auth` possède les comptes et la décision de laisser entrer, le module `admin` ne possède que la **surface** qui change cet état.

`auth` porte `banned`, `banned_at` et `banned_reason` sur `auth_user`, refuse la création de session d'un compte banni au seul point que tous les parcours traversent (`databaseHooks.session.create.before`), et révoque les sessions en cours à la pose de la marque. Le module `admin` porte le rôle de plateforme (`admin_platform_role`), sa désignation, la promotion, la révocation, le bannissement et le débannissement ; il déclare `requires: ['auth']` (ADR 018) et écrit l'état banni par un port injecté, `AdminAccountsPort`, jamais dans les tables du socle. Module coupé, plus personne ne peut bannir, mais un compte déjà banni reste banni : un module désactivé garde ses données.

Le refus de connexion d'un compte banni est celui d'un identifiant invalide (`genericSignInRefusal`) : « vous êtes banni » serait un oracle d'énumération. Le premier superadmin est désigné par `SUPERADMIN_EMAIL`, une adresse et non un identifiant, parce qu'aucun compte n'existe sur une base vierge ; elle désigne sans authentifier, et ne prend effet que tant qu'aucun superadmin n'existe. Son absence avertit au démarrage sans le refuser : une plateforme sans superadmin doit pouvoir démarrer.

## Considered options

- **Le plugin `admin` de Better Auth** — rejeté : il ajoute ses colonnes et un champ `role` à `auth_user`, cède la maîtrise du schéma sur l'élévation de privilège, nomme la sanction au refus de connexion, et sa garde laisse passer une création de session sans contexte d'endpoint (échec ouvert). Même raisonnement que pour le plugin `organization` (ADR 025).
- **Le champ `banned` dans le module `admin`, consulté depuis `auth`** — rejeté : un prédicat optionnel dont l'absence signifie « personne n'est banni » est un défaut ouvert qu'aucune commande ne verrait.
- **Une clé de contrat « garde de connexion »** — rejeté : un champ du socle couvre entièrement le besoin, et la clé n'aurait qu'un implémenteur.

## Consequences

- Tout futur parcours de connexion hérite du refus : la garde est au point de création de session. Un chemin qui ouvre une session hors de la bibliothèque doit la reposer (ADR 064).
- Le module `admin` ne lit les comptes que par `AdminAccountsPort`.
- Le dernier superadmin ne peut être ni révoqué ni banni : les deux gestes consultent la même règle sous le même verrou consultatif, et comptent les superadmins capables de se connecter. Bannir un pair qui n'est pas le dernier reste permis. Le chemin encore ouvert — la suppression de compte du dernier superadmin, dont le rôle part par cascade — est tenu dans `packages/modules/admin/AGENTS.md`.
- Un anonyme reçoit encore 401 sur `/api/modules/admin/*` (issue #81), et la lecture de l'état banni n'est pas faite dans la transaction de la bibliothèque (issue #92).
