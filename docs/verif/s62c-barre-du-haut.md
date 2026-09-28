# Verification — Story s62c-barre-du-haut

> Written by the implementer as its last action before the story commit. Commands quoted
> verbatim from `AGENTS.local.md` (`Test: pnpm test`, `Typecheck: pnpm typecheck`) and from
> the plan's task 10 (`pnpm lint`, `pnpm test:minimal-profile`, `pnpm test:socle`).

Tree: bcc617cbe8d5ec79f0ed6ab3230387d0abf91a49

| Run | Command | Result | When |
| --- | --- | --- | --- |
| Test (full suite) | `pnpm test` | **exit 1** · 3070 passed · 14 skipped · **3 failed**, all in `tests/agents-md.test.ts` (see below) — 105 files, 104 passed | 2026-09-28T21:54:07Z |
| Typecheck | `pnpm typecheck` | exit 0 · 37/37 turbo tasks | 2026-09-28T21:55:09Z |
| Lint | `pnpm lint` | exit 0 · 0 warning | 2026-09-28T21:55:16Z |
| Minimal profile | `pnpm test:minimal-profile` | **exit 1** — suite stage in the clone: 3061 passed · 23 skipped · 3 failed, the same three `tests/agents-md.test.ts` cases; the recipe stops there, its Playwright stage did not run | 2026-09-28T21:50:39Z |
| Socle | `pnpm test:socle` | **exit 1** — steps Typage, Lint, Contraste, migrations: passed; « Tests unitaires »: 3063 passed · 21 skipped · 3 failed, the same three `tests/agents-md.test.ts` cases; Build and end-to-end steps not reached | 2026-09-28T21:52:57Z |
| E2E | — | not run — runs at ship (`E2E stage: ship`) | — |
| Build | — | not run — runs at ship (`Build stage: ship-if-route`; a route was added) | — |

**The three failures are not this story's.** `tests/agents-md.test.ts` (« décrit les quatre
couches… », « porte les sections opposables en revue », « nomme chaque commande du dépôt »)
reads the root `AGENTS.md`, which is the method's file: it lacks the project conventions
appended by `install.sh` since `6659244` moved them to `AGENTS.local.md`.
`git diff --quiet dev -- AGENTS.md AGENTS.local.md tests/agents-md.test.ts` exits 0 on this
branch — the three files are byte-identical to `dev`, so the same cases fail there.
Rebuilding `AGENTS.md` (`install.sh`) is outside this story and forbidden to the implementer.

Browser check (dev server on this worktree, local test account created through the
e2e helper `aSignedInAccount`, Chromium, 1280 px and 375 px, light and dark):
- `/app` without organization: no selector in the top bar; bell and account menu present.
- Two organizations: selector in the top bar before the language switch; long name
  truncated, no overflow; menu opens; switching from `/fr/app` came back to `/fr/app`.
- Non-default locale: hidden `next` = `/en/app`, switch returned to `/en/app` (prefix kept).
- `/app/settings/organization`: « Organisation courante » card is informative (name, role
  badge, hint sentence), no second selector.
- `/app/settings/notifications`: `h2` + preferences card; sub-navigation order Profil,
  Sécurité, Notifications, Organisation, Membres, Facturation, Cookies; sidebar has no
  Notifications entry. `/notifications` centre: no card, empty state links to the rubric
  (its copy said « ci-dessous » — corrected).
- Mobile: selector inside the navigation sheet above the entries; `scrollWidth` 375.
- The Next dev overlay reported one hydration diff: `caret-color: transparent` on every
  input, injected by Playwright's screenshot — not the app.

## Not proven here
- The end-to-end suite (including the new cases in `e2e/organizations.spec.ts` and
  `e2e/settings.spec.ts`) and the production build: they run at ship.
- The Playwright stage of `pnpm test:minimal-profile` and the Build/E2E steps of
  `pnpm test:socle`: not reached, because both recipes stop on the three pre-existing
  `tests/agents-md.test.ts` failures.
- Neutralization of the guards (filter replaced by `next`, `session !== null` removed,
  sidebar entry restored): left to the review, per the testing doctrine.

Verification status: incomplete — `pnpm test` exits 1 on three pre-existing failures outside this story's diff
