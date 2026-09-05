# ADR 060 — Le migrateur rejoue la création concurrente, et elle seule

- Status: accepted
- Date: 2026-09-05
- Scope: story s34-account-deletion

## Context

`runMigrations` (`packages/db/src/migrate.ts`) applique les migrations d'un
module et rend ce qui a réellement été joué. Son idempotence est celle de
Drizzle : le journal des migrations déjà appliquées vit dans la base, un second
passage n'exécute rien.

**Cette idempotence n'est pas de la concurrence.** Deux migrateurs qui démarrent
ensemble sur une base vierge lisent tous deux un journal vide, puis émettent le
même `CREATE TABLE` ; le perdant échoue sur le catalogue de PostgreSQL —
`42P07`, `42710`, ou `23505` sur `pg_type_typname_nsp_index`.

s52 a établi ce cas **par lecture** et l'a délibérément laissé ouvert
(`tests/fixtures/intermittents.ts`, entrée `migrations/course-entre-fichiers`) :
quatre fichiers de `tests/` appellent `runModuleMigrations` dans leur `beforeAll`
contre la même base, dans des travailleurs Vitest parallèles. Le registre écrit
que le correctif « change le contrat de migration de `@repo/db` et vaut pour la
production autant que pour la suite : c'est une décision de structure, elle se
prend au plan et non ici ».

s34 l'a rencontrée : en ajoutant un quatrième module à sa suite, elle a fait
rougir `pnpm test:minimal-profile`, qui joue les suites contre une base **créée
pour l'exécution** où les modules coupés n'ont pas été migrés par la recette.
Le premier correctif — un rejeu dans le fichier de test — a simplement déplacé
l'échec sur `tests/organizations.test.ts` : mesuré. La décision ne pouvait plus
être différée, et elle n'était pas au plan ; cet ADR est ce qui manquait.

## Decision

`runMigrations` **rejoue un pas de migration perdu contre un créateur
concurrent, et lui seul** : au plus cinq tentatives, avec un recul croissant, et
**uniquement** quand l'erreur porte l'un des codes de création concurrente.
Toute autre erreur sort à la première tentative.

Le classement est une fonction pure exportée, `isConcurrentCreationError`, qui
inspecte la chaîne des `cause` — `drizzle-orm@0.45.2` enveloppe l'erreur du
pilote et range l'originale, celle qui porte le code PostgreSQL, dans `cause`.

## Considered options

- **Ne rien changer, et sérialiser les suites de tests** (une passe de migration
  unique avant les travailleurs, ou `--no-file-parallelism`) — rejeté : cela
  répare le symptôme là où il se voit et laisse le contrat de `@repo/db` faux.
  Deux conteneurs de migration lancés ensemble — un redéploiement qui se
  chevauche, un `docker compose up` sur deux répliques — produisent exactement
  la même course en production, et l'un des deux mourrait. Sérialiser la suite
  coûte par ailleurs plusieurs minutes à chaque exécution.
- **Rejouer dans chaque fichier de test appelant** — rejeté, et **mesuré** :
  rejouer d'un seul côté déplace l'échec sur l'autre appelant. La convergence
  n'est une propriété de personne tant qu'elle n'est pas celle du migrateur.
- **Un verrou consultatif PostgreSQL autour de la migration**
  (`pg_advisory_lock`) — rejeté pour une raison technique et une raison de
  portée. Technique : `options.db` est un **pool**, et un verrou de session
  serait pris sur une connexion et relâché sur une autre — il faudrait réserver
  une connexion pour la durée de la migration, ce que l'interface reçue
  n'expose pas. De portée : un verrou fait attendre le second migrateur
  jusqu'au bout de la migration du premier, ce qui est plus lourd que de le
  laisser échouer puis relire un journal déjà rempli.
- **Rejouer toute erreur de migration** — rejeté : `docs/reliability.md` exige
  qu'une migration en échec empêche l'application de démarrer. Le rejeu
  indiscriminé ne change pas cette issue — Drizzle annule, la tentative
  suivante refait la même chose et échoue de même —, mais il fait payer cinq
  tentatives et environ 1,5 s à un échec réel, dans le conteneur de migration
  qui précède la bascule du trafic.
- **Rendre le migrateur idempotent par `create table if not exists`** — rejeté :
  les fichiers SQL sont **générés** par `drizzle-kit`, ce dépôt ne les écrit
  pas, et les réécrire après génération rouvrirait la règle « `generate` est la
  seule voie ».

## Consequences

- Deux migrateurs concurrents convergent au lieu d'en tuer un. C'est vrai de la
  suite de tests **et** de la production : un second conteneur de migration
  lancé par erreur ne fait plus échouer le déploiement.
- **Ce que cela ne change pas** : une migration réellement en échec échoue
  toujours, et empêche toujours le démarrage. Le classement borne le coût de cet
  échec, il ne l'annule pas — et c'est ce qu'il faut retenir avant de croire que
  ce rejeu protège de quelque chose de plus.
- **Ce qui devient plus difficile à voir** : un second migrateur concurrent ne
  se signale plus par un plantage. S'il devient utile de le savoir, c'est une
  ligne de journal qu'il faudra ajouter — le rejeu est silencieux aujourd'hui.
- La commande qui échoue si le classement cesse d'être juste :
  `pnpm test`, cas « la création concurrente d'un objet, distinguée d'un échec »
  (`tests/migrations.test.ts`). La concurrence réelle, elle, est exercée par
  `pnpm test:minimal-profile`, où le défaut s'est produit.
