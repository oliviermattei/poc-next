# Verification — Story s64c-hote-cookies

> Written by the implementer as its last action before the story commit. Commands quoted
> verbatim from `AGENTS.local.md` (`pnpm test`, `pnpm typecheck`), plus those the plan's
> task 8 names.

Tree: c97db641a7f4bb28e4232864ca3657c4539b6520

| Run | Command | Result | When |
| --- | --- | --- | --- |
| Golden path, two hosts | `GOLDEN_PATH_PAYMENTS=simulated GOLDEN_PATH_HOSTS=split pnpm test:golden-path` | exit 0 · 4 passed · logs « hôtes : deux (site.localhost / app.site.localhost, APP_HOST posée) » · step « session propre à l’application, consentement partagé » green | 2026-09-29T00:44Z |
| Golden path, one host | `GOLDEN_PATH_PAYMENTS=simulated pnpm test:golden-path` | exit 0 · 4 passed · logs « hôtes : un seul (localhost, sans APP_HOST) » | 2026-09-29T00:45Z |
| Test (full suite) | `pnpm test` | exit 0 · 3131 passed · 14 skipped (107 files passed, 4 skipped) | 2026-09-29T00:46Z |
| Sans `.env` | `pnpm test:sans-env` | exit 0 · 3131 passed · 14 skipped (111 files) | 2026-09-29T00:47Z |
| Lint | `pnpm lint` | exit 0 | 2026-09-29T00:47Z |
| Typecheck | `pnpm typecheck` | exit 0 · 37/37 tasks | 2026-09-29T00:47Z |
| E2E | — | not run — runs at ship (`E2E stage: ship`) | — |
| Build | — | not run — runs at ship (`Build stage: ship-if-route`; `proxy.ts` changed) | — |

The two golden-path runs cloned the working tree after the last code edit; only files under
`docs/` changed after they started. Times are the completion times of each run's log.

Browser measure (task 6, split run above): after sign-in, `context.cookies(app origin)`
holds the session cookie and `context.cookies(site origin)` holds no session or two-factor
cookie; after « Tout refuser » on the site's pricing page, `app_consent` is seen from both
origins with the single domain `.site.localhost` — Chromium accepted `Domain=site.localhost`
set from `app.site.localhost` — and the banner does not show on the application host.

## Not proven here
- `pnpm test:e2e` and `pnpm build`: run once at ship.
- The manual two-host recipe with real names and TLS (`docs/deployment.md`, « La recette
  manuelle à deux hôtes »): written, not played — it needs a human; an issue is to be opened
  at ship.
- The two-factor challenge cookie in a browser: its absence of `Domain` is asserted on the
  HTTP response (`tests/auth.test.ts`); the golden path has no second-factor account.
- The `recorded` payments regime of the golden path: both runs are `simulated`.

Verification status: complete
