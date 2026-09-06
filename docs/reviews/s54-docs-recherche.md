# Review — s54-docs-recherche

> Contexte neuf. Diff jugé : `git diff dev...feature/s54-docs-recherche`, commit `082c1e2`, 31 fichiers, +1595/−26.

## Ce que la revue a joué elle-même

| Commande | Résultat |
|---|---|
| `pnpm test` | **2720 verts, 14 sautés**, 93 fichiers |
| `pnpm typecheck` | 36/36 |
| `pnpm lint` | aucun problème |
| `pnpm run audit` | sortie 0 |
| `pnpm test:sans-env` | 2720 verts, 97 fichiers |
| `pnpm test:minimal-profile` | 6/6 — 11 modules coupés dont `docs`, **15 routes** de modules activés, 8 entrées en 404 |
| `E2E_PORT=3154 … e2e/docs.spec.ts` | 7 verts |
| `pnpm build` | sortie 0 (voir mineur 2) |
| Navigateur | Chromium **et** WebKit, 1280 et 390 px, `fr-FR` et `en-US`, clair et sombre |

## Conformité au plan

Les huit tâches ont atterri. L'interdit de la tâche 1 tient : `packages/ui` ne gagne que `command.tsx`, ses exports, la dépendance et son `AGENTS.md`. **Aucun `Dialog` n'est passé en contrebande** — le baril n'exporte que `Command…`, et `docs/design-system.md` continue de compter `Dialog` parmi les absents, correctement. `routes: []` est **identique octet pour octet** à `dev`, aucune route n'est apparue sous `apps/web/app/api`, et le balayage du profil minimal compte toujours 15 routes — exactement ce que la recherche prédisait pour « aucune route ajoutée ».

## Anti-hallucination

Chaque import ouvert : `cmdk@1.1.1` (ses sous-composants et les props `shouldFilter`/`label` existent réellement), `@radix-ui/react-dialog@1.1.23` (déjà dépendance de `packages/ui` par `Sheet`), `SearchIcon`, `docsNavigationTree`, `docsPageView`, `DocsCatalog`. Aucune API inventée.

Les deux affirmations soumises, vérifiées depuis la source plutôt que crues :

- `cmdk` pose bien un `style` **en ligne** sur son étiquette masquée.
- **Le raisonnement CSP qui justifie de ne monter la palette que dans une boîte de dialogue est exact**, et la revue l'a prouvé plutôt que de le croire : sous `style-src 'self' 'nonce-…'` sans `unsafe-inline`, `el.style.setProperty(…)` s'applique, `el.setAttribute('style', …)` est **bloqué**. React écrit les styles montés côté client par le CSSOM : la palette tient en production, mais une palette rendue au serveur verrait son étiquette « visuellement masquée » **devenir visible**. L'assertion `style="` porte donc la charge, elle n'est pas décorative.
- `security-headers.ts:114` confirme que `style-src` ne porte `'unsafe-inline'` **qu'en développement** : le compteur de violations du navigateur ne peut effectivement pas voir cette classe de défaut. La divulgation de l'implémenteur est exacte.

## Mutations (toutes restaurées, arbre propre après chacune)

| # | Neutralisé | Rouges |
|---|---|---|
| 1 | `refuseDeadLinks` → sans effet | **4**, dont le cas posé **au site qui lit le disque** |
| 2 | comparaison du plafond → `if (false)` | **1** |
| 3 | locale ignorée (page canonique forcée) | **2** |
| 4 | garde `entries.length === 0` retirée | **1** |
| 5 | `CommandDialog` → `Command` dans le flux de la page | **2** |
| 6 | `documentLinks()` → `[]` (balayage vide) | **4**, dont le plancher |

**Les deux mutations vertes ont été rejouées et sont bien vertes — et c'est correct**, pas un trou : React ne rend aucun portail côté serveur, donc l'invariant « aucun attribut `style` dans le HTML servi » n'est réellement pas enfreint par une boîte ouverte.

**Le plafond est mesuré sur l'index livré, par locale servie** : fr 2 866 o, en 2 669 o pour 3 pages contre 65 536 — marge réelle, plafond réel, plancher non vide.

**L'élargissement de `tests/rendered-text.test.ts` est plus étroit qu'il n'y paraît** : l'appartenance à `rules.data` est une **égalité de chaîne**, pas une inclusion. Ajouter le corps d'une page admet ce corps entier et rien d'autre.

## Constats

