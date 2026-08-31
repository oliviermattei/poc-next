# Design — Story s10-marketing-site

Dérivé de `docs/design-system.md`. Rien de ce qui suit n'invente un composant ni un token : les deux
nouveautés de `packages/ui` — `Accordion` et `MarketingSection` — figurent déjà à l'inventaire du document,
la seconde y étant même annotée « (s10) ».

## Écrans

### 1. Accueil public — `/` (visiteur sans session, module activé)

Rendu **dans l'`AppShell`** (barre latérale, en-tête avec langue et thème). Le contenu de `<main>` est une
pile verticale de sections, dans l'ordre de `config/marketing.ts`, suivie du pied de page.

```
┌ Sidebar ─┐┌ Header : [☰] marque … [Langue] [Thème] ────────────┐
│ Accueil  ││                                                     │
│ Connexion││  ── section « hero » ────────────────────────────   │
│          ││   h1 (display 3rem/600)                             │
│          ││   description (body-lg)                             │
│          ││   [Créer un compte] [Se connecter]                  │
│          ││                                                     │
│          ││  ── section « features » ────────────────────────   │
│          ││   h2 + description                                  │
│          ││   ┌ Card ─┐ ┌ Card ─┐ ┌ Card ─┐   (1 / 2 / 3 col)   │
│          ││   │ h3    │ │ h3    │ │ h3    │                     │
│          ││   │ texte │ │ texte │ │ texte │                     │
│          ││   └───────┘ └───────┘ └───────┘                     │
│          ││                                                     │
│          ││  ── section « testimonials » ───────────────────    │
│          ││   h2 + Card(blockquote + auteur) × n                │
│          ││                                                     │
│          ││  ── section « faq » ────────────────────────────    │
│          ││   h2 + Accordion (question / réponse) × n           │
│          ││                                                     │
│          ││  ── section « cta » ────────────────────────────    │
│          ││   h2, description, [Créer un compte]                │
│          ││                                                     │
│          ││  ── footer ─────────────────────────────────────    │
│          ││   Separator                                         │
│          ││   marque · Confidentialité · Conditions             │
└──────────┘└─────────────────────────────────────────────────────┘
```

Rythme vertical des sections : `py-16` en mobile, `py-24` au-delà — la valeur écrite dans
`docs/design-system.md`. La typographie `display` (3rem / 600, interligne serré) est réservée au titre du
héros, ce que le document restreint explicitement au « héros marketing (s10) ».

### 2. Page légale — `/legal/<document>` (`privacy`, `terms`)

Même shell. `PageHeader` (titre + description), puis les sections du document en `h2` + paragraphe, puis le
même pied de page. Un document inconnu, ou le module coupé : `notFound()` — 404, jamais une page vide.

### 3. Racine, module coupé

Aucune page publique : redirection serveur vers l'écran de connexion. Un visiteur connecté conserve son
tableau de bord (s08, critère 1) — c'est la seule branche de la racine que s10 ne touche pas.

## Maquette

`docs/designs/s10-marketing-site.html` — référence visuelle, à ouvrir dans un navigateur, avec bascule
clair / sombre. **Ne pas la copier** : l'implémentation compose avec les vrais composants de `packages/ui`.

## Composants réutilisés (du design system)

| Composant | Où | Pourquoi |
|---|---|---|
| `MarketingSection` (nouveau composé) | enveloppe de chaque section | l'inventaire le décrit ainsi : « Enveloppe des sections pilotées par `config/marketing.ts` (s10) ». Il porte le rythme vertical, la largeur de colonne, le titre et la description ; il ne connaît **aucune** nature de section |
| `Accordion` (primitive copiée) | FAQ | l'inventaire dit « `Tabs`, `Accordion` — Navigation secondaire, **FAQ marketing** » |
| `Card` / `CardHeader` / `CardTitle` / `CardDescription` / `CardContent` | fonctionnalités, témoignages, appel à l'action | « Bloc de contenu » ; élévation par bordure et fond, sans ombre |
| `Button` (`default`, `outline`) | appels à l'action | variantes existantes ; `asChild` sur un `<a>`, comme `apps/web/app/page.tsx` le fait déjà |
| `Separator` | au-dessus du pied de page | primitive de mise en page |
| `PageHeader` | pages légales | « en tête de chaque page applicative » |
| Tokens sémantiques | partout | `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-muted`, `bg-card` — aucune couleur Tailwind brute |

### Ce que la maquette montre et que l'implémentation ne livre pas

**Les icônes des cartes de fonctionnalités.** La maquette en dessine trois. Les
livrer demanderait que `config/marketing.ts` nomme une icône par élément, donc
qu'un fichier de configuration référence un composant et qu'une table de
correspondance vive dans le module — exactement le couplage que le premier
critère de la story cherche à éviter (« retirer une section ne demande aucune
modification de composant »). Les cartes sont donc typographiques. Le design
system reste applicable le jour où une story décide de la façon dont une
configuration nomme une icône (Lucide, 20 px dans le marketing).

