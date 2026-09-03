# Revue anti-hallucination — s27-deployment

Branche `feature/s27-deployment`, commit unique `468cc48`.
Diff jugé : `git diff dev...feature/s27-deployment` (15 fichiers, +1516 / −92).
Mesures du 3 septembre 2026, Docker 29.7.2 / Compose v5.4.0, Node v22.17.0, pnpm 10.33.0.

## 1. Les commandes, exécutées par la revue

| Commande | Résultat |
|---|---|
| `pnpm test` | **1855 verts, 8 ignorés**, 58 fichiers (exit 0), rejoué en fin de revue |
| `pnpm typecheck` | vert, 24 tâches |
| `pnpm lint` | vert, « No issues found » |
| `pnpm test:e2e` | **86 verts, 8 ignorés** (exit 0) |
| `actionlint` | vert, exit 0 |
| `docker build --target runner` | vert, image 307 Mo / 74,8 Mo de contenu |
| `docker build --target builder` puis `pnpm build --force` **sans aucune variable** | vert — la règle « le build n'a pas besoin des variables d'exécution » tient après l'ajout d'`instrumentation.ts` |

**La suite a bien tourné contre une base** : port mort → **339 ignorés et 2 fichiers en échec** au lieu de 8 ignorés. **331 tests supplémentaires** se sont donc réellement exécutés contre PostgreSQL.

## 2. La revendication centrale, vérifiée indépendamment

### 2.1 `output: 'standalone'` ferme la garde de démarrage — **vrai**

Dans le `server.js` de l'image :

```
20:process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)
```

La configuration est **sérialisée en littéral** ; `next.config.ts` n'est pas chargé au démarrage du serveur autonome. Le constat est exact.

### 2.2 L'image **refuse** vraiment — **vrai**

```
$ docker run --rm s27-review-web:latest
✓ Ready in 0ms
Démarrage refusé : Invalid environment variables:
  - DATABASE_URL: Invalid input: expected string, received undefined
EXIT=1
```

Code de sortie **1**, variable **nommée**. Le job `image` de la CI teste ce couple — sortie non nulle **et** présence de la variable dans le journal.

### 2.3 Aucun secret dans l'image — **vrai, et structurel**

`find / -xdev` ne rend que les CA d'Alpine et le `.npmrc` de npm. Vérifié aussi **sur le contexte de build réel** (image jetable faisant `COPY . .`) : 11,2 Mo, **aucun** `.env`, `.pem`, `.key`. Ce n'est pas le `Dockerfile` qui se retient, c'est le contexte qui est amputé.

### 2.4 `process.env.NEXT_RUNTIME` dans `instrumentation.ts` — **justification tenue**

`apps/web/proxy.ts` existe, donc Next produit un paquet *edge*. Dans ce paquet : la chaîne `NEXT_RUNTIME` **n'apparaît pas** (expression remplacée par un littéral, branche éliminée), et `assertStartupConfiguration`, `loadRootEnv`, `node:fs` **non plus** — 0 occurrence. Une indirection casserait le pliage de constante. Idem pour `process.exit`, déplacé dans `lib/startup.ts`. **Pas de forme plus propre dans Next 16.** La déviation à `docs/security.md` §5 est réelle mais documentée en trois endroits et n'introduit aucune lecture de configuration.

## 3. Les mutations — au site du défaut, toutes restaurées

| Mutation | Site | Rouges |
|---|---|---|
| retirer `refuseStartupOnInvalidConfiguration()` | `instrumentation.ts` (point de composition) | **1** / 10 |
| `ENV SKIP_ENV_VALIDATION=1` dans `runner` | `Dockerfile` | **1** / 10 |
| retirer `**/.env` | `.dockerignore` | **1** / 10 |
| variable du schéma non documentée | `packages/config/src/env.ts` | **1** |
| variable documentée qui n'existe plus | `docs/deployment.md` | **1** |
| `return` immédiat dans `assertStartupConfiguration` | `lib/startup.ts` (garde partagée) | **13** / 43 |
| migration cassée | `marketing/migrations/` | compose exit 1, `web` jamais démarré |

Deux mutations poussées **au-delà du test**, pour éviter une garde qui rougit sans que le défaut existe :

