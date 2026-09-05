# ADR 055 — L'échelle de prose vit dans le design system, pas dans un module optionnel

- Status: accepted
- Date: 2026-09-05
- Scope: story s30-docs-site

## Context

`docs/design-system.md` porte une section « Échelle de prose — un corps
d'article long », onze lignes dérivées des huit rôles typographiques et de
l'échelle d'espacement. Elle annonce elle-même ses trois consommateurs :
« s29 (blog), s30 (documentation) et s31 (changelog) rendront toutes du MDX ».

s29 l'a **transcrite dans `@repo/module-blog/presentation`**
(`PROSE_CLASSNAME`, `proseComponents`), parce que le blog en était alors le seul
consommateur. s30 est le second, et l'emplacement devient une décision : la
documentation a besoin exactement du même objet typographique, et le contrat de
module n'autorise une dépendance inter-modules que par un `requires` déclaré
(ADR 018).

Le point n'est pas esthétique. `requires` est **exécutable** : `@repo/core`
refuse d'activer un module dont un requis est coupé, et `pnpm ks toggle blog`
refuse tant qu'un dépendant est activé. La question posée est donc : *couper le
blog doit-il rendre la documentation indisponible ?*

## Decision

**`PROSE_CLASSNAME` et `proseComponents` montent dans `packages/ui`**
(`src/composed/prose.tsx`), exportés par le baril `@repo/ui`. Le blog les
importe de là, comme n'importe quel autre consommateur ; la documentation aussi.
`@repo/module-blog/presentation` ne les réexporte pas — une seconde adresse
recréerait la dépendance qu'on retire.

C'est l'emplacement que le document désigne déjà : `packages/ui` est la
transcription de `docs/design-system.md` en code (`packages/ui/AGENTS.md` :
« ce package en est la transcription, pas la source »), et l'échelle de prose
est une section de ce document au même titre que les tokens et les huit rôles.

## Considered options

- **`requires: ['blog']` sur la documentation** — rejeté parce que la mesure est
  un produit incohérent, et qu'elle est vérifiable en une commande :
  `pnpm ks toggle blog` refuserait alors la coupure en nommant `docs`, et un
  projet qui n'a pas de blog devrait quand même en activer un pour publier sa
  documentation. Le `requires` est fait pour une dépendance **de donnée** (une
  clé étrangère, ADR 018), pas pour un partage de feuille de style.
- **Dupliquer l'échelle dans le module `docs`** — rejeté parce que le design
  system refuse explicitement une seconde autorité typographique : le
  commentaire de la transcription écarte déjà `@tailwindcss/typography` pour ce
  motif, et `docs/design-system.md` exige que chaque ligne de l'échelle **dérive**
  d'un rôle existant. Deux copies dérivent d'abord de la même source puis, à la
  première correction faite d'un seul côté, de deux. Aucune commande ne
  compare deux transcriptions entre elles ; une seule transcription est
  comparée au document par `tests/design-system.test.ts`.
- **Un troisième paquet partagé (`@repo/prose`)** — rejeté parce qu'il ajoute
  une couche pour deux consommateurs, et un `AGENTS.md`, un `package.json`, une
  entrée de `pnpm-workspace.yaml` et une source Tailwind à déclarer
  (`source(none)` : un fichier qu'aucun `@source` ne couvre ne produit aucune
  règle, sans erreur). Le coût est payé pour séparer du design system quelque
  chose que le design system décide déjà.
- **Laisser l'échelle dans le blog et l'importer sans `requires`** — rejeté
  parce que rien ne l'interdit aujourd'hui et que c'est précisément le
  problème : aucune commande du dépôt ne refuse qu'un module importe le paquet
  d'un autre module (`assertNoForbiddenModuleReferences` ne juge que les clés
  étrangères des schémas). La dépendance serait donc réelle, invisible, et
  `pnpm ks toggle blog` — qui ne consulte que les `requires` déclarés —
  accepterait de couper le blog en laissant la documentation sans typographie.

## Consequences

- **Ce qui devient plus facile** : s31 (changelog) est le troisième consommateur
  et n'a rien à décider. Un module qui rend du MDX importe `@repo/ui` comme il
  importe déjà `Button`.
- **Ce qui devient plus difficile** : `packages/ui` gagne un objet qui n'est pas
  une primitive shadcn/ui ni un composé d'écran. Sa règle locale
  (`packages/ui/AGENTS.md`) doit dire pourquoi il est là, sans quoi le prochain
  agent le prendra pour un intrus et le redescendra.
- **Ce qu'il faut surveiller** : ce déplacement touche du code livré par une
  autre story. Le critère d'acceptation est que **les parcours du blog restent
  verts sans réécriture d'une seule de leurs assertions** — une assertion
  retouchée pour accommoder le déplacement serait le signe que le déplacement
  n'est pas neutre.
- **La garde qui manque, et elle est nommée plutôt que comblée ici** : aucune
  commande ne refuse `import … from '@repo/module-<autre>'` dans un module.
  Le refus repose sur `AGENTS.md` de chaque module, c'est-à-dire sur de la
  relecture. C'est une règle non exécutable au sens d'ADR 013, et une story qui
  voudra la fermer aura à choisir son emplacement (une règle
  `no-restricted-imports` dérivée des `requires`, comme `organizations` en porte
  déjà une écrite à la main).
