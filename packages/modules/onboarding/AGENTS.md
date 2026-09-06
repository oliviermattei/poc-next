# packages/modules/onboarding — règles locales

Le **parcours d'intégration** (s40) : ce qu'un compte doit franchir avant
d'atteindre le tableau de bord, et l'état persisté de sa progression.

Squelette généré par l'API exportée `scaffoldFiles('onboarding')`
(`packages/cli/src/scaffold-files.ts`), puis rempli. `npx ks scaffold` refuse un
arbre de travail sale (`assertRepositoryClean`, ADR 041), ce qui est
incompatible avec une story en cours : c'est la même génération, appelée par sa
porte importable.

## Ce que ce module ne fait pas, et c'est le point

**Il ne sait pas quelles étapes existent.** Il les reçoit — `stepsOf(userId)`,
posé par le point de composition de l'application (`apps/web/lib/onboarding.ts`)
—, exactement comme `storage` reçoit `readableScopes` et `notifications`
reçoit `scopeOf`.

Conséquence, et c'est le critère 3 de la story : **aucun nom de module
n'apparaît nulle part ici**. Couper `organizations` retire l'étape
d'organisation, couper la facturation retire l'étape d'offre, couper `storage`
retire l'avatar **de l'étape de profil** sans retirer l'étape — et pas une
ligne de ce package ne change. Une liste d'étapes écrite ici casserait l'angle
que le PRD vend.

Il ne réécrit pas non plus **ce que les étapes recueillent** : le nom et
l'avatar sont déjà édités par `/account`, l'organisation par `/organizations`,
l'offre par la page des tarifs. L'écran reçoit ces affordances en `panel`.

## Les trois règles qui décident

Elles vivent dans `src/domain/onboarding.ts`, et ce sont des fonctions pures :

- **`courseOf`** — le parcours d'un compte. Une étape franchie que plus aucun
  module ne propose est **ignorée**, jamais refusée : l'utilisateur n'y peut
  rien, et une progression qui bloque sur une décision d'exploitant est pire
  que la même progression amputée ;
- **la porte à sens unique** — `completedAt` non nul, le parcours n'est plus
  proposé, **même** si un module activé après coup ajoute une étape. Une erreur
  de ce côté enferme l'utilisateur dans une boucle, ce qui est plus grave que
  de lui montrer une étape de trop. Elle n'est armée que par un
  **franchissement** : un parcours dont la dernière étape sort de la liste
  s'arrête sans être clos, et rouvre si elle redevient dérivable — c'est le sens
  que le point de composition a choisi pour l'étape d'organisation, et les deux
  moitiés sont mesurées par `src/domain/onboarding.test.ts` ;
- **`clearanceOf`** — passer une étape **obligatoire** est refusé, et valider
  une étape dont l'exigence n'est pas remplie l'est aussi. Sans la seconde, la
  première se contourne en cliquant « continuer ». Le défaut est **silencieux** :
  rien ne casse, l'utilisateur arrive au tableau de bord sans nom.

`displayNameProvided` est la quatrième, et elle mérite sa raison : l'inscription
pose le nom **à l'adresse** (`auth-routes.ts`, route `signUp`), donc « le nom
n'est pas vide » serait vrai de tout compte dès sa création.

## Imports autorisés

- `@repo/core` pour le contrat de module, `@repo/ui` pour l'écran,
  `drizzle-orm` pour la table, `zod` à la frontière des routes, `react` pour le
  rendu (en pair, jamais embarqué), `@repo/typescript-config` pour la
  configuration du compilateur, et `@types/node`, `@types/react`, `typescript`
  et `vitest` pour l'outillage ;
- **aucun autre module**. La seule dépendance inter-modules déclarée est
  `requires: ['auth']`, et elle n'est pas décorative : un parcours appartient à
  un compte, et c'est ce qui place la purge de ce module avant celle de `auth`
  (ADR 029).

## Ne doit jamais contenir

- de règle métier hors de `domain/` ;
- un identifiant de module, ni dans le code, ni dans un catalogue de messages ;
- une clé étrangère vers `auth_user` : une cascade effacerait la ligne sans
  passer par `purge`, et le module perdrait la seule porte où l'effacement est
  observable (`docs/reliability.md` §1).

## Tests

`src/domain/onboarding.test.ts`, à côté de la règle qu'il couvre. Le câblage —
la dérivation des étapes, la redirection de la racine, le module coupé — vit
dans `tests/onboarding.test.ts`, parce qu'il traverse les packages.
