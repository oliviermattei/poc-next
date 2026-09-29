---
description: Run several stories at once without letting them collide — plans in parallel, execution only when nothing it conflicts with is in flight, ships in a serial queue, concurrency paced by the session budget
argument-hint: <story ids…> | next <n>
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write
  - Edit
  - AskUserQuestion
  - Agent
  - Bash
---
# ks-batch — Several stories, no collisions

Target: $ARGUMENTS

Parallel stories go wrong in four ways, all seen on this project: two branches edit the same
file; one story's research is read after another story has moved the code under it; two
worktrees share a port, a database or a temporary path; two plans take the same ADR number.
This command prevents each one mechanically. It runs the same cycle as `/ks-orchestrator`,
with the same subagents, prompts and gates — it only decides **what may run at the same
time**.

`K` below is `node .killer-saas/bin/ks.mjs`. Run `git fetch` before every `K` call that reads
the target branch: with `Merge mode: pr` merges happen on the remote, and `K` reads
`origin/<target>`.

## Execution contract (non-negotiable)

You are the conductor. You never research, plan, code or review yourself: every phase is a
subagent, so your context stays small over a long batch. You are FORBIDDEN from:
- Starting a phase `K` has not cleared: `K budget` for any launch, `K conflicts` for planning
  and execution.
- Writing a subagent prompt of your own. Each phase uses the prompt of the command that owns
  it, word for word (listed in step b).
- Having two ships in progress. A ship holds the queue until its merge is proven.
- Stopping a running subagent to save budget. A phase in flight finishes; the pause happens
  at the next phase boundary, where every result is already on disk.
- Touching a worktree while its subagent runs, or editing `docs/stories.md` anywhere but the
  target branch in the repository base directory.

Every state below is derived from the files, so **rerunning `/ks-batch` with the same ids
resumes where it stopped** — no state file, nothing to restore.

## Phase 0 — Prerequisites

1. `AGENTS.local.md` carries `Max parallel`, the four `Budget …` settings, `Exclusive paths`,
   `Union paths` and `Worktree ports`. Missing → STOP: "Run /ks-setup."
2. Framing exists: `docs/prd.md`, `docs/stories.md`, `docs/architecture.md`.
3. Resolve the ids. `next <n>`: `K next <n>` — in file order, not shipped, not split (a split
   story is built through its parts), not deferred by the product owner. Nothing left → STOP and
   say so. `K deps <ids…>`: a story whose unmet dependency is not in the batch leaves it — say
   which, and why. The batch is the stories that remain.
4. `K budget`. `hold` → STOP now and say when it lifts (`resumeAt`).

## Phase 1 — Workspaces

For each story without a worktree: bootstrap it as AGENTS.md, "Where work happens", specifies,
then `K slot <id> --write` (it does nothing when `Worktree ports` is `—`). Report path, branch
and ports, one line per story.

## Phase 2 — The loop

Repeat until every story is shipped, blocked, or waiting on a human:

**a. Budget.** `K budget` before every launch and after every return. `allowed` is the number
of subagents that may run at once, all phases together. `hold` → launch nothing; once nothing
is running, go to "Stop". `serial` → one at a time; `parallel` / `boost` → up to `allowed`.
Say the verdict and its reason in one line whenever it changes.

**b. Pick what to launch** — `K conflicts <the batch's stories not yet shipped>` says which may
be planned (`planNow`) and executed (`executeNow`), and why the others wait (`waiting`). Then,
in this priority, because a story in flight goes stale while it waits:

1. **Ship** — a story whose last review says `Ship allowed: yes`, when no ship is in progress.
   Step e.
2. **Integrate or fix** — a story blocked by a critical: `/ks-execute` Step 1 checks and Step 2
   delegation, fix mode. A story whose ship integration conflicted (step e): the `implementer`
   with "Integration run: merge origin/<target>" (its definition, "Integration mode").
