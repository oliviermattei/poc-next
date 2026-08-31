# Revue — Story s08-app-shell

Contexte : revue anti-hallucination en contexte frais, sur `git show 662f671`
(le commit suivant, `4e0cd63`, ne touche que `docs/architecture.md` et est jugé
pour cohérence seule). Répertoire de travail : `/Users/olivier/www/boilerplate`,
branche `dev`, Postgres `boilerplate-postgres-1` disponible.

## Ce qui a été exécuté

| Commande | Résultat mesuré |
|---|---|
| `pnpm test` | **481 passés, 2 ignorés** (23 fichiers passés, 1 ignoré) — conforme à l'attendu |
| `pnpm lint` | `ESLint: No issues found` |
| `pnpm typecheck` | 13 tâches, 0 erreur (rejoué `--force`) |
| `pnpm build` | 1 tâche, `Compiled successfully` (rejoué `--force`) |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert |
| `pnpm test:e2e` | **19 parcours** ; 3 exécutions : `18 passed / 1 flaky`, `19 passed`, `17 passed / 2 flaky` |
| `pnpm ks toggle demo-enabled` puis suite complète | tout vert dans le **second état de configuration** ; navigation rendue = `["/sign-in"]`, l'entrée du module coupé disparaît. Configuration restaurée, `git diff --exit-code` propre |

Vérification navigateur menée moi-même (Playwright éphémère, supprimé, arbre
prouvé propre) : bureau clair, bureau sombre, 380 px clair et sombre, panneau
mobile.

## 1. Les tokens contre le design system — vérifié, exact

Confrontation indépendante du bloc `css` de `docs/design-system.md` et de
`packages/ui/src/styles.css`, en dehors du test du dépôt :

- `:root` — 26 déclarations de chaque côté, **noms et valeurs identiques** ;
- `.dark` — 25 de chaque côté, **identiques**.

Aucun token inventé, aucune valeur dérivée. `@theme inline` expose bien chaque
couleur en `--color-<nom>: var(--<nom>)` et les quatre dérivés de rayon.
`tests/design-system.test.ts` fait la même confrontation et se protège de
l'inertie (`expect(expected.size).toBeGreaterThan(20)`) — c'est un vrai test, pas
un inventaire recopié contre lui-même.

Thème piloté par la classe : `@custom-variant dark (&:where(.dark, .dark *))`
présent. **CSS construit : `prefers-color-scheme` apparaît 0 fois** dans les cinq
feuilles produites sous `apps/web/.next` (build de production comprise) — la
claim de l'implémenteur est exacte.

La variante sombre s'applique réellement : capture d'écran de `/account` en
`.dark`, surfaces, bordures et bouton primaire inversés conformément aux tokens.
Retour à « Système » rend la main à la préférence (`e2e/app-shell.spec.ts:34`).

Pas de `tailwind.config.js` (racine, `packages/ui`, `apps/web`) — le test le
vérifie aussi.

## 2. La frontière Radix — les deux claims sont vraies, la garde a des trous

**Claim « `no-restricted-imports` ne voit pas l'import dynamique » : vraie.**
Mutation F — suppression de `...COMPONENT_BASE_SYNTAX` du troisième bloc de
`componentBaseBoundary` — laisse `import('@radix-ui/react-dialog')` passer dans
`apps/**`. C'est bien `no-restricted-syntax` qui l'attrape.

**Claim « la configuration plate remplace les options au lieu de les fusionner » :
vraie, et épinglée.** Mutation D — retrait de `APPLICATION_IMPORT_RESTRICTION` du
bloc Radix de `eslint.config.ts:259` — fait rougir **2 tests**
(`tests/lint-rules.test.ts:405` et `:439`) : sans la reprise du motif, l'interdit
« un package ne dépend jamais d'une application » disparaissait de tout le dépôt.

