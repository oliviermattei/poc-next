# Coding standards

The judgement rules of this repo: what a reviewer, human or `/code-review`, holds a change
to. What a command already enforces lives in the lint, the type check and the tests; this
file carries the rest, and the reason behind the rules those commands enforce. Full detail
in `docs/architecture.md`; each structural decision has an ADR in `docs/adr/`, cited as
"ADR 069".

## Technical conventions

**Stack** — always the latest stable majors (ADR 010): Next 16, React 19, Tailwind v4 (CSS-first config, no `tailwind.config.js`), TypeScript 7 strict (the lint chain in `tooling/eslint` stays on TypeScript 6 until `typescript-eslint` accepts 7 — see its `AGENTS.md`), pnpm 10+, Node 20.10+. shadcn/ui on **Radix UI**, copied into `packages/ui` (ADR 022), Turborepo + pnpm, PostgreSQL 16+ with Drizzle, Better Auth, **module routes are `ModuleRoute` descriptors + Zod, dispatched by `dispatchModuleRequest` from `@repo/core`** — the final form (ADR 085; Hono and oRPC were planned and never shipped): never Hono, never oRPC, never a second router, Vitest + Playwright, GitHub Actions.

**Zones and routes of `apps/web`** — `config/` holds features, billing, gating and marketing, edited by the project owner. `apps/web` mounts the module dispatcher at `app/api/modules/[...path]`, and:

- its screens are grouped by zone in four route folders — `(site)`, `(auth)`, `(app)`, `(console)` — which never appear in a URL (ADR 071), each rendering its own template;
- `/` always serves the public site and `/app` is the application's dashboard, the default destination after any sign-in (`DEFAULT_SIGNED_IN_PATH`);
- **every application screen lives under `/app`** — dashboard, settings, notification center, onboarding, premium feature — and `tests/zones.test.ts` fails on a `(app)` page outside `app/` or on a protected module navigation entry (outside console and API) pointing elsewhere;
- the site header renders the navigation surface `site` (home, blog, docs, pricing) plus one template button written by hand (ADR 073) — the only hand-written entry found so far in the site header; the brand links and the AppShell account menu are also hand-written links, and no command enforces the count;
- the superadmin back-office is the **console**, served under `/console`; its navigation surface is `console`, and it answers 404 to anyone who is not a superadmin, anonymous included (ADR 070, ADR 068);
- a navigation entry's `surface` answers *"where does this link make sense?"*, which only the module owning the link can decide, so it stays a property of the entry — until one link must appear on two surfaces, which reopens the question (ADR 066);
- account, organization and billing live in the **settings zone** `/app/settings/*`, whose sub-navigation renders the surface `settings` — the application sidebar renders `app` only, the product's own pages;
- a moved screen's old path answers **308** through the single table `apps/web/lib/legacy-paths.ts`, read by `apps/web/proxy.ts` on the internal path, never `redirects()` in `next.config.ts` (ADR 075); each row names the module serving its screen and redirects only when that module is enabled (same ADR).

**A module is the unit of composition.** Every feature lives in a module, a package under `packages/modules/<name>` declaring one typed contract: `id`, `requires`, `schema`, `migrations`, `routes` (**each with its protection level**: public, authenticated, role-gated, entitlement-gated — reserved for a paid offer, ADR 043), `navigation` (same), `messages`, `emails` (with their locales), `webhooks`, `jobs` (scheduled tasks, id + cron schedule), `publicUrls` (the public URLs it publishes, aggregated by the core into sitemap and robots, ADR 054), `dataCategories`, `retention` (one policy per declared category), `purge`, `export`. Every key is mandatory from the first module, empty if need be — adding one later means reopening every module already written. **One key is optional, and that is a decision with an ADR**: `seeds` (demonstration data, **ADR 069**), added the way `NavigationEntry.surface` was (ADR 066) — the registry derives it for the modules that declare it, and the fifteen that do not were not reopened. ADR 069 carries the criterion, not the precedent: a key is mandatory when omitting it leaves a defect with no owner (unpurged data, an unprotected route, uncrawled content); it may be optional when omitting it leaves only silence.

**Four layers inside each module**: `domain/` (pure business rules, no framework, no ORM, no SDK) → `application/` (use cases and ports) → `infrastructure/` (Drizzle repositories, adapter calls) and `presentation/` (`ModuleRoute` declarations, React components). `infrastructure` and `presentation` never import each other. **The boundary rule is enforced by lint in CI, not by review.**

