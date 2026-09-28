# Review — Story s63-application-sous-app

> Fresh-context review. Each issue classified: critical / major / minor.
> Diff reviewed: `git diff dev...feature/s63-application-sous-app` (one commit, `29a92be`).

Review status: complete

## Plan compliance
- [x] The code does what the plan specifies, nothing more — tasks 1-7 all present: table `{ target, module }` + guard on `moduleIds` (`apps/web/lib/legacy-paths.ts`), three `git mv` + relative imports, three constants, three rows, `ROOTS` extended, `APPLICATION_SEGMENTS` comments, two derived cases in `tests/zones.test.ts`, e2e `'/premium'` literals → `DEMO_PREMIUM_SCREEN_PATH`, docs + ADR 077. `apps/web/proxy.ts` untouched (signature change absorbed: `moduleRegistry` carries `moduleIds`, `packages/core/src/registry.ts:68,169`). `e2e/settings.spec.ts:65` adapted to the new row shape — required by the change, not drift.
- [x] Run interdicts respected — `apps/web/app/(console)/**`, `apps/web/app/api/**`, `tests/fixtures/legacy-screen-paths.json`, `apps/web/next.config.ts`: empty diff. No navigation entry added. Module API `PATHS` unchanged. `'/app/notifications' | '/app/onboarding' | '/app/premium'` appear only in the three constants and in comments/docs.

## Anti-hallucination
- [x] No invented API/function/import — `ModuleRegistry.moduleIds` (`packages/core/src/registry.ts:68`), `DEMO_PREMIUM_SCREEN_PATH` / `NOTIFICATIONS_SCREEN_PATH` / `ONBOARDING_SCREEN_PATH` exported from each package root, `navigationSurfaceOf`, `MODULE_ROUTE_PREFIX`, `buildRegistry`, `availableModules` / `requiredModules`, `appLocales`: all opened and verified. Module ids `auth`, `organizations`, `billing`, `notifications`, `onboarding`, `demo-enabled` are real. Importing module roots into `legacy-paths.ts` adds no weight to the proxy: it already imports `moduleRegistry`.
- [ ] No plausible-but-wrong value or logic — **`/premium` names the wrong owner** (M1).
- [x] The code otherwise matches what it claims.

## Rules compliance
- [x] Repo conventions followed (AGENTS.md) — one commit, story docs travel with it.
- [x] No accepted ADR contradicted — ADR 077 amends ADR 075 explicitly. But its premise is wrong for one row (M1).
- [x] Design system — n/a: no visual change, no `/ks-design`.

## Tests
- [x] Verification record checked — `ks-gate` absent; `git diff --quiet 9174ffe HEAD -- . ':(exclude)docs'` → exit 0 (`9174ffe` is a tree object), working tree clean, `Verification status: complete`, every exit code 0. **Current, taken as proof**: `pnpm lint`, `pnpm test` (3073 passed), `pnpm typecheck`, `pnpm test:minimal-profile`, `GOLDEN_PATH_PAYMENTS=simulated pnpm test:golden-path` were not re-run. Its "Not proven here" section was read: e2e + build at ship, `pnpm test:socle` not run.
- [x] Assertions pin the acceptance criteria — criteria 1 and 4 (zones), 3 (legacy-paths, existing cases iterate over the new rows).
- [ ] Bite proven by neutralization:
  - guard → `return row.target` (always redirect): **1 red** (`tests/legacy-paths.test.ts`, socle case); restored, `git diff --exit-code` clean.
  - `/notifications` row → `module: 'auth'` (a wrong but existing id): **0 red** (12/12 green); restored, clean. See M2.
  - `(app)/app/premium/` moved back to `(app)/premium/`: **1 red** (`tests/zones.test.ts`, disk case); restored, clean.
  - `DEMO_PREMIUM_SCREEN_PATH = '/premium'`: **1 red** (`tests/zones.test.ts`, registry case); restored, clean.
- [x] Tests made redundant — none. The old navigation-based socle assertion was rewritten, not duplicated. 3 new cases, well inside the budget of 25.

## Regressions
- [x] Other consumers of `LEGACY_SCREEN_PATHS` / `legacyScreenTarget` (`apps/web/proxy.ts:108`, `tests/organizations.test.ts:2541` on keys only, `e2e/settings.spec.ts:64-72`) are compatible. There is no layout under `(app)/app/` apart from `settings/`, so the moved pages add no redirect loop and no settings sub-navigation.
- [ ] One configuration regression: M1.

## Findings
- **major — `apps/web/lib/legacy-paths.ts` (row `'/premium'`), ADR 077 — the table names `demo-enabled` as the module that serves `/app/premium`, but no module serves that screen.** `apps/web/app/(app)/app/premium/page.tsx` renders whenever `featureGates()` declares `DEMO_PREMIUM_FEATURE`. `config/gating.ts:45` declares it statically, whatever the module state, and `assertGatesCoverRoutes` (`packages/core/src/entitlement.ts:191`) accepts a gate that no route uses. Scenario: `demo-enabled` is cut (the socle and minimal profile cut it; `requiredModules = ['auth','rate-limit']`) and `gating.ts` is left as is. Then `/app/premium` is still served, while `/premium` now answers **404**. On `dev` that old path served the screen. This breaks criterion 3 ("chaque ancien chemin répond 308") in that configuration, and it is the exact failure ADR 075 exists to prevent. ADR 077's Consequences cover the reverse case (module on, gate off) but not this one. The research had `/premium` covered by the "garde actuelle suffisante", and the plan (point (a)) wrote the same premise into its expected set. Fix next cycle: base the premium row on the same fact the page uses (the declared gate), or make the page 404 when `demo-enabled` is cut. Either way, amend the ADR.
- **major — `tests/legacy-paths.test.ts:158-173` — the socle case replays the guard's clause instead of pinning its expected result** (testing-doctrine shape 6). For each dropped row it asserts `socle.moduleIds` does not contain `row.module`, which is the guard restated. The plan asked for the expected set: `/organizations`, `/billing`, `/notifications`, `/onboarding`, `/premium` dropped, `/account` redirected. Proof: I set `/notifications` to `module: 'auth'`. With the notifications module cut, `/notifications` would then 308 to a 404, and 12/12 tests stay green. The directory test catches typos only, not a wrong existing id. This is the story's central invariant (plan point (b)), and a wrong but existing id has no net.
- **minor — root `AGENTS.md`** still carries the pre-s63 layout sentence until `install.sh` is rerun. The verification record says so; nothing to fix in the diff.

## Not verified
- **E2E suite (`pnpm test:e2e`) and the production build**: not run, as planned — both run at ship. The build matters here because three routes moved. The edited `e2e/billing.spec.ts` and `e2e/settings.spec.ts` have never run.
- **Browser behaviour**: taken from the implementer's record (308s for `/onboarding`, `/fr/premium`, `/notifications`, `/premium?x=1`; bell link; onboarding landing). This review rendered no screen and started no server.
- **Minimal profile / socle HTTP behaviour of old paths**: not run. A human should run `ks toggle demo-enabled` off (keep `config/gating.ts`), `pnpm dev`, then open `/premium` (expect 404 today, see M1) and `/app/premium` (served). Also: with `notifications` cut, open `/notifications` and confirm a plain 404, with no 308.
- `pnpm test:socle`: not run by anyone.

## Verdict
Max severity: major
Ship allowed: yes
