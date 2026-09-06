# Review — s46-auth-screens-design

> Contexte neuf. Diff jugé : `git diff dev...feature/s46-auth-screens-design` (11 fichiers, +880/−239, commit `3ca3720`).

## Ce que la revue a joué elle-même

| Commande | Résultat |
|---|---|
| `pnpm typecheck` / `pnpm lint` | 36/36, aucun problème |
| `pnpm test` | **2825 verts, 14 sautés**, 100 fichiers — joué **3 fois** |
| `pnpm test:sans-env` | 2825 verts |
| `pnpm test:contrast` | 10 paires, toutes au-dessus de 4,5 : 1 |
| `E2E_PORT=3146 pnpm test:e2e` | **119 verts, 8 sautés — deux fois**, zéro échec |
| les trois specs d'authentification en configuration **socle** | 9 verts, 1 sauté |
| `pnpm build` puis `next start` | vert, plus 32 captures sur les cinq écrans × thèmes × 380 et 1280 px |

**Les 22 échecs du premier passage de l'implémenteur n'ont pas été reproduits.** Le premier passage de la revue était propre. Le serveur a bien émis un `⨯ Error: The destination stream closed early` sans faire échouer quoi que ce soit, ce qui est cohérent avec l'attribution à un plantage — mais cette attribution reste rétrospective et invérifiable.

## Le contrôle le plus tranchant

`git diff dev...HEAD --exit-code -- e2e/auth.spec.ts` → **vide**. Et le fichier n'est pas seulement intact, il est **vert** : les cinq parcours de s07 passent dans les deux exécutions complètes et en configuration socle. Le critère 6 est tenu des deux côtés.

## Conformité au plan

Les sept tâches sont faites. Un écart de lettre : le plan demandait la `Card` dans `auth-form.tsx`, elle est dans les cinq pages — c'est **mieux** (`/sign-in` a besoin d'une carte autour de deux formulaires), mais le plan est désormais inexact sur l'endroit où vit le cadre.

Le titre mesuré fait **30 px / 600** sous le build de production, là où la prémisse de la story annonçait 14 px.

**La réparation par `useId` est dans le périmètre, et elle est correcte.** Le défaut était réel et invisible : les parcours de s07 ne visent jamais le champ du lien de connexion, et leur `getByLabel(…, { exact: true })` existe précisément parce que deux libellés partagent un préfixe. Habiller avec un `Label` de Radix — dont tout le contrat est l'association `htmlFor`/`id` — en laissant deux `id="email"` dans un même document aurait été indéfendable. `useId` est le bon outil : `AuthForm` porte `'use client'`, donc le préfixe est stable du rendu serveur à l'hydratation. Rien dans `apps/web` ni dans `e2e` ne sélectionne ces champs par leur `id`.

## Mutations — chacune à son propre site, toutes restaurées

| # | Neutralisé | Résultat |
|---|---|---|
| 1 | `disabled={!hydrated}` retiré du bouton habillé | **1 rouge** |
| 2 | l'identifiant de champ revient au nom seul (le défaut d'avant s46) | **1 rouge** |
| 3 | une phrase française écrite en dur | **2 rouges** — le critère 4 vérifié **après** l'habillage |
| 4 | `max-w-md min-w-0` → `w-[520px]` sur `/sign-up` | **1 rouge**, nommant « déborde de 156 px à 380 px » |
| 5 | couleur des liens → `text-muted-foreground/50` | **1 rouge**, nommant « 1,96 : 1 » |
| 5bis | la même, en configuration **socle** | **1 rouge** — la garde ne dépend pas de la configuration |
| 6 | `method="post"` retiré du `<form>` | `tests/lint-rules.test.ts` reste **vert** ; **`pnpm lint` rougit**. L'invariant tient — par ESLint, que la CI joue — mais pas par le fichier que le commentaire du nouveau test crédite |

**La mutation verte rapportée par l'implémenteur est confirmée, et son correctif aussi** : `expect(button).toContain('disabled')` était bien satisfaite par la classe `disabled:pointer-events-none` du bouton ; le `/\sdisabled=""/` corrigé mord.

## Affirmations vérifiées plutôt que crues

« 32 paires, plus basse à 4,74 : 1 » — **dérivé, exact**. « 28 rendus » — 28 annotations, toutes à 0 px. Le plancher du balayage — « un titre, trois étiquettes, trois champs, quatre boutons et trois liens » — mesuré à 16 éléments pour un plancher de 10 : honnête, et c'est une vraie garde d'anti-vacuité. L'extraction de `painted()` est **identique octet pour octet** à l'original de s49, et les trois parcours de contraste de s49 passent. Le correctif de l'instabilité est **un correctif, pas une reprise** : les poignées sont prises une fois, et l'attente d'hydratation est un signal positif, pas une temporisation.