**A module with components exposes them through a second entry point** — `@repo/module-<name>/presentation` (ADR 024). The main barrel carries the contract, `domain` and `application`, and **never re-exports a `.tsx`**: `config/features.ts` is read by `pnpm db:generate`, `pnpm ks` and the `@repo/db` typecheck, none of which compile JSX. Break it and `pnpm typecheck` fails with `error TS6142 … '--jsx' is not set` — on `@repo/db`, not on the module.

**A disabled module leaves no trace**: no route (404), no navigation entry, no migration applied on a fresh database. A module enabled then disabled keeps its tables and data — deleting them would be `eject`, which is in the PRD graveyard. No cleanup command exists; never introduce one.

**A port never throws** — it returns a discriminated result (`{ok:true,…} | {ok:false,error}`), so the compiler forces the caller to handle failure instead of defaulting to a 500. Binding for storage, payments, jobs, analytics and monitoring. Test doubles replace the **network**, never the SDK.

**One implementation per port.** Mail Resend, storage S3/R2, payments Stripe, rate limiting PostgreSQL (ADR 050 — the fourth port; its store is the app's own database, so an unavailable store **refuses** instead of degrading, and it has no keyless local mode because it has no key), jobs Inngest (ADR 059 — the fifth port, and the only one whose surface is **split in two**: the port carries emission, the module contract's `jobs` key carries declaration, and `dispatchModuleJob` in `@repo/core` joins them. Its `ok:true` means "queued", never "done". The execution rule lives in the **core**, not in the optional `jobs` module, because it must answer when that module is cut — that is what makes the synchronous fallback possible), analytics PostHog and errors Sentry (the **sixth and seventh** ports, shipped together and **both degrading**: `docs/reliability.md` §2, "no analytics → the app runs". With them the general rule is a majority among ports again, and `rate-limit` remains its only exception. "No key" is a **value** there — `not_configured` — never a silent `ok: true`, and the criterion is measured on **outbound calls**: with no key, none is emitted. Sensitive-field redaction lives **inside each adapter**, at the last point before the network, because a rule placed higher up is bypassable by whoever holds the adapter. The browser half is **not** the provider's loader: it is a script served by the module's own public route, carrying `posthog.init(key, …)` — a declared loader was once measured initialising nothing, hence measuring nothing). Test doubles are tools, not providers: they never justify a second adapter.

**Every port is usable locally with no provider key** — through an explicit opt-in flag set by whoever runs the process (e.g. `EMAIL_LOCAL_CAPTURE=1`), never inferred from `NODE_ENV`. The rule and its reason live in `docs/reliability.md` §2.

**Naming** — files `kebab-case`, types and components `PascalCase`, functions and variables `camelCase`, tables and columns `snake_case`.

**Deployment** — `docs/deployment.md`. Two facts bind the rest of the repo: the app has **two startup points** — `next.config.ts` and `apps/web/instrumentation.ts` — both calling the single guard `apps/web/lib/startup.ts`, because `output: 'standalone'` serialises the Next config into `server.js` and stops executing `next.config.ts` at server start; and **the runtime stage never inherits the build stage's permissiveness** — the validation escape hatch (`NEXT_PHASE`, `SKIP_ENV_VALIDATION`) is carried by the build command, never by an `ENV` of a stage, or the image boots in production without checking its configuration. Migrations run in their own container before traffic switches; a failed one keeps the app from starting.

**Rules that bite** — on top of the security and reliability baselines below: every `<form>` declares `method` as a written literal (a React form without it falls back to a browser GET before hydration and puts secrets in the URL); a foreign key toward another module only if that module is a declared `requires` (ADR 018); a screen that writes organization data confirms the scope it displayed, never the active scope at submission time — the active organization is per account, so another tab may have switched it (ADR 025).

