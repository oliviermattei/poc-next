# ADR 064 — L'impersonation s'écrit à la main : une colonne, plutôt qu'un modèle de bannissement en double

- Status: accepted
- Date: 2026-09-06

Un superadmin peut emprunter la session d'un compte pour l'assister, avec un début et une fin journalisés, sans pouvoir emprunter un pair. Le greffon `admin` de Better Auth fournit `impersonateUser` et `stopImpersonating`, mais il déclare aussi `banned`, `banReason`, `banExpires` et un `role` textuel sur `auth_user` — alors que le dépôt a déjà son propre état banni (ADR 058) et une table de rôle de plateforme. Ce qui manque tient en une colonne.

**L'impersonation est écrite à la main autour de `auth_session.impersonated_by`, et le greffon reste non monté.** Le partage suit l'ADR 058 : l'état vit dans le socle (une session appartient à `auth`), la surface qui l'ouvre et la ferme vit dans le module `admin`, qui passe par `AdminAccountsPort` et reçoit un en-tête `Set-Cookie` déjà formé. La session tourne aux deux bouts (`docs/security.md`) : l'entrée remplace la session de l'appelant, la sortie remplace la session empruntée, et aucun jeton n'est mis de côté. Une session empruntée n'administre jamais, quel que soit le rôle du compte emprunté (`asSuperadmin`, ADR 068).

La signature du cookie de session est reproduite dans `packages/modules/auth/src/infrastructure/session-cookie.ts`, parce que `setSessionCookie` exige un contexte de point d'entrée et qu'aucun point d'entrée de la bibliothèque n'ouvre une session au nom d'un autre ; le nom et les attributs du cookie viennent de `auth.$context`. `tests/admin.test.ts` présente le cookie obtenu au résolveur de session de la bibliothèque et exige qu'il désigne le compte emprunté.

## Considered options

- **Monter le greffon `admin`** — rejeté : deux vérités sur « ce compte est-il banni », un rôle textuel à côté d'une table, et des règles d'autorisation qui ne connaissent pas `admin_platform_role`.
- **Une table `admin_impersonation` dans le module** — rejeté : la question « cette session est-elle empruntée ? » se pose à chaque requête, et une garde de sécurité ne peut pas dépendre d'une table optionnelle.
- **Créer la session par `internalAdapter.createSession`** — rejeté : le modèle de la bibliothèque ne déclare pas `impersonatedBy`, et la session existerait un instant sans sa marque.
- **Garder la session de l'administrateur dans un second cookie**, comme le greffon — rejeté : un second porteur de privilège vivant dans le navigateur, pour économiser une ouverture de session.

## Consequences

- Ce dépôt a le seul chemin qui ouvre une session hors de la bibliothèque, et chaque garde de ses chemins doit y être reposée. Le refus du compte banni est dans l'`insert` de ce chemin, et `tests/lint-rules.test.ts` refuse un second écrivain de `auth_session`. Une enveloppe d'adapter (`session-refresh-adapter.ts`) refuse le renouvellement d'une session empruntée, que la bibliothèque aurait sinon prolongée à la durée normale ; le chemin transactionnel reste à vérifier (issue #139).
- Un emprunt passe outre le second facteur du compte emprunté : le rôle de superadmin vaut celui de tous les comptes du produit, et c'est lui qu'il faut protéger.
- Une session empruntée abandonnée n'émet pas sa fin : la tâche `impersonation-expiry` du module compte l'expiration comme une fin. Sans elle — module coupé, ordonnanceur absent —, le journal n'a que des débuts, et un emprunt en cours ne peut plus être rendu à la main : il expire sans annonce.
