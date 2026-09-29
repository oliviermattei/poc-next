# Review — Story <id>

> Fresh-context review. Each issue classified: critical / major / minor.
> Diff reviewed: `git diff <default-branch>...feature/<id>`

Reviewed commit: <git rev-parse HEAD in the worktree>
Review mode: <full | closure — previous round: <sha>>
Review status: <complete | blocked>

If blocked, do not leave this implicit:

## Review failure
### Failure cause
<concrete command, tool, prerequisite, or state that prevented completion, including the error>

### Missing
<exact evidence, file, setting, or access that was unavailable>

### Required adaptation
<precise change or input the project agent must provide before rerunning>

### Next action
<exact command or human gesture>

## Plan compliance
- [ ] The code does what the plan specifies, nothing more
- [ ] Run interdicts respected — each one checked and named

## Anti-hallucination
- [ ] No invented API/function/import (each one opened and verified)
- [ ] No plausible-but-wrong value or logic
- [ ] The code matches what it claims to do

## Rules compliance
- [ ] Repo conventions followed (AGENTS.md)
- [ ] No accepted ADR contradicted (docs/decisions/)
- [ ] Design system respected — components/tokens from docs/design-system.md, screen matches the intent of docs/designs/<id>/design.md (UI stories)

## Tests
- [ ] Verification record checked (`node .killer-saas/bin/ks.mjs verif-current <id>`): <current, taken as proof | stale/missing → suite and type check re-run here>
- [ ] Assertions pin the acceptance criteria (no assertion-free tests)
- [ ] Bite proven by neutralization: <what was neutralized> → <N> tests red, restored (`git diff --exit-code` clean)
- [ ] Tests the story made redundant are named and removed — or their absence justified

## Regressions
- [ ] No impact on existing code paths

## Findings
<one line per issue: severity — file:line — what's wrong. A critical adds its failure scenario:
 input or state → wrong outcome.>

## Previous round
<closure review only: each critical of the previous report — closed / still open — and how it
 was re-verified (neutralization replayed, N red); then every major still open, carried over
 verbatim with its file:line. Empty on a full review.>

## Not verified
<what this review could NOT check, and why: no browser, no database, no real third-party call.
 Name the concrete gestures a human should make — the screen to open, the button to click, the
 device to test on. A review that lists nothing here is claiming it saw everything.>

## Evidence
<what makes each finding reproducible: the command, the measured output. Read on demand, never
 trimmed.>

## Verdict
Max severity: <critical | major | minor | none>
Ship allowed: <yes | no>
