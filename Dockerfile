# syntax=docker/dockerfile:1

# **L'image de production** (s27).
#
# Trois étapes, et une règle qui commande tout le fichier :
#
#   l'étape de construction contourne la validation d'environnement,
#   les étapes d'exécution la subissent.
#
# `apps/web/next.config.ts` et `apps/web/instrumentation.ts` valident la
# configuration au démarrage, alors qu'`AGENTS.md` exige que « le build n'ait
# pas besoin des variables d'exécution ». Les deux ne tiennent ensemble que par
# l'échappatoire de `packages/config/src/env.ts` — `NEXT_PHASE` et
# `SKIP_ENV_VALIDATION`. Elle est **portée par la commande de build**, jamais
# par un `ENV` d'étape : posée dans une étape, elle serait héritée par tout ce
# qui en descend, et l'image démarrerait en production sans vérifier sa
# configuration — verte, silencieuse et cassée. `tests/deployment.test.ts`
# garde la règle, et `docker run` sans variables le prouve : le conteneur doit
# sortir en nommant ce qui manque.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo


# ---------------------------------------------------------------------------
# Construction : le dépôt entier, ses dépendances de développement, et la
# sortie autonome de Next (`output: 'standalone'`).
# ---------------------------------------------------------------------------
FROM base AS builder

COPY . .

# `--frozen-lockfile` : l'installation échoue si le lockfile diverge du
# `package.json` au lieu de le réécrire en silence (socle de sécurité §6).
RUN pnpm install --frozen-lockfile

# **L'échappatoire, sur cette commande et sur elle seule.** Le build n'a ni
# `DATABASE_URL`, ni secret de session, ni clé de paiement : il n'en a pas
# besoin, et il ne doit surtout pas en recevoir.
RUN SKIP_ENV_VALIDATION=1 pnpm build


# ---------------------------------------------------------------------------
# Migrations : jouées **avant** le basculement du trafic, dans un conteneur
# distinct qui sort en erreur si une migration échoue (critère 3).
#
# Pas un `postinstall`, pas une étape du démarrage de l'application : un
# conteneur à part, dont `docker-compose.prod.yml` fait dépendre l'application
# par `service_completed_successfully`. Une migration en échec **empêche la
# nouvelle version de démarrer** : aucun trafic n'atteint un schéma à moitié
# appliqué. Ce n'est pas pour autant une continuité de service — sur une pile
# recréée par `up -d --build`, le conteneur précédent est déjà détruit quand
# `migrate` s'exécute, et plus rien ne répond. `docs/deployment.md` dit la
# mesure et les deux façons de ne pas couper.
#
# Elle repart de l'étape de construction parce que `pnpm db:migrate` a besoin
# du dépôt : `config/features.ts` décide quels modules migrent, et les fichiers
# SQL versionnés vivent dans les modules. La seule variable qu'elle exige est
# `DATABASE_URL` (revue de s06, G3) — vérifié sur le schéma, `getEnv` acceptant
# une source qui ne porte qu'elle.
# ---------------------------------------------------------------------------
FROM builder AS migrator

ENV NODE_ENV=production

RUN addgroup -S app && adduser -S app -G app && chown -R app:app /repo
USER app

CMD ["pnpm", "db:migrate"]


# ---------------------------------------------------------------------------
# Exécution : la sortie autonome, et rien d'autre.
#
# Pas de pnpm, pas de dépôt, pas de dépendance de développement, pas de `.env`
# — `.dockerignore` l'empêche d'entrer dans le contexte, donc aucun `COPY` ne
# peut le prendre. Tout arrive par l'environnement du conteneur, et
# l'instrumentation refuse le démarrage si quelque chose manque.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Utilisateur non privilégié : un processus applicatif n'a aucune raison d'être
# root dans son conteneur.
RUN addgroup -S app && adduser -S app -G app

# La sortie autonome porte déjà son `node_modules` réduit et son `server.js`.
# Les fichiers statiques ne sont pas tracés par Next : ils se recopient à côté.
COPY --from=builder --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static

USER app

EXPOSE 3000

# La sonde interroge la vraie dépendance (`docs/reliability.md` §6) : elle
# répond 503 tant que la base est injoignable.
#
# Elle suit `PORT`, qu'un orchestrateur surcharge : figer `3000` rendrait un
# conteneur perpétuellement `unhealthy` **tout en servant correctement**, donc
# une boucle de redéploiement sur une application qui marche. La forme *shell*
# est ce qui permet l'expansion — Docker ne substitue pas les variables dans les
# arguments de `CMD`, c'est `/bin/sh` qui le fait à l'exécution du conteneur.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget --quiet --spider "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1

CMD ["node", "apps/web/server.js"]
