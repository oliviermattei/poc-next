# Déploiement

Ce document livre la chaîne de déploiement du dépôt (s27) : l'image de
production, la pile `docker-compose.prod.yml`, la checklist des variables, et
les deux guides — Coolify et Vercel.

**Ce qui a été exercé, et ce qui ne l'a pas été**, dit ici plutôt que coché
ailleurs :

| Élément | État | Preuve |
|---|---|---|
| `Dockerfile` | **construit et démarré** | `docker build` puis `docker run` ; le conteneur sort en code 1 sans configuration, en nommant `DATABASE_URL` |
| `docker-compose.prod.yml` | **exercé** | pile montée **avec des variables seulement exportées**, sans aucun fichier : `/api/health` → `{"status":"ok","database":"connected"}`, conteneur `healthy`, accueil servi sur le port choisi |
| Migrations avant basculement | **exercé** | migration volontairement cassée : le conteneur de migration sort en 1, l'application reste à l'état `Created` et ne sert rien. **Et ce n'est pas une continuité de service** : sur une pile déjà en service, `up -d --build` a déjà détruit le conteneur précédent — trois états mesurés plus bas |
| Checklist des variables | **gardée par un test** | `tests/deployment.test.ts`, dérivée d'`ENV_KEYS` |
| Construction d'image en CI | **en place** | job `image` de `.github/workflows/ci.yml` : validation de la pile, `runner` **et** `migrator` construits, image démarrée sans variables ; `actionlint` vert |
| Sonde de l'image | **exercé** | conteneur lancé avec `PORT=8080` : `healthy`. La sonde figée sur `3000` y répond « connection refused » |
| Recette Coolify | **guide livré, exécution non faite** | le déploiement réel sur l'instance du propriétaire est un geste humain ; la trace (URL, date, version) est à consigner dans `docs/reviews/s27-deployment.md` |
| Recette Vercel | **guide livré, exécution non faite** | aucun compte, aucun jeton et aucune configuration Vercel dans cet environnement |

Mesuré avec Docker 29.7.2 et Docker Compose v5.4.0.

---

## L'image de production

`Dockerfile`, trois étapes, et **une règle qui commande tout le fichier** :

> l'étape de construction contourne la validation d'environnement,
> les étapes d'exécution la subissent.

`apps/web/next.config.ts` et `apps/web/instrumentation.ts` valident la
configuration au démarrage, alors qu'`AGENTS.md` exige que « le build n'ait pas
besoin des variables d'exécution ». Les deux ne tiennent ensemble que par
l'échappatoire de `packages/config/src/env.ts` — `NEXT_PHASE` et
`SKIP_ENV_VALIDATION`. Elle est portée par **la commande de build**, jamais par
un `ENV` d'étape : posée dans une étape, elle serait héritée par tout ce qui en
descend, et l'image démarrerait en production sans vérifier sa configuration.

Mesuré, en posant `ENV SKIP_ENV_VALIDATION=1` dans l'étape d'exécution : le
conteneur lancé **sans aucune variable** affiche `✓ Ready`, reste « Up », et se
contente de journaliser « database unreachable » à chaque sonde. Vert,
silencieux et cassé. `tests/deployment.test.ts` garde la règle, dérivée de
`BUILD_ENV_KEYS`.

| Étape | Ce qu'elle contient | À quoi elle sert |
|---|---|---|
| `builder` | le dépôt, ses dépendances de développement, la sortie autonome de Next | construire |
| `migrator` | le dépôt et `pnpm db:migrate` | jouer les migrations, avant le basculement |
| `runner` | `.next/standalone` et les fichiers statiques, utilisateur non privilégié | servir |

```bash
docker build --target runner -t killer-saas-web .
docker run --rm -p 3000:3000 --env-file .env.production killer-saas-web
```

**Sans configuration, l'image refuse de démarrer et le dit** :

```
Démarrage refusé : Invalid environment variables:
  - DATABASE_URL: Invalid input: expected string, received undefined
```