- `SKIP_ENV_VALIDATION=1` dans `runner`, image reconstruite et lancée sans variables : le conteneur reste `running`, journalise « validation désactivée » puis boucle sur « database unreachable », et **ne refuse rien** ;
- `.dockerignore` amputé, contexte réellement construit : `/ctx/.env` présent, 2388 octets, 3 lignes `DATABASE_URL`.

La garde ne se contente donc pas de rougir : elle rougit **là où l'image casse**.

## 4. Les sept critères

1. **Image qui démarre avec les seules variables** — vérifié, réserve en F6.
2. **Compose de production, port configurable** — pile montée (`APP_PORT=3127`) : `/api/health` → `{"status":"ok","database":"connected"}`, `/` → 307 vers `/fr`, page de 75 110 octets, en-têtes de production présents — `default-src 'self'`, nonce, **ni `unsafe-inline` ni `unsafe-eval`**, HSTS, `x-frame-options: DENY`. La base **n'est publiée sur aucun port de l'hôte**.
3. **Migrations avant basculement, échec interrompt** — vérifié sur volume neuf ; rejeu idempotent. **Mais la conséquence documentée est fausse — F1.**
4. **Checklist dérivée** — vérifiée par deux mutations opposées.
5. **Recette Coolify** — **non exécutée**, non cochée, aucune trace inventée.
6. **Recette Vercel** — **non exécutée**, dite comme telle.
7. **CI construit l'image** — job `image` sans `if:`, `actionlint` vert, le balayage de s25 s'applique.

## 5. Les interdits — sept sur huit vérifiés

Aucun `.env` ni secret dans l'image · phase de build absente de l'exécution · `ENV_KEYS` non recopié · migrations hors `postinstall` (aucun `postinstall` dans le dépôt) · pas de `hashFiles` en `if:` de job · harnais de s25/s26 et specs intacts · `config/` intact. Le huitième — aucune ressource Coolify créée — est hors de portée de cette revue.

## 6. Anti-hallucination

Chaque import ouvert et vérifié : `assertStartupEnv` (`env.ts:536`), `ENV_KEYS` (`:428`), `BUILD_ENV_KEYS` (`:487`), `loadRootEnv`, et les sept résolutions de configuration de modules. Le déplacement vers `lib/startup.ts` est **à comportement identique** — même ordre, mêmes conditions ; la mutation à 13 rouges le confirme. `actions/checkout@v7` est la version des cinq autres jobs.

Les six affirmations « mesuré » de `docs/deployment.md` que j'ai pu rejouer sont **exactes au mot près**. Une seule ne l'est pas, et c'est F1.

## 7. Constats

### F1 — **major** — « la version précédente continue de servir le trafic » est faux

Cinq textes l'affirment — `Dockerfile`, `docker-compose.prod.yml`, `docs/architecture.md:205`, `docs/deployment.md:124` et le message de commit — et `docs/deployment.md` l'écrit juste après « Mesuré, en cassant volontairement une migration ».

**Mesuré ici, sur une pile déjà en service** :

1. pile saine, conteneur `web` `2cf63910bda1`, `/api/health` → **200** ;
2. migration en attente délibérément cassée ;
3. `docker compose … up -d --build` → `service "migrate" didn't complete successfully: exit 1` ;
4. `docker compose ps -a` : `web created` — mais c'est **un nouveau conteneur** (`cf236fb9fb62`) : **l'ancien a été détruit avant que `migrate` ne s'exécute** ;
5. `curl` → **connexion refusée**.

Le critère 3 est tenu — aucun trafic ne bascule sur un schéma à moitié appliqué. Mais l'interruption se fait **par une coupure de service**, pas par une continuité. La mesure d'origine avait été faite sur un volume neuf, où il n'existait aucune version précédente : l'inférence a été écrite comme une mesure, et répétée dans cinq textes.

### F2 — **major** — deux textes de référence laissés périmés

- `docs/reliability.md:43` : « en serverless **et en `output: 'standalone'`**, la validation d'environnement de Next n'est pas rejouée … dégrade en 503 silencieux » ;
- `packages/config/src/env.ts:520-527` : même affirmation, dans le commentaire de la fonction **sur laquelle la story s'appuie**.

C'est précisément le cas que s27 vient de fermer. Le dépôt porte donc deux règles contradictoires, dont l'une dans un **socle non négociable**. Ni l'un ni l'autre fichier n'est dans le diff.

### F3 — **minor** — aucun ADR pour un changement structurel

