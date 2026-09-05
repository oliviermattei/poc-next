# packages/ui — règles locales

Le design system : tokens, primitives copiées depuis shadcn/ui, composés maison.
`docs/design-system.md` fait autorité — ce package en est la transcription, pas
la source.

**C'est la seule frontière avec le socle de composants** (ADR 022). Aucun module,
aucun écran n'importe Radix : ils composent avec le baril `@repo/ui`. C'est cette
frontière qui garde le passage à Base UI — le jour où il publiera une version
stable — à un coût borné plutôt qu'à un refactor traversant. Ce n'est pas une
intention : `pnpm lint` refuse `@radix-ui/*` ailleurs, et `tests/lint-rules.test.ts`
soumet chaque écriture à la configuration réelle du dépôt.

**Ce qui est balayé**, cas par cas, et rien de plus : import statique, import de
type, réexport, sous-chemin, import dynamique, gabarit, l'import de type en
position d'annotation (`import('@radix-ui/…').P`) et le paquet unifié
`radix-ui` — croisés avec les neuf emplacements soumis à la garde (`apps/**`,
`packages/**`, `packages/config/src`, `packages/modules/**`, `tooling/**`,
`config/`, `scripts/`, `generated/`, les fichiers de premier niveau), en `.ts`,
`.tsx`, `.mts`, `.cts`, `.mjs` et `.jsx`. La revue de s08 a mesuré que deux de
ces emplacements pouvaient être vidés sans qu'un test ne bouge, que l'écriture en
position d'annotation passait partout, et que `generated/` — les barils produits
par `pnpm db:generate`, versionnés et compilés — n'était dans aucune portée :
chaque emplacement a désormais ses cas, et neutraliser l'un d'eux fait rougir
`pnpm test`.

**Non balayé, et connu** : un spécificateur reconstruit à l'exécution
(`import('@radix' + '-ui/…')`), les fichiers du harnais de test (`tests/`,
`e2e/`, `packages/*/src/**/*.test.ts`) — exception nommée —, et `templates/`
comme `docs/`, qui ne portent aucune source aujourd'hui. Mesuré une écriture à
la fois contre la configuration réelle, le 31 août 2026.

## Aucun texte, jamais

Ce package ne connaît ni catalogue, ni locale, ni `next-intl`. **Tout texte
affiché arrive en prop**, déjà traduit par l'appelant : `label`, `openLabel`,
`closeLabel`, `options`. Un composant qui écrit un mot en dur le rend dans une
seule langue, y compris dans les projets qui n'ont pas activé le module `i18n`.

Ce n'est pas une intention : `tests/i18n.test.ts` balaie les `.tsx` de
`packages/ui/src` comme ceux de `apps/web/app`, et **un mot suffit** dans une
position affichée. Le « Fermer » du bouton de fermeture de `Sheet` a vécu ici
jusqu'à la revue de s09, invisible parce que le détecteur d'alors demandait deux
mots ou un accent.

## Les tokens

Tailwind v4 : **pas de `tailwind.config.js`** (ADR 010). Tout est dans
`src/styles.css` — `@import "tailwindcss"`, les variables de `:root` et `.dark`,
et le bloc `@theme inline` qui les expose comme utilitaires. Toute recette
trouvée en ligne antérieure à la v4 est inapplicable.

`tests/design-system.test.ts` confronte ces variables à celles de
`docs/design-system.md`, nom par nom et valeur par valeur : un token inventé, une
valeur qui dérive ou une couleur non exposée à `@theme` fait échouer `pnpm test`.
Un token qui manque n'est donc pas un oubli à combler ici — c'est un **design
system gap**, à signaler dans la story.

