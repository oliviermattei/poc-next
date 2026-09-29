# Verification — Story s64b2-hote-tarifs

> Written by the implementer as its last action before the story commit. Commands quoted
> verbatim from `AGENTS.local.md`.

Tree: 7b549ff987b0efa4860e6e9ffe064dea94a2c5fb

| Run | Command | Result | When |
| --- | --- | --- | --- |
| Test (full suite) | `pnpm test` | exit 0 · 3118 passed · 14 skipped (107 files passed, 4 skipped) | 2026-09-29T00:16Z |
| Typecheck | `pnpm typecheck` | exit 0 · 37/37 tasks | 2026-09-29T00:18Z |
| Lint | `pnpm lint` | exit 0 | 2026-09-29T00:17Z |
| Golden path, one host | `GOLDEN_PATH_PAYMENTS=simulated pnpm test:golden-path` | exit 0 · 4 passed · logs « hôtes : un seul » | 2026-09-29T00:15Z |
| Golden path, two hosts | `GOLDEN_PATH_PAYMENTS=simulated GOLDEN_PATH_HOSTS=split pnpm test:golden-path` | exit 0 · 4 passed · logs « hôtes : deux (site.localhost / app.site.localhost) » | 2026-09-29T00:14Z |
| E2E | — | not run — runs at ship (`E2E stage: ship`) | — |
| Build | — | not run — runs at ship (`Build stage: ship-if-route`; pages changed) | — |

Visual check (task 7): dev server with `APP_URL=http://site.localhost:3197`,
`APP_HOST=app.site.localhost`, `/fr/pricing?offer=lifetime` screenshotted at 1280 and 390 px:
the « Déjà client ? Choisissez votre offre depuis votre espace » line sits centred under the
cards (wraps on two lines on mobile), href `/fr/app/settings/billing?offer=lifetime`; clicking
it lands on `app.site.localhost/fr/sign-in?next=%2Fapp%2Fsettings%2Fbilling%3Foffer%3Dlifetime`.
Taken before task 6b, which does not touch the pricing page.

## Not proven here
- `pnpm test:e2e` and `pnpm build`: run once at ship.
- The `recorded` payments regime of the golden path: no recording exists in the repo
  (`tests/fixtures/stripe-events/`), both regimes above are `simulated`.
- Production behaviour behind a real reverse proxy with `APP_HOST` (listening on
  `0.0.0.0:3000`): inferred from ADR 080, measured only on `next dev`.

Verification status: complete
