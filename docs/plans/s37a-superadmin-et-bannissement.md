---
story: s37a-superadmin-et-bannissement
validated: yes
---

# Plan — s37a-superadmin-et-bannissement

> Tranche 1 de 3 de `s37-admin-users`, découpée sur verdict de complexité **5**. Planifié contre `dev` au commit `b566d8b`. La recherche `docs/research/s37-admin-users.md` est datée de `4aba8c5` — **49 commits et 194 fichiers de code plus tôt** — et ses trois prémisses portantes ont été re-vérifiées ci-dessous avant usage.

## Re-vérification de la recherche

| Fait de la recherche | État au 05/09 |
|---|---|
| Le plugin `admin` de Better Auth n'est pas configuré | **tient** — les greffons présents sont `genericOAuth`, `magicLink`, `passkey`, `withTwoFactorOnEverySignIn` |
| Aucun champ `banned`, `impersonat*` ni `role` dans le schéma `auth` | **tient** — zéro occurrence |
| Onze modules, aucun proche | **dérivé** : douze aujourd'hui (`blog` livré par s29), toujours aucun proche |

## La décision structurelle — et elle dissout le point dur

La recherche identifie le point dur : « le bannissement appartiendrait au module `admin` ; la connexion appartient à `auth`, qui est du socle », et craint qu'`auth` doive consulter un module qui peut ne pas être là.

**Ce n'est pas nécessaire, parce que le découpage supposé est faux.** « Banni » n'est pas une fonctionnalité d'administration : c'est un **état du compte**, et `auth` possède déjà les comptes et la décision de laisser entrer. Ce qui appartient au module d'administration, c'est la **surface** qui change cet état, pas l'état lui-même.

D'où :

- **`auth` (socle)** porte le champ `banned` et refuse la connexion. Aucune dépendance vers un module optionnel, aucune condition écrite en dur, aucun motif de valeur vide à inventer.
- **Le module `admin`** porte le rôle superadmin, la désignation, la promotion, la révocation, le bannissement et le débannissement. Il déclare `requires: ['auth']`, donc il a le droit d'écrire ce champ (ADR 018).
- **Module coupé** : plus aucune route, plus aucun rôle de superadmin, et plus personne ne peut bannir — mais un compte déjà banni **reste banni**, ce qui est la règle du dépôt (« un module activé puis désactivé garde ses tables et ses données » ; le débannir serait un nettoyage, et le nettoyage est au cimetière).

Options rejetées, à écrire dans l'ADR : le plugin `admin` de Better Auth — le dépôt a déjà tranché contre pour la feature voisine (s15 n'a pas adopté le plugin `organization`, il en cite le fichier en référence de forme) et l'adopter ici céderait la maîtrise du schéma sur la seule story qui touche l'élévation de privilège ; le champ `banned` dans le module `admin` avec consultation depuis `auth` — inverse la dépendance et fait consulter au socle un module qui peut être absent ; une quinzième clé de contrat « garde de connexion » — s53 vient d'en ajouter une, et rouvrir les douze modules pour un besoin qu'un champ de socle couvre serait disproportionné.

## Tâches

- [x] **1. Le champ `banned` dans `auth`, et le refus à la connexion.** Migration additive (`banned` booléen défaut faux, `banned_at`, `banned_reason` nullable). Test d'abord : un compte banni ne peut plus se connecter, **et le message est celui d'un identifiant invalide** — `docs/security.md` exige qu'un compte inconnu et un mot de passe faux soient indistinguables ; révéler « vous êtes banni » à la connexion donne un oracle d'énumération. Le vrai motif est visible pour un superadmin, pas pour l'anonyme.
- [x] **2. Révocation des sessions au bannissement.** Bannir sans révoquer laisse la session en cours vivante jusqu'à expiration : le refus ne mordrait qu'à la prochaine connexion. Test : une session active devient invalide, mesurée sur une requête réelle et non sur l'appel de révocation.
- [x] **3. Le module `admin`, échafaudé par `npx ks`.** Jamais à la main. **Quinze clés**, `publicUrls` comprise (s53, ADR 054) — un back-office est privé, donc liste vide, et c'est une décision consignée. `requires: ['auth']`. Schéma : le rôle de plateforme, rien de plus à cette tranche.
- [x] **4. Désignation du premier superadmin, depuis une base vierge.** Par variable d'environnement, validée par Zod comme tout le reste, **jamais lue via `process.env` hors du module de configuration**. Test partant d'une base vierge, comme le critère l'exige. Décision à prendre et à écrire : adresse ou identifiant — la recherche laisse la question ouverte ; l'adresse est lisible dans un `.env` et c'est ce que la procédure documentée doit rester.
- [x] **5. Promotion, révocation, et le garde-fou du dernier.** Le dernier superadmin ne peut pas se révoquer. Test **et mutation** : retirer le garde-fou doit rougir — sans lui, la plateforme devient définitivement inadministrable en un clic, et aucune commande ne la répare.
- [x] **6. Aucun superadmin configuré : 404 et avertissement au démarrage.** 404, jamais 403 (`docs/security.md` §3) : un 403 confirme que le back-office existe. L'avertissement **nomme la variable**. Noter que le critère demande un avertissement et non un refus, contrairement au reste du dépôt qui refuse au démarrage — c'est délibéré ici, puisqu'une plateforme sans superadmin doit pouvoir démarrer pour qu'on puisse en désigner un.
- [x] **7. Les routes d'administration, réservées.** Chaque route déclare son niveau de protection dans le contrat. Un non-superadmin reçoit **404**. Zod sur les paramètres et le corps. Mutation : rendre 403 au lieu de 404 doit rougir.
- [x] **8. Module coupé — les garanties, et le plancher.** Aucune route, aucun rôle, et les modules qui le requièrent ne peuvent pas être activés (validation de s03). `pnpm test:minimal-profile` dérive déjà les trois premières du contrat ; vérifier qu'il **balaie effectivement** ce module plutôt que de le supposer.
- [x] **9. ADR — l'état « banni » appartient au socle, la surface qui le change appartient au module.** Avec les quatre options rejetées ci-dessus et la mesure qui tue chacune.

## Ce que la story ne fait pas

Le back-office (listes, détails, impersonation) : c'est `s37b`. Les inscriptions publiques : `s37c`. La réinitialisation de mot de passe déclenchée par un administrateur et la révocation de session à l'unité appartiennent aussi à `s37b`.

## Sections de `docs/security.md` touchées

§3 (404 plutôt que 403) · indistinguabilité compte inconnu / mot de passe faux · rotation et révocation de session · Zod à chaque frontière · pas de `process.env` direct · permissions vérifiées côté serveur.
