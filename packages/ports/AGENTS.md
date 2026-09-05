# packages/ports — règles locales

Les **interfaces** des dépendances externes (ADR 006, ADR 008). Rien d'autre.

Un port décrit ce dont le code métier a besoin ; l'implémentation vit dans
`packages/adapters/<provider>`, et une seule est livrée par port. Les fichiers de
capacité, dans l'ordre où ils sont arrivés — **sans en écrire le nombre**, qui a
vieilli deux fois ici (« quatre » au-dessus de cinq, et une parenthèse qui
attendait un cinquième port quand il fallait dire le sixième) : `mailer.ts`
(`Mailer`, s06) pose le gabarit, `storage.ts` (`Storage`, s18) en est le premier héritier,
`payments.ts` (`Payments`, s19, Stripe) le second, `rate-limit.ts`
(`RateLimiter`, s28) le troisième — et le seul dont l'implémentation ne soit pas
un tiers —, `jobs.ts` (`Jobs`, s33, Inngest) le quatrième. L'analytique et le
monitoring (s39) suivront **le même gabarit**, alors il est écrit ici plutôt que
déduit :

*(La liste est celle de `src/` au moment où ces lignes sont écrites, et
`tests/agents-md.test.ts` la **dérive du disque**. Ce que la commande tient
exactement : un port **de plus** dont le nom de fichier n'est cité nulle part
ici fait rougir `pnpm test`. Ce qu'elle ne tient pas, et qui reste à l'auteur :
qu'il ait sa section, sa ligne au tableau de la forme du journal, et son
exception au socle si son échec ne dégrade pas. La phrase disait « non
documenté » ; elle ne vaut que « non nommé », et c'est le constat m2 de la
quatrième revue.)*

| Choix | Ce qui le motive |
|---|---|
| Un fichier par capacité, un seul package | un port n'a aucune dépendance d'exécution : un package par port multiplierait les manifestes sans rien isoler. Ce qu'il faut isoler, c'est un SDK — donc un package par **adapter** |
| L'opération rend un résultat discriminé, elle ne lève pas | une exception remonte par défaut : l'appelant qui l'oublie rend un 500. `ok` oblige à regarder l'échec avant de lire le succès. `docs/reliability.md` §2 : une panne de tiers **dégrade** — **sauf pour `rate-limit.ts`, une exception assumée et écrite** (voir plus bas) |
| Les collaborateurs sont injectés (rendu, journal, horloge, hasard) | c'est ce qui rend un adapter testable sans réseau, et ce qui interdit qu'une implémentation soit choisie par `NODE_ENV` |
| La forme du journal est **fermée** | `docs/security.md` §5 : `JobsLogRecord` n'a aucun champ où mettre une charge utile, une clé de fournisseur, une adresse ou un corps de requête — il porte le job, sa clé d'idempotence, le numéro de tentative et un message assaini. `MailerLogRecord` n'a aucun champ où mettre un destinataire, un sujet, un corps ou une clé. `StorageLogRecord` n'en a aucun où mettre une clé d'objet — qui porte l'identifiant du propriétaire —, un octet ou une URL signée. `RateLimitLogRecord` n'en a aucun où mettre un corps de requête, un mot de passe, un jeton, une adresse email ou la clé du seau : il porte l'IP et la route **en clair** — c'est le critère 6 de s28 —, et **lequel** des deux seaux a refusé, jamais sa valeur. Le compilateur tient la moitié de la garantie ; l'assainissement du `message` du fournisseur tient l'autre, et se prouve par mutation |

## Ce que `Storage` ajoute au gabarit, et pourquoi

Quatre opérations : présigner un téléversement, lire, **écrire**, supprimer.
Les trois premières viennent du critère 1 de s18 ; `write` a été ajoutée par la
revue de la même story, et son motif est mesuré — une URL présignée reste
valable jusqu'à son échéance chez tous les fournisseurs, donc l'objet vérifié à
la confirmation pouvait être réécrit par un rejeu. L'application écrit
elle-même les octets qu'elle vient de valider, vers une clé qu'aucune URL
présignée ne nomme. Trois choix méritent d'être lus avant d'y toucher :

- **il n'y a pas d'URL présignée de lecture** (ADR 032). Servir l'image depuis
  le domaine du seau serait refusé par `img-src 'self'`, et une URL de lecture
  est une capacité **détachée de l'appartenance** : elle ne peut pas tenir « un
  fichier d'organisation n'est lisible que par ses membres » à chaque requête.
  L'application lit par le port et sert elle-même ;
