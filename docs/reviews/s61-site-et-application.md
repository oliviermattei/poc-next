# Review (second pass, after the fix run): story s61-site-et-application

> Fresh-context review (subagent `reviewer`). Diff reviewed: `git diff dev...feature/s61-site-et-application`, one commit `8abb3db`, merge-base `e6e5a0d` (= `dev`). The fix delta against the blocked commit (`git diff 3f86fe0 8abb3db`) touches 11 files, all tied to C1, M1, M2, m2 and m3.
> Every mutation was restored; at the end `git diff --exit-code` is clean.
> The first pass (blocked on C1 critical, M1 and M2 major) is in the git history of this file's branch discussion; its findings and statuses are carried below.

**Verdict: all three blockers (C1, M1, M2) are fixed and each fix is proven by a mutation. Ship allowed; the worst open finding is minor.**

## Status of the previous findings

| Finding | Status | Evidence |
|---|---|---|
| **C1** open redirect | **Fixed** | `safeRedirectPath` (`packages/modules/auth/src/domain/redirect.ts`) now returns the fallback if the value contains any control character or whitespace (`/[\u0000-\u001f\u007f\s]/u`), before any other check. Every caller goes through this one function: 2 in `sign-in/page.tsx`, plus `sign-up`, `two-factor`, `oauth/return`, and 3 in `auth-routes.ts`. Mutation (guard disabled): 1 unit red (`auth-rules.test.ts`), 1 e2e red with i18n on (landed on `/fr/evil.test`). `pnpm test:socle` (i18n off, where the attack was reproduced) is green, including `app-shell.spec.ts:478` with the `/\t/`, `/\n/`, `/\r/` cases. |
| **M1** `/sign-up` filter untested | **Fixed** | The e2e loop runs over `/sign-in` and `/sign-up` × {valid `next`, `//evil.test`, `\t`, `\n`, `\r`} and checks there is no 500. Mutation (`/sign-up` bypasses the filter): 1 e2e red (`Received …/fr/evil.test`). |
| **M2** account-deletion session race | **Fixed** | `requestAccountDeletion` calls `sessions.revokeAllForUser(userId)` after a successful queue. `rgpd.spec.ts` is back to the strict `urlOf('/sign-in')`. Mutation (call removed): 1 unit red (`account-deletion.test.ts`, two sessions), `rgpd.spec.ts` `--repeat-each=3` 3/3 red. Unmutated, `rgpd` + `app-shell` `--repeat-each=3`: 51/51 green. Better Auth has no `cookieCache`, so deleting the rows takes effect on the next request. |
| m2 exhaustiveness claim | **Fixed** | Root `AGENTS.md` and `apps/web/AGENTS.md:170` say "la seule trouvée jusqu'ici…" and name the other hand-written links. |
| m3 dead `navigation.signIn` key | **Fixed** | Removed from the fr/en catalogs. |
| m1 site content width, m4 thin auth marker floor | Still open | Minor, carried over. |

## The declared gap: signing in to an account whose deletion is pending
- **Possible? Yes, read from the code (not reproduced).** Nothing marks an account as "deletion pending" (no `pendingDeletion`/`deleted_at` in `packages/modules/auth/src`). The `auth_user` row stays until the purge job runs, so every sign-in method still works; such a session lands on `/app` until the purge deletes the user and the cascade closes it.
- **Caused by s61? No.** It dates from s34 (async purge). s61 only changes where that session lands. The fix narrows the window; it does not open it.
- **Not a finding against this story.** Worth a follow-up story (a pending-deletion marker checked at sign-in, or a purge that refuses a session opened after the request), mostly relevant under Inngest.

## Tests run by the reviewer
- `pnpm typecheck`: exit 0 (37/37).
- `pnpm lint`: exit 0.
- `pnpm test`: 3016 passed, 14 skipped.
- `E2E_PORT=3166 pnpm test:e2e`: 137 passed, 11 skipped, 0 failed.
- `pnpm test:socle`: exit 0; e2e 121 passed, 27 skipped; audit clean at the high threshold.
- `pnpm test:contrast`: 44 pairs, all above threshold.
- Not run: `pnpm test:golden-path`, `pnpm test:minimal-profile`.

