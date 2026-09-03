# killer-saas — Repo rules

## Start here (agents)

You are in a **SaaS boilerplate** built by the killer-saas pipeline. Before touching anything, know these five things:

1. **Nothing is coded outside the pipeline.** A feature needs a validated plan in `docs/plans/<story-id>.md` before a line is written, and a passed review before it ships. The only exception is an explicitly announced Quick Fix.
2. **Read in this order**: `docs/prd.md` (what and why, plus the graveyard of what we deliberately do NOT build) → `docs/stories.md` (every story and its acceptance criteria — the file is the count, never a number written here) → `docs/architecture.md` (stack, layout, module contract) → `docs/decisions/` (one ADR per structural decision, each with the options rejected and why).
3. **The three baselines below are not optional** and are checked in review: security (`docs/security.md`), reliability (`docs/reliability.md`), agent-oriented repo. A breach ranks with a functional regression.
4. **A module is the unit of composition.** It declares one typed contract and lives in `packages/modules/<name>` with four layers. Never scaffold one by hand — generate it (`npx ks`, or the MCP server). Never add a feature outside a module.
5. **The graveyard is binding.** `eject`, an in-app AI module, non-Stripe payment providers, usage-based billing, realtime notifications, an audit-log table, customer API keys, multi-ORM — all deliberately excluded in `docs/prd.md`. Re-introducing one is a scope breach, not an improvement.

Where things are: `apps/web` (Next, mounts the API) · `config/` (what the project owner edits) · `packages/core` (module contract and registry) · `packages/db` · `packages/api` · `packages/ui` · `packages/ports` + `packages/adapters` (one implementation each) · `packages/modules/*` · `tooling/` · `docs/`.

When a rule and this file disagree with the code, the code is the bug — unless an ADR says otherwise. When you need a rule that does not exist, ask: *which command fails if someone breaks it?* If there is no answer, it is documentation, not a rule.


## Absolute rule
No direct coding. Every feature goes through the killer-saas pipeline, in order:

PRD → User Stories → Architecture (+ Design System) → then, per story: Research → Design → Plan → Execute → Review → Ship

No code is written before the story has a validated plan (`/ks-plan`). No feature ships before a passed review (`/ks-review`).

### Quick Fix mode — exception to the pipeline

`Quick Fix` is the explicit exception for a small, local, well-understood, and
easily reversible adjustment. It applies only when the user explicitly requests
a Quick Fix. The primary agent implements it directly, without the full
killer-saas pipeline and without mandatory TDD. It must not delegate
implementation to a subagent; a subagent may be used only for read-only
investigation or optional review.

Typical Quick Fixes include:

- changing a color, spacing, radius, font size, or button style;
- correcting short UI copy or a translation;
- making a small layout alignment or responsive adjustment;
- restoring or adjusting an already-existing presentation affordance;
- another similarly narrow change with no architectural or business impact.

Quick Fix mode does **not** apply to a new feature, shared-component redesign,
data model or migration, API or contract change, authorization, security,
business rules, persistence, cross-cutting refactor, dependency change, or any
change whose impact is uncertain. If the requested Quick Fix is too large or
investigation reveals one of these, the primary agent must stop Quick Fix mode,
recommend using the normal pipeline, and must not continue coding until the work
has passed the appropriate pipeline stages.

The primary agent must announce Quick Fix mode and its exact scope before
editing, keep the diff minimal, preserve existing abstractions, and perform a
proportionate verification (at minimum a focused lint, typecheck, existing test,
or visual browser check when applicable). TDD and subagent review are optional,
not forbidden.

Quick Fix work happens only in the repository's base directory on branch
`dev`. It never gets a feature branch or a worktree. Before editing, check the
current branch. If it is not `dev`, stop and ask the user whether they really
want to continue on that non-`dev` branch; never switch branches automatically.
Before editing, verify that no other agent owns the base directory. If another
agent is working there, coordinate ownership or stop; never overlap edits.

