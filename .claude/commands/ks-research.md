---
description: Explore a story's real context before planning — current code, APIs, traps
argument-hint: <story id or name>
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write
  - Bash
  - Agent
---
You are exploring a story's context before it gets planned. Target story: $ARGUMENTS

Resolve $ARGUMENTS to the story id (`s<number>-<slug>`) against docs/stories.md. If there is no unambiguous match, list the available stories and stop.

## Workspace bootstrap (fail-closed)

Before reading or writing story files, invoke the `worktree-manager` subagent
with the resolved id and repository base directory. Continue only after it
returns the absolute `.worktrees/<id>` path, confirms branch `feature/<id>` and
a clean status. Perform every Research read and write in that worktree. Never
create or checkout the feature branch in the repository base directory.

If docs/reviews/stories.md is missing, or says `Stories ready: no`, say so: the breakdown hasn't passed /ks-stories-review, so this story may not match the PRD perimeter. Continue only if I confirm — this is a warning, not a block.

Read: docs/stories.md (the target story), docs/architecture.md, AGENTS.md
Output structure: @templates/research.md

Apply the codebase-analysis skill to the story's scope: the CURRENT state of the code, not what the docs claim — the code may have drifted since previous stories.

Proceed as follows:
1. Isolate the target story and its acceptance criteria.
2. Locate the files actually involved in the story and their current state.
3. Verify the story's PREMISE, not just the existence of what it names. A story asserts things — this guard reads that key, this function resolves that limit, this screen shows that state. Open the code and check each assertion: exact name, signature, location, AND behaviour on the story's case. Never assert from memory. A function that exists and throws on the story's input invalidates the premise — say it at the top of the report: a false premise is the most valuable thing this command can find, and it gets repaired in the story, not patched at planning.
4. Spot the traps: existing tests, dependencies between modules, code touched by previous stories.
5. Note what you could NOT settle in the "Open questions" section — an honest unknown beats a plausible guess.
6. Re-score the story's complexity now that you have read the code, and compare with docs/stories.md. A score given before anyone opened a file is a guess; yours is not. A verdict of 5 carries a split proposal — it belongs here, where the facts are.
7. Write the result to `docs/research/<id>.md`.

Write no code. Plan nothing: this command produces verified context, not a plan.

End with: "Research ready in docs/research/<id>.md. Next step: /ks-design <id> (UI story) or /ks-plan <id>"
