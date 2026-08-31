# Design — Story s11-public-forms

Dérivé de `docs/design-system.md`. **Aucun composant ni token inventé** : les deux formulaires
composent avec `MarketingSection`, `Card`, `Label`, `Input`, `Button` et `Alert`, tous à
l'inventaire du document et déjà copiés dans `packages/ui`. Une seule primitive s'ajoute au
baril, `Textarea`, qui figure nommément à l'inventaire de `docs/design-system.md` (ligne
« `Input`, `Textarea`, `Select`, `Checkbox`, `RadioGroup`, `Switch` — Champs de saisie ») et
n'était simplement pas encore copiée — même geste que `Accordion` en s10.

## Design system gaps — signalés, non comblés

1. **`Form` / `FormField` / `FormMessage`** sont à l'inventaire du document (« Liaison
   react-hook-form + Zod, message d'erreur sous le champ ») et **n'existent pas** dans
   `packages/ui` : c'est une dette nommée dans `docs/STATE.md`. Les deux formulaires de s11
   composent donc à la main — `Label` + `Input`/`Textarea` + message d'erreur en `Alert` —,
   exactement comme `AuthForm` (s07). Rien n'est construit ici « en attendant » : construire un
   `Form` maison dans une story de fonctionnalité serait décider du design system dans un
   commit de fonctionnalité.
2. **Aucun composant de champ honeypot** n'existe et il n'en faut pas : le piège est un
   `<input>` natif masqué par la classe utilitaire `hidden`, pas une primitive.

## Écrans

### 1. Section « newsletter » — sur `/`, dans l'ordre de `config/marketing.ts`

Nouvelle **nature de section**, rendue par `MarketingHome` comme les cinq autres. Elle porte un
titre, une description et un formulaire à un champ. La position dans la page est décidée par la
configuration, pas par le composant.

```
── MarketingSection (h2 + description, py-16 / md:py-24, filet au-dessus) ──

  ┌ Card ──────────────────────────────────────────────────────────┐
  │  CardContent (space-y-3)                                        │
  │                                                                 │
  │   <form method="post">                                          │
  │     ┌ sm:flex, gap-2 ────────────────────────────────────────┐  │
  │     │ [Label « Adresse email » (sr-only en ≥sm ? non : visible)]│ │
  │     │ [ Input type=email, required, autoComplete=email  ] [Btn]│ │
  │     └──────────────────────────────────────────────────────────┘│
  │     (champ piège, display:none, aria-hidden, tabIndex -1)        │
  │                                                                 │
  │   Alert role="status" | role="alert"  ← après soumission        │
  └─────────────────────────────────────────────────────────────────┘
```

