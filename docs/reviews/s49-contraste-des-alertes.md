# Revue — s49-contraste-des-alertes

Diff jugé : `git diff dev...feature/s49-contraste-des-alertes` (12 fichiers, +1108/−4).

## Ronde 1

### Suites exécutées par le relecteur

| Commande | Résultat |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 (26/26) |
| `pnpm test` | 2100 passés, 8 sautés, 68 fichiers |
| `pnpm test:contrast` | exit 0 — 10 paires, toutes au-dessus du seuil |

Rejeu après chaque mutation : identique, `git diff --exit-code` propre.

### Ce qui a été vérifié et tenu

Le relecteur a **réimplémenté indépendamment** le calcul colorimétrique (matrices d'Ottosson, cartographie de gamut CSS Color 4) et reproduit exactement les chiffres du diff : clair avant 3,99 / 3,03 / 1,83 / 3,24 ; clair après 4,84 / 4,84 / 4,85 / 4,88 ; sombre 5,46 / 6,12 / 8,63 / **5,82**. La correction que le plan apporte au chiffre de la recherche (`info` sombre, 4,41 → 5,82) est juste.

Deux hypothèses portantes, vérifiées vraies : la composition en espace encodé est la bonne pour `bg-<sem>/10` (Tailwind v4 émet `color-mix(in oklab, … 10%, transparent)`, le navigateur compose en sRGB gamma) ; et `--card` est bien le **pire cas** des deux surfaces candidates — sur `--background` les rapports sombres montent à 6,19 / 6,99 / 9,95 / 6,64.

Un risque traqué puis écarté : quatre des huit nouveaux jetons sont **hors gamut sRGB**, où l'écrêtage par canal du script diverge de la réduction de chroma du navigateur. Le relecteur a implémenté l'algorithme de la spécification : la cartographie laisse le rapport égal ou **supérieur** (destructive 4,84 → 5,08). L'écrêtage est conservateur ici.

Déclarations vérifiées au diff : **aucun des 25 appelants d'`Alert` ne change** (`git diff --stat -- apps packages/modules config` vide) ; `AGENTS.md` gagne une ligne et zéro suppression, aucune règle modifiée.

### Table de mutation (ronde 1)

| # | Neutralisé | Rouge |
|---|---|---|
| 1 | `--warning-subtle-foreground` → valeur d'avant | `test:contrast` exit 1 nommant `warning (clair)` ; 1 rouge vitest |
| 2 | `text-warning-subtle-foreground` → `text-warning` | exit 1 ; 1 rouge |
| 3 | plancher anti-balayage-vide désactivé | 2 rouges |
| 4 | dés-ancrage de la recherche du bloc `.dark` | **0 rouge — vert intégral** |
| 5 | composition en linéaire au lieu d'encodé | 5 rouges |
| 6 | suppression de l'encodage gamma sRGB | 2 rouges, aucun sur un cas de référence |
| 7 | retrait d'une correspondance `--color-*` | 1 rouge |
| 10 | retrait de la disposition socle | 1 rouge |

### Constats

**M1 — majeur — `scripts/contrast-rules.ts:347` : réintroduire le bug que la story dit avoir corrigé est vert intégral.** La mutation 4 remplace l'ancrage `^\s*\.dark\s*\{` par une recherche littérale — précisément le défaut décrit : le premier `.dark` du fichier est dans `@custom-variant dark (&:where(.dark, .dark *))`, et `indexOf('{')` depuis là tombe sur `:root {`. Résultat : **36/36 tests passent**, `test:contrast` sort 0 en imprimant six lignes « sombre » identiques aux lignes « clair ». Le correctif est juste aujourd'hui ; le filet est plus étroit que son nom, et la ligne ajoutée à `AGENTS.md` promet « dans les deux thèmes ».

**M2 — majeur — `tests/contrast.test.ts` : les références « extérieures au dépôt » n'exercent pas la fonction de transfert sRGB**, qui est le risque numéro un déclaré de la story. La mutation 6 supprime l'encodage gamma : les cinq aller-retours OKLCH→hex restent verts, noir sur blanc 21 : 1 et `#767676` ≈ 4,54 aussi. Cause structurelle : les primaires sRGB et le noir/blanc sont aux coins du gamut, où linéaire et encodé coïncident, et les paires WCAG sont en hexadécimal — elles ne traversent jamais le convertisseur. Les deux seuls rouges étaient des assertions incidentes du dépôt. Une référence achromatique de demi-ton — `oklch(0.5 0 0)` → `#636363` — exercerait le cube **et** la fonction de transfert.

**M3 — majeur — le critère d'acceptation 4 n'est que partiellement tenu, et rien au diff ne consigne ce qui a été vu.** L'implémenteur concède que trois des quatre variantes (`destructive`, `success`, `info`) ont été **calculées, jamais rendues**. Le critère demande que les écrans soient « rendus dans les deux thèmes et vérifiés ». Le diff ne porte ni capture, ni note de rendu, ni assertion touchant les nouveaux jetons. C'est la seule classe de défaut que les commandes ne voient pas, sur une story dont le sujet entier est la lisibilité, avec 0,34 de marge en clair.

**m1 — mineur — `SURFACE_TOKEN` est la seule hypothèse écrite en dur** d'une commande par ailleurs entièrement dérivée. Basculée sur `--muted` (un jeton du système), trois des quatre passent sous AA : 4,46 / 4,46 / 4,48. Aucun appelant actuel ne déclenche le cas — 16 fichiers portant `<Alert` ouverts, le seul `bg-muted` voisin est un frère, pas un ancêtre.

**m2 — mineur — l'ADR 056 annonce « mesure les huit » ; la commande en mesure dix.** La variante `default` est dérivée et mesurée aussi. Exactement le motif « affirmation mesurée que personne ne peut vérifier » qu'`AGENTS.md` nomme.

**m3 — mineur — deux contraintes d'extraction invisibles depuis le composant.** `FOREGROUND`/`BACKGROUND` prennent la **première** correspondance : `'text-sm bg-warning/10 …'` résoudrait le jeton `--sm`. Et `parseColor` refuse `var(…)`, d'où les copies littérales en mode sombre — un futur changement de `--warning` dans `.dark` cesserait silencieusement d'être suivi. Les deux échouent fermé, donc aucun n'est un défaut ; aucun n'est écrit.

### Non vérifié en ronde 1

Rien n'a été rendu dans un navigateur par le relecteur. Le CSS réellement émis par Tailwind n'a pas été inspecté. La cartographie de gamut a été comparée à une implémentation de la spécification, pas à un navigateur réel. `pnpm test:socle` et la suite e2e n'ont pas tourné.


## Ronde 2 — après correction des trois majeurs

Diff jugé à `4b105ff` (13 fichiers, +1516/−4). Delta depuis la ronde 1 : 6 fichiers, +413/−5.

### Suites exécutées par le relecteur

| Commande | Résultat |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 — l'`include` racine couvre `e2e/`, donc chaque import de la nouvelle spec est vérifié par le compilateur |
| `pnpm test` | **2104 passés, 8 sautés**, 68 fichiers (ronde 1 : 2100) |
| `pnpm test:contrast` | exit 0, 10 paires |
| `pnpm exec playwright test` — **suite e2e complète** | **102 passés, 8 sautés**, exit 0, sur une base `app_s49r2` créée puis supprimée |

### Les trois majeurs, fermés et prouvés

**M1 — fermé.** Mutation 4 rejouée à son site : **2 rouges** (ronde 1 : 0), dont un qui lit `packages/ui/src/styles.css` lui-même — le fichier qui porte le piège `@custom-variant` — et qui est **dérivé** (il filtre les variantes dont le rapport diffère entre modes) plutôt que d'épingler un nombre. À savoir : `pnpm test:contrast` seule sort toujours 0 sous cette mutation ; le filet vit dans Vitest, et la CI joue les deux — mais la commande n'est pas auto-gardée.

**M2 — fermé, et l'arithmétique est juste.** Vérifiée à la main et par une implémentation indépendante des matrices d'Ottosson : `oklch(0.5 0 0)` donne un RGB linéaire `[0,125, 0,125, 0,125]`, encodé `#636363`, luminance exactement 0,125, donc `1,05 / 0,175 = 6`. Sans gamma la même paire donne 16,32 — ce que le commentaire du test annonce. Mutation 6 rejouée : **4 rouges** (ronde 1 : 2), dont **2 sur les cas de référence**, pas sur des assertions incidentes.

**M3 — fermé, et c'est la preuve la plus forte du diff.** `e2e/alert-contrast.spec.ts` échantillonne réellement depuis Chromium : la pile de fonds ancêtres est repeinte dans un canvas 1×1 et le pixel relu ; la seule chose empruntée au code sous test est l'arithmétique WCAG, elle-même épinglée indépendamment sur 21 : 1, `#767676` et 6 : 1. La conversion OKLCH→sRGB et la composition alpha — les parties risquées — ne sont **pas** réutilisées. Les deux voies d'échec ferment : couleur non analysable (aller-retour sentinelle `#010203`) et pile qui ne devient jamais opaque (`alpha !== 255`).

Le relecteur a rejoué la spec et **reproduit la table publiée exactement** — huit rapports, seize valeurs hexadécimales, version de Chromium comprise. Puis il a muté les jetons *dans le navigateur* : ramener `--warning-subtle-foreground` à sa valeur d'avant fait afficher **1,83 : 1** par Chromium. Le chiffre de départ de la recherche, reproduit par un vrai moteur de rendu.

### Aucun changement de production depuis la ronde 1 — prouvé

`alert.tsx` absent du delta ; les lignes de déclaration `--` de `styles.css` identiques entre `f6f5851` et `4b105ff` ; `contrast-rules.ts` identique une fois les commentaires retirés.

### Constats de ronde 2

**m1 — mineur — `docs/design-system.md` : l'explication de la table navigateur est fausse pour une de ses quatre lignes.** Elle affirme que les quatre écrans posent leur alerte sur la page ; `success` non — `ContactForm` enveloppe `PublicForm` dans une `<Card>`. Le navigateur a mesuré la carte. La phrase est fausse, et elle **cache une bonne nouvelle** : la surface `--card` que `SURFACE_TOKEN` suppose, et que la ronde 1 disait jamais rendue, est confirmée au navigateur à 0,01 près.

**m2 — mineur — « 25 appelants d'`Alert` » est un compte écrit à la main, et il est faux**, dans l'ADR, dans `design-system.md` et dans le plan. Mesuré : **23** sites sur **17** fichiers ; 25 vient d'un grep `<Alert` incluant `<AlertTitle` et `<AlertDescription`. Même défaut que celui corrigé deux lignes plus haut dans le même ADR.

**m3 — mineur — `e2e/alert-contrast.spec.ts` n'a pas de plancher anti-balayage-vide**, dans une story qui en installe un côté script pour exactement cette raison. Deux de ses trois tests sont gardés par disponibilité de module ; dans la branche `socle`, `marketing` est coupé et `success` n'est jamais mesuré au navigateur. Pas un trou aujourd'hui — le script reste le contrôle dérivé bloquant dans les deux branches — mais c'est le seul endroit où la story n'applique pas son propre standard à elle-même.

**m4 — mineur, contre la règle et non contre la story — `AGENTS.md` est muet sur les ADR non fusionnés.** La ligne « Immutable » ne distingue pas un ADR accepté sur la branche par défaut d'un brouillon de branche, et le champ `Status` ne peut pas arbitrer puisque tout ADR de story est estampillé `accepted` sur sa branche avant fusion. Relève d'un changement séparé du fichier racine.

**m5 — mineur, hérité de la ronde 1, partiellement clos — `SURFACE_TOKEN` reste la seule hypothèse écrite en dur.** Atténué plus que le diff ne le disait : la surface carte est désormais confirmée au navigateur pour `success`, la surface page pour les trois autres.

### Non vérifié en ronde 2

Chromium 151 seul, `next dev` seul, viewport par défaut. Aucun rendu sous `pnpm build`. **`two-factor-form.tsx` n'a été rendu par personne** — c'est l'écran que la tâche 9 nommait, et celui qui porte le refus de limitation de s28. La surface `--card` en mode sombre pour `destructive`, `warning` et `info` reste sur le papier. `pnpm test:socle` non joué.

## Ronde 3 — correction documentaire (m1, m2)

Commit amendé en `51bf0c8`. Trois fichiers touchés : l'ADR, `docs/design-system.md`, le plan. **Les dix fichiers portant du code sont identiques au hachage de blob** — la preuve de non-régression de la ronde 1 tient donc encore. Aucune mutation, aucun test ajouté ni supprimé : la charge de preuve d'un correctif documentaire est la mesure, pas un rouge.

L'implémenteur a mesuré lui-même avant d'écrire : 23 sites sur 17 fichiers, et l'origine du 25 reproduite. Sur le chiffre compagnon « dont 8 en `warning` », il **refuse de confirmer 7** et explique pourquoi : sept sites nomment `warning` sur leur ligne, mais un huitième peut le rendre sans que le mot apparaisse — `billing-screen.tsx:191` passe `variant={ALERT_VARIANT[view.state]}`, et la table associe `past_due` à `warning`. « 7 ou 8 selon la question posée ». C'est le même artefact de grep que le 25, dans l'autre sens ; d'où le retrait des nombres nus plutôt que leur remplacement. Ce chiffre-là vit dans `docs/research/`, déjà fusionné sur `dev` : le corriger ici tirerait un document de cadrage dans la demande de fusion de la story. Laissé pour `dev`.

m3, m4 et m5 sont laissés ouverts délibérément et documentés ci-dessus.

Max severity: minor
Ship allowed: yes
