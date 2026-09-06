# Research — Story s38-admin-revenue

> Vérifiée contre la branche par défaut au commit `8e3678f`, en lecture seule. Aucune base, aucun conteneur, aucun worktree.

## Les cinq faits structurants

1. **Le dépôt ne stocke aucun montant d'abonnement.** `billingSubscription` (`packages/modules/billing/src/schema.ts:104`) porte `offerId`, `priceId`, `status`, `quantity`, `currentPeriodEnd`, `trialEnd` — et **pas** de montant. Les montants vivent dans `config/billing.ts`, où le commentaire de tête dit lui-même : « **`priceId` est ce qui fait foi.** `amount` et `currency` ne servent qu'à l'affichage. » Un revenu calculé depuis cette source est donc une **estimation dérivée d'une déclaration locale**, pas une lecture comptable — et la story doit le dire à l'écran, pas seulement dans un commentaire.

2. **Les achats uniques, eux, portent le vrai montant.** `billingPurchase:230` stocke `amount` et `currency`, documentés comme « **ce qui a été réellement prélevé** ». Les deux moitiés de l'écran n'ont donc pas le même statut épistémique : le récurrent est estimé depuis la configuration, le ponctuel est constaté. Les mélanger dans un total unique effacerait cette différence.

3. **Le piège nommé par la story est réel et mesurable.** « Compter un achat unique comme un abonnement toujours actif fausse le MRR » : `billingPurchase` n'a ni `status` ni `currentPeriodEnd`, donc rien dans la donnée n'empêche de le sommer avec les abonnements. C'est une décision de calcul, pas une contrainte du schéma — donc un test, ou rien.

4. **Le back-office existe désormais, et son entrée se dérive.** `s37b2` vient de livrer les écrans, la garde `authorize` (une seule, appelée par les routes et par les vues), la `Table` de `packages/ui`, la pagination fenêtrée, et la surface `admin` des entrées de navigation (ADR 067). `s38` ajoute un écran **dans** ce cadre : elle ne recrée ni garde, ni table, ni entrée.

5. **Ne pas interroger Stripe au rendu**, comme la story le dit. Les webhooks de `s19` et `s20` alimentent l'état local, qui fait foi, et `pnpm billing:reconcile` existe pour les divergences (ADR 046). Un écran qui appellerait le fournisseur ferait dépendre le back-office de sa disponibilité — l'inverse de la ligne de fiabilité « un tiers absent dégrade ».

## Points d'ancrage

- `packages/modules/billing/src/schema.ts:104` et `:208` — les deux tables, et ce que chacune porte.
- `packages/modules/billing/src/domain/subscription.ts:175` — `BILLING_DISPLAY_STATES`, **liste d'exécution** depuis `s37b2` (elle était type seul), donc dérivable.
- `packages/modules/billing/src/application/billing-use-cases.ts:1146` — `subscriptionOf(scope)`, la lecture par portée déjà livrée.
- `packages/modules/admin/src/presentation/back-office-screens.tsx` — le cadre des écrans, et `authorize`.
- `config/billing.ts:55` — les offres, leurs `amount` et leur `interval`.

## Pièges & contraintes

- **Le total mensuel demande de normaliser les intervalles** : une offre annuelle à 29 000 ne vaut pas 29 000 par mois. La normalisation est une règle de domaine, testable, et c'est là que les erreurs de facteur 12 se logent.
- **`quantity` compte** : la facturation au siège (`s23`) fait qu'un abonnement vaut `amount × quantity`. L'ignorer sous-estime silencieusement.
- **Les états d'affichage sont six**, dérivables depuis `BILLING_DISPLAY_STATES`. Décider lesquels comptent dans le revenu récurrent (`trialing` ne rapporte rien encore, `past_due` rapporte peut-être) est une décision de produit à écrire, pas à deviner.
- **Module `billing` coupé** : l'écran n'existe pas. Le critère de `s19` définit déjà cette forme.
- **La devise n'est pas unique par construction** : `config/billing.ts` déclare une devise par offre. Sommer deux devises est un défaut silencieux ; refuser ou grouper est une décision à écrire.

## Questions ouvertes

- **`trialing` et `past_due` comptent-ils dans le MRR ?** Aucun document du dépôt ne trancher. Le plan doit choisir et l'écrire à l'écran, sinon deux lecteurs liront deux chiffres différents.
- **Un total multi-devises est-il refusé ou groupé ?** Non tranché.
- **La story affiche-t-elle une série temporelle ?** Le critère parle d'« indicateurs de revenu et d'abonnements » sans dire s'il faut un historique. Le dépôt ne stocke aucun instantané daté : un historique demanderait une table, donc une migration, donc une autre story.

## Complexité réelle

Notée **2** dans `docs/stories.md`. **Ma note : 2**, à condition de ne pas construire d'historique. Le cadre est livré, les lectures existent, et l'essentiel du travail est une règle de domaine — normaliser des intervalles et décider ce qui compte — plus un écran qui compose. Si le plan se met à vouloir une série temporelle, la note passe à 4 et il faut découper.