## Plan compliance
- [x] Tasks 1–10 present (checked in detail in the first pass). The fix delta does not touch the UI.
- [x] Run interdicts hold: page folders, URLs (`/app` only new), console, footer, `packages/ui`, module contract (only `'site'`), header reads.
- [~] One interdict contradicted on purpose: "`safeRedirectPath` ne change pas" — the C1 fix had to change it (security §4 wins). The plan was not amended, and the account-deletion change is outside its "Files touched". See m6.

## Anti-hallucination
- [x] References opened: `sessions.revokeAllForUser` (port `application/ports.ts:145`, Drizzle `drizzle-auth-repositories.ts:361`, deletes `user_id OR impersonated_by`), `DEFAULT_SIGNED_IN_PATH` (redirect.ts → auth `index.ts` → `apps/web/lib/auth.ts`), `currentViewer` (`apps/web/lib/auth.ts:331`), `resolveActiveSession`, `viewAccount`; test harness (`jobsRegime`, `recordingJobs`, `servedWithCookie`) reset in `beforeEach`.
- [x] The new check runs before the `\` → `/` step; internal callers pass already-encoded `pathname + search`, so no legitimate internal path is lost. A hand-written decoded `next` with a space falls back to `/app`: accepted.
- [x] The revocation comes after a successful `jobs.emit`.

## Rules compliance
- [x] Lint green, layer boundaries respected. `docs/security.md` §2 (server-side revocation) and §4 (redirect filter) both strengthened.
- [x] ADRs 070–073 not contradicted.
- [~] Docs ship with the code: `packages/modules/admin/AGENTS.md` not updated for the new way an impersonation ends (m5).
- [x] Design system: the first pass's assessment stands (m1 open).

## Tests: bite proven by neutralization
| # | Neutralized | Red |
|---|---|---|
| 1 | `safeRedirectPath` control/whitespace guard | 1 unit + 1 e2e |
| 2 | `/sign-up` signed-in redirect bypasses `safeRedirectPath` | 1 e2e |
| 3 | `revokeAllForUser` removed from `requestAccountDeletion` | 1 unit + e2e `rgpd` 3/3 |
| 4 | revocation moved before `jobs.emit` | **0 red** (m7) |

## Regressions
- [x] Other callers of `revokeAllForUser` (email change, ban, purge) unaffected; the purge becomes a no-op when the request already revoked.
- [~] One new side effect, m5.

## Findings
- **m5 (minor)** — `auth-use-cases.ts` (`requestAccountDeletion`) and `packages/modules/admin/AGENTS.md` ("les sept fins balayées"): `revokeAllForUser` also deletes the impersonation sessions the account holds or that are borrowed on it, so a deletion **request** is now an eighth way an impersonation ends — not logged, not in the table; the event `auth.account_deletion_requested` carries no `sessionsRevoked` count. Suggested: add the row with its reason, and the count in the event.
- **m6 (minor)** — `docs/plans/s61-site-et-application.md`: the interdict "`safeRedirectPath` ne change pas" and "Files touched" are contradicted by the C1/M2 fixes without a recorded amendment.
- **m7 (minor)** — `auth-use-cases.ts` comment and `packages/modules/auth/AGENTS.md` ("Une émission refusée ne ferme rien"): no command enforces it; moving the revocation before `jobs.emit` leaves the suite green. Suggested: a case where emission is refused and the session still answers 200.
- **m1 (minor, carried)** — `apps/web/app/(site)/site-header.tsx`: content in `max-w-4xl` under a `max-w-6xl` header.
- **m4 (minor, carried)** — `tests/rendered-text.test.ts`: auth marker floor margin is one marker.
- **Not counted (pre-existing since s34):** signing in to an account whose deletion is pending.

## Not verified
- **Production build:** no screen rendered under `pnpm build && pnpm start`; compare `/`, `/blog`, `/sign-in`, `/app` in light/dark at 1280 and 380 px with the mockup.
- **Recipes not run by the reviewer:** `pnpm test:golden-path` (simulated) and `pnpm test:minimal-profile` — the golden path depends on the `/app` landing and should be run before shipping.
- **Mutation #1 under `socle`:** the recipe clones the committed state; covered by the green socle run on the fixed code and the i18n-on mutation.
- **Pending-deletion sign-in:** concluded from the code, not reproduced.
- **Real Inngest queue, real OAuth provider, keyboard/screen reader on the site header and its `Sheet`, impersonation banner on site/auth templates in a browser:** not exercised.

## Verdict
Max severity: minor
Ship allowed: yes
