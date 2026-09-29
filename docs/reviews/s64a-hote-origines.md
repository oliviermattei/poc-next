# Review — Story s64a-hote-origines

> Fresh-context review (subagent `reviewer`). Each issue classified: critical / major / minor.
> Diff reviewed: `git diff dev...feature/s64a-hote-origines` (story commit c65bd89). Worktree clean at the end.

Review status: complete

Project commands and settings quoted from `AGENTS.local.md`: `Test: pnpm test`, `Typecheck: pnpm typecheck`, `E2E: pnpm test:e2e`, `Build: pnpm build`, `Verification mode: record`, `Full suite: execute-end`, `E2E stage: ship`, `Build stage: ship-if-route`, `Test budget: 25`.

The resolution is correct and well pinned: without `APP_HOST` nothing changes byte for byte, and with it every session URL built from `appUrl` moves to the application origin, while `rpID` and the site URLs stay on `APP_URL`. Four of five neutralizations went red. **The fifth, the `trustedOrigins` list given to Better Auth, has no net (0 red).** One major, three minors; nothing blocks.

## Plan compliance
- [x] The code does what the plan says: tasks 1–7 are all present (`env.ts` + test, `auth-config.ts`, the two optional options in the auth module passed on by `lib/auth.ts`, one test per journey file, the site-URL test, `.env.example`, `docs/deployment.md`, ADR 078, the verification record). One unplanned file: `docker-compose.prod.yml` (`APP_HOST: ${APP_HOST:-}`). `tests/deployment.test.ts` requires it and the record explains why; it is justified drift (minor, see below).
- [x] Run interdicts, each one checked: `apps/web/proxy.ts`, `apps/web/lib/security-headers.ts`, `config/security.ts`, `apps/web/lib/site-url.ts` have an empty diff. No `Domain`, `cookiePrefix` or `crossSubDomainCookies`. No `headers.get('host')`, `nextUrl.host` or `x-forwarded-host`. No `process.env` outside `packages/config` (the tests go through `vi.stubEnv`). The pinned `http://localhost:3000` assertions are unchanged.

## Anti-hallucination
- [x] References opened: `resolveAuthConfig` (`apps/web/lib/auth-config.ts:39`) and its callers `lib/auth.ts:164,335`, `lib/billing.ts:228,285,383`, `lib/organizations.ts:344` and `lib/startup.ts:128`; `metadataBaseUrl`/`resolveSiteUrl` (`lib/site-url.ts`); `createBetterAuthService`/`configureAuth` options; `passkey({ rpID, origin })`. Better Auth 1.7.2: `skipOriginCheck = isTest() ? true` (`dist/context/create-context.mjs:210`) is **confirmed**, and the check is bypassed in `api/middlewares/origin-check.mjs:22-23`. `getTrustedOrigins` always adds the `baseURL` origin (`dist/context/helpers.mjs:73-74`).
- [x] The values hold up. The origin is built as `protocol//APP_HOST[:port]` with no trailing slash. The `passkey.origin` stays a string when the list has one entry (byte for byte as before). The subdomain rule uses a `.` + host suffix. A path in `APP_URL` is refused. Every error names `APP_HOST`.
- [x] Every session URL in the auth module flows through `appUrl` (`auth-use-cases.ts:468,471,493`, `better-auth-service.ts:400,589,634`). No direct reader of `APP_URL` is left outside `site-url.ts` and `auth-config.ts`.

## Rules compliance
- [x] AGENTS.md conventions followed. The module does not read the environment, and the values are injected from the composition point.
- [x] No ADR contradicted. ADR 078 is new, numbered after 077. Keeping the site origin trusted during the interim is acceptable for security: both origins belong to the owner, `https://evil.test` is still refused (tested), and s64b is named as the story that tightens it.
- [x] Design system: not applicable (no UI).

