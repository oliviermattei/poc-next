---
story: s13-two-factor
validated: yes
---

# Plan — s13-two-factor

Recherche : `docs/research/s13-two-factor.md`.
Design : `docs/designs/s13-two-factor.md` (+ `.html`).

**Sections des socles engagées** — `docs/security.md` **§2** (rotation de
session à l'élévation de privilège ; secrets de second facteur et codes de
secours ; jetons à usage unique et consommation atomique), **§3** (vérification
côté serveur, le compte agit sur lui-même), **§4** (Zod / corps reconstruit à
chaque frontière ; aucun `dangerouslySetInnerHTML`), **§5** (aucun secret dans
un journal ni dans une URL), **§6** (une dépendance ajoutée, justifiée par la
story), **§7** (aucun refus qui renseigne ; événements de sécurité journalisés ;
la limitation **partagée** reste s28, cf. recherche §2.3).
`docs/reliability.md` **§1** (consommation d'un code prouvée par exécution
concurrente), **§4** (migration additive, rétro-compatible).

**Un seul fichier de test neuf** — `e2e/two-factor.spec.ts`. Tout le reste
s'ajoute à `packages/modules/auth/src/domain/auth-rules.test.ts`,
`tests/auth.test.ts`, `tests/rendered-text.test.ts` et `tests/i18n.test.ts`.

## Décisions portées par ce plan

1. **Critère « module non activé » réinterprété** — `auth` est socle
   (ADR 021), précédent s12 validé en revue. Forme retenue : recherche §9.
2. **Codes de secours hachés** — le stockage chiffré de la bibliothèque est
   remplacé par un HMAC-SHA256 poivré, par `storeBackupCodes: {encrypt, decrypt}`
   plus un hachage de la saisie dans la route. Recherche §4. → **ADR 028**.
3. **Secret TOTP chiffré, pas haché** — inapplicable par construction. Même
   ADR 028, qui dit comment lire la ligne de `docs/security.md` §2.
4. **Désactivation : mot de passe seulement**, pas « ou un code valide ».
   Recherche §6. **Déviation déclarée** au critère 5 de la story.
