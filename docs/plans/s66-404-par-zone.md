---
validated: yes
---
# Plan — Story s66-404-par-zone

Branch: `feature/s66-404-par-zone`
Research: `docs/research/s66-404-par-zone.md` — read it first; this plan does not repeat it.

## Target story
Depuis s60, un `notFound()` levé par une **page** rend l'écran 404 dans le layout de sa zone **et** dans l'`AppShell` de `app/not-found.tsx` : shell doublé (mesuré : 2 barres latérales sur `/fr/blog/nexiste-pas`, CI `socle` rouge sur `e2e/admin.spec.ts:591`).

Critères (docs/stories.md, s66) :
1. 404 levée par une page de `(site)`, `(auth)`, `(app)`, `(console)` → un seul shell, celui de la zone.
2. URL sans route → 404 avec `AppShell` et bannière (`e2e/security-headers.spec.ts` vert).
3. Refus de la garde du layout de console → 404 sans élément du shell de console.
4. Un test navigateur compte les shells.
5. CI verte sur `tous` et `socle`.
6. Un nouvel ADR corrige la règle de l'ADR 071.

**Décisions de planification** (questions ouvertes de la research) :
- Q1 — un `not-found.tsx` **aussi** dans `(console)` : un superadmin sur un identifiant inconnu voit la 404 dans le shell de la console, jamais deux shells.
- Q2 — le compteur vit dans un fichier dédié, `e2e/not-found-zones.spec.ts` : `security-headers.spec.ts` garde son sujet (en-têtes, nonce).

## Tasks (ordered)
1. [x] **Test rouge d'abord** — `e2e/not-found-zones.spec.ts` : sur une 404 levée par une page de chaque zone que la configuration `tous` permet d'atteindre (au minimum `(site)` via `/blog/<slug inconnu>` ; pour `(auth)`, `(app)` et `(console)`, la page la plus simple qui lève — l'implémenteur la choisit dans la liste du fait 4 de la research et **écrit** dans le test pourquoi une zone n'aurait pas de témoin atteignable), `[data-slot="sidebar"]` compte **exactement 1** et un seul `h1` ; sur `/nexiste-pas`, 1 barre latérale et la bannière de consentement ; statut 404 partout. Le test rougit sur `dev` pour `(site)`.
2. [x] **Frontières de zone** — ajouter `apps/web/app/(site)/not-found.tsx`, `(auth)/not-found.tsx`, `(app)/not-found.tsx`, `(console)/not-found.tsx`, chacun rendant `<NotFoundScreen />` **sans** shell. `apps/web/app/not-found.tsx` inchangé. **Tests** : tâche 1 verte ; `e2e/admin.spec.ts` complet vert, dont « 404 sans badge » (critère 3, garde du layout) et le bandeau d'emprunt (l. 591).
3. [x] **ADR 072** — « Une 404 levée par une page est rendue dans le layout de sa zone » : supersède la **conséquence** de l'ADR 071 sur la frontière 404 (le reste de 071 tient), écrit la règle mesurée (layout → frontière du parent ; page → frontière du segment, sous son layout), et les options rejetées (retirer l'`AppShell` de la 404 racine : l'URL sans route perdrait shell et bannière ; aiguiller par en-tête). `apps/web/AGENTS.md` : la phrase sur `not-found` suit. **Vérification** : `tests/agents-md.test.ts`.
4. [x] **Configuration `socle` en local** — `pnpm test:socle` (rejoue la branche `socle` de la CI dans une copie) vert, ou, s'il est trop long pour le poste, au minimum `e2e/admin.spec.ts` sous le profil de modules de `socle`. Le rapport dit lequel a été joué.

## Run interdicts
- `apps/web/app/not-found.tsx` et `not-found-screen.tsx` ne changent pas.
- Aucun layout de zone ne change ; `(console)/layout.tsx` et sa garde ne changent pas.
- Aucune page ne change : la correction est portée par les seules frontières.
- Aucune assertion existante n'est modifiée ou retirée.
- Aucun `loading.tsx`.
- L'ADR 071 n'est pas réécrit (immutabilité) : l'ADR 072 le corrige.

## The point everything turns on
**La frontière `(console)/not-found.tsx` ne doit pas capter le refus de la garde du layout.** La règle mesurée dit qu'un `notFound()` levé par un layout remonte à la frontière du parent. Si elle était fausse, un anonyme verrait la 404 **dans le shell de la console** — une divulgation. À comparer : le cas e2e « 404 sans badge » de `e2e/admin.spec.ts` doit rester vert **après** l'ajout de la frontière ; s'il rougit, retirer `(console)/not-found.tsx` et le dire (le superadmin verrait alors deux shells sur un identifiant inconnu, défaut mineur à reporter).
Second point : que la 404 de chaque zone ait bien un témoin. La configuration `tous` n'a pas de module coupé, donc les 404 de `(app)` passent par un identifiant ou un état, pas par un module absent ; ne pas conclure « vert » d'une zone sans témoin.

## Files touched
- `apps/web/app/(site)/not-found.tsx`, `(auth)/not-found.tsx`, `(app)/not-found.tsx`, `(console)/not-found.tsx` (nouveaux)
- `e2e/not-found-zones.spec.ts` (nouveau)
- `docs/decisions/072-…md` (nouveau), `apps/web/AGENTS.md`
- ce plan

## Test strategy
- **Navigateur** (Playwright) : compte de shells et statut, par zone et sur une URL sans route (tâche 1) — seule couche qui voit la régression, le HTML brut ne la montre pas (research, fait 1).
- **Non-régression** : `e2e/admin.spec.ts` (garde du layout, bandeau d'emprunt), `e2e/security-headers.spec.ts` (URL sans route), `pnpm test`, `pnpm typecheck`, `pnpm lint`.
- **Configuration de la CI** : `pnpm test:socle` (tâche 4).
- **Mutation attendue en revue** : faire rendre l'`AppShell` à un `not-found.tsx` de zone → le compteur rougit ; supprimer `(site)/not-found.tsx` → il rougit.

## Definition of Done
- Une PR, un commit de story portant le plan et l'ADR 072.
- Les six critères tenus ; `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` verts, et la branche `socle` rejouée.
- CI verte sur les deux branches de matrice après merge.
- Revue passée (`/ks-review`).