**`source(none)` : ce qui n'est pas déclaré n'est pas balayé, et rien n'échoue.**
Chaque source est écrite — ici pour ce package, dans `apps/web/app/globals.css`
pour l'application et pour les composants des modules. Une classe employée dans
un fichier qu'aucune source ne couvre ne produit **aucune règle**, sans erreur ni
avertissement : mesuré à l'œil en s10, la grille des fonctionnalités restait sur
une colonne à 1280 px et les liens du pied de page se touchaient. Deux formes, et
elles ne se valent pas — un chemin **sans motif** est un dossier balayé en
entier, un chemin **contenant un `*`** est un motif de **fichiers**, si bien que
`…/presentation` seul ne balaie rien là où `…/presentation/**/*.tsx` balaie.
`tests/design-system.test.ts` dérive les deux côtés — les `.tsx` du dépôt et les
motifs déclarés — et rougit sur un fichier non couvert.

Le thème sombre est piloté par la **classe** `.dark` sur `<html>`
(`@custom-variant dark`), jamais par `prefers-color-scheme` seul : le
commutateur doit pouvoir contredire le système.

## Aucun style en ligne rendu par le serveur (s45)

Un attribut `style` présent dans le HTML servi est gouverné par
`style-src-attr`, **la seule directive CSP qui ne connaît pas les nonces** : sous
la politique de production, il est refusé et la console inscrit une violation à
chaque visite. Le nonce ne peut donc rien pour lui — il n'y a qu'à ne pas en
émettre.

Deux conséquences, et elles sont exécutables :

- `AccordionContent` neutralise `--radix-accordion-content-height` et
  `--radix-accordion-content-width`, que `@radix-ui/react-accordion` 1.2.20
  écrit toujours et dont aucune règle de `src/styles.css` ne se sert. Le style
  d'un appelant, lui, passe : la neutralisation est posée avant `props.style` ;
- un composant du design system qui aurait besoin d'une valeur dynamique la
  déclare dans `src/styles.css`, jamais en ligne.

`tests/security-headers.test.ts` rend un accordéon et refuse tout attribut
`style` ; `e2e/security-headers.spec.ts` mesure la même chose sur le HTML
réellement servi, plus le silence de la console.

**Ce qui n'est pas concerné** : les écritures CSSOM
(`element.style.transform = …`) que font Radix et Floating UI après hydratation.
Mesuré — le positionnement des menus est identique avec et sans politique. CSP
ne gouverne que les attributs analysés dans le HTML.

## Imports autorisés

- `@radix-ui/react-accordion`, `@radix-ui/react-avatar`, `@radix-ui/react-dialog`,
  `@radix-ui/react-dropdown-menu`, `@radix-ui/react-label`,
  `@radix-ui/react-separator`, `@radix-ui/react-slot` —
  **ici et nulle part ailleurs**. `@radix-ui/react-avatar` est arrivé avec s18 :
  c'est lui qui porte le **repli sur les initiales** quand l'image manque ou ne
  se charge pas, et c'est ce qui évite qu'un écran porte un `if (avatar ?)` ;
- `class-variance-authority` pour les variantes, `clsx` et `tailwind-merge` pour
  la composition de classes (`cn`) ;
- `lucide-react` pour les icônes : un seul jeu, 16 px dans l'application ;
- `next-themes` pour le thème ;
- `get-nonce` — **dans `src/composed/inline-style-nonce.tsx` seulement**. Ajouté
  par s45 : sous une politique de sécurité du contenu stricte, le `<style>` que
  `react-remove-scroll` injecte à l'ouverture d'un `Sheet` ou d'un
  `DropdownMenu` est refusé s'il ne porte pas le nonce de la requête, et le fond
  de page continue de défiler derrière le panneau ouvert. `setNonce` est l'API
  publiée par `react-style-singleton` pour cela, et la seule qui ne dépende pas
  d'un identifiant de bundler : la lecture par défaut passe par
  `__webpack_nonce__`, que Turbopack ne pose pas (mesuré) ;
- `react` et `react-dom`, déclarés en `peerDependencies` : c'est l'application
  qui fournit sa version ;
- `@repo/typescript-config` pour la configuration du compilateur.

