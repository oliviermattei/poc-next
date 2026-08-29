---
description: Get a story implemented in TDD, in an isolated subagent. Never codes in the main context.
argument-hint: <story id or name>
allowed-tools:
  - Read
  - Glob
  - Agent
  - Bash
---
# ks-execute — Delegated implementation

Target story: $ARGUMENTS

## Execution contract (non-negotiable)
You MUST complete this command by delegating to the `implementer` subagent. You are FORBIDDEN from:
- Writing or modifying code yourself — you don't have the Write/Edit/Bash tools, on purpose.
- Starting the implementation without a validated plan in docs/plans/<id>.md.
- Running a story from the repository base directory, whatever its complexity.
- Creating or checking out the story branch in the repository base directory.
- Summarizing work the agent didn't actually do.

If you can't invoke the Agent tool, stop and report the error. Don't improvise.

## Workflow

### Step 1 — Prerequisites (fail-closed)
1. Resolve $ARGUMENTS to the story id (`s<number>-<slug>`) against docs/stories.md. No unambiguous match → list the available stories, STOP.
2. Resolve `<repository-base>/.worktrees/<id>` and verify its branch is exactly `feature/<id>`. Missing worktree, wrong branch, detached HEAD or the repository base directory itself → STOP and run `/ks-research <id>` to bootstrap the feature workspace. Never improvise another branch or path.
3. From that worktree, read docs/plans/<id>.md. If it doesn't exist, STOP: ask for /ks-plan <id> first. Go no further.
4. Check the plan's frontmatter: it must contain `validated: yes`. Otherwise STOP: "Plan not validated. Review it, then rerun /ks-plan <id> to validate."
5. Read docs/reviews/<id>.md from the worktree if it exists. If it contains `Ship allowed: no`, this is a FIX run: the review findings come first.

### Step 2 — Delegate
Invoke the Agent tool:
- subagent_type: implementer
- description: Implement story <id> in TDD
- working directory: the absolute dedicated worktree path verified in Step 1.
- prompt: Implement story <id> from docs/plans/<id>.md, following docs/architecture.md and AGENTS.md. Read docs/research/<id>.md first when it exists — the plan decides, the research holds the verified facts and the traps, and you commit it. The worktree and branch are already prepared and verified: do not create a worktree, switch branches, checkout, or stash. Strict TDD, task by task: failing test → code → passing test, checkbox ticked. One single commit at the end of the story, carrying the story docs and every task — never one commit per task. Implement only what the plan specifies. The tdd-skill is preloaded in your context.
- On a FIX run, prepend to the prompt: This story was blocked in review. Fix every critical and major finding from docs/reviews/<id>.md first, test-first, then finish any unimplemented plan task.

Wait for the agent to finish. Capture its summary.

### Step 3 — Report
Summarize: tasks done, files touched, tests added, and any blocker the agent reported. No line-by-line detail.

End with: "Implementation done. Next step: /ks-review <id>"
