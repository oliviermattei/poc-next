# Design — s37b2-back-office-lecture

> Dérivé de `docs/design-system.md`. Aucun composant, jeton ou couleur inventé.
> Le module `admin` n'a **aucun écran** aujourd'hui (`adminNavigation` est vide) : tout ici est neuf.

## Le manque du design system, mesuré avant de dessiner

Le tableau des composants annonce `Table` et `DataTable` pour les listes. **Ni l'un ni l'autre n'existe** dans `packages/ui/src` — 16 des 32 composants nommés sont dans ce cas, et la note datée du 06/09 en tête de ce tableau le dit désormais. Un back-office est fait de listes : c'est le premier manque que cette story rencontre, et le seul qui la bloque.

**Décision** : la story **livre `Table` dans `packages/ui`**, copie shadcn/ui sur Radix comme l'ADR 022 l'établit — elle ne réécrit pas un tableau dans le module, et ne le remplace pas par des `Card` empilées. C'est la règle du design system appliquée, pas contournée : *une story qui a besoin d'un composant absent le livre dans `packages/ui`*.

Ce qu'elle ne livre pas : `DataTable` (tri + pagination + état vide en un composant). La pagination existe déjà comme composant autonome (`Pagination`), la recherche est un `Input`, et l'état vide est `EmptyState` : les trois composent sans qu'on ait besoin d'un composé qui les avale. Un `DataTable` non demandé serait une généralisation sur un seul appelant.

## Écrans

### 1. `/admin/users` — la liste des comptes

`PageHeader` (titre, description) · un `Input` de recherche · une `Table` · `Pagination`.

Colonnes : compte (`Avatar` + adresse), rôles (`Badge`), état (`Badge` — actif / banni), inscription. Une ligne mène au détail.

**Quatre états** : chargement (aucun `Skeleton` livré non plus — on rend la table vide plutôt qu'inventer une primitive) · vide (`EmptyState`, cas « aucun compte ne correspond ») · erreur (`Alert` sémantique) · nominal.

### 2. `/admin/users/<id>` — le détail d'un compte

`Breadcrumb` (livré) · `PageHeader` avec les actions · trois `Card` : organisations et rôles, droits de plateforme, sessions actives.

Les deux actions du critère 3 — révoquer une session, déclencher une réinitialisation de mot de passe — sont des `Button`. La révocation est **irréversible pour la session visée** : le design system porte une **lacune connue** ici, `ConfirmDialog` n'est pas livré et `AlertDialog` non plus. On ne l'invente pas : l'action est un `Button` `destructive` dont le libellé nomme l'effet, et la lacune est reportée ci-dessous plutôt que comblée en freestyle.

### 3. `/admin/organizations` — la liste des organisations

Même structure que 1. Colonnes : organisation (`Avatar` + nom), membres, offre, état d'abonnement (`Badge`).

**L'entrée disparaît du back-office quand le module `organizations` est coupé** : elle est dérivée du registre, jamais écrite — c'est la forme que `s31` vient d'établir pour le pied de page.

### 4. `/admin/organizations/<id>` — le détail

`Breadcrumb` · `PageHeader` · deux `Card` : membres et leurs rôles, offre et état d'abonnement.

### 5. Le bandeau d'impersonation — **permanent**

Livré par `s37b1` côté session ; ici, il est **rendu**. `Alert` sémantique, en tête de la coquille applicative, **au-dessus** du contenu de la page, donc survivant à une navigation complète parce qu'il vit dans la coquille et non dans une page. Il nomme le compte emprunté et porte l'action de sortie.

**« Il nomme le compte emprunté » est mesuré** (revue, constat F8) : la première livraison portait un texte générique — « au nom d'un autre compte » —, ce qui laisse l'emprunteur deviner sur quel dossier il travaille alors que le back-office sert précisément à en ouvrir plusieurs de suite. L'adresse affichée est celle de la session en cours, donc du compte emprunté et jamais de l'emprunteur ; elle ne coûte aucune lecture, la coquille l'ayant déjà pour son menu de compte. `e2e/admin.spec.ts` l'exige dans le bandeau.

## Manques du design system relevés, non comblés ici

1. **`ConfirmDialog` / `AlertDialog`** — déjà relevé par `s34b`, toujours ouvert. Une action irréversible n'a pas de confirmation composable.
2. **`Skeleton`** — annoncé, non livré ; l'état de chargement se rend sans lui.
3. **`Command`** — annoncé pour la palette de recherche du back-office ; la story utilise un `Input`, ce qui suffit à ses critères.
4. **La pagination longue** — relevé par la revue (constat F4), et c'est le seul manque de cette liste que la story **rencontre à l'exécution** plutôt qu'en dessinant. `Pagination` a été écrit pour le blog (`s29`), qui compte ses pages sur une main : il rendait **une ancre par page**, sans borne, et le domaine des listes de plateforme en autorise 10 000.

   **Ce qui est livré**, dans `packages/ui` et non dans le module — la même règle que pour `Table` : une **fenêtre** de sept pages au plus, centrée sur la page courante, qui glisse aux extrémités. En dessous de sept pages, le rendu est identique à celui d'avant : le blog ne change pas.

   **Ce qui reste un manque, et n'est pas comblé ici** : le document ne décrit ni **ellipse** (`1 … 4 5 6 … 500`) ni **saut à la première et à la dernière page**. Les inventer serait décider du design system dans un commit de fonctionnalité. La conséquence est nommée : depuis la page 5 000, on ne revient à la page 1 qu'en changeant l'adresse — les listes portent une recherche, qui est le vrai outil de navigation au-delà de quelques pages.

## Ce que ce document n'est pas

Pas une maquette HTML. Les écrans ci-dessus se composent des vrais composants de `packages/ui` ; il n'y a rien à recopier. Les deux précédents de cette famille (`s29`, `s30`) portaient un `.html` parce qu'ils inventaient une mise en page de contenu ; ici, la mise en page est celle de la coquille applicative livrée par `s08`, et le seul élément neuf est un tableau.
