---
description: Ship the story per the project's Merge mode and Ship confirmation (AGENTS.local.md)
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
1. Read `Merge mode`, `Target branch`, `Ship confirmation`, the stages (`Full suite`, `E2E stage`, `E2E scope`, `Build stage`) and the project commands from AGENTS.local.md. Missing file or missing setting → STOP: "No project settings. Run /ks-setup." Never assume a mode — every step below branches on them.
2. Without switching branches, commit docs/reviews/<id>.md on the already verified feature branch if not already committed (the PR must carry its review).

   **Integrate first.** `git fetch`, then: if `origin/<target>` (or `<target>` without a remote) moved since the story last took it (`git merge-base --is-ancestor origin/<target> HEAD` fails), run `git merge --no-edit origin/<target>` in the worktree — the squash makes this merge commit invisible on the target. A conflict → `git merge --abort`, STOP, and hand the story to the `implementer` with "Integration run: merge origin/<target>" (its definition, "Integration mode"), then `/ks-review <id>` — it picks the integration closure review — then `/ks-ship <id>` again. A clean merge still changes the tree: the verification record no longer describes it, so **the unit suite and the type check below both run on the integrated code** — new information, not a repeat.

   **ADR numbers.** For each `docs/decisions/NNN-*.md` the branch adds, if the target already holds another file with the same `NNN`, renumber it on the branch with `node .killer-saas/bin/ks.mjs next-adr`, and update the references to it in `docs/` and in code comments. Two stories in flight must never land the same number.

   Then run the **exit gate — the one place the expensive checks run in the whole cycle**, per the stages in AGENTS.local.md, using the project's own commands quoted verbatim:
   - **Unit suite.** `Full suite: execute-end` (the default) → it already ran in Execute, and docs/verif/<id>.md proves it for this exact tree: check `node .killer-saas/bin/ks.mjs verif-current <id>` instead of re-running, and run `<Test>` only if that check fails — and then `<Typecheck>` too: the suite does not type-check, and a type break between two stories only appears on the integrated tree. `ship` or `both` → run `<Test>` in full here, and `<Typecheck>` too when the integration merge changed the tree.
   - **End-to-end.** `E2E stage: ship` → run `<E2E>` once, at `E2E scope`, on every browser the project configures. This is the cycle's only end-to-end run; nothing upstream is allowed to have made it.
   - **Production build.** `Build stage: ship` → run `<Build>`. `ship-if-route` → run it only when the story's diff moved a route, a manifest or the file-based routing — the one rupture a type check cannot see; otherwise skip it and say so.
   - **`ci` for any of them** → do not run it here: read the branch's checks (`gh pr checks`) and stop unless they are green.
   A command given as `—` does not exist in this project: say so, never substitute one. Any red → stop, and back to `/ks-execute <id>` in fix mode. Nothing merges on a red gate.
3. `Merge mode: local` → skip this step entirely, there is no PR. Otherwise: if a PR for feature/<id> already exists, don't open a duplicate — check its state: MERGED → jump straight to the Cleanup step (confirming the deployment on the way); OPEN → continue. Otherwise push the branch and open a clean PR from feature/<id> to the target branch: clear title, structured description (what, why, how to test), readable diff. Include the review verdict (max severity + findings summary) in the PR body.

## Step 4 — Merge (per the project's settings)

**Always squash.** One story = one commit on the target branch. The working commits stay on the branch, the history stays readable, and no merge commit is created. Without it a seven-story release lands as fifty commits nobody can read.

`Ship confirmation: human` → ask via AskUserQuestion before merging, whatever the mode: "Merge <id> into <target branch>?" — Merge / Not now. Only an explicit Merge proceeds. The gate authorizes the ship; the human decides it.

- **`Merge mode: pr`, confirmation `human`: do NOT merge.** End with: "PR opened: <url>. Merging is yours to decide (human review, protected branch, CI) — **squash-merge it**. After merging, rerun /ks-ship <id> to confirm the deployment and clean up the branch."
- **`Merge mode: pr`, confirmation `automatic`**: `gh pr merge <url> --squash --delete-branch=false`, trigger the deployment, confirm it's live (URL), then run the Cleanup step.
- **`Merge mode: local`**: no PR at all. From the repository base directory, squash the story into the target branch: `git merge --squash feature/<id>` then commit with the story's message. Push it if the project has a remote. Then the Cleanup step.

End a completed ship with: "Story shipped. Cycle complete. Next story: /ks-research <story>"

## Final step — Cleanup (ONLY after a PROVEN merge)
Never clean up on the promise of a merge — only on proof:
1. Verify the merge really happened. `Merge mode: pr` → `gh pr view feature/<id> --json state,mergedAt --jq '.state'` must return exactly `MERGED`; an OPEN PR, a closed-unmerged PR, or an "about to be merged" does NOT qualify: skip cleanup entirely. `Merge mode: local` → the squash commit must be present on the target branch.

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

4. **Open majors become issues** (`Issue tracker` in AGENTS.local.md; `—` → list them in the final message instead). One issue per major still open in docs/reviews/<id>.md: title `<id>: <finding in a few words>`, body the finding line, its file:line and a link to the review in the merged PR. Search first (`gh issue list --search "<id>: in:title"`) and never open a duplicate. A major that lives only in a merged report is never fixed.
5. **Stories in flight.** If other story worktrees exist, run `node .killer-saas/bin/ks.mjs stale <their ids>` and name the ones this merge made stale: they refresh their research before their next phase (`/ks-batch` does it; by hand, rerun `/ks-research <id>`).

The content is in the default branch, the audit trail is in the merged PR: the branch has no further use.
