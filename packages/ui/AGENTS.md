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
`radix-ui` — croisés avec les huit emplacements soumis à la garde (`apps/**`,
`packages/**`, `packages/config/src`, `packages/modules/**`, `tooling/**`,
`config/`, `scripts/`, les fichiers de premier niveau), en `.ts`, `.tsx`,
`.mts`, `.cts`, `.mjs` et `.jsx`. La revue de s08 a mesuré que deux de ces
emplacements pouvaient être vidés sans qu'un test ne bouge, et que l'écriture en
position d'annotation passait partout : chaque emplacement a désormais ses cas,
et neutraliser l'un d'eux fait rougir `pnpm test`.

**Non balayé, et connu** : un spécificateur reconstruit à l'exécution
(`import('@radix' + '-ui/…')`), et les fichiers du harnais de test (`tests/`,
`e2e/`, `packages/*/src/**/*.test.ts`) — exception nommée. Mesuré une écriture à
la fois contre la configuration réelle, le 31 août 2026.

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

Le thème sombre est piloté par la **classe** `.dark` sur `<html>`
(`@custom-variant dark`), jamais par `prefers-color-scheme` seul : le
commutateur doit pouvoir contredire le système.

## Imports autorisés

- `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`,
  `@radix-ui/react-label`, `@radix-ui/react-separator`, `@radix-ui/react-slot` —
  **ici et nulle part ailleurs** ;
- `class-variance-authority` pour les variantes, `clsx` et `tailwind-merge` pour
  la composition de classes (`cn`) ;
- `lucide-react` pour les icônes : un seul jeu, 16 px dans l'application ;
- `next-themes` pour le thème ;
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

| Copiés | `Alert`, `Badge`, `Button`, `Card`, `DropdownMenu`, `Input`, `Label`, `Separator`, `Sheet` |
| --- | --- |
| Composés maison | `EmptyState`, `PageHeader`, `Sidebar` / `SidebarNav`, `ThemeProvider`, `ThemeToggle` |

Le reste de l'inventaire de `docs/design-system.md` — `Form`, `Table`,
`DataTable`, `Tabs`, `Toaster`, `Command`, `AlertDialog`, `Avatar`, `Tooltip`,
`Popover`, `Skeleton`, `Progress`, `ScrollArea`, `Breadcrumb`, `Pagination`,
`Accordion`, `Checkbox`, `RadioGroup`, `Select`, `Switch`, `Textarea`,
`ConfirmDialog`, et les composés des stories à venir — **n'est pas encore
copié**. C'est la liste au 31 août 2026 ; le document fait foi, pas ce tableau.

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
