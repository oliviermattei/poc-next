# ADR 051 — Le seau de défi 2FA compte la valeur que le serveur lit, et il mord avant le plafond de la bibliothèque

- Status: accepted
- Date: 2026-09-04
- Scope: story s28-rate-limiting
- Supersedes: la clause « **La double authentification a un seau par défi, lu par
  nom exact** » de l'ADR 050. Le reste de l'ADR 050 reste en vigueur.

## Context

L'ADR 050 a fait lire le cookie de défi par **nom exact**, après qu'un leurre posé
en tête de l'en-tête `Cookie` eut permis de contourner le seau (401×20, aucun
429). Le raisonnement était juste — « la bibliothèque lit un nom exact, donc ce
qui compte doit lire par nom exact aussi » — mais il n'avait pas été mené
jusqu'au bout : **le nom était le même, la valeur ne l'était pas**.

Le chemin réel du second facteur est
`ctx.getSignedCookie(nom)` (`better-call@1.4.0/dist/context.mjs:38`) →
`parsedCookies.get(nom)`, et cette table vient de
`better-call/dist/cookies.mjs:19-40`, qui **détrime** la sous-chaîne qui suit le
`=`, retire ses **guillemets encadrants**, puis applique `tryDecode`
(`dist/utils.mjs`) — `decodeURIComponent` dès que la valeur contient un `%`, et
la valeur brute si le décodage lève. Le limiteur, lui, prenait la sous-chaîne
brute, seulement détrimée, puis la mettait en minuscules pour fabriquer sa clé —
une **troisième** normalisation, qui ne correspondait à personne.

L'en-tête `Cookie` étant écrit intégralement par l'appelant, celui-ci pouvait
envoyer **le même défi** sous autant d'encodages qu'il voulait et scinder son
propre seau à volonté. Mesuré par la revue contre l'application démarrée : quinze
encodages `%XX` d'un même défi → 401×15, la même valeur brute → 401×10 puis
429×5.

Un second fait, découvert par la même revue, commande l'autre moitié de cette
décision. `better-auth@1.7.2` s'impose déjà **cinq essais par défi** sur le
chemin de la connexion : `beginAttempt(5)` dans
`dist/plugins/two-factor/totp/index.mjs` comme dans
`dist/plugins/two-factor/backup-codes/index.mjs`, et
`dist/plugins/two-factor/verify-two-factor.mjs` **détruit le défi** au cinquième
(`TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE`), en plus d'un verrouillage de compte. Le
seuil livré était `maxPerSubject: 10` : sur un défi **authentique**, il ne
pouvait donc jamais refuser le premier. La garantie que cinq fichiers du dépôt
attribuaient à ce seuil était en réalité tenue, en silence, par le compteur
interne d'une dépendance.

## Decision

**a. Le seau porte la valeur telle que le serveur la lira.** La normalisation
appartient au **lecteur** — `subjectOfCookies` refait, dans cet ordre, les trois
gestes de la bibliothèque (détrimer, retirer les guillemets encadrants, décoder
quand il y a un `%`) et **ne lève jamais** : `decodeURIComponent('%zz')` lève, et
l'en-tête vient de l'attaquant ; une exception ici serait un 500 sur une route
publique, et une valeur comptée autrement que celle que le serveur lit sans
broncher. `subjectBucketKey` ne normalise plus rien : deux normalisations
concurrentes sont exactement ce qui a produit le défaut.

**b. `twoFactor.maxPerSubject` passe sous le plafond de la bibliothèque** — 4,
contre 5. Ce seuil-ci mord donc le premier sur un défi authentique, et la phrase
« c'est `maxPerSubject` qui borne l'énumération » redevient vraie. Le plafond de
`better-auth` reste nommé comme **second filet**, avec sa version et ses
fichiers ; `tests/rate-limiting.test.ts` le **dérive de la bibliothèque
installée** et refuse un seuil qui ne serait pas strictement en dessous, si bien
qu'une version qui le déplace fait rougir `pnpm test` au lieu de laisser la
phrase vieillir.

Le second filet n'est pas décoratif dans l'autre sens non plus : un défi
**fabriqué** est refusé par la bibliothèque en 401 **sans jamais être compté**
par elle — `beginAttempt` lève avant tout compteur quand la valeur de
vérification n'existe pas. Ce trafic-là n'est borné que par le seau de ce dépôt.

## Considered options

- **Garder la sous-chaîne brute et documenter la limite** — rejeté : ce n'est pas
  une limite documentable, c'est un seau que l'appelant scinde à volonté, sur le
  chemin d'une énumération à six chiffres.
- **Normaliser plus fort que la bibliothèque** (minuscules, retrait de tous les
  caractères non alphanumériques) — rejeté : toute normalisation qui n'est pas
  **exactement** celle du serveur fait diverger le seau de ce qui est validé, dans
  un sens ou dans l'autre. C'est la faute d'origine, en plus zélée.
- **Vérifier la signature du cookie dans le limiteur** pour ne compter que des
  défis authentiques — rejeté : cela ferait entrer le secret d'authentification et
  son HMAC dans le chemin de la limitation, avant le gestionnaire, pour un besoin
  qui n'est pas l'authenticité mais l'**identité** du seau. Un défi fabriqué doit
  d'ailleurs être compté, pas ignoré.
- **Garder `maxPerSubject: 10` et se reposer sur le plafond de la bibliothèque**
  — rejeté : un seuil qui ne peut jamais mordre le premier est un décor, et la
  protection du dépôt dépendrait en silence du compteur d'une dépendance. La
  moitié honnête de cette option est conservée : le plafond de la bibliothèque
  est nommé, versionné et dérivé par un test.
- **Supprimer le seau par défi et s'en remettre entièrement à la bibliothèque** —
  rejeté : un défi fabriqué n'est jamais compté par elle, donc le coût d'une
  inondation anonyme ne serait plus borné que par le seau d'appelant, qui repose
  sur un en-tête falsifiable.

## Consequences

**Ce qui devient plus facile.** La phrase écrite dans `config/security.ts`,
`docs/security.md` §7, `packages/core/src/module.ts` et les deux `AGENTS.md`
décrit ce que le code fait, et chacune est adossée à une commande qui rougit :
`pnpm test` (rejeu du même défi ré-encodé au répartiteur, plafond dérivé de la
bibliothèque) et `pnpm test:e2e` (le même rejeu contre l'application démarrée).

**Ce qui devient plus difficile.** Un utilisateur légitime qui se trompe quatre
fois de code dans la même tranche de cinq minutes reçoit un 429 au lieu d'un
cinquième « code invalide ». C'est délibéré : le cinquième essai aurait de toute
façon détruit son défi.

**Ce qu'il faut surveiller.**

- **Le plafond de `better-auth` est lu, pas exercé.** Personne n'a brûlé six
  codes faux sur un défi authentique. Le geste humain est écrit dans la note
  d'exécution du plan ; si ce plafond disparaissait, seul le seau de ce dépôt
  resterait — c'est précisément pourquoi il doit rester capable de mordre.
- **Une mise à jour de `better-auth` ou de `better-call` peut déplacer l'un ou
  l'autre.** Le test dérive le plafond ; il ne dérive pas la manière de lire un
  cookie. Un changement de `parseCookies` ne rougirait pas tout seul.
- **La normalisation ne rend pas le seau authentifié.** Elle le rend
  **identique** à ce que le serveur lit. Deux défis distincts restent deux seaux ;
  un défi fabriqué a le sien.
