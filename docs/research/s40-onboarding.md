# Research — Story s40-onboarding

> Vérifiée contre la branche par défaut au commit `8afd42e`, en lecture seule. Aucune base, aucun conteneur, aucun worktree.

## Les six faits structurants

1. **Le « tableau de bord » n'est pas une route.** C'est la branche connectée de `apps/web/app/page.tsx` : `currentViewer()` rend un compte, et la page rend un `PageHeader` plus un `EmptyState`. Il n'existe **aucun** `/dashboard`. Le critère 1 — « dirigé vers un parcours en étapes **au lieu du** tableau de bord » — se joue donc à la racine, et le docblock de ce fichier pose déjà la règle qui encadre la manœuvre : *« La destination de la redirection est une constante du code, jamais un paramètre d'URL »*, avec `docs/security.md` §4 en référence.

2. **Après inscription, on ne va pas au tableau de bord : on passe par le second facteur.** `auth-routes.ts:374` redirige vers `TWO_FACTOR_SCREEN` avec un `next` déjà **assaini** (`safeRedirectPath(…, '/')`, origine comparée). Le parcours d'intégration s'insère donc **après** cette étape, pas à la place — et il hérite d'un mécanisme de destination qui refuse déjà l'extérieur.

3. **La progression persistée est ce qui fait de cette story un module.** Aucune table du dépôt ne porte d'état d'intégration : le critère 4 en impose une, donc un `packages/modules/onboarding` avec sa migration, ses quinze clés de contrat, ses `dataCategories`, sa `retention`, sa `purge` et son `export` — les quatre dernières parce que `s34` et `s35` ont fermé la classe « une table qui n'est ni purgée ni exportée ».

4. **Les étapes se dérivent, et le dépôt a déjà quatre formes de dérivation à copier.** Le critère 3 exige que les étapes dépendent des modules activés, et la note de la story nomme le piège : une liste écrite en dur casserait l'angle du PRD. Les formes disponibles : `publicUrls` (contribution, ADR 054), `NavigationSurface` (propriété de l'entrée, ADR 066/067), les fonctions injectées d'`AuthDependencies` (`purgeScope`, `soleOwnerships`, `platformRolesOf` — *« il reçoit la fonction, exactement comme il reçoit son mailer »*), et `mounted ? … : …` au point de composition, qui rend l'absence **par la valeur**. La dernière est celle qui convient à trois étapes hétérogènes.

5. **Le chemin de l'invitation existe et il a déjà tranché la question du module coupé.** `apps/web/app/invitations/accept/page.tsx` répond **404** quand `organizations` est coupé, sur `organizations.available` traité comme **une donnée, pas un `if (module activé)`** — c'est écrit dans son docblock. Le critère 7 — un invité rejoint l'organisation et saute l'étape de création — se branche là.

6. **`Stepper` est déclaré par le design system et absent de `packages/ui`.** Il y figure explicitement comme « parcours en étapes (s37 — intégration) », et la note datée du 06/09 tranche la conduite : une story qui a besoin d'un composant absent **le livre dans `packages/ui`**. À trancher au plan : le copier, ou composer avec ce qui existe — la question est de savoir si un fil d'étapes mérite une primitive ou trois `Badge` et un `Separator`.

## Points d'ancrage

- `apps/web/app/page.tsx:59` — la branche connectée, et sa règle de redirection.
- `packages/modules/auth/src/presentation/auth-routes.ts:360-375` — `next` assaini, second facteur.
- `apps/web/app/invitations/accept/page.tsx:64` — `organizations.available` comme donnée.
- `apps/web/app/account/avatar-form.tsx` — l'étape profil existe déjà, ailleurs : le nom et l'avatar y sont modifiables.
- `config/features.ts`, `config/profiles.ts` — l'inscription du module et sa coupure.

## Pièges & contraintes

- **Le critère 2 fait dépendre une *partie* d'étape d'un module** : l'avatar disparaît sans `storage`, l'étape « nom » reste. C'est plus fin que les critères 3 et 8, qui font disparaître des étapes entières — et c'est là qu'une dérivation naïve écrira un `if`.
- **Le critère 5 est une porte à sens unique** : un parcours terminé ne doit plus être proposé. Une erreur de ce côté enferme un utilisateur dans une boucle ; la mutation utile est donc « le parcours se re-propose », pas « il ne s'affiche jamais ».
- **Le critère 6 distingue facultatif et obligatoire.** Une étape obligatoire qui se laisse passer est un défaut silencieux : rien ne casse, l'utilisateur arrive au tableau de bord sans nom.
- **Ne pas dupliquer l'écran de profil.** Le nom et l'avatar sont déjà édités dans `/account` ; l'intégration doit réutiliser ce qui existe plutôt qu'en écrire une seconde version qui divergera.
- **Un module coupé ne doit rien retenir** : critère 8, l'utilisateur atteint directement le tableau de bord. C'est la garantie que `pnpm test:minimal-profile` mesure, et elle doit se dériver sans nommer le module.

## Questions ouvertes

- **Où vit l'état ?** Une table à part (`onboarding_progress`) ou une colonne sur le compte ? La seconde ferait de `auth` le propriétaire d'une donnée d'un module optionnel — ce que l'ADR 018 et la borne d'import d'`admin` refusent par ailleurs.
- **Que se passe-t-il si un module est coupé *après* qu'un utilisateur a franchi son étape ?** L'état persisté cite une étape qui n'existe plus. Décision à écrire : ignorer l'inconnu, ou refuser.
- **L'invitation saute-t-elle l'étape, ou la marque-t-elle franchie ?** La différence se voit quand l'utilisateur quitte ensuite l'organisation.
- **`Stepper` : copié ou composé ?** Non tranché ici.

## Complexité réelle

Notée **3** dans `docs/stories.md`. **Ma note : 3**, à condition que le module reste **lecture et écriture d'un état**, et que les étapes réutilisent les écrans existants. Elle passe à 4 si le plan se met à réécrire l'édition de profil, ou à livrer un `Stepper` générique avec ses états — auquel cas la découpe naturelle est « le parcours et sa persistance » d'un côté, « la primitive d'étapes » de l'autre.
