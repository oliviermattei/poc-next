# Prise en main — du clone au ship

> Document d'accueil. Il s'adresse à quelqu'un qui vient d'obtenir ce dépôt et
> qui veut mettre **son** SaaS en production. Il ne remplace pas les documents
> de référence — il dit dans quel ordre les lire et ce qu'il faut faire entre
> deux.
>
> Références : `README.md` (ouvrir le produit), `AGENTS.md` (l'ordre de lecture),
> `CODING_STANDARDS.md` (les règles), `docs/commands.md` (les commandes), `docs/architecture.md` (la technique),
> `docs/design-system.md` (les jetons et composants), `docs/security.md`,
> `docs/reliability.md`, `docs/deployment.md` (la mise en production),
> `docs/decisions/` (une ADR par décision structurante).

---

## 0. Ce que vous avez entre les mains

Quatre surfaces, et il faut les distinguer avant tout le reste. Elles vivent
dans **une seule application Next** (`apps/web`), pas dans quatre déploiements.

| Surface | Adresse | Qui y entre | D'où elle vient |
|---|---|---|---|
| **Site public** (landing, pricing, blog, docs, changelog, légal, contact, newsletter, liste d'attente) | `/`, `/pricing`, `/blog`, `/docs`, `/changelog`, `/legal/*`, `/contact`, `/waitlist` | tout le monde | modules `marketing`, `billing`, `blog`, `docs`, `changelog` |
| **Application connectée** (le SaaS lui-même) | `/app` (tableau de bord), `/app/settings/*` (profil, sécurité, organisation, membres, facturation, notifications, cookies), `/app/notifications`, `/app/premium` | un compte | modules `auth`, `organizations`, `notifications`, `billing`, `storage` |
| **Administration de l'organisation** (le client gère ses propres utilisateurs) | `/app/settings/organization`, `/app/settings/members` | un membre, selon son rôle | module `organizations` |
| **Back-office de l'éditeur** (vous) | `/console`, `/console/users`, `/console/organizations`, `/console/revenue`, `/console/subscriptions` | un **superadmin** de plateforme | modules `admin`, `billing`, `organizations`, `marketing` |

La racine `/` sert **toujours le site public**, connecté ou non
(`apps/web/app/(site)/page.tsx`). Site public coupé, elle redirige le visiteur
anonyme vers `/sign-in` et le compte connecté vers `/app`. Le tableau de bord
est `/app` (`apps/web/app/(app)/app/page.tsx`), destination par défaut après
toute connexion ; il renvoie vers le parcours d'intégration s'il est en cours.
Aucune de ces branches ne nomme un module : elles se départagent sur des
données.

**Le tableau de bord connecté est volontairement vide** — un `EmptyState` qui
renvoie vers `/app/settings/profile`. C'est là que **votre** produit se branche. Le
boilerplate livre tout ce qui entoure le produit, jamais le produit.

### La navigation est dérivée, jamais écrite

Chaque module déclare ses entrées de navigation avec leur **surface** (`app`,
`footer`, `admin`) et leur **protection** (`public`, `authenticated`, `role`,
`entitlement`). Le shell ne contient aucune liste de liens : il rend ce que le
registre agrège pour les modules activés, filtré par ce que la session a le
droit de voir (`apps/web/lib/navigation.ts`, `apps/web/lib/back-office.ts`).

Couper un module retire donc **en même temps** sa route, son entrée de menu, sa
table et sa migration. C'est la promesse centrale du dépôt, et elle est mesurée
par `pnpm test:minimal-profile`.

---

## 1. Prérequis

- Node ≥ 20.10 (`.nvmrc` fixe la version), pnpm ≥ 10
- Docker (pour PostgreSQL 16 — rien à installer sur la machine)
- Rien d'autre. **Aucune clé de fournisseur n'est nécessaire pour démarrer** :
  emails, paiements, stockage et tâches de fond ont chacun un mode local
  explicite, armé par défaut dans `.env.example`.

---

## 2. Étape 1 — Faire tourner le produit (≈ 10 minutes)

```bash
cp .env.example .env      # les modes locaux sont déjà armés
docker compose up -d      # PostgreSQL 16 sur le port 5432
pnpm install
pnpm db:migrate           # les migrations des modules activés, dans l'ordre du graphe
pnpm db:seed              # les données de démonstration
pnpm dev                  # http://localhost:3000
```

Puis connectez-vous sur `/sign-in` :

| Adresse | Mot de passe | Ce que ce compte a |
|---|---|---|
| `ada@demonstration.invalid` | `demonstration-seulement` | propriétaire de « Atelier Démo », un abonnement, trois notifications |
| `hedy@demonstration.invalid` | `demonstration-seulement` | membre de la même organisation |

Ces comptes sont déjà vérifiés. `pnpm db:seed` **refuse** dès que la base porte
un compte qu'il n'a pas créé lui-même : il ne peut donc pas contaminer une base
en service. Il est rejouable et imprime son comptage (« *n* avant, *n* après »).

### Ouvrir le back-office

`/console` répond **404 à tout le monde** tant qu'aucun superadmin n'existe.
Le premier se désigne par une variable, et seulement tant qu'il n'y en a aucun :

```bash
# dans .env
SUPERADMIN_EMAIL=ada@demonstration.invalid
```

Redémarrez `pnpm dev`, reconnectez-vous : l'entrée « Administration » apparaît.
Dès qu'un superadmin existe, **c'est la base qui fait foi** — changer la
variable ne redésigne personne, on promeut ensuite depuis le back-office.

### Ce que la démonstration ne montre pas

- les **paiements** ne parlent à personne (`PAYMENTS_LOCAL_MODE=1`) ;
- les **emails** ne partent pas, ils sont écrits dans `apps/web/.mail/`
  (`EMAIL_LOCAL_CAPTURE=1`) ;
- le **blog, la documentation et le changelog** ne sont pas semés : leur contenu
  est du MDX déjà présent dans `content/`.

---

## 3. Étape 2 — La visite guidée (≈ 20 minutes)

Faites ce parcours une fois, dans cet ordre. Il vous fait toucher les quatre
surfaces et vous évite de chercher plus tard.

1. **Le site public** — `/` (sections déclarées dans `config/marketing.ts`),
   `/pricing` (offres de `config/billing.ts`), `/blog`, `/docs`, `/changelog`,
   `/legal/privacy`, `/contact`, `/waitlist`. La bannière de consentement
   apparaît si des scripts non essentiels sont déclarés.
2. **L'inscription** — `/sign-up`, puis l'email de vérification : ouvrez le
   fichier écrit dans `apps/web/.mail/`. Essayez aussi `/forgot-password`.
3. **L'application connectée** — `/app` (tableau de bord vide), `/app/notifications`.
4. **Les réglages du compte** — `/app/settings/profile` et `/app/settings/security` : nom, email, mot de passe, avatar
   (stockage), sessions actives, méthodes de connexion (OAuth, passkeys),
   double authentification, préférences de consentement, **export de ses
   données** et **suppression de compte** (le pack RGPD).
5. **L'organisation** — `/app/settings/organization` et `/app/settings/members` : créer, renommer, changer
   d'organisation, inviter un membre, relancer ou révoquer une invitation,
   retirer un membre, changer un rôle, transférer la propriété, supprimer
   l'organisation. C'est le « panneau d'administration du client ».
6. **Le paiement** — `/pricing` → tunnel simulé → `/app/settings/billing` (portail). Testez
   aussi `/app/premium` : une fonctionnalité réservée par `config/gating.ts`.
7. **Le back-office** — `/console/users` (liste, détail, bannir/débannir,
   révoquer une session, envoyer une réinitialisation de mot de passe, promouvoir
   ou révoquer un superadmin, **emprunter la session** d'un client pour
   l'assister), `/console/organizations`, `/console/revenue` (récurrent estimé et
   ponctuel constaté, par devise, avec les états d'abonnement),
   `/console/subscriptions` (inscriptions publiques : newsletter et liste
   d'attente, exportables en CSV).

---

## 4. Étape 3 — Configurer le projet

Deux endroits, et deux seulement.

### 4.1 `config/` — ce que le propriétaire édite

| Fichier | Ce qu'il décide |
|---|---|
| `config/features.ts` | l'**annuaire** des modules disponibles et la liste des **activés**. Un identifiant inconnu ne compile pas. `auth` et `rate-limit` sont le socle non désactivable. |
| `config/billing.ts` | les offres : `id`, `mode` (`subscription` / `one_time`), `priceId` Stripe, montant en **unités mineures**, devise, intervalle, jours d'essai, facturation au siège et limite de sièges. |
| `config/gating.ts` | ce qu'une offre ouvre : une fonctionnalité (`FeatureGate`) et la liste des offres qui y donnent droit. |
| `config/marketing.ts` | les sections de l'accueil (`hero`, `features`, `testimonials`, `faq`, `newsletter`, `cta`) **dans l'ordre du tableau**, les documents légaux, l'adresse qui reçoit le formulaire de contact, les sources newsletter et liste d'attente. |
| `config/i18n.ts` | les langues servies et la langue par défaut (livré : `fr`, `en`). |
| `config/notifications.ts` | les types de notifications et leurs canaux. |
| `config/security.ts` | la politique de sécurité du contenu (CSP) — toute origine ajoutée demande une justification écrite. |
| `config/profiles.ts` | les profils de modules coupés, joués par `pnpm test:minimal-profile`. |

`config/marketing.ts` ne porte **pas la prose** : elle vit dans les catalogues
de traduction du module (`packages/modules/marketing/src/messages/`). Déclarer
une section sans sa traduction dans **chaque** langue fait échouer `pnpm test`,
pas la page en production.

Pour activer ou couper un module, n'éditez pas `generated/` :

```bash
pnpm ks list              # l'état, les requis, les dépendants
pnpm ks toggle <module>   # active ou coupe, régénère, restaure si la régénération échoue
pnpm ks scaffold <module> # un squelette de module conforme
```

Les mêmes opérations sont exposées au serveur MCP (module `mcp-server`), donc
pilotables depuis un agent.

### 4.2 `.env` — les secrets et les branchements

34 variables, toutes validées **au démarrage** par Zod : une variable absente ou
malformée arrête le processus **en la nommant**. Il n'y a aucun `process.env`
hors du module de configuration.

La règle qui structure tout le fichier : **chaque port a un mode local
explicite, jamais déduit de `NODE_ENV`**. Soit vous donnez une clé de
fournisseur, soit vous armez le mode local ; les deux ensemble, ou aucun des
deux, arrêtent le démarrage. Une application qui se rabat en silence sur un
remplaçant ne sait plus distinguer un envoi réel d'un envoi capturé.

| Domaine | Mode local | Vraie vie |
|---|---|---|
| Base | `DATABASE_URL` (docker-compose) | la même variable, ailleurs |
| Emails | `EMAIL_LOCAL_CAPTURE=1` → `apps/web/.mail/` | `RESEND_API_KEY` + `EMAIL_FROM` (domaine vérifié, SPF/DKIM/DMARC — `docs/deliverability.md`) |
| Paiements | `PAYMENTS_LOCAL_MODE=1` | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`, endpoint `<APP_URL>/api/modules/billing/webhook` |
| Stockage | `STORAGE_LOCAL_DIRECTORY` | `STORAGE_S3_*` (+ l'origine à ajouter dans `config/security.ts`, champ `connect`) |
| Tâches de fond | `JOBS_LOCAL_RUNNER=1` | `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` |
| OAuth | `OAUTH_LOCAL_PROVIDER=1` | `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`, rappel `<APP_URL>/api/modules/auth/callback/<provider>` |
| Analytics / erreurs | rien (dégradent : `not_configured`) | `POSTHOG_KEY`/`POSTHOG_HOST`, `SENTRY_DSN`/`SENTRY_RELEASE` |
| Plateforme | — | `AUTH_SECRET` (≥ 32 car., `openssl rand -base64 32`), `APP_URL`, `SUPERADMIN_EMAIL` |

⚠️ `PAYMENTS_LOCAL_MODE=1` **accorde un abonnement complet sans paiement à qui
clique**. Posée avec `NODE_ENV=production`, elle arrête le démarrage.

---

## 5. Étape 4 — Habiller le produit

1. **Les jetons** — `packages/ui/src/styles.css` : `--primary`, `--background`,
   `--radius`, les couleurs d'état, en clair **et** en sombre. Les changer
   change toute l'application ; `pnpm test:contrast` refuse une paire
   texte/fond sous 4,5 : 1 et un anneau de focus sous 3 : 1, en nommant la
   source, la variante, le mode et le rapport.
2. **Les composants** — `packages/ui/src/components` (shadcn/ui sur Radix, copié
   dans le dépôt) et `packages/ui/src/composed` (sidebar, page header, empty
   state, pagination, prose, bascule de thème, sélecteur de langue, sélecteur
   d'organisation, bannière de cookies). `docs/design-system.md` fait foi :
   **inventer un composant ou un jeton hors du système est interdit**, on
   compose avec ce qui existe.
3. **Les textes** — les catalogues de chaque module
   (`packages/modules/<module>/src/messages/{fr,en}.json`). Aucune traduction ne
   se replie sur sa clé : une clé manquante fait tomber l'écran, et `pnpm test`
   la voit avant.
4. **Le contenu éditorial** — `content/blog/<locale>/`, `content/docs/<locale>/`,
   `content/changelog/<locale>/`, en MDX. Les docs se rangent en sections via un
   `section.json`.

---

## 6. Étape 5 — Ajouter **votre** produit

C'est l'étape que le boilerplate ne fait pas à votre place, et il ne faut pas
la faire n'importe où.

### La règle

Une fonctionnalité est un **module**, jamais du code posé dans `apps/web`.

```bash
pnpm ks scaffold <mon-module>
```

Le squelette déclare le contrat — quinze clés obligatoires, quitte à les
laisser vides : `id`, `requires`, `schema`, `migrations`, `routes`,
`navigation`, `publicUrls`, `messages`, `emails`, `webhooks`, `jobs`,
`dataCategories`, `retention`, `purge`, `export` — plus une seizième
facultative, `seeds`.

Quatre couches à l'intérieur : `domain/` (règles pures, aucun framework, aucun
ORM), `application/` (cas d'usage et ports), `infrastructure/` (Drizzle,
adapters) et `presentation/` (routes `ModuleRoute` + Zod, composants React).
`infrastructure` et `presentation` ne s'importent jamais l'un l'autre — **c'est
le lint qui refuse, pas la revue**.

Un module qui expose des composants les sort par un **second point d'entrée**
(`@repo/module-<nom>/presentation`) : le baril principal ne réexporte jamais de
`.tsx`, sans quoi `pnpm typecheck` casse sur `@repo/db`.

### Le pipeline

Aucune ligne de code n'est écrite hors du pipeline killer-saas (`AGENTS.md`) :

```
/ks-research → /ks-design → /ks-plan → /ks-execute → /ks-review → /ks-ship
```

Une story = une branche `feature/<story-id>` = une PR. `/ks-ship` refuse de
tourner si `docs/reviews/<id>.md` ne finit pas par `Ship allowed: yes`.
`/ks-status` dit où vous en êtes ; `/ks-help` imprime la carte.

L'exception, annoncée explicitement : le **Quick Fix** — une couleur, un espace,
une chaîne de texte. Sur `dev`, diff minimal, vérification proportionnée.

---

## 7. Étape 6 — Vérifier

Le tableau complet, avec ce qui fait échouer chaque commande, est dans
`AGENTS.md`. Les six du quotidien :

```bash
pnpm typecheck        # racine, tests/ et chaque package
pnpm lint             # style + frontières de couches + surface client de @repo/config
pnpm test             # unitaires et câblage (Vitest)
pnpm test:e2e         # parcours navigateur (Playwright)
pnpm build            # compile
pnpm run audit        # vulnérabilités « élevé » + exceptions datées
```

Les recettes, plus lentes, à jouer avant un ship :

```bash
pnpm test:golden-path      # clone → premier paiement, sur une base créée pour l'exécution
pnpm test:minimal-profile  # un profil où des modules sont coupés : aucune route, nav ni table orpheline
pnpm test:socle            # la seconde branche de la matrice de CI
pnpm test:contrast         # contraste des jetons livrés
pnpm test:sans-env         # la suite rejouée avec le seul environnement de la CI
```

`pnpm run audit` — jamais `pnpm audit` seul, qui ignore les exceptions.
Le scan de secrets n'a pas de script npm :
`docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest git /repo`.

---

## 8. Étape 7 — Déployer

Tout est dans `docs/deployment.md`, qui porte deux guides : **Coolify** et
**Vercel**, plus la pile `docker-compose.prod.yml` et la construction d'image en
CI. Ce qu'il faut savoir avant de l'ouvrir :

- l'application a **deux points de démarrage** — `next.config.ts` et
  `apps/web/instrumentation.ts` — qui appellent la même garde
  (`apps/web/lib/startup.ts`) : `output: 'standalone'` fige la config Next dans
  `server.js` et cesse d'exécuter `next.config.ts` au démarrage du serveur ;
- **l'étape d'exécution n'hérite jamais de la permissivité du build** : les
  échappatoires de validation (`NEXT_PHASE`, `SKIP_ENV_VALIDATION`) sont portées
  par la commande de build, jamais par un `ENV` d'étape ;
- les **migrations tournent dans leur propre conteneur** avant la bascule du
  trafic ; une migration en échec empêche l'application de démarrer ;
- un **proxy inverse est obligatoire** (le rate limiting en dépend) ;
- les **cartes source** partent chez Sentry puis sont élaguées du dossier servi
  (`pnpm sourcemaps:release`, `pnpm sourcemaps:prune`). Dans cet ordre.

Avant la bascule : basculez `PAYMENTS_LOCAL_MODE` sur une vraie clé Stripe,
`EMAIL_LOCAL_CAPTURE` sur Resend, générez un `AUTH_SECRET` propre, posez
`APP_URL` sur le domaine réel, déclarez l'endpoint de webhook chez Stripe et les
URL de rappel chez vos fournisseurs OAuth.

---

## 9. Après le ship — l'exploitation

| Besoin | Où |
|---|---|
| Voir le revenu, les états d'abonnement | `/console/revenue` |
| Consulter comptes et organisations, assister un client | `/console/users`, `/console/organizations` (emprunt de session, journalisé aux deux bouts) |
| Bannir, révoquer une session, réinitialiser un mot de passe | `/console/users/<id>` |
| Récupérer les inscriptions newsletter / liste d'attente | `/console/subscriptions` (export CSV) |
| Recoller l'état d'abonnement avec Stripe | `pnpm billing:reconcile` (statut : Stripe fait foi ; sièges : le nombre de membres fait foi) |
| Vérifier que l'app est vivante | `GET /api/health` (touche la vraie dépendance) |
| Erreurs, usages | Sentry et PostHog — **hors de l'application** |

---

## 10. Ce que ce dépôt ne contient pas — et ne contiendra pas

Le cimetière de `docs/prd.md` est **contraignant** : y ré-entrer est une brèche
de périmètre, pas une amélioration.

CLI `eject` · module IA in-app · tout provider de paiement autre que Stripe ·
facturation à l'usage · notifications temps réel · multi-ORM / multi-framework ·
bases hors PostgreSQL · application mobile · **journal d'audit** · clés API et
webhooks sortants pour vos clients · secondes implémentations d'adapters (SMTP,
MinIO, Umami…) · tout l'appareil commercial.

Trois choses de plus, qui ne sont pas au cimetière mais **ne sont pas livrées** :

- le **widget de feedback** (`s43`) et la **roadmap publique avec votes**
  (`s44`) : la recherche est faite (`docs/research/`), rien n'est implémenté ;
- le **premier déploiement hors de ce poste** (`s59`) : ni plan ni revue ;
- le **captcha** : déclaré et gardé, mais **aucun fournisseur n'est livré** ;
- la **réconciliation objets/lignes du stockage** : la commande n'existe pas
  encore (voir `packages/modules/storage/AGENTS.md`).

Et deux limites du back-office, à connaître avant de promettre quoi que ce soit
à un client : il **ne configure pas le SaaS** — la configuration vit dans
`config/` et `.env`, donc dans le dépôt, et change par redéploiement — et il
**n'affiche ni logs ni métriques produit** : ceux-là se lisent chez Sentry et
PostHog.

---

## 11. La carte des documents

| Question | Document |
|---|---|
| Qu'est-ce qu'on construit, et qu'est-ce qu'on refuse ? | `docs/prd.md` |
| Quelles fonctionnalités, avec quels critères ? | `docs/stories.md` |
| Comment c'est fait techniquement ? | `docs/architecture.md` |
| Pourquoi ce choix plutôt qu'un autre ? | `docs/decisions/` |
| Quelles règles ne se négocient pas ? | `AGENTS.md`, `docs/security.md`, `docs/reliability.md` |
| À quoi ça ressemble ? | `docs/design-system.md`, `docs/designs/<story>.md` |
| Comment on met en production ? | `docs/deployment.md` |
| Où en est le projet ? | `docs/STATE.md`, `/ks-status` |
| Ce que le package peut importer et ne doit pas contenir | l'`AGENTS.md` **de ce package** |
