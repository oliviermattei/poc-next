---
story: s24-guest-checkout
validated: yes
---
# Plan — Story s24-guest-checkout

Branch: `feature/s24-guest-checkout`
Research: `docs/research/s24-guest-checkout.md` — **à lire d'abord** : elle établit que la story contredit l'ADR 034 par la voie évidente, et par où passer sans le contredire.
Décision: `docs/decisions/047-le-perimetre-invite-existe-au-stockage-jamais-dans-le-coeur.md`.
Pas de design : le seul élément d'écran est le CTA déjà livré par s22 ; aucun écran neuf.

## Story visée

« Payer sans créer de compte d'abord ». Complexité mesurée **4**, pas 3.
Deux critères sont des **interdits de sécurité**, et leur violation ne se verrait
pas en fonctionnement normal : aucune session ouverte depuis la page de retour
(7), et le compte créé au **webhook**, jamais au retour (piège nommé par la
story : le visiteur peut fermer son navigateur).

## Tâches (ordonnées)

1. [x] **Le périmètre invité au stockage** (ADR 047). Un `scope_kind = 'guest'`
   et un `scope_id` **opaque, non devinable** — généré par un CSPRNG, jamais un
   compteur ni un horodatage. Aucune modification de `ModuleScope`
   (`packages/core/src/module.ts:215`) : le diff de ce fichier doit rester vide.
   *Test* : `packages/modules/billing/src/domain/…test.ts` — deux générations
   diffèrent ; la forme est celle attendue. Et une requête qui sert un compte
   **ne rend jamais** une ligne invitée (mutation : retirer le filtre sur
   `scope_kind` doit rougir).

2. [x] **Une entrée de checkout invité, distincte et publique.** `openCheckout`
   exige une session (`billing-use-cases.ts:542-546`) et ne doit pas être
   assouplie — l'affaiblir mettrait le chemin authentifié en danger pour servir
   l'anonyme. Écrire un cas d'usage voisin qui ne prend pas de session, écrit la
   ligne client invitée **à l'ouverture** (ADR 034 respecté), et ouvre le tunnel.
   *Test* : `tests/billing.test.ts` — un anonyme obtient une URL ; la ligne
   client existe avec `scope_kind = 'guest'` **avant** tout webhook.

3. [x] **Limitation de débit sur la route publique.** C'est la **première route
   de paiement publique** du dépôt. Le socle sécurité impose une limitation sur
   tout point d'entrée public, partagée entre instances — la limitation
   PostgreSQL existante sait le faire ; s'en servir plutôt que d'en écrire une.
   *Test* : au-delà du seuil, la route refuse ; le compteur est bien en base et
   non en mémoire de processus (mutation : le passer en mémoire doit rougir).

4. [x] **Promotion au webhook** (ADR 047). À `checkout.session.completed`, la
   ligne invitée devient `scope_kind = 'user'`. L'email vient du fournisseur,
   donc **d'une frontière** : validé par Zod, jamais cru sur parole. Compte créé
   s'il n'existe pas, retrouvé sinon (critère 4). Le module `billing` ne connaît
   pas `auth` (`requires: []`, ADR 034) : la création passe par le **point de
   composition**, comme `seatsOf` et `seatSync` de s23.
   *Test* : `tests/billing.test.ts` — après l'événement, la ligne est promue et
   le droit d'accès est rattaché ; un événement **rejoué** ne crée ni second
   compte ni second droit (critère 6) ; un paiement **abandonné** ne crée ni
   compte ni droit (critère 5).

5. [x] **Le lien envoyé, et ce qu'il fait d'un compte existant.** Voir « Le point
   sur lequel tout repose ». Compte **neuf** → lien de définition de mot de
   passe. Compte **existant** → **magic link uniquement**
   (`auth-use-cases.ts:322`, gabarit `auth.magic-link`).
   *Test* : les deux branches ; et une mutation qui enverrait le lien de
   définition de mot de passe à un compte existant doit rougir.

6. [x] **Aucune session depuis la page de retour** (critère 7). La page de retour
   n'affiche qu'un état lu en base, écrit par le webhook — la discipline que s19
   a déjà posée pour `/billing` (« un `?checkout=success` forgé n'affiche qu'un
   bandeau »).
   *Test* : ouvrir la page de retour avec un `session_id` forgé, et avec un
   authentique, **n'ouvre aucune session** dans les deux cas. Mutation : y
   ajouter une ouverture de session doit rougir.

7. [x] **Module coupé** (critère 8). La route de checkout anonyme **n'existe
   pas** — 404, pas 403 —, et la page de tarifs mène à la connexion.
   *Test* : registre sans `billing` ; la route est absente, pas refusée.

