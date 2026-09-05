---
story: s49-contraste-des-alertes
validated: yes
---

# Plan — s49-contraste-des-alertes

## Le défaut, en une phrase

Un même jeton sert **deux métiers incompatibles** : remplissage vif (`bg-warning` du `Badge`, avec son `--warning-foreground` quasi-noir) et **texte sur teinte à 10 %** (`text-warning` sur `bg-warning/10` de l'`Alert`). `--warning` vaut `oklch(0.79 …)` : à cette clarté il est un bon fond et un texte illisible. Aucun réglage d'un jeton unique ne satisfait les deux.

## Décision (ADR à écrire)

**Voie retenue — une famille de jetons « texte sur teinte ».** Quatre nouveaux jetons `--<sémantique>-subtle-foreground`, teinte et chroma **conservées**, clarté abaissée jusqu'au seuil. L'`Alert` les emploie pour son texte ; bordure et fond ne bougent pas.

Rejetées, et pourquoi :

- **Assombrir `--destructive/--success/--warning/--info`.** Traverse tout le produit : `packages/ui/src/components/badge.tsx:16` peint `bg-warning text-warning-foreground`, et `--warning-foreground` est un quasi-noir. Assombrir le fond **baisse** le contraste du badge. Un correctif d'accessibilité qui en casse un autre.
- **Employer `--warning-foreground` comme texte de l'`Alert`.** Il passe le seuil (quasi-noir sur teinte claire), mais il efface le codage par la couleur — qui est exactement ce que la sémantique achète. Les quatre variantes deviendraient quatre rectangles au texte noir.
- **`text-foreground` pour tout.** Même perte, et en plus la variante `default` devient indistinguable des quatre autres.

## Valeurs, mesurées et non crues

Mode clair, texte sur `bg-<sem>/10` composé sur blanc :

| variante | avant | après | jeton |
|---|---|---|---|
| `destructive` | 3,99 : 1 | **4,84 : 1** | `oklch(0.510 0.245 27.325)` |
| `success` | 3,03 : 1 | **4,84 : 1** | `oklch(0.500 0.17 149)` |
| `warning` | **1,83 : 1** | **4,85 : 1** | `oklch(0.535 0.16 86)` |
| `info` | 3,24 : 1 | **4,88 : 1** | `oklch(0.520 0.16 250)` |

**Le mode sombre passe déjà**, sur la carte comme sur la page : 5,46 / 6,12 / 8,63 / 5,82 (carte) et 6,19 / 6,99 / 9,95 / 6,64 (page). En sombre, les nouveaux jetons **reprennent la valeur du jeton sémantique existant** — aucun changement d'apparence.

> Correction d'un chiffre de la recherche : elle donne `info` sombre à 4,41 : 1, sous le seuil. Recalcul indépendant : **5,82 : 1**. Ses quatre chiffres du mode clair sont reproduits à l'identique, donc l'écart est dans son chiffre sombre, pas dans la méthode. Sa conclusion — *le défaut est le mode clair seul* — tient.

## Tâches

- [x] **1. `scripts/contrast-rules.ts` — le calcul, éprouvé avant d'être cru.** OKLCH → sRGB linéaire → luminance relative WCAG → rapport, plus la composition d'une couleur à alpha sur un fond. Tests d'abord, sur des paires **connues indépendantes du dépôt** : noir sur blanc = 21 : 1, blanc sur blanc = 1 : 1, `#767676` sur blanc ≈ 4,54 : 1 (la paire limite de référence WCAG), et un cas d'alpha dont le résultat est vérifiable à la main. Un calcul faux rendrait la commande verte sur des couleurs illisibles : c'est le risque numéro un de cette story.
- [x] **2. La commande dérive ses paires de l'`Alert`, jamais d'une table.** `contrastPairs()` lit `packages/ui/src/components/alert.tsx` et en extrait, par variante, la classe de fond (`bg-X/10`) et la classe de texte (`text-Y`) ; puis résout `X` et `Y` dans `packages/ui/src/styles.css` pour les deux modes. Une table recopiée resterait verte après un changement de jeton — c'est précisément ce qu'`AGENTS.md` refuse. Test : ajouter une cinquième variante fictive dans une source de test la fait apparaître dans les paires.
- [x] **3. Plancher anti-balayage-vide.** La commande échoue si elle dérive **zéro** paire, ou moins de quatre. Sans ce plancher, une regex qui cesse de correspondre rend la commande verte en ne vérifiant rien — le défaut exact trouvé en s26 et en s48. Test : une source d'`Alert` sans variante fait rougir.
- [x] **4. `scripts/contrast.ts` + `pnpm test:contrast`.** Sortie : une ligne par paire, mode, rapport mesuré, seuil, verdict. Sort non-zéro dès qu'une paire passe sous **4,5 : 1** (texte normal : l'`Alert` rend du `text-sm`, le seuil « grand texte » à 3 : 1 ne s'applique pas). Câblée dans la CI aux côtés de `lint` et `typecheck`.
- [x] **5. Les huit déclarations + les quatre correspondances de thème.** `--<sem>-subtle-foreground` en clair (valeurs du tableau) et en sombre (valeur du jeton sémantique existant), dans `packages/ui/src/styles.css`, plus `--color-<sem>-subtle-foreground: var(--<sem>-subtle-foreground)` dans le bloc `@theme inline` — sans quoi Tailwind ne génère pas l'utilitaire.
- [x] **6. L'`Alert` emploie les nouveaux jetons.** Quatre lignes de `alertVariants` : `text-<sem>` → `text-<sem>-subtle-foreground`. Bordure et fond inchangés. **Aucun appelant ne change** — c'est le bénéfice de la voie retenue, et la revue doit pouvoir le vérifier au diff.
- [x] **7. Mutation, à l'endroit du défaut.** Remonter `--warning-subtle-foreground` à sa valeur d'avant (`oklch(0.79 0.16 86)`) doit faire rougir `pnpm test:contrast` en nommant `warning`. Si elle reste verte, le test est faux — pas le code.
- [x] **8. `docs/design-system.md` — consigner, pas décrire.** Sous la ligne `Alert`, un tableau des quatre paires avec leur contraste **mesuré** et le seuil visé, et la règle : *le texte sur teinte emploie `-subtle-foreground`, jamais le jeton de remplissage*. Nommer ce que la story **ne** corrige **pas** : les bordures `border-<sem>/50`, soumises au seuil 3 : 1 des éléments non textuels, ne sont pas mesurées ici.
- [x] **9. Vérification navigateur, deux thèmes.** Les écrans que s28 a livrés — `apps/web/app/public-form.tsx` et `apps/web/app/two-factor/two-factor-form.tsx` — rendus en clair et en sombre, refus visible et lisible. Le calcul suppose que le fond effectif est la carte ; seul le rendu le confirme.

## Ce que la story ne fait pas

Rendre le produit accessible. Elle corrige l'`Alert`, et elle écrit la commande qui empêchera la régression. Les bordures, les badges, les icônes et les états de focus gardent leurs contrastes actuels, non mesurés ici.

## Sections de `docs/security.md` touchées

Aucune. Story purement présentationnelle : ni frontière, ni autorisation, ni donnée.
