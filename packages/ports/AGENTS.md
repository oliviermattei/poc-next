# packages/ports — règles locales

Les **interfaces** des dépendances externes (ADR 006, ADR 008). Rien d'autre.

Un port décrit ce dont le code métier a besoin ; l'implémentation vit dans
`packages/adapters/<provider>`, et une seule est livrée par port. `Mailer` est
le premier ; storage (s18), paiement (s19), jobs (s33), analytique et monitoring
(s39) suivront **le même gabarit**, alors il est écrit ici plutôt que déduit :

| Choix | Ce qui le motive |
|---|---|
| Un fichier par capacité, un seul package | un port n'a aucune dépendance d'exécution : un package par port multiplierait les manifestes sans rien isoler. Ce qu'il faut isoler, c'est un SDK — donc un package par **adapter** |
| L'opération rend un résultat discriminé, elle ne lève pas | une exception remonte par défaut : l'appelant qui l'oublie rend un 500. `ok` oblige à regarder l'échec avant de lire le succès. `docs/reliability.md` §2 : une panne de tiers **dégrade** |
| Les collaborateurs sont injectés (rendu, journal, horloge, hasard) | c'est ce qui rend un adapter testable sans réseau, et ce qui interdit qu'une implémentation soit choisie par `NODE_ENV` |
| La forme du journal est **fermée** | `docs/security.md` §5 : `MailerLogRecord` n'a aucun champ où mettre un destinataire, un sujet, un corps ou une clé. Le compilateur tient la moitié de la garantie ; l'assainissement du `message` du fournisseur tient l'autre, et se prouve par mutation |

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
Les garanties du port sont prouvées **chez ses implémentations** —
`packages/adapters/resend/src/*.test.ts` pour l'unique fournisseur livré,
`packages/mailer-testing/src/*.test.ts` pour les outils de test. Un test propre
à ce package vivrait en `src/**/*.test.ts`.
