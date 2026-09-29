# Research — Story s64b2-hote-tarifs

> Vérifiée contre la branche par défaut au commit `fdb7ba1` (s64b1 mergée), en lecture seule. Prolonge `docs/research/s64b-hote-routage.md` (faits 3 et 4) ; ne les répète pas.

## The five structuring facts
1. **Avec `APP_HOST`, `/pricing` ne voit jamais la session** (cookie propre à l'hôte de l'application) : `(site)/pricing/page.tsx:79,147` choisit alors toujours `guestCheckout`. Un compte existant n'a aucun chemin depuis le site vers le checkout connecté — c'est le trou du critère 1.
2. **L'écran de facturation de l'application sait déjà ouvrir un checkout par offre** : `(app)/app/settings/billing/page.tsx:79-94` rend un `BillingAction` (`checkout`) par offre ; anonyme, il redirige vers `/sign-in?next=BILLING_SCREEN_PATH` (:56-58) — **sans** conserver une offre. `BillingAction` porte déjà `focusOnReady` (utilisé par `/pricing`, ADR 045) : rendre l'offre choisie « reprise » n'exige aucun composant neuf.
3. **Retour invité** : `guestReturnUrl = ${appUrl}/pricing${query}` (`billing-use-cases.ts:767`) — avec `APP_HOST`, il atterrit sur l'application puis s64b1 le renvoie au site (deux sauts, requête conservée). Le module billing ne reçoit que `appUrl` (`lib/billing.ts:228,285,382`).
4. **Repli du checkout invité limité** : `guestFallbackUrl` (`lib/billing.ts:331-349`) rend `/sign-in?next=/pricing?offer=<id>` — après connexion (sur l'application), `/pricing` repart vers le site qui ne voit pas la session : boucle fonctionnelle vers le chemin invité.
5. **Parcours doré** : `playwright.golden-path.config.ts:3,81-94` et `playwright.config.ts:27,93-100` figent `BASE_URL=http://localhost:PORT` et `APP_URL: BASE_URL`. La recette `scripts/golden-path.ts:113-195` propage `process.env` au clone. Le parcours à deux hôtes exige un site **hors de l'origine d'écoute** (relativisation des `Location`, parente fait 3) : `APP_URL=http://site.localhost:PORT`, `APP_HOST=app.site.localhost`. Les pas de `golden-path.spec.ts` naviguent en chemins relatifs (base = site) : chaque écran d'application ou Hors zone passe par le 308 de s64b1 ; `urlOf` (`e2e/support/locale.ts:38-39`) n'est pas ancré et accepte les deux hôtes.

## Anchor points
- `(site)/pricing/page.tsx` : lien « Déjà client ? » quand le site et l'application ont des origines distinctes.
- `(app)/app/settings/billing/page.tsx` : `?offer=` validé contre le catalogue → `focusOnReady` ; conservé dans le `next` de la redirection anonyme.
- `lib/billing.ts` : `guestFallbackUrl` vise l'écran de facturation ; `siteUrl` passé au module pour `guestReturnUrl`.
- `playwright.config.ts` / `playwright.golden-path.config.ts` / `scripts/golden-path.ts` : mode deux hôtes.

## Traps & constraints
- Critère « sans `APP_HOST`, inchangé » : le lien n'apparaît pas, `guestReturnUrl` reste `${APP_URL}/pricing`, le parcours doré par défaut ne change pas.
- `?offer=` est une valeur reçue : validée contre le catalogue (`selectedOfferOf` existe pour `/pricing`), jamais interpolée.
- `safeRedirectPath` filtre le `next` : `/app/settings/billing?offer=x` est un chemin de même origine, accepté.
- `tests/i18n.test.ts` balaie les textes en dur : le libellé du lien passe par le catalogue du module billing (fr/en).
- CI : la recette dorée n'est pas jouée en CI tant qu'aucune capture n'existe ; le mode deux hôtes est une recette locale, documentée.

## Open questions
- Aucune bloquante : la place du chemin « connecté » (lien du site vers l'écran de facturation de l'application) est décidée au plan.

## Real complexity
Cotée **3**, confirmée **3**.
