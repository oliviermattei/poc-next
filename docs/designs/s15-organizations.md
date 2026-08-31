# Design — s15-organizations

> Dérivé de `docs/design-system.md`. Aucun composant ni token inventé.
> Maquette de référence : `docs/designs/s15-organizations.html` — c'est une
> **référence**, pas du code : l'implémentation compose avec `packages/ui`.

## L'écran

Un seul : `/organizations`, dans le shell applicatif de s08, protégé côté
serveur (sans session, redirection vers `/sign-in` ; module coupé, 404).

```
PageHeader ─ « Organisations » / description
│
├─ Card « Organisation courante »
│    ├─ Badge (rôle : owner | admin | member)
│    └─ OrgSwitcher  ← composé du design system, s15
│
├─ Card « Paramètres »            (seulement s'il y a une organisation courante)
│    └─ form method="post" → nom, slug, Button
│
└─ Card « Créer une organisation »
     └─ form method="post" → nom, slug, Button
```

État vide — aucune organisation : `EmptyState` (icône `BuildingIcon` de
Lucide, titre, explication, action) à la place des deux premières cartes ; la
carte de création reste. « Un tableau vide sans action est un écran cassé »
(`docs/design-system.md`, § États).

## Composants employés

| Composant | Rôle ici | Origine |
|---|---|---|
| `PageHeader` | titre + description de l'écran | `@repo/ui`, composé |
| `Card` + `CardHeader/Title/Description/Content` | unité de base des pages de paramètres | `@repo/ui` |
| `OrgSwitcher` | **nouveau composé**, nommé par `docs/design-system.md` pour s15 | `@repo/ui`, à copier |
| `Button` | soumission des formulaires, action de l'état vide | `@repo/ui` |
| `Input`, `Label` | champs nom et slug | `@repo/ui` |
| `Alert` (`destructive`) | refus du serveur, au-dessus des champs | `@repo/ui` |
| `Badge` | rôle dans l'organisation courante | `@repo/ui` |
| `EmptyState` | aucune organisation | `@repo/ui`, composé |
| `DropdownMenu` | intérieur de `OrgSwitcher` | `@repo/ui` |

**Aucun design system gap.** Tout ce que l'écran demande existe dans
`packages/ui/src/index.ts`, à l'exception de `OrgSwitcher` — que le document
attribue nommément à cette story (« `OrgSwitcher` | Bascule d'organisation
(s15) »).

## `OrgSwitcher` — la spécification

Modèle : `LocaleSwitcher`. Mêmes principes, une différence tranchée.

```
OrgSwitcherProps {
  label: string          // nom accessible du déclencheur, déjà traduit
  current: string        // libellé de l'organisation courante, déjà traduit
  action: string         // URL de la route qui bascule
  fieldName: string      // nom du champ posté
  options: readonly { value: string; label: string }[]
}
```

- **Aucun texte en dur**, y compris le nom accessible : `packages/ui` ne connaît
  ni catalogue ni locale (`packages/ui/AGENTS.md`).
- Le nom accessible du déclencheur est une **prop obligatoire**, pas une
  option : « un composant qui rend son nom accessible facultatif produit tôt ou
  tard un contrôle anonyme » (idem).
- Chaque option est un **`<button type="submit" name=… value=…>`** dans un
  `<form method="post">`, et non un lien : basculer change un état serveur.
  `LocaleSwitcher` emploie des liens parce que la langue vit dans l'URL ; ici
  un `GET` serait une faute d'HTTP et une porte CSRF.
- L'option courante porte `aria-current="true"` et une coche (`CheckIcon`),
  comme `LocaleSwitcher` — même jeu d'icônes, Lucide, 16 px.
- Élévation par bordure et fond ; l'ombre reste au `DropdownMenuContent`, qui
  est une surface flottante.

## Tokens

