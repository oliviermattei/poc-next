# Research — Story s54-docs-recherche

> Vérifiée contre `feature/s30-docs-site` au commit `05720be`, **pas contre la branche par défaut** : s30 est prête, revue passée, mais **non fusionnée** faute de CI (blocage de compte). Tous les points d'ancrage ci-dessous sont donc à revérifier après la fusion de s30 — ils n'existent pas encore sur `dev`.

## Les cinq faits structurants

1. **Le dépôt n'a jamais croisé deux fichiers de contenu.** s29 et s30 valident chaque fichier **isolément** — frontmatter Zod, refus nommant le fichier fautif. Les cinq refus de s30 portent tous sur un fichier ou sur un dossier, jamais sur une **relation** entre deux pages. Les deux critères de cette story — la recherche plein texte et la validation des liens internes — demandent la **même passe croisée sur l'ensemble du contenu au build**, et c'est ce mécanisme qui est neuf. C'est la raison de la découpe.
2. **Le catalogue résolu est déjà la bonne entrée.** `resolveDocsCatalog` rend `{ pages, sections, index }` où chaque page porte `section`, `slug`, `title` et sa locale (`application/docs-catalog.ts`). Une passe croisée n'a donc **pas** à relire le disque : elle prend le catalogue, qui est déjà une valeur pure. Cela évite d'ajouter un second balayage divergent — le risque que la note de s31 nomme pour les pipelines MDX.
3. **La limitation de débit décide de l'architecture, pas la performance.** `routeIsRateLimited` (ADR 050) rend `true` pour **toute** route `public` sans qu'elle le déclare, et le répartiteur est fail-closed. Si la recherche passe par une route, elle est limitée à 120 requêtes/60 s par appelant — ce qui est raisonnable pour un formulaire, discutable pour une frappe au clavier. **Un index statique interrogé côté client échappe entièrement à la question**, et c'est un argument plus fort que le temps de réponse invoqué par la note de la story.
4. **Le module `docs` déclare `routes: []`.** S'il gagne une route de recherche, le balayage du profil minimal passe de 15 à 16 routes — mécanique connue depuis s53. S'il n'en gagne pas, le critère « module coupé, aucun écran de recherche » retombe sur l'entrée de navigation, déjà gardée en 404 HTTP par la garde de s29.
5. **`Command` est déclaré par le design system et absent de `packages/ui`.** `docs/design-system.md` le désigne comme « palette de recherche (back-office, documentation) ». s30 ne l'a **délibérément pas copié** — il appartient à cette story. Le copier de shadcn/ui est un geste connu : s29 l'a fait pour `Pagination`, s30 pour `Breadcrumb`. **Copier n'est pas inventer.**

## Target story

Cinq critères : recherche plein texte **sans service externe** · index construit **au build** et servi statiquement · un lien interne mort **fait échouer le build**, en nommant le fichier fautif **et la cible manquante** · la recherche respecte la locale servie · **module coupé** : aucun index, aucun écran, rien ne casse.

Dépendance déclarée : `s30-docs-site` — **prête mais non fusionnée**.

## Points d'ancrage (sur la branche de s30)

- `packages/modules/docs/src/application/docs-catalog.ts` — `resolveDocsCatalog`, `DocsCatalog`, `docsPagePath`. L'entrée de la passe croisée.
- `packages/modules/docs/src/domain/docs-page.ts` — `parseDocsPage`, ses sept causes de refus, et `documentHeadings` dont les ancres serviront à pointer un résultat de recherche à l'intérieur d'une page.
- `packages/modules/docs/src/infrastructure/docs-directory.ts` — le balayage, à ne pas dupliquer.
- `packages/core/src/module.ts` — `publicUrls` (quinzième clé) et `routes`.
- `docs/design-system.md` — `Command`, déclaré et non copié.

## Pièges & contraintes

- **Ne pas relire le disque une seconde fois.** Le catalogue est déjà résolu ; un second balayage divergerait du premier au premier changement de règle.
- **Le message d'un lien mort doit nommer les deux bouts** — le fichier fautif *et* la cible manquante. Le critère l'exige, et c'est ce qui distingue un refus utile d'un refus qui envoie chercher.
- **L'index est téléchargé par chaque visiteur.** Le critère ne fixe aucun plafond ; sans plafond mesuré, la promesse « sans service externe » se paie sur le réseau du lecteur. La note de la story le dit déjà.
- **Aucun `loading.tsx`** : mesuré en s29, la coquille est vidée avant que la page ne décide et un `notFound()` arrive en 200.
- **La recherche ne doit pas proposer une page qui n'existe pas dans la locale servie** — critère 4. Attention : s30 sert une page non traduite **avec une mention**, elle ne la cache pas. La recherche doit donc décider si une page repliée est « dans cette langue » ou non ; ce n'est pas le même arbitrage que pour le blog, qui **retire** un article non traduit.
- **Rien de privé dans l'index.** Il est servi publiquement : un index construit sur autre chose que le contenu de documentation exposerait ce qu'il indexe.

## Questions ouvertes

- **Quelle granularité pour l'index : la page, ou la section de page ?** Les ancres de s30 permettent de pointer à l'intérieur d'une page. Indexer par titre de section rend la recherche plus utile et l'index plus gros.
- **Quelle brique, et faut-il une brique ?** Le critère éliminatoire est « sans service externe ». Un index inversé écrit à la main sur trois pages est trivial ; il vieillit mal. Une bibliothèque cliente ajoute du poids. Non tranché, et le plan devra **mesurer** l'index plutôt que d'estimer.
- **La validation des liens couvre-t-elle les ancres ?** Un lien vers `#section-inexistante` est aussi mort qu'un lien vers une page absente, et s30 produit déjà la liste des ancres de chaque page. Le critère ne dit que « page inexistante ».
- **Un lien mort dans une seule locale fait-il échouer le build ?** Une page traduite peut lier une page qui n'existe qu'en français. Le repli de s30 la sert quand même — donc le lien est-il mort ?
- **La recherche est-elle une page, ou un composant sur chaque page ?** `Command` est une palette, ce qui suggère la seconde. Le critère « aucun écran de recherche » quand le module est coupé suggère la première. À trancher.

## Complexité réelle

Notée **3** dans `docs/stories.md`. **Ma note : 3, confirmée** — mais la répartition n'est pas celle qu'on croit.

La recherche elle-même est un index inversé sur un catalogue déjà résolu : quelques dizaines de lignes. Ce qui coûte est **la passe croisée** — le premier mécanisme du dépôt qui juge une relation entre deux fichiers plutôt qu'un fichier — et les **quatre questions ouvertes** ci-dessus, dont trois sont des décisions de produit (granularité, ancres, locales) que le plan devra trancher plutôt qu'implémenter au premier sens venu.

Pas de proposition de découpe : les deux critères partagent la passe croisée, et les séparer produirait deux stories qui la construisent chacune.