Le conteneur sort alors en **code 1**. C'est le seul signal qu'un orchestrateur
lit : une image qui reste vivante en répondant 500 est un déploiement cassé qui
a l'air vert.

**« Elle démarre avec les seules variables d'environnement » a une réserve, et
elle est littérale.** Avec le module `storage` activé, l'image exige **en plus**
une édition de `config/security.ts` : l'origine du seau doit entrer dans le champ
`connect`, sinon `connect-src 'self'` refuse le téléversement, et le démarrage
échoue en le disant. C'est du code, pas une variable — heurté au premier
`docker compose up` de cette story. Sans le module `storage`, la phrase est vraie
telle quelle. Le détail est au point 1 de « Deux gestes d'exploitation » plus bas.

### Pourquoi `instrumentation.ts` existe

`output: 'standalone'` sérialise la configuration Next dans `server.js` :
**`next.config.ts` n'est plus exécuté au démarrage du serveur**. La frontière
était déjà écrite dans `packages/config/src/env.ts` (constats N15/N16 de s01) ;
elle a été mesurée ici — la première image démarrait avec un environnement
entièrement vide.

`apps/web/instrumentation.ts` est le point que Next appelle une fois par
instance de serveur, et le seul que la sortie autonome atteigne. Les deux
points de démarrage appellent la même garde,
`assertStartupConfiguration` (`apps/web/lib/startup.ts`).

### Aucun secret dans l'image

`.dockerignore` retire `**/.env` et `**/.env.*` du **contexte de build** : aucun
`COPY` ne peut les prendre, quoi qu'on écrive dans le `Dockerfile`. Vérifié sur
l'image construite — aucun fichier `.env` n'y existe.

Mesuré à l'envers, en retirant la règle : le `.env` de la racine se retrouve
dans l'image de migration, à `/repo/.env`, avec son contenu. Un secret dans une
couche d'image survit au registre et à tout ce qui repart de cette image
(`docs/security.md` §5). `tests/deployment.test.ts` garde la règle.

---