**Aucun import Radix hors `packages/ui`** dans le dépôt (balayage `apps`,
`packages`, `tooling`, `config`, `scripts`). Les cinq paquets déclarés
(`@radix-ui/react-dialog` 1.1.23, `react-dropdown-menu` 2.1.24, `react-label`
2.1.15, `react-separator` 1.1.15, `react-slot` 1.3.3) sont installés et
correspondent aux imports.

**J'ai essayé de défaire la garde.** 24 écritures soumises à la configuration
réelle du dépôt. Refusées : réexport total, `import x = require`, `require`,
gabarit dynamique, sous-chemin profond, `.mts` de module, `packages/config/src`
en statique comme en dynamique, `tooling/` en dynamique. **Passées** :

1. `export type P = import('@radix-ui/react-dialog').DialogProps` — la position
   d'annotation (`TSImportType`) passe **partout**, y compris dans un module.
   C'est exactement l'écriture que l'auteur a fermée pour `@repo/db`
   (`STATIC_IMPORT_FORMS` contient `TSImportType`) et qu'il n'a pas fermée pour
   Radix (`COMPONENT_BASE_SYNTAX` ne dérive que de `DYNAMIC_IMPORT_FORMS`) ;
2. `apps/**` est porté en `*.{ts,tsx}` là où `packages/**` est en
   `*.{ts,tsx,mts,cts}` : un `.mts`, `.mjs`, `.js` ou `.jsx` sous `apps/` n'est
   pas couvert ;
3. `config/`, `scripts/` et la racine ne sont dans aucune des trois portées ;
4. `radix-ui` (le paquet unifié) n'est visé par aucun motif — sans effet
   aujourd'hui, il n'est pas installé.

Voir le finding **M1** : ce n'est pas la garde en production qui est fausse,
c'est son filet et sa description.

## 3. La navigation sans condition — vérifié dans les deux états

`packages/ui/src/composed/sidebar.tsx` ne contient **aucune** condition de
module : `SidebarNav` reçoit `items`, `label`, `currentPath`, `onNavigate`, et la
seule comparaison qu'il fait est `item.href === currentPath` pour `aria-current`.
`apps/web/app/app-navigation.tsx` non plus.

Le filtrage est bien celui de s03 : `apps/web/lib/navigation.ts` appelle
`visibleNavigation(registry, session)` de `@repo/core` — pas de
réimplémentation locale. **Mutation C** (remplacement par
`registry.navigation.map(...)`) : **1 test rouge**
(`tests/app-shell.test.ts:47`, l'entrée `/account` réapparaît pour un visiteur
anonyme). `e2e/modules.spec.ts:82` rejoue la même propriété dans un navigateur.

Second état de configuration mesuré pour de vrai : après `pnpm ks toggle
demo-enabled`, la navigation rendue vaut `["/sign-in"]` et le module coupé ne
laisse ni entrée masquée ni entrée désactivée. Suite complète verte dans cet
état. Configuration restaurée.

`aria-current="page"` marque bien la page ouverte : sur `/account`, exactement un
élément porte l'attribut et son texte est « Mon compte » ; sur `/`, aucun.

## 4. Le fait corrigé et la surface ajoutée — la correction est juste

**La prémisse du plan était fausse, et l'implémenteur a raison.** Mesuré sur
`git show 662f671^:packages/modules/auth/src/application/ports.ts` :
`AuthSessionRepository` ne portait que `countForUser` et `revokeAllForUser`. Ni
`listForUser`, ni `revokeForUser`, ni `changeName`, ni `viewAccount`,
`AuthUserRecord` n'avait même pas de champ `name`. Les deux routes ajoutées
(`/auth/change-name`, `/auth/revoke-session`) étaient nécessaires.

La surface ajoutée est bien jugée :

- la révocation passe par le SQL du module, `and(eq(authSession.id, sessionId),
  eq(authSession.userId, userId))`, **un seul ordre**, `.returning()` pour
  décider. Le propriétaire est dans la condition, pas dans une vérification
  préalable — il n'existe pas d'instant où la session d'autrui est trouvée puis
  supprimée ;
