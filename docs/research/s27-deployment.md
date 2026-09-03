# Research — Story s27-deployment

## Ce qui existe, et ce qui n'existe pas

**Rien de la chaîne de déploiement n'est écrit.** Balayage de l'arbre : pas de
`Dockerfile`, pas de `docker-compose.prod.yml`, pas de `vercel.json`, pas de
`Procfile`, aucun document de déploiement dans `docs/`. Le seul artefact est
`docker-compose.yml` (839 octets), qui ne monte que la base de développement.

Cette story part donc de zéro sur ses trois premiers critères — contrairement à
s25 et s26, qui composaient de l'existant.

## Le fait qui commande le Dockerfile

`apps/web/next.config.ts` (140 lignes) **fait un travail considérable au
chargement** : `assertStartupEnv`, la résolution de la configuration de chaque
module (`resolveAuthConfig`, `resolveBillingConfig`, `resolveMailerConfig`,
`resolveOAuthConfig`, `resolveStorageConfig`), la validation du catalogue de
facturation et `assertFeatureGates`.

Or `AGENTS.md` est explicite sur `pnpm build` : « le build n'a pas besoin des
variables d'exécution ». Les deux ne peuvent tenir ensemble que par une
échappatoire, et **elle existe** : `isBuildPhase`
(`packages/config/src/env.ts:493-495`) reconnaît `BUILD_ENV_KEYS` —
`NEXT_PHASE` et `SKIP_ENV_VALIDATION` — et `resolveEnv` rend `undefined` en
phase de build (`:547`).

C'est exactement le mécanisme que s26 a exhumé il y a quelques heures, en
découvrant qu'il n'était **pas** retiré de l'environnement d'un clone et
constituait un chemin de vert silencieux. Ici il est l'inverse : il est ce qui
rend une image Docker construisible sans secrets.

**Conséquence directe pour le Dockerfile** : l'étape de construction pose la
phase de build ; l'étape d'exécution ne la pose **pas**, sans quoi l'image
démarrerait sans valider son environnement — et le critère 1 (« démarre avec les
seules variables d'environnement ») deviendrait faux en silence.

## Les cinq faits structurants

1. **`next.config.ts` n'a pas d'`output`.** Une image Docker sobre exige
   `output: 'standalone'` ; sans lui, il faut embarquer tout `node_modules` d'un
   monorepo pnpm, c'est-à-dire l'essentiel du dépôt. C'est le premier geste du
   plan, et il touche un fichier que toutes les autres stories chargent.
2. **`isBuildPhase` est l'échappatoire, et elle est à double tranchant** (ci-dessus).
3. **`ENV_KEYS` est dérivé du schéma** (`packages/config/src/env.ts:428`). Le
   critère 4 — « une checklist exhaustive des variables ; un test la compare au
   schéma et échoue en cas d'écart » — est donc **dérivable**, pas à recopier.
   s26 a déjà employé cette dérivation ; la reprendre évite une liste qui
   mentirait à la première variable ajoutée.
4. **Les migrations doivent être rétrocompatibles avec la version encore en
   ligne** (`docs/reliability.md`, et la note de la story). Le critère 3 demande
   qu'elles soient jouées **avant** le basculement du trafic, et qu'un échec
   interrompe le déploiement — donc une étape distincte, pas un `postinstall`.
5. **Le Coolify de l'utilisateur est joignable** : version 4.3.14, un serveur
   `localhost` (`host.docker.internal`) joignable et utilisable, 7 projets,
   5 applications, 2 services, **0 base de données**. Le critère 5 est donc
   réellement exécutable, pas seulement documentable — mais il crée de
   l'infrastructure sur la machine de l'utilisateur.

## Les deux critères que le harnais ne peut pas fermer seul

Les critères 5 et 6 sont des **recettes manuelles** : un déploiement de bout en
bout depuis un dépôt neuf, avec « la trace (URL déployée, date, version)
consignée dans la revue ».

- **Coolify** est atteignable techniquement (fait 5), mais déployer crée un
  projet, une base et une application sur l'infrastructure de l'utilisateur.
  C'est une action sortante et durable : elle demande son accord explicite, et
  ce n'est pas au plan de le supposer.
- **Vercel** demande un compte, une connexion et un dépôt lié. Rien dans
  l'environnement ne l'indique disponible ; cette recherche n'a trouvé aucun
  jeton ni configuration Vercel.

Le plan doit donc livrer **les guides et les artefacts**, et dire honnêtement
lesquels des deux ont été exercés. s25 a établi le précédent : le mécanisme est
livré et testé à vide, l'exécution réelle est nommée comme non faite plutôt que
cochée en silence.

## Pièges & contraintes

- **Un `Dockerfile` qui embarque un `.env` est une fuite de secret.** Le socle
  interdit les secrets dans un artefact de build. L'image doit être vide de
  configuration ; tout arrive à l'exécution.
- **Le monorepo pnpm complique le `standalone`** : les paquets liés par
  `workspace:` doivent être résolus dans l'image. C'est le piège classique, et il
  se voit au premier `docker run`, pas au `docker build`.
- **`docker-compose.prod.yml` sert la base à côté de l'application.** Attention à
  ne pas reproduire le `docker-compose.yml` de développement, dont le port est
  celui du poste — cette session a déjà consommé six ports (5432 à 5437) pour
  des worktrees.
- **Le critère 7 met la construction de l'image en CI.** s25 a appris à ce dépôt
  qu'une erreur de workflow n'est visible d'aucune commande locale : `actionlint`
  et le test des `if:` de niveau job sont en place et s'appliqueront.
- **Une image construite en CI et jamais démarrée ne prouve rien.** Le critère 7
  dit « échoue si le build de production échoue » — mais un `docker build` vert
  sur une image qui ne démarre pas est le faux vert évident de cette story.

## Questions ouvertes

- **Le déploiement Coolify réel a-t-il lieu ?** Il demande l'accord de
  l'utilisateur. À défaut, le guide est livré et la trace déclarée absente.
- **Vercel est-il accessible ?** Aucun indice dans l'environnement.
- **Quelle version l'image porte-t-elle ?** Le critère 5 veut une trace avec la
  version. Rien n'établit aujourd'hui de numéro de version dans ce dépôt.
- **Où vivent les migrations au déploiement ?** Une étape d'un `docker-compose`,
  une commande de la plateforme, ou un conteneur d'initialisation ? Les trois
  existent chez les concurrents ; la contrainte réelle est « avant le
  basculement, et un échec interrompt ».

## Complexité réelle

`docs/stories.md` annonce **3**. Après lecture : **4**.

Le volume de code est faible — un Dockerfile, un compose, un guide. Mais trois
choses pèsent : la story **part de zéro** là où les précédentes composaient ;
elle touche `next.config.ts`, que tout le dépôt charge ; et deux de ses sept
critères ne sont pas fermables par le harnais, ce qui impose de livrer une
honnêteté explicite plutôt qu'une case cochée.

Pas de découpe : les sept critères décrivent une seule chaîne, et livrer une
image sans le guide qui la déploie ne servirait personne.
