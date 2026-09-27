# Design — Story s60-console

> Généré par l'agent, à partir de `docs/design-system.md` et des composants **réellement exportés** par `packages/ui` (vérifié le 27/09 dans le baril et `packages/ui/src/{components,composed}`). La console reprend le squelette de l'`AppShell` (`apps/web/app/app-shell.tsx`) — barre latérale, barre du haut de 3,5 rem — pour que le superadmin ne réapprenne rien. Ce qui la distingue passe par le **contenu** du squelette (marque, badge, entrées), jamais par une couleur nouvelle.

## Screen(s)

### 1. Shell de la console (layout `(console)`)
Enveloppe de tous les écrans `/console/*`. Il remplace l'`AppShell` pour cette zone : **aucune** entrée de la barre latérale du produit n'y paraît.

- **Barre latérale** (`Sidebar`, `w-60`, `bg-card`, bordure droite, visible à partir de `md`)
  - `SidebarBrand` : nom de l'application **+ `Badge variant="default"` « Console »**. Le badge est ce qui dit « vous n'êtes pas dans le produit », à chaque écran, au même endroit.
  - `SidebarNav` : les entrées de surface `console`, **dérivées du registre** (`visibleNavigation(…, 'console')`), dans l'ordre du registre, précédées de « Tableau de bord » (`/console`). Aujourd'hui : Tableau de bord, Comptes, Organisations, Revenu, Inscriptions. Une entrée disparaît avec son module.
  - L'entrée courante porte `aria-current="page"` (règle déjà écrite dans `SidebarNav`, comparée sur le chemin interne comme `backOfficeNavigation` le fait aujourd'hui).
