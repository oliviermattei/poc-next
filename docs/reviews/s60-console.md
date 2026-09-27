# Review: story s60-console

> Fresh-context review (subagent `reviewer`). Each issue is classified critical, major or minor.
> Diff reviewed: `git diff dev...feature/s60-console`, one commit, in the worktree `/Users/olivier/www/boilerplate/.worktrees/s60-console` on branch `feature/s60-console`.
> Every mutation was restored. `git diff --exit-code` passes and `git status` is empty.

**Verdict: ship allowed.** No critical or major issue was found, only three minor ones. Every command run by the reviewer is green, and each mutation on the story's security guards turned at least one test red.

## Commands run by the reviewer
- `pnpm typecheck` passed: 37/37 tasks, 0 from cache.
- `pnpm lint` passed with no warnings.
- `pnpm test` passed: 3005 tests, 14 skipped.
- `E2E_PORT=3160 pnpm test:e2e` passed: 128 tests, 9 skipped. All 9 skipped tests are variants where a module is turned off. All 5 cases in `e2e/admin.spec.ts` passed.
- `pnpm test:minimal-profile` passed. This profile turns off `admin`, `billing` and `organizations`, among others. Its sweep checked that 12 addresses of turned-off navigation entries answer 404, including the `console` surface entries. A positive control ran alongside it.
- `pnpm test:contrast` passed: 44 color pairs, all above their threshold.

## Plan compliance
- [x] **Tasks 1 to 10 are all present in the diff.**
  - Task 1: a `@ts-expect-error` check in `packages/core/src/protection.test.ts`.
  - Task 2: the screen path constants now point under `/console`, with a dashboard entry at `order: 0`.
  - Task 3: 43 files were renamed. Their changes are only import depth, plus removal of the redirect and of the `navigation` prop.
  - Task 4: `urlSegment` updated and a new `tests/zones.test.ts`.
  - Task 5: the console layout guard.
  - Task 6: `console-shell.tsx`.
  - Task 7: `lib/console.ts` and the dashboard page.
  - Task 8: labels in both French and English.
  - Task 9: tests for no link to the console, and the module-off case.
  - Task 10: documentation in the root `AGENTS.md`, `apps/web/AGENTS.md`, the admin module's `AGENTS.md`, and `architecture.md`.
- [x] **Every "run interdict" in the plan holds.** Each one was checked:
  - URLs are unchanged apart from `/admin` → `/console`. `zones.test.ts` checks the page list, and the e2e suite is green.
  - The API routes still live under `/api/modules/admin/...`.
  - The only redirect left is the `/admin` string in e2e, which is the test asserting it is gone.
  - There is no `loading.tsx` anywhere: `find` returns nothing.
  - `asSuperadmin` and the read guards were not touched.
  - The `(site)`, `(auth)` and `(app)` layouts render `<AppShell nonce>` exactly as before.
  - There is no diff in `packages/ui` and no new color or token. A grep for raw colors found nothing.
  - No import uses the `@/` alias: the count is 0.
  - `robots.ts` and `sitemap.ts` are unchanged.
  - There are still 6 route files under `apps/web/app/api`, as on `dev` (the dispatcher plus 5 others).
  - No migration.

### The implementer's declared deviations
1. **Admin moved in task 2, before the console route group in task 5.** Acceptable: this was only intermediate ordering and the final diff is correct.
2. **New `CONSOLE_SCREEN_PATH` export.** Justified. The dashboard entry needs a root path, and the export avoids writing `/console` in two places. It is exported from the barrel at `packages/modules/admin/src/index.ts`.
3. **New `admin.isSuperadmin` used by the layout.** Justified, and the reason was verified. The use case at `admin-use-cases.ts:451` first calls `designateFirstSuperadmin()`, while `platformRolesOf` does not. Since Next renders the layout and the page in parallel, relying on `session.roles` would answer 404 to the configured superadmin on the very first console request. This is correct.
4. **Content of `not-found.tsx` split into `not-found-screen.tsx`.** Justified: it lets `rendered-text.test.ts` render the content. Removing the `AppShell` from `not-found.tsx` turns `e2e/security-headers.spec.ts:274` red.
5. **Assertions changed in task 3 beyond import paths.** Acceptable.
   - The i18n anchor and the rendered-text declarations are path changes only.
   - The removed env-wiring case asserted that `(marketing)` throws, which is now the opposite of the intended behavior.
   - Its `@panneau` assertion moved to `zones.test.ts`, and that is covered.