8. [x] **Rétention de la ligne invitée orpheline.** Un abandon en laisse une
   (conséquence assumée de l'ADR 047). Le contrat du module déclare une
   catégorie de données et **une politique par catégorie** : la déclarer, sans
   inventer de commande de nettoyage — il n'en existe pas et il ne doit pas en
   exister.
   *Test* : le contrat déclare la catégorie et sa rétention ; le test de
   complétude du contrat le vérifie déjà.

9. [x] **Documentation.** `packages/modules/billing/AGENTS.md` (périmètre
   invité, promotion, la requête qui doit filtrer `scope_kind`),
   `apps/web/AGENTS.md` (la dépendance neuve du point de composition : créer un
   compte depuis le webhook), et `docs/security.md` si la route publique de
   paiement y ajoute un point d'entrée à lister.

## Interdits d'exécution

- **Ne pas modifier `packages/core/src/module.ts`** — `ModuleScope` garde deux
  formes (ADR 047). Diff vide.
- **Ne pas assouplir `openCheckout`.** Le chemin authentifié garde sa garde de
  session ; l'anonyme a sa propre entrée.
- **Ne pas rattacher à la réception du webhook** au sens de l'ADR 034 : la ligne
  client s'écrit **à l'ouverture** du tunnel. Le webhook **promeut**, il ne
  crée pas la ligne.
- **Ne jamais ouvrir de session depuis la page de retour**, ni depuis un
  paramètre d'URL, ni depuis un identifiant de session de paiement.
- **Ne pas envoyer de lien de définition de mot de passe à une adresse qui
  possède déjà un compte.**
- **Ne pas ajouter `auth` aux `requires` du module `billing`** (ADR 034).
- **Ne pas créer de commande de nettoyage** des lignes invitées : l'`eject` est
  au cimetière du PRD.
- **Ne pas ajouter d'origine à `config/security.ts`.**
- **Ne pas toucher `config/billing.ts`.**

## Le point sur lequel tout repose

**Le lien envoyé à une adresse qui possède déjà un compte.**

Le critère 3 dit « définir son mot de passe **ou** se connecter par magic link »
sans trancher, et le critère 4 impose de rattacher le droit à un compte existant
plutôt que d'en créer un second. Croisés, ils décrivent une situation où
**n'importe qui, en payant, déclenche un email vers l'adresse d'un tiers**.

Ce plan tranche : **magic link seulement** pour un compte existant.

L'alternative — un lien de définition de mot de passe — est rejetée parce
qu'elle transforme un paiement en **chemin de réinitialisation de mot de passe
déclenchable par un tiers**, sans possession du mot de passe actuel. La boîte
mail reste la barrière dans les deux cas, mais l'un ne fait que connecter le
titulaire, l'autre écrase son secret. Sur un boilerplate revendu, c'est la
différence entre une commodité et une porte.

Trois endroits où ce plan peut être faux :

1. **L'opacité du `scope_id` invité.** Écrit avant tout paiement, retrouvé par le
   webhook : prévisible, il permettrait de viser la ligne d'un autre. À comparer
   avec les générateurs de jetons déjà employés par `auth`, jamais avec
   `Date.now()`.
2. **Le filtre sur `scope_kind`.** Toute requête qui sert un compte doit ignorer
   les lignes invitées. Une seule oubliée rend une ligne invitée là où on attend
   un utilisateur — et l'unicité de la base ne l'attrapera pas.
3. **L'idempotence de la promotion.** Le rejeu est garanti par l'unicité de
   `provider_customer_id`, mais la **création du compte** se fait au point de
   composition, hors de cette contrainte. C'est là qu'un second compte peut
   naître, pas dans le module.

## Fichiers touchés (anticipé)

| Fichier | Nature |
|---|---|
| `packages/modules/billing/src/domain/…` (+ test) | périmètre invité, génération opaque |
| `packages/modules/billing/src/application/billing-use-cases.ts` | entrée invitée, promotion |
| `packages/modules/billing/src/presentation/billing-routes.ts` | route publique + limitation de débit |
| `packages/modules/billing/src/module.ts` | catégorie de données et rétention |
| `apps/web/lib/billing.ts` (+ un fichier de règle dédié) | création de compte au webhook |
| `apps/web/app/pricing/page.tsx` | CTA anonyme vers le checkout invité |
| `tests/billing.test.ts` | critères 1 à 8 |
| `e2e/billing.spec.ts` | le parcours invité complet |
| `AGENTS.md` du module et d'`apps/web`, `docs/security.md` | docs |

## Stratégie de test

| Niveau | Ce qu'il couvre |
|---|---|
| `domain` | opacité et forme du périmètre invité — pur |
| `tests/billing.test.ts` | l'entrée publique, la promotion, le rejeu, l'abandon, les deux branches d'email, le module coupé |
| mutation | **six**, listées ci-dessus : filtre `scope_kind` retiré ; limitation en mémoire ; session ouverte au retour ; lien de mot de passe vers un compte existant ; promotion non idempotente ; `scope_id` prévisible |
| `e2e` | le parcours invité de bout en bout, en mode local |

## Definition of Done

- Les huit critères vérifiés, chacun par un test nommé.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` verts, Postgres levé.
- Les **six** mutations vérifiées rouges.
- Aucune session ouverte depuis la page de retour — prouvé, pas affirmé.
- Un seul commit, message impératif en français, portant recherche, plan et ADR 047.
