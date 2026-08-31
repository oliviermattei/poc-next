---
validated: yes
---
# Plan — Story s08-app-shell

Branch: `dev`. Research: `docs/research/s08-app-shell.md`. Validation déléguée.

## Target story

Le shell applicatif et les paramètres de compte — la première story d'interface, et la fondation dont quinze écrans hériteront. Sept critères repris de `docs/stories.md`.

Socles couverts : **`docs/security.md` §2** (les écrans de sécurité consomment les cas d'usage de s07, ils ne les réécrivent pas) et **§3** (la navigation ne montre que ce à quoi la session donne droit). `docs/design-system.md` fait autorité de bout en bout.

## Tasks (ordered)

1. [x] **Étendre le lint de couches aux `.tsx` — avant tout composant.** `boundariesConfig` et `libraryConfig` visent `packages/**/*.ts` ; s08 apporte les premiers composants React de module. Si l'ordre s'inverse, la règle meurt en silence le jour même où elle devient utile. Prouver par une violation réelle dans un `.tsx`.
2. [x] **`packages/ui`** — package, `AGENTS.md` (seule frontière avec Radix, aucun module ne l'importe directement), configuration TypeScript.
3. [x] **Tokens et CSS racine** — `@import "tailwindcss"` et `@theme` portant **exactement** les tokens de `docs/design-system.md` : échelle neutre, primaire, sémantiques, bordures, rayon. Pas de `tailwind.config.js` (Tailwind v4, ADR 010).
4. [x] **Typographie** — Geist Sans et Mono par `next/font`, aucune requête externe : une police servie par un CDN deviendrait un script tiers soumis au consentement de s36.
5. [x] **Composants** — copier depuis shadcn/ui sur Radix les primitives que le design system nomme et que cette story utilise réellement. Ne pas copier l'inventaire entier « pour plus tard ».
6. [x] **Thème** — clair/sombre par **classe** sur `<html>` (`next-themes`), jamais par `prefers-color-scheme` seul : le commutateur doit pouvoir contredire le système, et le choix persiste. Pas de clignotement au premier rendu.
7. [x] **Shell** — navigation latérale alimentée par `visibleNavigation(registry, session)` de s03, **sans une seule condition dans le composant** ; menu de compte ; `Sheet` sous `md`.
8. [x] **Paramètres du compte** — profil (nom, email avec revérification), sécurité (mot de passe courant exigé), sessions actives avec révocation individuelle. **Consommer les cas d'usage de s07**, ne rien réécrire.
9. [x] **Responsive** — utilisable sous 400 px sans débordement horizontal, vérifié à cette largeur.
10. [x] **Accessibilité** — trancher `jsx-a11y` : rétablir s'il existe une version compatible ESLint 10, sinon écrire ce sur quoi l'accessibilité repose (primitives Radix, tests de rôles et de navigation au clavier) dans `packages/ui/AGENTS.md`.

## Run interdicts

- **Aucun composant, aucun token hors `docs/design-system.md`.** Un besoin non couvert est un « design system gap » à signaler dans le rapport, jamais à combler sur place.
- **Aucun module n'importe Radix** : `packages/ui` est la seule frontière (ADR 022).
- **Ne pas réécrire les cas d'usage de compte de s07** — deux chemins de changement de mot de passe rendraient le §2 invérifiable.
- **Aucune condition de module dans le composant de navigation.**
- **Pas de `tailwind.config.js`.**
- **Aucune police servie par un domaine externe.**
- Ne pas toucher au contrat de module, à la génération de barils, au CLI, au port `Mailer`, ni à `config/features.ts`. `docs/` intouché hors cases de ce plan.

## The point everything turns on

**La fondation d'interface, parce que quinze écrans en hériteront.**

Trois endroits où une erreur se paie quinze fois :
- **Les tokens.** Comparer ce qui est écrit dans `@theme` avec `docs/design-system.md`, token par token. Un token inventé ici devient la norme de tout le produit, et le design system cesse de faire autorité dès la première divergence.
- **La frontière avec Radix.** Vérifier qu'aucun import de Radix ne sort de `packages/ui` — c'est ce qui rend l'ADR 022 réversible quand Base UI se stabilisera. Une garde, pas une intention.
- **La navigation sans condition.** Comparer le composant avec ce que s03 fournit : s'il contient un `if` sur un identifiant de module, l'angle n°1 est perdu côté interface, et aucun test de module ne le verra.

## Test strategy

Unitaire : rendu des composants, filtrage de la navigation selon la session, commutation et persistance du thème. Intégration : les écrans de compte appellent bien les cas d'usage de s07 (changement de mot de passe révoquant les autres sessions, vérifié côté serveur). Lint : la règle de couches mord dans un `.tsx` (tâche 1), aucun import Radix hors `packages/ui`. End-to-end : parcours de connexion jusqu'au tableau de bord, commutation de thème persistante, révocation d'une session, **et rendu sous 400 px sans débordement horizontal**.

## Definition of Done

Les sept critères satisfaits, chacun couvert par un test ou une recette manuelle tracée. `docs/design-system.md` respecté sans exception, écarts signalés comme gaps. `typecheck`, `lint`, `test`, `test:e2e`, `build`, `run audit` verts dans les états de configuration valides. Aucun interdit violé. Un commit sur `dev`. Revue en contexte frais passée.
