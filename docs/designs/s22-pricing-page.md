# Design — Story s22-pricing-page

## Écran

Un seul écran, **public** : `/pricing`. Il ne fait pas partie des sections
pilotées par `config/marketing.ts` — il est dérivé de `config/billing.ts`, et
c'est la seule page publique qui dépend de la pile de facturation.

```
┌──────────────────────────────────────────────────────────┐
│  PageHeader                                              │
│    h1     « Nos offres »                                 │
│    body-lg  description courte                           │
├──────────────────────────────────────────────────────────┤
│  PricingTable  — grille dérivée du catalogue             │
│                                                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐          │
│  │ Card       │  │ Card       │  │ Card       │          │
│  │ h3  nom    │  │            │  │            │          │
│  │ Badge essai│  │            │  │            │          │
│  │ display prix│ │            │  │            │          │
│  │ small /mois│  │            │  │            │          │
│  │ Separator  │  │            │  │            │          │
│  │ liste      │  │            │  │            │          │
│  │ Button CTA │  │            │  │            │          │
│  └────────────┘  └────────────┘  └────────────┘          │
│                                                          │
│  Alert (noscript) — le tunnel exige JavaScript           │
└──────────────────────────────────────────────────────────┘
```

Grille : une colonne sous `md`, autant de colonnes que d'offres au-delà,
plafonnée à trois. **Le nombre de cartes n'est écrit nulle part** — il vient de
la longueur du catalogue, ce qui est le critère 1.

Rythme vertical marketing du système : `py-16` en mobile, `py-24` au-delà.

## Maquette

`docs/designs/s22-pricing-page.html` — référence visuelle. **Ne pas copier en
production** : l'exécution construit l'écran avec les composants réels de
`packages/ui`.

## Composants réutilisés (du système de design)

| Composant | Où / pourquoi |
|---|---|
| `PricingTable` | **Déjà déclaré par le système** pour cette story : « Tarifs dérivés de `config/billing.ts` (s22) ». C'est le composé maison à écrire, pas une primitive à inventer. |
| `Card` | Une par offre — unité de bloc du système |
| `Badge` | État court : « 14 jours d'essai », « Paiement unique ». Jamais décoratif. |
| `Button` | Le CTA. Variante `default` pour l'offre mise en avant, `outline` pour les autres. Porte son état `pending`. |
| `Separator` | Entre l'en-tête tarifaire de la carte et la liste |
| `PageHeader` | Titre et description en tête de page |
| `Alert` | Le message `noscript`, sémantique `warning` — il persiste, donc `Alert` et non `Toaster` |
| `EmptyState` | Catalogue vide (voir États) |
| `Skeleton` | Chargement, à la forme des cartes |

Aucun composant ni token hors de cette liste. Icônes Lucide, 20 px (page
publique, règle du système).

## États

| État | Ce que l'écran montre |
|---|---|
| **Chargement** | Trois `Skeleton` à la forme exacte d'une carte d'offre. Pas de spinner, pas de saut de mise en page. |
| **Vide** | `EmptyState` — le catalogue est valide mais ne contient aucune offre. Titre, explication, et l'action qui sort de l'état : éditer `config/billing.ts`. Un écran de tarifs vide sans action est un écran cassé. |
| **Erreur** | Le catalogue malformé **n'atteint jamais cet écran** : `parseBillingCatalogue` s'exécute au démarrage (`next.config.ts`) et arrête le processus en nommant l'offre fautive. L'erreur affichable ici est celle du CTA — le checkout refuse — rendue dans un `Alert` `destructive` au-dessus de la grille, avec un moyen de réessayer, jamais un code technique brut. |
| **Succès** | Aucun état de succès sur cette page : le succès est une navigation vers le tunnel de paiement. Pas de `Toaster` pour une action qui quitte l'écran. |
| **Module coupé** | La page **n'existe pas** — 404 par `notFound()` sur `billing.available`, et l'entrée de navigation disparaît avec le module. Aucune condition dans un composant. |
| **Visiteur anonyme** | Le CTA reste **visible** et mène à la connexion, porteur de l'offre choisie. Il ne disparaît pas : masquer une offre payante empêche de la vendre (règle « Réservé à une offre » du système, s21). |
| **Avant hydratation** | Le CTA est désactivé jusqu'à l'hydratation, et le reste sans JavaScript. Un `Alert` le dit plutôt que de laisser un bouton mort. |

## Ce que le design ne tranche pas

- **Le libellé de périodicité de l'offre annuelle.** La maquette montre
  « 290 €/an ». Afficher « 24,17 €/mois facturé annuellement » est une division
  que personne ne valide aujourd'hui, et la recherche l'a laissée ouverte
  (`docs/research/s22-pricing-page.md`, questions ouvertes). Le plan tranche.