## La pile `docker-compose.prod.yml`

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Trois services : `postgres` (jamais publié sur un port de l'hôte), `migrate`
(joue les migrations puis sort), `web` (sert l'application sur `${APP_PORT}`).

Ce n'est **pas** `docker-compose.yml`, qui ne monte qu'une base de développement
sur le port du poste.

### D'où viennent les variables

Le fichier n'a **qu'une** voie : l'interpolation, qui alimente un bloc
`environment` partagé par `web` et `migrate`. Trois chemins y mènent, et ils se
valent :

- `--env-file .env.production`, la commande ci-dessus ;
- un `.env` posé **à côté** du fichier, que Compose lit de lui-même — mesuré, y
  compris quand il s'agit du `.env` de développement du dépôt : passez
  `--env-file` pour l'écarter ;
- des variables **exportées** par la plateforme. Mesuré : la pile monte et sert,
  sans aucun fichier.

Il n'y a **aucun `env_file:`** dans les services, et c'est délibéré : les deux
mécanismes ne s'additionnent pas. Mesuré — une entrée `environment: - CLE` dont
la variable n'est pas posée à l'interpolation **efface** la valeur venue
d'`env_file`, et la variable disparaît de l'environnement du conteneur. Et un
`env_file` seul ne sert que l'exploitant qui écrit un fichier : une plateforme
qui exporte ses variables interpole `${APP_PORT}` correctement et ne donne
**rien** aux conteneurs.

Une variable non posée s'interpole en chaîne vide, que le module de
configuration traite comme absente : le conteneur refuse alors de démarrer en la
nommant, ce qui est le comportement voulu. `NODE_ENV` fait exception et vaut
`production` par défaut. La liste est comparée à `ENV_KEYS` par
`tests/deployment.test.ts`, dans les deux sens.

### Les migrations, avant le basculement du trafic

`web` dépend de `migrate` par `service_completed_successfully`. C'est tout le
mécanisme : le code de sortie du conteneur de migration décide si l'application
démarre.

- Ce n'est **pas** un `postinstall` : celui-ci les jouerait à l'installation,
  hors de tout déploiement, et sur la base de qui installe.
- Ce n'est **pas** une étape du démarrage de l'application : le trafic
  basculerait sur une version dont le schéma a échoué à moitié.

Mesuré, en cassant volontairement une migration :

```
service "migrate" didn't complete successfully: exit 1
```

`docker compose ps -a` : `migrate` en `Exited (1)`, **`web` en `Created`** —
jamais démarré, rien de servi. **Aucun trafic n'atteint un schéma à moitié
appliqué**, et c'est exactement ce que le critère 3 demande.

Rejeu : un second `up` relance `migrate`, qui répond « Rien à appliquer :
aucune migration en attente » et sort en 0 (`docs/reliability.md` §1).

#### Ce que ce mécanisme ne fait pas : garder l'ancienne version en ligne

Trois états, mesurés sur **une pile déjà en service** (`/api/health` → 200), la
même migration cassée à chaque fois :

| Commande | Le conteneur `web` en service | Ce que répond l'application |
|---|---|---|
| `run --rm --build migrate` — les migrations seules | **intact**, même identifiant, `Up (healthy)` | 200 |
| `up -d`, sans reconstruire l'image | **intact** | 200 |
| `up -d --build` — **la commande de déploiement ci-dessus** | **détruit**, remplacé par un nouveau conteneur resté à `Created` | connexion refusée |

Le journal du troisième cas donne l'ordre, et c'est lui qui explique tout :
`web Recreate`, `web Recreated`, **puis** `migrate Error`. Compose recrée le
conteneur *avant* de jouer les migrations dont il dépend. L'ancienne version
n'est donc plus là pour continuer à servir : l'interruption prend la forme d'une
**coupure de service**, pas d'une continuité.

Une version précédente de ce guide affirmait le contraire — « la version
précédente continue de servir le trafic » — sur une mesure faite avec un volume
neuf, où il n'existait aucune version précédente. C'était une inférence écrite
comme une mesure ; elle avait été recopiée dans cinq textes.

**Pour ne pas couper**, deux formes :

1. **Jouer les migrations seules d'abord**, et ne déployer que si elles passent.
   C'est la forme que ce dépôt recommande, et celle qui est mesurée ci-dessus :

   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml run --rm --build migrate \
     && docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
   ```

2. **Basculer en bleu-vert** : la nouvelle version démarre à côté de l'ancienne,
   et le routage ne change qu'une fois les migrations passées et la sonde verte.
   Ce dépôt ne livre pas ce mécanisme — c'est la plateforme qui le porte.

### Compatibilité ascendante des migrations

Dès que les migrations sont jouées **avant** l'`up` — la forme recommandée
ci-dessus, et celle de toute plateforme qui bascule sans coupure — l'ancienne
version sert le trafic alors que le nouveau schéma est déjà appliqué. Une
migration doit donc rester compatible avec elle : **ajouter avant de lire,
cesser d'écrire avant de supprimer**
(`docs/reliability.md` §4). Une colonne supprimée dans la même mise en ligne que
le code qui cesse de l'écrire casse la version encore en ligne.

---

## Les variables de l’application

**Cette liste est comparée au schéma par `tests/deployment.test.ts`, dans les
deux sens** : une variable du schéma absente d'ici fait échouer `pnpm test`, et
une variable écrite ici qui n'existe plus aussi. Elle ne peut donc pas dériver
du code.

« Obligatoire » se lit au démarrage de l'**application** : `pnpm db:migrate` n'a
besoin que de `DATABASE_URL`.

| Variable | Obligatoire en production | Ce qu'elle décide |
|---|---|---|
| `NODE_ENV` | recommandée (`production`) | l'image la pose elle-même ; en `production`, elle **restreint** les modes locaux ci-dessous |
| `DATABASE_URL` | **oui** | la connexion PostgreSQL, seule variable exigée du conteneur de migration |
| `AUTH_SECRET` | **oui** | la signature des sessions et des jetons, 32 caractères minimum, une valeur propre **par déploiement** (`openssl rand -base64 32`) |
| `APP_URL` | **oui** | l'URL publique : les liens envoyés par email et les origines de confiance. Jamais déduite de l'en-tête `Host` |
| `EMAIL_FROM` | oui avec `RESEND_API_KEY` | l'expéditeur des emails, sur un domaine vérifié portant SPF, DKIM et DMARC |
| `RESEND_API_KEY` | l'une des deux | la clé du fournisseur d'emails : les emails partent réellement |
| `EMAIL_LOCAL_CAPTURE` | l'une des deux | `1` écrit les emails dans `.mail/` au lieu de les envoyer. **Aucun email ne part** : à ne poser en production que sur un déploiement de démonstration |
| `STRIPE_SECRET_KEY` | l'une des deux, module `billing` activé | la clé Stripe : l'application encaisse réellement |
| `STRIPE_WEBHOOK_SECRET` | oui avec `STRIPE_SECRET_KEY` | la vérification de signature des webhooks. Endpoint à déclarer chez Stripe : `<APP_URL>/api/modules/billing/webhook` |
| `PAYMENTS_LOCAL_MODE` | l'une des deux | `1` simule le paiement. **Refusée au démarrage sous `NODE_ENV=production`** : elle accorderait un abonnement complet sans paiement |
| `PAYMENTS_RECORDED_EVENTS` | non | le dossier d'événements rejoués par `pnpm test:golden-path`. Jamais posée à la main, jamais en production |
| `STORAGE_S3_BUCKET` | les quatre ensemble, module `storage` activé | le seau réel (S3, R2, MinIO, Spaces) |
| `STORAGE_S3_REGION` | idem | la région du seau |
| `STORAGE_S3_ACCESS_KEY_ID` | idem | l'identifiant d'accès |
| `STORAGE_S3_SECRET_ACCESS_KEY` | idem | le secret d'accès |
| `STORAGE_S3_ENDPOINT` | non | le point de terminaison hors AWS (`https://<compte>.r2.cloudflarestorage.com`) |
| `STORAGE_LOCAL_DIRECTORY` | alternative au seau | le stockage sur disque. **Refusée au démarrage sous `NODE_ENV=production`** : le disque disparaît au redéploiement, les avatars avec lui |
| `GOOGLE_CLIENT_ID` | non, mais par paire | la connexion Google. Rappel à déclarer : `<APP_URL>/api/modules/auth/callback/google` |
| `GOOGLE_CLIENT_SECRET` | avec l'identifiant | idem |
| `GITHUB_CLIENT_ID` | non, mais par paire | la connexion GitHub. Rappel : `<APP_URL>/api/modules/auth/callback/github` |
| `GITHUB_CLIENT_SECRET` | avec l'identifiant | idem |
| `OAUTH_LOCAL_PROVIDER` | **non** | le fournisseur de développement, qui ouvre une session **sans mot de passe**. Refusé au démarrage sous `NODE_ENV=production` |
| `I18N_MISSING_KEY_PROBE` | **non** | une sonde de diagnostic, posée par `playwright.config.ts` seulement |
| `CONSENT_SCRIPT_PROBE` | **non** | deux scripts de démonstration, posés par `playwright.config.ts` seulement |

### Les deux variables à ne jamais poser en production

Elles ne sont pas dans le schéma : c'est l'outillage qui les pose. Ce sont
pourtant elles qui font démarrer une image **sans vérifier sa configuration**.

| Variable | Qui la pose | Ce qu'elle fait |
|---|---|---|
| `NEXT_PHASE` | `next build` lui-même | vaut `phase-production-build` pendant le build ; la poser à la main fausse la détection de phase |
| `SKIP_ENV_VALIDATION` | la commande de build du `Dockerfile` | à `1`, désactive **toute** validation d'environnement. Posée à l'exécution, elle rouvre exactement le trou décrit plus haut |

### Les variables de la pile compose

Elles ne sont lues que par `docker-compose.prod.yml`, jamais par le code — et
n'ont donc pas leur place dans le tableau ci-dessus, qui est comparé au schéma.

| Variable | Défaut | Rôle |
|---|---|---|
| `POSTGRES_USER` | aucun, **exigé** | l'utilisateur de la base créée par la pile |
| `POSTGRES_PASSWORD` | aucun, **exigé** | son mot de passe |
| `POSTGRES_DB` | `app` | le nom de la base |
| `APP_PORT` | `3000` | le port de l'hôte sur lequel l'application est servie |

Ces quatre-là doivent rester cohérentes avec `DATABASE_URL`, dont l'hôte est le
nom du service : `postgres://<user>:<mot de passe>@postgres:5432/<base>`.

### Deux gestes d'exploitation que la configuration seule ne fait pas

1. **Le seau de stockage exige une origine déclarée.** Le navigateur téléverse
   directement vers le seau : son origine doit entrer dans `config/security.ts`,
   champ `connect`, sinon `connect-src 'self'` refuse la requête. Le démarrage
   échoue en le disant. Mesuré au premier `docker run` de cette story.
2. **Le seau demande une règle de cycle de vie**, et une réconciliation qui
   n'existe pas encore pour le préfixe `avatars/` : `.env.example` et
   `packages/modules/storage/AGENTS.md` portent le détail.

---

## Guide Coolify

**Non exécuté.** Le mécanisme est livré et éprouvé localement ; le déploiement
réel sur l'instance du propriétaire crée un projet, une base et une application
sur son infrastructure — c'est un geste humain. La trace (URL déployée, date,
version) se consigne dans `docs/reviews/s27-deployment.md`, comme le critère 5
l'exige.

Coolify sait déployer ce dépôt de deux façons. **La seconde est celle que ce
dépôt privilégie** : elle réutilise la pile éprouvée ci-dessus.

### Option A — ressource « Dockerfile »

1. **Projet** → *New Project*, puis un environnement (`production`).
2. **Base** → *New Resource* → *PostgreSQL 16*. Coolify rend une URL interne :
   c'est le `DATABASE_URL` de l'application.
3. **Application** → *New Resource* → *Private/Public Repository*, dépôt et
   branche, *Build Pack* = **Dockerfile**, chemin `Dockerfile`, cible `runner`.
4. **Port** : `3000` (l'image l'expose et écoute sur `0.0.0.0`).
5. **Variables** : celles de la checklist ci-dessus. Coolify les injecte à
   l'exécution, jamais dans l'image — ce qui est exactement ce que cette image
   attend.
6. **Migrations** : une *Pre-deployment command* qui joue `pnpm db:migrate`.
   Un échec y interrompt le déploiement, ce que le critère 3 exige. Elle a
   besoin de l'étape `migrator`, pas de l'image `runner` : c'est la raison pour
   laquelle l'option B est préférable.
7. **Sonde** : `/api/health`. Elle interroge la vraie base et répond 503 tant
   que la connexion échoue.

### Option B — ressource « Docker Compose » (recommandée)

1. **Projet** et environnement, comme ci-dessus.
2. **Application** → *New Resource* → *Docker Compose*, dépôt et branche,
   fichier `docker-compose.prod.yml`.
3. **Variables** : la checklist, plus `POSTGRES_USER`, `POSTGRES_PASSWORD`,
   `POSTGRES_DB` et `APP_PORT`. Le fichier n'a qu'**une** voie — l'interpolation
   — et les trois chemins qui l'alimentent y mènent : les variables **exportées**
   par la plateforme, le `.env` que Compose lit à côté du fichier, ou un
   `--env-file`. **Par laquelle de ces voies Coolify les fournit n'a pas été
   mesuré** : c'est le premier point à vérifier au premier déploiement.
4. Rien d'autre : la pile porte déjà sa base, son ordre de démarrage et
   **l'interruption sur migration en échec**. C'est le même fichier que celui
   éprouvé localement, donc le même comportement.

Dans les deux cas :

- **ne posez ni `NEXT_PHASE` ni `SKIP_ENV_VALIDATION`** ;
- laissez `NODE_ENV=production` : c'est lui qui fait refuser les modes locaux ;
- le premier démarrage échouera tant qu'une variable manque, **en la nommant**
  dans les journaux du conteneur. C'est le comportement attendu, pas une panne ;
- **vérifiez que les variables arrivent dans les conteneurs**, et pas seulement à
  l'interpolation du fichier : `docker exec <conteneur> env` doit montrer
  `DATABASE_URL`. Les deux ne sont pas la même chose, et une pile qui interpole
  correctement son `${APP_PORT}` peut très bien ne rien donner à ses conteneurs.

### Ce que le guide ne prétend pas

L'intitulé exact des écrans de Coolify n'a pas été vérifié pour cette story :
l'instance est joignable (version 4.3.14) mais rien n'y a été créé. Les noms de
menus peuvent différer d'une version à l'autre ; la structure — projet,
ressource base, ressource application, variables, sonde — ne change pas.

---

## Guide Vercel

**Non exécuté.** Aucun compte, aucun jeton et aucune configuration Vercel dans
cet environnement. Le guide est livré ; sa recette reste à faire, et sa trace à
consigner dans la revue.

1. *Import Project*, dépôt Git, **Root Directory** = `apps/web`.
2. Vercel détecte Next et le monorepo pnpm. **Ne pas** poser `output:
   'standalone'` comme un problème : Vercel ignore ce réglage et produit ses
   propres fonctions.
3. **Base de données** : Vercel n'en héberge pas. Un PostgreSQL managé (Neon,
   Supabase, RDS) fournit `DATABASE_URL`. Le pilote `node-postgres` honore
   `sslmode` dans la chaîne de connexion.
