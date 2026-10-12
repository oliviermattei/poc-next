# ADR 072 — Une 404 levée par une page est rendue dans le layout de sa zone

- Status: accepted
- Date: 2026-09-27
- Scope: story s66-404-par-zone

Supersède **la dernière conséquence** de l'ADR 071 (la frontière 404), et elle seule : la partition en quatre dossiers de zone, les layouts et le reste de ses conséquences tiennent. L'ADR 071 n'est pas réécrit.

## Context
L'ADR 071 posait que la page 404 est rendue par la frontière racine, **au-dessus** des layouts de zone, et en tirait que `app/not-found.tsx` devait rendre l'`AppShell` lui-même. C'est vrai pour une partie des 404 seulement. Mesuré sous Chromium sur `2f11ae9` : `/fr/nexiste-pas` (aucune route) rend **une** barre latérale, `/fr/blog/nexiste-pas` (un `notFound()` levé par `(site)/blog/[slug]/page.tsx`) en rend **deux**. Le HTML brut n'en porte qu'une : la 404 d'une page part dans le flux RSC, seul un navigateur la voit. La branche `socle` de la CI a rougi dessus (`e2e/admin.spec.ts`, bandeau d'emprunt sur `/organizations`, module coupé).

## Decision
La règle mesurée, qui remplace celle de l'ADR 071 :

- un `notFound()` levé par un **layout** est rendu par la frontière `not-found.tsx` du **segment parent** — celle du segment est placée sous son propre layout, qu'elle ne peut donc pas capter ;
- un `notFound()` levé par une **page** est rendu par la frontière la plus proche, **sous** les layouts de ses segments ;
- une URL qui ne mène à aucune route n'a que le layout racine.

D'où deux sortes de frontières :

- `app/not-found.tsx`, inchangé, rend l'`AppShell` : il ne sert plus que l'URL sans route et le refus d'un layout de zone, où aucun layout de zone ne l'entoure ;
- `app/(site|auth|app|console)/not-found.tsx` rendent `NotFoundScreen` **sans shell** : le layout de la zone l'entoure déjà.

La frontière de `(console)` ne capte pas le refus de la garde de `(console)/layout.tsx` : un non-superadmin reçoit toujours la 404 racine, sans rien du shell de la console. Seul le superadmin, sur un identifiant inconnu, voit une 404 dans le shell de la console — il sait déjà que la console existe.

## Considered options
- **Retirer l'`AppShell` de `app/not-found.tsx`** — rejetée : l'URL sans route perdrait navigation, sélecteur de langue et bannière de consentement, ce qui est le défaut que l'ADR 071 corrigeait.
- **Aiguiller le shell par un en-tête posé par `proxy.ts`** (la 404 racine lirait la zone et rendrait ou non le shell) — rejetée pour la raison déjà donnée à l'ADR 071 : un aiguillage par chemin écrit à la main là où Next fournit le mécanisme — ici, une frontière par segment.
- **Aucune frontière dans `(console)`** — rejetée : le superadmin sur un identifiant inconnu verrait deux shells, celui de la console et l'`AppShell`.

## Consequences
- Une 404 = un shell, dans chaque zone. `e2e/not-found-zones.spec.ts` compte les barres latérales **après** l'affichage de l'écran 404, sur une URL sans route et sur une page de chaque zone dont le témoin est atteignable dans la configuration jouée ; le témoin de `(console)` vit dans `e2e/admin.spec.ts`, la seule série qui inscrit le superadmin. Faire rendre l'`AppShell` à une frontière de zone, ou la retirer, fait rougir le compte.
- Avec tous les modules activés, `(auth)` et `(app)` n'ont pas de page qui lève `notFound()` sur une URL atteignable : leurs cas sautent en le disant, et mordent dans la configuration `socle`.
- `tests/rendered-text.test.ts` dérive les `not-found.tsx` du disque : les quatre frontières y sont rendues, chacune par son propre export.
- Aucun layout ne change ; la garde de la console et son refus sans shell (`e2e/admin.spec.ts`) restent tels quels.
