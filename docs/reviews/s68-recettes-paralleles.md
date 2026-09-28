# Review: s68-recettes-paralleles

Review status: complete

> Fresh-context review (subagent `reviewer`). Diff reviewed: `git diff dev...feature/s68-recettes-paralleles` (story commit ab1ad34, plus a merge of `dev` bringing `AGENTS.local.md`). Worktree clean at the end.

The two defects the story targets are fixed and well tested: the fixed `/tmp` paths shared between concurrent runs, and the tree copy that missed staged changes. **Acceptance criterion 1 is not met as written**: two simultaneous `pnpm test:socle` runs do not both pass. One major finding; it does not block the ship.

Project commands and settings quoted from `AGENTS.local.md`: `Test: pnpm test`, `Typecheck: pnpm typecheck`, `E2E: pnpm test:e2e`, `Build: pnpm build`, `E2E stage: ship`, `Build stage: ship-if-route`, `Test budget: 25`.

## Checklist
**1. Verification record.** No `docs/verif/s68-recettes-paralleles.md`: the reviewer ran the checks (after waiting for another worktree's socle recipe to go idle).
- `pnpm typecheck`: exit 0 (37 tasks, all Turbo cache hits).
- `pnpm test`: exit 0 — 3058 passed, 14 skipped, 44 s.
- Lint, format, dead-code scan: not run (no record); CI runs them.
- E2E and build: not run, per `E2E stage: ship` and `Build stage: ship-if-route` (no route moved).

**2. References** — all exist as used: `cloneWorkingTree`, `workingTreeChanges`, `cloneReport` (`scripts/working-tree.ts`); `recipePort`, `recipePortReport` (`scripts/minimal-profile-rules.ts`); `socleReplayEnvironment`, `FIXED_TMP_PATH` (`scripts/socle-rules.ts`); `playwright.config.ts` reads `E2E_PORT` (l. 23) for `BASE_URL`, and `webServerEnv()` sets `APP_URL: BASE_URL`, so a reserved port reaches both server and app URL; `git diff --name-status --no-renames -z HEAD` gives letter/path pairs unaffected by `color.ui`; `$RUNNER_TEMP` exists on GitHub runners; the recipe workspace (and `runner-temp`) is removed in the `finally` block (`scripts/socle.ts:296`).

**3. Diff against plan.** Tasks 1, 2, 3, 4, 6 present; task 5 unticked with an honest record of three attempts. Only root `AGENTS.md` updated (`scripts/AGENTS.md`, `tooling/AGENTS.md` do not exist). No CI step added or removed; derivation still from `ci.yml`. No ADR conflict. Unmentioned drift: `GOLDEN_PATH_PORT`/`MINIMAL_PROFILE_PORT` removed (m1).

**4. Tests.** 9 new tests (2 `working-tree`, 4 `socle`, 3 `minimal-profile`), within budget; real fixtures (temporary repo with staged `git mv`, staged deletion, staged edit, unstaged edit, untracked and ignored files). Mutations:
- `workingTreeChanges` back to `ls-files --deleted` / `--modified --others` → `tests/working-tree.test.ts` 1 red (missing `dossier/nouveau-nom.ts`, stale `indexe.ts`, leftover `supprime.ts`).
- `/tmp/arbre-attendu.txt` back in `ci.yml` → `tests/socle.test.ts` 1 red.
- `recipePort` hard-coded to 3100 → `tests/minimal-profile.test.ts -t port` 1 red.
- Not unit-covered: `scripts/socle.ts` passing `replayEnv` rather than `cloneEnv`; a regression would fail loudly (write refused at `/arbre-attendu.txt`). Not a finding.

**5. Plausible but wrong.** No logic defect. Checked: staged-added then deleted on disk (absent from the copy); staged edit then deleted on disk (deleted); ignored files never copied. The `/tmp` regex catches an absolute `/tmp/` at the start of a shell argument — enough for the current workflow.

**6. Regressions.** The three recipes share one copy module; port override moves to `E2E_PORT` (m1); nothing else used the removed per-script `cloneRepository`.

## Findings
**M1 (major) — acceptance criterion 1 not met as written.** "deux `pnpm test:socle` lancés en même temps depuis deux copies du dépôt passent tous deux": three concurrent attempts on an 8-core machine all failed, by timeouts on different cases each time (5 s unit timeouts, then 16/119 navigation timeouts per side), with s62b also running in two of three attempts; a single run passes. The per-run folder part is fully met and tested. Verdict: **met in intent, not in fact** — no failure involved a shared file, port or database; the remaining failure is CPU contention, loud, non-corrupting, documented in root `AGENTS.md`. Not critical: nothing ships broken, nothing regresses. Next cycle: limit parallelism for concurrent recipes (workers, or a longer unit timeout under the recipe) and prove two runs pass, or rewrite the criterion to "no shared file, port or database" plus the measured CPU caveat.

**m1 (minor) — port override variables removed without a note.** `GOLDEN_PATH_PORT` and `MINIMAL_PROFILE_PORT` are silently ignored now. `scripts/golden-path.ts:84` keeps `LIVE_CAPTURE_PORT = process.env.E2E_PORT ?? '3110'`, matching `tests/fixtures/stripe-events/README.md:79`, but no server listens on 3110 by default any more.

**m2 (minor) — weak port test.** "Reserves a free port" only rules out 3100; a hard-coded 3110 would pass when free.

**m3 (minor) — helper in the wrong file.** `recipePort`/`recipePortReport` live in `scripts/minimal-profile-rules.ts` but serve all three recipes.

## Not verified
- Two concurrent `pnpm test:socle` passing — never observed; to try on a quiet machine or with lower worker counts.
- The CI job with `$RUNNER_TEMP` on an Ubuntu runner — watch the `tous` and `socle` matrix jobs after the merge.
- `pnpm test:minimal-profile` and `pnpm test:golden-path` end to end with the shared copy and a reserved port — run once at ship.
- Lint and format — CI covers them.
- Live Stripe capture instructions (m1) — need real keys.

Max severity: major
Ship allowed: yes
