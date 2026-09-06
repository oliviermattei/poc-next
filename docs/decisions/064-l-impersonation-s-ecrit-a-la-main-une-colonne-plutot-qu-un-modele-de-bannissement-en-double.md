# ADR 064 — L'impersonation s'écrit à la main : une colonne, plutôt qu'un modèle de bannissement en double

- Status: accepted
- Date: 2026-09-06
- Scope: story s37b1-decompte-et-impersonation

## Context

La story demande qu'un superadmin puisse **emprunter la session** d'un compte
pour l'assister, avec un début et une fin journalisés, et le refus d'emprunter
un pair. Better Auth fournit exactement cette capacité dans son greffon `admin`
(`dist/plugins/admin/routes.mjs`, version 1.7.2 installée) : `impersonateUser`
et `stopImpersonating`.

L'ADR 058 a déjà **écarté ce greffon** pour le rôle de plateforme et le
bannissement, dans la continuité de l'ADR 025 (greffon `organization`, s15). Mais
un rejet passé n'est pas un argument : l'impersonation est une autre
fonctionnalité, et la recherche de `s37b` l'a explicitement rouverte plutôt que
d'étendre mécaniquement la décision précédente.

Trois faits mesurés sur le paquet installé et sur ce dépôt bornent la décision :

1. **le greffon déclare quatre champs, pas un.** `dist/plugins/admin/schema.mjs`
   ajoute `banned`, `banReason` et `banExpires` sur `auth_user`, plus
   `impersonatedBy` sur `auth_session` (et un champ `role`) ;
2. **`s37a` a déjà livré trois de ces colonnes à la main**, sous d'autres noms :
   `banned`, `banned_at`, `banned_reason` — et le refus de connexion qui va avec
   (`domain/ban.ts`, `refusesSignIn`), plus le garde-fou du dernier superadmin
   qui les lit. Adopter le greffon signifierait **deux modèles de bannissement**
   dans la même table, ou une réécriture de `s37a` pour épouser le sien ;
3. **la capacité manquante tient en une colonne** : `auth_session.
   impersonated_by`. Tout le reste — qui a le droit d'emprunter, qui ne peut pas
   être emprunté, ce qui est journalisé — est une règle de **ce** produit, que le
   greffon décide autrement (il raisonne en `role`/`adminRoles` textuels sur
   `auth_user`, là où ce dépôt a une table de rôle de plateforme).

## Decision

**L'impersonation est écrite à la main, autour d'une seule colonne
(`auth_session.impersonated_by`), et le greffon `admin` de Better Auth reste
non monté.**

Le partage suit l'ADR 058 sans exception : l'**état** vit dans le socle — une
session appartient à `auth` —, la **surface** qui l'ouvre et la ferme vit dans le
module `admin`, qui peut être coupé. Trois conséquences en découlent, et elles
sont dans le code :

- le module `admin` n'écrit ni ne lit `auth_session` : il passe par
  `AdminAccountsPort`, qui rend un en-tête `Set-Cookie` déjà formé ;
- la **rotation de session** (`docs/security.md` §2) est faite aux deux bouts :
  l'entrée remplace la session de l'appelant, la sortie remplace la session
  empruntée. Aucun jeton n'est mis de côté entre les deux — le greffon, lui,
  range celui de l'administrateur dans un second cookie signé `admin_session` ;
- une session **empruntée n'administre jamais**, quel que soit le rôle du compte
  emprunté. C'est la garde du back-office qui le tient, et elle est plus large
  que le refus d'enchaînement que la story demandait.

**Ce que cette décision coûte, écrit plutôt que découvert** : la **signature du
cookie de session** est reproduite dans `infrastructure/session-cookie.ts`
(HMAC-SHA256, base64, `encodeURIComponent`), parce que `setSessionCookie` de la
bibliothèque exige un contexte de point d'entrée et qu'aucun point d'entrée
n'ouvre une session au nom d'un autre compte. Le **nom** et les **attributs** du
cookie, eux, ne sont pas reproduits : ils viennent de `auth.$context`. Le jour où
`better-call` change de forme, `tests/admin.test.ts` rougit — un cas y renvoie le
cookie obtenu au résolveur de session de la bibliothèque et exige qu'il désigne
le compte emprunté.

## Considered options

- **Monter le greffon `admin` de Better Auth** — rejeté : il apporte un second
  modèle de bannissement (`banned`, `banReason`, `banExpires`) là où `s37a` a
  déjà livré le sien, et un modèle de rôle textuel là où ce dépôt a une table.
  On paierait la cohabitation de deux vérités sur « ce compte est-il banni » pour
  obtenir une colonne. Ses règles d'autorisation
  (`adminRoles`, `allowImpersonatingAdmins`) ne connaissent pas
  `admin_platform_role` : le refus d'emprunter un superadmin serait à réécrire de
  toute façon.
