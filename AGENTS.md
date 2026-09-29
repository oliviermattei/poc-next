# killer-saas — Repo rules

**This file holds the method's rules.** What is specific to this project — settings, project
commands, conventions — lives in `AGENTS.local.md`. `CLAUDE.md` imports both, so every agent
loads both. This copy of the method is maintained here, not reinstalled: every local change
to it is listed in `.killer-saas/LOCAL-CHANGES.md`, the list to propose upstream.

**A rule here applies to every project. A value that varies is read from `AGENTS.local.md`** —
never decided by the agent, never defaulted when missing. Read it there, not in the prose
above it: one setting per line, `Name: value`, the value being everything after the colon,
trimmed. A value of `—` means the project does not have that thing; say so rather than
substituting one.

## Absolute rule
No direct coding. Every feature goes through the killer-saas pipeline, in order:

Setup → PRD → User Stories → Architecture (+ Design System) → then, per story: Research → Design → Plan → Execute → Review → Ship

`/ks-setup` is not a phase of the cycle: it writes the project's settings once, and every command below reads them.

No code is written before the story has a validated plan (`/ks-plan`). No feature ships before a passed review (`/ks-review`).

### Quick Fix mode — the one exception

**Only on the user's explicit request**, and only for a small, local, well-understood,
easily reversible adjustment: a color, spacing, radius, font size or button style; short UI
copy or a translation; a layout or responsive nudge; restoring an existing presentation
affordance. The primary agent implements it directly — it may use a subagent to investigate
or review, never to implement.

**It does not apply** to a new feature, a shared-component redesign, a data model or
migration, an API or contract change, authorization, security, business rules, persistence,
a cross-cutting refactor, a dependency change, or anything whose impact is uncertain. Too
large, or investigation reveals one of these → stop Quick Fix, recommend the pipeline, and
write no more code until the work has passed the right stages.

Announce the mode and its exact scope before editing, keep the diff minimal, preserve
existing abstractions, and verify proportionately — at minimum a focused lint, typecheck,
existing test, or a look at the screen.

**Base directory, branch `dev`, never a worktree or a feature branch.** Another branch
checked out → stop and ask; never switch automatically. Another agent owning the directory →
coordinate or stop; never overlap edits.

## Pipeline (commands)

Framing, once per product: `/ks-setup` (settings, first) → `/ks-prd` → `/ks-stories` →
`/ks-stories-review` → `/ks-architect` → `/ks-design-system`.

Per story: `/ks-research` → `/ks-design` (UI only) → `/ks-plan` → `/ks-execute` →
`/ks-review` → `/ks-ship`. Each command's own file states its contract.

Short track: **`/ks-flow`** runs that same cycle in three contexts instead of six — research
and plan fused in one pass, then the same `implementer`, the same fresh-context `reviewer`,
the same ship. Nothing is relaxed: dedicated worktree, validated plan, neutralization proof,
`Ship allowed` gate, test budget.

Utilities: `/ks-orchestrator` (the whole cycle, with the two human checkpoints),
**`/ks-batch`** (several stories at once), `/ks-status` (state derived from the files),
`/ks-help`.

