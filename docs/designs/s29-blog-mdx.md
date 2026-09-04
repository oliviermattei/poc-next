# Design — Story s29-blog-mdx

> Dérivé de `docs/design-system.md`. Aucun composant, jeton, couleur ou espacement n'est inventé ici : ce qui manque est signalé au bas de ce fichier, pas comblé.

## Écrans

Deux, et seulement deux. La story n'en demande pas d'autre.

### 1. La liste — `/blog`

Page publique, hors coquille applicative : elle appartient au site marketing (s10), donc pied de page marketing et pas de `Sidebar`.

```
PageHeader        h1 « Blog » + description (body-lg)
─────────────────────────────────────────────────
Filtres           rangée de Badge, une par tag + un « Tous »
                  le tag actif se distingue par sa variante, pas par une couleur nouvelle
─────────────────────────────────────────────────
Grille            Card × N — 1 colonne en mobile, 2 à partir de md, 3 à partir de lg
                    ├ h3   titre de l'article
                    ├ body description (frontmatter), 2 lignes maximum
                    ├ small date + auteur
                    └ Badge × tags
─────────────────────────────────────────────────
Pagination        composant autonome, centré
```

Le rythme vertical suit celui des sections marketing du système : `py-16` en mobile, `py-24` au-delà.

### 2. L'article — `/blog/<slug>`

```
Fil de retour     Button variant="ghost" « ← Blog »
─────────────────────────────────────────────────
En-tête           h1 titre
                  body-lg description
                  small date · auteur (Avatar + nom) · Badge × tags
─────────────────────────────────────────────────
Separator
─────────────────────────────────────────────────
Corps             le MDX rendu — voir « Manques » : c'est la seule
                  zone que le système ne couvre pas
─────────────────────────────────────────────────
Separator
─────────────────────────────────────────────────
Pied              Button variant="outline" « ← Tous les articles »
```

Largeur de lecture bornée (le système ne fixe pas de mesure ; à trancher au plan avec le rythme marketing existant). Typographie du corps : `body-lg`, celle que le système réserve « aux pages marketing et à la documentation ».

## Maquette

`docs/designs/s29-blog-mdx.html` — référence visuelle, dans les deux thèmes. **Ne pas copier en production** : l'exécution construit avec les vrais composants de `packages/ui`.

## Composants réutilisés (du design system)

- `PageHeader` — titre et description de la liste. C'est son usage déclaré, « en tête de chaque page applicative ».
- `Card` — une par article dans la grille. « Bloc de contenu », l'unité que le système désigne.
- `Badge` — les tags, dans la grille comme dans l'en-tête d'article. Le système le décrit pour « un état court : rôle, statut d'abonnement, **catégorie** » : un tag est une catégorie.
- `Pagination` — « pagination autonome, hors tableau », exactement le cas d'une grille de cartes.
- `EmptyState` — aucun article, ou aucun article pour le tag choisi.
- `Separator` — encadrement du corps de l'article.
- `Avatar` — l'auteur, avec repli sur les initiales, comme le système le prévoit.
- `Button` (`ghost`, `outline`) — retours vers la liste.
- ~~`Skeleton` — état de chargement de la grille.~~ **Non livré** : voir « États » ci-dessous.

Aucun `Table` ni `DataTable` : la story demande une liste d'articles, pas un tableau de données, et `Pagination` existe précisément pour ce cas.

## États

| État | Liste | Article |
|---|---|---|
| **Vide** | `EmptyState` — « Aucun article pour l'instant » ; avec un tag actif : « Aucun article dans ce tag », action « Voir tous les articles » | sans objet : un article inexistant est un **404**, pas un état vide |
| **Chargement** | ~~`Skeleton` aux dimensions des cartes, même grille~~ — **non livré, voir ci-dessous** | ~~idem sur l'en-tête et les premiers paragraphes~~ — idem |
| **Erreur** | `Alert` — le système la décrit comme « message contextuel persistant, porté par une sémantique ». Voir le manque n°3 sur la lisibilité de ses variantes | idem |
| **Succès** | la grille peuplée | l'article rendu |