- **Un seul champ visible.** Demander un nom pour une newsletter est du frottement gratuit.
- Le `Label` est **toujours rendu** (jamais un `placeholder` en guise d'étiquette) : sans nom
  accessible, `getByLabel` ne trouve rien et le champ est anonyme pour une aide technique.
- Sous `sm`, champ et bouton s'empilent ; au-delà, ils sont sur une ligne
  (`flex-col sm:flex-row`).
- Le bouton est `variant="default"`, **désactivé jusqu'à l'hydratation** — c'est l'affordance
  imposée par le document (« Avant l'hydratation »).

**États, et un seul à la fois :**

| État | Rendu |
|---|---|
| repos | le formulaire |
| en envoi | bouton désactivé, libellé inchangé (pas de spinner : le document l'interdit plein écran, et un bouton `pending` suffit) |
| accepté | `Alert` `variant="success"` `role="status"` sous le champ, formulaire retiré |
| trop de soumissions | `Alert` `variant="warning"` `role="alert"`, formulaire conservé |
| panne réseau | `Alert` `variant="destructive"` `role="alert"`, formulaire conservé |

**Le succès est le même message pour une adresse nouvelle, une adresse déjà inscrite et une
adresse malformée** — c'est la décision §3 de la recherche, et elle se voit à l'écran : il n'y a
pas d'état « déjà inscrit ».

### 2. Écran de contact — `/contact`

Rendu dans l'`AppShell`, comme toute page publique du dépôt (s10). En-tête via
`MarketingSection` (`headingLevel={1}`, `display` **non** posé : la typographie `display` est
« héros marketing uniquement » selon le document, et cette page n'est pas un héros).

```
┌ Sidebar ─┐┌ Header : [☰] marque … [Langue] [Thème] ─────────────┐
│ Accueil  ││                                                      │
│ Connexion││  ── MarketingSection h1 « Nous contacter » ───────   │
│          ││     description (body-lg, max-w-2xl)                 │
│          ││                                                      │
│          ││   ┌ Card (max-w-2xl) ──────────────────────────────┐ │
│          ││   │ CardContent, space-y-4                          │ │
│          ││   │  <form method="post">                           │ │
│          ││   │   [Label Nom]                                   │ │
│          ││   │   [ Input                                    ]  │ │
│          ││   │   [Label Adresse email]                         │ │
│          ││   │   [ Input type=email                         ]  │ │
│          ││   │   [Label Message]                               │ │
│          ││   │   [ Textarea rows=6                          ]  │ │
│          ││   │   (champ piège masqué)                          │ │
│          ││   │   [Alert destructive role=alert]  ← si refus    │ │
│          ││   │   [ Envoyer le message ]                        │ │
│          ││   └─────────────────────────────────────────────────┘│
│          ││                                                      │
│          ││  ── Pied de page (Separator + liens légaux + contact)│
└──────────┘└──────────────────────────────────────────────────────┘
```

**États :**

| État | Rendu |
|---|---|
| repos | le formulaire |
| en envoi | bouton désactivé |
| envoyé | `Alert` `variant="success"` `role="status"` **à la place du formulaire** — le critère 1 demande « affiche une confirmation » |
| champ invalide | `Alert` `variant="destructive"` `role="alert"` **au-dessus des champs**, et `aria-invalid` sur le champ nommé par le serveur. C'est la place que le document impose à l'erreur globale d'un formulaire ; la saisie est conservée |
| trop de soumissions | `Alert` `variant="warning"` `role="alert"` |
| email non parti | `Alert` `variant="destructive"` `role="alert"`, disant de réessayer — jamais un code technique |

`aria-invalid` n'est pas décoratif : `Input` porte déjà `aria-invalid:border-destructive
aria-invalid:ring-destructive/40` dans ses classes (`packages/ui/src/components/input.tsx`), donc
l'attribut **est** la présentation de l'erreur au champ. Rien à ajouter.

### 3. Pied de page — un lien de plus

`MarketingFooter` liste aujourd'hui les documents légaux. Il gagne le lien `/contact`, **dérivé
de `marketingSite`** comme les autres : module coupé, la liste est vide et le lien disparaît avec
la page. Aucune condition « si le module existe » n'est écrite nulle part.

## Tokens et classes — ce qui est employé

Uniquement des utilitaires déjà présents dans le dépôt et des tokens sémantiques :
`bg-card`, `text-muted-foreground`, `border-border`, `text-destructive` (via les variantes
d'`Alert`), l'échelle d'espacement par défaut, `rounded-md` dérivé de `--radius`. **Aucune
couleur Tailwind brute.** Le `Textarea` copié reprend exactement les classes d'`Input`, à la
hauteur près (`min-h-24` au lieu de `h-10` : un champ multiligne n'a pas de hauteur de ligne
unique), et garde `field-sizing-content` hors jeu — non employé ailleurs dans le dépôt.

## Responsive

- **≥ 768 px** : carte de contact bornée à `max-w-2xl`, champ newsletter et bouton sur une ligne.
- **< 400 px** (critère de s08) : tout s'empile, `min-w-0` sur les conteneurs de grille comme
  ailleurs dans le module, `w-full` sur les champs et sur le bouton de la newsletter. Aucun
  débordement horizontal — à vérifier à l'œil, `pnpm test` ne le voit pas.

## Thème sombre

Rien de spécifique : tous les tokens employés sont définis dans les deux thèmes
(`packages/ui/src/styles.css`). Le seul point à regarder à l'œil est le contraste des `Alert`
`success` / `warning` en sombre, qu'aucune commande du dépôt ne mesure
(`packages/ui/AGENTS.md`, « Sur quoi repose l'accessibilité »).

## Accessibilité — ce sur quoi ça repose

1. Chaque champ a un `Label` **relié** par la primitive Radix : les parcours désignent par
   `getByLabel`, un champ anonyme fait rougir `pnpm test:e2e`.
2. Le retour est annoncé : `role="status"` pour une confirmation, `role="alert"` pour un refus.
   `Alert` ne pose **aucun rôle par défaut**, délibérément — c'est l'appelant qui dit ce qu'il
   annonce (`packages/ui/src/components/alert.tsx`).
3. Le champ piège est `aria-hidden="true"`, `tabIndex={-1}`, `autoComplete="off"` : il ne doit
   être atteignable ni au clavier, ni par un lecteur d'écran, ni par l'auto-remplissage.
4. Le bouton désactivé avant hydratation est visible et grisé, pas absent : un contrôle qui
   apparaît après coup déplace la mise en page.

## Vérification visuelle attendue (tracée en revue)

`/` et `/contact`, thème clair et sombre, 1280 px puis 380 px, **plus la même chose sous
`pnpm build && pnpm start`** pour la politique de sécurité du contenu : aucun attribut `style`
émis, aucune violation en console.

Maquette de référence : `docs/designs/s11-public-forms.html` — référence visuelle, pas du code.