- `listForUser` **énumère** ses colonnes, le jeton ne sort pas de la base, et
  `describeSessions` recopie champ par champ au lieu d'étaler la ligne. Le test
  le prouve en comparant le JSON rendu au jeton réellement stocké ;
- **404 et jamais 403** sur la session d'autrui (`notFound()` dans
  `auth-routes.ts`), conforme à `docs/security.md` §3.

**Rien n'est réécrit de s07.** Changement de mot de passe, changement d'email et
déconnexion sont consommés : `AccountForm` poste vers `authRoutePath(...)`, il
n'y a **qu'un seul** chemin de changement de mot de passe dans le dépôt
(`PATHS.changePassword`, `auth-routes.ts:292`), et le §2 reste vérifiable à un
seul endroit. `e2e/app-shell.spec.ts:168` le prouve par le parcours utilisateur :
mot de passe courant faux refusé, puis changement réussi qui déconnecte l'autre
navigateur côté serveur.

## 5. Les mutations — ce qui a été neutralisé et ce qui a rougi

Toutes restaurées, `git diff --exit-code` propre après chacune, et suite complète
rejouée à la fin (481 passés / 2 ignorés).

| # | Neutralisation | Rouge |
|---|---|---|
| A | `revokeForUser` : suppression de `eq(authSession.userId, userId)` de la clause `where` | **1** (`tests/auth.test.ts:715`, 200 au lieu de 404) |
| B | `revoke-session` : `userId` lu dans le corps quand il y est | **1** (même cas) |
| C | `shellNavigation` : `registry.navigation` au lieu de `visibleNavigation(registry, session)` | **1** (`tests/app-shell.test.ts:47`) |
| D | Retrait de `APPLICATION_IMPORT_RESTRICTION` du bloc Radix | **2** (`tests/lint-rules.test.ts:405`, `:439`) |
| E | `libraryConfig` ramené à `packages/**/*.ts` | **1** (`tests/lint-rules.test.ts:474`) |
| I | `change-name` : `userId` lu dans le corps quand il y est | **1** (`tests/auth.test.ts:749`) |
| F | Retrait de `COMPONENT_BASE_SYNTAX` du bloc `apps/**` + `packages/**` + `tooling/**` | **0 — vert** |
| G | Retrait de `COMPONENT_BASE_SYNTAX` du bloc `packages/modules/**` | **1** (`tests/lint-rules.test.ts:384`) |
| H | Retrait de `COMPONENT_BASE_SYNTAX` du bloc `packages/config/src` | **0 — vert** |