5. **`generated/schema/auth.ts` régénéré** (une ligne d'export). Recherche §11.
   **Déviation déclarée** à la consigne de la voie.
6. **Fenêtre TOTP ±1 période de 30 s**, imposée par le paquet installé, testée
   aux deux bords. Recherche §3.
7. **Dépendance `uqr@0.1.3`** (MIT, sans dépendance) pour la matrice du QR,
   rendue en JSX. Recherche §12.

---

## Tâches

- [x] **1. L’empreinte d'un code de secours — la règle pure.**
      `src/domain/backup-code.ts` : `BACKUP_CODE_DIGEST_PREFIX`,
      `isBackupCodeDigest(value)`, et `createBackupCodeDigest(pepper)` rendant
      `(value) => string` qui hache **sauf** ce qui est déjà une empreinte.
      Le `domain` ne connaît pas `node:crypto` (`packages/modules/auth/AGENTS.md`) :
      la fonction de hachage lui est **passée**, l'infrastructure fournit le
      HMAC.
      *Test* (`src/domain/auth-rules.test.ts`) : un code émis n'est jamais une
      empreinte ; hacher une empreinte la rend inchangée ; deux codes différents
      donnent deux empreintes différentes ; l'empreinte ne contient pas le code.
      *Mutation* : supprimer la garde « déjà une empreinte » — le cas du
      ré-encodage doit rougir.

- [x] **2. La classe d'un refus de second facteur — la règle pure.**
      `src/domain/two-factor.ts` : `twoFactorFailureClass(status)` →
      `'invalid' | 'restart'` et `TWO_FACTOR_REFUSAL` (le corps rendu).
      **Corrigé après revue (C5)** : `readTwoFactorFailureClass` avait été
      écrite « pour l'écran » sur le précédent s12, sans qu'aucun écran ne
      l'appelle — le formulaire de vérification est un composant **client**, il
      ne peut pas importer le module. La fonction et son cas ont été retirés, et
      `domain/two-factor.ts` dit pourquoi il ne faut pas les réécrire.
      *Test* (`src/domain/auth-rules.test.ts`) : les statuts que la bibliothèque
      rend (400, 401, 429) tombent dans les deux classes ; une valeur inventée
      lue par l'écran retombe sur `invalid` ; aucun code de bibliothèque ne
      traverse.
      *Mutation* : rendre le statut d'origine — le cas « aucun code ne sort »
      doit rougir.

- [x] **3. `code` entre dans le filtre du journal.**
      `src/domain/security-event.ts` : `SECRET_KEY_PATTERN` gagne `code`, et
      `SecurityEventName` gagne `auth.two_factor_enabled`,
      `auth.two_factor_disabled`, `auth.two_factor_challenged`,
      `auth.two_factor_verified`, `auth.two_factor_failed`,
      `auth.two_factor_backup_codes_regenerated` (`docs/security.md` §7 :
      « changement de second facteur »).
      *Test* (`src/domain/auth-rules.test.ts`) : un détail nommé `code` portant
      un code de secours de onze caractères est filtré — il échappe au motif de
      **valeur**, donc seule la clé peut l'attraper.
      *Mutation* : retirer `code` du motif.

- [x] **4. Le schéma et la migration.**
      `src/schema.ts` : `authTwoFactor` (`auth_two_factor`) avec `id`, `userId`
      (clé étrangère interne, `on delete cascade`), `secret`, `backupCodes`,
      `verified`, `failedVerificationCount`, `lockedUntil`, `createdAt`,
      `updatedAt` ; `authUser` gagne `twoFactorEnabled`. Migration `0001`
      **additive** générée par `pnpm db:generate`, plus la ligne d'export dans
      `generated/schema/auth.ts` (déviation 5).
      *Test* (`tests/auth.test.ts`, cas existants étendus) : les tables créées
      sur schéma vierge égalent celles que le module déclare ; `getAuthTables`
      reçoit le greffon `twoFactor` et chaque champ attendu est déclaré.
      *Mutation* : retirer `failedVerificationCount` de la table.

- [x] **5. Le greffon monté, la frontière tenue.**
      `infrastructure/better-auth-service.ts` : `twoFactor({...})` avec
      `schema.twoFactor.modelName`, `totpOptions: { digits: 6, period: 30 }`,
      `backupCodeOptions: { amount: 10, length: 10, storeBackupCodes: {…} }`,
      la table branchée dans `drizzleAdapter`, et `AUTH_MODELS` étendu.
      L'empreinte est un HMAC-SHA256 (`node:crypto`) poivré par le secret de
      l'application, dans `infrastructure/`. Le port `AuthService` gagne
      `digestBackupCode`.
      *Test* : couvert par la tâche 4 (schéma) et par les tâches 6 à 9
      (parcours). Aucun test de câblage à lui seul.

- [x] **6. Activation : QR, code exigé, dix codes, rotation.**
      Routes `/auth/two-factor/enable` (authentifiée) et
      `/auth/two-factor/verify-totp` (publique — l'enrôlement a une session, la
      connexion n'en a pas). Corps **reconstruits** : `enable` impose
      `method: 'totp'` et ignore `issuer` ; `verify-totp` ne transmet que
      `code`. La réponse est réécrite : `totpURI` et `backupCodes` pour
      l'enrôlement, **aucun jeton de session** dans aucune des deux
      (`packages/modules/auth/AGENTS.md`). Journal :
      `auth.two_factor_enabled`.
      *Test* (`tests/auth.test.ts`) : `enable` sans mot de passe refusé ;
      `enable` rend un `otpauth://` et dix codes ; tant que le code n'est pas
      confirmé la connexion **ne demande rien** ; le code confirmé active et
      **change l'identifiant de session** ; ni `secret` ni `totpURI` ni code
      dans le journal ; aucun jeton dans les corps de réponse.
      *Mutations* : (a) transmettre le corps du client à `enable` ; (b) laisser
      passer le corps de la bibliothèque sur `verify-totp`.

- [x] **7. Connexion : le défi, la fenêtre, le rejeu, le plafond.**
      La route `/auth/sign-in/email` distingue un **troisième** cas :
      `200 + twoFactorRedirect` n'est ni un succès ni un échec — journal
      `auth.two_factor_challenged`, et la réponse est réécrite en
      `{ twoFactor: true }` (le corps de la bibliothèque porte
      `twoFactorMethods`, qui dit quels facteurs le compte possède).
      `verify-totp` journalise `auth.two_factor_verified` /
      `auth.two_factor_failed` et replie tout refus sur les deux classes de la
      tâche 2.
      *Test* (`tests/auth.test.ts`) : compte protégé ⇒ 200 sans cookie de
      session ; code du compteur `-1`, `0`, `+1` acceptés, `-2` et `+2`
      refusés ; le défi consommé ne se rejoue pas ; cinq codes faux tuent le
      défi (`restart`).
      **Corrigé après revue (C3)** : la première version affirmait qu'« un code
      accepté puis rejoué sur un nouveau défi passe », comme un fait admis. Le
      critère 4 de la story dit l'inverse — « erroné **ou rejoué** est refusé ».
      Le module mémorise désormais le dernier compteur consommé par compte
      (`auth_two_factor.last_totp_step`, migration `0002`) et refuse un compteur
      déjà pris, en révoquant la session que la bibliothèque venait d'ouvrir.
      *Mutations* : (a) rendre la réponse de la bibliothèque telle quelle ;
      (b) rendre `valid()` sans consommer le défi n'est pas atteignable — la
      mutation portée est la réécriture du refus.

- [x] **8. Codes de secours : usage unique, hachés, et la course.**
      Route `/auth/two-factor/verify-backup-code` (publique) : la saisie est
      **hachée avant** d'atteindre la bibliothèque. Route
      `/auth/two-factor/generate-backup-codes` (authentifiée, mot de passe),
      journal `auth.two_factor_backup_codes_regenerated`.
      *Test* (`tests/auth.test.ts`) : un code de secours ouvre une session ; le
      même code refusé ensuite ; les **neuf autres** fonctionnent encore (c'est
      le cas qui attrape le double hachage) ; la colonne `backup_codes` ne
      contient **aucun** des dix codes rendus ; **course** — deux défis
      distincts, le même code, en parallèle : exactement une session.
      *Mutations* : (a) `decrypt` renvoie du clair (le stockage redevient
      réversible) ; (b) retirer la garde « déjà une empreinte » de `encrypt` —
      le cas des neuf autres codes doit rougir.
      *Si la course échoue* : la consommation redescend dans le module sur un
      `delete … returning` atomique (recherche §4.3), et le plan gagne une tâche.

- [x] **9. Désactivation : la preuve, et la rotation.**
      Route `/auth/two-factor/disable` (authentifiée), corps reconstruit à
      `{ password }`. Journal `auth.two_factor_disabled`.
      *Test* (`tests/auth.test.ts`) : sans mot de passe, refusée ; avec un
      mauvais mot de passe, refusée ; avec le bon, le second facteur tombe,
      **l'identifiant de session change**, et la ligne `auth_two_factor`
      disparaît — donc les codes de secours avec elle.
      *Mutation* : rendre la route pass-through (le corps du client décide).

- [x] **10. Non-énumération.**
      *Test* (`tests/auth.test.ts`) : mot de passe faux sur un compte protégé,
      mot de passe faux sur un compte non protégé et adresse inconnue rendent
      le **même** statut et le **même** corps. La distinction n'apparaît
      qu'après le premier facteur.
      *Mutation* : retirer `genericSignInRefusal` de la route de connexion —
      **4 cas rouges, tous de s07**, et le cas neuf de s13 reste vert. C'est
      mesuré, et c'était mal annoncé avant la revue (C6) : rien dans le chemin
      de s13 ne distingue les trois comptes **avant** le premier facteur, donc
      ce cas ne peut pas avoir sa propre mutation. Il n'est pas décoratif pour
      autant — il ajoute le compte **protégé** à la comparaison, ce que le cas
      de s07 ne balaie pas —, mais ce qui le tient est la mutation de s07.

- [x] **11. Les deux écrans.**
      `apps/web/app/account/two-factor-card.tsx` (client) et
      `apps/web/app/two-factor/page.tsx` (+ son formulaire client). QR par
      `uqr` rendu en `<svg>`/`<rect>` — pas de `dangerouslySetInnerHTML`, pas
      de style en ligne. `AuthForm` gagne le type de champ `text` et une clé de
      message de refus optionnelle. **Corrigé après revue (C9)** : la tâche
      annonçait que `apps/web/lib/auth.ts` exposerait l'état du second facteur ;
      il n'est pas touché, et l'état arrive par `AccountView.twoFactorEnabled`,
      déjà rendu par le cas d'usage `viewAccount`.
      *Vérification* : lint `form-method`, `pnpm typecheck`, et **contrôle au
      navigateur** des deux écrans en clair et en sombre, à 390 px et en large.
      *Test* : `tests/rendered-text.test.ts` — les deux écrans entrent au
      registre avec leur `refuses` ; la garde qui compare les fichiers de page
      au disque rougit si l'un manque.

- [x] **12. Catalogues et parcours.**
      `apps/web/messages/{fr,en}.json` : `app.account.twoFactor.*` et
      `app.twoFactor.*`. `e2e/two-factor.spec.ts` : activation complète depuis
      `/account`, déconnexion, reconnexion avec code TOTP, puis connexion avec
      un code de secours.
      *Test* : `tests/i18n.test.ts` refuse une clé absente d'une locale.

- [x] **13. Les documents qui changent avec le code.**
      `packages/modules/auth/AGENTS.md` : le second facteur passe de « n'existe
      pas » à « livré (s13) », avec les mesures. `docs/decisions/028-…md`
      (ADR : codes de secours hachés, secret TOTP chiffré).
      `docs/security.md` §2 gagne le renvoi à l'ADR — c'est la seule ligne d'un
      socle que cette story touche, et elle n'affaiblit rien : elle dit
      **où** la règle est inapplicable et pourquoi.

---

## Corrections de revue (`docs/reviews/s13-two-factor.md`)

- [x] **C1 — l'empreinte volée n'est plus le code.** `digestBackupCode`, qui
      reçoit **la saisie**, hache sans condition ; `digestBackupCodes`, qui
      reçoit la charge du magasin, garde seule l'aiguillage « déjà une empreinte
      ⇒ inchangée ». ADR 028 corrigé — son affirmation de sécurité était fausse.
      *Mutation* : refusionner les deux chemins ⇒ **3 rouges**.

- [x] **C2 — le second facteur vaut sur les trois voies.**
      `infrastructure/two-factor-challenge.ts` élargit le `matcher` du crochet
      du greffon à `/magic-link/verify` et `/callback/:id` et reprend son
      handler tel quel ; les deux routes redirigent vers `/two-factor`.
      *Mutation* : rendre au `matcher` sa forme d'origine ⇒ **2 rouges**.

- [x] **C3 — un compteur TOTP ne sert qu'une fois.** Colonne `last_totp_step`,
      prise par comparaison-et-échange, compteur retrouvé par la primitive de la
      bibliothèque (`@better-auth/utils@0.4.2`, promue en dépendance directe).
      Session révoquée sur refus.
      *Mutations* : neutraliser la garde ⇒ **1 rouge** ; ne pas révoquer ⇒
      **1 rouge** ; retirer le pas `-2` de `totpStepsToTry` ⇒ **1 rouge**.

- [x] **Critère 5 amendé** dans `docs/stories.md`, propagé à
      `packages/modules/auth/AGENTS.md`.

- [x] **Mineurs** — C4 (le jeton de `/sign-in/email`, écrit dans l'`AGENTS.md`
      du module avec sa condition d'escalade), C5 (fonction morte retirée), C6
      (mutation réannoncée et mesurée), C7 (quatrième hypothèse de l'enveloppe
      atomique écrite), C8 (les trois chemins non déclarés ont leur cas —
      1 rouge sous mutation), C9 (commentaire d'`enable` corrigé ;
      `auth.two_factor_enabled` n'est plus journalisé sur un code de secours
      consommé en session — 1 rouge sous mutation).

- [x] **Les deux écrans au navigateur**, ce que la revue n'avait pas pu faire :
      `/two-factor` (les deux formulaires, et le refus) et l'affichage des dix
      codes de secours, en **clair et en sombre**, à 1280 px et 390 px.

---

## Second tour de correction (revue s13, §10)

- [x] **C11 — la garde est renversée.**
      `infrastructure/two-factor-challenge.ts` n'ajoute plus de chemins au
      `matcher` : il le **remplace**. Le crochet vaut partout, et
      `TWO_FACTOR_CHALLENGE_EXEMPT_PATHS` énumère les cinq exemptions, chacune
      avec sa raison — les trois vérifications du second facteur, plus
      `/get-session` et `/change-password`, qui font tourner la session d'un
      appelant déjà authentifié. La commande qui échoue :
      `packages/modules/auth/src/infrastructure/two-factor-challenge.test.ts`
      fait passer une **route de connexion fictive** (`/canari/sign-in`) par la
      garde, et `tests/auth.test.ts` mesure les deux rotations.
      *Mutations* : la liste d'inclusions d'origine ⇒ **2 rouges** (la route
      fictive et `/passkey/verify-authentication`, dans le même cas) ; retirer
      les deux exemptions de rotation ⇒ **2 rouges**.

- [x] **C4 — la condition d'escalade a sa commande.** `tests/auth.test.ts`
      présente le `token` que `/sign-in/email` laisse dans son corps en
      `Authorization: Bearer`, sur une route protégée et au résolveur de
      session.
      *Mutation* : monter `bearer()` dans les greffons ⇒ **1 rouge**.

- [x] **Le refus ne ment plus** (C12/C13/C14). La garde de rejeu rend `used` et
      non `invalid` : un code juste refusé parce que son compteur a déjà servi
      n'est pas un code faux. Troisième classe dans `domain/two-factor.ts`,
      message dédié sur `/two-factor` dans les deux locales. Le statut ne change
      pas, et `used` n'est atteignable qu'avec un défi ouvert ou une session.
      *Mutation* : rendre `invalid` sur ce chemin ⇒ **1 rouge**.

- [x] **La recherche §2.3 corrigée** : `beginAttempt(5)` et `accountLockout` ne
      couvrent que la branche connexion. Propagé à
      `packages/modules/auth/AGENTS.md`, pour que s28 n'hérite pas d'une
      prémisse fausse.