## Pipeline (commands)
- `/ks-prd`        frames the kill: target SaaS, kill mode, perimeter (WHAT + WHY)
- `/ks-stories`    breaks it down into shippable user stories
- `/ks-stories-review`  reviews the breakdown against the PRD perimeter (stories-reviewer subagent)
- `/ks-architect`  sets the technical HOW + the conventions
- `/ks-design-system`  captures the global design system (docs/design-system.md)
- `/ks-research`   explores the story's real context (current code, APIs, traps)
- `/ks-design`     derives a story's screen from the design system (UI stories)
- `/ks-plan`       breaks a story into sequenced tasks
- `/ks-execute`    implements the story in TDD (implementer subagent)
- `/ks-review`     anti-hallucination review + gate (reviewer subagent)
- `/ks-ship`       opens the PR; merge/deploy per the ship strategy (manual by default)

Utilities:
- `/ks-orchestrator`  runs a story's full cycle with human checkpoints (plan validation, ship confirmation)
- `/ks-help`          prints the pipeline map (French, user-facing cheat sheet)
- `/ks-status`        derives the project's pipeline state from the files (framing, per-story progress, next command)

One feature = one Research → Design → Plan → Execute → Review → Ship cycle = one branch = one PR (Design only when the story has UI).

## Where work happens

There are exactly two modes. A complexity score never chooses the directory:

| Mode | Working directory | Branch |
| --- | --- | --- |
| Explicit Quick Fix | Repository base directory | `dev`; if another branch is checked out, stop and ask before continuing |
| Feature / story | Dedicated `.worktrees/<story-id>/` worktree | Exact `feature/<story-id>` branch |

Every change that is not explicitly announced and eligible as a Quick Fix is a
feature. A feature uses its dedicated worktree from Research through Design,
Plan, Execute, Review and Ship, regardless of its complexity score. Never
create or check out a feature branch in the repository base directory.

The `worktree-manager` subagent creates or verifies the worktree before
Research begins. It imports untracked `.env*` files and installs dependencies
inside the worktree. Before every later story phase, resolve and state the
absolute worktree path and verify the exact branch. Missing worktree, wrong
branch, detached HEAD or a second branch name is a hard stop. Never improvise
with `git switch`, `git checkout`, `git stash` or an `-isolated` suffix.

One agent, one working directory. While an agent owns a directory, no second
agent and no main context may edit, checkout or stash in it.

## Story ids and branches
- Every story has an id: `s<number>-<short-slug>` (e.g. `s01-submit-testimonial`). It is assigned in docs/stories.md and reused verbatim everywhere: `docs/research/<id>.md`, `docs/plans/<id>.md`, `docs/reviews/<id>.md`, branch `feature/<id>`.
- All work on a story happens on `feature/<id>`, branched from the default branch. Never commit story work to the default branch.
- The story diff = `git diff <default-branch>...feature/<id>`. That is what the review judges.
- A command that receives a fuzzy story name resolves it against docs/stories.md; if there is no unambiguous match, it lists the available stories and stops.

## Gate (mechanical)
- The review report `docs/reviews/<id>.md` must end with the exact lines `Max severity: <critical|major|minor|none>` and `Ship allowed: <yes|no>`. A single critical = no.
- `/ks-ship` refuses to run unless that file exists and contains the line `Ship allowed: yes`. No file, no line, or `no` → ship blocked. No exceptions.
- After a blocked review, `/ks-execute` runs in fix mode: the review findings are fed to the implementer and fixed before anything else.
- A plan executes only if its frontmatter says `validated: yes` — set by the human validation checkpoint (/ks-plan or the orchestrator), never by the file merely existing. /ks-execute is fail-closed on it.

## Ship strategy
Merge mode: auto   (manual | auto — default: manual)
- manual: /ks-ship opens the PR and stops. Merging is a human decision (review on GitHub, protected branch, CI). After the merge, rerun /ks-ship to confirm the deployment and clean up the branch.
- auto: /ks-ship merges and deploys immediately after the gate. Only for solo flows where running /ks-ship IS the decision.

## Design
The global design system lives in `docs/design-system.md` (components + tokens, anchored to the boilerplate). Each story's design lives in `docs/designs/<id>.md` (+ a reference `.html` mockup).
- A story's design can be generated by the agent or produced in Claude Design / Gemini and brought back. Either way it builds on the design system.
- Inventing a component or token outside the design system is forbidden. Compose with what exists.
- The HTML mockup is a reference, not code: the implementation uses the boilerplate's real components.
- A need the system doesn't cover = a "design system gap" to report, never to fill freestyle.
- Stories without UI skip `/ks-design`.