**Third-party integrations, two regimes, never mixed** — in CI: recording doubles for outbound calls, replay of recorded webhook events for inbound ones, both blocking — a missing recording fails, never falls back to the simulator (ADR 048; the golden-path job is armed only once a recording exists, and none does yet, #106). Outside CI, on an explicit command: real test keys, run before every merge to `dev`.

**Commits** — imperative message in French. Work reaches `dev` through a pull request, squash-merged.

## Security baseline

Authority: `docs/security.md` (ADR 012); its controls are not restated here. It applies to every change, not only to a security one, and a breach of it blocks the merge, exactly like a functional regression. A change's spec or ticket names the sections of `docs/security.md` it touches.

## Reliability baseline

Authority: `docs/reliability.md` (ADR 014), with the same standing: a breach blocks the merge, and a change's spec or ticket names the sections it touches.

## Agent-oriented repo

This codebase is mostly edited by agents (ADR 013). An agent that cannot find the rule invents one, so rules live where the code is written and are backed by a command:

- **`AGENTS.md` per package**, on top of the root one: what the package may import, what it must never contain, where its tests live. A test checks every package has one.
- **Never claim exhaustiveness.** A measured list says *what was swept*, never *what exists*. This repo has been caught three times: a package `AGENTS.md` calling three known cases "the only ones", a review's own finding list missing a fourth position, a measurement table omitting a case that works. The next agent reads such a claim as verified and stops looking. Write "found so far, over these N cases", and name the cases.
- **A rule must be executable.** Layer boundaries → lint. Required modules → config validation. Environment wiring → test. Ask of any new rule: *which command fails if I break it?* If none, it is documentation, not a rule.
- **Derive, never copy.** A list, a count or a path written next to the code that defines it goes stale in silence; a test reads it from the source — `package.json`, the workspace, the registry, the disk — and fails when the two drift.
- **Generate, don't guess.** `npx ks` and the MCP server expose the same operations — list modules, toggle one, scaffold a compliant module. Producing a module skeleton by hand is a smell.
- **Docs ship with the code that changes them.** A change that alters a convention and leaves its rule stale is incomplete.
- **The Guide follows the code** (ADR 083). A change to a module, a `config/` file, an environment variable, a service or a root script updates the matching Guide page(s) — `apps/guide/content/docs`, in French and in English — in the same commit. The Guide is what the project owner reads: a Guide that describes yesterday's code sends them down a path that no longer exists. `tests/guide.test.ts` enforces part of it, every list derived from the code and checked in every Guide language (read from `apps/guide/lib/i18n.ts`): page and `meta.json` parity between languages; every internal link and every feature-grid card leads to a page in the same language; an honest grid (each "Coming soon" cites its issue, nothing from the PRD graveyard); a title and a description on every page; no page still carrying the placeholder marker; every module of `config/features.ts` has its row in the module table (`fonctionnalites/index`) and its page names it; every key of `ENV_KEYS` and `BUILD_ENV_KEYS` is named on the environment-variables page; every `config/` file is named on some page; every root `package.json` script is named on `reference/commandes`. **What it does not check is the reviewer's judgement**: that a service page still matches its adapter and configuration rule, that a command's description is still true, that any sentence is accurate — the test proves a thing is *named*, never that what is said about it is right.

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
7. a sweep over a derived list that finds nothing — every derived list gets a floor or a cross-check, so an empty sweep goes red;
8. a case that skips itself when the configuration does not hold its precondition (`it.skipIf`, an early `return`) — CI plays two configurations, and the skipped half goes green while checking nothing. **A test whose precondition depends on the configuration derives the absence instead**: it asserts why the precondition does not hold, so the number of cases run never drops from one configuration to the other.

**Where tests go.** Two locations, and two only: `tests/` at the root for what crosses packages, `src/**/*.test.ts` inside a package for what belongs to it. Playwright journeys live in `e2e/`. Test each rule at the layer where it lives, once:

- business and service layer, with its authorization: everything that matters; the role or permission matrix belongs to the policy test, written once, and a service test covers its business rule — one nominal case, one refusal per rule it owns;
- persistence: only what no reading catches — the idempotency ordering of a retryable mutation, the tenant clause of each query — calling the repository directly;
- adapter (route, server action): only payload parsing, field clearing and status mapping; it checks once that a refusal becomes a status, never per role or per rule;
- component: only genuine conditional logic of its own;
- end-to-end: one scenario, for what unit tests structurally cannot see.

**Each check runs once.** A deterministic command re-run on the same code returns the same answer. Focused tests on the files you touch while working; the full suite once, at the end; the type check once, after the last edit — Vitest transpiles without checking types, so a type error in a test file passes the suite and fails CI; the end-to-end suite and the production build once, before the merge, the build only when a route or a manifest moved.

**A test or script writes only inside its own run.** A fixed `/tmp` path or a fixed port is shared with every concurrent run, in another worktree or another job, and is a defect of that script.
