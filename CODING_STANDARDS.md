# Coding standards

The judgement rules of this repo: what a reviewer, human or `/code-review`, holds a change
to. What a command already enforces lives in the lint, the type check and the tests; this
file carries the rest, and the reason behind the rules those commands enforce. Full detail
in `docs/architecture.md`; each structural decision has an ADR in `docs/adr/`, cited as
"ADR 069".

## Technical conventions

**Stack** — always the latest stable majors (ADR 010): Next 16, React 19, Tailwind v4 (CSS-first config, no `tailwind.config.js`), TypeScript 5.9+ strict, pnpm 10+, Node 20.10+. shadcn/ui on **Radix UI**, copied into `packages/ui` (ADR 022 — Base UI has never shipped a stable release), Turborepo + pnpm, PostgreSQL 16+ with Drizzle, Better Auth, **module routes dispatched by `dispatchModuleRequest` from `@repo/core`** — ADR 005 chose Hono with oRPC contracts and ADR 017 called `ModuleRoute` a transitional form, but **neither ever shipped**: measured on this tree, zero `@orpc/*` imports, zero `hono` imports, zero declared dependency on either. Write `ModuleRoute` + Zod, never oRPC, Vitest + Playwright, GitHub Actions.

**Zones and routes of `apps/web`** — `config/` holds features, billing, gating and marketing, edited by the project owner. `apps/web` mounts the module dispatcher at `app/api/[[...route]]`, and:

- its screens are grouped by zone in four route folders — `(site)`, `(auth)`, `(app)`, `(console)` — which never appear in a URL (ADR 071), each rendering its own template (s61);
- `/` always serves the public site and `/app` is the application's dashboard, the default destination after any sign-in (`DEFAULT_SIGNED_IN_PATH`);
- **every application screen lives under `/app`** — dashboard, settings, notification center, onboarding, premium feature (s63) — and `tests/zones.test.ts` fails on a `(app)` page outside `app/` or on a protected module navigation entry (outside console and API) pointing elsewhere;
- the site header renders the navigation surface `site` (home, blog, docs, pricing) plus one template button written by hand (ADR 073) — the only hand-written entry found so far in the site header; the brand links and the AppShell account menu are also hand-written links, and no command enforces the count;
- the superadmin back-office is the **console**, served under `/console`; its navigation surface is `console`, and it answers 404 to anyone who is not a superadmin, anonymous included (ADR 070);
- account, organization and billing live in the **settings zone** `/app/settings/*`, whose sub-navigation renders the surface `settings` — the application sidebar renders `app` only, the product's own pages (s62a);
- a moved screen's old path answers **308** through the single table `apps/web/lib/legacy-paths.ts`, read by `apps/web/proxy.ts` on the internal path, never `redirects()` in `next.config.ts` (ADR 075); each row names the module serving its screen and redirects only when that module is enabled (ADR 077).

**A module is the unit of composition.** Every feature lives in a module, a package under `packages/modules/<name>` declaring one typed contract: `id`, `requires`, `schema`, `migrations`, `routes` (**each with its protection level**: public, authenticated, role-gated, entitlement-gated — reserved for a paid offer, ADR 043), `navigation` (same), `messages`, `emails` (with their locales), `webhooks`, `jobs` (scheduled tasks, id + cron schedule), `dataCategories`, `retention` (one policy per declared category), `purge`, `export`. Every key is mandatory from the first module, empty if need be — adding one later means reopening every module already written. **One key is optional, and that is a decision with an ADR**: `seeds` (s58, demonstration data, **ADR 069**), added the way `NavigationEntry.surface` was (ADR 066/067) — the registry derives it for the modules that declare it, and the fifteen that do not were not reopened. ADR 069 carries the criterion, not the precedent: a key is mandatory when omitting it leaves a defect with no owner (unpurged data, an unprotected route, uncrawled content); it may be optional when omitting it leaves only silence.

**Four layers inside each module**: `domain/` (pure business rules, no framework, no ORM, no SDK) → `application/` (use cases and ports) → `infrastructure/` (Drizzle repositories, adapter calls) and `presentation/` (`ModuleRoute` declarations, React components). `infrastructure` and `presentation` never import each other. **The boundary rule is enforced by lint in CI, not by review.**

**A module with components exposes them through a second entry point** — `@repo/module-<name>/presentation` (ADR 024). The main barrel carries the contract, `domain` and `application`, and **never re-exports a `.tsx`**: `config/features.ts` is read by `pnpm db:generate`, `pnpm ks` and the `@repo/db` typecheck, none of which compile JSX. Break it and `pnpm typecheck` fails with `error TS6142 … '--jsx' is not set` — on `@repo/db`, not on the module.

**A disabled module leaves no trace**: no route (404), no navigation entry, no migration applied on a fresh database. A module enabled then disabled keeps its tables and data — deleting them would be `eject`, which is in the PRD graveyard. No cleanup command exists; never introduce one.

