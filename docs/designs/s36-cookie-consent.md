# Design — s36-cookie-consent

> Dérivé de `docs/design-system.md`. Aucun composant ni token inventé. Les deux
> composants neufs de `packages/ui` sont **déjà inventoriés** par le document :
> `CookieBanner` (« Bannière de consentement (s36) ») et `Checkbox` (« Champs de
> saisie »). Ils sont copiés/composés, pas inventés.

## Les surfaces

| Surface | Fichier | Ce qui change |
|---|---|---|
| Bannière | `apps/web/app/app-shell.tsx` | une région fixe en bas de fenêtre, rendue **seulement** s'il reste une catégorie non décidée |
| Écran de préférences | `apps/web/app/cookies/page.tsx` (neuf) | les cases par catégorie, l'état courant, les trois boutons |
| Pied de page public | `packages/modules/marketing/src/presentation/marketing-footer.tsx` | un lien de plus, fourni par l'application |
| Paramètres du compte | `apps/web/app/account/page.tsx` | une `Card` « Cookies » de plus, en fin d'écran |

Un segment de premier niveau neuf — `cookies` — donc une entrée dans
`APPLICATION_SEGMENTS` (`apps/web/lib/organizations.ts`).

## Composants employés

`Button`, `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`,
`Badge`, `Label`, `Separator`, `PageHeader`, `EmptyState`, plus les deux neufs :
`Checkbox` et `CookieBanner`. Rien d'autre.

### `Checkbox` — natif, et c'est une décision

Le système inventorie `Checkbox` avec `Input`, `Textarea`, `Select`,
`RadioGroup`, `Switch`. Il est écrit comme un `<input type="checkbox">` **natif**
stylé par les tokens, et non sur `@radix-ui/react-checkbox`.

La raison est fonctionnelle et non esthétique : la primitive Radix rend un
`<button>` doublé d'un `<input>` caché, et **ne coche rien tant que JavaScript
n'a pas pris la main**. Or tout le formulaire de cette story est un `<form
method="post">` natif, précisément pour que le retrait de consentement
fonctionne sans script. Une case qui exige React pour être cochée détruirait la
seule propriété qui compte ici.

Rien n'est réimplémenté au passage : le focus, l'espace, l'association
étiquette-champ et l'envoi du champ sont ceux de la plateforme —
`packages/ui/AGENTS.md` interdit de réécrire un comportement que Radix porte,
pas d'utiliser l'élément que Radix imite.

Tokens : `border-input`, `text-primary`, `focus-visible:ring-ring`,
`rounded-sm`, taille `size-4` (16 px, la densité de l'application).

### `CookieBanner` — la forme retenue

```
┌─ fixed inset-x-0 bottom-0, z-50, border-t, bg-background ──────────────┐
│  max-w-4xl mx-auto, px-4 py-4, flex flex-col gap-3 md:flex-row         │
│                                                                        │
│  Cookies non essentiels                          h2, text-sm font-…    │
│  Ce site peut charger des services tiers…        text-sm muted         │
│  Personnaliser →                                 lien, underline       │
│                                                                        │
│                       [ Tout refuser ]  [ Tout accepter ]              │
└────────────────────────────────────────────────────────────────────────┘
```

- **`<form method="post">` écrit en toutes lettres** (règle de lint du dépôt).
  Les deux boutons sont des `<button type="submit" name="decision">` : aucun
  JavaScript n'est nécessaire, et le bouton n'a pas à être désactivé jusqu'à
  l'hydratation — cette affordance-là vise les formulaires qui appellent
  `fetch`, pas une soumission native ;
- **les deux boutons ont la même variante et la même taille**. « Refuser » n'est
  ni plus petit, ni en lien discret, ni derrière un écran de plus : c'est la
  condition légale, et c'est aussi ce que le parcours mesure (deux contrôles de
  même rôle, atteignables en un clic chacun) ;
- **`role="region"` + `aria-label` traduit** : la bannière n'est pas modale, elle
  ne piège pas le focus et ne bloque pas la navigation. Une bannière modale
  transformerait « refuser » en « ne plus pouvoir lire la page », qui est
  précisément la pratique que la loi refuse ;
- **rien d'inline** : ni attribut `style`, ni `<style>`, ni `<script>` — la
  politique de s45 refuserait les trois en production. L'élévation est portée par
  `border-t` et `bg-background`, conformément au système (« élévation par bordure
  et fond ») ;
- `min-w-0` sur la colonne de texte : cause n°1 de débordement sous 400 px.

Ordre de tabulation : le lien « personnaliser », puis « tout refuser », puis
« tout accepter ». La bannière est **en fin de document**, donc elle ne s'insère
pas devant le contenu pour un lecteur d'écran.

## L'écran `/cookies`

```
PageHeader — « Cookies » / « Choisissez ce que ce site a le droit de charger. »

