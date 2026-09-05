# Design System — killer-boilerplate

> **Système neutre et thémable, pas une identité.** Comme les quatre cibles, le boilerplate ne vend pas une esthétique : il vend un système que chaque projet généré habille en changeant des tokens. Neutre ne veut pas dire indécis — tout ce qui suit est tranché et fait foi.
>
> Socle : shadcn/ui sur **Radix UI** (ADR 022, qui supersède l'ADR 009 — Base UI n'a jamais publié de majeure stable), Tailwind **v4** avec configuration en CSS (ADR 010). Les composants vivent dans `packages/ui` ; aucun module n'importe Radix directement.

## Tokens

Tailwind v4 : pas de `tailwind.config.js`. Les tokens sont des variables CSS déclarées dans le fichier racine de `packages/ui`, exposées à Tailwind par `@theme inline`.

```css
@import "tailwindcss";

:root {
  /* Surfaces et texte — échelle neutre */
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);

  /* Primaire — LE token que chaque projet remplace */
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);

  /* Sémantiques — états métier, jamais décoratives */
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.985 0 0);
  --success: oklch(0.62 0.17 149);
  --success-foreground: oklch(0.985 0 0);
  --warning: oklch(0.79 0.16 86);
  --warning-foreground: oklch(0.205 0 0);
  --info: oklch(0.62 0.16 250);
  --info-foreground: oklch(0.985 0 0);

  /* Bordures et focus */
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);

  --radius: 0.5rem;
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);

  --primary: oklch(0.985 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);

  --destructive: oklch(0.704 0.191 22.216);
  --destructive-foreground: oklch(0.985 0 0);
  --success: oklch(0.70 0.15 149);
  --success-foreground: oklch(0.145 0 0);
  --warning: oklch(0.83 0.14 86);
  --warning-foreground: oklch(0.145 0 0);
  --info: oklch(0.70 0.14 250);
  --info-foreground: oklch(0.145 0 0);

  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
}
```

### Couleur
Échelle neutre achromatique plus **une primaire**, volontairement quasi noire en clair et quasi blanche en sombre : c'est le défaut le plus neutre possible, et changer l'identité d'un projet généré revient à remplacer `--primary` et `--primary-foreground`. Les sémantiques (succès, avertissement, danger, information) sont les seules couleurs chromatiques du système, et elles portent un sens métier — jamais un usage décoratif.

Correspondance avec les états de facturation (s19, s21) : essai en cours → `info`, en retard de paiement → `warning`, annulé ou expiré → `muted`, échec définitif → `destructive`, abonnement actif → `success`.

### Typographie
**Geist Sans** pour l'interface, **Geist Mono** pour le code, chargées par `next/font` — aucune requête vers un domaine externe, donc aucun script tiers à déclarer au registre de consentement (s33).

| Rôle | Taille / graisse | Usage |
|---|---|---|
| `display` | 3rem / 600, interligne serré | Héros marketing uniquement (s10) |
| `h1` | 1.875rem / 600 | Titre de page |
| `h2` | 1.5rem / 600 | Section |
| `h3` | 1.25rem / 600 | Sous-section, titre de carte |
| `body` | 0.875rem / 400 | Texte par défaut de l'application |
| `body-lg` | 1rem / 400 | Texte des pages marketing et de la documentation |
| `small` | 0.75rem / 400 | Aide sous un champ, horodatage, métadonnée |
| `mono` | 0.875rem | Blocs de code de la documentation (s30) et du changelog (s31) |

#### Image sociale — manque n°2 de `s29-blog-mdx`, **toujours non comblé** (s53)

Le système ne décrit **aucun gabarit d'image de partage** : ni dimensions de
référence, ni zone de titre, ni marges de sécurité, ni comportement d'un titre
long, ni variante sombre. s53 avait besoin d'une image par défaut et a tranché
**au plus petit** : un fichier statique unique, `apps/web/public/og-default.png`,
composé des seuls jetons existants (`--background`, `--foreground`,
`--muted-foreground`, `--border`, `--radius`) et de la typographie du système,
produit par `scripts/og-image.ts` — donc reproductible et sensible à un
changement de jeton.

Ce n'est **pas** l'extension du système, et il ne faut pas la lire comme telle :
tant qu'un gabarit n'est pas décrit ici, une image **par article** ne peut pas
être produite sans inventer. Un article peut en revanche fournir la sienne
(`image:` au frontmatter), auquel cas rien n'est généré.

