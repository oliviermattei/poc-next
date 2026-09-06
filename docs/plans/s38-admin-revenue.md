---
story: s38-admin-revenue
validated: yes
---

# Plan — s38-admin-revenue

> Planifié contre `dev` au commit `043e57b`. La recherche (`docs/research/s38-admin-revenue.md`) est datée de `8e3678f`, **la base exacte de cette branche** : rien à revérifier.

## Le fait qui gouverne tout l'écran

**Le dépôt ne stocke aucun montant d'abonnement.** `billingSubscription` porte `offerId`, `priceId`, `status`, `quantity` — pas de montant. Les montants vivent dans `config/billing.ts`, dont le commentaire de tête écrit lui-même : « `priceId` est ce qui fait foi. `amount` et `currency` ne servent qu'à l'affichage. »

Les achats uniques, eux, portent `amount` et `currency` : « **ce qui a été réellement prélevé** » (`schema.ts:230`).

Les deux moitiés de cet écran n'ont donc pas le même statut : **le récurrent est estimé depuis une déclaration locale, le ponctuel est constaté**. Un écran qui les additionne en un seul chiffre efface cette différence — et c'est exactement le genre de nombre qu'un lecteur croit sur parole.

## Les quatre décisions que ce plan prend, plutôt que de les deviner

