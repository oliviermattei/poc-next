---
story: s46-auth-screens-design
validated: yes
---

# Plan — s46-auth-screens-design

> Planifié contre `dev` au commit `80424ec`. La recherche est datée de `f9bdc37`, **81 commits plus tôt** : ses cinq faits ont été **revérifiés un par un**, ils tiennent tous, avec une précision sur le quatrième.

## Revérification, sur `dev` aujourd'hui

| Fait | État |
|---|---|
| 1. `grep -c className apps/web/app/auth-form.tsx` rend **0** | **tient** — mesuré à nouveau |
| 1bis. un seul écran importe de `@repo/ui` | **tient** — `sign-in/page.tsx` (`Alert`) et `sign-in/passkey-button.tsx` (`Alert`, `Button`) |
| 3. les parcours de s07 asservissent des rôles et des textes | **tient** — 25 sélecteurs `getByRole`/`getByLabel`, **zéro** sélecteur de classe ou de structure |
| 4. `Form`, `FormField`, `FormMessage` déclarés et absents | **tient**, et le contexte a changé : `docs/design-system.md` porte depuis le 06/09 une note datée disant que **15 des 32 composants annoncés n'existent pas**, et tranche la conduite — une story qui a besoin d'un composant absent **le livre dans `packages/ui`** |

## La décision que ce plan prend : composer sans `Form`

`s29` a livré `Pagination`, `s30` `Breadcrumb`, `s37b2` `Table`, `s54` `Command` — quatre précédents de copie. Ici, **non** : ces écrans rendent deux champs et un bouton, et `Form`/`FormField`/`FormMessage` sont la liaison de `react-hook-form`, qui n'est pas dans le dépôt. Les copier signifierait livrer une dépendance et une abstraction pour cinq formulaires qui n'en ont pas besoin — la généralisation que le cimetière du PRD refuse. On compose avec `Label`, `Input`, `Button`, `Card`, `Alert`, `Separator`, tous livrés.

**Ce plan reporte donc le manque au lieu de le combler**, comme le design system l'exige.

## Ce qui rend cette story risquée, et ce qui la rend sûre

**Risquée** : le critère 6 interdit de réécrire les assertions de `s07`. Un changement de rôle ARIA ou de nom accessible fera rougir des parcours fonctionnels, et le rouge ressemblera à une régression.

**Sûre** : les 25 sélecteurs sont des rôles et des noms. `Input`, `Label` et `Button` les préservent **par construction** — ce sont des éléments natifs habillés. Le passage est donc franchissable, à condition de ne jamais remplacer un `<button>` par autre chose qu'un `Button`.

## Tâches

- [x] **1. `auth-form.tsx`, le composant partagé.** C'est lui qui rend les cinq écrans ; l'habiller les habille tous. `Label`/`Input` pour les champs, `Button` pour la soumission. **`method="post"` reste un littéral écrit** — la règle de s08, gardée par une commande existante : ne pas la déplacer dans une variable.
  - **Écart assumé, corrigé ici après la revue** : le plan mettait la `Card` dans ce composant ; elle est **dans les cinq écrans**. `/sign-in` monte **deux** `AuthForm` — mot de passe et lien de connexion — et une carte par formulaire y aurait fait deux cadres là où l'écran n'a qu'un sujet. Le cadre appartient donc à l'écran, le formulaire à son contenu.
