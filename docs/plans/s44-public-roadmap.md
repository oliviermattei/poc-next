---
story: s44-public-roadmap
validated: yes
---

# Plan — s44-public-roadmap

> Planifié contre `dev` au commit `6dda2e3`, qui porte la recherche. **Dernière story du parcours.**

## La correction de cadrage, d'abord

La ressemblance avec le blog, la documentation et le changelog est **trompeuse**. Ces trois-là servent des fichiers MDX écrits par le propriétaire du produit ; une feuille de route sert des **propositions écrites par des utilisateurs**, avec des votes. Donc une table, une migration, des écritures authentifiées et de la modération.

**Les modèles sont les formulaires publics (`s11`) et le back-office (`s37b2`/`s37c`), pas le pipeline du changelog.** Ce qui reste emprunté à ce dernier est étroit et vaut d'être nommé : la contribution au plan de site — **une** adresse, la page, jamais une par proposition sous peine de publier des 404 — et l'entrée de pied de page dérivée du registre.

Et la validation de liens morts de `s54` **ne s'hérite pas et n'a aucun sens ici** : un refus au build ne peut rien sur une donnée créée après le build. Le dire pour l'écarter, afin que personne ne la réimplémente par mimétisme.

## Les trois invariants qui portent la story

**Le vote unique est une propriété du schéma.** L'unicité sur la paire `(proposition, votant)` rend le critère 2 vrai **sans lecture préalable** — la forme que `s11` a établie pour le doublon d'inscription, et que `s42` a réempruntée.

**Le compteur se dérive, il ne se stocke pas.** Un compteur dénormalisé qui diverge du nombre de lignes est un défaut silencieux, et rien ici ne justifie l'optimisation. C'est aussi ce qui rend le critère 3 — retirer un vote met à jour le compteur — trivial au lieu d'être piégeux.

**Le masquage préserve les votes**, le critère 5 l'exige nommément. Donc un drapeau, jamais une suppression, et la lecture publique **se dérive** de ce drapeau au lieu de le filtrer à l'affichage.

## Tâches

- [ ] **1. Le module, ses deux tables, sa migration.** Généré par l'API exportée (`npx ks scaffold` refuse un arbre sale, ADR 041). Les quinze clés, dont les **quatre RGPD remplies** : une proposition et un vote portent un auteur.
- [ ] **2. Les quatre statuts, vocabulaire fermé refusé à la compilation** — la forme que `s38` a établie pour les états d'affichage : un cinquième statut force une décision au lieu d'hériter du silence.
- [ ] **3. Un vote par personne et par proposition, par l'index.** Mutation : porter l'unicité sur la seule proposition, ou sur le seul votant, doit rougir contre un vrai PostgreSQL.
- [ ] **4. Le compteur dérivé**, et le retrait qui le met à jour sans écriture de compteur. Mutation : stocker un compteur et le laisser diverger doit rougir.
- [ ] **5. La page publique, en lecture pour tous.** Un visiteur anonyme **voit les compteurs et ne peut rien faire** : la page est publique, les écritures sont authentifiées. Deux niveaux de protection sur une même surface, et c'est le critère 4.
- [ ] **6. Proposer exige un compte vérifié.** Le piège est écrit dans la story : une page ouverte au vote est un vecteur de spam **au-delà du débit** — la limitation ralentit un abuseur, elle ne le distingue pas d'un utilisateur. Le compte vérifié, si. La route déclare **aussi** sa politique de débit (critère 6).
- [ ] **7. Le back-office : changer le statut, masquer.** Cadre de `s37b2`, garde **unique**, **404 et non 403**. Une proposition masquée disparaît du public **et ses votes restent**, mesuré en comptant après masquage.
- [ ] **8. Module coupé** : la page n'existe pas, **le lien disparaît du pied de page**, dérivé du registre sans qu'aucun fichier ne nomme le module — la forme de `s31`. `pnpm test:minimal-profile` le tient.

## Ce que la story ne fait pas

**Pas de fusion de propositions** — retirée explicitement du périmètre par la story : le report des votes sans doublon de votant est un piège coûteux pour un module d'appoint. Pas de commentaires, pas de notification aux votants, pas de tri par popularité configurable.

## La question ouverte de la recherche, et sa réponse

**Le vote d'un compte supprimé** : la purge **efface** le vote. L'anonymiser reviendrait à garder une ligne dont plus personne ne peut demander l'effacement, ce que `s34` refuse ; et le compteur d'une proposition n'est pas un droit acquis de son auteur. Écrire la décision là où la purge est déclarée.

## Sections de `docs/security.md` touchées

**404 plutôt que 403** pour un non-superadmin. **Autorisation côté serveur** avant toute écriture. **Limitation de débit déclarée** sur la route publique de proposition. **Aucun texte d'utilisateur rendu exécutable** : les propositions viennent d'inconnus et s'affichent sur une page publique.
