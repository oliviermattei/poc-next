# Research — Story s30-docs-site

> Vérifiée contre la branche par défaut au commit `d71f2cb`, en lecture seule.
> Aucune base, aucun conteneur, aucun worktree.

## Les cinq faits structurants

1. **Le pipeline MDX existe, et il est réutilisable — mais pas le module.** s29 a livré `@next/mdx` + `@mdx-js/loader` + `remark-frontmatter` câblés dans `next.config.ts`, et **ADR 053** en fixe la contrainte : compilation **au build**, parce que la CSP de production n'accorde pas `'unsafe-eval'` et que `dangerouslySetInnerHTML` est refusé par précédent écrit. s30 hérite de la contrainte sans avoir à la retrancher.
2. **Ce que s29 expose et qui sert directement** : `PROSE_CLASSNAME` et `proseComponents` (`@repo/module-blog/presentation`), c'est-à-dire **l'échelle de prose** posée dans `docs/design-system.md` — onze entrées dérivées des huit rôles existants. Le corps d'une page de documentation est le même objet typographique que le corps d'un article. Le réutiliser évite une seconde typographie ; l'importer depuis `module-blog` créerait en revanche une dépendance entre deux modules optionnels, ce que le contrat n'autorise que par un `requires` déclaré (ADR 018). **C'est la question ouverte n°1.**
3. **Le critère i18n de s30 est l'inverse de celui de s29.** Le blog : un article sans traduction **n'apparaît pas** dans cette locale. La documentation : une page non traduite **retombe sur la locale par défaut avec une mention explicite**. Le comportement est donc à écrire, pas à copier — et il est le bon choix, une documentation absente valant moins qu'une documentation dans la mauvaise langue.
4. **Deux critères demandent une vérification au build que le dépôt n'a jamais faite.** « Un lien interne pointant vers une page inexistante fait échouer le build » et « la recherche plein texte fonctionne sans service externe » supposent tous deux une **passe sur l'ensemble du contenu au build** : résolution des liens, construction d'un index. s29 valide chaque fichier isolément (frontmatter Zod, refus nommant le fichier) mais ne croise jamais deux fichiers.
5. **s30 sera le premier consommateur de la quinzième clé**, que `s53-blog-syndication` est en train d'ajouter au contrat pour porter les URL de contenu vers `sitemap.xml`. Le critère 6 de s30 en dépend directement : si la clé est bien une **fonction** rendant des URL, s30 n'a qu'à la déclarer. **Ne pas démarrer s30 avant que s53 soit fusionnée** — sinon la story réinvente le mécanisme ou le contourne.

## Target story

Sept critères : pages MDX organisées en sections, **navigation latérale générée depuis l'arborescence** · recherche plein texte **sans service externe** · sommaire des titres et ancre par section · **un lien interne mort fait échouer le build** · traduisible, repli sur la locale par défaut **avec mention** · pages référencées dans `sitemap.xml` · **module non activé** : aucune route, le lien disparaît de la navigation publique.

Dépendance déclarée : `s29-blog-mdx` — fusionnée. Dépendance **réelle non déclarée** : `s53-blog-syndication`, pour le critère 6.

## Points d'ancrage

- `apps/web/next.config.ts` — `withMDX(withNextIntl(nextConfig))`, déjà en place.
- `packages/modules/blog/src/presentation/prose.tsx` — `PROSE_CLASSNAME`, `proseComponents`.
- `packages/modules/blog/src/infrastructure/content-directory.ts` — le balayage d'un dossier de contenu par locale, et son commentaire sur le départage à dates égales.
- `packages/modules/blog/src/domain/article.ts` — le refus de frontmatter qui **nomme le fichier fautif**, motif à reprendre.
- `docs/design-system.md` § prose et § États — l'échelle, et la note sur l'état de chargement inatteignable.
- `packages/core/src/module.ts` — le contrat, quinzième clé comprise après s53.

