---
story: s19-subscribe-stripe
validated: yes
---

# Plan — s19-subscribe-stripe

Recherche : `docs/research/s19-subscribe-stripe.md` · Design :
`docs/designs/s19-subscribe-stripe.md` · Décisions : ADR 034 et ADR 037.

**Socles nommés, et les sections qui s'appliquent** :

- `docs/security.md` §1 (politique de sécurité du contenu — *signalée*, non
  modifiée : recherche §7), §3 (autorisation, 404 plutôt que 403), §4 (Zod à
  chaque frontière, webhook signé avant tout effet), §5 (secrets, validation
  d'environnement au démarrage nommant la variable), §6 (dépendance ajoutée
  justifiée : `stripe`), §7 (aucune information exploitable dans une réponse
  d'erreur ; limitation de débit → dette s28, écrite).
- `docs/reliability.md` §1 (webhook idempotent par identifiant, migration et
  réconciliation rejouables), §2 (mode local explicite, dégradation), §3 (délai
  d'attente, recul exponentiel dispersé et plafonné, erreurs transitoires
  uniquement), §4 (migration additive), §5 (commande de réconciliation).
- `AGENTS.md` racine : `AGENTS.md` par package, aucune revendication
  d'exhaustivité, règle exécutable ou rien.

## Tâches

- [x] **T1 — Le port `Payments`.** `packages/ports/src/payments.ts` + export du
  baril. Résultat discriminé, quatre opérations (checkout, portail, vérification
  de webhook, lecture d'abonnements pour la réconciliation), union fermée de
  statuts, forme de journal fermée. Aucune implémentation.
  *Preuve* : le port n'a que des types — il est prouvé chez ses implémentations
  (T3, T4). `pnpm typecheck`.

- [x] **T2 — Le catalogue d'offres.** `config/billing.ts` +
  `packages/modules/billing/src/domain/offer.ts` (schéma Zod, refus nommant
  l'offre et le champ fautif). Une offre malformée fait échouer le démarrage.
  *Test* : `packages/modules/billing/src/domain/billing-rules.test.ts` —
  offre sans prix, intervalle inconnu, identifiant dupliqué, devise malformée,
  essai négatif ; et le catalogue livré qui passe.
  *Mutation* : retirer le `superRefine` des doublons.

- [x] **T3 — L'adaptateur Stripe.** `packages/adapters/stripe/` : classement des
  erreurs et politique de reprise (`retry.ts`, pur), transport
  (`stripe-payments.ts`), baril, `AGENTS.md`, `tsconfig`.
  *Test* : `src/stripe-payments.test.ts`, **réseau doublé, SDK réel**
  (`Stripe.createFetchHttpClient`) ; `src/stripe-live.test.ts` ignoré sans
  `STRIPE_LIVE_TEST=1`.
  *Mutations* : tout classer transitoire ; retirer l'assainissement des
  messages ; tirer une clé d'idempotence par tentative ; retirer le plafond ;
  retirer la dispersion ; lire `current_period_end` sur l'abonnement au lieu des
  lignes ; ouvrir le repli de statut inconnu.

- [x] **T4 — Les outils de test du port.** `packages/payments-testing/` :
  `createRecordingPayments` (CI) et `createLocalPayments` (mode local, sans
  clé). Ce ne sont pas des fournisseurs (ADR 008).
  *Test* : `src/payments-testing.test.ts`.
  *Mutation* : faire lever la doublure locale au lieu de rendre un échec.

- [x] **T5 — L'environnement et le refus de démarrage.** `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `PAYMENTS_LOCAL_MODE` dans `@repo/config` ;
  `apps/web/lib/billing-config.ts` (la règle qui décide, isolée) branchée dans
  `apps/web/next.config.ts` ; `.env.example`.
  *Test* : `tests/billing.test.ts` — sans clé ni drapeau, le montage lève en
  nommant les deux variables ; les deux ensemble sont refusés ; le drapeau sous
  `NODE_ENV=production` est refusé ; une clé sans secret de webhook est refusée.
  *Mutation* : faire retomber la règle sur `NODE_ENV`.

- [x] **T6 — Le domaine de l'abonnement.** `domain/subscription.ts` : statuts
  normalisés, `grantsAccess(subscription, now)` — le plan l'annonçait sous le
  nom `accessOf`, renommage sans autre conséquence —, `displayStateOf`,
  `appliesAfter` (l'ordre d'ADR 034), et `currentSubscriptionOf` (ajoutée au
  tour de correction : constat F1).
  *Test* : dans `billing-rules.test.ts` (même unité, même fichier).
  *Mutations* : accorder l'accès à `expired` ; inverser la comparaison
  d'horodatage ; ignorer `cancelAtPeriodEnd`.

- [x] **T7 — Schéma, migration, dépôt.** `schema.ts` (`billing_customer`,
  `billing_subscription`, `billing_webhook_event`), migration générée,
  `infrastructure/drizzle-billing-repositories.ts` (idempotence par contrainte,
  transaction).
  *Test* : `tests/billing.test.ts` sur la base — le même événement rejoué
  n'écrit qu'une fois ; un événement plus ancien n'écrase pas ; la migration
  rejouée ne fait rien.
  *Mutation* : remplacer `on conflict do nothing` par une lecture préalable.

- [x] **T8 — Cas d'usage et routes.** `application/billing-use-cases.ts`
  (checkout, portail, traitement d'événement, vue, purge, export,
  réconciliation), `presentation/billing-routes.ts` (trois routes, protections
  déclarées), `module.ts` (les quatorze clés), messages fr/en, `AGENTS.md`.
  *Test* : `tests/billing.test.ts` — signature invalide → 400 sans écriture ;
  offre inconnue → 400 ; `member` d'organisation → 403 sans écriture ;
  périmètre d'une autre organisation → 404 ; le prix ne vient jamais du corps.
  *Mutations* : vérifier la signature après l'écriture ; retirer la garde de
  permission ; lire `priceId` du corps.

- [x] **T9 — Composition, écran, mode local.** `config/features.ts`,
  `generated/schema/`, `apps/web/lib/billing.ts`,
  `apps/web/app/billing/page.tsx`, `apps/web/app/billing-actions.tsx` (client,
  ADR 027), `apps/web/app/api/billing-local-checkout/route.ts`,
  `presentation/billing-screen.tsx`, entrée de `APPLICATION_SEGMENTS`,
  `transpilePackages`.
  *Test* : `tests/rendered-text.test.ts` (l'écran entre dans le filet, **trois**
  états rendus — `none`, `past_due`, `ending` ; les six sont couverts
  unitairement par `displayStateOf`, et le plan disait « six états rendus » à
  tort), `tests/module-off.test.ts` reste vrai, `tests/organizations.test.ts`
  (segment réservé).
  *Vérification visuelle* : navigateur sous build de production, thèmes clair et
  sombre, 390 px et 1440 px.

- [x] **T10 — Parcours et réconciliation.** `e2e/billing.spec.ts` (souscrire en
  mode local, retour, portail, signature invalide, module coupé),
  `scripts/billing-reconcile.ts` + `pnpm billing:reconcile`.
  *Test* : la réconciliation rejouée n'écrit rien la seconde fois.
  *Mutation* : faire écrire la réconciliation à chaque passage.

## Tour de correction (revue refusée au ship)

Les constats de `docs/reviews/s19-subscribe-stripe.md`, traités avant toute
autre tâche. Chacun a sa mutation, et le compte des cas passés au rouge est dans
`packages/modules/billing/AGENTS.md`.

- [x] **F7 — la porte du checkout simulé.** `GET /api/billing-local-checkout`
  exige une session et le périmètre de cette session ; le simulateur refuse une
  session ouverte par un autre périmètre. *Mutation* : retirer la garde → 1 rouge
  unitaire, 1 rouge au navigateur.
- [x] **F1 — un client qui se réabonne.** Ordre total à la lecture (index +
  `order by`), et `currentSubscriptionOf` dans le `domain` : celui qui donne
  l'accès l'emporte. Parcours complet rejoué jusqu'à la vue. *Mutations* :
  retirer l'ordre → 1 ; préférer le plus récent → 2.
- [x] **F2 — le catalogue validé au démarrage.** `apps/web/lib/billing-catalogue.ts`,
  appelé par `next.config.ts`. *Mutation* : retirer l'appel → 2.
- [x] **F3 — la garde de permission tenue par un test d'API.**
  `apps/web/lib/billing-permission.ts`, branché dans `tests/billing.test.ts` sur
  la vraie vue des organisations, rôle réel en base. *Mutation* : `return true`
  **dans la règle** → 1. Elle ne tenait pas le **câblage** : voir M1 ci-dessous.
- [x] **F4 — l'adresse du compte part au fournisseur.** *Mutation* : ne plus la
  transmettre **depuis le module** → 1. Même limite : voir M2 ci-dessous.
- [x] **F5 — l'offre en cours ne se souscrit plus deux fois.** *Mutation* :
  reproposer le bouton → 1.
- [x] **F6 — le commentaire de réconciliation, corrigé** dans le code et dans la
  recherche §4.
- [x] **F8 — la réconciliation lit toutes les pages**, plafonnées.
  *Mutation* : s'arrêter à la première → 1.
- [x] **F9 — plan et design remis d'accord avec le code** (T6, T9, `BillingAction`,
  `EmptyState`).
- [x] **Arbitrage 1 — `webhooks: []`** : fil de détente exécutable dans
  `tests/module-registry.test.ts`. *Mutation* : répartir `registry.webhooks`
  depuis `apps/web` → 1.
- [x] **Arbitrage 2 — le tunnel exige JavaScript** : écrit dans
  `config/billing.ts`, `apps/web/AGENTS.md` et `packages/modules/billing/AGENTS.md`.

## Second tour de correction (seconde revue refusée au ship)

Les constats de la section « Seconde revue » de
`docs/reviews/s19-subscribe-stripe.md`. Chaque mutation est posée **à l'endroit
exact du défaut** — la leçon de M1 et M2 —, et le compte des rouges est dans
`packages/modules/billing/AGENTS.md`.

- [x] **C1 — la CI démarre le serveur.** `PAYMENTS_LOCAL_MODE=1` déclaré dans
  `.github/workflows/ci.yml` (job `quality`) **et** dans `playwright.config.ts`
  (le serveur que Playwright lance). `tests/env-wiring.test.ts` démarre la
  configuration de Next avec l'union de ces deux fichiers, et vérifie sur chacun
  qu'aucun fournisseur réel n'y est joignable. *Mutations* : retirer la variable
  de l'un, puis de l'autre → 1 rouge chacune. *Mesure* : environnement de la CI
  reproduit, `.env` mis de côté → serveur vivant, `curl /` → 307 ; sans le
  drapeau → serveur mort, code 1, message nommant les trois variables.
- [x] **M1 — la garde de permission de l'application.** `billing.prepare()`
  accepte la connexion, le port et l'`APP_URL` ; `tests/billing.test.ts` branche
  le **vrai** objet `billing` et mesure le refus d'un `member`.
  *Mutation* : `apps/web/lib/billing.ts#canManage` → `async () => true` → 1.
- [x] **M2 — l'adresse du compte, au point de composition.** Même branchement :
  ce que le réseau voit partir porte l'adresse résolue par `lib/auth`.
  *Mutation* : `apps/web/lib/billing.ts#emailOfScope` → `null` → 1.
- [x] **M3 — le bouton qui facture deux fois.** `openCheckout` refuse en 409
  (`already_subscribed`) quand `grantsAccess` est vrai ; l'écran retire **tous**
  les boutons du catalogue et renvoie au portail. Un abonnement terminé rouvre le
  catalogue. *Mutations* : retirer le refus → 1 ; rendre les boutons à l'offre en
  cours seule → 3. Parcours : plus aucun « Souscrire » après la souscription.
- [x] **m1 — l'index sert l'ordre qu'il porte.** Migration `0002` :
  `DESC NULLS FIRST`, qui est ce que `desc()` émet dans la requête. L'ordre de
  lecture est écrit une fois (`subscriptionReadOrder`) et `tests/billing.test.ts`
  le passe à `EXPLAIN`. *Mutation* : recréer l'index en `DESC NULLS LAST` → 1.
- [x] **m2 — le fil de détente de `webhooks: []` élargi** à
  `packages/core/src`, sur l'**invocation** d'un gestionnaire — la lecture de
  `.webhooks` y étant le travail normal du registre. *Mutation* : un répartiteur
  dans `packages/core/src/registry.ts` → 1.
- [x] **m3 — l'export rend tous les abonnements du périmètre**, dans l'ordre de
  lecture.
- [x] **m4 — ADR 037**, avec les deux contraintes de schéma mesurées et
  pourquoi chacune casse.

## Ce qui n'est pas dans ce plan

Page de tarifs (s22), achat unique (s20), gating par offre (s21), métriques de
revenus (s38), synchronisation continue des sièges, emails de relance (s33),
limitation de débit du webhook (s28, dette écrite dans la recherche §10).