Pas de `next` : ce package ne connaît ni le routeur, ni les composants serveur
de l'application. Un lien est un `<a href>` ; ce qui a besoin de `usePathname`
vit dans `apps/web`.

## Ne doit jamais contenir

- de couleur Tailwind brute (`bg-zinc-800`, `text-red-500`) : elle casse le thème
  sombre et la thématisation par projet. Les utilitaires du dépôt sont les tokens
  sémantiques — `bg-background`, `text-muted-foreground`, `border-border` ;
- de composant absent de `docs/design-system.md`. L'inventaire du document est la
  liste de ce qui **peut** exister ; ce baril est la liste de ce qui existe
  aujourd'hui. En inventer un ici, c'est décider du design system dans un
  commit de fonctionnalité ;
- d'ombre portée sur une surface statique : l'élévation se fait par bordure et
  par fond. L'ombre est réservée aux surfaces flottantes (dialogue, popover,
  menu) ;
- de règle métier, d'appel réseau, de lecture d'environnement : ce package ne
  sait rien du produit. Il reçoit des propriétés et affiche.

## Composants copiés à ce jour

Ceux que s08 utilise réellement, et rien de plus — copier l'inventaire complet
« pour plus tard » livrerait du code que personne n'a exercé :

| Copiés | `Accordion`, `Alert`, `Avatar`, `Badge`, `Breadcrumb`, `Button`, `Card`, `Checkbox`, `DropdownMenu`, `Input`, `Label`, `Separator`, `Sheet`, `Textarea` |
| --- | --- |
| Composés maison | `CookieBanner`, `EmptyState`, `LocaleSwitcher`, `MarketingSection`, `OrgSwitcher`, `PageHeader`, `Pagination`, `Sidebar` / `SidebarNav`, `ThemeProvider`, `ThemeToggle`, l'échelle de prose (`PROSE_CLASSNAME`, `proseComponents`) |

Le reste de l'inventaire de `docs/design-system.md` — `Form`, `Table`,
`DataTable`, `Tabs`, `Toaster`, `Command`, `AlertDialog`, `Tooltip`,
`Popover`, `Skeleton`, `Progress`, `ScrollArea`,
`RadioGroup`, `Select`, `Switch`,
`ConfirmDialog`, et les composés des stories à venir — **n'est pas encore
copié**. C'est la liste au 5 septembre 2026, révisée par s10, s11, s18, s36,
s29 puis s30 ; le document fait foi, pas ce tableau — **et ce tableau avait
déjà été pris en défaut deux fois**, ce qui est la raison de la phrase
précédente :

- `Pagination` y est resté « non copié » alors que **s29** le livrait et
  l'exportait. Corrigé ici : il est **composé maison**, pas copié de shadcn/ui —
  des liens plutôt que des boutons, la page courante distinguée par la primaire
  et par `aria-current` ;
- `Avatar` y a figuré jusqu'à **s30** alors que le baril l'exporte depuis
  **s18** : décalage antérieur à s29, signalé par elle plutôt que tu, et rangé
  ici dans la ligne des copiés.

**Ce qui a changé en s30 : la commande existe.**
`tests/design-system.test.ts` confronte le paragraphe ci-dessus au baril, par
nom exact, et refuse qu'un composant y soit déclaré « pas encore copié » alors
qu'il est exporté. Elle a rougi sur `Avatar` et sur `Breadcrumb` dès sa
première exécution. **Ce qu'elle ne vérifie pas** : qu'un composant exporté
figure bien dans l'une des deux lignes du tableau — ce sens-là demanderait de
rattacher `AccordionContent` à `Accordion`, donc une correspondance par
sous-chaîne, qui ferait couvrir `Table` par `DataTable`. Cette moitié-là reste
de la relecture.

`Breadcrumb` est arrivé avec **s30**, copié de shadcn/ui pour le fil d'Ariane de
la documentation, sans son `BreadcrumbEllipsis` — aucun écran ne replie de fil,
et ce package ne livre pas de code que personne n'exerce. `ScrollArea` et
`Command` sont restés non copiés pour la même raison : le premier n'est pas
nécessaire à une navigation de documentation, le second est la palette de
recherche de `s54-docs-recherche`.