1. **Aucun historique.** Le critère parle d'indicateurs, pas de série temporelle, et le dépôt ne stocke aucun instantané daté : un historique demanderait une table, donc une migration, donc une autre story. L'écran montre **l'état courant**, et le dit.
2. **Ce qui compte dans le récurrent** : les abonnements `active` et `ending` (celui qui se termine paie jusqu'à la fin de sa période). **`trialing` est exclu** — rien n'a été prélevé — et **`past_due` aussi** : compter de l'argent qui n'arrive pas est précisément la falsification que la story met en garde. Les deux sont affichés à part, en **nombre de comptes**, pas en euros.
3. **Aucun total multi-devises.** `config/billing.ts` déclare une devise par offre. Les montants sont **groupés par devise**, jamais sommés entre elles — un total qui additionne des euros et des dollars est faux en silence.
4. **Les achats uniques ne rejoignent jamais le MRR.** Ils ont leur propre chiffre, constaté, sur leur propre période.

## Tâches

- [x] **1. La règle de normalisation, dans le `domain`.** Une offre annuelle ne vaut pas son montant par mois ; `quantity` multiplie (facturation au siège, s23). C'est là que se logent les erreurs de facteur 12 — donc une fonction pure, testée sur les trois intervalles de `config/billing.ts` et sur une quantité supérieure à un. Mutation : retirer la division par 12 doit rougir.
- [x] **2. Le vocabulaire des états qui comptent, dérivé.** `BILLING_DISPLAY_STATES` est une **liste d'exécution** depuis `s37b2` : la partition (compte dans le revenu / ne compte pas) se dérive d'elle et **refuse un état qu'elle ne classe pas**. Un septième état ajouté demain force une décision au lieu d'hériter du silence. C'est la forme que `s37b2` a livrée pour les libellés.
- [x] **3. La lecture, par le port, à l'échelle de la plateforme.** `s37b2` a livré `PlatformScope` dans `scoped-reads.ts` : le scope reste le premier paramètre et n'est écrit qu'au point de composition. **Aucun appel au fournisseur au rendu** — l'état local fait foi (`s19`, `s20`), et `pnpm billing:reconcile` existe pour les divergences (ADR 046).
- [x] **4. Le groupement par devise**, avec le refus explicite du total inter-devises. Mutation : sommer deux devises doit rougir.
- [x] **5. L'écran, dans le cadre livré par `s37b2`.** Une entrée de navigation sur la surface `admin` (ADR 067), la garde `authorize` **existante** — aucune seconde copie —, `Table` et `Card` de `packages/ui`. **404 pour un non-superadmin**, mesuré sur le vrai chemin HTTP.
- [x] **6. Ce que l'écran dit de ses propres chiffres.** Le récurrent porte à l'écran qu'il est **estimé depuis `config/billing.ts`**, le ponctuel qu'il est **constaté**. Ce n'est pas de la prudence rédactionnelle : c'est la seule chose qui empêche un lecteur de prendre une déclaration locale pour une lecture comptable. Un test l'exige, sinon la phrase disparaîtra à la première relecture qui la trouvera bavarde.
- [x] **7. Aucun abonnement, aucun achat** : l'écran affiche zéro et son état vide (`EmptyState`), il ne casse pas et n'affiche pas de tiret. Plancher : un balayage sur zéro ligne ne doit pas rendre les assertions vertes sans rien vérifier.
- [x] **8. Module `billing` coupé** : l'entrée disparaît, la route n'existe pas. Dérivé du registre, aucun nom de module écrit. `pnpm test:minimal-profile` le tient.

## Ce que la story ne fait pas

Pas d'historique, pas de graphique, pas d'export, pas d'appel à Stripe. Pas de prévision : un MRR projeté sur douze mois serait un chiffre inventé à partir d'un chiffre estimé.

## Round de correction (revue du 2026-09-06)

La revue a rendu `Ship allowed: yes` avec trois constats majeurs et quatre mineurs. Ils sont traités ici, avant l'ouverture de la PR.

- [x] **F1 — le nombre central n'avait aucune couverture à son propre site.** Toutes les mutations du domaine avaient été posées dans `domain/revenue.ts`, où la composition n'est pas : résoudre l'offre par un prix inexistant et coder l'intervalle en dur laissaient 2794 cas verts. `tests/billing.test.ts` valorise désormais des abonnements **stockés** (mensuel × quantité, annuel ramené au douzième, prix retiré du catalogue), et la phrase fausse de `revenue.test.ts` — qui affirmait que les trois formes d'offre du catalogue livré y étaient éprouvées — est corrigée.
- [x] **F2 — l'exhaustivité des intervalles n'était tenue par rien.** `MONTHS_PER_INTERVAL` est `satisfies Record<BillingInterval, number>`, comme la partition des états : un troisième intervalle ne compile plus, et la boucle du test rend `NaN` sur lui.
- [x] **F3 — le critère 4 (période sélectionnable) était non tenu et nulle part consigné.** Il est **tenu sur la moitié qui peut le porter** : `billing_purchase` a une date d'encaissement, donc les achats se bornent (`30d`, `12m`, depuis le début). Le récurrent **ne peut pas** la porter — aucun instantané daté du parc n'est stocké — et l'écran le dit à côté du chiffre, dans la voix des deux phrases épistémiques déjà écrites. Même constat : l'écran rend désormais **tous** les états, ceux à zéro compris, pour qu'un lecteur distingue « 0 essai » de « essais non suivis ».
- [x] **F4 — `adminRevenuePort` n'était pas éprouvé.** Un cas unique couvre les **deux** ports adossés à d'autres modules, sa liste de lectures étant énumérée par le compilateur : celui des organisations (s37b2) est donc fermé avec lui.
- [x] **F5 — le « cinquième écran » de `admin/AGENTS.md`** : un compte écrit qu'aucune commande ne tient, retiré.
- [x] **F6 — les deux légendes de table qui répétaient leur titre de carte** portent chacune un décompte que rien d'autre à l'écran ne dit.
- [x] **F7 — la moitié `!billing.available` de la garde de page** : rien n'a été fait, et la raison est écrite dans `apps/web/AGENTS.md`. Le profil coupe `billing` et `admin` ensemble, la CI ne coupe ni l'un ni l'autre : ce qui la déciderait est un profil coupant `billing` en gardant `admin`, ce qui change la recette de deux autres commandes — un choix de cadrage, pas un correctif de revue.
- [x] **Balayage P30 (« un second chiffre dont rien ne pin la provenance »)** : le total de la légende des états et les deux compteurs « non valorisés » sont désormais assertés à la composition ; et les deux cas adossés à la base assertent des **écarts** plutôt que des égalités exactes sur une lecture non bornée, que le premier futur semeur d'abonnement aurait rendues instables.

## Sections de `docs/security.md` touchées

**404 plutôt que 403** pour un non-superadmin. **Autorisation vérifiée côté serveur.** Aucun identifiant de client du fournisseur affiché à l'écran — ce sont des références externes, pas de l'information de gestion.
