# Review — Story s39-monitoring-analytics

> Revue en contexte neuf, dans `.worktrees/s39-monitoring-analytics` sur `feature/s39-monitoring-analytics`.
> Diff jugé : `git diff dev...feature/s39-monitoring-analytics` (75 fichiers, +4309).

## Conformité au plan
- [x] Les dix tâches du plan sont dans le diff. La tâche 6 (régime réel) ne couvre que PostHog — ce que la lettre du plan demande ; Sentry n'a pas de régime réel, et c'est cohérent.
- [x] Les cinq écarts déclarés, jugés sur leurs mérites : tâche 4 après la tâche 8 est **fondé** — le plancher des appelants mord (retirer l'émission à l'inscription rend `expect(callers.length).toBeGreaterThanOrEqual(1)` rouge). Quatre fichiers de test au lieu de deux se justifie (chacun à côté de son code ; le régime réel *doit* être un fichier séparé pour être gardé par `runIf`). Les quatre tests existants modifiés sont du câblage, pas un affaiblissement — `tests/consent.test.ts` devait couper `analytics` avec `consent`, c'est `requires: ['consent']` qui mord. `scaffoldFiles()` par un script temporaire n'a laissé aucun résidu.
- [ ] **Des ajouts hors plan expédiés sans garde** — constats 1 à 3. La lettre du plan est tenue ; trois des quatre nouveaux points de composition n'ont aucun test.

## Anti-hallucination
- [x] Chaque import et API ouvert et vérifié : `defineModule`, `MODULE_ROUTE_PREFIX`, `ModuleRoute`, `buildRegistry`, `routeIsRateLimited` (`packages/core/src/registry.ts:224`), `resolveConsentState`, `NonEssentialScript` (`consent/src/domain/consent-category.ts:40`), `runInBackground` (`better-auth-service.ts:321`), `databaseHooks.user.create.after` (aucune collision avec la clé `user:` de la ligne 662), `loadRootEnv`, `contentSecurityPolicySources` (`config/security.ts:53`).
- [x] Les props de `GlobalError` vérifiées contre `node_modules/next/dist/client/components/error-boundary.d.ts` — `error: unknown` et `retry` réels. Aucun `app/error.tsx` n'existe : `global-error.tsx` est bien la seule frontière React.
- [ ] **Plausible mais faux** : le script PostHog déclaré est inerte (constat 6) ; la recette documentée de publication des cartes source publie les cartes d'un build qui n'est pas celui qui est servi (constat 7).
- [ ] **Quatre commentaires affirment un test qui n'existe pas** (constat 4), et un `AGENTS.md` annonce un balayage qui ne couvre que la moitié de ce qu'il nomme (constat 5).

## Conformité aux règles
- [x] `pnpm lint` propre (frontières de couches, ADR 006), `pnpm typecheck` propre (35 packages).
- [x] ADR 008 (une implémentation par port), ADR 050 (la nouvelle route publique hérite de la limitation **par dérivation** — vérifié et non pris sur déclaration : porter `PUBLIC_ROUTES_MEASURED` de 26 à 27 dans `tests/rate-limiting.test.ts` passe toujours, et le même test exige `uncovered` vide sur toutes les routes publiques), ADR 049 (garde de démarrage atteinte par `instrumentation.ts`), ADR 041, ADR 035/036 : respectés.
- [x] `not_configured` comme valeur plutôt qu'un `ok:true` silencieux respecte la règle des modes locaux. Les deux ports **dégradent** ; `rate-limit` reste le seul qui refuse.
- [x] Chaque package porte son `AGENTS.md` ; toutes les clés du contrat sont remplies.
- Story sans UI : pas de contrôle design system.

## Tests
- [x] Suite rejouée par la revue : `pnpm test` → **89 fichiers, 2605 cas verts, 14 sautés**. Également `pnpm lint`, `pnpm typecheck`, `SKIP_ENV_VALIDATION=1 pnpm build`, et **`pnpm test:minimal-profile`** (5 parcours verts, `analytics` parmi les 10 modules coupés — la garantie inter-modules de la tâche 10 tient dans la configuration coupée, celle que la CI joue).
- [x] Les assertions portent sur les charges utiles **capturées**, pas sur l'intention. Aucun test décoratif ou sans assertion.
- [x] **Morsure prouvée par neutralisation** (chacune restaurée, `git diff --exit-code` propre après) :