## Data & docs lifecycle
All pipeline data lives in markdown files under docs/, versioned by git. No database, no state file: the pipeline state is derived from the files (a story is planned if docs/plans/<id>.md exists, shipped if its review says `Ship allowed: yes` and the branch is merged) — a derived state can't go stale.

- Framing docs — docs/prd.md, docs/stories.md, docs/reviews/stories.md, docs/architecture.md, docs/design-system.md: committed on the default branch at the end of their phase. (docs/reviews/stories.md reviews the breakdown, not a story: it is a framing doc, unlike docs/reviews/<id>.md which travels with its branch.)
- Story docs — docs/research/<id>.md, docs/designs/<id>* (brief, md, html), docs/plans/<id>.md, docs/reviews/<id>.md: committed on feature/<id>. The implementer's single story commit brings the research, the design and the plan; /ks-ship commits the review. Every PR carries its own research, design, plan and review.
- Task progress — the checkboxes in docs/plans/<id>.md: the implementer ticks each task as it lands, and they travel in the story's commit. The plan file is the live progress tracker, never a commit trigger.
- Commits — **one commit per story**, not one per plan task. A second commit only for something you would want to revert on its own (typically a migration). The branch's commits are squashed at merge, so the default branch gets one commit per story.
- Decisions — docs/decisions/NNN-<slug>.md (MADR format, @templates/adr.md): one file per structural decision, with the considered options and why they were rejected. Immutable: a change means a new ADR superseding the old one. Framing decisions commit on the default branch; story decisions travel with feature/<id>.

## Technical conventions

Full detail in `docs/architecture.md`; each structural decision has an ADR in `docs/decisions/`.

**Stack** — always the latest stable majors (ADR 010): Next 16, React 19, Tailwind v4 (CSS-first config, no `tailwind.config.js`), TypeScript 5.9+ strict, pnpm 10+, Node 20.10+. shadcn/ui on **Radix UI**, copied into `packages/ui` (ADR 022 — Base UI has never shipped a stable release), Turborepo + pnpm, PostgreSQL 16+ with Drizzle, Better Auth, Hono mounted in Next with oRPC contracts, Vitest + Playwright, GitHub Actions.

**Repo layout** — `apps/web` (Next, mounts the Hono server at `app/api/[[...route]]`), `config/` (features, billing, gating, marketing — edited by the project owner), `packages/core` (module contract and registry), `packages/db`, `packages/api`, `packages/ui`, `packages/ports`, `packages/adapters`, `packages/modules/<module>`, `tooling/`.

**A module is a package** declaring one typed contract: `id`, `requires`, `schema`, `migrations`, `routes` (**each with its protection level**: public, authenticated, role-gated, entitlement-gated — reserved for a paid offer, ADR 043), `navigation` (same), `messages`, `emails` (with their locales), `webhooks`, `jobs` (scheduled tasks, id + cron schedule), `dataCategories`, `retention` (one policy per declared category), `purge`, `export`. Every key is mandatory from the first module, empty if need be — adding one later means reopening every module already written.

**Four layers inside each module**: `domain/` (pure business rules, no framework, no ORM, no SDK) → `application/` (use cases and ports) → `infrastructure/` (Drizzle repositories, adapter calls) and `presentation/` (Hono routes, oRPC contracts, React components). `infrastructure` and `presentation` never import each other. **The boundary rule is enforced by lint in CI, not by review.**

**A module with components exposes them through a second entry point** — `@repo/module-<name>/presentation` (ADR 024). The main barrel carries the contract, `domain` and `application`, and **never re-exports a `.tsx`**: `config/features.ts` is read by `pnpm db:generate`, `pnpm ks` and the `@repo/db` typecheck, none of which compile JSX. Break it and `pnpm typecheck` fails with `error TS6142 … '--jsx' is not set` — on `@repo/db`, not on the module.

**A disabled module leaves no trace**: no route (404), no navigation entry, no migration applied on a fresh database. A module enabled then disabled keeps its tables and data — deleting them would be `eject`, which is in the PRD graveyard. No cleanup command exists; never introduce one.

