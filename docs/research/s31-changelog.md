# Research — Story s31-changelog

> Vérifiée contre la branche par défaut au commit `445d969`, en lecture seule.
> Aucune base, aucun conteneur, aucun worktree.

## Les cinq faits structurants

1. **Le pied de page marketing connaît les modules par leur nom, dans trois fichiers.** `apps/web/app/page.tsx:97`, `apps/web/app/contact/page.tsx:57` et `apps/web/app/legal/[document]/page.tsx:88` passent tous `footerLinks={consentFooterLinks(t)}` — un import nommé du module `consent`. Le critère 5 (« le lien disparaît du pied de page ») en ferait un **quatrième import nommé, aux trois mêmes endroits**. C'est le problème que **s53 vient de résoudre pour `sitemap.xml` et `robots.txt`**, une couche plus haut : `MarketingFooter` reçoit `extraLinks` en **prop optionnelle**, pas par le contrat.
2. **Le constructeur de flux appartient au blog.** `renderBlogFeed` est exporté par `@repo/module-blog` (`domain/feed.ts`), avec `blogFeedPath`. Le réutiliser exigerait `requires: ['blog']` sur le changelog — un produit où couper le blog casserait les nouveautés. **C'est le même piège que l'échelle de prose**, que s30 résout en la montant dans `packages/ui` (ADR 055, en cours).
3. **Un motif se dessine, et il vaut mieux le nommer que de le repayer trois fois.** s29 a construit **dans le module blog** trois choses qui se révèlent être de l'infrastructure partagée : l'échelle de prose (montée dans `packages/ui` par s30), le constructeur de flux (que s31 réclame), et le balayage d'un dossier de contenu par locale (`content-directory.ts`, que s30 réclame déjà). Ce n'est pas un reproche à s29 — elle était la première, et rien ne dit à la première qu'elle est une fondation. C'est un fait à écrire pour que la **troisième** ne redécouvre pas la question.
4. **Le tri sémantique est le seul piège algorithmique**, et la story le nomme : `10.0` vient après `9.0`, pas avant. Un `Array.sort()` lexicographique passerait tous les tests d'une fixture à un chiffre et casserait à la dixième version. **Une fixture doit franchir le passage à deux chiffres**, sinon la mutation qui retire le tri sémantique reste verte — c'est exactement le mode d'échec que s29 a rencontré sur son tri par date.
5. **Le critère « flux valide » est le même que celui que s53 a livré non tenu.** Le dépôt n'embarque **aucun validateur** : il embarque `@rowanmanning/feed-parser`, un **analyseur** dont la revue de s53 a mesuré la complaisance (il accepte un canal sans titre, ni lien, ni description). Écrire « valide » ici répéterait la formulation que s53 a dû corriger en quatre endroits. Soit la story embarque un validateur — décision non prise —, soit elle écrit « analysé » et le dit.

## Target story

Cinq critères : entrée MDX avec version, date et catégorie, **frontmatter invalide faisant échouer le build** · ordre chronologique inverse, **groupé par version** · flux RSS · entrées traduisibles et référencées dans `sitemap.xml` · **module non activé** : pas de page, pas de flux, et **le lien disparaît du pied de page**.

Dépendance déclarée : `s29-blog-mdx` — fusionnée. Dépendances **réelles non déclarées** : `s53-blog-syndication` (la quinzième clé, pour le plan de site) et, selon la voie retenue au fait 2, `s30-docs-site` (si le constructeur de flux monte au même endroit que l'échelle de prose).

## Points d'ancrage

- `apps/web/app/page.tsx:97`, `contact/page.tsx:57`, `legal/[document]/page.tsx:88` — les trois appels de `consentFooterLinks`.
- `packages/modules/marketing/src/presentation/marketing-footer.tsx` — `extraLinks`, la prop qui reçoit les liens.
- `packages/modules/blog/src/domain/feed.ts` — `renderBlogFeed`, et `escapeXml` dont la revue de s53 a vérifié qu'il couvre les cinq entités.
- `packages/modules/blog/src/infrastructure/content-directory.ts` — le balayage par locale, et son commentaire sur le départage à dates égales.
- `packages/core/src/module.ts` — les **quinze** clés depuis s53, `publicUrls` comprise.

## Pièges & contraintes

- **Ne pas créer un troisième pipeline MDX.** La note de la story le dit, et c'est le risque principal de cette famille : trois pipelines divergents.
- **Aucun `loading.tsx`.** Mesuré en s29 : la coquille est vidée avant que la page ne décide, un `notFound()` arrive en 200, et le 404 est une règle du socle de sécurité.
- **Le flux est une route du module**, sinon « module coupé, aucun flux » demande une condition au lieu d'une dérivation. s53 l'a fait pour le blog : le profil minimal balaie désormais 15 routes au lieu de 14.
- **`publicUrls` suffit pour le plan de site** : ni `sitemap.ts` ni `robots.ts` ne doivent être touchés. C'est tout l'acquis de s53.
- **La catégorie du frontmatter est une énumération ou une chaîne libre ?** Non dit. Une chaîne libre rend le groupement instable ; une énumération fermée demande de savoir laquelle.

## Questions ouvertes

- **Où vit le constructeur de flux ?** `@repo/core` est où s53 a mis `robotsPolicy` et `sitemapEntries` — de l'infrastructure de syndication, exactement la même famille. `packages/ui` serait faux : ce n'est pas de la présentation. À trancher au plan, avec ADR, **et en cohérence avec ADR 055** si celui-ci est fusionné d'ici là.
- **Le lien de pied de page : nommé ou dérivé ?** Le dériver demanderait un mécanisme que le contrat n'a pas — les entrées de `navigation` alimentent la barre latérale, pas le pied de page marketing. Trois voies : un quatrième import nommé (honnête mais qui ne passe pas l'échelle), une seizième clé (chère, et une par surface est un mauvais chemin), ou **réutiliser `navigation` en distinguant la surface**. La troisième est la seule qui ne coûte pas une clé par endroit.
- **Le flux du changelog est-il séparé de celui du blog, ou fusionné ?** Cinq critères disent « un flux des nouveautés » ; rien ne dit s'il coexiste avec celui du blog à une autre adresse. Probablement oui, mais à écrire.
- **« Valide » ou « analysé » ?** Voir le fait 5. La story hérite d'un critère que s53 n'a pas pu tenir.
- **Les versions sont-elles déclarées ou dérivées ?** Le frontmatter porte une version par entrée ; le groupement suppose que deux entrées de même version se rejoignent. Que fait-on d'une version présente dans une locale et pas dans l'autre ?

## Complexité réelle

Notée **2** dans `docs/stories.md`. **Ma note : 3.**

Le rendu et le tri sont simples. Ce qui coûte est ailleurs, et c'est structurel : **deux décisions d'emplacement** (le constructeur de flux, le lien de pied de page) dont la seconde n'a pas de mécanisme dans le contrat aujourd'hui. La note de 2 suppose que tout se réutilise ; le fait 2 montre que la réutilisation passe par un déplacement.

Pas de proposition de découpe : la story tient en huit tâches, et la ligne « ce qu'on lit / ce qui le fait trouver » qui a coupé s29 et s30 ne s'applique pas ici — le flux et le plan de site sont bon marché maintenant que s53 a posé la clé.