**Run the commands. Never hand-roll the agent call.** They carry what the pipeline has
learned — fix mode, the subagent definitions, the gates. A briefing written by hand replaces
all of it with an opinion: measured on this project, hand-written prompts ("implement in
TDD", "run the suite yourself") ran the end-to-end suite eight times per implementation.

**Parallel stories go through `/ks-batch`, never through several orchestrators side by side.**
Plans run in parallel — they only write `docs/` in their own worktree — once a story's
dependencies are shipped. A story starts executing only when `ks.mjs conflicts` clears it:
every dependency shipped, and no story it shares a footprint with, or that touches
`Exclusive paths`, in flight — **a started story holds its files until it ships**, not until it
finishes. Ships are a serial queue that frees on a proven merge, and each merge sends the
stories not yet executing through `ks.mjs stale`. How many run at once follows the session budget
(`ks.mjs budget`), never a guess.

One feature = one cycle = one branch = one PR. `Story track` in `AGENTS.local.md` picks the
track: `full`, `flow`, or `auto` (`flow` at or below `Flow threshold`, `full` above it).
Whatever the track, a migration, a genuinely new screen, an authorization or tenant-scope
change, an API contract change or an added dependency belongs to `full` — and escalates
there mid-flight if that is when the code reveals it. **The track changes how many contexts
read the story, never which gates it passes.**

## Where work happens

Two modes, and **a complexity score never chooses the directory** — it only chooses the track:

| Mode | Working directory | Branch |
| --- | --- | --- |
| Explicit Quick Fix | Repository base directory | `dev`; another branch checked out → stop and ask |
| Feature / story | Dedicated `.worktrees/<story-id>/` worktree | Exact `feature/<story-id>` |

Every change not explicitly announced and eligible as a Quick Fix is a feature, and a feature
stays in its worktree from the first phase to the last, whatever its complexity. Never create
or check out a feature branch in the repository base directory.

**The method says where the work happens, not how the workspace is built.** The entry command
— `/ks-research`, `/ks-flow` or `/ks-batch` — creates or verifies the worktree with
`git fetch` then `git worktree add -b feature/<id> <dir> origin/<target>` (the remote target, not
the local branch: with `Merge mode: pr` the local one lags, and the research would read old code), imports the untracked `.env*` files, gives it its own ports
(`node .killer-saas/bin/ks.mjs slot <id> --write`: every port of `Worktree ports`, and the
URLs that point at them, shifted by the worktree's slot — two worktrees never share a
database or a server), and installs dependencies there. It **never runs a baseline test
suite**: the default branch's state is not this story's problem.

Anything a test or a script writes outside the worktree — a fixed `/tmp` path, a fixed port —
is shared with every other worktree, and is a defect of that script.

Every later phase resolves the absolute path and verifies the exact branch. Missing worktree,
wrong branch, detached HEAD or a second branch name is a hard stop — never `git switch`,
`checkout`, `stash`, or an `-isolated` suffix.

One agent, one working directory. While an agent owns one, no second agent and no main
context edits, checks out or stashes in it.

## What is a story, and what is not

`docs/stories.md` holds the **product perimeter** — the breakdown `/ks-stories` produced and
`/ks-stories-review` validated. A story is a new capability.

**A defect is not a story.** A bug, a stale assertion, a screen that renders wrong, a footgun
— it goes to the issue tracker. Putting it in `docs/stories.md` inflates the perimeter with
work nobody scoped, and `/ks-status` then counts it as product left to build. **A review
finding stays in its review report** unless a human decides otherwise: it is already traced
there, with its `file:line`.

**A story states WHAT, never HOW.** Product decisions and contracts between stories belong in
it ("with `APP_HOST`, the site no longer sees the session"). File paths, line numbers, function
names and implementation choices do not: they go stale as soon as another story merges, and
every story review then spends its round re-checking them against moved code. They belong in
the research, which is verified against a commit.

**`docs/stories.md` changes only on the target branch.** Research and planning never edit it:
they propose amendments ("Story amendments proposed", at the top of the research), and the
conductor applies them in the repository base directory: `git pull --ff-only` on the target
branch, the change in the story's `### Amendments` section, one commit
(`docs(stories): amendments from <id>`), **pushed** — the pipeline reads `origin/<target>`,
and an amendment that stays local reaches no PR and no freshness check. A protected target
branch → a docs-only PR instead. The next stories review reads amendments as a delta.

## Story ids and branches
- Every story has an id: `s<number>-<short-slug>` (e.g. `s01-submit-testimonial`). It is assigned in docs/stories.md and reused verbatim everywhere: `docs/research/<id>.md`, `docs/plans/<id>.md`, `docs/reviews/<id>.md`, branch `feature/<id>`.
- All work on a story happens on `feature/<id>`, branched from the default branch. Never commit story work to the default branch.
- The story diff = `git diff <default-branch>...feature/<id>`. That is what the review judges.
- A command that receives a fuzzy story name resolves it against docs/stories.md; if there is no unambiguous match, it lists the available stories and stops.

## Gate (mechanical)
- The review report `docs/reviews/<id>.md` must end with the exact lines `Max severity: <critical|major|minor|none>` and `Ship allowed: <yes|no>`. A single critical = no.
- `/ks-ship` refuses to run unless that file exists and contains the line `Ship allowed: yes`. No file, no line, or `no` → ship blocked. No exceptions.
- **Only a critical blocks.** A `major` is a real defect — traced in the report, fixed in a next cycle; a `minor` is style. Neither reopens a fix loop: a loop is a full implementation pass plus a full review pass, and spending one on naming costs half a story and closes no defect. Measured on this project: of 24 fix passes, about 16 followed a review that had already passed.
- **A critical names its failure scenario**: the input or state, and what goes wrong — a criterion violated, a security hole, data lost or corrupted, existing behavior broken. Written is enough; it need not be executed. No scenario, no critical: it is a major.
- After a blocked review, `/ks-execute` runs in fix mode: **the criticals only** — plus whatever made the review incomplete. Majors and minors are not touched: every line a fix adds is new surface for the next review. Two loops at most.
- **The review after a fix is a closure review**, not a new hunt: each critical re-verified (with its neutralization), the fix diff since `Reviewed commit:` judged in full, and its callers opened. A new finding outside that diff is recorded, and blocks only if it is critical. Stories touching authentication, authorization, tenant scope or security headers get a full second review instead — on this project a full second pass found a real 2FA bypass the first one missed.
- **Open majors become issues at ship**, in `Issue tracker` — one issue per major, linking the review. A major that lives only in a merged report is never fixed.
- Before the story commit the implementer writes `docs/verif/<id>.md` (@templates/verification-record.md): the commands it ran, their exit codes, and the `Tree:` those runs covered. `node .killer-saas/bin/ks.mjs verif-current <id>` answers one question mechanically — does that record still describe the committed code, same tree outside `docs/`? With `Verification mode: record`, the review takes a current record as proof and does not re-run the suite or the type check. Missing, incomplete or stale → the reviewer runs them itself. An absent record is never a pass.
- A plan executes only if its frontmatter says `validated: yes` — set by the human validation checkpoint (/ks-plan or the orchestrator), never by the file merely existing. /ks-execute is fail-closed on it.

## Ship strategy
Read `Merge mode`, `Target branch` and `Ship confirmation` from `AGENTS.local.md`.

- `Merge mode: pr` — /ks-ship opens a PR against the target branch. With `Ship confirmation: human` it stops there and merging is a human decision (review on GitHub, protected branch, CI); rerun /ks-ship after the merge to confirm the deployment and clean up. With `automatic` it squash-merges and deploys right after the gate.
- `Merge mode: local` — no PR: /ks-ship squash-merges the story into the target branch locally, for a solo flow with no review platform. `Ship confirmation: human` still asks before merging.

Whatever the mode, the merge is a **squash**: one story, one commit on the target branch.

## Design

`Design source` in `AGENTS.local.md` is a project decision, never a per-story one: `internal`
(the agent draws, through `Design skill` when named) or `external` (a brief goes to
`Design tool`, the result comes back). The system lives in `docs/design-system.md`, each
story's design in `docs/designs/<id>/`, and **the repository is authoritative** — anything
reworked in an external tool comes back before implementation.

Three rules everyone downstream needs:
- **A new screen gets one visual artifact; a derived screen gets none.** A mockup is a
  reference, never code to copy — implementation uses the boilerplate's real components.
- **Never invent a component or token outside the design system.** A need it does not cover
  is a gap to report, never to fill freestyle.
- **Nothing is measured outside `/ks-design-system`** — no contrast ratios, font sizes,
  rendered widths, positions or `Δx`, and never as a test assertion. Downstream, look for
  what is BROKEN.

Stories without UI skip `/ks-design`. Full doctrine: the `design-doctrine` skill.

## Data & docs lifecycle
All pipeline data lives in markdown files under docs/, versioned by git. No database, no state file: the pipeline state is derived from the files (a story is planned if docs/plans/<id>.md exists, shipped if its review says `Ship allowed: yes` and the branch is merged) — a derived state can't go stale.

- Framing docs — docs/prd.md, docs/stories.md, docs/reviews/stories.md, docs/architecture.md, docs/design-system.md: committed on the default branch at the end of their phase. (docs/reviews/stories.md reviews the breakdown, not a story: it is a framing doc, unlike docs/reviews/<id>.md which travels with its branch.)
- Story docs — docs/research/<id>.md, docs/designs/<id>/ (brief.md, design.md, mockup.html), docs/plans/<id>.md, docs/verif/<id>.md, docs/reviews/<id>.md: committed on feature/<id>. The implementer's single story commit brings the research, the design and the plan; /ks-ship commits the review. Every PR carries its own research, design, plan and review.
- Document size — research ~200 lines, plan ~250, review ~150. Every downstream agent reads these files and pays for their length. Cap the prose, never the decision tables: what carries decisions stays whole.
- Task progress — the checkboxes in docs/plans/<id>.md: the implementer ticks each task as it lands, and they travel in the story's commit. The plan file is the live progress tracker, never a commit trigger.
- Commits — **one commit per story**, not one per plan task. A second commit only for something you would want to revert on its own (typically a migration). The branch's commits are squashed at merge, so the default branch gets one commit per story.
- Decisions — docs/decisions/NNN-<slug>.md (MADR format, @templates/adr.md): one file per structural decision, with the considered options and why they were rejected. Immutable: a change means a new ADR superseding the old one. Framing decisions commit on the default branch; story decisions travel with feature/<id>. **The number comes from `ks.mjs next-adr`**, which reads the target branch and every worktree, and the file is written at once — two stories in flight never take the same number.
- Plan frontmatter — `validated`, plus `base:` (the target commit the facts were verified against) and `footprint:` (every path the implementation will touch). `ks.mjs stale` and `ks.mjs conflicts` read them; a plan without a footprint runs alone.

## Testing

**Budget: `Test budget` (25 by default); a story needing more says why in its plan.** Volume
is not a net, and a suite that takes half an hour is a suite nobody runs. **The criterion
that replaces the count: a test that stays green when the rule it names is deleted is worse
than no test.**

**Each check runs once, and once only** — a deterministic command re-run on the same code
returns the same answer. Focused suite per task, on that task's own files; the full suite
once after the last task; the type check once after the last edit; the end-to-end suite and
the production build once at ship, never inside the cycle. Stages are settings:
`Full suite`, `E2E stage`, `E2E scope`, `E2E browsers`, `Build stage`.

Where the tests go, the four cuts, the six shapes of a test that names an invariant without
exercising it, and the neutralization technique: the `testing-doctrine` skill, preloaded in
the `implementer` and the `reviewer`.

## Technical conventions
In `AGENTS.local.md`, under "Project conventions" — filled by `/ks-architect` from the boilerplate.

## Changing the method
The commands, agents and skills under `.claude/` are this project's copy of the method, and
they are edited here — **no `install.sh` is run on this repository**: it would silently
overwrite them. What is specific to the project stays a setting in `AGENTS.local.md`. Every
change to the method's own files gets one line in `.killer-saas/LOCAL-CHANGES.md` — what, and
the evidence that motivated it — so it can be proposed upstream.

## Definition of Done (per feature)
- Single PR, structured description, readable diff
- Passing tests on business logic
- No regression on existing code
- Review passed (no open critical issue)
- Deployed to production