**Ce que s53 a dû poser au-dessus du système, faute de gabarit** — quatre
dimensions qui ne dérivent d'aucun des huit rôles typographiques ci-dessus, ni
de l'échelle d'espacement, et qui vivent dans `scripts/og-image.ts` seul :

| Dimension | Valeur posée | Pourquoi aucun rôle ne la couvre |
|---|---|---|
| Titre de l'image | 88 px / 600 | `display` (3 rem ≈ 48 px) est le plus grand rôle, et il est **réservé au héros marketing** (s10). Une image de 1200×630 lue en vignette demande davantage |
| Sous-titre | 36 px / 400 | entre `display` et `h1`, aucun rôle n'existe à cette taille |
| Marge et retrait du cadre | 64 px | l'échelle d'espacement s'arrête au rythme des sections (`py-16`/`py-24`), pensé pour un écran, pas pour un cadre de 630 px |
| Interligne des deux textes | 24 px | idem |

Un gabarit d'image sociale décrit ici les remplacerait toutes les quatre. Tant
qu'il n'existe pas, elles sont **un emprunt nommé**, pas une extension tacite —
et la story suivante qui touche à l'image de partage part de ce tableau.

#### Échelle de prose — un corps d'article long (s29)

Les huit rôles ci-dessus décrivent une **interface**. Aucun ne décrit un corps
d'article : titres internes enchaînés, paragraphes, listes, citations, liens
dans le texte, images, blocs de code. C'est le manque n°1 relevé par le design
de `s29-blog-mdx`, et il concerne trois stories — s29 (blog), s30
(documentation) et s31 (changelog) rendront toutes du MDX.

L'échelle ci-dessous est **dérivée** des rôles existants et de l'échelle
d'espacement Tailwind : elle n'introduit ni taille, ni graisse, ni couleur, ni
rayon qui ne soit déjà déclaré plus haut. Chaque ligne dit de quoi elle dérive,
et c'est cette colonne qui la rend vérifiable — une entrée qui ne dériverait de
rien serait une seconde typographie, pas une extension.

| Élément du corps | Rendu | Dérivé de |
|---|---|---|
| Paragraphe | `body-lg`, `text-foreground`, blocs séparés par `space-y-4` | `body-lg` (« texte des pages marketing et de la documentation ») + échelle d'espacement |
| Titre interne de niveau 2 | `h2`, précédé de `mt-10` | rôle `h2` + échelle d'espacement |
| Titre interne de niveau 3 | `h3`, précédé de `mt-8` | rôle `h3` + échelle d'espacement |
| Titre interne de niveau 4 | `body-lg` en graisse 600 | `body-lg` + la graisse que `h1`/`h2`/`h3` emploient déjà |
| Liste (à puces, numérotée) | `body-lg`, retrait `pl-6`, items espacés de `space-y-2` | `body-lg` + échelle d'espacement |
| Citation | `body-lg`, `text-muted-foreground`, filet gauche `border-l-2 border-border`, `pl-4` | `body-lg` + jetons `muted-foreground` et `border` |
| Lien dans le texte | couleur du texte, `underline underline-offset-4` | aucun jeton nouveau : le soulignement porte l'affordance, pas une couleur |
| Code en ligne | `mono`, `bg-muted`, `rounded-sm`, `px-1.5 py-0.5` | rôle `mono` + jeton `muted` + `--radius-sm` |
| Bloc de code | `mono`, `bg-muted`, `border border-border`, `rounded-lg`, `p-4`, défilement horizontal | rôle `mono` + « le défilement horizontal reste réservé aux blocs de code de la documentation » (§ Responsive) |
| Image | pleine largeur du corps, `rounded-lg`, `border border-border` | « élévation par bordure et fond » + `--radius-lg` |
| Séparation de section | le composant `Separator` | composant existant |
| **Mesure de ligne** | corps borné à `max-w-2xl` (42 rem) | échelle de largeurs Tailwind par défaut, comme l'échelle d'espacement l'est déjà. C'est le manque n°4 du design de s29, tranché ici : une ligne de texte long non bornée devient illisible au-delà de ~90 caractères |