**Le renforcement annoncé mord.** Les deux cas de `tests/auth.test.ts` envoient
bien la charge de l'attaquant : `{ sessionId: victimSessionId, userId:
victim.userId }` pour la révocation, `{ name: '  Olivier  ', userId:
'un-compte-qui-n-est-pas-le-mien' }` pour le nom. Les mutations B et I
rougissent. J'ai cherché la même forme ailleurs dans le diff : il n'y a pas
d'autre chemin §3 introduit par s08 — `viewAccount` et `listSessions` prennent
leur `userId` de la session résolue côté serveur, sans paramètre client.

**F et H sont des findings** (voir M1) : deux des trois sites de déclaration de
la garde Radix dynamique peuvent être supprimés sans qu'un seul test ne bouge.

## Findings

### C1 — critical — Le mot de passe part dans l'URL quand le gestionnaire de formulaire n'est pas encore attaché

`apps/web/app/account/account-form.tsx` rend `<form onSubmit={submit}>` **sans
`method` ni `action`**. Le défaut du navigateur s'applique dès que le
gestionnaire React n'est pas là : `GET` vers l'URL courante, champs en chaîne de
requête.

Mesuré, dans un contexte `javaScriptEnabled: false`, sur la carte « Mot de passe »
de `/account` :

```
http://localhost:3100/account?currentPassword=mon-vrai-mot-de-passe&newPassword=nouveau-secret-123
```

**Ce n'est pas hypothétique.** Le parcours livré par la story
(`e2e/app-shell.spec.ts:207`) reproduit exactement la course d'hydratation dans
**2 exécutions locales sur 3** — l'erreur rapportée est
`navigated to "http://localhost:3100/account?name=Olivier+de+Test"`. La
configuration Playwright (`retries: 1`) la classe « flaky » au lieu de la faire
échouer, et le rapport de la story l'a lue comme une instabilité de test plutôt
que comme la démonstration du défaut.

Conséquences, chacune couverte par le socle :

- `docs/security.md` §5 — « Aucun secret dans un artefact de build, **dans un
  journal**, dans une réponse d'erreur » : le chemin complet atterrit dans le
  journal d'accès du serveur, dans un éventuel reverse proxy ou CDN, dans
  l'historique du navigateur, et dans l'en-tête `Referer` de toute requête
  sortante émise ensuite depuis cette page ;
- `docs/security.md` §2 gouverne le changement de mot de passe ; ce chemin le
  contourne sans que rien ne le signale à l'utilisateur — l'action est
  silencieusement perdue.

Portée : `AccountForm` est un composant **partagé introduit par ce diff**, utilisé
par les trois cartes de `/account` (nom, email, mot de passe), et la story est
la fondation dont quinze écrans hériteront. La même forme préexiste dans l'écran
de connexion de s07 — mesuré :
`http://localhost:3100/sign-in?email=victime%40example.test&password=mon-mot-de-passe-secret`.
Le correctif est donc à faire à un seul endroit et couvre les deux (par exemple :
`method="post"` sur le `<form>` pour que le repli natif ne soit jamais un `GET`,
ou soumission désactivée tant que le composant n'est pas monté — dans les deux
cas avec un parcours qui le prouve, `retries: 0` sur ce cas).

### M1 — major — La garde Radix est plus étroite que sa description, et deux de ses trois sites ne sont pas tenus par un test

Trois mesures qui vont ensemble :

1. **Couverture.** Mutations F et H : supprimer `...COMPONENT_BASE_SYNTAX` du
   bloc `apps/**` + `packages/**` + `tooling/**` (`eslint.config.ts:277`) ou du
   bloc `packages/config/src` (`:139`) laisse `pnpm test` **entièrement vert**.
   Seul le site `packages/modules/**` est épinglé (mutation G, 1 rouge), parce
   que c'est le seul chemin de fichier utilisé par le cas « import dynamique »
   de `tests/lint-rules.test.ts:384`.
2. **Trou réel.** `export type P = import('@radix-ui/react-dialog').DialogProps`
   passe partout, module compris. `TSImportType` est dans `STATIC_IMPORT_FORMS`
   (donc fermé pour `@repo/db`) mais `COMPONENT_BASE_SYNTAX` ne dérive que de
   `DYNAMIC_IMPORT_FORMS`. Écriture typée, qui compile, qui donne le type Radix
   sans qu'aucun `import` n'apparaisse — c'est textuellement l'argument que
   l'auteur avance en commentaire pour la fermer côté `@repo/db`.
   Secondairement : `apps/**` est en `*.{ts,tsx}` quand `packages/**` est en
   `*.{ts,tsx,mts,cts}` ; `config/`, `scripts/` et la racine sont hors portée.
3. **Sur-affirmation.** `packages/ui/AGENTS.md` écrit « `pnpm lint` refuse
   `@radix-ui/*` partout ailleurs, y compris en import dynamique, et
   `tests/lint-rules.test.ts` **rejoue chaque écriture** » ;
   `tests/lint-rules.test.ts:340-347` écrit « Le périmètre couvert est `apps/**`,
   `packages/**` et `tooling/**` » en listant « import dynamique » parmi les cas
   balayés. Les mesures ci-dessus contredisent les deux. Le `AGENTS.md` racine
   interdit précisément cela : « Never claim exhaustiveness. A measured list says
   *what was swept*, never *what exists*. »