`Checkbox` et `CookieBanner` sont arrivés avec **s36**, que le document attribue
nommément au second (« Bannière de consentement (s36) »).

**`Checkbox` est l'élément natif, et c'est une décision, pas un raccourci.**
`@radix-ui/react-checkbox` rend un `<button>` doublé d'un `<input>` masqué : la
case ne se coche pas tant que JavaScript n'a pas pris la main, et sa valeur ne
part pas dans une soumission native. Le premier formulaire qui l'emploie est
celui du consentement aux cookies, dont **toute** la propriété est de
fonctionner sans script — refuser des cookies ne peut pas dépendre du script
qu'on refuse. La règle « un composant maison qui réimplémente un comportement
Radix est un défaut d'accessibilité en attente » n'est pas contredite : rien
n'est réimplémenté ici, c'est la plateforme qui porte le focus, la barre
d'espace, l'état indéterminé, l'association à l'étiquette et l'envoi du champ.
`accent-color` teinte la case avec le token du produit sans redessiner un
contrôle.

`CookieBanner` **n'expose pas de variante par bouton**, et c'est la même
discipline : « tout refuser » et « tout accepter » partagent variante et taille.
Un appelant qui pourrait rendre le refus discret rendrait la bannière non
conforme sans qu'aucune commande ne le voie.

`Textarea` est arrivé avec **s11** : le message du formulaire de contact. Il
reprend les classes d'`Input` à la hauteur près (`min-h-24`, `resize-y` — un
redimensionnement horizontal déborde la carte sous 400 px). **`Form`,
`FormField` et `FormMessage` restent non construits** alors que le document les
annonce : les formulaires de s07, s15 et s11 composent tous `Label`, `Input` et
`Alert` à la main. C'est un *design system gap* ouvert, signalé dans
`docs/designs/s11-public-forms.md` et dans `docs/STATE.md`, pas une primitive à
inventer dans un commit de fonctionnalité.

`OrgSwitcher` est arrivé avec **s15**, que le document lui attribue nommément.
Il reprend `LocaleSwitcher` à une différence près, et elle est tranchée : les
options du sélecteur de langue sont des **liens** (la langue vit dans l'URL,
donc un `GET` la change), celles du sélecteur d'organisation sont des **boutons
de soumission** d'un `<form method="post">`. Basculer d'organisation change un
état serveur ; un `GET` qui change un état serveur est une faute d'HTTP autant
qu'une porte ouverte à la requête intersite.

**Le menu a besoin de JavaScript pour s'ouvrir**, et c'est structurel : Radix
monte son contenu dans un portail à l'ouverture, qui est un état React. La revue
de s15 a relevé qu'un visiteur sans script voyait donc ses organisations sans
pouvoir en changer. Le repli est un `<noscript>` **dans le même formulaire** :
les mêmes options en boutons de soumission natifs, l'organisation courante
exclue puisque le déclencheur la porte déjà — deux boutons du même nom seraient
indiscernables pour une aide technique. Rien d'inline n'est ajouté (la CSP
interdit `unsafe-inline`), et le navigateur masque le bloc dès que le script
tourne. `e2e/organizations.spec.ts` le parcourt avec `javaScriptEnabled: false` ;
c'est le seul endroit du dépôt qui puisse le prouver, un rendu statique n'ayant
pas de moteur qui décide d'afficher un `<noscript>`.

**L'échelle de prose n'est ni une primitive copiée ni un composé d'écran**, et
c'est pour ça qu'elle a l'air d'un intrus ici : c'est une table de composants
MDX (`proseComponents`) plus une classe de mesure de ligne (`PROSE_CLASSNAME`),
transcription du § « Échelle de prose » de `docs/design-system.md`. Elle est
arrivée par **s29** dans `@repo/module-blog/presentation` et a été remontée ici
par **s30** (ADR 055) : trois modules rendent du MDX (blog, documentation,
changelog), et la laisser dans l'un d'eux aurait exigé `requires: ['blog']` sur
les deux autres — donc un produit où `pnpm ks toggle blog` refuse tant que la
documentation est activée. Ne pas la redescendre dans un module : c'est le
document qui la décide, pas le module qui l'affiche.

