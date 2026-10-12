# ADR 028 — Codes de secours hachés, secret TOTP chiffré

- Status: accepted
- Date: 2026-08-31
- Scope: story s13-two-factor

## Contexte

`docs/security.md` §2 range sous une seule ligne deux choses que la
cryptographie ne traite pas de la même manière :

> Secrets de second facteur et codes de secours stockés **hachés**.

s13 met cette ligne à l'épreuve, et elle se casse en deux :

- **le secret TOTP est réversible par construction.** Vérifier un code exige de
  le regénérer, donc de relire le secret. Aucune implémentation de TOTP au
  monde n'en stocke une empreinte ; exiger « haché » ici, c'est exiger de ne pas
  faire de TOTP ;
- **les codes de secours, eux, peuvent être hachés** — ce sont des mots de
  passe à usage unique, comparés à une saisie. Mais Better Auth 1.7.2 les range
  **chiffrés** par défaut (`storeBackupCodes: 'encrypted'`,
  `symmetricEncrypt` avec le secret de l'application), et sa vérification
  (`plugins/two-factor/backup-codes/index.mjs`) compare `codes.includes(code)`
  après déchiffrement : elle a besoin d'un magasin réversible.

Chiffré n'est pas « en clair », mais ce n'est pas « haché » non plus : qui lit
la base et connaît `AUTH_SECRET` retrouve dix mots de passe à usage unique
utilisables. `docs/stories.md` nomme d'ailleurs ce point comme **le** piège de
la story.

Un troisième fait, mesuré pendant l'implémentation, pèse sur la même décision :
la consommation d'un code par la bibliothèque n'est **pas atomique** sur
PostgreSQL. Voir la section Conséquences.

## Décision

**Deux régimes, dits séparément.**

1. **Les codes de secours sont stockés hachés** — HMAC-SHA256 poivré par le
   secret de l'application, préfixé `sha256:`. Deux moitiés, et il faut les
   deux :
   - `backupCodeOptions.storeBackupCodes` reçoit un couple `{encrypt, decrypt}`
     où `decrypt` est l'identité et `encrypt` remplace chaque code en clair par
     son empreinte (`domain/backup-code.ts`) ;
   - la route du module **hache la saisie** avant de la transmettre à la
     bibliothèque, comme `/sign-in/email` reconstruit déjà son corps. La
     comparaison porte alors empreinte contre empreinte.

   **Deux fonctions, et la séparation est la règle.** L'aiguillage « déjà une
   empreinte ⇒ inchangée » est indispensable *côté magasin* : la bibliothèque
   rappelle l'encodeur avec le **reste** du tableau après chaque consommation,
   et un double hachage rendrait les neuf codes restants inutilisables sans que
   rien ne le dise avant le deuxième usage. Il est **interdit côté saisie** :
   `digestBackupCode`, appliquée à ce qui vient du réseau, hache sans condition
   et ne reconnaît aucune forme. La première version de cet ADR décrivait un
   seul aiguillage pour les deux chemins, et c'est ce qui a fait échouer la
   revue — voir « Ce qui a été corrigé après la revue » plus bas.

2. **Le secret TOTP est chiffré au repos**, pas haché, et n'est **exposé
   qu'une fois** : dans la réponse à `POST /two-factor/enable`, à une requête
   authentifiée de son propriétaire. Le point d'entrée
   `/two-factor/get-totp-uri`, qui le rendrait à volonté sur un compte déjà
   activé, n'est **pas déclaré** par le module — il répond 404 sans atteindre
   la bibliothèque.

`docs/security.md` §2 renvoie désormais à cet ADR. La ligne n'est pas affaiblie :
elle est **découpée** là où elle mélangeait deux objets.

## Options considérées

- **Laisser le défaut de la bibliothèque (`'encrypted'`)** — rejeté : c'est
  exactement le piège que la story nomme. Un vol de sauvegarde de base rendrait
  dix moyens de contournement du second facteur, et la ligne du socle serait
  fausse sans que rien ne la contredise.
- **Réécrire entièrement les codes de secours dans le module** (table dédiée,
  une ligne par code, suppression atomique `delete … returning`) — rejeté pour
  cette story : la consommation d'un code **termine une connexion**, donc il
  faudrait aussi réécrire la création de session, la pose du cookie signé et la
  consommation du défi, c'est-à-dire tout ce que la frontière du module confie
  délibérément à la bibliothèque (`packages/modules/auth/AGENTS.md`). À
  rouvrir si la bibliothèque cessait d'exposer `storeBackupCodes`.
- **Hacher aussi le secret TOTP** — rejeté : impossible. La vérification
  regénère le code à partir du secret.
- **Assouplir `docs/security.md` §2** en remplaçant « hachés » par « protégés »
  — rejeté : « protégé » ne nomme aucune propriété, donc aucune commande ne
  peut le vérifier. Le socle perdrait une règle et gagnerait une intention.

## Conséquences

**Ce qui devient plus sûr.** La base ne contient plus aucun code de secours
récupérable **ni rejouable**, quel que soit l'accès au secret de l'application.
`tests/auth.test.ts` le mesure en trois points, et le troisième est celui qui
compte : aucun des dix codes rendus n'apparaît dans la colonne ; chaque entrée
stockée a la forme d'une empreinte ; et **une empreinte lue en base, postée
telle quelle sur `/auth/two-factor/verify-backup-code`, est refusée** sans rien
consommer.

**Ce qui a été corrigé après la revue.** Les deux premières mesures étaient
vraies et ne prouvaient rien : elles décrivent la **forme** du magasin, pas la
**comparaison**. `digestBackupCode` reconnaissait une chaîne
`sha256:<64 hexadécimaux>` et la laissait passer inchangée — y compris quand
elle venait de la saisie —, si bien qu'une empreinte volée ouvrait une session.
Contre un attaquant qui n'a que la base, le montage était alors **moins sûr**
que le défaut `'encrypted'` qu'il remplace : le défaut exigeait encore
`AUTH_SECRET`, celui-ci n'exigeait rien. La correction est la séparation des
deux chemins décrite dans la Décision, et le cas « empreinte lue en base »
rougit dès qu'on les refusionne.

**Ce qui devient plus fragile.** Le montage dépend de trois faits du paquet
installé, et une montée de version doit les rouvrir :

1. `storeBackupCodes` accepte un couple `{encrypt, decrypt}` ;
2. l'encodeur est rappelé avec le tableau **déjà encodé** après une
   consommation — c'est ce qui rend l'aiguillage nécessaire ;
3. les codes émis ont la forme `XXXXX-XXXXX`, qui ne peut pas être confondue
   avec `sha256:<64 hexadécimaux>`.

Le cas « les neuf autres codes fonctionnent encore » est celui qui rougit si
l'un de ces trois faits change.

**Ce qu'il a fallu corriger en chemin, et qui n'était pas prévu.**
`@better-auth/core` documente `incrementOne` comme « the race-safe primitive
for guarded state transitions » ; l'implémentation PostgreSQL de
`@better-auth/drizzle-adapter@1.7.2` ne l'est pas. Elle écrit
`UPDATE … WHERE id IN (SELECT id FROM … WHERE <garde> LIMIT 1)` : la garde vit
dans un sous-select, que la ré-évaluation d'EvalPlanQual ne refait pas contre la
ligne mise à jour. **Deux consommations simultanées du même code réussissaient
toutes les deux** — observé une exécution sur quatre. Le module enveloppe donc
cette écriture, et elle seule, dans un `UPDATE … WHERE id = ? AND backup_codes = ?`
(`infrastructure/two-factor-adapter.ts`). Tout le reste — compteur d'échecs,
verrouillage par compte — garde le chemin de la bibliothèque.

**Ce qui a été ajouté après la revue, et qui n'était pas prévu non plus.**
Le critère 4 de la story demande qu'un code TOTP « erroné **ou rejoué** » soit
refusé. Le greffon ne mémorise aucun compteur consommé : un code accepté restait
valable jusqu'à quatre-vingt-dix secondes, sur autant de défis neufs qu'on
veut. La colonne `auth_two_factor.last_totp_step` (migration additive `0002`)
porte le dernier pas consommé par compte, pris par comparaison-et-échange.
Retrouver le pas d'un code demande le HOTP : il est calculé par la primitive de
la bibliothèque elle-même, `@better-auth/utils@0.4.2` — **promue en dépendance
directe du module**, à la version exacte qu'épingle `better-auth@1.7.2`. Une
seconde implémentation du HOTP ici pourrait diverger de celle qui a vérifié le
code, et une divergence refuserait toutes les connexions. La garde est fermée :
un code qu'elle ne sait rattacher à aucun compteur est refusé.

**Ce qui reste à surveiller.** Un compte créé par un fournisseur externe seul
n'a pas de mot de passe, donc ne peut ni activer ni désactiver le second
facteur : la bibliothèque exige `validatePassword` sur les trois opérations
sensibles. C'est cohérent — il n'y a pas de premier facteur à renforcer —, et
c'est s14 (passkeys) qui rouvrira la question.