**A port never throws** — it returns a discriminated result (`{ok:true,…} | {ok:false,error}`), so the compiler forces the caller to handle failure instead of defaulting to a 500. Shape set in s06, binding for storage, payments, jobs, analytics and monitoring. Test doubles replace the **network**, never the SDK.

**One implementation per port.** Mail Resend, storage S3/R2, payments Stripe, rate limiting PostgreSQL (s28, ADR 050 — the fourth port; its store is the app's own database, so an unavailable store **refuses** instead of degrading, and it has no keyless local mode because it has no key), jobs Inngest (s33, ADR 059 — the fifth port, and the only one whose surface is **split in two**: the port carries emission, the module contract's `jobs` key carries declaration, and `dispatchModuleJob` in `@repo/core` joins them. Its `ok:true` means "queued", never "done". The execution rule lives in the **core**, not in the optional `jobs` module, because it must answer when that module is cut — that is what makes the synchronous fallback possible), analytics PostHog and errors Sentry (s39, the **sixth and seventh** ports, shipped together and **both degrading**: `docs/reliability.md` §2, "no analytics → the app runs". With them the general rule is a majority among ports again, and `rate-limit` remains its only exception. "No key" is a **value** there — `not_configured` — never a silent `ok: true`, and the criterion is measured on **outbound calls**: with no key, none is emitted. Sensitive-field redaction lives **inside each adapter**, at the last point before the network, because a rule placed higher up is bypassable by whoever holds the adapter. The browser half is **not** the provider's loader: it is a script served by the module's own public route, carrying `posthog.init(key, …)` — the s39 review measured a declared loader that initialised nothing, hence measured nothing). Test doubles are tools, not providers: they never justify a second adapter.

**Every port is usable locally with no provider key** — through an **explicit** local mode, never inferred from `NODE_ENV`. Explicit means the developer opts in (e.g. `EMAIL_LOCAL_CAPTURE=1`) and a process with neither a key nor the flag refuses to start, naming the variable. A port that silently falls back to a local stand-in cannot tell a real send from a captured one, in production included.

**Naming** — files `kebab-case`, types and components `PascalCase`, functions and variables `camelCase`, tables and columns `snake_case`.

**Deployment** — `docs/deployment.md`. Two facts bind the rest of the repo: the app has **two startup points** — `next.config.ts` and `apps/web/instrumentation.ts` — both calling the single guard `apps/web/lib/startup.ts`, because `output: 'standalone'` serialises the Next config into `server.js` and stops executing `next.config.ts` at server start; and **the runtime stage never inherits the build stage's permissiveness** — the validation escape hatch (`NEXT_PHASE`, `SKIP_ENV_VALIDATION`) is carried by the build command, never by an `ENV` of a stage, or the image boots in production without checking its configuration. Migrations run in their own container before traffic switches; a failed one keeps the app from starting.

**Rules that bite** — every `<form>` declares `method` as a written literal (a React form without it falls back to a browser GET before hydration and puts secrets in the URL — measured in s08); Zod at every boundary (env, routes, webhooks, config); no direct `process.env` outside the config module; `drizzle-kit generate` only, never `push` in production; migrations backward-compatible with the version still online; a foreign key toward another module only if that module is a declared `requires` (ADR 018); 404 rather than 403 on another organization's resource; identical error message for unknown account and wrong password; permissions checked server-side.

**Third-party integrations, two regimes, never mixed** — in CI: recording doubles for outbound calls, replay of recorded webhook events for inbound ones, both blocking. Outside CI, on an explicit command: real test keys, run before every merge to `dev`.

**Commits** — imperative message in French. Work reaches `dev` through a pull request, squash-merged.

## Security baseline

Authority: `docs/security.md` (ADR 012). It applies to **every** change, not only to a security one. Every control there names the command that fails when it is violated. Do not add a control nobody can check, and do not weaken one to make something work:

- **CSP** `default-src 'self'`, no `unsafe-inline`, no `unsafe-eval` in production; nonce per request. Adding a source requires a written justification in the pull request.
- **Cookies** `HttpOnly`, `Secure`, `SameSite`; session id rotated on every privilege elevation; revocation enforced server-side.
- **Authorization** checked server-side; another organization's resource returns **404**, never 403; unknown account and wrong password are indistinguishable, in message and in timing.
- **Zod at every boundary** — env, route params, body, webhooks, config. Parameterized queries only.
- **Webhooks**: signature verified before any side effect, idempotent by event id.
- **Secrets** never in the repo, in a build artifact, in a log, in an error response or in telemetry. Env validated at startup, naming the faulty variable.
- **Supply chain**: lockfile committed, `--frozen-lockfile` in CI, vulnerability audit and secret scan blocking.
- **Rate limiting** on every public entry point **served by the module dispatcher**, shared across instances — applied by `dispatchModuleRequest`, **derived from the registry** (every `public` route, plus every route declaring a `rateLimit`), **fail-closed**, and neutralisable **by injection only**: no environment variable turns it off, and a zero threshold is refused at startup rather than read as "no limit". **What "every public entry point" means here**: every route *served by the module dispatcher*. Five Next route files sit outside it (`find apps/web/app/api -name route.ts`, minus the dispatcher itself) and are **not** limited: `/api/health` (a liveness probe a limiter could refuse would report an outage it caused itself), `/api/csp-report` (a browser-driven report sink), and three that answer 404 in production — `/api/i18n-probe`, `/api/consent-probe/[script]`, `/api/billing-local-checkout`. A test asserts that count, so a sixth forces the decision instead of inheriting silence. Anti-automation on public forms; the captcha is declared and guarded but **no provider ships**.

