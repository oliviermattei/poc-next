# Review — Story s64c-hote-cookies

> Fresh-context review. Each issue classified: critical / major / minor.
> Diff reviewed: `git diff dev...feature/s64c-hote-cookies` (one commit, `02340a6`).

Review status: complete

## Plan compliance
- [x] The code does what the plan specifies, nothing more. Tasks 1-8 all present in the diff: ADR 081 in `proxy.ts` (`host` only, `no-store` on routing 308s); consent `cookieDomain` dependency + two `set-cookie` via `Headers.append`; locale on the parent + host-copy clearance appended after `cookies.set`; duplicate detection in the proxy; `lib/auth.ts` reads the last occurrence; session/2FA "no Domain" unit test; split golden-path step; `docs/deployment.md`, `docs/prd.md`, `docs/reviews/stories.md`. Nothing outside the plan's file list.
- [x] Run interdicts, each checked:
  - No `Domain` / `crossSubDomainCookies` on session, 2FA or impersonation: `better-auth-service.ts` untouched; `SESSION_COOKIE_ATTRIBUTES` (`:329-334`) has no `domain`; `serializeSessionCookie` (`auth/src/domain/impersonation.ts:74`) emits `Domain` only from those attributes.
  - No re-emission of a consent value outside a visitor choice: the proxy only appends `consentHostCopyClearance()` (empty value, `Max-Age=0`); the value is written by the consent route only. Proved by `tests/host-routing.test.ts` "sans ré-émettre sa valeur" (exactly one `set-cookie`, the clearance).
  - Without `APP_HOST`, `set-cookie` byte-identical to `dev`: `consentCookieDomain` → `null`, proxy `cookieDomain` → `null`, `clearHostCopies` returns early. Pinned by the literal-string test in `tests/consent.test.ts`.
  - No read of `x-forwarded-host` in `apps/web`: `grep -rni forwarded-host apps/web` → only the comment at `proxy.ts:20`.
  - `tests/rate-limiting.test.ts` 2FA cookie names: untouched by the diff.
- [ ] Plan "point everything turns on" (c): "la valeur lue en cas de doublon doit être celle du parent — à confirmer au navigateur dans le parcours doré". **Not done.** The golden-path step checks there is one parent-domain copy after a fresh refusal; no host-only copy is seeded first, so the duplicate ordering is never observed in a browser. The verification record does not list this under "Not proven here". See finding 1.

