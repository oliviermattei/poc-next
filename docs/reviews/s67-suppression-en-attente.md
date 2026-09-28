# Review: story s67-suppression-en-attente (second pass, after the fix run)

> Fresh-context review (subagent `reviewer`). The first pass blocked on C1 (critical, open redirect via dot segments in `magicLinkRefusal`) and M-1 (major, composition link not netted). Diff reviewed: `git diff dev...feature/s67-suppression-en-attente` — story commit 6509e17 plus merge 3e5e091 (merge base = `dev` dcd0102; 26 files, the story's own changes). Every mutation and probe was restored; `git diff --exit-code` clean.

**The fix run closes C1, M-1, the older open redirect on the magic-link success path, and minors m-1, m-2, m-4 — each checked with the reviewer's own mutations and attacker inputs. What remains is minor. Ship allowed.**

## Commands run by the reviewer
- `pnpm typecheck`: green (37/37). `pnpm lint`: green (`--max-warnings=0`).
- `pnpm test`: 3049 passed, 14 skipped (107 files).
- `E2E_PORT=3413 pnpm test:e2e e2e/rgpd.spec.ts e2e/auth.spec.ts`: 7/7 passed.
- Full `pnpm test:e2e` (no other Playwright, Vitest or recipe process running): 139 passed, 11 skipped, 1 failed — `organizations.spec.ts:74` (sign-in helper stayed on `/fr/sign-in?verified=1`); rerun alone `--repeat-each=2`: 16 passed, 2 skipped. Flake under load; the story does not touch that path.
- `pnpm test:socle`: exit 0 — unit 3042 passed / 21 skipped, e2e 124 passed / 27 skipped, audit green, tree clean.

## Previous findings, checked
**C1 (open redirect in `magicLinkRefusal`): closed.** `safeRedirectPath` (`packages/modules/auth/src/domain/redirect.ts`) resolves the candidate like a URL parser on a dummy origin, re-checks the result (same origin, no `//`, no `/\`) and returns the resolved form; `magicLinkRefusal` appends `error=invalid_token` to that string without re-serialising through `URL.pathname`. Hostile inputs run through the real dispatcher on both paths — `/.//evil.test`, `/%2e//evil.test`, `/a/..//evil.test`, `/%2F%2Fevil.test`, `/%252F%252Fevil.test`, `/%2e%2e%2f%2fevil.test`, `/\evil.test`, `\\evil.test`, `/.\/evil.test`, `/%5C%5Cevil.test`, `/%5Cevil.test`, `//evil.test`, `https://evil.test`, `/%252e//evil.test`, `/..%2F/evil.test`, `/%2F/evil.test`, `/%2f%5cevil.test`, `/%09/evil.test`, `/@evil.test`, `/%2e%2e/%2e%2e//evil.test`, a literal tab — every `Location` stays on the site. Refusal path: dot and backslash forms fall back to `/app?error=invalid_token`, encoded forms stay literal. Success path: every response is a 302 to `http://localhost:3000/...` with a session cookie.

**Success-path open redirect (pre-existing on `dev`): closed.** `withSafeMagicLinkDestination` filters `callbackURL` and passes it on encoded once more. Library claim checked in the installed package: better-auth 1.7.2, `plugins/magic-link/index.mjs:121,147`, `new URL(decodeURIComponent(ctx.query.callbackURL), baseURL)`.

**M-1: closed.** The new test "sont journalisés par le point de composition du back-office" calls the real `admin.impersonationsEnded` and reads the module's own log; it runs only when `admin` is mounted.

**m-1, m-2, m-4: fixed.** No `isBanned` reference left anywhere; replaying the mark keeps the first date (`tests/auth.test.ts:1425`, neutralized below); the heading is now "les fins balayées", no number.

## `safeRedirectPath` callers after the change
Opened every caller: `sign-in/page.tsx` (64, 83, 140), `sign-up/page.tsx:32`, `two-factor/page.tsx:42`, `oauth/return/page.tsx:31`, `auth-routes.ts` (414, 688, 944). For a path without dot segments the resolved form equals the input (`/app`, `/app?x=1#h`, `/app/settings/account`, `/invitations/accept?token=a%2Fb`, `/app?next=//evil.test`); the function is idempotent. Side effect (improvement): the library no longer double-decodes a legitimate `callbackURL` (`token=a%2Fb` kept as sent). The consent guard has its own `safeReturnPath` (`consent/src/domain/request-guard.ts`), unaffected. The s62a constants (`ACCOUNT_SCREEN_PATH`, `DEFAULT_SIGNED_IN_PATH`) pass unchanged; their uses are intact; `redirect.ts` merged cleanly.

## Plan compliance
- [x] Tasks 1–8 present: generated migration (`0008_past_texas_twister.sql`, one nullable column, no default); one predicate (`refusesSignIn`, four combinations); both guards plus the lint pattern; mark after queuing and before revocation, revocation result kept; one refusal per sign-in method measured against an unknown account (password in message and time, magic link, passkey, second factor; OAuth against a banned account); ended impersonations returned and logged, `sessionsRevoked` in the event; purge unchanged, marked-then-replayed purge sends one email; e2e and docs.
- [x] Run interdicts: no cancel route; `banned` keeps its meaning; no deletion-specific public message; `runAccountPurge`/`purgeAccount` untouched; `auth` does not import `admin`; migration generated.
- Outside the plan: `withSafeMagicLinkDestination` and the new `safeRedirectPath` form — justified by the review; plan not amended (m-d).

## Anti-hallucination
- [x] References exist: drizzle helpers; `safeRedirectPath`, `DEFAULT_SIGNED_IN_PATH`, `ACCOUNT_SCREEN_PATH` (`index.ts:55`); `AccountDeletionOutcome` (`auth-use-cases.ts:421`), `endedImpersonationsOf`, `recordEndedImpersonations`, `backOfficeService`; the library's `originCheck` and `redirectWithError`, read in the installed package.
- [ ] One false statement: `tests/auth.test.ts:1427` says the first date is "celle que la purge et le journal lisent" — nothing reads `deletion_requested_at` beyond null / not null (m-c).

## Rules compliance
- [x] ADR 058 and ADR 074 consistent; ADR 074 well-formed.
- [x] Security: §2/§7 indistinguishable refusals measured; §3 impersonation endings logged and netted; §4 no remaining open redirect on `/magic-link/verify`.
- [x] Reliability: backward-compatible migration; marking a purged account touches zero rows without error.
- n/a Design system.

## Tests: bite proven by neutralization
| # | Mutation | Red |
|---|---|---|
| MA | `redirect.ts`: `return normalized` before resolution | 3 |
| MA+MB | original C1 state rebuilt | 1 (`/.//evil.test → //evil.test?error=invalid_token`) |
| MC | success path without `encodeURIComponent` | 1 (`/%2F%2Fevil.test → http://evil.test/`) |
| MD | success path `auth.handle(request)` without the wrapper | 1 (`//evil.test → http://evil.test/`) |
| M-1 | `apps/web/lib/admin.ts` no longer calls `recordEndedImpersonations` | 1 (was 0) |
| libauth | `apps/web/lib/auth.ts` `impersonationsEnded` no-op | 1 |
| route | delete-account route drops `impersonationsEnded(...)` | 1 |
| coalesce | `coalesce(...)` → `at` | 1 |
| writer | `isNull(authUser.deletionRequestedAt)` → `sql\`true\`` | 2 |
| predicate | `refusesSignIn` → `return account.banned` | 8 |
| mark | mark removed | 2 |

## Regressions
- Unplanned behaviour change: `/magic-link/verify` without `callbackURL` now always redirects (it used to return the library's JSON `{token, user, session}`). Hardens the endpoint (no session token in a GET body); no consumer depends on it; undocumented (m-b).
- Admin-off (socle): green; `admin.impersonationsEnded` does nothing.

## Findings
- **m-a (minor)** — `withSafeMagicLinkDestination`: `errorCallbackURL` and `newUserCallbackURL` pass unfiltered. Not exploitable today (every session-less response is replaced by `magicLinkRefusal`; `newUserCallbackURL` needs `isNewUser` and `disableSignUp: true` is hard-coded, `better-auth-service.ts:873`). Latent trap; removing both parameters costs two lines — next cycle.
- **m-b (minor)** — the JSON branch without `callbackURL` became a redirect; neither the comment nor `packages/modules/auth/AGENTS.md` says so.
- **m-c (minor)** — `tests/auth.test.ts:1427`: false statement that the purge and the log read the date.
- **m-d (minor)** — `packages/modules/auth/AGENTS.md` does not record the library trap (`/magic-link/verify` decodes `callbackURL` a second time); the plan was not amended with the two fix-run changes.
- **m-3 (minor, carried)** — OAuth for a pending account shows a raw 401 JSON page (as for a banned account; not an oracle).
- **m-5 (minor, carried)** — the inherited timing threshold sees 250 ms but not 60 ms (repo convention).
- **note** — `e2e/organizations.spec.ts:74` flake, unrelated.

## Not verified
- No browser: a magic link after a deletion request (landing `/app?error=invalid_token` → `/sign-in`, and what a signed-out person sees); a valid magic link with `callbackURL=/%2F%2Fevil.test` in Chrome and Safari under `pnpm build && pnpm start` (should be a same-site 404).
- OAuth against a real provider; the Inngest asynchronous-purge regime end to end; timing over a real network with production hashing cost; passkeys on a real device; CI on an Ubuntu runner.

## Verdict
Max severity: minor
Ship allowed: yes