- **Barre du haut** (`header`, `h-14`, bordure basse)
  - Sous `md` : bouton menu qui ouvre la navigation dans un `Sheet` (même composition que `MobileNavigation` de l'`AppShell`), titre « Console ».
  - À droite : `LocaleSwitcher` (si plusieurs langues servies), `ThemeToggle`, menu de compte existant (`account-menu.tsx`, `DropdownMenu`) pour la déconnexion.
  - **Pas** de cloche de notifications, **pas** de sélecteur d'organisation : la console n'agit pas au nom d'une organisation.
- **Contenu** : `main`, `px-3 md:px-6`, `py-6`, colonne `gap-6`, largeur pleine (les tableaux du back-office en ont besoin).
- **Bas de page** : `CookieBanner` et scripts de consentement (avec le nonce), comme tout gabarit ; réserve `pb-64` tant que la bannière est ouverte.
- La navigation en pastilles actuelle du back-office (`BackOfficeNavigation`, `back-office-screens.tsx:322`) **disparaît** des écrans : la barre latérale la remplace. Le fil d'Ariane (`Breadcrumb`) des écrans de détail reste, avec « Console » pour racine au lieu d'« Administration ».

### 2. Tableau de bord (`/console`)
- `PageHeader` : titre « Tableau de bord », description « Vue d'ensemble de la plateforme ».
- Grille de **tuiles** : 1 colonne sous `sm`, 2 à partir de `sm`, 4 à partir de `xl` (`grid gap-4`).
- **Une tuile par entrée de surface `console` visible** (même dérivation que la barre latérale : aucun nom de module écrit). Chaque tuile est une `Card` :
  - `CardHeader` : `CardTitle` (libellé de l'entrée : « Comptes »…) et `CardDescription` courte ;
  - `CardContent` : le **nombre**, en `text-3xl font-semibold` (échelle `h1`, chiffres tabulaires) ;
  - `CardFooter` : lien `Button variant="ghost"` (`asChild` sur `<a>`) « Voir les comptes » vers l'écran, avec icône Lucide `ArrowRight` 16 px.
- **Tuile Revenu** : pas un nombre mais **une ligne par devise** (`12 480,00 €`, `3 120,00 $`), formatée par `Intl.NumberFormat` de la langue courante — jamais une somme toutes devises (s38). Sous la liste, en `small` `text-muted-foreground` : « dont N abonnement(s) sans prix au catalogue » quand `recurringUnvalued > 0`. Intitulé « Revenu récurrent estimé », le mot « estimé » est obligatoire (s38).

## Mockup
docs/designs/s60-console.html — visual reference. DO NOT copy into production: Execute builds with the real components.

## Reused components (from the design system)
- `Sidebar`, `SidebarBrand`, `SidebarNav` — barre latérale de la console, identique à celle de l'application.
- `Sheet` — navigation sous `md`, comme `MobileNavigation`.
- `Badge` (`default`) — marque « Console » dans la barre latérale ; seul signe distinctif de la zone.
- `LocaleSwitcher`, `ThemeToggle` — barre du haut (s09, s08).
- `DropdownMenu` via le menu de compte existant — déconnexion.
- `PageHeader` — en tête du tableau de bord.
- `Card` (`CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`) — une tuile.
- `Button` (`ghost`, `asChild` sur `<a>` ; le composant n’a pas de variante `link`) — lien de tuile.
- `Alert` (`destructive`) — tuile en échec de lecture.
- `EmptyState` — console sans aucune tuile (voir États).
- `Breadcrumb` — écrans de détail existants, racine renommée.
- `CookieBanner` — bas du shell.
- Icônes Lucide 16 px : `LayoutDashboard`, `Users`, `Building2`, `Banknote`, `Mail`, `ArrowRight`, `Menu`.

## States
- **Chargement** : aucun état dédié. L'existence de `/console` est décidée dans le corps de la page (404 pour un non-superadmin) : un `loading.tsx` ferait répondre 200 avant la décision (lacune « Chargement » du système, mesurée en s29). Le rendu est serveur, en une fois.
- **Vide** : une tuile à `0` reste une tuile (« 0 compte » est une information), avec son lien. La tuile Revenu sans aucun abonnement valorisé affiche « Aucun revenu récurrent ». Si **aucune** entrée de surface `console` n'est visible, le tableau de bord rend un `EmptyState` (« Aucun module d'administration n'est activé ») — cas théorique, `admin` déclare toujours Comptes.
- **Erreur** : une lecture en échec n'efface pas les autres. La tuile concernée garde son titre et remplace le nombre par un `Alert variant="destructive"` court (« Lecture impossible pour le moment ») et un lien « Réessayer » vers `/console`. Jamais de code technique. Même comportement que `BackOfficeError` aujourd'hui, à l'échelle d'une tuile.
- **Succès** : les quatre tuiles, chacune liée. Rien d'asynchrone, donc pas de `Toaster`.
- **Accès refusé** : anonyme, non-superadmin, session empruntée → **404** standard (`not-found.tsx`, gabarit Site selon s61) ; aucun élément du shell de console n'est rendu.
- **Module coupé** : la tuile et l'entrée de barre latérale disparaissent ensemble ; la grille se recompose (3 tuiles).

## Design system gaps
1. **Aucune largeur ni accent pour distinguer une zone.** Le système n'a qu'une primaire, et interdit la couleur décorative. La console se distingue donc par le **badge et les entrées**, pas par une teinte. Si le porteur veut une console visuellement marquée (bandeau coloré, primaire différente), il faut un **jeton de zone** (`--console` ?) décidé dans le design system — pas choisi ici.
2. **Pas de composant « tuile de statistique ».** Le système nomme `Card` comme unité de base, sans variante « chiffre clé ». La tuile se **compose** en ligne (`Card` + `text-3xl`) sur ce seul écran. Un second appelant (s62 ? un tableau de bord produit ?) justifierait un `StatCard` dans `packages/ui`, comme `Pagination` l'a été.
3. **Chiffres tabulaires** : l'échelle typographique ne dit rien de `tabular-nums` pour des montants alignés. Utilisé ici sur la tuile Revenu ; à écrire dans le système si c'est retenu.
4. **Menu de compte dans la console** : le menu existant (`account-menu.tsx`) lie vers `/account`, un écran de l'application. Le garder crée le seul lien console → application ; le retirer laisse le superadmin sans déconnexion visible. Choix non tranché par le système (question ouverte 5 de la research).
