# Review: story s62b-reglages-decoupage

Review status: complete

> Fresh-context review (subagent `reviewer`). Diff reviewed: `git diff dev...feature/s62b-reglages-decoupage` (one commit, `ba1595e`, 69 files). Tree clean at the end (`git diff --exit-code` exit 0).

**The story can ship: nothing critical or major.** The four flagged points hold (fixture against s62a, 303 returns per rubric, one `h1`, 308 targets constant). Six minor findings. The branch merges cleanly into `dev` after s67.

## Commands run by the reviewer
No `docs/verif/s62b-reglages-decoupage.md` exists, so everything was run by the reviewer:

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 (37/37, Turbo cache) |
| `pnpm lint` | exit 0 |
| `pnpm test` | exit 0 — 3033 passed, 14 skipped |
| `E2E_PORT=3414 pnpm test:e2e e2e/settings.spec.ts e2e/app-shell.spec.ts e2e/organizations.spec.ts` | first run 7 failed / 20 passed (navigation aborts and 5 s sign-in timeouts on a cold dev server with parallel workers) |
| same specs rerun alone, `--workers=1` | 23 passed, 1 skipped, 0 failed |
| `pnpm test:minimal-profile` | exit 0 (6/6 journeys) |
| `pnpm test:socle` | exit 0 (125 passed, 27 skipped; audit clean; tree clean) |

Full e2e in the default configuration: not run (socle replayed the whole browser suite in its configuration). No other Playwright or recipe process was running (checked with `ps`).

**Merge check:** `git merge-tree --write-tree dev HEAD` exit 0 (tree `ef7c9b4`); s67 touched `redirect.ts`, `auth-routes.ts`, `e2e/rgpd.spec.ts`, `tests/i18n.test.ts` in regions this branch does not touch; none of the names this branch removes or renames appear in s67's added lines. The merged tree itself was not typechecked.

## Plan compliance
- [x] All eight tasks present; nothing outside the plan except the declared deviations:
  - account-side actions use client fetch + `router.refresh()` — `auth-routes.ts` has no 303 back to a screen; nothing to change (task 4's wording described something that does not exist);
  - new Members "no current organisation" branch — acceptable, but untested and its copy is off (m2);
  - refusal parsing moved to `organizationRefusalKey` — same Zod enum, written once;
  - `billing-screen.tsx` opens with an `h2` — required for the single-`h1` criterion;
  - removed message keys — no remaining reference;
  - avatar URL out of the fixture — data, not an action;
  - `SignOutButton` kept unused (m3); stale `docs/architecture.md:237` (m1).
- [x] Run interdicts: no card rewritten (JSX moved with the same props and routes); `packages/ui` untouched, `PageHeader` unchanged; top bar and notification preferences untouched; redirect targets constant; no concurrent full e2e.

## Anti-hallucination
- [x] New references verified: `PROFILE_SCREEN_PATH`, `SECURITY_SCREEN_PATH`, `MEMBERS_SCREEN_PATH`, `CONSENT_SETTINGS_SCREEN_PATH`; re-exports in `lib/auth.ts`, `lib/organizations.ts`; `ORGANIZATION_REFUSALS`, `INVITATION_REFUSALS`, `refusalMessageKey`; `#create-organization` (`organizations-screen.tsx:536`); navigation order 2/3/20/25/40/50 matching the design.
- [x] **Fixture vs s62a:** compared with `git show 'dcd0102:apps/web/app/(app)/app/settings/account/page.tsx'` and `organizations-screen.tsx` at `dcd0102` — 11 account cards plus the sign-out header action, 6 organization blocks, all present with the right routes; non-action links (`/sign-in` destinations, `#…` anchors) left out, acceptable.
- [x] **308 table:** `/account` and `/app/settings/account` → `ACCOUNT_SCREEN_PATH` = `PROFILE_SCREEN_PATH` (constant); `/account` goes to Profil in one hop; proxy unchanged; `legacyScreenTarget` reads only the table and the registry.

## Rules compliance
- [x] AGENTS.md conventions followed; package `AGENTS.md` files updated; the "2 red there, 9 in `tests/organizations.test.ts`" claim matches the measurement.
- [x] No ADR contradicted (075 table, 066/067 surfaces).
- [x] Design system: `h2` on the system's `h2` scale, `text-muted-foreground` descriptions, `Separator` above "Vos données", destructive border kept, no new component or token; the repeated inline `h2` recorded as a gap in `docs/design-system.md`.

## Tests: bite proven by neutralization
| # | Mutation | Test | Result |
|---|---|---|---|
| 1 | sessions card removed from Sécurité | `rendered-text -t "sans perte"` | 1 red |
| 2 | passkey `revokeAction` pointed at the rename route | same | 1 red |
| 3 | invitations card hidden on Membres | same | 1 red |
| 4 | avatar card hidden on Profil | same | 1 red |
| 5 | invite returns to `ORGANIZATIONS_SCREEN_PATH` | `organization-routes.test.ts` + `tests/organizations.test.ts` | 11 red |
| 6 | `/app/settings/account` removed from the table | `tests/legacy-paths.test.ts` | 2 red |
| 7 | Cookies renders a `PageHeader` (second `h1`) | `e2e/settings.spec.ts` | 1 red |

Test volume within budget; superseded assertions rewritten, not left behind.

## Regressions
- [x] Onboarding imports moved to `profile/`; both account menus use `ACCOUNT_SCREEN_PATH` (Profil); e2e `signOut` goes through the account menu; `settingsPath('account')` resolves to Profil (no 308 hop); socle and minimal-profile green.

## Findings
- **m1 (minor)** — `docs/architecture.md:237` still lists `/app/settings/{account,organization,billing}`; `account` is now an old path answering 308.
- **m2 (minor)** — `organizations-screen.tsx`, `NoCurrentOrganization`: with organizations but none chosen, "Choisir une organisation" is followed by `current.description` ("Vos données sont rattachées à cette organisation."), about an organization that is not there; neither state is tested.
- **m3 (minor)** — `apps/web/app/sign-out-button.tsx`: `SignOutButton` unused (only `signOut` is imported), keeping `app.account.signOut` alive.
- **m4 (minor)** — `packages/modules/billing/src/presentation/pricing-table.tsx:28`: comment still says `BillingScreen` carries a `PageHeader`.
- **m5 (minor)** — `apps/web/messages/{fr,en}.json` `app.dashboard.empty.action`: the dashboard link to `ACCOUNT_SCREEN_PATH` still says "Paramètres du compte" / "Account settings" while the menu says "Réglages" / "Settings".
- **m6 (minor)** — the no-loss test checks the sign-out action against the shared account menu, rendered on every rubric; it can only fail if the menu loses sign-out.

## Not verified
- Default-configuration full e2e suite (CI should confirm with parallel workers); `pnpm test:golden-path`; the merged tree (dev + branch) typecheck/test.
- No real browser: the six rubrics in fr/en on desktop and 390 px; the "Vos données" zone on Profil; Membres with organizations but none selected, and with none (m2); an old `/app/settings/account` bookmark (one hop to Profil); invite and role change without JavaScript landing on Membres.
- The consent card's real preference flow (`e2e/consent.spec.ts` not run).

## Verdict
Max severity: minor
Ship allowed: yes