`createProseComponents` est le même objet **paramétré par une seule chose**,
l'ancre d'un titre : la documentation a besoin d'un `id` sur ses `h2`/`h3` pour
que son sommaire pointe quelque part, le blog n'en a pas. Sans le paramètre,
la documentation devrait redéclarer les classes des titres, c'est-à-dire une
seconde typographie par la porte de derrière. `proseComponents` est
`createProseComponents()` — sans ancre — et c'est ce que le blog emploie.

`Accordion` et `MarketingSection` sont arrivés avec s10 : le premier porte la
FAQ marketing (que le document lui attribue explicitement), le second est
l'enveloppe des sections pilotées par `config/marketing.ts`. **Aucun composant
de pied de page n'a été ajouté** : le document n'en décrit pas, et le pied de
page du site public est composé de `Separator`, de liens et de tokens dans la
couche `presentation` du module `marketing`. Le manque est signalé comme
*design system gap* dans `docs/designs/s10-marketing-site.md`, pas comblé ici.

## Sur quoi repose l'accessibilité, faute de `jsx-a11y`

`eslint-plugin-jsx-a11y` **n'a pas de version compatible ESLint 10** : la
dernière publiée est la 6.10.2 (octobre 2024), et sa `peerDependency` s'arrête à
`^9`. Vérifié au registre le 31 août 2026. La dette ouverte par s02 (abandon
d'`eslint-config-next`) reste donc ouverte, et il n'existe aujourd'hui aucune
commande qui la ferme.

Ce sur quoi l'accessibilité repose à la place, et c'est tout :

1. **Les primitives Radix.** Verrouillage et restitution du focus, fermeture à
   l'échappement, `aria-modal`, `role="menu"`, navigation au clavier dans le
   menu, association étiquette-champ : rien de tout cela n'est écrit ici, et
   c'est précisément pourquoi le socle existe (ADR 022). Un composant maison qui
   réimplémenterait un de ces comportements est un défaut d'accessibilité en
   attente.
2. **Les noms accessibles sont des propriétés obligatoires**, pas des options :
   `SidebarNav` exige son `label`, `ThemeToggle` exige le sien. Un composant qui
   rend son nom accessible facultatif produit tôt ou tard un contrôle anonyme.
3. **Les parcours Playwright désignent par rôle et par nom** (`getByRole`,
   `getByLabel`). Un bouton sans nom accessible, un champ sans étiquette ou une
   navigation sans nom fait échouer `pnpm test:e2e` — c'est aujourd'hui le seul
   filet exécutable, et il ne couvre que ce que les parcours traversent.

Ce que rien ne vérifie, et qu'il faut donc regarder à la main : le contraste des
couleurs dans les deux thèmes, l'ordre de tabulation d'un écran entier, le texte
alternatif d'une image, et tout écran qu'aucun parcours ne visite.

## Tests

- `tests/design-system.test.ts` à la racine : les tokens contre le document qui
  fait autorité ;
- `tests/lint-rules.test.ts` : la frontière avec Radix, et la règle qui exige un
  `method` sur tout `<form>` — elle vise aussi ce package, où vivront les
  composants `Form` du design system (revue de s08, C1) ;
- `e2e/app-shell.spec.ts` : le thème, la navigation et le rendu sous 400 px dans
  un vrai navigateur.

Pas de test de rendu par composant : une assertion sur des classes ou sur du
balisage rougit à chaque changement légitime et reste aveugle aux défauts. Ce qui
se teste ici est le comportement (ce que l'utilisateur obtient), et il se teste
dans un navigateur.