**major — `packages/ui/src/components/command.tsx`** — une chaîne anglaise non traduite est annoncée **dans toutes les locales**. `cmdk` donne à sa liste l'`aria-label` par défaut `"Suggestions"` ; `CommandList` ne transmet aucun `label`. Mesuré dans le navigateur, Chromium **et** WebKit, en `fr-FR` : `listbox "Suggestions"` est le seul nom non français de la boîte. **Aucune commande ne l'attrape** — la chaîne n'est dans aucune source `.tsx`, donc le balayage i18n ne la voit pas, et le seul filet qui la verrait suppose un rendu serveur que le design empêche délibérément. C'est exactement contre la raison que `command.tsx` invoque lui-même pour rendre `title`, `description` et `closeLabel` obligatoires : la quatrième chaîne a été oubliée.

**major — `packages/modules/docs/AGENTS.md`** — la revendication de nouveauté de la story est **fausse contre `dev`**, et elle est écrite dans un règlement de package. Le diff affirme en quatre endroits être « le **premier** mécanisme du dépôt qui juge une *relation* entre deux fichiers ». Or `dev` refuse déjà, **dans la fonction même** où `refuseDeadLinks` a été ajouté : une page dont la section n'a pas de `section.json` dans la locale par défaut, et une page écrite uniquement en traduction. Les deux croisent deux fichiers. Aucun comportement n'est affecté ; le règlement est faux, et la règle racine interdit précisément ce genre d'affirmation.

**minor — `packages/ui/AGENTS.md:198-205`** — le rapport de mutation est mesurablement faux sur deux points : le filet annoncé « et lui seul » donne **2 rouges**, et la phrase attribue deux mutations différentes à une seule.

**minor — `turbo.json`** — `pnpm build` **ne rougit pas** sur un lien mort quand Turbo rejoue un build en cache. Mesuré : lien mort ajouté, `pnpm build` → **sortie 0, FULL TURBO** ; `turbo run build --force` → sortie 1, nommant correctement les deux bouts. Cause : `content/` est hors de `apps/web` et hors de `globalDependencies`, donc une modification de contenu n'invalide pas l'empreinte. Préexistant (cela masque aussi les refus de frontmatter de s29 et s30) et sans effet en CI, qui ne cache pas Turbo — mais le critère de s54 dit littéralement « fait échouer le build ».

**minor — `docs-search.ts`, `tokensOf`** — une requête composée uniquement de caractères non latins se comporte comme une requête **vide** : zéro jeton, donc l'index entier est renvoyé. « Tout correspond » est une pire réponse que « rien ne correspond », dans un boilerplate destiné à être localisé. Aucun test.

**minor — `packages/ui/AGENTS.md:109`** — « `cmdk` … dans `command.tsx` seulement » est une règle sans commande. Vraie aujourd'hui, vérifiée par balayage ; suit le précédent de `get-nonce` (s45) plutôt que d'ouvrir un nouveau trou.

## Vérifié et écarté

- **La dépendance `cmdk` ne demande pas d'ADR** : l'ADR 022 arbitre Radix contre Base UI comme **base de primitives** ; `cmdk` n'est pas une base concurrente — Radix ne publie aucune primitive de palette — et ses propres dépendances sont Radix. `next-themes`, `lucide-react` et `get-nonce` sont entrés sans ADR. Poids : 116 Ko décompressés, ses quatre paquets Radix transitifs étaient déjà là.
- **`docs/design-system.md` 16 → 15 est exact**, dérivé : aucun des 15 absents nommés n'est exporté, et `Command` l'est désormais.
- **Le critère 4 est satisfait, pas contourné.** Le libellé dit « n'est pas proposée **comme si elle y était** », pas « n'est pas proposée ». Vérifié : la page non traduite paraît avec son badge. La cacher contredirait s30, qui la sert.
- **`CommandDialog` ne fait entrer aucun composant en contrebande** : sa classe de voile est identique à celle de `sheet.tsx`.

## Non vérifié — les gestes qui appartiennent à un humain

- **Aucun passage sur le build de production.** Le comportement de la palette sous la **vraie** CSP est inféré d'une expérience synthétique, pas observé sur l'application. **Geste** : construire l'image, la démarrer avec une configuration réelle, ouvrir la palette, confirmer que la console est muette et que l'étiquette masquée le reste.
- **L'usage au clavier seul n'a jamais été exercé** : ni ↑/↓, ni Entrée, ni Échap.
- **Aucun lecteur d'écran** : le constat 1 est mesuré sur l'arbre d'accessibilité, pas sur ce qu'une synthèse vocale prononce.
- **Firefox non testé** (binaire absent de cette machine).
- **L'échelle n'a jamais été exercée** : index mesuré sur 3 pages, plafond jamais atteint sur du contenu réel, palette jamais lue avec 60 pages dedans.

Max severity: major
Ship allowed: yes