## Pièges & contraintes

- **Un `loading.tsx` transforme un `notFound()` en HTTP 200.** Mesuré en s29 sur trois placements : la coquille est vidée avant que la page ne décide. Une page de documentation inexistante doit rendre 404, et le 404 est une règle du socle de sécurité. **La garde existe déjà** — `e2e/minimal-profile/minimal-profile.spec.ts` exige que toute adresse de navigation d'un module coupé réponde 404 sur une requête HTTP réelle — mais elle ne couvre que les entrées de navigation, pas une page profonde inexistante.
- **L'index de recherche doit être construit au build**, dit la note de la story. Servi à la requête, la promesse « sans service externe » se paie en temps de réponse ; et un index construit au build hérite du piège que `sitemap.ts` documente — `getEnv()` ne valide rien pendant `next build`.
- **La recherche est une surface d'entrée publique.** Si elle passe par une route, `docs/security.md` impose la limitation de débit sur tout point d'entrée public servi par le répartiteur (s28, ADR 050). Un index statique interrogé côté client l'évite entièrement — argument de plus pour le build.
- **Ne pas inventer de composant.** `Breadcrumb` et `Command` (palette de recherche) sont **déjà déclarés** dans `docs/design-system.md` pour la documentation, sans exister dans `packages/ui` — même situation que `Pagination` avant s29, qui l'a implémenté sans l'inventer.
- **Le tableau de `packages/ui/AGENTS.md` a dérivé trois fois** (constats de la revue de s29 : `Avatar` mal rangé, `InlineStyleNonce` absent, `Pagination` corrigé après coup) et **aucune commande ne le confronte au baril**. Une story qui y ajoute des composants doit s'attendre à le trouver faux.

## Questions ouvertes

- **Où vit l'échelle de prose, maintenant que deux modules en ont besoin ?** L'importer de `module-blog` demande un `requires: ['blog']` (ADR 018), ce qui lierait la documentation au blog — absurde en produit. La remonter dans `packages/ui` est le geste évident, mais c'est un déplacement de code livré par une autre story. À trancher au plan, avec ADR.
- **La navigation latérale « générée depuis l'arborescence » : au build ou à la requête ?** Le critère ne le dit pas. Au build, elle est figée et gratuite ; à la requête, elle suit un dépôt de contenu vivant.
- **La recherche plein texte : quelle brique, et quel index ?** Non tranché. Le critère éliminatoire est « sans service externe » ; le second est la taille de l'index servi au client.
- **Une page non traduite « retombe avec une mention explicite » : quelle mention, et où ?** Un bandeau, une ligne sous le titre, un `Alert` ? `docs/design-system.md` a un `Alert`, mais s49 a mesuré ses quatre variantes sous le seuil WCAG AA en mode clair — donc **pas de couleur sémantique** tant que s49 n'a pas tranché.
- **Le critère 6 dépend de s53.** Si s53 n'est pas fusionnée au moment de planifier, la question devient : attendre, ou livrer sans le plan de site et rouvrir. Attendre est presque toujours meilleur.

## Complexité réelle

Notée **3** dans `docs/stories.md`. **Ma note : 4.**

Le rendu MDX est acquis, et c'est ce qui justifiait le 3. Mais trois critères sur sept demandent des mécanismes que le dépôt n'a jamais construits — une passe de validation croisée des liens au build, un index de recherche, une navigation dérivée d'une arborescence — et un quatrième force une décision d'architecture (où vit l'échelle de prose) qui touche du code livré par une autre story.

Pas de proposition de découpe ferme, mais une ligne existe si le plan dépasse dix tâches : **lire la documentation** (pages, navigation, sommaire, i18n, module coupé) d'un côté, **la trouver** (recherche plein texte, liens vérifiés au build, plan de site) de l'autre. C'est la même ligne que celle qui a coupé s29 de s53, et elle a bien tenu.