La configuration en production est correcte **aujourd'hui** — je l'ai vérifiée
écriture par écriture. Rien ne la maintient : c'est la garde qui rend l'ADR 022
réversible, et deux tiers de sa surface reposent sur la vigilance.

### m1 — minor — `retries: 1` masque la course d'hydratation en « flaky »

Corollaire de C1. Sur 3 exécutions : `1 flaky`, `0`, `2 flaky`. Le second cas
instable (`e2e/auth.spec.ts:184`, capture d'email) préexiste à s08 et a une autre
cause. Une fois C1 corrigé, `e2e/app-shell.spec.ts:207` devrait cesser de
retenter ; si ce n'est pas le cas, la reprise cache autre chose.

### m2 — minor — Le corps de `/auth/revoke-session` n'est pas validé par Zod

`auth-routes.ts:356` : `(await jsonBody(request)) as { readonly sessionId?:
unknown }` puis un `typeof`. `docs/security.md` §4 demande « Zod à **chaque**
frontière : … corps de requête ». La validation effective est équivalente et la
valeur part dans une requête paramétrée avec le propriétaire dans la clause,
donc l'impact est nul ; mais c'est la seule nouvelle frontière du diff qui
n'utilise pas les analyseurs du `domain` (`parseDisplayName`, `parseEmailInput`).
Le motif préexiste en s07 (`:180`, `:292`) : ce n'est pas une régression, c'est
une occasion de le fermer une fois pour les deux.

### m3 — minor — La connexion n'aboutit toujours pas au tableau de bord

`apps/web/app/sign-in/page.tsx:18` : `safeRedirectPath(next, '/account')`. Le
critère 1 de la story dit « Une fois connecté, l'utilisateur atteint un tableau
de bord avec navigation latérale et menu de compte ». C'est la story qui **crée**
ce tableau de bord, et elle laisse le repli sur `/account`. Le commentaire du
fichier (« `?next=https://evil.test` retombe sur le tableau de bord ») est
désormais faux. Une chaîne, plus le commentaire.

### m4 — minor — Chaînes françaises en dur, y compris dans `packages/ui`

Écart déclaré, dont l'échéance est s09. La frontière est bien tenue côté design
system — `SidebarNav` exige son `label`, `ThemeToggle` ses `options` — sauf un
endroit : `packages/ui/src/components/sheet.tsx:50`,
`<span className="sr-only">Fermer</span>`. C'est la seule chaîne que le paquet ne
peut pas recevoir en propriété aujourd'hui, et le nom accessible du bouton de
fermeture du panneau en dépend. À nommer dans le périmètre de s09, sinon le test
promis par le design system la trouvera en dernier.

### m5 — minor — La navigation montre « Connexion » à un utilisateur connecté

Constaté à l'écran (bureau et 380 px) : le compte connecté voit « Connexion,
Mon compte, Éléments de démonstration ». C'est le comportement littéral de
`visibleNavigation` — une entrée `public` est visible de tous — et non un défaut
de cette story. Mais c'est le shell dont quinze écrans hériteront, et
l'incohérence se verra sur chacun.

### m6 — minor — Six symboles exportés que personne n'utilise

`packages/ui/src/index.ts` exporte `AlertTitle`, `AlertDescription`,
`CardFooter`, `DropdownMenuGroup`, `SheetClose`, `SheetDescription` — aucun n'est
consommé par `apps/web` ni par un autre composant du paquet. L'interdit du plan
dit « Ne pas copier l'inventaire entier "pour plus tard" », et le baril affirme
lui-même « ceux que s08 utilise réellement ». Ce sont des sous-parties de
composants copiés, pas des composants entiers : l'écart est petit, la phrase est
fausse.

### m7 — minor — Le `tsconfig.json` racine ouvre le DOM à `scripts/` et `config/`

`lib: ["DOM", "DOM.Iterable", "ES2022"]` et `jsx: "react-jsx"` s'appliquent à
`config`, `generated`, `tests`, `scripts`, `e2e` et aux fichiers de
configuration. Nécessaire pour que `tests/app-shell.test.ts` traverse
`@repo/ui` ; effet de bord : un script Node peut désormais référencer `document`
ou `localStorage` et passer `pnpm typecheck`.

### m8 — minor — La recherche n'a pas été corrigée sur le fait qu'elle a raté

`docs/research/s08-app-shell.md`, fait structurant n°5 : « s07 a livré les cas
d'usage de compte : **liste des sessions, révocation**, changement de mot de
passe et d'email ». Faux, et je l'ai vérifié à la source
(`git show 662f671^:packages/modules/auth/src/application/ports.ts` :
`AuthSessionRepository` = `countForUser` + `revokeAllForUser`, `AuthUserRecord`
sans `name`). L'implémenteur a mesuré et corrigé — c'est écrit dans le message de
commit et dans `packages/modules/auth/AGENTS.md`. Le fichier de recherche, lui,
porte toujours l'affirmation d'origine : le prochain agent qui le lira y verra un
fait vérifié. « Docs ship with the code that changes them. »

### m9 — minor — La règle de couches en `.tsx` n'est prouvée que par `no-restricted-imports`

La tâche 1 demandait de prouver l'extension « par une violation réelle dans un
`.tsx` ». C'est fait pour `libraryConfig` (`tests/lint-rules.test.ts:474`,
mutation E rouge) et pour la garde ADR 020 (`:282`). `boundaries/dependencies`,
lui, n'est éprouvé que sur `tests/fixtures/layers/**/*.ts` : le glob du test est
`${FIXTURES}/**/*.ts`. J'ai mesuré que la règle **mord bien** dans un `.tsx`
(`presentation → infrastructure` et `domain → drizzle-orm` refusés dans un
`packages/modules/auth/src/**/probe.tsx`) — parce que `boundariesConfig` n'a pas
de clé `files` du tout. C'est donc correct par construction, et non par test :
une fixture `.tsx` fermerait le sujet.