**L'état « Chargement » n'a pas été livré, et la raison est mesurée** (constat F3 de la revue). Un squelette suppose une frontière `Suspense`, donc un `loading.tsx`, et celui-ci fait **flusher la coquille de la page avant qu'elle n'ait décidé** : le statut HTTP est déjà écrit quand `notFound()` arrive.

La raison n'est **pas** que la frontière d'un segment couvrirait ses enfants — c'était la première formulation, et elle est fausse : un groupe de routes (`app/blog/(index)/`) ne couvre que la liste, le repli y est réellement engagé, et `/blog/<slug inconnu>` garde son 404. La raison est que **la liste est elle-même un écran qui refuse** : module `blog` coupé, `/blog` doit répondre 404, et un repli au-dessus d'elle lui fait servir **200 avec la coquille**. Mesuré sur `next dev` le 4 septembre 2026, aux trois placements — aucun (200 / 404 / 404), `app/blog/` (200 / **200** / 200), `app/blog/(index)/` (200 / 404 / **200**) ; le tableau complet est dans `apps/web/AGENTS.md`, § « Le montage du blog ».

Le 404 est un critère de la story et une règle du socle de sécurité ; l'état de chargement est du confort. Le manque est reporté dans `docs/design-system.md` (§ États) — **s30 et s31 hériteront de la même contrainte** sur tout écran dont l'existence est décidée dans le corps de la page. Deux commandes la tiennent, une par configuration de modules : `e2e/blog.spec.ts:132` module activé, et le cas « l'écran d'une entrée de navigation coupée répond 404 sur HTTP » de `pnpm test:minimal-profile` module coupé.

Le critère i18n de la story a une conséquence visible qui n'est pas un état d'erreur : **un article sans traduction dans la locale courante n'apparaît pas dans cette locale**. La liste est donc simplement plus courte, et l'`EmptyState` doit pouvoir être atteint par ce chemin sans que l'utilisateur croie à une panne.

## Manques du design system

À trancher, **pas à inventer ici**.

1. **La prose rendue.** Le système déclare huit rôles typographiques pour l'interface. Aucun ne décrit un **corps d'article long** : titres internes, paragraphes enchaînés, listes, citations, images, liens dans le texte. Seul `mono` anticipe les blocs de code, « pour la documentation (s30) et le changelog (s31) » — donc le besoin de contenu long était pressenti, sans que l'échelle soit posée. C'est le manque principal, et il concerne **trois stories**, pas une : s29, s30 et s31 rendront toutes du MDX. Le trancher ici sert les trois.
2. **L'image Open Graph par défaut.** Le critère 4 en exige une quand l'article n'en fournit pas. Le système ne dit rien d'un gabarit d'image sociale — ni dimensions, ni composition, ni jetons applicables à une image générée. À décider au plan : image statique unique, ou gabarit dérivé des jetons.
3. **Un `Badge` cliquable est un contrôle, pas un état.** Le système décrit `Badge` comme un **état court**. Les filtres par tag lui demandent d'être **actionnables**, avec un état actif distinct. Le système n'a pas de « puce de filtre ». Deux voies : accepter un `Badge` dans un lien et ne rien ajouter, ou reconnaître le besoin. La première ne coûte rien et n'invente rien ; c'est celle que la maquette montre.
   **Et une contrainte de lisibilité pèse sur ce choix** : `s49-contraste-des-alertes` a mesuré que les quatre variantes sémantiques sont sous le seuil WCAG AA en mode clair. Un tag actif ne doit donc pas se distinguer par une **couleur sémantique** tant que s49 n'a pas tranché.
4. **La largeur de lecture.** Le système fixe un rythme vertical marketing (`py-16` / `py-24`) mais aucune mesure de ligne pour du texte long. À poser au plan.

Aucun de ces quatre manques ne bloque l'implémentation de la liste ; le premier bloque le rendu de l'article, et c'est le seul qui doit être tranché avant l'exécution.
