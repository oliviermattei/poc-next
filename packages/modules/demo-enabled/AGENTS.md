# packages/modules/demo-enabled — règles locales

Module de **démonstration**, activé dans `config/features.ts`. Il n'a pas de
valeur métier : il existe pour que la modularité soit vérifiable en continu, et
il sert de gabarit — au générateur de squelette (s41), à la recette de
modularité (s26), et à tout agent qui écrit son premier module.

Ce qu'il démontre, et qu'un module réel doit reproduire :

- les **quatre couches** et leur sens de dépendance (ADR 006), câblées dans
  `src/module.ts` qui est le seul fichier à les connaître toutes ;
- le **contrat complet** (ADR 007) : aucune clé omise, `emails`, `webhooks`,
  `jobs`, `purge`, `export` et `retention` compris ;
- le **niveau de protection déclaré** sur chaque route et chaque entrée de
  navigation (`docs/security.md` §3) — publique, authentifiée, réservée à un
  rôle — et **lu** : l'entrée `admin-report` n'apparaît que pour une session
  qui porte le rôle ;
- un `href` de navigation qui **mène quelque part** : tant qu'aucune page de
  module n'existe, il désigne la route montée du module, jamais un chemin
  d'écran qui répondrait 404 ;
- **Zod à la frontière** (corps de requête, charge utile de webhook) et un
  webhook **idempotent par identifiant d'événement**.

Les catalogues de traduction s'importent avec `with { type: 'json' }`. Ce n'est
pas décoratif : les parcours Playwright importent le registre de l'application,
donc ce module, et le chargeur ESM de Node refuse un import JSON sans attribut.
Un module qui l'omet fait échouer `pnpm test:e2e`, pas `pnpm test`.

## Imports autorisés

- `@repo/core` pour le contrat de module ;
- `zod` pour la validation — y compris dans `domain/`, où c'est la **seule**
  bibliothèque tierce admise (ni framework, ni ORM, ni SDK : `pnpm lint`
  refuse le reste) ;
- `drizzle-orm` pour la déclaration des tables, dans `src/schema.ts` et dans
  `infrastructure/` **uniquement** ;
- `@repo/typescript-config` pour la configuration du compilateur.

Sens des dépendances, vérifié par `pnpm lint` :
`presentation → application → domain` et `infrastructure → application →
domain`. `infrastructure` et `presentation` ne se connaissent pas.

## Ne doit jamais contenir

- de règle métier hors de `domain/` : une route qui valide de son côté crée une
  seconde vérité, et c'est la plus permissive qui gagne ;
- de framework, d'ORM, de SDK ni de module Node dans `domain/` ;
- d'import d'un autre module : un module ne dépend d'un autre que par la clé
  `requires` de son contrat, jamais par un import direct ;
- de clé étrangère vers un module optionnel : elle rendrait ce module
  silencieusement non désactivable ;
- de commande de nettoyage de ses tables — ce serait `eject`.

## Tests

Ce module est exercé depuis `tests/` à la racine (`tests/module-registry.test.ts`,
`tests/module-off.test.ts`) : ce qui est prouvé ici traverse le registre,
l'application et l'autre module de démonstration.

Un test propre au module irait dans `src/**/*.test.ts` — et serait soumis aux
règles de couches de la couche où il vit : un test de `domain` ne peut pas
importer `infrastructure`, même pour se fabriquer une doublure. Ce n'est pas une
règle trop stricte, c'est un `domain` qui n'est plus pur.
