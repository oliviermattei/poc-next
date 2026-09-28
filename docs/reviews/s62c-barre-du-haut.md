# Review — Story s62c-barre-du-haut

> Fresh-context review. Each issue classified: critical / major / minor.
> Diff reviewed: `git diff dev...feature/s62c-barre-du-haut` (story commit `5b05fda` + merge of `dev` `c4869eb`, HEAD tree checked).

Review status: complete

## Plan compliance
- [x] The code does what the plan specifies, nothing more — tasks 1-10 all present (route `switch` + `next` filtered by an injected `safeReturnPath`; `OrgSwitcher.returnTo`; `switcherOf` use case + `organizations.switcher`, empty and DB-free when the module is off; `ShellOrgSwitcher` with `usePathname`, desktop `hidden md:block` + `MobileNavigation.header`; informative "Organisation courante" card; `NotificationPreferencesCard` extracted; `/app/settings/notifications` page; nav entry `notifications-settings` order 5 `surface: 'settings'`, sidebar entry removed; `setPreference` 303 to the rubric; e2e cases; `docs/architecture.md`). Nothing outside the plan. One placement drift, see F1.
- [x] Run interdicts respected — `eslint.config.ts`, `tests/lint-rules.test.ts`, `packages/modules/auth/**`, `apps/web/lib/legacy-paths.ts`, `tests/fixtures/legacy-screen-paths.json`: empty diff. `grep next organization-routes.ts`: only the `switch` registration (:331) and `nextOf`. No new `packages/ui` component beyond `returnTo`, no new token/colour. Shell never calls `organizations.view()`. `/notifications` centre still served, no console selector. No `if` naming a module in `app-shell.tsx` (presence read from `options.length`).

## Anti-hallucination
- [x] No invented API/function/import — opened: `safeRedirectPath` (`auth/src/domain/redirect.ts:66`, signature `(candidate: string|null|undefined, fallback) => string` = `SafeReturnPath`), `ORGANIZATIONS_KEYS.switcherLabel/switcherNone` (`message-keys.ts:108,119`), `OrgSwitcherProps` exported (`ui/src/index.ts:100`), `listMemberships`/`findActiveOrganizationId` on the repository port, `organizationRoutePath`, `visibleNavigation(registry, session, surface)`, `submittedBody` (form → `Object.fromEntries`, so `next` is a string), `notifications.view(session, page)`. All callers of `configureOrganizations`/`createOrganizationRoutes`/`NotificationsScreen` updated (git grep).
- [x] No plausible-but-wrong value or logic — `new URL(...)` receives the filter's output, never the raw `next` (plan point a'); a refusal returns to the constant with `?error=` (point b); `current` is looked up inside the memberships, like `viewOrganizations`.
- [x] The code matches what it claims to do.

## Rules compliance
- [x] Repo conventions followed (AGENTS.md) — `@repo/module-auth` only imported at the composition point `apps/web/lib/organizations.ts`, per ADR 076.
- [x] No accepted ADR contradicted — ADR 076 (new, this story) implemented as written; ADR 075 (settings zone) extended with a seventh rubric.
- [x] Design system respected — `OrgSwitcher`, `Badge`, `Card`, existing utility tokens (`text-muted-foreground`, `truncate`) only; order Profil · Sécurité · Notifications · Organisation · … matches `design.md`; the card is informative, no second selector. Not rendered by me (see Not verified).

## Tests
- [x] Verification record checked (`ks-gate` not installed; `git diff --quiet bcc617c HEAD -- . ':(exclude)docs'` → exit 1, and `Verification status: incomplete`): **stale and incomplete → re-run here**, on HEAD `c4869eb`:
  - `pnpm test` → exit 0 · 105 files passed, 4 skipped · 3073 passed, 14 skipped (the `tests/agents-md.test.ts` failures are gone after the `dev` merge; database reachable, DB-gated cases ran).
  - `pnpm typecheck` → exit 0 · 37/37 (turbo cache hit, keyed on the current inputs).
  - `pnpm test:minimal-profile` → exit 0 · suite + 6 Playwright cases of the minimal profile passed.
  - `pnpm test:socle` → exit 0 · typing, lint, contrast, migrations, unit tests, build, 126 e2e passed / 28 skipped (socle config: `organizations` off), clean tree, audit.
  - Lint taken from the record (`pnpm lint` exit 0); the merge brought only `AGENTS*`/`tests/agents-md.test.ts`, and socle re-ran lint green.
