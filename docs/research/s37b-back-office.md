# Research — Story s37b-back-office

> Vérifiée contre `dev` au commit `8d8539a`, en lecture seule. Aucune base, aucun conteneur, aucun worktree.

## Les cinq faits structurants

1. **Le correctif du décompte ne peut pas être une jointure, et la raison est écrite.** `readFacts` (`drizzle-platform-role-repository.ts:88`) calcule `superadminCount` en comptant des **lignes de rôle**, et sert les **deux** gardes (révocation ligne 211, bannissement ligne 237). Joindre `auth_user.banned` serait le correctif évident — `admin` déclare `requires: ['auth']` et porte déjà la clé étrangère. **Mais `schema.ts:23` pose une borne délibérée** : « Ce module est le seul fichier qui importe `@repo/module-auth`, et uniquement pour cette clé : c'est la borne qui garde les lectures de comptes derrière le port injecté, donc derrière un identifiant plutôt qu'une adresse (`docs/security.md` §7). » Vérifié : c'est vrai **dans ce module** (`organizations` l'importe dans trois fichiers, mais c'est un autre module). Le correctif est donc **l'élargissement d'`AdminAccountsPort`**, comme la revue de `s37a` l'avait dit — et non la jointure, qui franchirait une borne motivée par la sécurité.

2. **Trois surfaces partagent l'aveuglement, pas deux.** Le critère l'énonce déjà — révocation, garde-fou de bannissement, promotion. `grantSuperadmin` ne prend d'ailleurs **pas** le verrou consultatif que les deux autres prennent : promouvoir un compte banni gonfle le décompte d'un administrateur inutilisable, et le fait hors sérialisation. Les deux séquences mesurées en revue de `s37a` restent atteignables tant que les trois ne partagent pas le même décompte.

3. **Le module n'a aucun écran.** `s37a` a livré le rôle, le bannissement et le refus à la connexion **sans interface** : `adminNavigation` est vide, et `createAdminRoutes` ne sert que des appels. Tout le back-office — listes, détails, recherche, pagination — est neuf. C'est ce qui fait le poids de cette tranche, pas le décompte.

4. **Le greffon `admin` de Better Auth est installé et fournit l'impersonation** (`node_modules/.pnpm/better-auth@*/…/dist/plugins/admin/`). L'ADR 058 l'a **rejeté**, mesure à l'appui, pour le rôle et le bannissement — le dépôt ayant déjà tranché contre le greffon `organization` en `s15` pour la même raison. **L'impersonation est une autre fonctionnalité, et le raisonnement de l'ADR ne s'y étend pas mécaniquement.** À trancher, avec un ADR : reprendre le greffon pour cette seule capacité, ou l'écrire à la main.

5. **L'impersonation est une élévation de privilège, et le dépôt a déjà le patron.** `s37a` a établi la forme du refus qui survit à la coupure du module, et `docs/security.md` impose la rotation de session à toute élévation. Les critères ajoutent la journalisation **aux deux bouts** et le refus d'impersonner un pair. Le bandeau permanent est le seul élément purement visuel.

## Target story

Neuf critères. Liste des utilisateurs avec recherche et pagination, 404 pour un non-superadmin · détail avec organisations, droits et sessions · révocation de session et réinitialisation · impersonation avec bandeau et sortie · refus d'impersonner un superadmin · journalisation aux deux bouts · liste des organisations quand le module est activé, entrée disparue sinon · détail d'organisation avec membres, offre et abonnement · **tout décompte de superadmins compte ceux capables de se connecter**.

Dépendances déclarées : `s37a` (fusionnée), `s21` (fusionnée).

## Points d'ancrage

