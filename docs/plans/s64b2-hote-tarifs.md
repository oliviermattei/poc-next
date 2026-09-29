---
validated: yes
---
# Plan — Story s64b2-hote-tarifs

Branch: `feature/s64b2-hote-tarifs`
Research: `docs/research/s64b2-hote-tarifs.md` (+ parente `docs/research/s64b-hote-routage.md`). Design: `docs/designs/s64b2-hote-tarifs/design.md` (dérivé).
ADR: `docs/decisions/080-une-redirection-de-route-est-relative.md` (amendement du 29/09 après blocage d'Execute, #69).

## Target story
Avec `APP_HOST`, choisir une offre depuis le site aboutit au checkout, connecté ou non ; le retour d'un paiement invité revient sur le site avec sa requête ; `pnpm test:golden-path` joué à deux hôtes (`site.localhost` / `app.site.localhost`) est vert et mesure au navigateur les redirections traversées ; sans `APP_HOST`, rien ne change.

## Decisions (ne pas re-décider)
| Sujet | Décision |
|---|---|
| Chemin « connecté » depuis le site | Lien texte sous le tableau de `/pricing`, rendu **seulement** si `siteUrl` et `appUrl` diffèrent (lu via `resolveAuthConfig`, jamais `APP_HOST` en direct) : vers `BILLING_SCREEN_PATH` (+ `?offer=<id>` si une offre est reposée). Relatif : le proxy de s64b1 l'envoie à l'application. Nouvelle clé de message dans le catalogue du module billing (fr/en). |
| Écran de facturation | `?offer=` validé par `selectedOfferOf` (réutilisé, déplacé dans un endroit partagé si besoin) → `focusOnReady` sur le `BillingAction` de l'offre ; anonyme → `next` = `BILLING_SCREEN_PATH?offer=<id validé>`. |
| Repli limité | `guestFallbackUrl` : `next` = `BILLING_SCREEN_PATH?offer=<id>` (au lieu de `/pricing?offer=`) **dans les deux configurations** — un compte connecté sur l'application n'a rien à faire sur `/pricing`. |
| Retour invité | Le module billing reçoit `siteUrl` (option facultative, défaut `appUrl`) ; `guestReturnUrl` = `${siteUrl}/pricing${query}`. `lib/billing.ts` le passe depuis `resolveAuthConfig`. Sans `APP_HOST`, identique. |
| Mode deux hôtes du parcours doré | Variable de recette `GOLDEN_PATH_HOSTS=split` (défaut : absente = un hôte). `playwright.config.ts` exporte `siteBaseUrl()`/`webServerEnv()` qui, en mode split, rendent `APP_URL=http://site.localhost:PORT`, `APP_HOST=app.site.localhost`, et `baseURL` = le site ; la suite e2e normale n'est pas touchée. `scripts/golden-path.ts` journalise le mode. Refus nommé pour une valeur inconnue. |
| Mesure des redirections au navigateur | Dans `golden-path.spec.ts`, en mode split seulement : l'inscription (Hors zone) atterrit sur l'hôte de l'application ; le retour invité atterrit sur l'hôte du site avec `?checkout=success` ; un pas « connecté » : depuis `/pricing` du site, le lien « Déjà client ? » mène (connexion comprise) à l'écran de facturation de l'application, puis au checkout. Assertions d'hôte par une expression dédiée (pas `urlOf`). |
| Redirections des routes (#69, ADR 080) | `Location` **relatif** dans `organization-routes.ts:167`, `onboarding-routes.ts:87`, `notification-routes.ts:101`, `admin-routes.ts:148,150`, `apps/web/app/api/billing-local-checkout/route.ts:141,150` (`new Response(null, { status: 303, headers: { location } })`). `auth-routes.ts:403` : le filtre du `next` 2FA compare à l'origine **configurée** (`appUrl` du service) au lieu de `request.url`. Test de balayage : aucun `new URL(…, request.url)` ne construit un `Location` dans `packages/modules/*/src/presentation` ni `apps/web/app/api`. Les tests qui attendaient un `Location` absolu sont réalignés sur le chemin. |
| Documentation | Ligne `pnpm test:golden-path` du tableau des commandes d'`AGENTS.local.md` : mentionner `GOLDEN_PATH_HOSTS=split`. |

## Tasks (ordered)
1. [x] `siteUrl` dans le module billing + `guestReturnUrl` ; `guestFallbackUrl`. Tests : `tests/billing.test.ts` — avec `APP_HOST`, retour invité sur l'origine du site ; repli limité vers l'écran de facturation (un cas chacun).
2. [x] Écran de facturation : `?offer=` → `focusOnReady` ; `next` conservé. Test : `tests/billing.test.ts` ou le test de rendu existant de l'écran — offre valide focalisée, inconnue ignorée ; anonyme → `next` avec l'offre.
3. [x] `/pricing` : lien « Déjà client ? » conditionné. Test de rendu : absent sans `APP_HOST`, présent avec (href = écran de facturation, `?offer=` propagé). Clés fr/en.
4. [x] Mode split : `playwright.config.ts`, `playwright.golden-path.config.ts`, `scripts/golden-path.ts` (+ refus d'une valeur inconnue, testé dans le test existant de la recette si elle en a un, sinon `tests/golden-path.test.ts`).
5. [x] `golden-path.spec.ts` : pas conditionnés au mode split (hôtes attendus, parcours « connecté » par le lien).
6. [x] Docs : `AGENTS.local.md` (ligne de la commande), `docs/deployment.md` si le retour des tarifs y est décrit.
6b. [x] **Redirections relatives (#69, ADR 080)** — ligne du tableau des décisions ; tests : balayage + un cas par module touché (réalignement des attentes existantes ; 2FA : `next` interne conservé quand `request.url` porte `0.0.0.0`).
7. [x] Vérification : `pnpm typecheck`, `pnpm lint`, `pnpm test` (une fois), `GOLDEN_PATH_PAYMENTS=simulated pnpm test:golden-path` **et** `GOLDEN_PATH_PAYMENTS=simulated GOLDEN_PATH_HOSTS=split pnpm test:golden-path` ; contrôle navigateur du lien (desktop/mobile) ; `docs/verif/s64b2-hote-tarifs.md`.

## Run interdicts
- `apps/web/proxy.ts`, `apps/web/lib/zones.ts`, `security-headers.ts` : diff vide (routage = s64b1).
- Aucune redirection inter-hôtes ajoutée dans les routes ; aucune origine lue dans un en-tête.
- Aucun cookie modifié (s64c) ; aucune lecture d'`APP_HOST` hors de `@repo/config` / `resolveAuthConfig`.
- La suite `pnpm test:e2e` normale et son `BASE_URL` ne changent pas.
- Aucun nouveau composant ni jeton (design dérivé).
- `?offer=` jamais interpolé sans validation contre le catalogue.

## The point everything turns on
Le parcours connecté entre hôtes : le lien du site → 308 vers l'application → connexion avec `next` → écran de facturation avec l'offre → checkout. Où il peut casser : (a) `next` perdu à la redirection anonyme de l'écran de facturation ; (b) `safeRedirectPath` qui rejette `?offer=` encodé ; (c) le mode split qui fuit dans la suite e2e normale (`process.env` fusionné par Playwright, research parente) ; (d) `siteUrl` absent → retour invité sur l'application (deux sauts, toléré mais le test l'exige en un).

## Files touched
`packages/modules/billing/src/{application/billing-use-cases.ts,infrastructure/*runtime*.ts}`, `apps/web/lib/billing.ts`, `apps/web/app/(site)/pricing/page.tsx`, `apps/web/app/(app)/app/settings/billing/page.tsx`, catalogue de messages billing (fr/en), `playwright.config.ts`, `playwright.golden-path.config.ts`, `scripts/golden-path.ts`, `e2e/golden-path/golden-path.spec.ts`, tests, `AGENTS.local.md`.

## Test strategy
Budget 25 ; visé ~7 cas unitaires + pas de parcours doré. **Neutralisations** : `guestReturnUrl` sur `appUrl` → le cas retour invité rougit ; lien rendu sans condition → le cas « absent sans `APP_HOST` » rougit ; `next` sans offre → le cas anonyme rougit ; mode split ignoré → le pas d'hôte du parcours doré rougit. E2E et build au ship (pages modifiées → build joué).

## Definition of Done
Critères de s64b2 cochés ; commandes ci-dessus vertes et consignées (les deux régimes du parcours doré) ; un commit, PR vers `dev`, revue sans critique.
