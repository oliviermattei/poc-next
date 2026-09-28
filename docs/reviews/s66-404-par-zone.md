# Review: story s66-404-par-zone

> Fresh-context review (subagent `reviewer`). Diff reviewed: `git diff dev...feature/s66-404-par-zone` (one commit, `44ba722`), in worktree `/Users/olivier/www/boilerplate/.worktrees/s66-404-par-zone`.

**Result: ship allowed. There are no critical or major findings, only three minor ones.** The critical point holds, measured rather than read off the code: `(console)/not-found.tsx` does not catch the refusal from the console layout guard.

## Plan compliance
- [x] **The code does what the plan asks, and the extra is justified.**
  - Task 1: `e2e/not-found-zones.spec.ts` counts sidebars and `h1`, checks the 404 status, and checks the banner on a URL with no route.
  - Task 2: four zone `not-found.tsx` files, each rendering `<NotFoundScreen />` with no shell.
  - Task 3: ADR 072, plus the `apps/web/AGENTS.md` paragraph.
  - Task 4: the socle branch was replayed by the reviewer (see Tests).
- **The three declared deviations are acceptable:**
  1. **Console witness in `e2e/admin.spec.ts`.** Only that serial series signs up `E2E_SUPERADMIN_EMAIL`. Signing it up again from a parallel file would collide on the same address.
  2. **`tests/rendered-text.test.ts` changed.** This was forced. The guard at l.2069 checks equality against `pageFilesUnder(SCREEN_ROOT)` with `SCREEN_FILENAMES` including `not-found.tsx`, so four new boundaries left unrendered would have failed it.
  3. **`apps/web/AGENTS.md`.** Required by the rule "docs ship with the code that changes them".
  - Neither extra file is listed in the plan's "Files touched" section. That is drift, but it is justified.
- [x] **Run interdicts, each checked in the diff:**
  - `apps/web/app/not-found.tsx` and `not-found-screen.tsx` are unchanged.
  - No zone layout changed, and `(console)/layout.tsx` and its guard are unchanged.
  - No page changed.
  - No existing assertion was changed or removed: the `admin.spec.ts` diff is +15/-0.
  - No `loading.tsx` was added.
  - ADR 071 was not rewritten.

## Anti-hallucination
- [x] **Every reference exists; each one was opened:**
  - `NotFoundScreen` is a named async export in `apps/web/app/not-found-screen.tsx`.
  - `organizations.available` is at `apps/web/lib/organizations.ts:59`, and `e2e/organizations.spec.ts` already imports it.
  - `publicPath` is at `e2e/support/locale.ts:20`.
  - `ADMIN_USERS_SCREEN_PATH` is imported from `@repo/module-admin`.
  - `isValidElement` and `ReactNode` are imported at `tests/rendered-text.test.ts:6`.
  - `[data-slot="sidebar"]` is on the `Sidebar` that `ConsoleShell` also uses.
- [x] **The witnesses are real:**
  - `(site)/blog/[slug]/page.tsx:85` calls `notFound()` when no article matches.
  - `(auth)/invitations/accept/page.tsx:64` and `(app)/organizations/page.tsx:60` call `notFound()` on `!organizations.available`, before any session redirect.
  - The claim that all five `(app)` pages raise only when a module or feature is absent is verified by grep: `organizations`, `premium` (gate), `notifications`, `billing`, `onboarding`.
- [x] **The code matches its comments,** apart from the stale comments in untouched files (m1).

## Rules compliance
- [x] **Repo conventions:** one commit, imperative, in French; plan has `validated: yes` and its tasks are ticked; the ADR is in MADR format and supersedes only the last consequence of ADR 071.
- [x] **No accepted ADR is contradicted.** ADR 072 replaces the 404 consequence of ADR 071 explicitly, which is the immutable-supersede path.
- [x] **Design system:** no new component; `NotFoundScreen` is reused. There is no design doc for this story.
- [x] **Security (§3):** the console refusal is still a 404 that shows no sign the console exists. Measured below.

## Tests
- [x] **Suite run by the reviewer, all green:**

  | Command | Result |
  |---|---|
  | `pnpm typecheck` | exit 0 (from turbo cache) |
  | `pnpm lint` | exit 0 |
  | `pnpm test` | 3005 passed, 14 skipped |
  | `E2E_PORT=3162 pnpm test:e2e` (all modules on) | 130 passed, 11 skipped; the `(auth)` and `(app)` cases skip, as declared |
  | `E2E_PORT=3162 pnpm test:socle` (copy of the repo, modules marketing, organizations and i18n cut) | exit 0; 114 passed, 27 skipped |

  In the socle run, the `(auth)` and `(app)` cases ran and passed. So did `admin.spec.ts:546`, the impersonation banner on `/organizations`, which was the original CI red. The replay notes three excluded steps, each with its reason (install, module toggles, browser provisioning).