« L'application a deux points de démarrage » est désormais une invariante écrite dans trois documents, et `apps/web` acquiert la **seule** lecture directe de `process.env` du dépôt — exception explicite à `docs/security.md` §5. Aucun ADR ne consigne la décision et ses options rejetées.

### F4 — **minor** — la sonde de l'image fige le port que `PORT` rend variable

`Dockerfile:102-103` sonde `http://127.0.0.1:3000` alors que `ENV PORT=3000` est surchargeable. Un exploitant qui pose `PORT=8080` obtient un conteneur perpétuellement `unhealthy` tout en servant correctement.

### F5 — **minor** — les conteneurs ne reçoivent leur configuration que par un fichier

`env_file: .env.production` avec `required: false`, et **aucun bloc `environment:`**. Une plateforme qui *exporte* les variables interpole correctement `${APP_PORT}` et ne donne **rien** aux conteneurs. C'est le chemin **recommandé** du guide Coolify, et l'affirmation « Coolify les fournit à l'interpolation comme à l'environnement des conteneurs » n'a pas été éprouvée.

### F6 — **minor** — le critère 1 est vrai sous condition

Avec `storage` activé, l'image exige **en plus** une édition de `config/security.ts` (champ `connect`) pour déclarer l'origine du seau. Heurté au premier `docker compose up`, honnêtement documenté — mais « démarre avec les seules variables d'environnement » n'est littéralement vrai que sans stockage.

### F7 — **minor** — la CI ne construit que `runner`

L'étape `migrator` et `docker-compose.prod.yml` — tout le mécanisme du critère 3 — ne sont jamais construits en CI ; seul un balayage par expression régulière les garde.

## 8. Les tests, lus comme du code de production

402 lignes, 11 cas, **aucun décoratif**. Ce qui est bon : le témoin de refus mocke `process.exit` **et relance**, parce que le vrai ne rend jamais la main ; `stubEverything` déclare **tout** l'environnement, ce qui empêche le cas de ne passer que sur un poste bien garni ; « laisse entrer ce que la construction lit » est une garde d'inertie explicite, sans laquelle un `.dockerignore` réduit à `*` satisferait le cas précédent.

Ce qui limite leur portée, **écrit dans les tests plutôt que promis** : `dockerPatternToRegExp` réimplémente la sémantique des motifs Docker, et `serviceBlock` lit le YAML par indentation. J'ai levé le doute en construisant réellement le contexte dans les deux états ; la simulation pourrait diverger demain sans que rien ne le dise.

## 9. Régressions

`next.config.ts` est chargé par tout le dépôt : typecheck, lint, 1855 tests et 86 parcours verts ; `tests/env-wiring.test.ts` et `tests/golden-path.test.ts` intacts. `output: 'standalone'` ne change rien à `next dev`. `pnpm build` **sans aucune variable** reste vert.

## 10. Non vérifié

- **Les recettes Coolify et Vercel** : ni l'une ni l'autre exécutée. **Gestes humains** : créer projet, ressource PostgreSQL 16 et ressource Docker Compose ; renseigner la checklist ; déployer ; **vérifier en particulier F5** — que les variables saisies arrivent bien *dans* les conteneurs et pas seulement à l'interpolation ; consigner URL, date et version.
- **Qu'aucune ressource n'a été créée sur le Coolify** : le serveur MCP n'est pas exposé à cette revue ; la déclaration de l'implémenteur n'a pas pu être recoupée.
- **La garde sous configuration de modules coupée** : non mesurée.
- **L'ordre exact entre `✓ Ready` et `register()`** : le journal affiche `✓ Ready` **avant** le refus, donc l'écouteur semble ouvert pendant la validation. Fenêtre de l'ordre de la milliseconde, mais « avant de servir la moindre requête » n'est pas prouvé.
- **L'intitulé des écrans de Coolify** : le guide dit lui-même ne pas l'avoir vérifié.

## Verdict

Une story techniquement solide, et rare : elle a trouvé un vrai trou — `output: 'standalone'` qui court-circuite la garde de démarrage —, l'a fermé au bon endroit, et l'a prouvé jusqu'au conteneur. Les quatre mutations promises mordent au site du défaut. Rien n'est coché en silence.

Ce qui reste est **documentaire, et bloquant à ce titre** : une garantie de disponibilité affirmée comme mesurée alors qu'elle est fausse (F1), et deux textes de référence — dont un socle non négociable — qui disent encore l'inverse de ce que la story vient de livrer (F2).

