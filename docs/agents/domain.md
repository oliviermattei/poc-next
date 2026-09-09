# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase.

Layout: **single-context**. One `CONTEXT.md` at the repo root, one ADR directory
at `docs/decisions/`. There is no `CONTEXT-MAP.md` and none is expected: the repo
is a pnpm workspace, but its per-package rules live in each `packages/*/AGENTS.md`,
not in per-context `CONTEXT.md` files.

## Before exploring, read these

- **`AGENTS.md`** at the repo root — the binding repo rules (pipeline, stack,
  security and reliability baselines, commands). It is the first read, always.
- **`CONTEXT.md`** at the repo root, if it exists: the domain glossary.
- **`docs/decisions/`**: read the ADRs that touch the area you're about to work
  in. **This repo's ADRs are here, not in `docs/adr/`.** Format MADR, one file
  per structural decision, named `NNN-<slug>.md`, template `templates/adr.md`.
- **`packages/<name>/AGENTS.md`** for the package you are about to touch: what it
  may import, what it must never contain, where its tests live.

If `CONTEXT.md` doesn't exist, **proceed silently**. Don't flag its absence;
don't suggest creating it upfront. The `/domain-modeling` skill (reached via
`/grill-with-docs` and `/improve-codebase-architecture`) creates it lazily when
terms actually get resolved.

`docs/decisions/` is never "missing": it is populated and versioned.

## File structure

```
/
├── AGENTS.md              ← binding repo rules (CLAUDE.md is a pointer to it)
├── CONTEXT.md             ← domain glossary (created lazily)
├── templates/adr.md       ← MADR template
├── docs/
│   ├── prd.md  stories.md  architecture.md  security.md  reliability.md
│   └── decisions/         ← ADRs, NNN-<slug>.md
└── packages/<name>/AGENTS.md
```

## Writing an ADR here

ADRs in this repo are **immutable**: changing a decision means writing a new ADR
that supersedes the old one, never editing the old file. Each ADR carries the
options considered and why they were rejected. Framing decisions commit on the
default branch; a story's decisions travel with `feature/<id>`.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal,
a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift
to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're
inventing language the project doesn't use (reconsider) or there's a real gap
(note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than
silently overriding:

> _Contradicts ADR 018 (foreign keys only toward a declared `requires`), but
> worth reopening because…_

Two conflicts deserve a hard stop rather than a note, because `AGENTS.md` ranks
them with a functional regression: a breach of `docs/security.md` or of
`docs/reliability.md`. And reintroducing anything from the PRD graveyard
(`eject`, an in-app AI module, non-Stripe payments, usage-based billing,
realtime notifications, an audit-log table, customer API keys, multi-ORM) is a
scope breach, not an improvement.