A change names the sections of `docs/security.md` it touches. Its review neutralises the control and checks the test goes red — it does not take conformity on trust.

## Reliability baseline

Authority: `docs/reliability.md` (ADR 014).

- **Anything triggered from outside is replayable with no extra effect** — webhooks (logged by event id), jobs, migrations, seed. "Idempotent" is proven by running it twice and observing one effect, never asserted in a comment.
- **A missing third party degrades, it does not break.** No analytics → the app runs. No jobs → purge and export run synchronously. Every port works locally with no API key.
- **Every outbound call has an explicit timeout.** Retries use exponential backoff with jitter and a cap; transient errors only — retrying a validation error is a defect.
- **Migrations are backward-compatible with the version still serving traffic**: add before reading, stop writing before dropping. Never destructive outside an explicit eject, which is in the graveyard.
- **The health probe checks the real dependency**, and any state that can diverge from an external system has a reconciliation command.

## Agent-oriented repo

This codebase is mostly edited by agents (ADR 013). An agent that cannot find the rule invents one, so rules live where the code is written and are backed by a command:

- **`AGENTS.md` per package**, on top of the root one: what the package may import, what it must never contain, where its tests live. A test checks every package has one.
- **Never claim exhaustiveness.** A measured list says *what was swept*, never *what exists*. This repo has been caught three times: a package `AGENTS.md` calling three known cases "the only ones", a review's own finding list missing a fourth position, a measurement table omitting a case that works. The next agent reads such a claim as verified and stops looking. Write "found so far, over these N cases", and name the cases.
- **A rule must be executable.** Layer boundaries → lint. Required modules → config validation. Environment wiring → test. Ask of any new rule: *which command fails if I break it?* If none, it is documentation, not a rule.
- **Derive, never copy.** A list, a count or a path written next to the code that defines it goes stale in silence; a test reads it from the source — `package.json`, the workspace, the registry, the disk — and fails when the two drift.
- **Generate, don't guess.** `npx ks` (s05) and the MCP server (s41) expose the same operations — list modules, toggle one, scaffold a compliant module. Producing a module skeleton by hand is a smell.
- **Docs ship with the code that changes them.** A change that alters a convention and leaves its rule stale is incomplete.

## Testing

**A test that stays green when the rule it names is deleted is worse than no test** — it hides the hole it claims to cover. Volume is not a net: a suite that takes half an hour is a suite nobody runs.

**Prove a test by neutralisation**: delete or invert the rule it names, watch the test go red, restore. **A green mutation means the test is wrong, not that the code is right** — fix the test. It has happened repeatedly here, and each time the production code was fine while its net was narrower than its name. The count is not written here on purpose: it said five when it was seven, and seven when it was eight.

**Shapes of a test that names an invariant without exercising it**, seen repeatedly and hard to spot by reading:

1. a hand-written query in the test instead of a call to the code under test — it tests the database, not the repository;
2. a payload the real interface never produces;
3. a `catch` that swallows the failure, so the assertion passes when nothing throws;
4. an end-to-end test that stays green while rendering zero rows;
5. a fixture whose identifier lets a downstream guard answer for the guard under test;
6. a mock double that replays the clause instead of evaluating it;
7. a sweep over a derived list that finds nothing — every derived list gets a floor or a cross-check, so an empty sweep goes red.

**Where tests go.** Two locations, and two only: `tests/` at the root for what crosses packages, `src/**/*.test.ts` inside a package for what belongs to it. Playwright journeys live in `e2e/`. Test each rule at the layer where it lives, once:

- business and service layer, with its authorization: everything that matters; the role or permission matrix belongs to the policy test, written once, and a service test covers its business rule — one nominal case, one refusal per rule it owns;
- persistence: only what no reading catches — the idempotency ordering of a retryable mutation, the tenant clause of each query — calling the repository directly;
- adapter (route, server action): only payload parsing, field clearing and status mapping; it checks once that a refusal becomes a status, never per role or per rule;
- component: only genuine conditional logic of its own;
- end-to-end: one scenario, for what unit tests structurally cannot see.

**Each check runs once.** A deterministic command re-run on the same code returns the same answer. Focused tests on the files you touch while working; the full suite once, at the end; the type check once, after the last edit — Vitest transpiles without checking types, so a type error in a test file passes the suite and fails CI; the end-to-end suite and the production build once, before the merge, the build only when a route or a manifest moved.

**A test or script writes only inside its own run.** A fixed `/tmp` path or a fixed port is shared with every concurrent run, in another worktree or another job, and is a defect of that script.