- [x] **Assertions pin the criteria.** Each case waits for the "Page introuvable" heading before counting (a positive signal first), and counts after `networkidle` without retrying.
- [x] **Proof that the tests bite, by neutralization.** Every mutation was restored; after each one `git status --short` was empty and `git diff --exit-code` was clean.

  | # | Mutation | Tests run | Result |
  |---|---|---|---|
  | M1 | Removed `(site)/not-found.tsx` (reproduces the defect) | `not-found-zones` + `security-headers` | 1 red: the `(site)` case, Expected 1, Received 2 sidebars; 8 green |
  | M2 | `(console)/not-found.tsx` wraps `NotFoundScreen` in `ConsoleShell` | superadmin case `admin.spec.ts:119` | Red at l.209: 2 sidebars. Positive control: this boundary really serves the superadmin's page-level 404 |
  | M2 | Same mutation | anonymous / ordinary account case `admin.spec.ts:270` | Stayed green. Its assertion `getByText('Console',{exact:true}).toHaveCount(0)` would catch the `ConsoleShell` badge if the boundary caught the layout's refusal |
  | M2 | Same mutation | impersonation case `:546` | Stayed green |
  | M3 | Direct measurement (below) | temporary probe spec, deleted afterwards | No marker in any refused response |
  | M4 | Hard-coded text added in `(auth)/not-found.tsx` | `tests/rendered-text.test.ts` | 1 red, through the shape check in `zoneBoundary`, not through text detection |

  **M3, the critical point, measured directly:** a `MUTANT-S66-CONSOLE-NF` marker in `(console)/not-found.tsx` plus a temporary spec (deleted afterwards); an anonymous visitor and a signed-in ordinary account on `/console`, `/console/users` and `/console/users/inconnu-probe`. On all 6 combinations: status 404, `marker=false`, `sidebars=1` (the root `AppShell`), console badge count 0. The guard's refusal goes to the root boundary, including on the dynamic page that also raises its own `notFound()` in parallel. The impersonated session was not probed for the shell; it goes through the same `notFound()` in the layout, and `:546` checks its 404 status with no redirect.
- [x] **Tests made redundant:** none. The s60 case in `admin.spec.ts` stays as the guard witness.

**Is the `(auth)`/`(app)` coverage adequate?** Yes, with one reservation: the CI matrix plays both `tous` and `socle`, and both witnesses were seen to bite in socle; the four boundaries are identical, and the mechanism is proven by M1 and M2. Reservation: a local `pnpm test:e2e` never exercises those two zones, and they were not mutated under socle.

## Regressions
- [x] **No impact on existing paths:** a URL with no route still gets the root `AppShell` and the consent banner (`security-headers.spec.ts:274` is green, and so is the new case); the console guard is unchanged; `tests/zones.test.ts` derives only `page.tsx` files.

## Findings
- **m1, minor.** Stale comments in files the plan's interdicts froze:
  - `apps/web/app/not-found.tsx` still says it is rendered "au-dessus des layouts de zone" and that "un `notFound()` levé dans la console ne rend aucun élément du shell de la console". Since ADR 072, that is false for a page-level 404 served to the superadmin.
  - `apps/web/app/not-found-screen.tsx` still says "L'écran servi sur une URL qui ne mène à aucune route" and "`not-found.tsx` l'entoure du shell".
  - Suggested follow-up: update these comments in the next story that touches these files.
- **m2, minor.** `tests/rendered-text.test.ts`: `zoneBoundary` accepts only a single function element. Hard-coded text in a boundary does turn it red (M4), but the error names the element shape, not the text; a legitimate wrapper (fragment or `div`) would fail with the same shape message.
- **m3, minor.** Under `tous`, the `(auth)` and `(app)` witnesses exist only as skips. Their coverage depends on the socle branch of CI or a local `pnpm test:socle`. The skip reason and ADR 072 say so; not a defect.

## Not verified
- **Production build:** the e2e suites run `next dev`, including in `test:socle`. No 404 was rendered under `next build && next start`. Human check: `/fr/blog/nexiste-pas` (1 sidebar, 1 `h1`), `/fr/nexiste-pas` (shell and consent banner), `/fr/console/users/xyz` as superadmin (console shell only), `/fr/console` as anonymous (no "Console" badge).
- **Mutations under socle:** M1 and M2 ran under `tous` only; the `(auth)` and `(app)` boundaries were not mutated under socle. Their bite is inferred from identical files and the same mechanism.
- **Impersonated session:** checked for status only (existing `:546`), not probed in the DOM.
- **Actual CI:** criterion 5 (CI green on both matrix branches after merge) cannot be checked before the merge.
- **Visual rendering:** no screenshots or mobile widths; rendering is checked only by counting sidebars and headings.

## Verdict
Max severity: minor
Ship allowed: yes