## Écarts déclarés — jugement

- **`Form` / `FormField` / `FormMessage` non construits** : accepté. Le design
  system les nomme, mais les livrer suppose `react-hook-form` et le partage du
  schéma Zod du module côté client, ce qui déborde la story. `AGENTS.md` de
  `packages/ui` le dit et donne la liste de ce qui n'est pas copié. Attention
  toutefois : le motif de formulaire est déjà figé par `AccountForm` sans eux, et
  c'est ce motif qui porte C1.
- **Taille `icon` ajoutée au `Button`** : accepté. Le design system ne nomme pas
  d'échelle de tailles ; la variante ne change ni la hauteur (`h-10`, les 2,5 rem
  du système) ni le rayon, et les cinq variantes de couleur sont exactement
  celles du document. Signalé comme gap, pas comblé en douce.
- **`Alert` sans rôle ARIA par défaut** : accepté, et bien argumenté. Une région
  vivante permanente transforme chaque texte statique en annonce. Les appelants
  disent ce qu'ils annoncent (`role="alert"` / `role="status"`), et les parcours
  s'appuient dessus.
- **`packages/config/src` reçoit aussi les restrictions** : correct, c'est la
  conséquence directe du remplacement d'options en configuration plate, et c'est
  la seule façon de ne pas le rendre borgne. Bien commenté à l'endroit où la
  surprise se paie.
- **`tsconfig` racine** : voir m7.
- **Chaînes en dur** : voir m4.
- **Connexion vers `/account`** : voir m3.
- **`jsx-a11y`** : la mesure est exacte. Vérifié au registre : dernière version
  `6.10.2`, publiée le 26 octobre 2024, `peerDependencies: { eslint: "^3 || … ||
  ^9" }`. Aucune version compatible ESLint 10. Ce sur quoi l'accessibilité repose
  est écrit dans `packages/ui/AGENTS.md`, avec la liste de ce que **rien** ne
  vérifie — c'est la bonne forme. `docs/architecture.md` (commit `4e0cd63`) est
  cohérent avec le code et avec `packages/ui/AGENTS.md`.

