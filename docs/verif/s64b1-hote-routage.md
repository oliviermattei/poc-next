# Verification — Story s64b1-hote-routage

> Written by the implementer as its **last action before the story commit**, and committed
> with it. The reviewer checks `Tree:` against the commit; when they match, it takes these
> results as proven instead of re-running them. Every command is the project's own, quoted
> verbatim from `AGENTS.local.md` — never a substitute, never a paraphrase.

Tree: 114918bb2735230e57009a63740a3f3b8f9d2067

| Run | Command | Result | When |
| --- | --- | --- | --- |
| Lint (plan, task 8) | `pnpm lint` | exit 0 · `--max-warnings=0` | 2026-09-28T23:29Z |
| Test (full suite) | `pnpm test` | exit 0 · 3109 passed · 14 skipped · 107 files passed, 4 skipped | 2026-09-28T23:29:56Z |
| Test sans `.env` (plan, task 8) | `pnpm test:sans-env` | exit 0 · 3109 passed · 14 skipped · 111 files swept | 2026-09-28T23:30:40Z |
| Typecheck | `pnpm typecheck` | exit 0 · 37/37 turbo tasks | 2026-09-28T23:31Z |
| E2E | — | not run — runs at ship (`E2E stage: ship`) | — |
| Build | — | not run — `Build stage: ship-if-route`: the proxy changes routing, so the build is due **at ship** | — |

Each command ran once, on the tree above, with no edit to code between them.

## Not proven here
- The end-to-end suite and the production build: at ship. No two-origin browser journey
  (s64b2) — Next's relativisation of same-origin `Location` headers only shows in a browser.
- Better Auth's own `trustedOrigins` check is not observable under Vitest (`isTest()` sets
  `skipOriginCheck`), and `AuthService` does not expose `auth.$context`. The removal of the
  site origin (#64) is proven through the real `appAuth()` passkey ceremony, which compares
  against the same `trustedOrigins` list: the site origin is now refused (401), the
  application origin accepted.
- The host is read from `x-forwarded-host` / `host` in unit tests built with `NextRequest`;
  that Next fills `x-forwarded-host` from `host` in the standalone server is the research's
  reading of Next's source, not measured here.
- No neutralization was run (doctrine: that is the review's job).

Verification status: complete