Aucun token nouveau. L'écran n'emploie que des tokens sémantiques :
`bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`,
`bg-card`, `ring-ring`. Aucune couleur Tailwind brute.

## Formulaires — les deux règles héritées

`docs/design-system.md`, § « Avant l'hydratation » :

- le `<form>` déclare **`method="post"` écrit en toutes lettres** — `pnpm lint`
  le refuse autrement ;
- le bouton est désactivé jusqu'à l'hydratation.

**La seconde ne s'applique pas ici, et c'est un choix motivé** : ces
formulaires sont **natifs**, sans JavaScript. Ils postent directement vers la
route du module, qui répond 303 vers une destination constante. Il n'y a donc
aucune fenêtre pré-hydratation à couvrir — la soumission native *est* le
chemin nominal, pas un repli qui perdrait la saisie. La raison d'être de la
règle (« un clic qui devance l'hydratation part par le repli natif et l'action
est perdue en silence », `apps/web/AGENTS.md`) n'existe pas.

Contrepartie assumée : le `DropdownMenu` de `OrgSwitcher` a besoin de
JavaScript pour s'ouvrir. C'est un écran authentifié, pas une page publique.

## Erreurs et succès

Pas de `Toaster` : la réponse est une redirection, donc un rechargement
serveur. Le retour se lit dans l'URL et se rend par un `Alert` :

| Cas | Réponse | Ce que l'écran montre |
|---|---|---|
| création / renommage acceptés | 303 → `/organizations` | l'écran, à jour |
| nom ou slug invalide | 303 → `…?error=invalid` | `Alert` `destructive` |
| slug indisponible (réservé **ou** déjà pris) | 303 → `…?error=slug_unavailable` | `Alert` `destructive` |
| organisation d'un autre | **404** | rien : l'écran ne trahit pas l'existence |

**Un seul motif de refus pour « réservé » et « déjà pris ».** Deux messages
distincts feraient du formulaire de création un test d'existence d'organisation
(`docs/security.md` §7). Le message dit quoi faire — « choisissez un autre
identifiant » — sans dire pourquoi.

## Responsive et thème

- Mobile d'abord, utilisable sous 400 px sans débordement horizontal (critère
  hérité de s08) : les cartes s'empilent, `min-w-0` sur les conteneurs qui
  portent un slug ou un nom long, `truncate` sur le libellé du déclencheur.
- Les deux thèmes sont couverts par construction : aucune couleur n'est écrite,
  seulement des tokens définis dans `:root` et `.dark`.

## Ce que l'écran ne fait pas

- **Pas de sélecteur dans le shell.** Le placer dans `app/app-shell.tsx`
  imposerait une lecture de base à **chaque** rendu, y compris celui des pages
  publiques — et `tests/marketing.test.ts` mesure qu'aucune requête base de
  données n'a lieu au rendu du shell. Le sélecteur vit donc sur l'écran des
  organisations, atteint par l'entrée de navigation que le module déclare.
- **Pas de suppression d'organisation** : `ConfirmDialog` n'est pas copié, et
  la suppression appartient à s34 (`docs/design-system.md`, § Feedback).
- **Pas de gestion des membres ni d'invitations** : s16.
- **Pas de choix de rôle** : s17. Le créateur est `owner`, c'est le seul rôle
  attribué par cette story.

## Vérification visuelle — mesurée, pas déclarée

La première livraison cochait les tâches 8 et 10 sur une capture dont le dépôt
ne portait aucune trace, et la revue n'a pu ni la confirmer ni l'infirmer
(constat F6). Voici la mesure, refaite sur l'arbre corrigé, par une sonde
Playwright jetable (créée, exécutée, supprimée ; `git status` vérifié propre).
Les images ne sont pas versionnées — un PNG dans le dépôt vieillit sans que rien
ne le dise ; les **nombres**, eux, sont reproductibles par la même sonde.

Chromium, locale `fr-FR`, application démarrée par Playwright sur
`E2E_PORT=3115`, thème piloté par `colorScheme` (le `.dark` de `next-themes`).

