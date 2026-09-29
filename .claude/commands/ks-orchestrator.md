---
description: Chain a story's full cycle — Research → Design → Plan → Execute → Review → Ship — with two blocking human checkpoints (plan validation, ship confirmation)
argument-hint: <story id or name>
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write
  - AskUserQuestion
  - Agent
  - Bash
---
# ks-orchestrator — One story, full cycle, checkpoints kept

Target story: $ARGUMENTS

**One story.** Several stories at once go through `/ks-batch` — never several orchestrators
side by side: they would edit the same files, read each other's stale research, share ports
and take the same ADR numbers, and nothing here would see it.

You conduct the cycle; you never do a phase's work inline when a subagent owns it, and you never write code yourself. The two human checkpoints are non-negotiable: plan validation and ship confirmation. A checkpoint is an actual AskUserQuestion call — never a rhetorical sentence in your output. This is a conductor, not an autopilot.

## Phase 0 — Prerequisites (fail-closed)
The orchestrator drives one story's cycle — it never replaces the framing. Check, in order:
0. AGENTS.local.md exists? Missing → STOP: "This project has no settings. Run /ks-setup." Read `Story track`, `Flow threshold`, `Plan validation`, `Design source`, `Merge mode`, `Ship confirmation`, the stages and the project commands from it: every checkpoint below is governed by them.
1. docs/prd.md exists? Missing → STOP: "No PRD — the pipeline starts with /ks-prd <target>. Nothing to orchestrate yet."
2. docs/stories.md exists? Missing → STOP: "No stories — run /ks-stories first."
3. docs/architecture.md exists? Missing → STOP: "No architecture — run /ks-architect first."
4. docs/reviews/stories.md says `Stories ready: yes`? If missing or negative, warn (don't stop): the breakdown hasn't passed /ks-stories-review.
(docs/design-system.md is not required here: the planner's design step fail-closes on it only when the story has UI.)

Then resolve $ARGUMENTS to the story id (`s<number>-<slug>`) against docs/stories.md. No unambiguous match → list the available stories and stop. Never invent a framing doc or a story to keep going.

**Then pick the track.** `Story track: full` → continue here. `flow` → hand over to `/ks-flow <id>` and stop. `auto` → compare the story's complexity to `Flow threshold`: at or below it, and with no escalation signal visible in docs/stories.md (schema migration, genuinely new screen, authorization or tenant-scope change, API contract change, added dependency), hand over to `/ks-flow <id>` and say why; above it, or on any signal, continue here and say which signal kept the story on the full pipeline. A story of complexity 1 does not need six cold contexts to read the same four documents — and one that migrates a schema does.

Bootstrap or verify the story's workspace exactly as AGENTS.md, "Where work happens",
specifies, and perform every read and write there. Report the absolute path, the branch and
the environment files copied (names only, never values). Any conflict it names is a hard stop.

Every phase below, every subagent and both checkpoints operate on files in that worktree.

## Phases 1 to 3 — Research, design, plan: delegated
If docs/plans/<id>.md doesn't exist, delegate to the `planner` subagent (working directory: the
verified worktree; prompt: "Prepare story <id> for execution. Track: full. Target branch:
<branch>."). It follows the ks-research, ks-design and ks-plan contracts in a fresh context and
leaves the plan unvalidated; your context keeps only its summary. If the plan exists and the
story has not been executed yet, run `node .killer-saas/bin/ks.mjs stale <id>` first: stale →
delegate a refresh to the `planner` with the listed files. Never refresh an implemented story:
integration happens at ship.

**Amendments.** If the research proposes "Story amendments proposed", apply them as AGENTS.md, "What is a story", says — base directory, target
branch, pushed — then set the plan's `base:` to the amendment commit. Never from the worktree.

CHECKPOINT — per `Plan validation`. If the plan's frontmatter already says `validated: yes`, continue. Otherwise, `human`: present the plan summary (premise verdict, tasks, footprint, test strategy) and ask via AskUserQuestion: "Validate this plan?" — options: Validate / Modify / Stop; only Validate sets `validated: yes`, anything else stops. `autonomous`: re-read the plan against the story's acceptance criteria, set `validated: yes` yourself, and say plainly that nobody else looked at it. An existing plan file never counts as validated on its own.

## Phase 4 — Execute
Fail-closed: docs/plans/<id>.md must carry `validated: yes` — missing means back to the Phase 3
checkpoint. Then delegate to the `implementer` subagent **exactly as /ks-execute does**, with
the verified absolute worktree as its working directory, in fix mode first if a blocking review
exists. Its definition is its contract; do not restate it. Capture its summary.

## Phase 5 — Review
Delegate to the `reviewer` subagent **exactly as /ks-review does**: fresh context, the story
diff, its own definition and preloaded skill as its contract. Write the report to
docs/reviews/<id>.md. A missing or malformed verdict is itself a blocked review: write that
failure with `Max severity: critical` and `Ship allowed: no`, and do not infer a severity.

Pick the review mode as /ks-review does ("Pick the mode").

Gate: `Ship allowed: no` → back to Phase 4 in fix mode, per AGENTS.md, "Gate" — only a
critical, or a review that could not complete, reopens a loop, and never more than two. Each
loop receives the complete latest report, and fixes its criticals only. Still blocked after two → stop and report every open
finding. Never soften a verdict to move on.

## Phase 6 — Ship
CHECKPOINT — per `Ship confirmation`. `human`: show the verdict and ask via AskUserQuestion: "Ship now?" — options: Ship / Not now; only an explicit Ship proceeds. `automatic`: proceed. Then run **/ks-ship's flow, unchanged** — gate, integrate first, ADR numbers, exit gate, merge mode, majors to issues, cleanup on a proven merge. Do not paraphrase it: every step it holds is one this cycle needs.

End with: "Story <id> shipped. Cycle complete." when the merge is proven, "PR opened — merging is yours." when it stops at the PR — or the exact blocking state if stopped (which phase, what's missing).
