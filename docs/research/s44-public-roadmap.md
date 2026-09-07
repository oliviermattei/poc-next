# Research — Story s44-public-roadmap

> Vérifiée contre la branche par défaut au commit `d07f9ef`, en lecture seule.

## Une correction d'abord : ce n'est pas un module de contenu

La ressemblance avec le blog, la documentation et le changelog est **trompeuse**. Ces trois-là servent des fichiers MDX écrits par le propriétaire du produit. Une feuille de route publique sert des **propositions écrites par des utilisateurs**, avec des votes : donc une table, une migration, des écritures authentifiées, et une modération. Le pipeline du changelog n'est **pas** son modèle ; ce sont les formulaires publics (`s11`) et le back-office (`s37b2`/`s37c`) qui le sont.

Ce qui reste emprunté au changelog est plus étroit et vaut d'être nommé : la contribution au plan de site (`publicUrls`, ADR 054, **une** adresse — la page, jamais une par proposition, sous peine de publier des 404), et l'entrée de pied de page dérivée du registre (ADR 066/067).

## Les cinq faits structurants

1. **La validation de liens morts de `s54` ne s'hérite pas** — elle est privée au module de documentation, ni exportée ni dans `@repo/core`. Une feuille de route n'en a de toute façon pas besoin : ses textes viennent d'utilisateurs, pas d'auteurs, et le refus au build n'a aucun sens sur une donnée créée après le build. **Le mentionner pour l'écarter** évite qu'on la réimplémente par mimétisme.

2. **`content/**` est désormais dans les dépendances globales de Turbo** (`8aa5fe8`, hier) — sans effet ici, puisque cette story n'écrit aucun contenu, mais utile à savoir pour ne pas croire qu'un cache expliquerait un comportement.

3. **Le vote unique est une propriété du schéma, pas une branche.** L'unicité sur la paire `(proposition, votant)` est ce qui rend le critère 2 vrai sans lecture préalable — la même forme que l'index de `s11` qui rend le doublon d'inscription inoffensif.

4. **Le masquage doit préserver les votes.** Le critère 5 l'exige nommément : une proposition masquée disparaît de la page publique **sans que ses votes soient supprimés**. Donc un drapeau, jamais une suppression — et la lecture publique se dérive de ce drapeau plutôt que de le filtrer à l'affichage.

5. **Le piège est écrit dans la story elle-même** : « exiger un compte vérifié pour proposer ». Une page publique ouverte au vote est un vecteur de spam **au-delà du débit** — la limitation ralentit un abuseur, elle ne le distingue pas d'un utilisateur. Le compte vérifié, si.

## Points d'ancrage

- `packages/modules/marketing/src/presentation/public-form-routes.ts` — la forme d'une route publique qui déclare sa politique de débit.
- `packages/modules/admin/src/presentation/back-office-screens.tsx` — le cadre, la garde unique, les filtres qui portent la sélection.
- `packages/modules/changelog/src/infrastructure/changelog-content.ts` — la contribution au plan de site, **une seule adresse**.
- `apps/web/lib/footer.ts` — le pied de page dérivé du registre, aucun module nommé.
- `packages/modules/marketing/src/schema.ts` — le précédent d'une table publique sans clé étrangère vers les comptes, et sa raison.

## Pièges & contraintes

- **Une proposition et un vote portent un auteur** : quatre clés RGPD à remplir, et les commandes de `s34`/`s35` les mesurent.
- **Le compteur de votes se dérive**, il ne se stocke pas : un compteur dénormalisé qui diverge du nombre de lignes est un défaut silencieux, et rien ici ne justifie l'optimisation.
- **Un visiteur anonyme voit les compteurs et ne peut rien faire** (critère 4) : la page est publique, les écritures sont authentifiées. Deux niveaux de protection sur une même surface.
- **Retirer un vote met à jour le compteur** (critère 3) — trivial si le compteur est dérivé, piégeux s'il est stocké.
- **La fusion de propositions est hors périmètre**, retirée explicitement par la story.

## Questions ouvertes

- **Les quatre statuts sont-ils un vocabulaire fermé du domaine ?** Le critère 1 les nomme. Une énumération fermée, refusée à la compilation, est la forme que `s38` a établie pour les états d'affichage.
- **La proposition est-elle modérée avant publication, ou publiée puis masquable ?** Le critère 5 dit « masquer », donc publiée puis masquable — à écrire, parce que l'inverse est une décision d'exploitation lourde.
- **Le vote d'un compte supprimé** : la purge efface-t-elle le vote, ou l'anonymise-t-elle ? Effacer change le compteur d'une proposition qui n'appartient pas au partant.

## Complexité réelle

Notée **3** dans `docs/stories.md`. **Ma note : 3.** Deux tables, un vote unique par index, un drapeau de masquage, une page publique en lecture, deux écritures authentifiées, un écran de back-office dans un cadre existant. Rien de neuf mécaniquement — mais **six critères** dont deux portent sur la modération, et le piège du compte vérifié qui ne se voit pas dans le code.