## Tests
- [x] Verification record: `ks-gate` is not installed, so it was checked by hand. `git diff --quiet 09e026c7… HEAD -- . ':(exclude)docs'` returns exit 0, so the record is **current**. `Verification status: complete`. `pnpm test` exit 0 (3084 passed), `pnpm test:sans-env` exit 0, `pnpm lint` exit 0, `pnpm typecheck` exit 0. Taken as proof; the suite and the type check were not re-run. Its "Not proven here" section was read: it covers trustedOrigins under Vitest, local payments and `guestReturnUrl`.
- [x] The assertions pin the criteria. The 11 new cases are parameterized (env 2, resolution 3, auth 2, invitation 1, export 1, billing 2), within budget. Local baseline: 11 passed on Postgres.
- [x] Bite proven by neutralization. Each run was limited to the 6 files that name the rule, and each neutralization was restored (`git diff --exit-code` clean):
  - N1 `endsWith(\`.${host}\`)` → `endsWith(host)` → **1 red** (env.test). Then only the dot boundary was removed (the equal-host case kept refused) → red on `suffixe sans point` / `evilexemple.com`.
  - N2 `rpID: options.passkeyRpId ?? …` → `new URL(appUrl).hostname` → **1 red** (the passkey ceremony through the real `appAuth()`).
  - N3 `trustedOrigins` given to `betterAuth` → `[options.appUrl]` → **0 red**. See the major finding.
  - N4 `lib/auth.ts` `additionalTrustedOrigins` → `[]` → **1 red** (sign-in from the site origin refused).
  - N5 `appUrl` ignores `APP_HOST` → **8 red** (resolution, site URLs, magic link / verification / reset / email change / OAuth, passkey, invitation, checkout + portal, guest, export).
- [x] Tests made redundant: none. The existing tests keep pinning the single-host case (criterion 2).

## Regressions
- [x] Without `APP_HOST`: `additionalTrustedOrigins = []`, `trustedOrigins = [appUrl]` and `passkey.origin = appUrl` (a string), so the behavior is identical. `resolveAuthConfig` now always calls `new URL(APP_URL)`, but the schema already guarantees an absolute http(s) URL. `startup.ts:128` is unaffected.

## Findings
- **major** — `packages/modules/auth/src/infrastructure/better-auth-service.ts:635` (`trustedOrigins,` passed to `betterAuth`). The ADR 078 interim rule (the site origin stays trusted by Better Auth) **has no net**: replacing the list with `[options.appUrl]` leaves the whole suite green (N3, 0 red). Better Auth always adds the `baseURL` origin itself (`helpers.mjs:73-74`), so this line only carries the site origin, and its check is disabled under Vitest (`create-context.mjs:210`). The passkey ceremony only proves `passkey.origin`, which is built from the same local variable but is a separate consumer. Answer to the question asked: **yes, the rule is left without a net**. The impact is scoped, because `APP_HOST` is documented as not yet supported in production, and without it the site origin is the `baseURL`. Suggested net: a module test that reads `(await auth.$context).trustedOrigins`, or a test service built with `advanced.disableOriginCheck: false`, which asserts that a `callbackURL`/`Origin` from the site is accepted and one from `evil.test` is refused.
- **minor** — `packages/config/src/env.ts:21,48-55`: `HOSTNAME_PATTERN` accepts all-digit labels, so `APP_URL=http://127.0.0.1:3000` + `APP_HOST=app.127.0.0.1` passes although an IP has no subdomain. The "`APP_URL` must be an origin" check only looks at `pathname`, so a query string or fragment (`https://exemple.com/?x`) passes and then stays in `siteUrl`. Both are unlikely configurations; the result is a clear failure, not a leak.
- **minor** — Journey coverage. The criterion lists "deuxième facteur" (second factor) and "retours de checkout" (checkout returns). No test names 2FA: it emits no URL and relies on `baseURL`, which the OAuth `redirect_uri` case covers. Local payments (`local-payments.ts:308`, fed by `lib/billing.ts:241`) were checked by reading only, not measured; the record admits it.
- **minor** — `docker-compose.prod.yml:56`: drift from the plan (a file not listed). It is justified by `tests/deployment.test.ts` and recorded in the verification record. It also means the production stack forwards a variable the docs call unsupported. Harmless while it is empty, but worth covering in the s64c wording.

## Not verified
- **No real browser.** The WebAuthn ceremony was run with an authenticator double, never in Chrome/Safari. This matters most for `rpID=localhost` accepted from the origin `http://app.localhost:3000`: browsers apply their own registrable-suffix rule, which the server test does not reproduce. Human gesture: with `APP_HOST=app.localhost`, register a passkey on `http://localhost:3000`, then sign in with it from `http://app.localhost:3000/app` (and the reverse), in Chrome and Safari.
- **Better Auth's CSRF/origin check** (disabled under Vitest) was never exercised with two origins. Gesture: on a `pnpm dev` with `APP_HOST=app.localhost`, sign in by password on `http://localhost:3000` and then on `http://app.localhost:3000`; both must succeed, and a `POST` with `Origin: https://evil.test` must return 403.
- **Emails and Stripe** were only doubled or captured locally. Gesture: open a magic link and an invitation received in `.mail/` with `APP_HOST` set, and run a local checkout (local payments) to see where it comes back.
- **The E2E suite and the build** were not run (`E2E stage: ship`, `Build stage: ship-if-route`, no route moved).
- **Lint and formatting** were taken from the record.

## Verdict
Max severity: major
Ship allowed: yes
