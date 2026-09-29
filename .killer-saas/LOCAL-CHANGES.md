# Local changes to the killer-saas method

This repository maintains its copy of the method by hand; `install.sh` is not run on it (it
would overwrite everything below). One line per change: what, and the evidence behind it.
Base: method version `43ec45f` (`.claude/.ks-version`), reinstalled in `331243c`.

## 2026-09-28 — parallel stories, review convergence

Evidence: 300 subagent transcripts of this project (s34 and later: 37 stories, 62
implementer runs, 49 reviews) and the git history of `docs/stories.md`.

- **`/ks-batch` + `planner` agent** — several stories at once: plans in parallel, execution in
  conflict-free waves, ships in a serial queue, stale research refreshed after each merge.
  Evidence: s62a and s67 run side by side broke each other's checks (fixed `/tmp` paths, port
  3100 — story s68 exists because of it); s23 had to move Postgres to 5433 by hand.
- **`.killer-saas/bin/ks.mjs`** — mechanical answers the conductor must not guess: `budget`,
  `deps`, `conflicts`, `stale`, `next-adr`, `slot`, `verif-current` (the `ks-gate` the method
  references was never installed here, so `/ks-ship` had no way to trust the record).
- **Session-budget pacing** — `ks.mjs budget` reads the 5-hour and weekly usage (ccstatusline
  cache, or `statusline-tee.sh`), and `/ks-batch` goes serial above 50 %, holds at 85 %, and
  spends unused budget when the reset is within two hours.
- **Plan frontmatter `base:` and `footprint:`** — what `stale` and `conflicts` read.
- **Per-worktree ports** (`Worktree ports`, `ks.mjs slot --write`) — two worktrees never share
  a database or a server port.
- **ADR numbers from `ks.mjs next-adr`**, collisions renumbered at ship — ADRs are numbered in
  sequence (070…075) and two stories in flight took the same next number.
- **Fix mode fixes criticals only** — 24 fix passes for 8 blocking reviews: about 16 fixed
  majors or minors of reviews that had already passed. It also contradicted AGENTS.md "Gate".
- **Closure review after a fix**, full second review kept for auth, tenant and security
  stories — a full second pass on s28 found a real 2FA bypass the first had missed.
- **A critical names its failure scenario** — "ships a bug" alone let majors be classed
  critical and reopen loops.
- **Open majors become issues at ship** — "fixed in a next cycle" had no mechanism.
- **Stories state WHAT, never HOW; `docs/stories.md` changes only on the target branch;
  research proposes amendments** — `docs/stories.md` reached 2145 lines with 32 file:line
  references; stories-review rounds 7 to 10 (one day, s60–s65) found 11, 12, 14 and 10 issues,
  each round already `Stories ready: yes`, many of them references moved by other merges.
- **Stories review in delta / closure mode, `Reviewed at:`, stable finding ids, hard stop at
  `Stories ready: yes`** — same evidence: a full re-read by a non-deterministic reviewer
  samples new findings; it does not converge.
- **Research template** — English header, a `Premise` and a `Story amendments proposed`
  section, the stray `<< IP Mike … >>` placeholder removed.
- **`/ks-execute`** — no longer claims to lack Bash; checks freshness before a first run
  only; detects a fix run from the report's last verdict.
- **Integration** — `/ks-ship` merges `origin/<target>` into the story before its exit gate
  and reruns the unit suite and the type check on the integrated tree; a conflict goes to the
  implementer's "Integration mode", then a closure review of the resolution
  (`git show --remerge-diff`).
- **`ks.mjs footprint-check`** — the real diff against the declared footprint; the conductor
  counts extra files as occupied, the reviewer reports them.
- Reviewed in fresh context before use (23 findings, 4 critical: local `dev` read instead of
  `origin/dev`, waves that let a conflicting story start before the first shipped, closure
  review after an incomplete review, unnormalized footprint entries) — all addressed; a closure review then found 4 more
  (a just-launched story not holding its files → `--running`; amendments never pushed;
  an integration record passing as a full-suite proof; worktrees created from the lagging local
  target) — addressed.
- **`CLAUDE.md` imports `AGENTS.local.md`** — without a reinstall, the project conventions
  moved there never reached an agent.