## Reprise après revue (même branche, commit amendé `bd97282`)

Les **deux majeurs** et les cinq mineurs ont été refermés.

### F1 — la fausse garantie, re-mesurée et remplacée par la vérité

La re-mesure est **plus précise que le constat** : trois commandes distinctes sur
une pile en service, et une seule détruit le conteneur.

| Commande | Conteneur `web` en service | Réponse |
|---|---|---|
| `run --rm --build migrate` (migrations seules) | **intact**, même id, `Up (healthy)` | 200 |
| `up -d` sans reconstruire | **intact** | 200 |
| `up -d --build` — **la commande de déploiement** | détruit, remplacé, resté à `Created` | connexion refusée |

Le journal donne l'ordre : `web Recreate`, `web Recreated`, **puis** `migrate
Error`. Corrigé dans les cinq textes, avec le remède mesuré : jouer
`run --rm migrate` **avant** `up` si la continuité compte.

### F2 — les deux textes périmés, dont un socle

`docs/reliability.md` §5 et le docstring d'`assertStartupEnv` disent désormais ce
qui est vrai : en `output: 'standalone'` la garde vit dans `instrumentation.ts`
et l'image **refuse en code 1** ; en serverless elle s'exécute mais aucun
orchestrateur n'y lit de code de sortie, donc `/api/health` reste le signal —
**explicitement marqué non mesuré sur Vercel**.

### F3 à F7

**ADR 049** écrit, quatre options rejetées dont l'indirection par `@repo/config`
(elle retire la constante et casse le pliage qui élimine les imports du paquet
edge). **Sonde alignée sur `PORT`** — mesuré : conteneur lancé en `PORT=8080`
rend `healthy`, et l'ancienne sonde y échouait en code 1. **CI** construit
désormais `migrator` et valide `compose config`.

**F5, et c'est la mesure la plus utile pour la recette Coolify** : `env_file` a
été remplacé par une ancre partagée, parce que cumuler les deux est impossible —
un `environment: - CLE` non posée à l'interpolation **efface** la valeur venue
d'`env_file`. Pile montée avec des variables **seulement exportées, sans aucun
fichier** : migrations en 0, `/api/health` vert, et `docker inspect` montre les
24 variables dans l'environnement du conteneur. Le guide n'affirme plus rien sur
Coolify : il nomme les trois chemins d'interpolation et dit que **celui que
Coolify emprunte n'a pas été mesuré**, avec la vérification à faire
(`docker exec <conteneur> env`).

Trouvaille au passage : Compose lit **le `.env` du répertoire** pour
l'interpolation — le `.env` de développement s'était invité dans la première
résolution. `--env-file` l'écarte.

### Contre-vérification indépendante (contexte principal)

Image reconstruite et lancée **sans aucune configuration** : `Démarrage refusé :
DATABASE_URL`, **code de sortie 1**. `find / -xdev` sur l'image : aucun `.env`,
aucune clé. `actionlint` **0 erreur**. `pnpm typecheck` 24 tâches,
`pnpm lint` sans anomalie, `pnpm test` **1857 passés / 8 sautés**. Un seul
commit, ADR 049 présent.

### Deux honnêtetés de l'implémenteur, à conserver

Il signale avoir **édité temporairement `config/security.ts`** — un dossier que
le plan interdit de modifier — pour obtenir une pile qui serve, le module
`storage` exigeant l'origine du seau. Restauré, `git status` le confirme. Il le
dit plutôt que de le taire.

Et il signale un **écart d'un cas** entre le compte de la revue (1855) et le
sien (1857 après +3 cas), non expliqué, sans aucun rouge. Les comptes de cette
suite varient avec la base.

### Les deux recettes manuelles restent non exécutées

**Coolify** : l'API dont dispose cette session est en lecture plus cycle de vie
sur l'existant — `deploy`, `start`, `stop`, journaux. Elle **n'expose aucune
création** de projet, de base ou d'application. Le déploiement réel demande donc
un geste humain dans l'interface, après quoi le déclenchement, la lecture des
journaux et la vérification de `/api/health` sont automatisables.

**Vercel** : aucun accès dans cet environnement.

Aucune des deux n'est cochée, aucune trace n'est inventée. C'est le précédent
posé par s25 pour le régime Stripe réel.

Max severity: major
Ship allowed: yes