**A port never throws** — it returns a discriminated result (`{ok:true,…} | {ok:false,error}`), so the compiler forces the caller to handle failure instead of defaulting to a 500. Shape set in s06, binding for storage, payments, jobs, analytics and monitoring. Test doubles replace the **network**, never the SDK.

**One implementation per port.** Mail Resend, storage S3/R2, payments Stripe, jobs Inngest, errors Sentry, analytics PostHog, rate limiting PostgreSQL. Test doubles are tools, not providers: they never justify a second adapter. Every port must be usable locally with no provider key — through an **explicit** local mode, never inferred from `NODE_ENV`. Explicit means the developer opts in (e.g. `EMAIL_LOCAL_CAPTURE=1`) and a process with neither a key nor the flag refuses to start, naming the variable. A port that silently falls back to a local stand-in cannot tell a real send from a captured one, in production included.

**Naming** — files `kebab-case`, types and components `PascalCase`, functions and variables `camelCase`, tables and columns `snake_case`.

**Rules that bite** — every `<form>` declares `method` as a written literal (a React form without it falls back to a browser GET before hydration and puts secrets in the URL — measured in s08); Zod at every boundary (env, routes, webhooks, config); no direct `process.env` outside the config module; `drizzle-kit generate` only, never `push` in production; migrations backward-compatible with the version still online; a foreign key toward another module only if that module is a declared `requires` (ADR 018); 404 rather than 403 on another organization's resource; identical error message for unknown account and wrong password; permissions checked server-side.

**Third-party integrations, two regimes, never mixed** — in CI: recording doubles for outbound calls, replay of recorded webhook events for inbound ones, both blocking. Outside CI, on an explicit command: real test keys, run before every ship.

**Commits** — one commit per story, imperative message in French, carrying that story's research, design and plan.

## Commands

Le harnais de qualité (s02). Chacune de ces commandes est exécutée par la CI, et
chacune échoue pour une raison précise — une règle qu'aucune commande ne vérifie
est de la documentation, pas une règle.

| Commande | Ce qu'elle vérifie | Ce qui la fait échouer |
|---|---|---|
| `pnpm dev` | l'application démarre | une variable d'environnement absente ou malformée, nommée |
| `pnpm build` | l'application compile | une erreur de compilation ; le build n'a pas besoin des variables d'exécution |
| `pnpm typecheck` | racine, `tests/` **et** chaque package | une erreur de type, y compris dans un test |
| `pnpm lint` | règles ESLint, frontières de couches (ADR 006), surface client de `@repo/config` | un import qui traverse une couche interdite, une règle de style |
| `pnpm lint:fix` | idem, en réparant ce qui est réparable | rien : c'est la commande de correction |
| `pnpm test` | tests unitaires et de câblage (Vitest) | une régression de comportement |
| `pnpm test:e2e` | parcours navigateur (Playwright) | l'application ne démarre pas, ou ne sert pas la page |
| `pnpm clean` | vide les artefacts régénérables : cache Turbo, `.next`, `dist`, rapports de test | rien : c'est la commande de nettoyage. Turbo ne purge jamais son cache tout seul — laissé libre il atteint plusieurs dizaines de Go et sature le disque, ce qui fait échouer *toutes* les autres commandes |
| `pnpm run audit` | vulnérabilités au seuil « élevé », exceptions datées de `.audit-exceptions.json` | une vulnérabilité non exceptée, ou une exception sans date d'expiration. **`pnpm run`** est obligatoire : `pnpm audit` seul appelle la commande interne de pnpm, qui ignore les exceptions |
| `pnpm db:generate` | génère les migrations SQL depuis le schéma | jamais `push` : la génération est la seule voie |
| `pnpm db:migrate` | applique les migrations, deux fois de suite sans effet supplémentaire | une migration en échec |
| `pnpm db:seed` | données de développement, rejouables | un seed non idempotent |
| `pnpm billing:reconcile` | réconcilie l'état d'abonnement avec le fournisseur de paiement, et le rejeu ne réécrit rien (`docs/reliability.md` §5) | une lecture du fournisseur en échec — la commande **n'efface jamais** : un silence du tiers ne doit pas couper un client qui paie. Module `billing` coupé, elle le dit et sort |
| `pnpm ks` | le CLI de modules : `list` et `toggle` (aussi `npx ks`) | un module inconnu, un requis manquant, un dépendant encore activé, ou une régénération en échec — la configuration est alors restaurée |

