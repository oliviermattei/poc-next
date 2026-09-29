# Review — Story s64b2-hote-tarifs

> Fresh-context review. Each issue classified: critical / major / minor.
> Diff reviewed: `git diff dev...feature/s64b2-hote-tarifs` (one commit, `73aa980`).

Review status: complete

## Plan compliance
- [x] The code does what the plan specifies. Tasks 1–7 and 6b are all in the diff. The plan names every file touched; nothing extra.
- [x] Run interdicts respected, each one checked:
  - `apps/web/proxy.ts`, `apps/web/lib/zones.ts`, `security-headers.ts`: absent from the diff.
  - No cross-host redirect added in a route. Every new `Location` is relative.
  - No origin is read from a header.
  - No cookie is touched.
  - `APP_HOST` is read only through `resolveAuthConfig(getEnv())`. The playwright config sets it as server env for the harness only.
  - `pnpm test:e2e` is unchanged: `webServerEnv()` with no argument returns the old env, and `tests/golden-path.test.ts` pins that.
  - No new component or token.
  - `?offer=` always goes through `selectedOfferOf` (`packages/modules/billing/src/domain/pricing.ts:114`), which returns the catalogue's id, never the input, and it is encoded.
- Amendment #69 / ADR 080, judged against the story and `docs/security.md` §4:
  - **Justified.** In split mode, native forms on the app host got a 303 to the listening host, which CSP `form-action` blocked. So criterion 2 ("golden path green with `APP_HOST`") could not pass without it. ADR 080 is consistent with ADR 078/079.
  - Every relative `Location` in the diff starts with a module constant or a filtered path:
    - onboarding and notifications: constants
    - admin: `'/'`, and `ADMIN_USERS_SCREEN_PATH/<userId>` where the userId is parsed by zod and belongs to a session or account that was actually revoked
    - organizations: `screen` constant plus `URLSearchParams`-encoded `error`/`token`; the `switch` `next` goes through `safeRedirectPath` (`packages/modules/auth/src/domain/redirect.ts:66`), which rejects `//`, schemes, backslashes, control characters and dot-segment escapes
    - local checkout: constants plus the `success|cancelled` enum
  - A path-absolute reference cannot change authority when the browser resolves it (RFC 3986 §5.2), so none of these can be protocol-relative.
- The 2FA filter (`auth-routes.ts:405`) now compares against `new URL(auth.appUrl).origin`. That is at least as strict as before, and `//evil` still resolves off-origin and falls back to `/app`.
- The new `AuthService.appUrl` field (`auth-service.ts:189`) is filled only by `better-auth-service.ts:1066` from `ConfigureAuthOptions.appUrl`, which comes from configuration. There are no other implementations or casts.

## Anti-hallucination
- [x] No invented API. I opened each of these and it exists with the signature used:
  - `selectedOfferOf`, `BILLING_SCREEN_PATH`, `billingCatalogue`, `resolveAuthConfig`, `getEnv`, `cn`
  - `safeRedirectPath`, `LOCAL_CHECKOUT_PATH` → `createLocalPayments({ appUrl })`
  - `signInRedirectedFrom` / `urlOf(path, search)` / `settingsPath`
  - the `action.purchase` label « Acheter »
- [x] No plausible-but-wrong value in production code. One wrong claim in a test comment (finding 2).
- [x] The code does what it claims.

## Rules compliance
- [x] Repo conventions followed. i18n keys are in the billing catalogue (fr/en). Env is read through `@repo/config`.
- [x] No accepted ADR contradicted. ADR 045 (`focusOnReady`) is reused; ADR 079 is extended by ADR 080.
- [x] Design system respected. The link class copies the auth screens' link (`sign-up/page.tsx:74`), with `text-muted-foreground` / `text-sm` as in `design.md`. No new component. The `<a>` (not `Link`) is correct for a navigation that crosses hosts through the proxy.

## Tests
- [x] Verification record checked. `ks-gate` is not installed, so I checked by hand: `git diff --quiet 7b549ff… HEAD -- . ':(exclude)docs'` exits 0, and HEAD's tree differs from the recorded tree only under `docs/`. `Verification status: complete`, all exit codes 0.
  - Taken as proof: `pnpm test` (3118 passed), `pnpm typecheck`, `pnpm lint`, and both golden-path regimes, all recorded as `simulated`. I did not re-run the suite or the type check.