- **La mise en avant d'une offre.** La maquette met `pro-yearly` en `default`.
  Rien dans `config/billing.ts` ne déclare aujourd'hui qu'une offre est
  recommandée — le design ne peut pas inventer un champ de configuration.

## Design system gaps

1. **Aucun en-tête public n'est décrit.** La section « Navigation » du système
   ne couvre que la barre latérale applicative, construite depuis les modules
   actifs. La page de tarifs est publique et a besoin d'un point d'accès — le
   critère 6 parle explicitement de « la navigation publique ». Le système ne
   dit pas ce qu'est cette navigation ni de quoi elle est faite. **À trancher,
   pas à combler ici.**
2. **`display` est réservé au héros marketing** (`3rem / 600`, « Héros marketing
   uniquement (s10) »). Un prix est le second élément le plus gros d'une page de
   tarifs. La maquette utilise `h1` pour le prix afin de ne pas enfreindre la
   règle, ce qui l'aplatit visuellement. Soit le système autorise `display`
   ailleurs, soit il assume cette hiérarchie.

## Écarts assumés à l'exécution (consignés après la revue)

Trois éléments décrits ci-dessus **ne sont pas livrés**. Ce document les
décrivait encore, ce qui laissait croire à un oubli : ils sont écartés
délibérément, et voici pourquoi.

| Écarté | Où c'était décrit | Pourquoi |
|---|---|---|
| La **liste de bénéfices** par offre | « liste » dans le schéma d'écran, `<ul><li>` de la maquette | Aucune source de données n'existe. Les bénéfices d'une offre devraient venir de `config/billing.ts`, et le plan interdit d'y ajouter un champ. Les inventer dans le composant en ferait du texte en dur, que `tests/rendered-text.test.ts` refuse. |
| Le `Badge` « **Paiement unique** » | tableau des composants, colonne « Où / pourquoi » | La ligne de périodicité de la carte dit déjà « paiement unique » (`periodicityKeyOf`). Un badge qui répète la ligne au-dessus n'ajoute aucun état — et le système ne veut pas de badge décoratif. Le `Badge` reste employé pour l'essai, qui est un état que rien d'autre ne dit. |
| L'état « **Chargement** » (`Skeleton`) | tableau des états | L'écran n'attend aucune donnée : le catalogue est mémorisé pour tout le processus (`apps/web/lib/billing-catalogue.ts`) et validé au démarrage. Il n'y a pas de fenêtre à couvrir, et le dépôt n'a de `loading.tsx` nulle part — en introduire un ici serait un motif nouveau pour un chargement qui n'existe pas. |

L'état « **Erreur** » est livré, mais **pas où le design le plaçait** : le refus
du checkout s'affiche dans la carte, sous le bouton qui l'a demandé
(`BillingAction` rend son propre `Alert` `destructive` depuis `BILLING_KEYS.refusal.*`),
et non « au-dessus de la grille ». Le bouton est lui-même le moyen de réessayer.
Une erreur affichée loin du bouton qui l'a produite, sur une page qui en porte
trois, n'aurait pas dit lequel a refusé.

## Correction à une phrase d'ADR 045

ADR 045 écrit en conséquence que la page « rend du HTML — ce qui la rend
cacheable ». **Elle ne l'est pas** : `pnpm build` la classe `ƒ (Dynamic)`, parce
qu'elle lit `currentViewer()` à chaque requête pour choisir entre un lien vers la
connexion et le déclencheur de checkout. Ce que la décision garantit vraiment,
et qui reste vrai, est l'**absence d'effet de bord** — aucun rejeu d'URL n'écrit
quoi que ce soit. Un ADR accepté est immuable : la phrase reste, la correction
est ici. Rendre la page réellement cacheable demanderait de sortir la branche de
session du rendu serveur, ce qu'aucune story n'a demandé.

## Dérive documentaire relevée (hors périmètre de cette story)

`docs/design-system.md:5` annonce « shadcn/ui sur **Base UI** (ADR 009) », et la
section Do/Don't répète « Importer Base UI uniquement dans `packages/ui` ». Or
`AGENTS.md` et l'**ADR 022** ont tranché l'inverse : Radix UI, « Base UI n'a
jamais publié de version stable ». Le système de design n'a pas suivi sa propre
décision. Ce n'est pas un défaut de cette story et le corriger ici mélangerait
les périmètres — mais un agent qui lit le système de design en premier importera
Base UI, et rien ne l'arrêtera.
