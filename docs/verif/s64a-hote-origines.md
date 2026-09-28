# Verification — Story s64a-hote-origines

> Written by the implementer as its **last action before the story commit**, and committed
> with it. The reviewer checks `Tree:` against the commit; when they match, it takes these
> results as proven instead of re-running them. Every command is the project's own, quoted
> verbatim from `AGENTS.local.md` — never a substitute, never a paraphrase.

Tree: 09e026c73ea6a6932bfcf6b00247049e6c962c36

| Run | Command | Result | When |
| --- | --- | --- | --- |
| Test (full suite) | `pnpm test` | exit 0 · 3084 passed · 14 skipped · 106 files passed, 4 skipped | 2026-09-28T23:00:30Z |
| Test sans `.env` (plan, task 7) | `pnpm test:sans-env` | exit 0 · 3084 passed · 14 skipped · 110 files swept | 2026-09-28T23:01:27Z |
| Lint (plan, task 7) | `pnpm lint` | exit 0 · `--max-warnings=0` | 2026-09-28T23:01Z |
| Typecheck | `pnpm typecheck` | exit 0 · 37/37 turbo tasks | 2026-09-28T23:02Z |
| E2E | — | not run — runs at ship (`E2E stage: ship`) | — |
| Build | — | not run — `Build stage: ship-if-route`, no route or manifest moved | — |

A first `pnpm test` run (2026-09-28T22:59:29Z) exited 1 on one case —
`tests/deployment.test.ts` « transmet aux conteneurs exactement les variables du schéma » —
because `APP_HOST` was in `ENV_KEYS` but not in `docker-compose.prod.yml`. The key was added
to the compose block, `tests/deployment.test.ts` re-run focused (14 passed), then the full
suite above re-run once on the fixed code.

## Not proven here
- The end-to-end suite and the production build: at ship.
- Better Auth's own `trustedOrigins` check is not observable under Vitest (`isTest()` sets
  `skipOriginCheck`, which also skips the CSRF origin check). The trusted-origin list is
  proven only through the passkey ceremony, which uses the same list and always compares.
- Local payments (`packages/payments-testing/src/local-payments.ts:308`) receive `appUrl`
  from `lib/billing.ts`'s `paymentsOf()`, not measured with `APP_HOST`: the composition case
  injects its Stripe double.
- `guestReturnUrl` (`/pricing`) follows `appUrl` by design (ADR 078); its routing is s64b.
- No neutralization was run (doctrine: that is the review's job).

Verification status: complete
