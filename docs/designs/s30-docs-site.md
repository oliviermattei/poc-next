# Design — Story s30-docs-site

> Dérivé de `docs/design-system.md`. Rien n'est inventé ici : ce qui manque est signalé au bas du fichier.
> Story découpée le 05/09 — la recherche plein texte et la validation des liens au build sont parties en `s54-docs-recherche`. **Aucun écran de recherche n'est dessiné ici.**

## Écrans

Un seul écran, décliné. La documentation n'a pas de « liste » au sens du blog : l'arborescence **est** la navigation.

### La page de documentation — `/docs/<section>/<page>`

```
┌──────────────┬──────────────────────────────────┬────────────┐
│ Navigation   │ Breadcrumb                       │ Sommaire   │
│ latérale     │ ─────────────────────────────    │            │
│              │ h1 titre de la page              │ ▸ Titre 1  │
│ ▾ Section A  │                                   │   ▸ Sous   │
│   • page 1   │ corps de la prose                │ ▸ Titre 2  │
│   • page 2 ← │                                   │            │
│ ▸ Section B  │                                   │ (ancres)   │
│              │                                   │            │
└──────────────┴──────────────────────────────────┴────────────┘
```

- **Trois colonnes au-delà de `lg`.** En dessous : le sommaire passe **au-dessus** du corps, replié ; la navigation latérale entre dans un `Sheet` déclenché par un bouton — c'est le composant que le système désigne pour une surface flottante latérale, et `Sidebar` est réservée au tableau de bord.
- **La navigation est dérivée de l'arborescence**, sections et pages ; la page courante est marquée par `aria-current`, **pas par une couleur sémantique** (s49 a mesuré les quatre variantes sous le seuil WCAG AA en clair).
- **Le fil d'Ariane** porte section puis page. Le système le désigne pour « le back-office et la documentation ».
- **Le sommaire** liste les titres de la page avec une ancre par section, la position courante marquée par `aria-current`.
- **Le corps** emploie l'échelle de prose posée par s29 — voir le manque n°1 : d'où elle est importée est la décision de la story, pas du design.

## Maquette

`docs/designs/s30-docs-site.html` — référence visuelle, deux thèmes, trois largeurs. **Ne pas copier en production.**

## Composants réutilisés (du design system)

- `Breadcrumb` — fil d'Ariane. **Déclaré par le système, absent de `packages/ui`** : à copier depuis shadcn/ui, comme s29 l'a fait pour `Pagination`. Copier n'est pas inventer.
- `Sheet` — la navigation latérale en petit écran. Existe.
- `Accordion` — les sections repliables de la navigation. Existe.
- `Separator`, `Button` (`ghost`) — existent.
- `EmptyState` — aucune page de documentation.
- `Alert` — la mention d'une page non traduite. Voir le manque n°3 sur sa lisibilité.

**Pas de `Command`** : c'est la palette de recherche, elle appartient à s54. **Pas de `ScrollArea`** : le système la déclare, mais une navigation de documentation tient dans le flux normal tant qu'elle n'est pas immense — l'ajouter « pour plus tard » livrerait du code que personne n'exerce, ce que `packages/ui/AGENTS.md` refuse explicitement.

## États

| État | Ce qu'il montre |
|---|---|
| **Vide** | `EmptyState` — aucune page publiée. La navigation latérale est alors absente, pas vide. |
| **Chargement** | **Aucun.** Voir la contrainte ci-dessous : c'est une décision, pas un oubli. |
| **Erreur** | `Alert`. Une page inexistante est un **404**, pas une erreur. |
| **Succès** | La page rendue, navigation et sommaire alimentés. |
| **Non traduite** | La page dans la locale par défaut, précédée d'une **mention explicite** — c'est un état à part entière, et le seul que le blog n'a pas : un article sans traduction *disparaît*, une page de documentation *se sert quand même*. |

**Contrainte héritée de s29, mesurée et non négociable** : poser un `loading.tsx` sur un segment fait vider la coquille **avant** que la page ne décide, si bien qu'un `notFound()` arrive en **HTTP 200**. Le 404 est une règle du socle de sécurité. La documentation n'aura donc **pas** d'état de chargement, pour la même raison que le blog n'en a pas — et `docs/design-system.md` § États le dit déjà de façon générale.

## Manques du design system

1. **D'où vient l'échelle de prose.** Elle vit dans `@repo/module-blog/presentation` (`PROSE_CLASSNAME`, `proseComponents`). L'importer ici exigerait `requires: ['blog']` sur la documentation (ADR 018) — absurde en produit. Ce n'est pas un manque de *tokens* mais un manque de **place** : le système décrit l'échelle, le dépôt l'héberge dans un module optionnel. **Décision structurelle de la story, à porter par un ADR.**
2. **Aucun composant de sommaire.** Le système n'a rien pour une liste d'ancres suivant le défilement. Composable avec ce qui existe (une liste, `aria-current`), donc à composer — mais à signaler, puisque s31 en aura peut-être besoin aussi.
3. **La mention « page non traduite » n'a pas de variante lisible.** `Alert` existe, mais s49 a mesuré ses quatre variantes **sous le seuil WCAG AA en mode clair** — `warning` à 1,83 : 1. Tant que s49 n'a pas tranché, la mention ne doit pas reposer sur la couleur seule.
4. **Aucun gabarit de mise en page à trois colonnes.** Le système fixe un rythme vertical marketing et une densité, pas de grille documentaire. À composer avec l'échelle d'espacement, et à signaler.

   **Ce que la composition a donné, mesuré au navigateur** (Chromium, page `prise-en-main/installer`, largeur de l'`<article>` du corps) : **358 px à 390**, **464 px à 768**, **448 px à 1440**. Le corps est donc **plus étroit sur l'écran le plus large** — la coquille de l'application borne à `max-w-4xl` (896 px, `apps/web/app/app-shell.tsx`), et la grille documentaire y prend 13 rem de navigation, 11 rem de sommaire et deux gouttières de 2 rem. Conséquence à porter, parce qu'elle ne se voit dans aucun fichier : `PROSE_CLASSNAME` porte la mesure de ligne du design system (`max-w-2xl`, 672 px) et **cette borne n'est jamais atteinte sur une page de documentation** — elle est inerte ici, la largeur est décidée par la coquille. Le résultat est jugé lisible et livré tel quel ; élargir la coquille est un choix de design system, hors du périmètre de cette story.

Aucun de ces quatre manques n'a bloqué l'implémentation ; le premier était une décision à prendre avant d'écrire une ligne, et ADR 055 l'a tranchée.
