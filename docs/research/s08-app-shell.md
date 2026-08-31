# Research — Story s08-app-shell

## The five structuring facts

1. **C'est la première story d'interface, et elle crée `packages/ui`.** Rien n'existe aujourd'hui : `apps/web` sert des écrans d'authentification sans style, il n'y a ni Tailwind, ni composant partagé, ni thème. Tout ce que s08 pose sera copié par les quinze stories d'écran qui suivent.
2. **`docs/design-system.md` fait autorité et n'est pas négociable.** Il fixe les tokens en `oklch`, la typographie Geist, le rayon de 0,5 rem, la densité confortable, l'inventaire des composants et les patterns d'état. Inventer un composant ou un token hors système est interdit ; un besoin non couvert est un « design system gap » à signaler, pas à combler.
3. **Tailwind v4 n'a pas de fichier de configuration JavaScript** (ADR 010). Les tokens vivent dans une directive `@theme` du CSS, et le point d'entrée est `@import "tailwindcss"`. Toute recette trouvée en ligne antérieure à la v4 est inapplicable — c'est le même piège que la configuration plate d'ESLint en s02.
4. **Radix, pas Base UI** (ADR 022, écrit ce jour) : Base UI n'a jamais publié de version stable. `packages/ui` est la **seule** frontière avec le socle de composants ; aucun module ne l'importe directement, ce qui garde le basculement futur à coût borné.
5. **Deux briques attendent déjà d'être consommées — et une troisième n'existe pas.** s03 a livré `visibleNavigation(registry, session)` : la navigation se construit depuis les modules activés, filtrée par la protection déclarée. s07 a livré le changement de mot de passe et le changement d'email avec révocation des autres sessions. **s08 les branche, il ne les réécrit pas.** *(Corrigé pendant l'exécution, et vérifié à la source : `git show 662f671^:packages/modules/auth/src/application/ports.ts` — `AuthSessionRepository` ne portait que `countForUser` et `revokeAllForUser`, et `AuthUserRecord` n'avait pas de champ `name`. Contrairement à ce que cette recherche affirmait, s07 n'a livré **ni** la liste des sessions **ni** la révocation individuelle **ni** le changement de nom : s08 a dû ajouter les cas d'usage `listForUser`, `revokeForUser` et `changeName`, dans le module. La phrase d'origine était fausse ; la laisser telle quelle la donnait à lire au prochain agent comme un fait vérifié.)*

## Target story

`s08-app-shell` — complexité 3 annoncée, dépend de s07. Sept critères : tableau de bord avec navigation latérale et menu de compte ; navigation construite depuis les modules activés, sans condition dans le composant ; thème clair/sombre commutable et persistant ; paramètres du compte (nom, email avec revérification) ; changement de mot de passe exigeant le mot de passe courant et révoquant les autres sessions ; liste des sessions actives avec révocation individuelle ; interface utilisable sous 400 px sans débordement horizontal.

## Current state of the code

s01 à s07 livrées : 449 tests, 11 parcours end-to-end. Le module `auth` persiste réellement, le port `Mailer` fonctionne, le registre monte les routes des modules activés, le socle est exécutable. `apps/web` porte les écrans d'authentification, un `layout.tsx` minimal et une `navigation.tsx` qui rend `moduleRegistry.navigation` **sans filtrage** — c'est `visibleNavigation` qu'il faut brancher.

**Dette connue à traiter ici** : `boundariesConfig` et `libraryConfig` visent `packages/**/*.ts` et manqueront les `.tsx`. s08 apporte les premiers composants React d'un module — c'est donc la story où la règle de couches cesse silencieusement de s'appliquer si rien n'est fait. Signalé par l'implémenteur de s07, hors de son périmètre.

**Dette assumée depuis s02** : `jsx-a11y` n'est plus couvert (abandon d'`eslint-config-next`, incompatible avec ESLint 10). Consignée dans `docs/architecture.md` avec renvoi explicite à s08.

## Anchor points

| À créer | Rôle |
|---|---|
| `packages/ui` | Tokens, composants shadcn copiés, primitives, son `AGENTS.md` |
| Feuille CSS racine | `@import "tailwindcss"` + `@theme` portant les tokens du design system |
| `apps/web/app/(app)/…` | Le shell : navigation latérale, menu de compte, contenu |
| Écrans de paramètres | Profil, sécurité, sessions |
| `ThemeToggle`, `Sidebar`, `PageHeader`, `EmptyState` | Composés maison nommés par le design system |

## Verified APIs / functions

Versions relevées au moment de la recherche (le lockfile fera foi, ADR 010) : `tailwindcss` **4.3.3**, `@radix-ui/react-dialog` **1.1.23** (stable), `next-themes` **0.4.6**, `geist` **1.7.2**, `lucide-react` **1.37.0**, `class-variance-authority` **0.7.1**, `tailwind-merge` **3.6.0**. `@base-ui-components/react` est en `1.0.0-rc.0`, **aucune version stable publiée** — d'où l'ADR 022.

À vérifier **dans les paquets installés** : la forme exacte de `@theme` en Tailwind 4.3, l'intégration du plugin PostCSS avec Next 16, et si `next-themes` pose bien la classe sur `<html>` sans provoquer de désynchronisation au premier rendu.

## Traps & constraints

- **Le thème doit être piloté par une classe**, pas par `prefers-color-scheme` seul : le design system l'exige explicitement pour que le commutateur puisse contredire le système, et le choix doit persister.
- **La navigation ne doit contenir aucune condition** : désactiver un module retire son entrée sans modifier le composant. C'est le critère qui prouve l'angle n°1 côté interface.
- **Ne pas réimplémenter les cas d'usage de compte** de s07 : les consommer. Deux chemins de changement de mot de passe rendraient le §2 du socle invérifiable.
- **Sous 400 px sans débordement horizontal** est un critère mesurable, pas une intention — il demande une vérification à cette largeur.
- **Aucun composant ni token hors design system.**
- **Le lint de couches doit couvrir les `.tsx`** avant que le premier composant de module n'existe, sinon la règle meurt en silence.

## Open questions

1. **Où vivent les composants d'un module ?** L'architecture dit `presentation/`. Le shell doit-il les découvrir par le registre, ou les écrans sont-ils des pages d'`apps/web` ? Impacte la modularité de l'interface.
2. **`jsx-a11y` : rétablir ou consigner ?** Le paquet dépendait d'`eslint-config-next`. Vérifier s'il existe une version compatible ESLint 10 ; sinon, l'accessibilité repose sur les primitives Radix et sur des tests, ce qui doit être écrit.
3. **Rendu serveur du thème** : éviter le clignotement au premier rendu sans script bloquant.

## Real complexity

**Verdict : 4**, contre 3 annoncé. Le score de 3 supposait « un tableau de bord et des écrans de compte ». La réalité : créer la fondation d'interface de tout le produit (tokens, socle de composants, thème, typographie), brancher deux mécanismes livrés par d'autres stories, traiter une dette de lint dont l'échéance est cette story, et satisfaire un critère de responsive mesurable. Aucune tâche n'est difficile isolément ; leur conjonction sur la première story d'interface, dont quinze autres hériteront, justifie le 4.
