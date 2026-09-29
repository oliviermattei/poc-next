---
description: Review the story breakdown against the PRD perimeter, in a fresh-context subagent. Cheapest place to catch a bad split. Reviews the delta since the last review, and stops once the breakdown is ready.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Agent
  - Write
  - Bash
---
# ks-stories-review — Delegated review of the story breakdown

## Execution contract (non-negotiable)
You MUST complete this command by delegating to the `stories-reviewer` subagent (fresh context). You are FORBIDDEN from:
- Judging the stories yourself: you are probably the context that wrote them, hence blind to your own gaps.
- Modifying `docs/stories.md`. Your only write right is the report `docs/reviews/stories.md`, nothing else.
- Softening a verdict to move the pipeline along.
- **Starting another round for a ready breakdown's own findings.** `Stories ready: yes` ends the review: its majors and minors are fixed in one pass, and that pass is not re-reviewed. A later change to `docs/stories.md` — an amendment, a new story, a split — is reviewed as a delta.

If you can't invoke the Agent tool, stop and report the error. Don't improvise.

## Why a delta
Measured on this project: four full rounds in one day on the same six stories, 11, 12, 14 and
10 findings, **every one of them already `Stories ready: yes`**. A full re-read of a long file
by a non-deterministic reviewer always finds something new; that is not convergence, it is
sampling. A round therefore reads what changed since the last one, plus what that change can
break.

## Workflow

### Step 1 — Prerequisites (fail-closed)
`docs/prd.md` and `docs/stories.md` must both exist. Missing PRD → STOP: "No PRD — run /ks-prd first." Missing stories → STOP: "No stories — run /ks-stories first."

### Step 2 — Scope
Read `Reviewed at:` in the existing `docs/reviews/stories.md`.
- **No report, no `Reviewed at:`, or `docs/prd.md` changed since that commit** → `full`: the whole breakdown.
- **Otherwise** → `delta`. `git diff <Reviewed at>..HEAD -- docs/stories.md` gives the changed stories. The scope is those stories, **plus the stories that depend on them and the stories they depend on** (their `Dependencies` sections, both directions) — a change breaks its neighbours, not the whole file. Nothing changed → STOP: "Nothing to review since <sha>."
- The last report says `Stories ready: no` and the only changes since are fixes of its criticals → `closure`: the scope is those findings only, each one closed or not. No new hunt.
- The last report says `Stories ready: yes` and the only changes since are fixes of its own majors and minors → STOP: "Nothing to review: those fixes need no round."

### Step 3 — Delegate
Invoke the Agent tool:
- subagent_type: stories-reviewer
- description: Review the story breakdown (<mode>)
- prompt: Review docs/stories.md against docs/prd.md, mode `<full|delta|closure>`. Scope: <all stories | the listed ids | the listed finding ids>. The previous report is docs/reviews/stories.md: every finding still open there keeps its id and its status (open / closed / obsolete) in your report; new findings continue its numbering. The coverage table is always checked in full — it is cheap and it is the one defect that stays invisible until ship. Outside the scope, report a defect only if it is critical. Fill the checklist from templates/stories-review-checklist.md, classify each issue (critical / major / minor), and end with the exact lines "Max severity: <critical|major|minor|none>" and "Stories ready: <yes|no>".

Wait for the verdict.

### Step 4 — Report
Write the full report to `docs/reviews/stories.md`, with `Reviewed at: <git rev-parse HEAD>` and `Mode: <full|delta|closure>` under its title. It MUST end with the exact lines `Max severity: ...` and `Stories ready: yes` or `Stories ready: no`. A single critical = no. Commit it on the default branch (docs: stories review).

### Step 5 — Outcome
- `Stories ready: no` → "Stories review blocked (critical). Fix the criticals in docs/stories.md, then rerun /ks-stories-review — it will check those fixes and what they touch, not the whole file."
- `Stories ready: yes` → "Stories review passed. Fix the majors and minors in one pass if you want — **no new round is needed for them**. Next step: /ks-architect (or the next story)."

Note: this is a soft gate. It does not block the pipeline mechanically — it is surfaced by /ks-status and warned about by /ks-research. Fixing a bad split here costs a markdown edit; fixing it after five shipped stories costs cycles.