4. **Variables** : la checklist ci-dessus, dans *Environment Variables*, pour
   `Production` — et, si vous en avez, pour `Preview`.
5. **Migrations** : elles ne passent pas par le build. Deux formes tiennent le
   critère 3 :
   - une étape de votre pipeline (GitHub Actions) qui joue `pnpm db:migrate`
     **avant** de promouvoir le déploiement, et qui échoue bruyamment ;
   - ou une exécution manuelle depuis un poste ayant accès à la base.

   La *Build Command* de Vercel n'est pas le bon endroit : un build est rejoué,
   mis en cache et parallélisé, et il n'a aucune raison d'avoir accès à la base
   de production.

**Une frontière connue, et elle n'est pas nouvelle** : en serverless,
`next.config.ts` n'est pas exécuté au démarrage, et `instrumentation.ts` est
appelé par instance de fonction. Une variable malformée s'y déploie donc sans
que rien ne s'arrête au sens d'un conteneur qui sort en 1 — c'est
`/api/health` qui reste le signal (`packages/config/src/env.ts`, constat N15 de
s01). Sur Coolify et sur toute cible Docker, l'image refuse de démarrer ; sur
Vercel, surveillez la sonde.

---

## La construction d'image en CI

Le job `image` de `.github/workflows/ci.yml` fait trois choses à chaque poussée,
et **échoue si l'une d'elles échoue** (critère 7) :

1. il **valide la pile** — `docker compose -f docker-compose.prod.yml config` —
   parce que tout le mécanisme du critère 3 y vit et qu'aucune autre commande de
   la CI ne charge ce fichier ;
2. il construit **les deux étapes d'exécution**, `runner` *et* `migrator` : une
   image `runner` qui construit ne dit rien de celle qui joue les migrations ;
3. il **démarre** l'image `runner` sans aucune variable et exige qu'elle sorte en
   erreur en nommant `DATABASE_URL`.

Une image construite et jamais démarrée ne prouve rien — et une image qui
démarrerait sans configuration serait précisément le défaut que cette story
ferme.