- [x] Assertions pin the criteria: guest return on the site origin, pricing link absent/present with the offer carried, focus, anonymous `next`, 2FA on the listening host, split-mode env and refusal, the route sweep.
- [x] Bite proven by neutralization. Each mutation was restored with `git checkout -- <file>` then `git diff --exit-code` (clean):
  - `guestReturnUrl` on `appUrl` instead of `siteUrl` → **1 red** (`tests/billing.test.ts`)
  - pricing link rendered unconditionally (`siteUrl === appUrl && false`) → **3 red**
  - billing screen `next` without the offer → **1 red**
  - `focusOnReady={false}` → **1 red** (the second red in that run was finding 1's flake, not the mutation)
  - 2FA filter compared to `http://0.0.0.0:3000` → **1 red** (`tests/auth.test.ts`)
  - organizations `relativeLocation` made absolute on the listening host → **3 red** (`organization-routes.test.ts`)
- [x] Volume: about 10 new cases plus split-only golden-path steps, within the budget of 25. The realigned `Location` assertions replace the old ones rather than adding to them.
- [x] Redundant tests: none. The old absolute-`Location` expectations were rewritten, not duplicated.

## Regressions
- [x] Without `APP_HOST`, visible behaviour changes in two places, both decided in the plan:
  - the rate-limited guest fallback now sends `next` to the billing screen instead of `/pricing?offer=` (decision table, "dans les deux configurations");
  - route `Location` headers are relative (ADR 080).
  Browsers and Node `fetch` both resolve relative `Location`s.
- The pricing page now needs `AUTH_SECRET`/`APP_URL` (through `resolveAuthConfig`). Both test files that render it stub those. I re-ran them with `AUTH_SECRET= APP_URL= APP_HOST=` (the CI shape): green, apart from finding 1.

## Findings
1. **major** — `tests/billing.test.ts:2123-2155` ("fait revenir un paiement invité sur la page de tarifs du site…"): the test is **not hermetic**.
   - It goes through `appBilling.prepare`, which uses the real shared DB-backed rate limiter, and calls `guestCheckout` with no `client`. That hits the persisted guest bucket: `GUEST_CHECKOUT_RATE_LIMIT` = 5 per client per 600 s (`packages/modules/billing/src/domain/checkout-throttle.ts:68`).
   - From the sixth run of the file within ten minutes it gets **429 instead of 200**. I reproduced this 3/3 times on the clean tree.
   - CI's fresh database hides it. Locally, `pnpm test` twice in a row goes red.
   - Fix: pass a unique `client` per run, as the guest tests at `:5697`/`:5850` do.
2. **minor** — `e2e/golden-path/golden-path.spec.ts` (guest-return step, `if (SPLIT)`): the comment says the guest return comes back to the site "en un saut", and plan point (d) says the test requires one hop. That is false in the `simulated` regime, the only one run:
   - `apps/web/app/api/billing-local-checkout/route.ts:152` returns a relative `/pricing?checkout=success` on the app host;
   - the s64b1 308 then moves it to the site.
   The step only checks the final origin, so it does not exercise `siteUrl`. Only the unit test (finding 1's test) does.
3. **minor** — `scripts/golden-path.ts:119`: the hosts mode is checked and logged before cloning only when the regime is not `live`. Under `live`, a mistyped `GOLDEN_PATH_HOSTS` is refused only later, by `playwright.golden-path.config.ts`.
4. **minor** — `apps/web/app/(site)/pricing/page.tsx:74`: `LINK_CLASSNAME` is the fifth copy of the auth-screen text-link class string (sign-in, sign-up, two-factor, reset-password). Not design drift, just duplication.

## Not verified
- **Golden path, both host modes** (`GOLDEN_PATH_PAYMENTS=simulated [GOLDEN_PATH_HOSTS=split] pnpm test:golden-path`): not re-run here. That is out of the review stage, and I took the record's exit 0 as given. So I have not seen the split-mode steps fail when split handling is removed (the plan's fourth neutralization).
  - Human gesture: run the split command once, then run it with `GOLDEN_PATH_HOSTS=split` but `APP_HOST` forced empty in `hostsEnv`, and watch `expectOnOrigin` go red.
- **Rendering and focus in the browser**: not seen. I have only the implementer's word (1280/390 px screenshots, taken before task 6b).
  - Human gesture: with `APP_URL=http://site.localhost:3000 APP_HOST=app.site.localhost`, open `/fr/pricing?offer=lifetime`, click « Choisissez votre offre depuis votre espace », sign in, and check that « Acheter » has focus on `app.site.localhost/fr/app/settings/billing?offer=lifetime`. Also check keyboard focus and the dark theme.
- **Real Stripe guest return**: `success_url` on the site origin is proven only against a mocked Stripe request body. No real hosted checkout, and the `recorded` regime has no capture.
- **Production behind a reverse proxy** (listening on `0.0.0.0:3000`, relative `Location` from native forms under CSP `form-action 'self'`): inferred from ADR 080, not measured.
  - Human gesture: part of s64c's manual acceptance test. Submit an organization form and a notification preference on the app host.
- `pnpm test:sans-env`, `pnpm test:e2e`, `pnpm build`: not run. E2E and build run at ship (`E2E stage: ship`, `Build stage: ship-if-route`, and pages changed). For sans-env I only checked the two affected files.

## Verdict
Max severity: major
Ship allowed: yes