## Anti-hallucination
- [x] No invented API. Opened: `CONSENT_COOKIE` / `consentHostCopyClearance` / `ConsentCookieScope` (exported from `packages/modules/consent/src/index.ts`), `resolveAuthConfig` (`apps/web/lib/auth-config.ts:40-64`, `siteUrl` = `APP_URL`, `appUrl` = application origin), `getHostRouting` (`packages/config/src/env.ts:880-896`, `siteOrigin` = `APP_URL` origin), `LOCALE_COOKIE` (`lib/locale-routing.ts`), `Headers.getSetCookie` / `append` (standard), `NextResponse.cookies.set({ domain })` (Next `ResponseCookies`). The only consumer of `useCases.record` is `consent-routes.ts`; `setCookie` → `setCookies` has no other caller.
- [x] Values checked: the parent domain is `hostname` (no port) in both computations (`consentCookieDomain` and the proxy), taken from configuration, never from a header; both agree (`APP_URL` hostname). Clearance attributes (`Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, no `Domain`) satisfy `docs/security.md` l.17 (HttpOnly, Secure, SameSite≥Lax). `Path=/` matches the written cookies, so the clearance targets the right (name, host-only, path) key.
- [x] The code matches its claims. "Le parent fait foi" relies on: Next keeps the last occurrence (`request.cookies`, `cookies()` → `@edge-runtime/cookies` `map.set`), browsers send same-path cookies oldest-first, and every write under `APP_HOST` goes to the parent. `lib/current-locale.ts:44` and `lib/consent.ts` `currentConsent` read through Next's jar (last); `lib/auth.ts` now reads `.at(-1)`. Consistent.

## Rules compliance
- [x] Repo conventions followed; one story commit; story docs travel with the branch.
- [x] ADR 081 applied as written (amends ADR 079, which stays immutable). ADR 079/078 not contradicted: targets still built from configuration.
- [x] No UI in the story: design system not applicable.
- [x] Framing docs accurate. `docs/prd.md` "Déploiement" row now names the optional `APP_HOST`, the owner decision of 27/09, s64a/s64b1/s64b2/s64c, and s65 deferred — matches `docs/stories.md`. `docs/reviews/stories.md`: F88 closed at l.40 and in the follow-up table, F74 kept open; the "tableau Replicated compte toujours 24 lignes" statement stays true (a row edited, none added). `docs/deployment.md`: "pas encore supportée" removed from the `APP_HOST` row; OAuth callbacks moved to the application origin, matching `baseURL = appUrl`; Host forwarding per proxy (nginx `proxy_set_header Host $host;`, Traefik `passHostHeader`, Caddy default) is correct.

## Tests
- [x] Verification record checked by hand (`ks-gate` not installed): `Tree: c97db641…` is a tree object; `git diff --quiet c97db641… HEAD -- . ':(exclude)docs'` → exit 0, and the only path differing from HEAD's tree is `docs/verif/s64c-hote-cookies.md`. `Verification status: complete`, every exit code 0 (`pnpm test` 3131 passed / 14 skipped, `pnpm test:sans-env`, `pnpm lint`, `pnpm typecheck` 37/37, golden path split and single-host). **Current, taken as proof**: full suite and type check not re-run. Lint taken as reported.
- [x] Assertions pin the criteria (attributes, count and order of `set-cookie`, literal pre-story header, `cache-control`, last-occurrence reads, browser cookie domains).
- [x] Bite proven by neutralization, focused files only, each restored and `git diff --exit-code` clean:
  1. `consentHostCopyClearance` given a `Domain` → **3 red** (`consent.test.ts`, `tests/consent.test.ts`, `tests/host-routing.test.ts`).
  2. `proxy.ts`: `x-forwarded-host` read again + `Domain` on the locale clearance + `no-store` removed → **4 red** (`tests/host-routing.test.ts`: hostile case, no-store, locale on parent, last occurrence).
  3. Clearance appended *before* `cookies.set` (ordering) + `consentCookieDomain` returning a domain without `APP_HOST` + `lib/auth.ts` reading the first occurrence → **3 red** (one per mutation: host-routing, consent "identique à avant", auth "dernière occurrence").
  4. `domain` added to `SESSION_COOKIE_ATTRIBUTES` → **1 red** (`tests/auth.test.ts` "aucun Domain"; database reachable, test not skipped).
- [x] Volume: ~14 new cases, under the budget of 25. The replaced hostile-case row is the one ADR 081 made obsolete.

## Regressions
- [x] Touched paths: every proxy exit now passes through `clearHostCopies`, which is a no-op without `APP_HOST`; the security headers are set before and are not overwritten (`no-store` survives, asserted). The consent route's response is identical without `APP_HOST` (literal test). `readRequestLocale` newly exported, only for the test. No other writer of `app_consent` / `app_locale` exists (`grep`).

## Findings
1. **major** — `e2e/golden-path/golden-path.spec.ts:308-347` / `docs/verif/s64c-hote-cookies.md` — The plan's pivot (c) "la valeur lue en cas de doublon doit être celle du parent — à confirmer au navigateur dans le parcours doré" was not done: the split step never seeds a host-only `app_consent` before the choice, so "the parent wins over an old host copy, and a refusal is never masked" (criterion 2) is argued from RFC 6265 cookie ordering and proved only on hand-written `Cookie` headers in unit tests. The record does not list this gap. The impact is bounded: the first response after a duplicate would read the stale value, and the same response clears the host copy. Fix next cycle: in the split golden path, add a host-only `app_consent` on the site origin (`context.addCookies` without `domain`), refuse on the application host, then check that the site reads the refusal and that the host copy is gone.
2. **minor** — `apps/web/proxy.ts:136-138` (and the auth non-GET 404 on the site host) — The host-dependent routing 404s carry no `Cache-Control: no-store`, although criterion 5 says "les réponses qui dépendent de l'hôte le déclarent (`Vary`) ou ne sont pas cachables". Since `Host` alone now decides, and shared caches key on `Host`, there is no poisoning vector left (#67 is closed). Only a 404 cached across a configuration change remains possible, which is the reason ADR 081 gave for putting `no-store` on the 308s.
3. **minor** — `packages/modules/consent/src/domain/consent.test.ts:180` and `tests/consent.test.ts` — The Domain-less clearance rule is asserted at two layers, the domain and the route (testing-doctrine cut 3). Mutation 1 turned both red: a duplicate, not a hole.
4. **minor** — `apps/web/proxy.ts` `writesLocale` — A visitor whose host-only `app_locale` already matches the URL locale is never migrated to the parent, so the language does not follow to the application host until the visitor changes it. This is consistent with the documented rule ("à la première écriture"), but criterion 2 reads more broadly. Consent is deliberately not migrated (retention), so it is not affected.

## Not verified
- **Criterion 4, manual two-host production recipe** (`docs/deployment.md`, « La recette manuelle à deux hôtes »): written, deliberately not run. It needs a human, two resolved names and TLS. This is not a defect of the implementation. Human gesture: follow steps 1-5 with Caddy `tls internal` on `exemple.test` / `app.exemple.test`, then record the trace in the GitHub issue to open at ship.
- **Duplicate ordering in a real browser** (finding 1), and in any engine other than Chromium: Safari and Firefox were never exercised. Gesture: in DevTools, create a host-only `app_consent` on the site, refuse on the application host, reload the site, check that the banner stays hidden and that only `.domain` remains.
- **The locale parent cookie in a browser**: only unit-tested on the proxy output. Its travel through Next's middleware to the browser and its visibility from the application host were not measured. The recipe's step "changer de langue sur le site… la langue suit" covers it.
- **The two-factor challenge cookie in a browser**: asserted on the HTTP response only, since the golden path has no 2FA account (disclosed in the record).
- `pnpm test:e2e` and `pnpm build`: at ship (`E2E stage: ship`, `Build stage: ship-if-route`, `proxy.ts` changed, so the build is due).
- The `recorded` payments regime of the golden path: both runs were `simulated`.

## Verdict
Max severity: major
Ship allowed: yes
