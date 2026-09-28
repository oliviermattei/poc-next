# Review: story s62a-reglages-deplacement

> Fresh-context review (subagent `reviewer`). Diff reviewed: `git diff dev...feature/s62a-reglages-deplacement`, one commit (c9a1ede), 75 files. Worktree clean after every mutation (`git diff --exit-code`, `git status --porcelain` empty).

**The branch can ship: no critical or major issue, 9 minor ones. Every command was run by the reviewer, and all mutations turned tests red.**

## Plan compliance
- [x] Every plan task is done:
  - T1: `'settings'` added to `NavigationSurface`; `ACCOUNT_SCREEN_PATH` in auth `domain/redirect.ts`; organizations and billing constants point to the new paths; the three entries are `surface: 'settings'`.
  - T2: table in `apps/web/lib/legacy-paths.ts`, 308 in the proxy, frozen fixture.
  - T3: three screens moved (renames, 90–100 % similarity); sign-in `?next=` uses the constants.
  - T4: `app/(app)/app/settings/layout.tsx`.
  - T5: Stripe return URLs, guest checkout fallback, 303 redirects (`organization-routes.ts:141,175`), dashboard, onboarding and premium links, both account menus.
  - T6: e2e via `settingsPath()` (`e2e/support/locale.ts`), unit tests via imported constants.
  - T7–T8: recipes and docs.
- [x] Run interdicts checked: content of the three screens unchanged (only imports and `next`); `/notifications` untouched; every redirect target from the table (M1); no `redirects()` in `next.config.ts`; `packages/ui` untouched; no API route file added/removed/renamed; the full e2e was not run concurrently with another run (process check first).

**Declared deviations:**
1. `BILLING_SCREEN_PATH` moved to billing `domain/screen-path.ts` — accepted (ADR 006); re-exported by presentation and the barrel (`index.ts:171`).
2. Legacy table checked before the canonical language redirect — accepted: on the internal path (ADR 075), avoids a 307→308 double hop; M6 proves a test covers it.
3. `api/billing-local-checkout/route.ts` fixed though unlisted — accepted (criterion 4); redirects to the unprefixed constant, the proxy adds the locale.
4. Registry test in `tests/app-shell.test.ts`, other unlisted test files — accepted.
5. `packages/core/src/syndication.test.ts` not migrated — accepted: `/account` is an arbitrary path there.
6. Two `h1` per settings screen until s62b — minor (m1).
7. Labels unchanged — minor (m2).
8. New message keys `app.settings.title`, `app.settings.navigation` in fr and en — accepted; catalogue parity passes.

## Anti-hallucination
- [x] References opened: `shellNavigation(registry, session, intl, surface = 'app')` (`apps/web/lib/navigation.ts:36`); `visibleNavigation` (`@repo/core`); `SidebarNav({items,label,currentPath})` (`packages/ui/src/composed/sidebar.tsx:29`); `PageHeader`, `Separator` (`packages/ui/src/index.ts`); `carriesLocalePrefix`, `localeRouting.internalPath`/`publicPath`/`resolve` (`packages/core/src/i18n.ts`); `warmUpTargets` (`e2e/support/warm-up.ts:107`); `ORGANIZATIONS_SCREEN_PATH`, `BILLING_SCREEN_PATH` re-exports. The proxy already loaded `moduleRegistry` through `lib/locale-routing.ts`.
- [x] No wrong value or logic: 308 keeps the method; target is `publicPath(constant, locale) + search` (`search` always starts with `?`); origin from `request.url` like the existing canonical redirect; `/de/account` (unsupported prefix) finds nothing; i18n off → `publicPath` identity.

