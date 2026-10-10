# Research — Story s59-premier-deploiement

> Vérifiée contre `origin/dev` à `9f36ea9`, en lecture seule.
> Aucune exécution : ce conteneur porte le client Docker 29.8.2 **sans démon** (`/var/run/docker.sock` absent),
> donc l'image n'a été ni construite ni démarrée ici. Aucune base, aucun `.env`.

## Premise
**Tient.** Rien du mode production n'a été observé ailleurs que dans un conteneur jetable de CI :
- le job `image` (`.github/workflows/ci.yml:465-510`) valide la pile, construit `runner` et `migrator`,
  et démarre `runner` **sans variable** pour exiger un refus nommant `DATABASE_URL` — il ne sert jamais une page ;
- les parcours Playwright tournent sur `next dev` (`playwright.config.ts:282`), donc la CSP de production
  (nonce, sans `unsafe-inline`/`unsafe-eval`, `apps/web/lib/security-headers.ts:111,116`) n'a jamais été vue dans un navigateur ;
- `docs/deployment.md:21-22` dit « guide livré, exécution non faite » pour Coolify et Vercel, et
  `docs/reviews/s27-deployment.md:147,227` laisse les deux recettes manuelles ouvertes ;
- `tests/fixtures/stripe-events/` ne contient que son `README.md` (aucune capture réelle).

Une nuance, qui n'invalide pas la story : **le dépôt tel que livré ne démarre pas en production avec
des variables seules** (fait 1 ci-dessous). Le critère 1 demande donc une décision de configuration avant tout geste d'hôte.

## Story amendments proposed
1. **s59, critère 6** (« la détruire et la reconstruire depuis le dépôt donne le même résultat ») —
   préciser *depuis le dépôt **et la liste de variables consignée*** : l'instance dépend de valeurs qui ne sont pas dans le dépôt
   (clés, domaine), et un critère qui ne le dit pas se lit comme « sans rien d'autre ». Pourquoi : sans cette précision,
   la revue ne peut pas juger le critère.
2. **s59, notes** — dire que la recette se joue **sur un seul hôte** (`APP_HOST` vide). La recette à deux hôtes appartient à s64
   (`docs/deployment.md:368`, « La recette manuelle à deux hôtes »), et `docs/reviews/stories.md:145` (F112) relève déjà
   que s64 c12 suppose ce déploiement. Pourquoi : sinon s59 hérite en silence d'un second chantier (DNS, TLS, cookies parents).

## The five structuring facts
1. **Variables seules ne suffisent pas : trois modules activés par défaut exigent une édition de `config/` compilée dans l'image.**
   `storage` est activé (`config/features.ts:111`) ; en production le disque est refusé (`apps/web/lib/storage-config.ts:162`),
   l'absence de seau aussi, et un seau dont l'origine manque à `contentSecurityPolicySources.connect` (vide,
   `config/security.ts:53-61`) refuse le démarrage (`storage-config.ts:131-141`). Même règle pour PostHog
   (`apps/web/lib/analytics-config.ts:222-238`, `connect-src` **et** `img-src`). → éditer `config/security.ts`, ou couper `storage`.
2. **Le minimum pour démarrer avec la configuration livrée** (lu dans `startup.ts:43-87` et les résolveurs) :
   `DATABASE_URL`, `AUTH_SECRET` (≥ 32), `APP_URL` ; `RESEND_API_KEY` + `EMAIL_FROM` (capture locale acceptée mais aucun email ne part,
   ce qui tue le critère 2) ; `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (`PAYMENTS_LOCAL_MODE` refusé en production,
   `billing-config.ts:120`) ; le seau S3 complet ; `INNGEST_*` ou `JOBS_LOCAL_RUNNER=1` (acceptable sur une instance unique,
   `docs/deployment.md`, ligne `JOBS_LOCAL_RUNNER`). `SENTRY_DSN`/`SENTRY_RELEASE` pour le critère 4.
3. **Critère 4, probable défaut, non mesuré : les erreurs serveur risquent d'arriver non symbolisées.** Les cartes partent sous
   `~/_next/static/…` et `~/_next/server/…` (`scripts/source-maps-rules.ts:22,85`), mais l'adaptateur envoie comme `filename` le chemin
   disque brut de la pile (`packages/adapters/sentry/src/sentry-monitoring.ts:230-261`) — dans l'image, `/app/apps/web/.next/server/…`.
   Rien ne réécrit ce chemin (aucun `app:///`, `abs_path` ni `debug_id` dans l'adaptateur ou le script). Les erreurs **navigateur**,
   relayées par `/api/modules/analytics/client-error` (`apps/web/lib/report-client-error.ts:31`), portent des URL
   `https://<hôte>/_next/static/…` qui, elles, devraient correspondre.
