---
description: Open the PR; merge and deploy per the project's ship strategy (manual by default)
argument-hint: <story id or name>
allowed-tools:
  - Read
  - Bash
---
You are shipping a story. Target story: $ARGUMENTS

Resolve $ARGUMENTS to the story id (`s<number>-<slug>`) — the review file docs/reviews/<id>.md must exist for it.

Locate `.worktrees/<id>`, verify its branch is exactly `feature/<id>`, and run
the entire command from that absolute worktree. Missing worktree, wrong branch,
detached HEAD or repository base → STOP; never checkout the feature branch in
the repository base directory.

## Step 0 — Gate (fail-closed, mechanical)
Run: `grep -q '^Ship allowed: yes' docs/reviews/<id>.md`
If the file is missing or the command fails, STOP immediately: "Ship blocked — review missing or negative. Run /ks-review <id>." Nothing below runs without a passing gate.

Then proceed:
1. Without switching branches, commit docs/reviews/<id>.md on the already verified feature branch if not already committed (the PR must carry its review). Then verify the tests pass. Failing tests → stop.
2. If a PR for feature/<id> already exists, don't open a duplicate — check its state: MERGED → jump straight to the Cleanup step (confirming the deployment on the way); OPEN → continue. Otherwise push the branch and open a clean PR from feature/<id> to the default branch: clear title, structured description (what, why, how to test), readable diff. Include the review verdict (max severity + findings summary) in the PR body.
3. Read the ship strategy from AGENTS.md ("Ship strategy" section). No section, or no explicit `auto` → the mode is manual.

## Step 4 — Merge (per the ship strategy)

**Always squash.** One story = one commit on the default branch. The working commits stay on the branch, the history stays readable, and no merge commit is created. Without it a seven-story release lands as fifty commits nobody can read.

- **manual (default): do NOT merge.** End with: "PR opened: <url>. Merging is yours to decide (human review, protected branch, CI) — **squash-merge it**. After merging, rerun /ks-ship <id> to confirm the deployment and clean up the branch."
- **auto**: `gh pr merge <url> --squash --delete-branch=false`, trigger the deployment, confirm it's live (URL), then run the Cleanup step. End with: "Story shipped to production. Cycle complete. Next story: /ks-research <story>"

Never merge in manual mode, even if everything is green — the gate authorizes the ship, the human decides it.

## Final step — Cleanup (ONLY after a PROVEN merge)
Never clean up on the promise of a merge — only on proof:
1. Verify: `gh pr view feature/<id> --json state,mergedAt --jq '.state'` must return exactly `MERGED`. An OPEN PR, a closed-unmerged PR, or an "about to be merged" does NOT qualify: skip cleanup entirely.

   Do NOT use `git merge-base --is-ancestor` here: a squash merge rewrites the work into a new commit, so the branch's commits are never ancestors of the default branch. The check would fail on every correctly merged story and no branch would ever be cleaned up.
2. Verify the dedicated worktree is clean, then remove that exact worktree with
   `git worktree remove <repository-base>/.worktrees/<id>`. A dirty worktree is
   a hard stop; never use `--force`.
3. Only after the worktree is gone, delete the branch, local and remote:
   `git branch -D feature/<id>` and `git push origin --delete feature/<id>`.

   `-D` is required, again because of the squash: `-d` refuses a branch git
   considers unmerged, which is every squashed branch. The safety therefore
   rests entirely on step 1 — never remove the worktree or branch without the
   `MERGED` proof.

The content is in the default branch, the audit trail is in the merged PR: the branch has no further use.
