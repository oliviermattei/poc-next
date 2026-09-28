# Verification — Story s63-application-sous-app

> Written by the implementer as its last action before the story commit. Commands quoted
> verbatim from `AGENTS.local.md` (`Test: pnpm test`, `Typecheck: pnpm typecheck`) and from
> the plan's task 7 (`pnpm lint`, `pnpm test:minimal-profile`,
> `GOLDEN_PATH_PAYMENTS=simulated pnpm test:golden-path`). Both recipes clone the working
> tree compared to `HEAD`; everything was staged (`git add -A`) before they ran.

Tree: 9174ffe1605815e37736a8f029b248cafdaacc07

| Run | Command | Result | When |
| --- | --- | --- | --- |
| Lint | `pnpm lint` | exit 0 · 0 warning | 2026-09-28T22:22:49Z |
| Test (full suite) | `pnpm test` | exit 0 · 3073 passed · 14 skipped — 109 files, 105 passed, 4 skipped | 2026-09-28T22:23:44Z |
| Typecheck | `pnpm typecheck` | exit 0 · 37/37 turbo tasks | 2026-09-28T22:23:59Z |
| Minimal profile | `pnpm test:minimal-profile` | exit 0 · 12 modules cut (incl. `notifications`, `onboarding`) · suite in the clone 3067 passed · 23 skipped · 6/6 Playwright cases passed | 2026-09-28T22:26:02Z |
| Golden path | `GOLDEN_PATH_PAYMENTS=simulated pnpm test:golden-path` | exit 0 · 4/4 passed · onboarding course traversed (module enabled) · 1 min 10 s clone → first payment | 2026-09-28T22:27:41Z |
| E2E | — | not run — runs at ship (`E2E stage: ship`) | — |
| Build | — | not run — runs at ship (`Build stage: ship-if-route`; three routes moved) | — |

Focused suites during the tasks (not a substitute for the rows above):
`tests/legacy-paths.test.ts`, `tests/organizations.test.ts`, `tests/zones.test.ts`,
`tests/notifications.test.ts`, `tests/onboarding.test.ts`, `tests/billing.test.ts`,
`tests/rendered-text.test.ts`, `tests/auth.test.ts`; `pnpm --filter @repo/web typecheck`
after the move (exit 0).

Browser check (`next dev` on this worktree, port 3000 = `APP_URL`, Chromium via a
Playwright script, a fresh local account `s63-…@example.test` created by sign-up and the
captured verification email):
- HTTP, no session: `/onboarding` → 308 `/fr/app/onboarding`; `/fr/premium` → 308
  `/fr/app/premium`; `/notifications` → 308 `/fr/app/notifications`; `/premium?x=1` → 308
  `/fr/app/premium?x=1`.
- Signed in: sign-in lands on `/fr/app/onboarding` (h1 « Bienvenue », AppShell rendered);
  the bell's link is `/fr/app/notifications`, clicking it opens the centre (h1
  « Notifications »); `/fr/premium` lands on `/fr/app/premium` (h1 « Rapport détaillé »);
  `/onboarding` lands on `/fr/app/onboarding`. Nothing visually broken on the three screens.

## Not proven here
- The end-to-end suite (`pnpm test:e2e`, including the edited `e2e/billing.spec.ts` and
  `e2e/settings.spec.ts`) and the production build: run once at ship. The edited
  `e2e/golden-path/golden-path.spec.ts` did run, in the golden-path row above.
- The plan's neutralizations (guard always returning the target, `premium/` put back under
  `(app)/`, a `'/premium'` literal in `apps/web`): not run here, per the testing doctrine —
  they belong to the review.
- `pnpm test:socle` was not run (not in the plan's task 7).
- The root `AGENTS.md` still carries the pre-s63 wording of the layout convention: it is
  rebuilt from `AGENTS.local.md` by `install.sh`, which the implementer does not run.

Verification status: complete