- **`remove` rend `ok: true` quand l'objet n'existait pas.**
  `docs/reliability.md` §1 : une purge rejouée ne doit produire aucun effet
  supplémentaire, et l'état voulu est atteint dans les deux cas. Distinguer les
  deux ferait échouer la seconde purge d'un même périmètre.

- **`write` n'est pas la voie du téléversement.** Elle existe pour la
  **promotion** d'un objet déjà lu et validé, à l'intérieur du serveur ; les
  octets d'un téléversement, eux, ne traversent jamais l'application
  (critère 2). Un appelant qui s'en servirait pour recevoir un fichier du
  navigateur reprendrait le chemin que l'ADR 032 a rejeté, avec sa limite de
  corps de requête.

Ce que ce port **ne peut pas** garantir, et qui est donc écrit : `contentType`
et `contentLength` sont liés à la signature, mais aucune signature ne lie un
en-tête à un contenu. Vérifier que les octets sont réellement une image est le
travail de l'appelant, après téléversement, par `read`.

## Ce que `rate-limit.ts` ajoute au gabarit, et pourquoi

Le **quatrième** port (s28, ADR 050), et le premier dont l'implémentation n'est
pas un tiers : c'est **la base de l'application** (`packages/modules/rate-limit`,
un module du socle, parce que le dépôt n'a qu'un mécanisme pour qu'une table ait
un propriétaire et une migration). Trois choses le distinguent du gabarit, et
elles doivent être lues avant d'y toucher :

- **son échec ne dégrade pas, il refuse.** C'est l'exception assumée à
  `docs/reliability.md` §2, écrite ici parce que la règle la plus proche du code
  disait l'inverse (constat m1 de la troisième revue de s28). Le motif : ce
  « tiers » est notre propre base, et si elle est absente la connexion ne
  fonctionne pas davantage — les sessions y vivent. Refuser ne coûte donc aucune
  disponibilité réelle, alors que laisser passer ferait disparaître la protection
  au moment exact où l'application est fragile. La décision est **chez
  l'appelant** (`createRouteRateLimitGuard`, ADR 050), pas dans le port : ce
  fichier ne fait que rendre `store_unavailable` comme une valeur ;
- **il n'a pas de mode local**, à la différence des autres ports, et pour une
  raison qui n'est pas un oubli : il n'a **pas de clé**. Le repli explicite que
  `AGENTS.md` racine impose (`EMAIL_LOCAL_CAPTURE=1` et ses pareils) existe pour
  qu'un port sans clé de fournisseur reste utilisable localement ; ici il n'y a
  rien à remplacer, et une variable qui éteindrait la limitation **est** une
  porte (critère 8 de s28). La neutralisation se fait **par injection**, dans un
  test ;
- **`sweep(now)` prend l'instant présent, jamais une borne.** Le magasin est
  partagé par toutes les routes et les seaux n'ont pas la même durée : une borne
  « efface tout ce qui précède » ne peut pas dire si une ligne est close, et
  effaçait les seaux longs encore ouverts des autres routes. C'est la **ligne**
  qui porte son échéance.

## Ce que `jobs.ts` ajoute au gabarit, et pourquoi

Le **cinquième** port (s33), et le seul dont la surface soit **coupée en deux** :

- **il ne porte que l'émission, jamais la déclaration.** Le contrat de module
  porte `jobs` — `ModuleJob { id, schedule, run }` — depuis le premier module
  écrit, et c'est la seule façon de déclarer un traitement. Le critère 1 de la
  story demande « une interface typée [qui] expose l'émission d'un événement
  **et** la déclaration d'un job » : la surface unique est la **paire** port +
  clé du contrat, réunie par `dispatchModuleJob` (`@repo/core`). En déclarer une
  seconde ici aurait fait deux vérités pour une même chose ;
- **`ok: true` dit « c'est parti », pas « c'est fait ».** Le port met en file ;
  il ne rend jamais le résultat du traitement, qui se lit au journal du
  répartiteur. C'est ce qui distingue ce port des quatre autres, dont l'appel
  est synchrone de bout en bout ;
- **chaque code d'erreur dit de quel côté il tombe**, transitoire ou définitif,
  et ce n'est pas de la documentation : `docs/reliability.md` §3 interdit de
  réessayer une erreur de validation, et la politique de reprise lit ce
  classement au lieu de l'inventer. La lecture exécutable est
  `isTransientJobsError` (`@repo/core`), dont l'exhaustivité est tenue par le
  compilateur ;