6. **E2E checks folded into existing tests because of the sign-up rate limit.** Acceptable. The impersonated-session 404 check is in the impersonation banner test, before the banner assertions.
7. **Dashboard answers 404 when any read returns `not_found`.** Correct. The list reads only return `NOT_FOUND` when authorization fails (`admin-use-cases.ts:585`, `:655`, `:679`, `:692`). An `unavailable` read only marks its own tile as failed.
8. **`consoleNavigation`, generic tile link text, exact-match current item.** Acceptable, but it causes minor regression m1.
9. **`AGENTS.md` files and tests that read the disk were adjusted.** Justified: these are path updates. The other suites that read `apps/web/app` from disk were also checked:
   - `changelog.test.ts` and `billing.test.ts` walk the tree recursively, so they need no change.
   - `organizations.test.ts` now reads inside route groups instead of treating `(site)` as a URL segment.

## Anti-hallucination
- [x] **No invented reference.** Each target was opened and checked:
  - `visibleNavigation` and `RegistryNavigationEntry` in `@repo/core`.
  - `currentViewer().impersonatedBy` at `lib/auth.ts:315` and `:341`.
  - `localeOptions` at `lib/navigation.ts:67`.
  - `DesktopNavigation` and `MobileNavigation` with their props, in `app-navigation.tsx`.
  - `SidebarItem` exported from `packages/ui/src/index.ts:119`.
  - `SidebarNav` compares `item.href === currentPath` (`packages/ui/src/composed/sidebar.tsx:34`).
  - The `isSuperadmin` use case.
  - `AdminRevenueView.revenue.recurring` and `recurringUnvalued`.
  - `ConsentBanner` and `ConsentScripts`.
  - The `Badge`, `Card`, `Alert`, `EmptyState` and `PageHeader` components.
- [x] **Revenue is shown as one line per currency, never summed.** A test covers it.
- [x] **Tiles are derived from the visible `console` entries**, matched on the path constants. No module id is written in `lib/console.ts`.
- [x] **Layout guard order is right:** module off first, then session, then impersonation, then role.
- [x] **Rendering above the layout is measured, not assumed.** The ADR says a 404 from the console renders above the console layout. The e2e test checks it with a positive signal first (the h1 heading is visible) and then asserts the "Console" badge is absent.

## Rules compliance
- [x] **AGENTS.md conventions are followed.** Imports stay relative, forms are unchanged, the documentation ships in the same commit, and no count is claimed without a command behind it.
- [x] **No accepted ADR is contradicted.** ADR 066 and 067 are not rewritten: ADR 070 only renames the surface value. ADR 068's "404, not 403" is extended to anonymous visitors. ADRs 070 and 071 use the MADR format with status accepted.
- [x] **The design system is respected.** Every component used is in it (Sidebar, Badge, Card, Button ghost, Alert destructive, EmptyState, PageHeader). There are no new tokens or colors. `tabular-nums` and the tile layout built inline are declared as gaps 2 and 3 in the design doc. The screen matches the design intent: the badge is the only visual difference, the sidebar shows only console entries, and there is no bell and no organization switcher.

## Tests
- [x] The reviewer ran the suite and it is green (see above).
- [x] The assertions pin the acceptance criteria. No decorative tests were found.
- [x] **Every mutation turned tests red**, except the one reported as m2. Each was restored and `git diff --exit-code` was clean afterwards.

| Mutation, and where it was posted | Tests red |
|---|---|
| `(console)/layout.tsx`: removed the `impersonatedBy !== null` clause | 1 (`console.test.ts`) |
| `(console)/layout.tsx`: removed the `isSuperadmin` clause | 1 |
| `(console)/layout.tsx`: turned off the whole identity guard | 3 |
| `(console)/layout.tsx`: `admin.available` check replaced by `false` | 1 |
| E2E: `users/page.tsx` redirects anonymous visitors to `/sign-in`, and the layout identity guard is off | 1 e2e test red (`admin.spec.ts:255`, "Expected 404, Received 307") |
| `not-found.tsx` without `AppShell` | 0 unit tests, 1 e2e test (`security-headers.spec.ts:274`) |
| `lib/console.ts`: the `not_found` refusal ignored | 1 |
| `warm-up.ts`: route groups throw again | 4 |
| `billing-routes.ts`: revenue entry set to `surface: 'app'` | 6, including the test that no link to the console is published |
| `'admin'` added back to `NavigationSurface` | `tsc` on core fails with TS2578 at `protection.test.ts:144` |
| `lib/admin.ts`: `isSuperadmin` wired to always return true | **0**. This is finding m2 |

