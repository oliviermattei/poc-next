# AGENTS.md

A modular SaaS boilerplate that a project owner turns into their own product: Next 16,
pnpm workspaces and Turborepo, PostgreSQL. Use the vocabulary of `GLOSSARY.md` — project
owner, client, Guide, product documentation — in code, tests, issues and docs.

## Read in this order

1. `GLOSSARY.md` — the words the project uses, and the ones it avoids.
2. `docs/prd.md` — what the product is and why, and its **graveyard**: what it deliberately does not build. The graveyard is binding: reintroducing anything it lists is a scope breach, not an improvement.
3. `docs/architecture.md` — stack, layout, module contract.
4. `docs/adr/` — one ADR per structural decision, with the options rejected and why.
5. The `AGENTS.md` of the package you are editing — what it may import, what it must never contain, where its tests live.

When a document disagrees with the code, the code is the bug — unless an ADR says otherwise.

## Where things are

`apps/web` (Next, mounts the API) · `config/` (what the project owner edits) · `packages/core` (module contract and registry) · `packages/db` · `packages/api` · `packages/ui` · `packages/ports` + `packages/adapters` (one implementation each) · `packages/modules/*` (one module per feature, generated with `pnpm ks`) · `packages/cli` (the `ks` module CLI) · `tooling/` · `docs/` · `Dockerfile` + `docker-compose.prod.yml` (production image and stack).

## Rules

- **`CODING_STANDARDS.md`** — read before writing code: stack, modules and their four layers, ports, rules that bite, testing, agent-oriented repo. `/code-review` judges every change against it.
- **`docs/commands.md`** — read before running or adding a `pnpm` script: what each one checks and what makes it fail.
- **`docs/security.md` and `docs/reliability.md`** — the security and reliability baselines. A breach of either blocks the merge, exactly like a functional regression.
- **`docs/design-system.md`** — read before any UI change: components and tokens come from it, and a need it does not cover is a gap to report.
- **`docs/deployment.md`** — read before touching the production image, startup or migrations.

## Agent skills

### Issue tracker

Issues et specs sur GitHub Issues (`oliviermattei/poc-next`), via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Les cinq rôles par défaut, chaque étiquette égale à son nom. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context : `GLOSSARY.md` et `docs/adr/` à la racine ; règles par paquet dans `packages/*/AGENTS.md`. See `docs/agents/domain.md`.
