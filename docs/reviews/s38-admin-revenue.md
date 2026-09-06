# Review — s38-admin-revenue

> Contexte neuf. Diff jugé : `git diff dev...feature/s38-admin-revenue` (32 fichiers, +1968/−18). Arbre propre avant et après.

## Conformité au plan

Les 8 tâches sont dans le diff, et **les quatre décisions du plan sont tenues et visibles à l'écran** : `trialing`/`past_due` hors argent et montrés en nombre, aucun total inter-devises (la sortie est une liste, jamais une somme), les achats uniques jamais fondus dans le récurrent (deux accumulateurs), ni historique ni prévision.

**La correction que l'implémenteur a apportée au plan est juste**, vérifiée : `BILLING_INTERVALS` déclare deux intervalles, pas trois — le plan confondait offres et intervalles. Dériver la boucle du vocabulaire était le bon geste.

**Les deux ajouts hors plan sont légitimes.** `recurringUnvalued`/`oneTimeUnvalued` répond à un vrai trou : un abonnement dont le `priceId` a quitté le catalogue contribuerait 0 et ferait baisser le total pour une raison non commerciale. Le test de fuite de barre latérale est une vraie prise.

**La correction de `packages/modules/billing/AGENTS.md` est fondée** : `admin` ne déclare pas `billing` dans ses requis — vérifié dans le `package.json` et asserté par un test — donc il ne peut pas posséder les montants. La stratification tient : le littéral `{ kind: 'platform' }` n'est écrit qu'à un seul site de production.

## Anti-hallucination

Chaque symbole ouvert et vérifié. Rien d'inventé. `configureAdmin` gagne une clé obligatoire, ses trois appelants sont à jour.

**Le calcul est juste, vérifié dans un navigateur contre des lignes semées** : 2900×3 (mensuel, quantité 3) + arrondi(29000/12) = 11 117 unités mineures → **111,17 €**, 2 abonnements, 1 non valorisé. Achats : 490,00 € / 120,00 $US, 1 non valorisé.

## Mutations

Treize neutralisations rouges, dont **L à 2 rouges** — le test réécrit dérive bien la racine du back-office et mord sur une entrée déclarée par un autre module — et la moitié **compile-time** de la partition, réelle : ajouter un septième état d'affichage fait échouer `tsc` en nommant `revenue.ts:82`. Les tâches 6, 7 et 8 n'étaient pas rouge-d'abord, et les mutations I/J/K/L couvrent ce qu'un pas rouge-d'abord aurait donné.

**Quatre neutralisations vertes**, et ce sont les constats :

| # | Neutralisé | Rouges |
|---|---|---|
| M | l'offre résolue par un prix inexistant | **0** |
| M2 | `interval` codé en dur à `'month'` | **0** |
| P | un troisième intervalle ajouté au vocabulaire | **0** |
| Q | le port avale une lecture en échec et rend un revenu vide | **0** |

## Constats

**1. major — le nombre central de la story n'a aucune couverture à son propre site** (`billing-use-cases.ts:1204-1216`). Résoudre l'offre par un prix inexistant — tout devient « non valorisé », la table du récurrent reste vide en permanence pendant que la plateforme facture — et coder l'intervalle en dur à `'month'` — un abonnement annuel compté **douze fois trop cher**, l'erreur de facteur 12 que la tâche 1 nomme — laissent **2794 cas verts**. Aucun test n'asserte `snapshot.recurring` contre un abonnement stocké. Toutes les mutations du domaine ont été posées **dans** `domain/revenue.ts`, où la composition n'est pas : c'est le mode d'échec que la règle du dépôt écrit mot pour mot. **Aggravant** : `revenue.test.ts:22-24` affirme que les trois formes d'offre sont éprouvées contre le vrai fichier dans `tests/billing.test.ts` — cette phrase est fausse. Le code de production est correct aujourd'hui, vérifié au navigateur : c'est un trou de couverture, pas un défaut livré.