Le scan de secrets n'a pas de script npm : il tourne en CI par l'action
officielle (le paquet npm `gitleaks` est un homonyme qui ne scanne rien), et en
local par `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest git /repo`.

Deux emplacements de test, et deux seulement : `tests/` à la racine pour ce qui
traverse les packages, `src/**/*.test.ts` dans un package pour ce qui lui
appartient. Les parcours Playwright vivent dans `e2e/`.

## Security baseline (non-negotiable)

Full reference: `docs/security.md` (ADR 012). It applies to **every** story, not to a security story. A breach of it is a **critical** review finding, ranked with a functional regression.

Every control there names the command that fails when it is violated. Do not add a control nobody can check, and do not weaken one to make something work:

- **CSP** `default-src 'self'`, no `unsafe-inline`, no `unsafe-eval` in production; nonce per request. Adding a source requires a written justification in the story.
- **Cookies** `HttpOnly`, `Secure`, `SameSite`; session id rotated on every privilege elevation; revocation enforced server-side.
- **Authorization** checked server-side; another organization's resource returns **404**, never 403; unknown account and wrong password are indistinguishable, in message and in timing.
- **Zod at every boundary** — env, route params, body, webhooks, config. Parameterized queries only.
- **Webhooks**: signature verified before any side effect, idempotent by event id.
- **Secrets** never in the repo, in a build artifact, in a log, in an error response or in telemetry. Env validated at startup, naming the faulty variable.
- **Supply chain**: lockfile committed, `--frozen-lockfile` in CI, vulnerability audit and secret scan blocking.
- **Rate limiting** on every public entry point, shared across instances; anti-automation on public forms.

A story's plan names the sections of `docs/security.md` it touches. The review mutates the code and checks the test goes red — it does not take conformity on trust.

## Reliability baseline (non-negotiable)

Full reference: `docs/reliability.md` (ADR 014). Same standing as the security baseline; a breach is a **critical** review finding.

- **Anything triggered from outside is replayable with no extra effect** — webhooks (logged by event id), jobs, migrations, seed. "Idempotent" is proven by running it twice and observing one effect, never asserted in a comment.
- **A missing third party degrades, it does not break.** No analytics → the app runs. No jobs → purge and export run synchronously. Every port works locally with no API key.
- **Every outbound call has an explicit timeout.** Retries use exponential backoff with jitter and a cap; transient errors only — retrying a validation error is a defect.
- **Migrations are backward-compatible with the version still serving traffic**: add before reading, stop writing before dropping. Never destructive outside an explicit eject, which is in the graveyard.
- **The health probe checks the real dependency**, and any state that can diverge from an external system has a reconciliation command.

## Agent-oriented repo

This codebase is mostly edited by agents (ADR 013). An agent that cannot find the rule invents one, so rules live where the code is written and are backed by a command:

- **`AGENTS.md` per package**, on top of this root file: what the package may import, what it must never contain, where its tests live. A test checks every package has one.
- **Never claim exhaustiveness.** A measured list says *what was swept*, never *what exists*. This repo has been caught three times: a package `AGENTS.md` calling three known cases "the only ones", a review's own finding list missing a fourth position, a measurement table omitting a case that works. The next agent reads such a claim as verified and stops looking. Write "found so far, over these N cases", and name the cases.
- **A green mutation means the test is wrong, not that the code is right.** When you neutralise an invariant and nothing goes red, fix the test — that has happened five times here, and each time the production code was fine while its net was narrower than its name.
- **A rule must be executable.** Layer boundaries → lint. Required modules → config validation. Environment wiring → test. Ask of any new rule: *which command fails if I break it?* If none, it is documentation, not a rule.
- **Generate, don't guess.** `npx ks` (s05) and the MCP server (s41) expose the same operations — list modules, toggle one, scaffold a compliant module. Producing a module skeleton by hand is a smell.
- **Docs ship with the code that changes them.** A story that alters a convention and leaves its rule stale is incomplete.

## Definition of Done (per feature)
- Single PR, structured description, readable diff
- Passing tests on business logic
- No regression on existing code
- Review passed (no open critical issue)
- Deployed to production
