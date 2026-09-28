# Design — Story s61-site-et-application

> Généré par l'agent (le porteur a délégué le déroulé des stories le 28/09), à partir de `docs/design-system.md` et des composants **exportés** par `packages/ui` (vérifiés en research : `Button`, `Sheet*`, `DropdownMenu*`, `LocaleSwitcher`, `ThemeToggle`, `Sidebar*`, `PageHeader`, `EmptyState`, `Separator`). Trois gabarits, un écran (`/app`). Le contenu des écrans existants ne change pas : seul ce qui les entoure change.

## Screen(s)

### 1. Gabarit Site — `(site)/layout.tsx`
Pour `/`, `/blog`, `/docs`, `/pricing`, `/changelog`, `/contact`, `/legal`, `/cookies`, `/waitlist`, et la 404 de zone (s66).

- **En-tête** (`header`, hauteur `h-16`, bordure basse `border-border`, fond `bg-background`, largeur de contenu `max-w-6xl mx-auto px-4 md:px-6`) :
  - à gauche, la marque : nom de l'application (`app.name`), lien vers `/` ;
  - au centre-gauche (à partir de `md`), les entrées de surface `site` **dérivées du registre**, en `Button variant="ghost"` (`asChild` sur `<a>`), l'entrée courante en `variant="secondary"` avec `aria-current="page"` (même règle visuelle que `BackOfficeNavigation`) ;
  - à droite : `LocaleSwitcher` (si plusieurs langues), `ThemeToggle`, puis **le bouton de gabarit** : `Button variant="default"` « Se connecter » (anonyme, vers `/sign-in`) ou « Ouvrir l'application » (connecté, vers `/app`) ;
  - sous `md` : les entrées passent dans un `Sheet` ouvert par un bouton menu (`Button variant="ghost" size="icon"`, icône `Menu`), sur le modèle de `MobileNavigation` ; le bouton de gabarit reste visible dans la barre.
- **Contenu** : pleine largeur, chaque page garde sa propre mise en page (les sections marketing ont déjà leur `MarketingSection`).
- **Pied de page** : **inchangé**, toujours rendu par chaque page (`publicFooterLinks`). Le gabarit ne l'ajoute pas — sinon les pages qui le rendent l'afficheraient deux fois.
- **Bas de page** : `CookieBanner` + scripts de consentement (nonce), bandeau d'emprunt (`ImpersonationBanner`) quand la session est empruntée, en tête du contenu comme dans l'`AppShell`.

### 2. Gabarit Hors zone — `(auth)/layout.tsx`
Pour `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, `/verify-email`, `/two-factor`, `/oauth/return`, `/invitations/accept`.

- **Barre minimale** (`h-14`, sans bordure) : marque à gauche (lien vers `/`), `LocaleSwitcher` et `ThemeToggle` à droite. **Aucune** entrée de navigation, **aucun** bouton de gabarit.
- **Contenu** : centré verticalement et horizontalement, `min-h-[calc(100svh-3.5rem)]`, `px-4`. Les écrans gardent leur `max-w-md` (choix de s46).
- Consentement et bandeau d'emprunt comme le gabarit Site.

### 3. Gabarit Application — `(app)/layout.tsx`
L'`AppShell` actuel, **moins** les entrées du site : la barre latérale ne rend que la surface `app` (ce qu'elle fait déjà par défaut ; ce sont les entrées qui changent de surface). Aucun autre changement visuel en s61 (la barre du haut et la zone Réglages sont le travail de s62). La marque de la barre latérale pointe vers `/app`, plus vers `/`.

### 4. Tableau de bord — `/app`
Le contenu que `/` rend aujourd'hui à un connecté, **déplacé tel quel** : `PageHeader` (`app.dashboard.title`, description avec le nom), `EmptyState` (icône `LayoutDashboard`, action vers `/account`). Rien de nouveau : c'est la page d'accueil du produit construit, que chaque projet remplira.

## Mockup
docs/designs/s61-site-et-application.html — visual reference. DO NOT copy into production: Execute builds with the real components.

## Reused components (from the design system)
- `Button` (`ghost`, `secondary`, `default`, `size="icon"`) — entrées de l'en-tête, entrée courante, bouton de gabarit, menu mobile.
- `Sheet`, `SheetContent`, `SheetTitle`, `SheetTrigger` — entrées du site sous `md`.
- `LocaleSwitcher`, `ThemeToggle` — les trois gabarits.
- `Sidebar`, `SidebarBrand`, `SidebarNav` — gabarit Application (inchangé).
- `PageHeader`, `EmptyState` — `/app`.
- `CookieBanner` (via `ConsentBanner`), `ImpersonationBanner` — tous les gabarits.
- Icônes Lucide 16 px : `Menu`, `LayoutDashboard`.

## States
- **Anonyme / connecté** : seul le bouton de gabarit change (libellé et cible). Un connecté sur `/` voit le site, rien d'autre.
- **Aucune entrée `site` visible** (marketing, blog, docs, billing coupés) : l'en-tête reste, avec la marque, la langue, le thème et le bouton.
- **Session empruntée** : bandeau d'emprunt en tête du contenu, dans les trois gabarits.
- **Première visite** : bannière de consentement en bas, réserve `pb-64 md:pb-36` sous le contenu comme aujourd'hui.
- **Chargement / erreur** : aucun état propre au gabarit ; les écrans gardent les leurs.
- **Mobile < 400 px** : pas de débordement horizontal (critère de s08) ; les entrées du site sont dans le `Sheet`.

## Design system gaps
1. **Pas de composant d'en-tête de site ni de `NavigationMenu`.** Le système décrit une barre latérale d'application, pas un en-tête de site. L'en-tête est **composé** dans `apps/web` avec `Button` + `Sheet` ; s'il gagne un second appelant (la documentation ?), il mériterait un `SiteHeader` dans `packages/ui`.
2. **Largeur de contenu du site.** Le système borne la prose (`max-w-2xl`) et les sections marketing, pas un conteneur d'en-tête. `max-w-6xl` est choisi ici pour l'en-tête ; à consigner dans le système si retenu.
3. **Gabarit d'authentification centré.** Le système note déjà l'absence de largeur nommée pour un formulaire centré (lacune s46) ; ce gabarit ne la comble pas, il centre seulement.