## Sécurité

`method="post"` en littéral sur chaque formulaire, et `pnpm lint` refuse son retrait. **Aucun message n'est devenu plus bavard** : les catalogues ne sont pas dans le diff, et les quatre statuts mappent les quatre mêmes clés. Compte inconnu, mot de passe faux et adresse non vérifiée affichent toujours le même message — parcours vert trois fois. La variante `warning` est réservée au 429, déjà distinguable par son texte depuis s28 : aucun nouvel oracle.

## Constats

**1. major — `packages/ui/src/styles.css:86` : `--ring` est à 2,59 : 1 sur `--background` en thème clair.** La WCAG demande 3 : 1 pour un indicateur de focus non textuel. Calculé indépendamment par la revue avec les propres outils du dépôt. **Cela concerne tous les contrôles focusables du dépôt**, pas seulement ces écrans. **Préexistant, non introduit par ce diff.** Aucune commande ne le voit. L'implémenteur a eu raison de ne pas le plier dans une commande verte : cela demande sa propre story.

**2. major — `Button variant="destructive"` est à 2,77 : 1 en thème sombre** (4,56 en clair, tout juste). Confirmé indépendamment. Préexistant, non utilisé dans ce diff, mesuré par aucune commande. Même traitement : réel, hors périmètre, non bloquant.

**3. minor — le report des manques vit là où le prochain agent ne le trouvera pas.** La décision sur `Form` et le manque « aucune largeur de lecture » ne sont écrits que dans le plan (local à la branche) et dans des commentaires de code. Le précédent du dépôt met les manques **dans `docs/design-system.md`** — quatre y figurent déjà. Lié : `docs/design-system.md:285` prescrit encore react-hook-form avec erreurs par champ, un motif que trois composants livrés ne suivent délibérément pas.

**4. minor — `/two-factor` est désormais visiblement hors famille** : pas de carte, pas de largeur, un `<h1>` écrit à la main là où les cinq écrans habillés utilisent `PageHeader`. L'implémenteur nomme la divergence, mais rien ne la mesure : la liste des écrans balayés est **écrite**, et `/two-factor` n'y est pas.

**5. minor — le bouton éteint ne dit toujours pas pourquoi.** `apps/web/AGENTS.md:292` l'exige, et deux autres formulaires du dépôt portent le `<noscript>` qui le fait. Préexistant — mais s46 est la story dont la classe est « un écran qui a l'air fini », et elle vient de transformer un bouton nu en bouton primaire proéminent à `disabled:opacity-50`. Sans JavaScript, `/sign-in` a maintenant l'air fini et reste silencieusement inutilisable.

**6. minor — un commentaire nomme le mauvais garde** : `tests/auth-screens.test.ts` crédite `tests/lint-rules.test.ts` pour `method="post"` ; c'est `pnpm lint` qui rougit. Les deux sont en CI, donc l'invariant tient — c'est la phrase qui est fausse, et c'est exactement le genre de citation que le prochain agent croirait sans vérifier.

**Note, hors diff** : `docs/design-system.md` compte `Table` parmi les composants « qui n'existent pas », alors qu'il existe et qu'il est exporté. La liste était déjà périmée le jour où elle a été écrite.

## Non vérifié

- **États de focus, survol, et bouton éteint avant hydratation : jamais rendus**, ni par la revue ni par un test. C'est là que vit l'anneau à 2,59 : 1, et une capture ne le montre pas.
- **Contraste non textuel** — bordures de champ, de carte, séparateur, bordures d'alerte — mesuré par rien.
- **Un seul navigateur** (Chromium). **Aucun appareil réel** : 380 px émulé, aucun clavier virtuel ouvert par-dessus le formulaire.
- **Aucun lecteur d'écran** : la réparation par `useId` est le changement qui compte le plus pour lui, et elle n'est prouvée que par le balisage.
- **Contraste mesuré sur `/sign-in` seulement** ; les quatre autres composent les mêmes composants, mais c'est une inférence.
- **Les preuves de build de production ont tourné en `NODE_ENV=development`** sur le bundle de production : le chemin du nonce CSP en vrai mode production n'a pas été exercé sur ces écrans.

Max severity: major
Ship allowed: yes