## États

- **Vide** — une section sans élément (`items: []` pour une nature qui en attend) n'est pas un écran cassé :
  la configuration ne devrait pas la déclarer. Le domaine **refuse** la configuration à la validation, en
  nommant la section, plutôt que d'afficher un bloc vide. Une liste de sections vide, elle, est l'état
  légitime « module coupé » et produit la redirection.
- **Chargement** — sans objet : ces pages ne chargent rien. Aucun squelette, aucun spinner.
- **Erreur** — un document légal inconnu est un 404 (`notFound()`), pas un message d'erreur ; une clé de
  traduction absente lève, comme partout depuis s09.
- **Succès** — sans objet : aucune action, aucun formulaire dans cette story.
- **Sombre** — chaque couleur employée est définie dans les deux thèmes puisque toutes viennent des tokens.
  À vérifier à l'œil (contraste), le dépôt n'ayant pas de vérification automatique de contraste.

## Responsive

Mobile d'abord. Une seule colonne sous `md`, deux à partir de `md`, trois à partir de `lg` pour les
fonctionnalités ; deux colonnes maximum pour les témoignages. Aucun débordement horizontal sous 400 px —
c'est un critère mesuré de s08, et le parcours qui le mesure passe par `/`.

## Design system gaps (signalés, non comblés)

1. **Aucun « chrome marketing » plein cadre.** `docs/design-system.md` ne décrit qu'un shell applicatif
   (`Sidebar` + en-tête) et ne dit rien d'un en-tête marketing en pleine largeur. Les sections vivent donc
   dans la colonne `max-w-4xl` de `AppShell`. C'est **volontaire et borné** : en sortir demanderait des
   groupes de routes, un second layout et la réécriture de quatre parcours end-to-end, pour une décision de
   design qui n'a pas été prise. À trancher par une story de design, pas ici.
2. **Aucun composant `Footer` à l'inventaire.** s36 en fait pourtant un point d'accès au consentement et
   l'attribue à s10 (`docs/stories.md:977`). Il est donc **composé** ici de `Separator`, de liens et de
   tokens, dans la couche `presentation` du module — aucune primitive maison n'est ajoutée à `packages/ui`.
   Si un `Footer` doit devenir un composé du design system, c'est une décision à écrire dans
   `docs/design-system.md`.
3. **Aucune image, aucun logo.** Le design system ne fournit ni illustration ni marque : le héros est
   typographique. Un visuel serait du contenu de projet, pas du boilerplate.

## Ce que le design refuse explicitement

- une couleur écrite à la main (`bg-zinc-800`, `text-red-500`) — elle casse le thème sombre et la
  thématisation par projet ;
- une ombre portée sur une carte statique — l'élévation se fait par bordure et fond ;
- un second jeu d'icônes ;
- une police ou une image servie par un domaine tiers — ce serait un script tiers soumis au consentement de
  s36, et une fuite d'adresse IP avant tout accord ;
- un texte écrit en dur, même provisoire.

## Vérification visuelle (tracée)

Serveur de développement local, captures en plein écran, `fr` :

| Vue | Résultat |
|---|---|
| accueil, clair, 1280 px | héros en `display`, fonctionnalités sur **trois** colonnes, témoignages sur deux, FAQ repliée, pied de page espacé. Débordement horizontal : 0 px |
| accueil, sombre, 1280 px | toutes les surfaces suivent les tokens, contraste lisible, un seul filet au-dessus du pied de page. 0 px |
| accueil, clair, 380 px | une colonne, boutons sur une ligne, aucun débordement. 0 px |
| `/legal/privacy`, clair, 1280 px | `PageHeader`, trois sections, pied de page. 0 px |
| `/legal/privacy`, clair, 380 px | idem, une colonne. 0 px |

Deux défauts trouvés à l'œil et corrigés, qu'aucune commande ne voyait :

1. **Les classes des composants du module n'étaient pas générées.** Tailwind
   tourne en `source(none)` et `packages/modules/*/src/presentation` n'était
   déclaré dans aucun `@source` : `md:grid-cols-2`, `lg:grid-cols-3` et
   `gap-x-6` n'existaient nulle part dans la feuille produite, sans la moindre
   erreur. Corrigé dans `apps/web/app/globals.css`, et **rendu exécutable** :
   `tests/design-system.test.ts` dérive les fichiers `.tsx` du dépôt et les
   motifs déclarés, et rougit sur un fichier non couvert. Piège mesuré au
   passage : un chemin de dossier contenant un `*` est traité comme un motif de
   **fichiers** et ne balaie rien — il faut `/**/*.tsx`.
2. **Double filet au-dessus du pied de page.** `MarketingSection` posait sa
   bordure en bas avec `last:border-b-0` ; la dernière section n'étant pas le
   dernier enfant (le pied de page la suit), elle gardait sa bordure et
   doublait le `Separator`. La bordure est passée **au-dessus**, avec
   `first:border-t-0`.