## Vérification visuelle

Menée moi-même, application réellement démarrée, compte créé et vérifié.

- **Bureau 1280 px, clair et sombre**, `/` et `/account` : rendu cohérent,
  élévation par bordure et fond, ombre uniquement sur le panneau et le menu
  déroulant — conforme au design system. La variante sombre inverse bien
  surfaces, bordures et bouton primaire.
- **380 px**, `/`, `/account`, `/sign-in`, en clair et en sombre :
  `scrollWidth - clientWidth = 0` partout. Aucun débordement horizontal. La
  colonne latérale devient un panneau, une seule navigation dans l'arbre.
- **`aria-current`** : exactement un élément marqué sur la page ouverte, aucun
  sur une page hors navigation.
- **Console navigateur : propre** — zéro `error`, zéro `warning`, zéro
  `pageerror` sur le parcours connexion → tableau de bord → thème sombre →
  compte → 380 px → ouverture du panneau. (Une première mesure remontait un écart
  d'hydratation : il venait de mes propres captures d'écran, Playwright injectant
  `caret-color: transparent` dans les champs. Sans capture, rien.)

## Ce que je n'ai pas pu vérifier

- **Le contraste réel des couleurs.** Je constate que les deux thèmes
  s'appliquent, pas qu'ils passent WCAG AA. Les variantes `Alert`
  (`text-info` sur `bg-info/10`, `text-warning` sur `bg-warning/10`) sont les
  plus exposées. `packages/ui/AGENTS.md` le dit lui-même : rien ne le vérifie.
  Geste humain : un contrôle de contraste sur les quatre sémantiques, dans les
  deux thèmes.
- **L'ordre de tabulation complet et la navigation clavier de bout en bout.**
  Les parcours désignent par rôle et par nom, ce qui attrape les contrôles
  anonymes, pas un piège de focus ni un ordre incohérent. Geste humain : parcourir
  `/account` entièrement au clavier, panneau mobile ouvert et fermé.
- **Les lecteurs d'écran.** Aucun n'a été utilisé. Le choix de ne pas mettre de
  rôle par défaut sur `Alert` est défendable sur le papier ; il se juge à
  l'oreille.
- **Un autre navigateur que Chromium.** `playwright.config.ts` ne déclare qu'un
  projet. Le repli natif de C1 se comporte identiquement partout, mais le rendu,
  `oklch` et `@custom-variant` méritent un passage Safari/Firefox.
- **Le mode production servi.** J'ai lancé `pnpm build` (vert) mais les captures
  et le parcours viennent de `next dev` — c'est ce que démarre
  `playwright.config.ts`. L'indicateur de développement de Next apparaît d'ailleurs
  sur les captures. Geste humain : `next start` et une passe visuelle.
- **Un vrai appareil mobile.** 380 px est un viewport émulé, pas un téléphone :
  ni clavier virtuel, ni zoom de saisie, ni barre d'URL rétractable.
- **La persistance du thème entre deux vraies sessions de navigateur.** Le
  parcours prouve un rechargement complet, pas une fermeture/réouverture du
  navigateur ni un stockage local refusé.
- **Le comportement sous CSP.** Le socle §1 impose `default-src 'self'` sans
  `unsafe-inline` avec un nonce par requête. La CSP n'existe pas encore dans ce
  dépôt ; `next-themes` injecte un script en ligne et `ThemeProvider` transmet
  bien `nonce`, mais **rien ne l'a exercé**. C'est le prochain point de rupture
  du thème, et il faudra le mesurer dans la story qui pose la CSP.
- **Le rendu quand un module tiers déclare beaucoup d'entrées de navigation.**
  Deux modules seulement existent ; le débordement vertical de la colonne
  latérale n'a jamais été atteint.

Max severity: critical
Ship allowed: no
