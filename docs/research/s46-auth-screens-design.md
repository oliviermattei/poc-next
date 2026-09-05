# Research — Story s46-auth-screens-design

> Vérifiée contre la branche par défaut au commit `f9bdc37`, en lecture seule.
> Aucune base, aucun conteneur, aucun worktree.

## Les cinq faits structurants

1. **La prémisse est vraie, et elle se mesure d'une commande.** `grep -c className apps/web/app/auth-form.tsx` rend **0**. Le composant partagé des cinq écrans n'émet **aucune classe**. Un seul des cinq écrans importe quelque chose de `@repo/ui` — `sign-in/page.tsx`, et seulement `Alert`.
2. **Ce qui est rendu est minuscule** : deux `<form>`, un `<label>`, un `<input>`, un `<button>`, trois `<p>`. Ce n'est pas un écran mal habillé, c'est un écran **non habillé** — et le champ « mot de passe », le second bouton et les liens sont produits ailleurs, par composition. La story est donc plus petite que « refondre cinq écrans » : elle habille **un** composant partagé et ce qui l'entoure.
3. **Les parcours de s07 asservissent des rôles et des textes, pas des structures.** Balayage des sélecteurs de `e2e/auth.spec.ts` : `getByLabel('Adresse email')`, `getByLabel('Mot de passe')`, `getByRole('button', { name: … })`, `getByRole('heading', { name: … })`, `getByRole('alert')`, `getByRole('main')`. **Aucun sélecteur de classe, aucun sélecteur de structure.** Habiller avec les composants du système préserve donc les assertions **si et seulement si** les rôles et les noms accessibles sont préservés — ce que `Input`, `Label`, `Button` et `Alert` font par construction. C'est le piège que la story nomme, et il est franchissable.
4. **Le système a tout ce qu'il faut, et rien n'est à copier.** `Input`, `Label`, `Button`, `Card`, `Alert`, `Separator` existent tous dans `packages/ui/src/components/`. `Form`, `FormField`, `FormMessage` sont **déclarés par `docs/design-system.md` et absents du dépôt** — comme `Pagination` avant s29 et `Breadcrumb` avant s30. À trancher au plan : les copier (le geste connu) ou composer sans eux, ce que la taille de ces écrans permet.
5. **Deux affordances d'hydratation sont des règles du dépôt, pas des détails.** `method="post"` **écrit en littéral** sur chaque `<form>` — un formulaire React sans lui retombe sur un GET du navigateur avant hydratation et met les secrets dans l'URL, mesuré en s08 — et le bouton désactivé jusqu'à l'hydratation. Les deux sont dans les critères, et la première est gardée par une commande existante.

## Target story

Six critères : les cinq écrans emploient les composants de `packages/ui`, **sans balise de formulaire nue** · ils respectent `docs/design-system.md`, aucun composant ni jeton inventé · les deux affordances d'hydratation · **aucune chaîne en dur**, tout passe par les catalogues (le test de s09 doit mordre) · rendus corrects en clair et en sombre, dans les deux locales, **jusqu'à 380 px sans débordement horizontal** · les parcours de s07 restent verts **sans réécriture de leurs assertions**.

Dépendances déclarées : `s08-app-shell`, `s09-i18n` — les deux fusionnées.

## Points d'ancrage

- `apps/web/app/auth-form.tsx` — le composant partagé, zéro classe, et le classement des refus que s28 y a posé (`authRefusalOf`).
- `apps/web/app/sign-in/page.tsx`, `sign-up/`, `forgot-password/`, `reset-password/`, `verify-email/` — les cinq écrans.
- `apps/web/app/two-factor/two-factor-form.tsx` — **le comparable déjà habillé**, et le porteur de la classe de refus `throttled` posée par s28.
- `apps/web/app/public-form.tsx` — l'autre comparable, habillé depuis s11.
- `packages/ui/src/components/` — `input`, `label`, `button`, `card`, `alert`, `separator` : tout existe.
- `docs/design-system.md` — les jetons, les huit rôles typographiques, et `Form`/`FormField`/`FormMessage` déclarés sans exister.

## Pièges & contraintes

- **Ne pas toucher au comportement.** C'est la note de la story, et le fait 3 dit pourquoi elle est franchissable : les assertions portent sur des rôles. Une seule réécriture d'assertion serait le signal que le comportement a bougé.
- **s28 a posé la classe de refus `throttled` sur ce fichier**, avec un message qui nomme l'attente. Un rhabillage ne doit ni la perdre, ni la noyer : c'est la seule explication qu'un utilisateur limité reçoit.
- **`Alert` est sous le seuil WCAG AA en mode clair** — les quatre variantes, mesurées en revue de s28, `warning` à 1,83 : 1. **s49 n'a pas tranché.** Un écran d'authentification rhabillé ne doit donc pas faire reposer un refus sur la seule couleur.
- **Aucun `loading.tsx`** : mesuré en s29 sur trois placements, la coquille est vidée avant que la page ne décide et un `notFound()` arrive en 200.
- **Le test de chaînes en dur de s09 doit mordre** — le critère le dit explicitement, ce qui veut dire qu'il faut vérifier qu'il mord *après* le rhabillage, pas seulement avant.

## Questions ouvertes

- **Copier `Form`/`FormField`/`FormMessage`, ou composer sans ?** Le système les déclare, le dépôt ne les a pas. Ces écrans ont un ou deux champs : `react-hook-form` + Zod y apporterait plus de machinerie que de valeur. Mais `docs/design-system.md` les annonce comme la voie du dépôt pour un formulaire. À trancher, avec ADR si la réponse est « composer sans ».
- **Une `Card` ou pas ?** Le système désigne `Card` comme « l'unité de base des pages de paramètres ». Un écran de connexion centré est un motif si répandu qu'il vaut mieux le décider que l'improviser.
- **Ces écrans vivent-ils dans la coquille applicative ?** La revue de s29 a relevé que `apps/web/app/layout.tsx` enveloppe **tout** dans `AppShell`, barre latérale comprise. Un écran de connexion sous une barre latérale de tableau de bord est incohérent — mais le changer dépasse cette story.
- **Le manque n°1 du design de s29 vaut-il ici ?** Non : il n'y a pas de prose. En revanche la **largeur de lecture** d'un formulaire centré n'est fixée nulle part, comme elle ne l'était pas pour l'article.

## Complexité réelle

Notée **2** dans `docs/stories.md`. **Ma note : 2, confirmée** — et c'est rare cette séance, où quatre notes sur cinq ont été relevées.

La raison est le fait 2 : la surface réelle est **un** composant partagé de sept éléments, pas cinq écrans. Tous les composants nécessaires existent. Les parcours asservissent des rôles, donc ils survivent. Ce qui reste est du travail de présentation, borné et vérifiable à l'œil.

Le risque n'est pas la difficulté, c'est **l'élargissement** : la coquille applicative, la variante `Alert` et la largeur de lecture sont trois invitations à déborder, et aucune n'appartient à cette story.

Pas de proposition de découpe.