Ce que cette échelle **ne** couvre pas, et qui reste un manque à signaler : les
tableaux à l'intérieur d'un corps d'article (le système a `Table`, mais rien ne
dit comment il se compose dans de la prose), et les notes de bas de page. Les
deux sont absents du contenu de s29 ; les combler à l'avance livrerait des
règles que personne n'a exercées.

### Espacement, formes, élévation
- Échelle d'espacement Tailwind par défaut (base 0.25rem). Rythme vertical des sections marketing : `py-16` en mobile, `py-24` au-delà.
- `--radius: 0.5rem`, avec les dérivés `sm = radius - 4px`, `md = radius - 2px`, `lg = radius`, `xl = radius + 4px`.
- Densité confortable : hauteur de champ et de bouton `2.5rem`, cellule de tableau `py-3`.
- Élévation par bordure et fond, pas par ombre portée. Une ombre n'apparaît que sur les surfaces flottantes (dialogue, popover, menu déroulant), jamais sur une carte statique.

## Composants disponibles

Tous dans `packages/ui`. Un module compose avec cette liste ; il ne crée pas ses propres primitives.

| Composant | Usage |
|---|---|
| `Button` | Actions. Variantes `default`, `secondary`, `outline`, `ghost`, `destructive`. Porte son état `pending`. |
| `Input`, `Textarea`, `Select`, `Checkbox`, `RadioGroup`, `Switch` | Champs de saisie |
| `Form`, `FormField`, `FormMessage` | Liaison react-hook-form + Zod, message d'erreur sous le champ |
| `Label`, `Separator`, `Skeleton` | Primitives de mise en page |
| `Card` | Bloc de contenu. Unité de base des pages de paramètres. |
| `Dialog`, `Sheet`, `Popover`, `Tooltip`, `DropdownMenu` | Surfaces flottantes |
| `AlertDialog` | Confirmation d'une action irréversible uniquement |
| `Alert` | Message contextuel persistant, porté par une sémantique |
| `Badge` | État court : rôle, statut d'abonnement, catégorie |
| `Avatar` | Utilisateur ou organisation, repli sur les initiales |
| `Tabs`, `Accordion` | Navigation secondaire, FAQ marketing |
| `Table`, `DataTable` | Listes. `DataTable` porte tri, pagination et état vide. |
| `Pagination` | Pagination autonome, hors tableau |
| `Command` | Palette de recherche (back-office, documentation) |
| `Breadcrumb` | Fil d'Ariane du back-office et de la documentation |
| `Progress` | Progression déterminée : parcours d'intégration, export |
| `ScrollArea` | Zone défilante à barre stylée |
| `Toaster` (sonner) | Retour asynchrone |
| `Sidebar` | Navigation principale du tableau de bord, alimentée par les modules actifs |
| **Composés maison** | |
| `PageHeader` | Titre, description, actions — en tête de chaque page applicative |
| `EmptyState` | Icône, titre, explication, action principale |
| `ConfirmDialog` | `AlertDialog` avec saisie de confirmation pour les suppressions (s34) |
| `ThemeToggle` | Commutateur clair / sombre (s08) |
| `LocaleSwitcher` | Sélecteur de langue (s09) |
| `OrgSwitcher` | Bascule d'organisation (s15) |
| `NotificationCenter` | Cloche, badge de non-lues, liste (s32) |
| `PricingTable` | Tarifs dérivés de `config/billing.ts` (s22) |
| `CookieBanner` | Bannière de consentement (s36) |
| `Stepper` | Parcours en étapes (s37 — intégration) |
| `MarketingSection` | Enveloppe des sections pilotées par `config/marketing.ts` (s10) |

## UI patterns

### Formulaires
react-hook-form et Zod, **le même schéma Zod côté client et côté serveur** — il vient de la couche `application` du module. Erreur affichée sous le champ, jamais en tooltip. Bouton de soumission en état `pending` et désactivé pendant l'envoi. Erreur globale du formulaire dans un `Alert` `destructive` au-dessus des champs.

Exception de sécurité : sur les écrans d'authentification, un identifiant inconnu et un mot de passe erroné produisent **le même message générique** (s07).