┌─ Card ─────────────────────────────────────────────────────────────┐
│ Vos préférences                                                    │
│ Les cookies strictement nécessaires ne sont pas concernés.         │
├────────────────────────────────────────────────────────────────────┤
│  <form method="post">                                              │
│   ☑ Mesure d'audience                          [Badge: Accepté]    │
│     Comprendre comment le site est utilisé.                        │
│   ─────────────────────────────────────────────────────────────    │
│   ☐ Publicité                                  [Badge: Refusé]     │
│     Personnaliser les annonces affichées ailleurs.                 │
│                                                                    │
│   [ Tout refuser ]  [ Tout accepter ]      [ Enregistrer ]         │
│  </form>                                                           │
└────────────────────────────────────────────────────────────────────┘
```

- le `Badge` porte l'**état enregistré** : `success` « Accepté », `secondary`
  « Refusé », `warning` « En attente ». C'est le seul retour de succès de
  l'écran : après enregistrement, la page est rendue à nouveau et le badge a
  changé. Le système demande « un changement d'état visible pour une action
  locale », pas un `Toaster` en plus ;
- « Enregistrer » est `variant="default"`, les deux raccourcis sont
  `variant="secondary"` **tous les deux** — même remarque que sur la bannière :
  aucun déséquilibre entre accepter et refuser ;
- **aucun script déclaré** : la carte est remplacée par un `EmptyState`
  (icône `CookieIcon`, titre, explication, aucune action) qui dit que le site ne
  charge aucun service non essentiel. C'est le critère 7 rendu visible plutôt que
  laissé à une page vide ;
- module `consent` coupé : l'écran répond **404**, même arbitrage que
  `/organizations` et `/legal/<slug>`.

## La carte « Cookies » des paramètres de compte

Une `Card` de plus en fin de `/account`, présente **quel que soit l'état du
module `marketing`** — c'est elle qui tient le critère 6 :

```
┌─ Card ─────────────────────────────────────────────────────┐
│ Cookies                                                    │
│ Modifiez ou retirez votre consentement à tout moment.      │
├────────────────────────────────────────────────────────────┤
│  [ Gérer mes cookies ]   → /cookies                        │
└────────────────────────────────────────────────────────────┘
```

Un `Button asChild` autour d'un `<a>` : c'est un lien, pas une action.

## Le lien du pied de page

Ajouté aux liens existants du pied de page public (`legalDocuments`, puis
`contact`, puis lui). Même style que les autres — le pied de page n'a qu'un style
de lien, écrit une fois. Il est **fourni par l'application** : le module
`marketing` reçoit une liste `footerLinks`, il ne connaît pas le consentement.

## Icônes

`CookieIcon` de `lucide-react`, 16 px, uniquement dans l'`EmptyState` de
`/cookies`. Aucune icône dans la bannière : elle n'ajouterait rien à un texte
déjà court, et une icône décorative dans une région d'annonce est du bruit pour
un lecteur d'écran.

## Thème sombre et 400 px

Toutes les couleurs sont des tokens sémantiques, donc définies dans les deux
thèmes. La bannière passe en colonne sous `md`, les boutons occupant toute la
largeur (`w-full md:w-auto`) : deux boutons côte à côte sous 400 px seraient
tronqués, et un bouton tronqué est un bouton qu'on ne clique pas.

## Design system gaps

Aucun **nouveau** gap. Les deux gaps déjà ouverts restent ouverts et ne sont pas
comblés ici : `Form` / `FormField` / `FormMessage` (annoncés, non construits) et
l'absence de composant de pied de page.