- `packages/modules/admin/src/infrastructure/drizzle-platform-role-repository.ts:88,211,237` — `readFacts` et ses deux appelants.
- `packages/modules/admin/src/application/ports.ts` — `AdminAccountsPort`, à élargir.
- `packages/modules/admin/src/schema.ts:23` — la borne d'import, et sa raison.
- `packages/modules/organizations/src/infrastructure/scoped-reads.ts` — le précédent d'une lecture inter-modules **assumée**, à comparer.
- `docs/decisions/058-*.md` — le rejet du greffon `admin`, à relire avant de trancher le fait 4.

## Pièges & contraintes

- **Le décompte est une dette de sécurité reportée, pas une amélioration.** Deux séquences de gestes *tous permis* laissent la plateforme sans administrateur capable de se connecter, et **aucune commande ne la répare** : il faut un `UPDATE` à la main en production. Les deux ont été mesurées contre PostgreSQL en revue de `s37a`.
- **Un décompte corrigé à deux endroits sur trois ne corrige rien.** Le critère dit « tout décompte » précisément parce que sa première rédaction — la mienne — n'imputait l'aveuglement qu'à la révocation, et aurait laissé le chemin ouvert.
- **L'impersonation ne doit pas pouvoir être ouverte sur un superadmin**, ni **enchaînée** (impersonner, puis impersonner depuis la session empruntée). Le second cas n'est pas dans les critères et mérite d'y être.
- **La journalisation aux deux bouts implique une fin détectable.** Une session d'impersonation qui expire sans sortie explicite n'émet jamais son second événement : décider si l'expiration compte comme une fin.
- **404 et non 403** pour un non-superadmin, comme `s37a` l'a établi — le répartiteur répondant 403 à une protection `role` non satisfaite, la garde vit dans le module.

## Questions ouvertes

- ~~**Reprendre le greffon `admin` pour la seule impersonation, ou l'écrire ?**~~ **Tranchée le 06/09, par la mesure.** Le greffon déclare `banned`, `banReason`, `banExpires` et `impersonatedBy` (vérifié dans le paquet installé). Or `s37a` a **déjà livré** `banned`, `bannedAt` et `bannedReason` à la main. L'adopter signifierait accepter un modèle de bannissement en double — ou se battre contre le greffon — pour une capacité dont **une seule colonne** est nécessaire, `impersonatedBy`. **Écrire l'impersonation à la main**, dans la continuité de l'ADR 058 et du précédent de `s15`. L'ADR de cette story consignera la mesure plutôt que le précédent seul.
- **Une session d'impersonation expirée est-elle une fin ?** Le critère demande un événement aux deux bouts.
- **Le bandeau survit-il à une navigation complète ?** « Permanent » ne dit pas s'il tient à travers un rechargement, une autre organisation, une déconnexion partielle.
- **Que voit un superadmin banni ?** `s37a` refuse sa connexion ; le back-office n'existe donc pas pour lui — à confirmer plutôt qu'à supposer.

## Complexité réelle

Notée **3** dans `docs/stories.md`. **Ma note : 4.**

Neuf critères, un back-office entier à créer (listes, recherche, pagination, deux niveaux de détail), une élévation de privilège avec rotation de session et journalisation aux deux bouts, une décision d'architecture à trancher avec ADR, et **une dette de sécurité mesurée** qui touche trois surfaces. La note de 3 date d'avant la découpe, quand `s37` entière était notée 3 — et sa recherche l'avait relevée à 5.

**Proposition de découpe — recommandée.** La ligne suit le risque, comme pour `s37` :

- **`s37b1` — le décompte et l'impersonation.** Élargir `AdminAccountsPort`, corriger les trois surfaces, livrer l'impersonation avec sa rotation, son refus de pair et sa journalisation. Close seule : *la plateforme ne peut plus se retrouver sans administrateur, et un superadmin peut assister un client*. C'est la tranche qui porte toute la sécurité.
- **`s37b2` — le back-office en lecture.** Listes, recherche, pagination, détails d'utilisateur et d'organisation, bandeau. Close seule : *un administrateur voit ce qu'il administre*. Aucune autre story n'en dépend.

La seconde ne close seule que si la première a livré les gardes.