- [x] **2. Le bouton désactivé jusqu'à l'hydratation**, conservé tel quel s'il existe, mesuré s'il n'est pas mesuré.
- [x] **3. Les cinq écrans**, dans l'ordre où un acheteur les voit : `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, `/verify-email`. Aucun composant ni jeton inventé.
- [x] **4. Aucune chaîne en dur** : tout par les catalogues, **le test de s09 doit mordre**. Mutation : écrire un libellé en dur doit rougir.
- [x] **5. Les parcours de s07, verts sans réécriture.** `git diff` sur `e2e/auth.spec.ts` doit être **vide** à la fin. Si une assertion doit changer, c'est que le rôle ou le nom accessible a changé — donc que la tâche 3 a dérapé.
- [x] **6. Clair et sombre, deux locales, jusqu'à 380 px sans débordement horizontal**, mesuré dans un navigateur sur les cinq écrans — dix rendus. Le débordement se mesure (`scrollWidth > clientWidth`), il ne se regarde pas.
- [x] **7. Le contraste, et ce que la commande ne couvre pas.** `pnpm test:contrast` ne mesure **que** l'`Alert` — vérifié aujourd'hui : 10 paires, 5 variantes × 2 thèmes. Elle ne dit **rien** des champs, des boutons, des libellés, des liens ni des états de focus de ces écrans. Soit la story étend la mesure à ce qu'elle livre, soit elle écrit noir sur blanc que le contraste de ces écrans n'est pas mesuré. **Ne pas laisser croire qu'une commande verte le couvre.**

## Reprise après revue (les quatre constats mineurs)

La revue a passé la porte (`Ship allowed: yes`, sévérité maximale **majeure** — deux défauts de jetons **préexistants**, hors périmètre, qui auront leur propre story). Les quatre constats mineurs sont traités ici :

- **3.** Les deux manques sont désormais dans `docs/design-system.md` — § « Lacune : la liaison de formulaire, et la largeur d'un écran centré (s46) » — et plus seulement dans ce plan et des commentaires. Au passage, deux choses fausses du même document sont corrigées : le § « Formulaires » prescrivait react-hook-form et l'erreur par champ (la bibliothèque n'est **nulle part** dans le dépôt), et la note d'inventaire comptait `Table` parmi les absents alors que le baril l'exporte. Cette note **n'est plus de la documentation** : `tests/design-system.test.ts` la confronte au baril et à son propre compte.
- **4.** `/two-factor` est **habillé** comme les cinq autres — c'est un écran d'authentification, et le geste est le même — **et** la liste balayée par `e2e/auth-screens.spec.ts` n'est plus écrite : elle est dérivée du disque (tout `page.tsx` qui appelle `authRoutePath(`), avec une exclusion nommée et motivée pour `/account`. Les deux, parce que l'un ferme le défaut d'aujourd'hui et l'autre empêche le suivant d'hériter du silence.
- **5.** Le bouton éteint dit pourquoi : un `<noscript>` dans `auth-form.tsx` **et** dans `two-factor-form.tsx` — le second instance de la même classe, trouvée en balayant « un écran qui a l'air fini et ne l'est pas ». Compté, pas illustré : autant d'explications rendues que de boutons éteints, sur chaque écran de la famille, dans un navigateur sans JavaScript.
- **6.** Le commentaire de `tests/auth-screens.test.ts` nomme désormais le bon garde : `pnpm lint` (`FORM_METHOD_SYNTAX` d'`eslint.config.ts`), pas `tests/lint-rules.test.ts`.

**Ce que cette reprise ne fait pas** : l'écran de compte porte la même classe de défaut — **six** de ses fichiers appellent `useHydrated` et aucun ne porte de `<noscript>` (relevé le 6 septembre 2026, `grep -rl useHydrated apps/web/app/account`). Hors du périmètre de cette story : le constat est reporté, pas comblé.

## Ce que la story ne fait pas

Elle ne change **aucun comportement** : ni route, ni validation, ni message d'erreur, ni redirection. Elle ne copie pas `Form`. Elle ne touche pas au shell applicatif (s08) ni aux écrans de compte.

## Sections de `docs/security.md` touchées

**`method` écrit en littéral sur chaque `<form>`** — un formulaire React sans lui retombe sur un GET du navigateur avant hydratation et met les secrets dans l'URL, mesuré en s08. Aucun message d'erreur ne doit devenir plus bavard : compte inconnu et mot de passe faux restent **indistinguables**, en message et en temps.