| # | Neutralisé | Rouges |
|---|---|---|
| 1 | `isSensitiveFieldName` → toujours faux (les deux `redact.ts`) | **2** — les deux cas du critère 2, sur la requête capturée |
| 2 | `createAnalytics(null)` construit l'adaptateur réel | **3** — dont la garde « aucun appel sortant » de `tests/auth.test.ts` |
| 3 | `postOnce` remplacé par `{ok:true}` | **9** — le plancher du régime enregistré tire |
| 4 | `mountedModules.includes(ANALYTICS_MODULE_ID)` retiré de `lib/consent.ts` | **3** — dont la bannière dérivée |
| 5 | `runInBackground(analytics.track(SIGN_UP_EVENT…))` retiré | **2** — bout en bout **et** plancher des appelants |
| 6 | second importeur de `@repo/adapter-posthog` | **1** |
| 7 | appel à `assertAnalyticsIsReachable(...)` retiré de `lib/startup.ts` | **0** |
| 8 | corps de `onRequestError` vidé + `<ClientErrorReporter/>` retiré | **0** |
| 9 | `prepareAnalytics()` décâblé de `lib/module-services.ts` | **0** |
| 10 | `unauthorized`/`not_configured` reclassés transitoires dans les deux adaptateurs | **0** |
| 11 | second importeur de `@repo/adapter-sentry` | **0** |

  Les planchers tiennent : `capturedBody([])` / `capturedEnvelope([])` refusent, et la mutation 3 montre qu'un adaptateur muet rend les captures **rouges** au lieu de vertes — ce n'est pas le régime `recorded` vide du parcours doré.
- [x] L'exemption de `tests/fixtures/intermittents.ts` est légitime et correctement portée : `tests/analytics.test.ts` n'entre dans le balayage que parce qu'il **lit** `next.config.ts` en texte (ligne 304), il ne charge jamais le graphe ; `tests/intermittents.test.ts:345` refuse par ailleurs une entrée périmée. Mesure annoncée cohérente avec l'observation (1,77–1,94 s isolé).

## Régressions
- [x] `resolveNonEssentialScripts` gagne un second paramètre par défaut — appelants existants inchangés.
- [x] `AuthDependencies.analytics` est obligatoire et fail-closed ; `tests/env-wiring.test.ts` exige `analytics:` au point de composition.
- [x] `productionBrowserSourceMaps: true` vérifié de bout en bout : 25 cartes navigateur écrites, `pnpm sourcemaps:prune` retire exactement ces 25 et laisse les 259 du serveur. L'étape du `Dockerfile` suit `pnpm build`, et la CI construit bien l'image.
- Observé hors diff : la suite rejouée ~8 fois d'affilée contre la base locale persistante produit des échecs sporadiques (`tests/data-export.test.ts`, fenêtres 2FA — accumulation de seaux de limitation, le phénomène déjà documenté pour `pnpm test:e2e`). Runs 1, 2, 3 et final verts.

## Constats

