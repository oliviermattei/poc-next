---
story: s23-seat-billing
validated: yes
---
# Plan — Story s23-seat-billing

Branch: `feature/s23-seat-billing`
Research: `docs/research/s23-seat-billing.md` — **à lire d'abord**, elle contient une prémisse fausse qui commande tout le plan.
Décision: `docs/decisions/046-la-quantite-de-sieges-s-ecrit-chez-le-fournisseur-avant-d-etre-validee-localement.md`.
Pas de design : aucun critère de cette story n'a d'écran.

## Story visée

« Facturer au nombre de membres ». Complexité mesurée **5**, ramenée à une story
tenable par la sortie de la limite de sièges en `s47-seat-limit`.

1. Une offre marquée facturée au siège dans la configuration.
2. Ajout d'un membre → quantité incrémentée ; retrait → décrémentée.
3. La quantité facturée égale toujours le nombre de membres actifs après toute opération.
4. Une invitation en attente n'est pas facturée ; elle le devient à l'acceptation.
5. *(sortie en s47-seat-limit)*
6. Un échec Stripe n'ajoute pas le membre : atomique et rejouable.
7. Une commande de réconciliation compare et corrige l'écart.
8. Module non activé : forfait, aucune synchronisation.

## Tâches (ordonnées)

1. [x] **Étendre le contrat du port `Payments`.** Ajouter
   `updateSubscriptionQuantity(input): Promise<UpdateSubscriptionQuantityResult>`
   à l'interface (`packages/ports/src/payments.ts:380`). Résultat **discriminé**
   (`{ok:true,…} | {ok:false,error}`) — aucune méthode ne lève, c'est le contrat
   (`payments.ts:375-378`). L'entrée porte l'identifiant d'abonnement du
   fournisseur, la quantité **visée** (jamais un delta) et une clé
   d'idempotence. La forme fermée de journalisation d'échec
   (`payments.ts:388-395`) s'applique : aucun champ où loger un identifiant
   client ou un montant.
   *Test* : `packages/ports/src/payments.test.ts` — le type de résultat force
   l'appelant à traiter l'échec ; vérifier par mutation que retirer la branche
   d'échec ne compile plus.

2. [x] **Implémenter dans l'adaptateur Stripe**, avec délai d'expiration
   explicite et rejeu à repli exponentiel sur les erreurs transitoires
   uniquement (`docs/reliability.md` §3) — rejouer une erreur de validation est
   un défaut.
   *Test* : `packages/adapters/stripe/src/stripe-payments.test.ts` — le double
   remplace le **réseau**, jamais le SDK. La quantité part bien dans la requête ;
   une réponse 4xx ne déclenche pas de rejeu, une 5xx si.

3. [x] **Le mode local ne parle à personne.** `PAYMENTS_LOCAL_MODE=1` doit
   accepter la mise à jour et la mémoriser sans appel sortant, comme le fait déjà
   le checkout simulé. Un processus sans clé **ni** drapeau refuse de démarrer en
   nommant la variable.
   *Test* : `tests/env-wiring.test.ts` et le test du mode local existant.

4. [x] **La règle : quelles offres se synchronisent.** Fonction pure dans
   `packages/modules/billing/src/domain/seats.ts` — une offre se synchronise si
   `perSeat` **et** `mode === 'subscription'`. Un achat unique facturé au siège
   n'a pas de sens et le catalogue ne l'interdit pas aujourd'hui (question
   ouverte de la recherche) : cette règle le tranche sans toucher
   `config/billing.ts`.
   *Test* : `domain/seats.test.ts` — les quatre combinaisons de `perSeat` × `mode`.