- **son échec dégrade**, contrairement à `rate-limit.ts` : un fournisseur de
  jobs absent ne doit pas empêcher de répondre. Le repli est l'exécution
  synchrone dans la requête appelante (critère 8), et il est déjà le précédent
  du socle pour la purge et l'export.

Son mode local **n'exige aucun service** : il exécute en mémoire
(`@repo/jobs-testing`), sur opt-in explicite (`JOBS_LOCAL_RUNNER=1`), jamais
déduit de `NODE_ENV`.

## Imports autorisés

- rien. Ce package est une feuille du graphe, **sans aucune dépendance** — ni
  d'exécution, ni de dépôt. Il ne connaît ni React, ni Resend, ni la base ;
- `@repo/typescript-config` pour la configuration du compilateur ;
- `vitest` dans les fichiers de test, s'il en apparaît un jour.

## Ne doit jamais contenir

- **d'implémentation**, même triviale, même « juste pour les tests » : une
  doublure ici entre dans le graphe de tous les appelants du port. Les doublures
  vivent dans `@repo/mailer-testing`, qui est un outil de test ;
- de SDK, de client HTTP, de module Node : un port qui importe `node:fs` n'est
  plus une interface ;
- de règle métier : un port dit ce qu'on demande à l'extérieur, jamais quand on
  le demande ;
- de **seconde implémentation** d'un port dans `packages/adapters` (ADR 008) :
  SMTP, SendGrid et Nodemailer sont au cimetière. Une doublure de test ne les
  rend pas légitimes.

## Tests

Ce package n'a que des types : il n'y a rien à exécuter, donc rien à tester ici.
Les garanties d'un port sont prouvées **chez ses implémentations** —
`packages/adapters/resend/src/*.test.ts` et `packages/adapters/s3/src/*.test.ts`
pour les deux fournisseurs livrés, `packages/mailer-testing/src/*.test.ts` et
`packages/storage-testing/src/*.test.ts` pour les outils de test. Un test propre
`packages/adapters/resend/src/*.test.ts` et `packages/adapters/stripe/src/*.test.ts`
pour les deux fournisseurs livrés, `packages/mailer-testing/src/*.test.ts` et
`packages/payments-testing/src/*.test.ts` pour les outils de test. Un test propre
à ce package vivrait en `src/**/*.test.ts`.

## Ce que `payments.ts` ajoute au gabarit, et pourquoi

- **Une quatrième opération** (`listSubscriptions`) alors que le critère de la
  story en nomme trois : `docs/reliability.md` §5 exige une commande de
  réconciliation, et on ne réconcilie pas sans relire. Elle est hors du chemin
  nominal — aucun webhook ne l'appelle (ADR 034).
- **Un code d'erreur `invalid_signature` distinct** : c'est le seul échec qui
  doive se traduire en 400 **sans le moindre effet de bord**. Le confondre avec
  `invalid_request` rendrait indiscernables « le fournisseur a refusé notre
  requête » et « quelqu'un a forgé un événement ».
- **Une clé d'idempotence reçue en argument** plutôt que tirée par
  l'implémentation : c'est ce qui permet de rejouer un checkout sans en ouvrir
  deux, et de **compter les tirages** dans un test — la mutation qui manquait à
  s06 (revue, F2).
- **Une écriture, une seule, et elle est arrivée en s23** :
  `updateSubscriptionQuantity`. Jusque-là ce port ne savait qu'ouvrir, lire et
  vérifier ; la quantité ne partait qu'une fois, à l'ouverture du tunnel de
  paiement. Facturer au nombre de membres demande de la corriger sur un
  abonnement existant.

  Ce que son entrée impose, et pourquoi : elle porte la quantité **visée**,
  jamais un incrément. Un delta rejoué compte deux fois, une cible rejouée
  converge (`docs/reliability.md` §1, ADR 046). Le port ne peut pas forcer
  l'appelant à dériver sa clé d'idempotence de cette cible, mais il refuse
  d'exprimer autre chose qu'une cible — et c'est `tests/billing.test.ts` qui
  mesure la clé telle que le réseau la voit.

  Ce qu'elle ne porte pas : le **proratage**. C'est un choix de facturation, il
  appartient au fournisseur et à sa configuration (ADR 046).