| Cas | Débordement horizontal (`scrollWidth` / `clientWidth`) | Thème appliqué (`<html>`, fond du `body`) |
|---|---|---|
| 0 organisation — 1280 clair | 1280 / 1280 — aucun | `light`, `lab(100 0 0)` |
| 0 organisation — 1280 sombre | 1280 / 1280 — aucun | `dark`, `lab(2.75 0 0)` |
| 0 organisation — 390 clair | 390 / 390 — aucun | `light`, `lab(100 0 0)` |
| 1 organisation — 1280 clair | 1280 / 1280 — aucun | `light`, `lab(100 0 0)` |
| 1 organisation — 1280 sombre | 1280 / 1280 — aucun | `dark`, `lab(2.75 0 0)` |
| 1 organisation — 390 clair | 390 / 390 — aucun | `light`, `lab(100 0 0)` |
| 3 organisations — 1280 clair | 1280 / 1280 — aucun | `light`, `lab(100 0 0)` |
| 3 organisations — 1280 sombre | 1280 / 1280 — aucun | `dark`, `lab(2.75 0 0)` |
| 3 organisations — 390 clair | 390 / 390 — aucun | `light`, `lab(100 0 0)` |

Ce que les captures montrent, écran par écran :

- **zéro organisation** — l'`EmptyState` (icône, titre, description, action
  « Créer l'organisation » qui ancre sur le formulaire), puis la carte de
  création. Ni carte « Organisation courante », ni carte « Paramètres » : il n'y
  a rien à afficher, et rien n'est affiché à vide ;
- **une organisation** — carte « Organisation courante » avec le déclencheur du
  sélecteur et le badge « Propriétaire », carte « Paramètres » pré-remplie,
  carte de création ;
- **trois organisations** — identique, le déclencheur portant le nom de la
  courante ; les trois cartes s'empilent sans que rien ne sorte de la colonne ;
- **390 px** — la navigation devient le panneau du shell (s08), les cartes
  occupent toute la largeur, le déclencheur et le badge tiennent sur une ligne,
  les libellés d'aide passent à la ligne. Aucun texte tronqué autrement que par
  le `truncate` prévu sur le nom de l'organisation courante ;
- **sombre** — fond et bordures viennent des tokens `.dark` ; aucune surface ne
  reste claire, y compris le panneau de navigation, les champs et les badges.

## Le clavier seul, sur le menu portalisé

C'est là que ce genre de composant casse : Radix rend le contenu du menu dans un
portail, hors du `<form>`. Parcours mesuré par la même sonde, sans souris.

| Geste | Observé |
|---|---|
| focus sur le déclencheur | nom accessible = « Comptoir Sud », l'organisation courante |
| `Entrée` | le menu s'ouvre, le focus part sur la première option (« Atelier Nord ») |
| `Flèche bas` | le focus passe à l'option suivante (« Comptoir Sud ») |
| options annoncées | `["Atelier Nord", "Comptoir Sud", "Studio Martin"]`, par nom, dans l'ordre de l'écran |
| `Entrée` sur une option | la soumission part, la page revient sur `/organisations`, le déclencheur porte « Atelier Nord » — **la bascule se fait au clavier seul** |
| `Échap` | le menu se referme et le focus revient sur le déclencheur (`aria-haspopup="menu"`) |

**Sans JavaScript**, le menu ne s'ouvre pas — c'est structurel. Le repli est le
`<noscript>` du composé, éprouvé par `e2e/organizations.spec.ts` dans un
contexte `javaScriptEnabled: false`.

**Non vérifié**, dit plutôt que sous-entendu : aucun lecteur d'écran réel n'a été
lancé (l'annonce du changement d'organisation après la navigation n'est donc pas
mesurée), le contraste n'a pas été calculé, et un seul moteur a été employé
(Chromium).