- [x] One redundant test was removed: the env-wiring case, justified above.

## Regressions
- [x] **No break found on the touched code paths.**
  - The 404 page keeps its shell and consent banner, which the e2e test checks.
  - The Playwright warm-up still covers every page, checked in `zones.test.ts`.
  - The minimal profile is green.
- **One small UI regression**, finding m1 below.

## Security baseline (docs/security.md §3)
- **Anonymous visitors, ordinary accounts and impersonated sessions all get 404 with no `Location` header**, on `/console` and `/console/users`. Measured in e2e with `maxRedirects: 0`.
- **`/admin/users` returns 404 with no redirect.**
- **Every page's anonymous redirect was replaced by `notFound()`.** Checked in the rename diff for all 6 pages.
- **No link to `/console` exists** in the `app` or `footer` surfaces (anonymous or signed-in), the sitemap or `robots.ts`. The source grep finds none, and the unit test mutated in the table above turns red.
- **Account menu link.** The account menu creates a console → application link, which is the direction the plan explicitly allows.

## Findings
1. **m1 (minor): the sidebar loses its active item on detail pages.**
   - Where: `apps/web/lib/back-office.ts` together with `packages/ui/src/composed/sidebar.tsx:34`.
   - What: on `/console/users/<id>` and `/console/organizations/<id>`, no sidebar entry has `aria-current` any more. The old `backOfficeNavigation` matched by prefix.
   - Why it matters: the design doc (§1) asks for the current-item rule "comme `backOfficeNavigation` le fait aujourd'hui".
2. **m2 (minor, a test gap with no exposure today): the layout guard's real wiring is not tested.**
   - Where: `apps/web/lib/admin.ts:608`.
   - What: wiring `admin.isSuperadmin` to always return true leaves the suite 3005/3005 green. `tests/console.test.ts` tests the layout against a double of `admin.isSuperadmin`, so the composition point is not covered.
   - Why no exposure: every current page still guards itself through its own read.
   - Why it matters later: the plan and `packages/modules/admin/AGENTS.md` present the layout guard as a second line of defense. The first screen added under `(console)` without its own read would rely only on this untested wiring.
3. **m3 (minor): small differences from the design doc.**
   - Where: `apps/web/app/(console)/console/page.tsx`.
   - What: the tile link reads « Ouvrir « {label} » » instead of « Voir les comptes ». The per-tile icons listed in the design (Users, Building2, Banknote, Mail) are not rendered. The revenue tile's footer sits higher than the others because it has no number.
   - Assessment: these are accepted deviations, with no effect on meaning.

A non-blocking note: `'admin'` is no longer a reserved organization identifier (`apps/web/lib/organizations.ts`). It is now harmless, but reserving it would keep an organization from calling itself "admin". Also, an organization that already has the identifier `console` in an existing database would not be rejected retroactively.

## Not verified
- **Production build rendering.** The e2e suite and the implementer's screenshots run under `next dev`. A human should run `pnpm build && pnpm start`, sign in as superadmin and:
  - open `/console` in light and dark mode, on desktop and at 380 px: check the badge, the four tiles and that nothing overflows horizontally;
  - open `/console/users/<id>` and check the breadcrumb root « Console » and the active sidebar item (see m1);
  - open `/console` in a private window and compare the 404 with the one on `/nexiste-pas`: same HTML, no `Location` header.
- **English locale.** The console has only been seen in French. Check `/en/console` once to read the English labels and check the tile link text.
- **The four tiles against real Stripe revenue.** Only the empty « Aucun revenu récurrent » state was seen. The multi-currency display with real data and the « dont N sans prix au catalogue » line are only covered by unit tests on `lib/console.ts`.
- **Response timing.** Nothing compares how fast a console 404 answers versus an unknown URL. The layout adds a database read for signed-in non-superadmins (`isSuperadmin` and the first-superadmin designation). This is the same kind of leak as before s60, which the pages already had, and it was not measured.
- **The e2e rate limit.** It was not re-measured over three runs in the same hour. The suite ran three times in total (one full run and two mutation runs), and the warm-up step clears the table each time.

## Verdict
Max severity: minor
Ship allowed: yes