- [x] Assertions pin the acceptance criteria — criterion 1 (`marketing.test.ts` render present/absent, anonymous = zero queries with both modules force-mounted), 2 (`organizations.test.ts` real filter, `/app/demo` kept, `//evil.test`, `/.//evil.test`, `https://evil.test/app` → constant), 3-4 (`notifications.test.ts` navigation per surface, 303 to the rubric, card gone from the centre; `app-shell.test.ts` seven rubrics), 5 (recipes above).
- [x] Bite proven by neutralization (each restored, `git diff --exit-code` clean, `git status` clean):
  1. `switch` returns `nextOf(body) ?? constant` (filter bypassed) → **1 red** (`organizations.test.ts` « revient à l’écran courant… refuse un chemin hors du site »).
  2. refusal follows `returnPath` instead of the constant → **1 red** (`organization-routes.test.ts` « un refus de `switch` revient sur la rubrique »).
  3. every route reads `next` (`returnTo?.(body) ?? nextOf(body) ?? screen`) → **1 red** (« une autre route du module ignore `next` »).
  4. shell `session === null` guard removed → **1 red** (`marketing.test.ts` anonymous zero-query case).
  5. `surface: 'settings'` removed from the notifications nav entry → **3 red** (`app-shell.test.ts` ×2, `notifications.test.ts` ×1).
  6. `ShellOrgSwitcher` without `returnTo` → **1 red** (`marketing.test.ts` « poste l’écran courant »).
- [x] Tests the story made redundant are named and removed — the old `switch → ORGANIZATIONS_SCREEN_PATH` expectation and `#notification-preferences` anchor assertion were rewritten, not duplicated. ~14 cases new or rewritten, within the budget of 25.

## Regressions
- [x] No impact on existing code paths — every other organizations route keeps its constant (mutation 3); `/notifications` still served with its bell; `setPreference` is the only notifications route whose 303 changed; legacy-path table untouched; socle and minimal-profile e2e green.

## Findings
- F1 minor — `packages/modules/organizations/src/presentation/organization-routes.test.ts` — the plan placed the `switch` success/hostile-path cases in this unit file; they live in `tests/organizations.test.ts` under `describe.runIf(databaseReachable)`. Justified (lint §7 forbids importing the real filter here) and they bite (mutation 1), but on a runner without a database the only proof that `switch` applies the filter is silently skipped.
- F2 minor — `apps/web/app/(app)/app/settings/notifications/page.tsx:43` — `notifications.view(session, 1)` reads the notification list page and counts only to render `view.preferences`: extra queries on every visit to the rubric.
- F3 minor — `tests/marketing.test.ts:1307-1317` — the signed-in shell-cost case mocks `switcher` to an empty view, so the real per-page cost of `switcherOf` (documented as "deux requêtes", `organization-use-cases.ts:219`) is measured nowhere; research fact 3 asked for "sa propre preuve de coût".
- F4 minor — `apps/web/app/app-shell.tsx:158` — below `md` with JavaScript off, the desktop selector is CSS-hidden and the Sheet cannot open: no way to switch organization. The previous card offered the `<noscript>` fallback at every width. Low impact (mobile navigation already needs JS), but the design's "Sans JavaScript : repli `<noscript>`" now holds on desktop only.
- F5 minor — `tests/rendered-text.test.ts:1449` — the new "réglages — notifications" case exempts `organizationId`, copied from the centre; the page passes no such prop, so the exemption only widens the guard.

## Not verified
- **No browser rendered by this review.** The layout of the top bar (desktop 1280 / mobile 375, light / dark), the truncation of a long organization name, the selector inside the mobile Sheet, and the informative card rely on the implementer's record. Gesture: sign in with two organizations, open `/app` at desktop and mobile width, open the menu, switch, check you stay on `/app`; open `/app/settings/organization` and check there is one selector only.
- **`usePathname()` under the locale rewrite, server-side.** The no-JS path posts the SSR value of `next`; the record says `/en/app` came back prefixed with JS on. Gesture: in a non-default locale, JS disabled, switch from `/app` and check the landing URL (a 307 canonicalisation is acceptable per plan).
- **The new e2e cases with `organizations` on** (`e2e/organizations.spec.ts` « change d’organisation depuis le tableau de bord », the rewritten top-bar lookups, `e2e/settings.spec.ts` « la rubrique Notifications bascule une préférence ») — the socle run skipped the organizations spec (module off there); they run with the default configuration at ship (`E2E stage: ship`).
- Production build in the default configuration — ship (`Build stage: ship-if-route`, a route was added); built only in the socle configuration here.

## Verdict
Max severity: minor
Ship allowed: yes
