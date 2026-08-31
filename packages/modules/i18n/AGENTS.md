# packages/modules/i18n — règles locales

Le module de langue : **le préfixe de locale dans les URL et le sélecteur**.
Rien d'autre. Il ne déclare ni route, ni table, ni migration, et son contrat
n'en est pas moins rempli au complet (ADR 007).

## Ce qui vit ici, et ce qui vit ailleurs

| Ce qui | Où | Pourquoi |
|---|---|---|
| Les locales **du projet** | `config/i18n.ts` | c'est ce que le propriétaire édite, et elles restent vraies module coupé |
| La règle « quelle locale servir » | `@repo/core` (`resolveLocale`) | elle est appelée par la requête, le sélecteur **et** l'envoi d'un email |
| Le routage **sans** préfixe | `@repo/core` (`singleLocaleRouting`) | il doit exister quand ce package n'est pas dans le dépôt |
| Le routage **avec** préfixe | ici (`application/locale-routing.ts`) | c'est la fonctionnalité que ce module apporte |
| Le composant `LocaleSwitcher` | `packages/ui` | c'est un composé du design system (`docs/design-system.md`), pas un composant de module |
| Le montage des deux états | `apps/web/lib/i18n.ts` | point de composition, comme `lib/auth.ts` et `lib/mailer.ts` |

Les deux routages implémentent la **même** interface (`LocaleRouting`). C'est ce
qui fait qu'un écran, une entrée de navigation ou un module écrit après s09
n'a aucune branche à porter : il appelle `publicPath` et `resolve`, et ne sait
pas si l'i18n est activée. Une condition sur l'existence de ce module dans du
code appelant est un défaut, pas une précaution.

## Imports autorisés

- `@repo/core` pour le contrat, la règle de locale et la forme du routage ;
- `@repo/typescript-config` pour la configuration du compilateur ;
- `vitest` dans les fichiers de test.

Aucune dépendance d'exécution : ce module est une poignée de fonctions de
chaîne. Il ne connaît ni Next, ni `next-intl`, ni le cookie qui porte le choix —
il reçoit `pathname`, `cookieLocale` et `acceptLanguage`, et rend une décision.

## Ne doit jamais contenir

- de texte d'écran : ses traductions ne couvrent que **lui** (le libellé du
  sélecteur et le nom des langues). Les chaînes d'un écran appartiennent au
  module ou à l'application qui l'affiche ;
- de lecture d'en-tête, de cookie ou d'environnement : la couche `application`
  reçoit une `LocaleRequest`, elle ne va pas la chercher ;
- de connaissance de `next-intl` : la bibliothèque est un détail du point de
  composition, et la remplacer ne doit pas rouvrir ce package.

## Tests

`tests/i18n.test.ts` à la racine : ce qui compte est le comportement des **deux
états** — module activé et module coupé —, donc un test qui traverse le module,
`@repo/core`, la configuration et l'application. Un test propre au module seul
prouverait la moitié qui ne pose aucun problème.

Le parcours navigateur (`e2e/i18n.spec.ts`) prouve ce qu'aucun test de nœud ne
peut : que les **mêmes URL** répondent dans les deux configurations.