### États
- **Chargement** : `Skeleton` reproduisant la forme du contenu attendu. Jamais de spinner plein écran, jamais de saut de mise en page.
  - **Manque signalé (s29), non comblé** : un squelette suppose une frontière `Suspense`, donc un `loading.tsx`, et celui-ci fait pousser la coquille de la page **avant** qu'elle n'ait décidé — un `notFound()` arrive alors après le statut, et la route répond 200. Mesuré sur `/blog/<slug inconnu>` (`e2e/blog.spec.ts:132`). L'état de chargement est donc **inatteignable** sur toute route dont l'existence est décidée dans le corps de la page, tant que le système ne dit pas comment tenir les deux. Le refus prime : c'est le socle de sécurité.
- **Vide** : `EmptyState` avec l'action qui sort de cet état. Un tableau vide sans action est un écran cassé.
- **Erreur** : message expliquant quoi faire, plus un moyen de réessayer. Jamais de code technique brut.
- **Succès** : un `Toaster` pour une action asynchrone, un changement d'état visible pour une action locale. Pas les deux.
- **Accès refusé** : une ressource d'une autre organisation renvoie **404**, jamais 403 — l'interface ne doit pas trahir son existence (s15).
- **Réservé à une offre** : l'action reste visible mais mène à une invitation à souscrire, plutôt que de disparaître (s21). Masquer une fonctionnalité payante empêche de la vendre.

### Avant l'hydratation

Un formulaire React sans `method` retombe sur le `GET` par défaut du navigateur tant que React n'a pas pris la main — ce qui met les champs, mots de passe compris, dans l'URL. Deux affordances en découlent, héritées par tout écran portant un formulaire :

- le `<form>` déclare **toujours** `method="post"`, écrit en toutes lettres (une règle de lint le refuse autrement) ;
- le bouton de soumission est **désactivé jusqu'à l'hydratation**. Sans JavaScript il le reste : ces formulaires n'ont jamais fonctionné sans lui, et il vaut mieux le dire que perdre la saisie en silence.

Conséquence visible : un bref état grisé au premier rendu. C'est voulu, et c'est le prix de ne pas divulguer un secret par l'URL.

### Feedback
`Toaster` pour l'asynchrone (enregistré, invitation envoyée, export prêt). `Alert` en ligne pour ce qui persiste (période d'essai qui s'achève, paiement en retard, email non vérifié). Confirmation par `ConfirmDialog` pour toute action irréversible, avec saisie du nom ou de l'email pour une suppression de compte ou d'organisation.

### Navigation
La barre latérale est construite depuis les modules actifs (s08). Aucune entrée n'est écrite en dur : un module désactivé n'a pas d'entrée, sans condition dans le composant.

### Responsive
Mobile d'abord. Toute page est utilisable sous 400 px sans débordement horizontal (critère de s08). La barre latérale devient un `Sheet` sous `md`. Les tableaux passent en liste de cartes, jamais en défilement horizontal dans l'application — le défilement horizontal reste réservé aux blocs de code de la documentation.

### Thème sombre
Activé par la classe `.dark` sur `<html>` via next-themes, **pas** par `prefers-color-scheme` seul : le commutateur de s08 doit pouvoir contredire le système, et le choix persiste entre deux sessions. Toute couleur doit être définie dans les deux thèmes.

## Do / Don't

- ✅ Composer depuis `packages/ui`.
- ❌ Créer une primitive dans un module. Un besoin non couvert est un **design system gap** à signaler, jamais à combler sur place.
- ✅ Utiliser les tokens sémantiques : `bg-background`, `text-muted-foreground`, `border-border`.
- ❌ Écrire une couleur Tailwind brute (`bg-zinc-800`, `text-red-500`) dans un module : elle casse le thème sombre et la thématisation par projet.
- ✅ Importer Radix UI uniquement dans `packages/ui`.
- ❌ L'importer depuis un module : le socle deviendrait irremplaçable.
- ✅ Charger les polices par `next/font`.
- ❌ Appeler une police hébergée ailleurs : ce serait un script tiers, donc soumis au consentement (s36).
- ✅ Passer toute chaîne visible par les traductions du module.
- ❌ Écrire un texte en dur, même provisoire : un test échoue (s09).
- ✅ Squelette pendant le chargement.
- ❌ Spinner plein écran ou saut de mise en page.
- ✅ Icônes Lucide, taille 16 px dans l'application, 20 px dans le marketing.
- ❌ Mélanger plusieurs jeux d'icônes.
- ✅ Élévation par bordure et fond.
- ❌ Ombres portées sur les surfaces statiques.