5. [x] **Compter les membres d'une organisation nommée, côté serveur.** La
   recherche a relevé le piège : `seatsOf` (`apps/web/lib/billing.ts:218`) passe
   par `organizations.view(userId)`, la vue **du compte courant**, et le
   commentaire dit que lire « les membres de l'organisation X » ouvrirait une
   porte que s15 ferme. La réconciliation (tâche 8) en a pourtant besoin.
   Ajouter au point de composition un compteur **serveur**, non exposé à une
   requête HTTP, distinct de `seatsOf` et jamais atteignable par un identifiant
   venu du navigateur.
   *Test* : `tests/billing.test.ts` — le compteur serveur rend le même nombre que
   `seatsOf` pour la même organisation ; **et** aucune route ne l'expose (le
   vérifier, pas l'affirmer).

6. [x] **Synchroniser à l'acceptation d'une invitation.** Brancher
   `acceptInvitation` (`organizations/.../organization-use-cases.ts:690`) au
   point de composition, jamais par une dépendance de module : `requires: []` du
   module `billing` est une décision (ADR 034, `module.ts:44`). Séquence exacte de
   l'ADR 046 : insérer sans valider → appeler le port → échec : annuler →
   succès : valider.
   *Test* : `tests/billing.test.ts` — l'acceptation incrémente la quantité ; un
   échec du port **n'ajoute pas** le membre (critère 6) ; deux acceptations
   rejouées convergent au lieu de compter deux fois.

7. [x] **Synchroniser au retrait d'un membre.** Même motif sur `removeMember`
   (`:740`). Le retrait décrémente.
   *Test* : idem, plus l'invariant du critère 3 — après une séquence
   ajout/ajout/retrait, la quantité égale le nombre de membres.

8. [x] **L'invitation en attente n'est pas facturée.** La recherche a établi que
   les invitations sont suivies **séparément** des membres
   (`organizations/.../ports.ts:95`) : le critère 4 est donc satisfait par
   construction. Il se **prouve**, il ne se construit pas.
   *Test* : émettre une invitation ne change pas la quantité ; l'accepter la
   change. Vérifier par mutation qu'un compteur incluant les invitations rougit.

9. [x] **Étendre `pnpm billing:reconcile` à la quantité.** `scripts/billing-reconcile.ts`
   réconcilie aujourd'hui fournisseur → local. Pour la quantité le sens
   s'inverse (ADR 046) : le nombre de membres fait foi, la quantité y est
   ramenée. Deux gardes obligatoires : la commande **n'efface jamais**
   (`AGENTS.md`), et un rejeu ne réécrit rien.
   *Test* : `tests/billing.test.ts` — un écart provoqué est corrigé ; la seconde
   exécution rend « 0 réécrit » ; une lecture des membres en échec **ne baisse
   aucune quantité** (c'est le défaut de facturation silencieux que la recherche
   redoute).

10. [x] **Module coupé et périmètre compte.** Aucune synchronisation, forfait,
    et rien ne casse — le repli existe déjà (`seatsOf` rend `1`).
    *Test* : registre sans `billing`, et périmètre `account` : aucun appel au
    port. Vérifier l'absence d'appel, pas seulement l'absence d'erreur.

