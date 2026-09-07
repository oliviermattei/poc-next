---
story: s43-feedback-widget
validated: yes
---

# Plan — s43-feedback-widget

> Planifié contre `dev` au commit `6dda2e3`, qui porte la recherche. Elle relève la complexité de **2 à 3**, et la raison n'est pas le retour : c'est le widget.

## Ce qui est déjà construit

**Le critère 3 est livré.** `apps/web/lib/notifications.ts` décide déjà, **par la valeur**, entre le centre de notifications et l'envoi direct. Et `config/notifications.ts` nomme cette story : un retour est une **quatrième ligne** de son registre. La story appelle ; elle ne construit pas.

## La décision : pas de panneau flottant

Le widget serait le **premier élément flottant du dépôt**, et trois faits mesurés découragent la voie évidente :

1. **La CSP interdit sa mise en œuvre la plus courante** — pas d'attribut `style`, pas de feuille injectée à l'exécution. Refusé en production, **silencieux en développement** : le pire des deux mondes pour un défaut.
2. **`Dialog` et `Popover` sont déclarés par le design system et absents.** Composer avec eux ne compile pas ; les livrer est une story dans la story.
3. **La leçon la plus chère du dépôt porte exactement là-dessus** : la bannière de consentement, posée en surface fixe **sans réserver son espace, a intercepté les clics de dix parcours**. Un visiteur ne pouvait plus atteindre le bas de la page.

**Donc : un déclencheur dans la coquille applicative — un lien, pas une surface flottante — et un formulaire sur sa propre page**, composé du formulaire partagé. Aucun état à hydrater, aucune interception de clic possible, et le tout fonctionne sans JavaScript comme la bannière. Le critère 1 dit « accessible depuis le tableau de bord », pas « superposé au tableau de bord ».

**Le manque est reporté**, il n'est pas comblé : `Dialog`/`Popover` restent absents, et un futur panneau flottant devra les livrer dans `packages/ui`.

## Tâches

- [ ] **1. Le module et sa table.** Généré par l'API exportée (`npx ks scaffold` refuse un arbre sale, ADR 041). Auteur, organisation, catégorie, message, **URL d'origine**, statut. Les quinze clés, dont les **quatre RGPD remplies** — `s34` et `s35` ont laissé les commandes qui les mesurent.
- [ ] **2. L'URL d'origine est une donnée du client.** Validée, bornée, et **jamais rendue telle quelle** dans un écran d'administration. Mutation : la rendre sans échappement doit rougir.
- [ ] **3. La route d'envoi déclare sa politique de débit.** Elle est `authenticated` : le répartiteur ne limite par dérivation que les routes **publiques**. Sans déclaration, elle n'est pas limitée **du tout**. Mutation : retirer la déclaration doit rougir en nommant la politique obtenue.
- [ ] **4. La notification aux superadmins**, par le repli existant. **Ne rien reconstruire** : une quatrième ligne du registre, et l'appel. Mutation : couper le module de notifications ne doit pas supprimer l'alerte, mais la faire partir par email.
- [ ] **5. Le déclencheur dans la coquille**, dérivé du registre — module coupé, il disparaît sans qu'aucun fichier ne nomme le module.
- [ ] **6. L'écran de back-office**, dans le cadre de `s37b2` : la garde **unique**, `Table`, filtres par catégorie et par statut **qui portent la sélection** — `s37c` vient de payer cette leçon, les composants partagés prennent un enregistrement de filtres. **404 et non 403**.
- [ ] **7. Marquer comme traité**, et le module coupé : aucune route, aucun déclencheur. `pnpm test:minimal-profile` le tient sans nommer le module.

## Ce que la story ne fait pas

Pas de panneau flottant, pas de composant livré dans `packages/ui`, pas de réponse à l'auteur, pas de fil de discussion. Elle ne requiert pas le module de notifications — c'est le critère 3 qui l'exige, et le repli est déjà écrit.

## Sections de `docs/security.md` touchées

**404 plutôt que 403** pour un non-superadmin. **Autorisation côté serveur avant toute lecture.** **Aucune donnée fournie par le client rendue exécutable** — l'URL d'origine est la surface, et c'est la tâche 2. Limitation de débit **déclarée**, jamais héritée.