**2. major — une garantie écrite qu'aucune commande ne tient** (`revenue.test.ts:29-31`) : « Les intervalles sont dérivés, jamais recopiés. Un troisième intervalle doit faire rougir ici. » Ajouter `'quarter'` laisse la suite **entièrement verte** : la boucle n'asserte que `> 0`, et `monthlyAmountOf` traite silencieusement tout ce qui n'est pas `year` comme mensuel. L'asymétrie est frappante — la partition des états est refusée **à la compilation**, l'exhaustivité des intervalles ne l'est nulle part.

**3. major — un critère d'acceptation non tenu et nulle part consigné comme abandonné.** Le critère 4 de `docs/stories.md` demande une **période sélectionnable**. Le plan décide « aucun historique », mais sa section « ce que la story ne fait pas » liste l'historique, le graphique, l'export, Stripe et la prévision — **jamais le sélecteur de période**, et n'argumente jamais que la donnée le rend impossible. Lié, même paragraphe du critère 1 : l'écran ne rend que les états **observés**, donc avec zéro essai en cours il n'affiche **aucun chiffre d'essai** — un lecteur ne peut pas distinguer « 0 » de « non suivi », sur un écran dont toute la thèse est de dire ce que valent ses nombres.

**4. minor — `adminRevenuePort` n'est pas testé** : avaler une lecture en échec et rendre un instantané vide laisse **0 rouge**, alors que son propre commentaire promet « jamais un revenu à zéro, qui se lirait comme une réponse ». `apps/web/AGENTS.md` mémorise exactement cette classe (constat MJ4 de s37b1). Le port des organisations (s37b2) est tout aussi découvert : `s38` étend un trou préexistant plutôt que d'en ouvrir un.

**5. minor — un compte écrit** (`admin/AGENTS.md:88`, « le **cinquième** écran ») dans un fichier dont les règles voisines sont « ne jamais prétendre à l'exhaustivité » et « dériver les comptes ». La même édition a correctement **retiré** le « Quatre écrans » deux lignes plus haut.

**6. minor — deux légendes de table répètent mot pour mot le titre de leur carte**, sans rien apporter, là où la troisième porte une information.

**7. minor — la moitié `!billing.available` de la garde n'est décidée par aucune commande** : le profil coupe `billing` **et** `admin` ensemble, et la CI ne coupe pas `billing`. Le test qui l'attraperait ne joue que dans une configuration que rien ne joue. Identique en forme à `s37b2`, donc cohérent plutôt que neuf.

## Régressions

Aucune trouvée. Un point à connaître : les deux nouveaux tests adossés à la base assertent une **égalité exacte sur une lecture non filtrée**. Verts aujourd'hui parce qu'un seul fichier écrit ces tables ; le premier futur fichier qui y sèmera un abonnement les rendra instables.

## Non vérifié

- **`pnpm test:minimal-profile`, `test:socle`, `test:golden-path`, `test:sans-env`, `test:contrast`, `run audit` et le scan de secrets n'ont pas été joués.** La tâche 8 du plan affirme que le profil minimal le tient : non vérifié.
- **Les preuves navigateur sont sous `next dev`**, jamais sous le build de production : nonce CSP, `Intl` côté serveur et le formatage monétaire sous l'étape d'exécution ne sont pas éprouvés.
- **Français seulement, thème clair seulement**, 1280 et 390 px.
- **Aucun appel Stripe réel, jamais.**
- **Budget de limitation sous passages répétés** : la nouvelle spec ajoute deux inscriptions par passage.
- **Concurrence des deux nouveaux tests de base** : verte aujourd'hui, non prouvée contre un futur écrivain.

**Gestes humains** : ouvrir `/admin/revenue` sous le build de production avec deux devises, un abonnement dont le `priceId` a quitté le catalogue et un achat payé sans montant ; vérifier le récurrent contre un calcul à la main — ce qu'aucun test ne fait. Couper **seulement** `billing` et confirmer le 404. Trancher explicitement le critère 4.

Max severity: major
Ship allowed: yes