## Rules compliance
- [x] AGENTS.md: docs ship with the code (root and `apps/web` `AGENTS.md`, `architecture.md`, `design-system.md`, storage `AGENTS.md`); no module-name condition (the "module on?" check reads the registry navigation).
- [x] ADR 075 added (074 is on s67's branch, no collision); ADR 006 respected; 070–073 unaffected.
- [x] Design system: only `PageHeader`, `SidebarNav`, `Separator`; `12rem` column and missing `Tabs` written as gaps.
- [x] Security (open redirect): M1, M6, frozen table.

## Tests
| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test` | 3026 passed, 14 skipped |
| Targeted e2e (settings, app-shell, billing, organizations, not-found-zones) | 39 passed, 2 failed, 5 skipped; the 2 failures (`app-shell.spec.ts:470/486`, sign-in timeouts under load) pass alone |
| Full `E2E_PORT=3163 pnpm test:e2e` | 139 passed, 1 failed (`auth.spec.ts:177`, "no email captured" timing flake; whole `auth.spec.ts` passes alone 5/5), 11 skipped |
| `pnpm test:minimal-profile` | exit 0 (12 modules off) |
| `pnpm test:socle` | exit 0, 121 e2e passed (includes `settings.spec.ts` legacy `/organizations` → 404 and `not-found-zones:94` single-shell 404) |
| `GOLDEN_PATH_PAYMENTS=simulated pnpm test:golden-path` | exit 0, 4 passed |

| # | Mutation | Red |
|---|---|---|
| M1 | `proxy.ts` redirects to `searchParams.get('next') ?? …` (open redirect) | 1 |
| M2 | `legacy-paths.ts` always returns `target` (module-off gate removed) | 1 |
| M3 | `proxy.ts` looks up `pathname` instead of `internal` | 2 |
| M4 | billing entry loses `surface: 'settings'` | 2 |
| M5 | `billing-use-cases.ts` return URL back to `${appUrl}/billing${query}` | 2 |
| M6 | table consulted only after the canonical language redirect | 1 |
| M7 | `/billing` row deleted | 2 |

- [x] No redundant tests left: old `/account`-in-sidebar assertions rewritten against the `settings` surface.

## Regressions
- [x] None found: every caller of the old path strings migrated (only comments remain, m5); guest checkout's magic-link callback points to the new screen; `account`, `billing`, `organizations` stay reserved (derived from the table); the locale cookie is not written on a legacy 308 but on the next hop.

## Findings
- **m1 (minor, a11y)** — `app/(app)/app/settings/layout.tsx`: every settings screen renders two `<h1>` (["Réglages","Mon compte"], ["Réglages","Organisations"], ["Réglages","Facturation"]). Not a WCAG failure, but two level-1 headings for screen readers; the e2e `.first()` in `app-shell.spec.ts` (under-400 px case) now always picks "Réglages". **Must be written into s62b's criteria.**
- **m2 (minor, copy)** — criteria 1 and 5 and the design name the entries "Compte / Organisation / Facturation" and the menu item « Réglages »; shipped: « Mon compte », « Organisations », « Facturation », menu « Paramètres du compte ». Consistent with "contenu à l'identique"; to be settled in s62b.
- **m3 (minor, test)** — `tests/legacy-paths.test.ts` « ne tire jamais la cible de la requête »: no check that at least one URL actually redirected (vacuous if the proxy stopped redirecting; other cases catch that today).
- **m4 (minor, test)** — `e2e/settings.spec.ts`: `hrefsOf(page, 'Modules')` returns `[]` if the sidebar is not found; needs a positive presence check first.
- **m5 (minor, docs)** — comments still describe old paths as current: `apps/web/lib/billing.ts:59`, `apps/web/lib/organizations.ts:48`, `(app)/onboarding/page.tsx:24-25`, `(site)/pricing/page.tsx:29,53,58,170`, `packages/modules/onboarding/src/presentation/onboarding-screen.tsx:62`, `e2e/not-found-zones.spec.ts:27`, `e2e/golden-path/golden-path.spec.ts:269`.
- **m6 (minor, net scope)** — the source-literal net scans only `apps/web` and the auth, organizations, billing modules (written in `apps/web/AGENTS.md`).
- **m7 (minor, e2e stability)** — three flakes under full-suite load (`app-shell.spec.ts:470/486`, `auth.spec.ts:177`), each passing alone; not proven on `dev` under the same load.
- **m8 (minor, process)** — plan task 4's visual check left no recorded evidence; the reviewer made one (below).
- **m9 (minor, environment)** — the recipes' working-tree overlay misses staged pure renames (tracked by story s68).

## Not verified
- **Production build:** screenshots under `next dev` only (two-column layout with `aria-current`, stacked sub-navigation on mobile, 0 overflow at 380 px). Gesture: on `pnpm build && pnpm start`, open `/fr/app/settings/billing` desktop and 380 px, and `/fr/account?x=1` — one 308 hop to `/fr/app/settings/account?x=1`.
- **Real Stripe:** return URLs checked by unit test and simulated golden path only. Gesture: with test keys, finish a checkout and open the portal; Stripe must return to `/app/settings/billing?checkout=success`.
- **Payment returns already in flight** (sessions created before deploy returning to `/billing`): covered in principle by the proxy test.
- **Mixed configuration billing off / organizations on:** not run as its own configuration; unit test covers every table entry.
- **Screen readers:** the two-`h1` structure not tried with VoiceOver.

## Verdict
Max severity: minor
Ship allowed: yes