11. [x] **Documentation.** `packages/ports/AGENTS.md` (le contrat gagne une
    méthode d'écriture), `packages/modules/billing/AGENTS.md`,
    `docs/reliability.md` §5 si la portée de la réconciliation y est décrite, et
    la ligne `pnpm billing:reconcile` du tableau d'`AGENTS.md` racine.

## Interdits d'exécution

- **Ne pas ajouter `organizations` aux `requires` du module `billing`** — c'est
  l'ADR 034, et le commentaire de `module.ts:23-27` explique pourquoi. Le diff de
  cette ligne doit rester vide.
- **Ne pas exposer le compteur serveur de la tâche 5 à une route HTTP**, ni le
  faire accepter un identifiant d'organisation venu du navigateur : ce serait
  rouvrir la porte que s15 a fermée.
- **Ne pas faire baisser une quantité sur une lecture de membres en échec.**
  Un silence de la base doit interrompre la réconciliation, pas réduire une
  facture.
- **Ne pas introduire de file d'attente ni de bus d'événements** (rejeté dans
  l'ADR 046 ; les notifications temps réel sont au cimetière du PRD).
- **Ne pas rejouer une erreur de validation** — seules les erreurs transitoires
  se rejouent.
- **Ne pas ajouter de seconde implémentation de port.** Le double de test
  remplace le réseau, jamais le SDK.
- **Ne pas traiter la limite de sièges** : elle est en `s47-seat-limit`.
- **Ne pas modifier `config/billing.ts`** : `perSeat` y est déjà, et la règle de
  la tâche 4 se passe d'un champ neuf.

## Le point sur lequel tout repose

**L'ordre des deux écritures**, et le fait qu'il choisit qui paie la panne
(ADR 046). Fournisseur d'abord : un échec Stripe n'ajoute rien — c'est le
critère 6 — mais une validation locale en échec après un succès distant
**surfacture** le client d'un siège.

Trois endroits où cela peut être faux :

1. **La clé d'idempotence.** Si elle porte un incrément plutôt que la quantité
   visée, un rejeu compte deux fois. À comparer avec `idempotencyKey:
   \`checkout:…\`` déjà en place : elle est dérivée d'un état, pas d'un compteur.
2. **La transaction ouverte pendant l'appel réseau.** Sans délai d'expiration
   explicite, une lenteur du fournisseur tient un verrou de base. À comparer avec
   `docs/reliability.md` §3.
3. **Le sens de vérité de la réconciliation.** L'ADR 034 dit que le local est un
   cache du fournisseur ; l'ADR 046 inverse ce sens **pour le seul champ
   quantité**. Un agent qui applique la doctrine générale écrasera le nombre de
   membres par la quantité Stripe — c'est-à-dire qu'il propagera l'erreur au lieu
   de la corriger.

## Fichiers touchés (anticipé)

| Fichier | Nature |
|---|---|
| `packages/ports/src/payments.ts` (+ test) | contrat, une méthode |
| `packages/adapters/stripe/src/…` (+ test) | implémentation, mode local |
| `packages/modules/billing/src/domain/seats.ts` (+ `.test.ts`) | règle pure |
| `packages/modules/billing/src/application/billing-use-cases.ts` | cas d'usage de synchronisation |
| `apps/web/lib/billing.ts` | compteur serveur, câblage |
| `apps/web/lib/organizations.ts` | accroche acceptation / retrait |
| `scripts/billing-reconcile.ts` | quantité |
| `tests/billing.test.ts` | critères 2, 3, 4, 6, 7, 8 |
| `packages/ports/AGENTS.md`, `packages/modules/billing/AGENTS.md`, `AGENTS.md`, `docs/reliability.md` | docs |

## Stratégie de test

| Niveau | Ce qu'il couvre |
|---|---|
| `domain/seats.test.ts` | quelles offres se synchronisent — pur, sans base |
| `packages/adapters/stripe/…test.ts` | la quantité part dans la requête ; rejeu sur 5xx, pas sur 4xx |
| `tests/billing.test.ts` | les deux accroches, l'atomicité, la convergence au rejeu, la réconciliation dans les deux sens, le module coupé |
| mutation | clé d'idempotence portant un delta ; compteur incluant les invitations ; réconciliation baissant sur lecture en échec — **les trois doivent rougir** |

Pas de test e2e : aucun critère n'a d'écran. Le parcours d'invitation existant
doit rester vert sans réécriture de ses assertions.

## Definition of Done

- Les sept critères restants vérifiés, chacun par un test nommé.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` verts, Postgres levé.
- `pnpm billing:reconcile` exécutée **deux fois** : un effet, puis zéro.
- Les trois mutations du tableau ci-dessus vérifiées rouges.
- Le résidu de surfacturation de l'ADR 046 écrit **dans le code**, au point de
  validation de la transaction — pas seulement dans l'ADR.
- Un seul commit, message impératif en français, portant recherche, plan et ADR 046.