- **Une table `admin_impersonation` dans le module `admin`** — rejeté pour la
  raison de l'ADR 058 : le chemin qui **résout** une session appartient au socle,
  et il ne peut pas consulter un module qui peut être coupé. La question « cette
  session est-elle empruntée ? » se pose à chaque requête du back-office ; y
  répondre depuis une table optionnelle ferait dépendre une garde de sécurité de
  la configuration.
- **Router la création par `internalAdapter.createSession` de la bibliothèque**,
  pour hériter de son crochet — rejeté : le modèle `session` de la bibliothèque
  ne déclare pas `impersonatedBy`, donc la colonne serait écartée à l'écriture,
  et il faudrait la reposer par un `update` juste après — une session existant un
  instant **sans sa marque d'emprunt**. La garde a été reposée dans l'`insert`,
  où elle est atomique.
- **Ne pas faire tourner la session** (marquer la session en cours comme
  empruntée) — rejeté : `docs/security.md` §2 impose la rotation à toute
  élévation de privilège, et une session dont le pouvoir change sans que son
  identifiant change est exactement ce que la règle interdit. C'est aussi ce qui
  rend la sortie propre : la session empruntée **meurt**, elle ne redevient pas
  celle de l'administrateur.
- **Conserver la session de l'administrateur dans un second cookie**, comme le
  greffon — rejeté : c'est un jeton de session vivant, stocké côté navigateur en
  plus du premier, pour économiser une ouverture de session à la sortie. Une
  session neuve pour l'emprunteur donne le même confort sans second porteur de
  privilège.

## Consequences

**Ce qui devient plus facile.** L'emprunt tient dans une colonne, un cas d'usage
et deux routes ; il se lit sans connaître un greffon. Le refus d'emprunter un
superadmin est écrit là où vit le rôle de plateforme, dans le même vocabulaire
que les autres refus du module. Le journal nomme les deux comptes aux deux bouts.

**Ce qui devient plus difficile, et la revue l'a mesuré plutôt que prédit.** Le
dépôt porte désormais **le seul endroit qui ouvre une session sans passer par la
bibliothèque**, et ouvrir une session hors de ses chemins fait perdre **tout ce
que ses chemins tiennent**. Deux choses ont été perdues à la première rédaction,
et rendues :

- **la garde du compte banni** vit dans `databaseHooks.session.create.before`,
  que seule la bibliothèque traverse. Trois constats critiques en découlaient,
  dont un retour de bannissement en libre-service. La garde est désormais **dans
  l'`insert`** de ce chemin, et `tests/lint-rules.test.ts` refuse un second
  écrivain de `auth_session` ;
- **l'échéance** : `shouldBeUpdated` est toujours vrai pour une ligne plus courte
  que `session.expiresIn`, donc la première lecture portait l'heure d'un emprunt
  à sept jours. Une enveloppe d'adapter refuse le renouvellement d'une ligne
  empruntée (`session-refresh-adapter.ts`), et l'échéance est de nouveau celle
  qu'annonce la politique.

La règle générale que ces deux-là écrivent : **ce qu'on gagne à écrire une
session à la main, on le paie en gardes à reposer une par une** — et chacune doit
être tenue par une commande, faute de quoi elle n'est qu'une intention. Le
troisième fait d'infrastructure reproduit, la signature du cookie, reste tenu par
un cas de `tests/admin.test.ts` qui la présente au résolveur de la bibliothèque.

**Ce que cette décision ne change pas, et qui vaut d'être écrit** : un emprunt
**passe outre le second facteur** du compte emprunté, quelle que soit
l'implémentation — le greffon de la bibliothèque n'en pose pas davantage. La
session est ouverte au nom de quelqu'un qui n'est pas là pour répondre à un défi.
Cela déplace la valeur du second facteur : le rôle de superadmin vaut celui de
tous les comptes du produit, et c'est le rôle qu'il faut protéger. Ce fait est
noté ici et dans les deux `AGENTS.md` du chemin ; s'il doit devenir une ligne de
`docs/security.md`, c'est une décision de cadrage, pas de story.

**Ce qu'il faut surveiller.** Une session empruntée abandonnée n'émet jamais sa
fin : c'est la tâche `admin.impersonation-expiry` qui compte l'expiration comme
une fin — et un emprunt échu **présenté** à la bibliothèque avant le balayage est
effacé par elle, sa fin n'étant alors journalisée par personne. Si cette tâche disparaît — module coupé, ordonnanceur non monté —, le
journal n'a plus que des débuts. Le module coupé, une impersonation en cours ne
peut plus être rendue à la main : elle expire, et **rien ne l'annonce**. C'est le
prix assumé d'une surface optionnelle sur un état du socle, et c'est le même que
celui de l'ADR 058 pour le bannissement.
