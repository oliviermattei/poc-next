# <project> — settings and conventions

**This file is yours.** `AGENTS.md` holds the method's rules; this file holds what is specific
to the project. `CLAUDE.md` imports both, so every agent loads both.

Every value below is read by the pipeline commands. One setting per line, `Name: value`, nothing
else on the line: a command reads the value as everything after the colon, trimmed. Change any of
them at any time; they take effect at the next command.

## Pipeline settings

```
Merge mode:        pr
Target branch:     main
Plan validation:   human
Ship confirmation: human
Story track:       auto
Flow threshold:    2
Design source:     internal
Design skill:      —
Design tool:       —
Test budget:       25
Verification mode: record
Full suite:        execute-end
E2E stage:         ship
E2E scope:         nominal
E2E browsers:      —
Build stage:       ship-if-route
Issue tracker:     github
Worktree root:     .worktrees/
Max parallel:      3
Budget serial at:  50
Budget hold at:    85
Budget weekly hold at: 90
Budget boost window: 120
Exclusive paths:   —
Union paths:       docs/, AGENTS.md, **/AGENTS.md, .claude/, .killer-saas/, templates/
Worktree ports:    —
```

| Setting | Accepted values |
| --- | --- |
| Merge mode | `local` (squash-merged locally, no review platform) · `pr` (a pull request against the target branch) |
| Plan validation | `human` (a checkpoint blocks until you validate) · `autonomous` (the agent validates its own plan) |
| Ship confirmation | `human` (asked before any merge) · `automatic` |
| Design source | `internal` (the agent draws, using `Design skill`) · `external` (a brief goes to `Design tool`) |
| Story track | `auto` (the story's complexity picks the lane) · `full` (always the six-phase pipeline) · `flow` (always `/ks-flow`) |
| Flow threshold | complexity at or below which `auto` picks `/ks-flow` |
| Test budget | tests per story — a plan wanting more says why |
| Verification mode | `record` (the implementer records what it ran; the reviewer checks the record instead of re-running) · `rerun` (the reviewer runs everything itself) |
| Full suite | when the whole unit suite runs: `execute-end` · `ship` · `both` |
| E2E stage | when the end-to-end suite runs: `execute-end` · `ship` · `ci` · `—` |
| E2E scope | how far the end-to-end suite goes; `nominal` is one happy path |
| E2E browsers | browsers for the story cycle, e.g. `chromium`; `—` means the project's own default. Ship always runs them all |
| Build stage | when the production build runs: `ship-if-route` (only when a route or manifest moved) · `ship` · `review` · `ci` · `—` |
| Max parallel | the most subagents `/ks-batch` runs at once, whatever the budget allows |
| Budget serial at | 5-hour session usage (%) above which `/ks-batch` runs one story at a time — unless the reset is within `Budget boost window` |
| Budget hold at | session usage (%) at which `/ks-batch` starts nothing new: running phases finish, the batch resumes after the reset |
| Budget weekly hold at | weekly usage (%) at which `/ks-batch` starts nothing new |
| Budget boost window | minutes before the session reset during which unused budget is spent: up to `Max parallel` lanes |
| Exclusive paths | comma-separated paths or globs; a story whose footprint touches one executes alone (shared contract, schema, lockfile) |
| Union paths | paths whose conflicts are merged by hand and never serialize stories (docs, agent notes, the method's own files) |
| Worktree ports | `VAR=base` pairs; each worktree gets `base + slot`, and the URLs that point at `base` follow. `—` when the project runs no local service |

## Project commands

```
Package manager:   —
Test:              —
Typecheck:         —
E2E:               —
Build:             —
```

A command left at `—` is one the agents cannot run: they say so rather than guess one.

## Project conventions

<< structure, stack, patterns, naming, commit rules — filled by /ks-architect >>
