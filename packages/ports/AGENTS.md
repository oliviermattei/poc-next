# packages/ports — règles locales

Les **interfaces** des dépendances externes (ADR 006, ADR 008). Rien d'autre.

Un port décrit ce dont le code métier a besoin ; l'implémentation vit dans
`packages/adapters/<provider>`, et une seule est livrée par port. `Mailer` est
le premier ; `Storage` (s18) est le deuxième et le premier héritier du gabarit ;
paiement (s19), jobs (s33), analytique et monitoring (s39) suivront **le même**,
alors il est écrit ici plutôt que déduit :
le premier, `Payments` le second (s19, Stripe) ; storage (s18), jobs (s33),
analytique et monitoring (s39) suivent **le même gabarit**, alors il est écrit
ici plutôt que déduit :

| Choix | Ce qui le motive |
|---|---|
| Un fichier par capacité, un seul package | un port n'a aucune dépendance d'exécution : un package par port multiplierait les manifestes sans rien isoler. Ce qu'il faut isoler, c'est un SDK — donc un package par **adapter** |
| L'opération rend un résultat discriminé, elle ne lève pas | une exception remonte par défaut : l'appelant qui l'oublie rend un 500. `ok` oblige à regarder l'échec avant de lire le succès. `docs/reliability.md` §2 : une panne de tiers **dégrade** |
| Les collaborateurs sont injectés (rendu, journal, horloge, hasard) | c'est ce qui rend un adapter testable sans réseau, et ce qui interdit qu'une implémentation soit choisie par `NODE_ENV` |
| La forme du journal est **fermée** | `docs/security.md` §5 : `MailerLogRecord` n'a aucun champ où mettre un destinataire, un sujet, un corps ou une clé. `StorageLogRecord` n'en a aucun où mettre une clé d'objet — qui porte l'identifiant du propriétaire —, un octet ou une URL signée. Le compilateur tient la moitié de la garantie ; l'assainissement du `message` du fournisseur tient l'autre, et se prouve par mutation |

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
