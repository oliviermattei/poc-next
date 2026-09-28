# Design — Story s62a-reglages-deplacement

> Généré par l'agent (déroulé des stories délégué par le porteur, 28/09), à partir de `docs/design-system.md` et des composants exportés par `packages/ui` (vérifiés en research : `SidebarNav`, `SidebarItem`, `PageHeader`, `Separator`, `Sheet*` ; **`Tabs` absent**). Un seul élément nouveau : le cadre de la zone Réglages. Les trois écrans sont déplacés **tels quels** (s62b les redécoupe).

## Screen(s)

### Cadre de la zone Réglages — `app/(app)/app/settings/layout.tsx`
Rendu **dans** le gabarit Application (l'`AppShell` fournit barre latérale du produit et barre du haut).

- **En tête** : `PageHeader` titre « Réglages », sans description.
- **Deux colonnes à partir de `md`** (`grid md:grid-cols-[12rem_1fr] gap-6`) :
  - à gauche, la **sous-navigation** : `SidebarNav` avec les entrées de surface `settings` dérivées du registre (Compte, Organisation, Facturation — chacune disparaît avec son module), l'entrée courante marquée par `aria-current="page"` (règle déjà portée par `SidebarNav`, comparaison sur le chemin interne **par préfixe**, pour que les sous-pages futures gardent leur rubrique) ;
  - à droite, le contenu de l'écran déplacé, inchangé.
- **Sous `md`** : la sous-navigation passe **au-dessus** du contenu, en liste verticale compacte (même `SidebarNav`), séparée par un `Separator`. Pas de `Sheet` : trois à six entrées tiennent sans masquer.
- **Barre latérale du produit** : ne porte plus Compte, Organisations, Facturation ; le menu de compte (« Réglages ») mène à `/app/settings/account`.

## Mockup
docs/designs/s62a-reglages-deplacement.html — visual reference. DO NOT copy into production: Execute builds with the real components.

## Reused components (from the design system)
- `PageHeader` — titre de la zone.
- `SidebarNav` (+ `SidebarItem`) — sous-navigation ; c'est le même composant que la barre latérale, à une autre place.
- `Separator` — séparation sous `md`.
- Les écrans déplacés gardent leurs composants actuels.

## States
- **Modules coupés** : la sous-navigation perd l'entrée ; si seule « Compte » reste, la sous-navigation reste affichée (une rubrique est une information, pas un bruit).
- **Anonyme** : chaque écran garde son comportement actuel (redirection vers la connexion, avec le nouveau chemin en `next`).
- **Erreur / chargement** : aucun état propre au cadre ; les écrans gardent les leurs.
- **Mobile < 400 px** : aucun débordement horizontal.

## Design system gaps
1. **`Tabs` n'est pas copié** (lacune déjà écrite, `docs/design-system.md:197-199`). Une sous-navigation de réglages est l'usage que le catalogue lui prête (« Navigation secondaire ») ; elle est composée ici avec `SidebarNav`. Si le porteur préfère des onglets, il faut d'abord copier `Tabs` dans `packages/ui` (ADR 022) — pas dans cette story.
2. **Largeur de la colonne de sous-navigation** (`12rem`) : aucune largeur nommée dans le système ; choix de cet écran.