4. **La recette des cartes ne marche que depuis l'étape `builder` de la même construction** (`Dockerfile:64-66`,
   `docs/deployment.md:509-545`) : envoyer les cartes d'un `pnpm build` local publie des empreintes que l'image ne sert pas.
   `SENTRY_RELEASE` doit être identique à l'envoi et à l'exécution ; le serveur la pose lui-même sur chaque événement (`analytics-config.ts:189`).
5. **La pile compose expose Next sans proxy** (`docker-compose.prod.yml:138-139`) ; or la limitation de débit lit le premier maillon de
   `x-forwarded-for` (`docs/deployment.md:221-293`). Un hôte public sans relais qui **écrase** l'en-tête laisse la limitation contournable :
   le relais fait partie de l'instance, et le vérifier est une recette déjà promise par s28.

## Target story
Propriétaire du produit : une instance déployée, pour vérifier que ce qui marche ici marche là-bas. Six critères, **tous en recette manuelle** :
1. image construite et **servie** sur un hôte autre que le poste, base et migrations dans leur conteneur ;
2. inscription → tableau de bord sur cette instance, avec un email réellement reçu ;
3. CSP de production sur la page servie : nonce par requête, aucun `unsafe-inline`, console muette ;
4. une trace d'erreur **lisible** chez le fournisseur ;
5. ce qui a été configuré à la main, et ce qui a échoué au premier essai, écrit dans `docs/deployment.md` ;
6. instance jetable : détruite puis reconstruite, même résultat.
Dépendances : s27, s39 — toutes deux livrées (`Ship allowed: yes`, `Max severity: major`).

## Current state of the code
- `Dockerfile` (141 l.) : `base` → `builder` (`SKIP_ENV_VALIDATION=1 pnpm build`, l. 43) → `pruned` (`sourcemaps:prune`) → `migrator`
  (`pnpm db:migrate`, non-root) ; `runner` = sortie autonome, `node:22-alpine`, `HEALTHCHECK` sur `/api/health` qui suit `PORT`.
- `docker-compose.prod.yml` (148 l.) : `postgres:16-alpine` sans port publié, `migrate` (`restart: "no"`), `web` dépendant de
  `migrate` par `service_completed_successfully`. Configuration par interpolation seule (bloc `x-application-environment`, l. 47-81).
- `docs/deployment.md` (677 l.) : tableau « exercé / non fait » (l. 9-22), checklist des variables gardée par
  `tests/deployment.test.ts` (l. 408-453), proxy (l. 221), deux hôtes (l. 295), cartes source (l. 492), Coolify (l. 563), Vercel (l. 627).
- CSP : `apps/web/proxy.ts:210-226,318-339` (nonce `randomUUID` par requête), le layout racine lit `headers()`
  (`apps/web/app/layout.tsx:71-73`) → tout le rendu est dynamique, condition pour qu'un nonce existe sur chaque page.
- Démarrage : `apps/web/lib/startup.ts:43-87` appelé par `next.config.ts` et `instrumentation.ts` ; refus = `process.exit(1)` (l. 202-211).

## Anchor points
- Configuration propre à l'instance : `config/security.ts` (`contentSecurityPolicySources`), `config/billing.ts` (`priceId` fictifs :
  `price_pro_monthly`, `price_pro_yearly`, `price_lifetime`, l. 55-88), `config/features.ts` (modules activés).
- Points d'entrée tiers à déclarer : webhook Stripe `<APP_URL>/api/modules/billing/webhook`
  (`packages/core/src/registry.ts:200` + `billing-routes.ts:33`), rappel Inngest `/api/modules/jobs/inngest` (`job-routes.ts:58`).
- Traces : `docs/reviews/s59-premier-deploiement.md` (hôte, date, version, observation, par critère) ; écarts → `docs/deployment.md`.