3. **Review** — a story whose implementation (or integration) is committed: `/ks-review` "Pick the mode", its
   Step 1 prompt and its Step 2 report, exactly. You write `docs/reviews/<id>.md` from the
   reviewer's output, as /ks-review does. Reviews run side by side freely: read-only, each in
   its own worktree and port slot.
4. **Execute** — a story in `executeNow`: step d first, then `/ks-execute` Step 1 checks and
   Step 2 delegation. `executeNow` already holds back any story that conflicts with one in
   flight — a started story holds its files until it ships, not until it finishes. **Always
   call `K conflicts … --running=<ids>`** with every story whose implementer you launched and
   that has not shipped: a story launched a minute ago has touched nothing yet, and only this
   flag keeps a conflicting story from being launched beside it.
5. **Plan** — a story in `planNow`: the `planner` subagent, working directory its worktree,
   prompt "Prepare story <id> for execution. Track: <full|flow>. Target branch: <branch>." The
   track follows `Story track` and `Flow threshold`, as in /ks-orchestrator. A story whose
   dependency is not shipped is never planned: it would read code that lacks it.

Launch subagents in the background and react to each return; never wait on one to launch
another the budget allows.

**c. After each return.**
- *Planner* → the plan checkpoint, per `Plan validation`: `human` → gather the plans ready and
  ask in one AskUserQuestion call (up to four: Validate / Modify / Stop); `autonomous` → as in
  /ks-plan. Its "Story amendments proposed", if any: apply them as AGENTS.md, "What is a story",
  says — base directory, target branch, pushed — then set the plan's `base:` to the amendment
  commit (it changed `docs/stories.md` only, and the plan already accounts for it). The next
  `/ks-stories-review` reads them as a delta.
- *Implementer* → `K footprint-check <id>`. Extra files are now part of the story's footprint
  for `K conflicts` (it reads the branch) — say which. An extra file under `Exclusive paths`
  goes into the review prompt as a point to judge.
- *Reviewer* → as /ks-review Step 3: a critical sends the story back to step b.2.

**d. Before a first execution only**, while no subagent owns the worktree:
1. `K stale <id>` — keep its output.
2. Bring the target in: `git merge --no-edit origin/<target>` in the worktree. The branch has no
   commit of its own yet, so this is a fast-forward; the planner's uncommitted docs live under
   `docs/` and do not collide. A failure → stop that story and report it.
3. Step 1 said stale (changed files, the story's own text, or new ADRs) → relaunch the `planner`
   in refresh mode with that list: it now re-verifies against the code that actually moved. A
   plan it marks `validated: no` goes back through the checkpoint.

**e. Ship queue.** One ship at a time, through `/ks-ship`'s flow unchanged — its "Integrate
first" step brings the target in, reruns the unit suite and the type check on the integrated
tree, and renumbers a colliding ADR. **Never refresh a plan here**: the story is implemented
and reviewed; integration and the exit gate are what is left. The queue frees only on a
**proven merge** and a `git fetch` that shows it on `origin/<target>`.
- An integration conflict at ship → the `implementer` with its integration prompt, then a
  closure review of the resolution (`/ks-review` "Pick the mode": integration), then back here.
- `Merge mode: pr` with `Ship confirmation: human` → the PR waits on a human. The queue is held
  — the next ship would integrate without this story — but plans, executions and reviews go on.
  When nothing else can move, stop with "waiting on a human merge: <PR url>". Rerun
  `/ks-ship <id>` once the human has merged: it proves the merge and cleans up.
- After each proven merge: `K stale` on every story of the batch not yet executing. The ones it
  names refresh before their first execution (step d), not now.

## Stop

When the loop ends — all shipped, budget `hold`, or a human decision pending — report:

| story | phase reached | verdict | PR / merge | next command |

plus the budget line (session and weekly %, minutes to reset). On `hold` with a known
`resumeAt`: offer to resume then, and if the user agrees and a scheduling tool exists in this
session, schedule `/ks-batch <same ids>` for five minutes after `resumeAt`.

End with the one command that continues the batch.