- **major** — `apps/web/instrumentation.ts:79` + `apps/web/app/global-error.tsx:56` — les deux points de capture du critère 1 n'ont **aucune garde à leur propre site**. Vider `onRequestError` et supprimer `<ClientErrorReporter error={error} />` laisse **2605 cas verts**. Seules les fonctions feuilles sont testées ; rien ne prouve qu'une erreur non rattrapée les atteigne.
- **major** — `apps/web/lib/module-services.ts:110` — retirer `prepareAnalytics()` laisse **0 rouge**, alors que le commentaire de la ligne annonce qu'en son absence `/api/modules/analytics/client-error` répond **500**. Mode de défaillance réel, non testé.
- **major** — `apps/web/lib/startup.ts:163` — retirer l'appel à `assertAnalyticsIsReachable(...)` laisse **0 rouge**. C'est exactement le défaut mesuré par la revue de s33, dont la leçon est écrite quelques lignes plus loin (`tests/env-wiring.test.ts:336-343` : « retirer `assertJobsConfiguration(env)` laissait 2 407 cas verts »). s33 avait ajouté un cas par `loadNextConfig()` ; s39 n'en ajoute aucun.
- **major** — `packages/ports/src/analytics.ts:71`, `packages/ports/src/monitoring.ts:62`, `posthog-analytics.ts:85`, `sentry-monitoring.ts:165` — les quatre affirment que `tests/analytics.test.ts` confronte `isTransient*Error` à `ANALYTICS_ERROR_CODES` / `MONITORING_ERROR_CODES`. **Ce test n'existe pas.** Reclasser `unauthorized` et `not_configured` en transitoires laisse la suite verte. Le motif qui marche était disponible et n'a pas été copié : `tests/jobs.test.ts:215-228`.
- **major** — `apps/web/AGENTS.md:26-31` — la règle annonce que `tests/analytics.test.ts` refuse tout importeur de `@repo/adapter-posthog` **et** de `@repo/adapter-sentry`. Le balayage ne connaît que posthog. Vérifié : un second importeur de sentry passe, le même geste avec posthog rougit.
- **major** — `packages/modules/analytics/src/domain/analytics-script.ts:51` — le script déclaré est `<host>/static/array.js`, **sans initialisation ni clé de projet nulle part dans le bundle client**. Le chargeur PostHog définit `window.posthog` et n'initialise rien sans un `posthog.init(key, …)` en file. En l'état, un exploitant qui pose `POSTHOG_KEY` obtient : une bannière demandant au visiteur d'autoriser un tiers, un bundle téléchargé chez ce tiers à l'acceptation, et **zéro mesure**. `Analytics.page()` reste sans appelant.
- **major** — `docs/deployment.md` §« Les cartes source », `Dockerfile:43`, `.dockerignore` — la recette documentée est `pnpm build` → `pnpm sourcemaps:release` → `docker build`. L'image **exclut** `.next` de son contexte et rejoue son propre `pnpm build` : les empreintes des chunks servis ne sont pas celles dont les cartes ont été publiées. Une trace navigateur reste non symbolisée.
- **minor** — `packages/adapters/sentry/src/index.ts:5` et `analytics-runtime.ts:9` désignent `apps/web/lib/monitoring.ts`, qui n'existe pas. Le point de composition est `apps/web/lib/analytics.ts`.
- **minor** — `packages/adapters/posthog/AGENTS.md` — « toute lecture d'une requête capturée passe par une fonction qui échoue sur un ensemble vide » est faux : `posthog-analytics.test.ts:122` lit `network.requests.at(-1)` directement. (Le « mesuré : 7 cas » voisin, lui, est exact.)
- **minor** — `scripts/source-maps.ts:39-61` — `collectMaps` parcourt tout `.next`, y compris `.next/build` et les doublons de `.next/standalone` : 326 fichiers `.map` mesurés, dont 25 seulement sont des chunks navigateur. Seule la moitié « élagage » filtre correctement.
- **minor** — `client-error-routes.ts:64` — la route publique laisse un appelant anonyme pousser 120 événements/minute/client d'environ 21 Ko dans le quota Sentry de l'exploitant. Borné et conforme à l'ADR 050, mais l'arbitrage n'est écrit nulle part.
- **minor** — `apps/web/instrumentation.ts:76` — « Elle n'attend pas » contredit le `await appMonitoring().capture(...)` trois lignes plus bas.
- **minor** — `AGENTS.md:158` mélange le français dans une phrase anglaise ; `packages/adapters/sentry/AGENTS.md` tutoie au lieu d'écrire.

## Non vérifié

- **Aucun compte PostHog, aucun compte Sentry.** `posthog-live.test.ts` n'a jamais tourné vert ; seule sa branche « armé sans clé » a été exercée. Rien ne prouve que l'un ou l'autre fournisseur **accepte** ce que les adaptateurs émettent : la forme du corps (`/i/v0/e/`) et l'enveloppe en trois lignes sont écrites d'après la documentation, pas d'après une réponse enregistrée. **Geste humain** : `POSTHOG_LIVE_TEST=1 POSTHOG_KEY=… POSTHOG_HOST=… pnpm vitest run packages/adapters/posthog/src/posthog-live.test.ts`, puis ouvrir le flux d'activité PostHog et y confirmer `boilerplate.live_check`. Aucune recette équivalente n'existe pour Sentry.
- **Aucun passage navigateur de la moitié client du critère 1.** `ClientErrorReporter` n'a jamais été vu tirer, ni le POST vers `/api/modules/analytics/client-error`, ni le 204.
- **Aucun passage navigateur du chemin consentement → script avec une vraie clé.** Le constat 6 repose sur la lecture du code et du contrat du chargeur PostHog, pas sur l'observation de la page.
- **Aucune symbolisation vérifiée.** `pnpm sourcemaps:release` n'a jamais tourné (il lui faut `SENTRY_AUTH_TOKEN`) ; seul `prune` l'a été, de bout en bout.
- **Image Docker non construite par la revue.** Le nouveau `RUN pnpm sourcemaps:prune` est exercé par la CI.
- **`pnpm test:e2e` non joué** (pas de navigateur provisionné) ; `pnpm test:minimal-profile` l'a été et passe.

## Verdict

Sept constats majeurs, aucun critique. Rien ici n'expédie de faille : le filtrage est réel et porte sur la charge capturée (mutation 1), le port sans clé n'émet rien (mutation 2), aucun secret n'atteint la télémétrie, aucune source CSP n'est élargie, et les cartes sont élaguées avant l'empaquetage. Ce qui est cassé, c'est le **filet** : quatre points de composition peuvent être supprimés avec 2605 cas verts, quatre commentaires affirment une garde jamais écrite, et la capacité vedette côté client — un script PostHog dont on demande le consentement au visiteur — ne mesure rien.

Max severity: major
Ship allowed: yes