## Verified APIs / functions
- `assertStartupConfiguration(options?)` / `refuseStartupOnInvalidConfiguration()` — `apps/web/lib/startup.ts:43,202`.
- `resolveStorageConfig(env, declaredConnectSources = contentSecurityPolicySources.connect)` — `storage-config.ts:115`.
- `assertAnalyticsIsReachable(settings, { connect, img })` — `analytics-config.ts:222`.
- `onRequestError(error, request)` — `apps/web/instrumentation.ts:82` : runtime Node seul, `release: null`, complétée par la configuration.
- `parseStackFrames(stack)` — `sentry-monitoring.ts:243` : `{ filename, function, lineno, colno }`, 50 cadres max inversés.
- Scripts : `pnpm sourcemaps:release` / `sourcemaps:prune` → `scripts/source-maps.ts` (`package.json:26-27`) ; exige `SENTRY_ORG`,
  `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`, `SENTRY_RELEASE` — aucun n'est dans le schéma ni dans compose, c'est voulu (hôte seul).

## Traps & constraints
- **Éditer `config/security.ts` pour un seau ou PostHog d'une instance de démonstration, c'est commiter une origine propre à cette instance
  dans le boilerplate.** À trancher au plan (fait 1, question 1).
- `tests/deployment.test.ts` compare la liste de compose et la checklist de `docs/deployment.md` à `ENV_KEYS` **dans les deux sens** :
  toute variable ajoutée ou renommée doit toucher les trois fichiers.
- `tests/analytics.test.ts` refuse une recette de cartes qui désignerait une étape déjà élaguée (`pruned`, `runner`).
- `up -d --build` sur une pile en service détruit `web` avant `migrate` (`docker-compose.prod.yml:112-117`) : pour le critère 6,
  `run --rm migrate` d'abord, puis `up`.
- `NODE_ENV` vide vaudrait `development` pour `migrate` (pas de filet Next) : le défaut `production` du bloc compose y compte.
- `SKIP_ENV_VALIDATION` / `NEXT_PHASE` ne doivent jamais arriver à l'exécution (`docs/deployment.md:455-463`).
- Une correction de code révélée par la recette (fait 3, par exemple) est **un défaut, pas cette story** (`AGENTS.md`,
  « What is a story ») : l'issue tracker, sauf décision humaine de l'inclure — avec ses tests, ce qui change la piste.
- `docs/STATE.md` est périmé (05/09) : il ne fait foi sur rien ici.

## Open questions
1. **Quel hôte, quel domaine ?** Coolify (le guide recommande l'option B, compose — `docs/deployment.md:592`), un VPS nu avec relais,
   ou Vercel (qui ne joue ni `migrator` ni compose : il ne prouverait pas le critère 1 tel qu'écrit). Choix humain.
2. **`storage` : seau réel + origine dans `config/security.ts`, ou module coupé pour l'instance ?** Le second change le profil
   déployé et ne prouve plus l'avatar ; le premier commite une origine d'instance.
3. **Jobs : Inngest réel ou `JOBS_LOCAL_RUNNER=1` ?** Le second suffit pour une instance unique et réduit les clés.
4. **PostHog** : hors critères — le laisser vide évite une édition de `config/security.ts`.
5. **Sentry, fait 3** : les cadres serveur `/app/apps/web/.next/server/…` sont-ils rapprochés des artefacts `~/_next/server/…` ?
   Seule la recette le dit. Si non, le critère 4 se prouve sur une erreur **navigateur** et l'écart serveur part en issue — à acter au plan.
6. **Domaine d'envoi Resend** vérifié (SPF, DKIM, DMARC) disponible ? Sans lui, le critère 2 tombe.
7. **Stripe** : les `priceId` fictifs ne gênent pas les critères (aucun paiement demandé), mais un clic sur une offre échouera chez Stripe.
   À écrire dans `docs/deployment.md` (critère 5) plutôt qu'à corriger ici.
8. Le compte « onze rapports » de la story n'a pas été recompté : un `grep` large (« build de production », « next start ») touche
   27 revues, sans que chaque occurrence soit une réserve de ce type.

## Real complexity
Notée **3** dans `docs/stories.md`. **Verdict : 3.** Côté dépôt, la story livre surtout de la documentation (`docs/deployment.md`,
la revue) et éventuellement une configuration ; l'effort et le risque sont dans les gestes humains (hôte, DNS, quatre fournisseurs)
et dans ce que la recette révélera. Elle ne peut pas être jouée par un agent seul : le plan doit séparer ce que l'agent prépare
(checklist de l'instance, commandes exactes, gabarit de trace) de ce que le propriétaire exécute. Piste `full` selon `Story track: auto`
(3 > `Flow threshold` 2).

## Split proposal
Non requise. Si la recette révèle des défauts (fait 3, relais, `priceId`), ils partent en issues ; la story ferme sur les observations.
