# Recherche — s13-two-factor

> Tout ce qui suit sur Better Auth est lu dans le **paquet installé**
> (`better-auth@1.7.2`, `@better-auth/utils@0.4.2`,
> `@better-auth/drizzle-adapter@1.7.2`), fichier et ligne à l'appui. Rien n'y
> vient de la documentation en ligne ni de mémoire.

## 1. Ce que la story demande, et où ça atterrit

Six critères (`docs/stories.md`) : QR code + code exigé à l'activation ; code
exigé à la connexion ; dix codes de secours à usage unique affichés une fois ;
code erroné ou rejoué refusé ; désactivation prouvée ; « module non activé ».

**Le sixième critère est réinterprété**, exactement comme s12 l'a fait et comme
sa revue l'a validé (`docs/reviews/s12-oauth-signin.md`, « le sixième — module
non activé — est réinterprété par la recherche et le plan (`auth` est socle,
ADR 021), et la réinterprétation est écrite avant la première ligne de code »).
Le second facteur appartient au module `auth`, qui est le **socle non
désactivable** : il n'a pas d'état « non activé ». La forme que prend ce critère
ici est écrite au §9.

`packages/modules/auth/AGENTS.md` dit aujourd'hui que le module ne contient
« ni second facteur ni passkey : ce sont s13 et s14 ». C'est une phrase de
« pas encore », de la même famille que « OAuth est livré (s12) » qui l'a
remplacée pour OAuth. s13 la remplace pour le second facteur ; s14 gardera la
sienne.

## 2. Le greffon `two-factor` du paquet installé

`node_modules/better-auth/dist/plugins/two-factor/` — six fichiers lus en
entier : `index.mjs`, `totp/index.mjs`, `backup-codes/index.mjs`,
`verify-two-factor.mjs`, `schema.mjs`, `error-code.mjs`.

### 2.1 Les points d'entrée qu'il expose

| Chemin | Ce qu'il fait | Ce qu'il exige |
|---|---|---|
| `POST /two-factor/enable` | crée le secret, rend `totpURI` + codes de secours | session + mot de passe |
| `POST /two-factor/disable` | efface la ligne, remet `twoFactorEnabled` à faux | session + mot de passe |
| `POST /two-factor/verify-totp` | vérifie un code TOTP | session **ou** cookie de défi |
| `POST /two-factor/verify-backup-code` | consomme un code de secours | idem |
| `POST /two-factor/generate-backup-codes` | régénère les dix codes | session + mot de passe |
| `POST /two-factor/get-totp-uri` | rend l'URI TOTP d'un compte déjà activé | session + mot de passe |
| `generateTOTP`, `viewBackupCodes` | `createAuthEndpoint.serverOnly` — **aucune route HTTP** | — |

Le module **énumère ses routes** (ADR 007/017) : ce qui n'est pas déclaré
répond 404 sans atteindre la bibliothèque. `get-totp-uri` ne sera **pas**
déclaré — il rend le secret d'un compte déjà activé, alors que le secret n'a de
raison de sortir qu'une fois, à l'enrôlement.

### 2.2 Le crochet de connexion

`index.mjs`, `hooks.after`, `matcher : path === '/sign-in/email' | '/sign-in/username' | '/sign-in/phone-number'`.
Il ne se déclenche **que** si `data.user.twoFactorEnabled`. Ce qu'il fait alors :

1. supprime la session que la connexion vient de créer, et le cookie ;
2. `ctx.context.setNewSession(null)` ;
3. écrit deux lignes de vérification : `2fa-<20 caractères>` (valeur =
   identifiant du compte) et `2fa-attempts-<identifiant>` (valeur = `"0"`),
   toutes deux expirant à `twoFactorCookieMaxAge`, **600 s par défaut** ;
4. pose le cookie signé `two_factor` ;
5. répond **200** `{ twoFactorRedirect: true, twoFactorMethods: [...] }`.

Conséquences pour ce dépôt, toutes vérifiables :

- **la route `/auth/sign-in/email` du module journalise aujourd'hui
  `auth.sign_in_succeeded` dès que `response.ok`**, avec `actorOf(response)` qui
  lit `payload.user.id`. Ce corps-là n'a pas de `user` : le journal dirait
  « connexion réussie, acteur `anonymous` » alors qu'aucune session n'existe.
  Il faut un troisième cas ;
- **`AuthForm` redirige dès que `response.ok`** : sans changement, l'écran
  partirait vers le tableau de bord sans session, qui renverrait vers
  `/sign-in`. Une boucle silencieuse ;
- `genericSignInRefusal(200)` rend `null` : le corps sort tel quel, ce qui est
  ce qu'il faut.

### 2.3 Ce que le greffon protège déjà contre la devinette

Deux verrous, **actifs par défaut**, tous deux dans `verify-two-factor.mjs` :

- **par défi** — `beginAttempt(5)` (appelé par `verifyTOTP` et
  `verifyBackupCode` quand il n'y a pas de session) consomme
  `2fa-attempts-<id>` de façon transactionnelle, et au 5ᵉ échec **consomme le
  défi lui-même** puis répond `TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE`. Le cookie
  est expiré : il faut refaire la connexion ;
- **par compte** — `assertTwoFactorNotLocked` / `recordTwoFactorFailure` :
  `accountLockout.enabled ?? true`, `maxFailedAttempts ?? 10`,
  `durationSeconds ?? 900`. Le compteur est incrémenté atomiquement
  (`incrementOne`), il traverse les défis et les facteurs, et une vérification
  réussie le remet à zéro.

C'est ce qui répond au « six chiffres se devinent » **sur la branche
connexion, et sur elle seule** — correction apportée après la seconde revue
(§10.9), parce que la phrase d'origine ne disait pas « une des deux branches »
et qu'une affirmation trop large est lue comme mesurée par l'agent suivant.
Relu dans `verify-two-factor.mjs` : les deux verrous ne s'arment que sous
`isSignIn`. Sur le chemin **avec session** — celui de la confirmation
d'enrôlement, `/two-factor/verify-totp` muni d'un cookie de session —
`beginAttempt` rend une paire de fonctions **vides**, et ni
`assertTwoFactorNotLocked` ni `recordTwoFactorFailure` ne sont appelés : **ce
chemin n'a aucun compteur**. Le gain d'un attaquant y est nul aujourd'hui
puisqu'il faut déjà une session valide, mais s28 ne doit pas hériter de la
prémisse inverse.

`docs/stories.md` interdit explicitement le compteur local pour cette story :
« aucun compteur local n'est écrit ici, et aucun critère de limitation non plus
[…] la limitation de l'endpoint de vérification 2FA est livrée et testée en
s28 ». La limitation **partagée entre instances** de `docs/security.md` §7 reste
donc s28 — **les deux branches**, pas seulement celle qui est déjà comptée — ;
ce qui est livré ici est le verrou de la bibliothèque, et il est éprouvé
(§10, cas 6).

Le greffon déclare aussi `rateLimit: [{ pathMatcher: /^\/two-factor\//, window: 10, max: 3 }]`,
qui n'est lu que si le limiteur de la bibliothèque est armé. Il ne l'est pas
dans ce dépôt, et l'armer serait la seconde logique de limitation que s28
interdit.

## 3. La fenêtre TOTP — mesurée, pas supposée

`@better-auth/utils@0.4.2`, `dist/otp.mjs` :

```js
async function verifyTOTP(otp, { window = 1, digits = 6, secret, period = 30 }) {
  const counter = Math.floor(Date.now() / (period * 1000))
  for (let i = -window; i <= window; i++) { … }
}
```

`totp/index.mjs` appelle `createOTP(secret, { period, digits }).verify(ctx.body.code)`
**sans second argument** : la fenêtre est donc `1`, et le greffon n'expose
aucune option pour la changer (`TOTPOptions` ne porte que `digits`, `period`,
`disable`, `issuer`, `allowPasswordless`).

**Décision : période 30 s, fenêtre ±1, soit 90 s d'acceptation.** C'est la
valeur de la RFC 6238 §5.2 pour absorber la dérive d'horloge du téléphone, et
c'est la seule atteignable sans réécrire la vérification. Les deux bords se
testent sans toucher à l'horloge : le compteur d'un code se choisit en
calculant le HOTP soi-même (`hotp(counter + k)`), ce qui donne un code
déterministe à l'offset voulu. Cas attendus : `k ∈ {-1, 0, +1}` acceptés,
`k ∈ {-2, +2}` refusés.

`digits: 6` et `period: 30` seront **écrits** dans la configuration plutôt
qu'hérités : un défaut qu'aucun test ne tient change à la montée de version, et
le `period` entre dans l'URI de l'authentificateur.

## 4. Les codes de secours — le piège nommé par la story

`docs/security.md` §2 : « secrets de second facteur et codes de secours stockés
**hachés** ». La story répète le piège.

### 4.1 Ce que la bibliothèque fait, et pourquoi ça ne suffit pas

`backup-codes/index.mjs` : `storeBackupCodes` vaut `"encrypted"` par défaut,
c'est-à-dire `symmetricEncrypt({ data: JSON.stringify(codes), key: secret })`.
**Chiffré, donc réversible** : qui lit la base et connaît `BETTER_AUTH_SECRET`
retrouve dix mots de passe à usage unique en clair. Ce n'est pas « en clair »,
ce n'est pas non plus « haché ».

Le hachage n'est pas branchable tel quel : `verifyBackupCode` compare
`codes.includes(data.code)` où `codes` sort de `decrypt` et `data.code` est la
saisie brute. Une fonction à sens unique ne peut pas rendre `codes`.

### 4.2 Le montage retenu

Deux moitiés, et il faut les deux :

1. `storeBackupCodes: { encrypt, decrypt }` — `decrypt` est l'**identité**,
   `encrypt` remplace chaque entrée en clair par son empreinte. Ce que la base
   contient est donc un tableau JSON d'empreintes ;
2. la route du module **hache la saisie avant de la transmettre** à la
   bibliothèque, exactement comme `/sign-in/email` reconstruit déjà son corps
   (`withBody`). La comparaison porte alors empreinte contre empreinte.

Le piège de ce montage est le **ré-encodage** : après consommation, la
bibliothèque rappelle `encodeBackupCodes(validate.updated)` avec le reste du
tableau, qui contient déjà des empreintes. Hacher deux fois rendrait tous les
codes restants inutilisables — panne silencieuse, visible seulement au deuxième
usage. `encrypt` doit donc reconnaître ce qu'il a déjà produit. Le
discriminant est total et vérifiable : un code émis a la forme
`XXXXX-XXXXX` (11 caractères, `generateBackupCodesFn` : `a-z`, `0-9`, `A-Z`,
longueur 10, un tiret inséré au milieu), une empreinte a la forme
`sha256:<64 hexadécimaux>` — aucun code émis ne peut porter ce préfixe.

L'empreinte est un **HMAC-SHA256 avec le secret de l'application** en poivre,
pas un SHA-256 nu : un code fait ~59 bits d'entropie
(`10 caractères × log2(62)`), assez pour se passer d'un KDF lent, pas assez
pour qu'une table d'empreintes non poivrée soit sans intérêt. Même arbitrage
que `infrastructure/token-factory.ts`, écrit pour un cas moins favorable.

### 4.3 L'usage unique et la course

`backup-codes/index.mjs` consomme par **comparaison-et-échange** :

```js
adapter.incrementOne({
  model: 'twoFactor',
  where: [{ field: 'id', value: … }, { field: 'backupCodes', value: twoFactor.backupCodes }],
  increment: {}, set: { backupCodes: updatedBackupCodes },
})
```

`@better-auth/drizzle-adapter@1.7.2`, `dist/index.mjs:494`, branche `pg` :
`UPDATE … SET … WHERE id IN (SELECT id FROM … WHERE <clause> LIMIT 1) RETURNING *`.
Aucune ligne mise à jour ⇒ `undefined` ⇒ `APIError.fromStatus('CONFLICT')`.

**À mesurer, pas à déduire** : deux `UPDATE` concurrents dont la condition porte
sur la valeur qu'ils écrivent dépendent de la ré-évaluation du prédicat après
prise de verrou (EvalPlanQual). Le cas de course est donc **exécuté** — deux
défis distincts (deux « navigateurs »), le même code de secours, en parallèle —
et l'attente est : exactement une session ouverte. Si la mesure dit le
contraire, la consommation redescend dans le module, sur une suppression
atomique `delete … where user_id = ? and code_hash = ? returning`.

Deux requêtes qui partagent le **même** défi ne prouveraient rien de la
comparaison-et-échange : `beginAttempt` consomme `2fa-attempts-<id>` de façon
transactionnelle avant elle, et désignerait déjà un seul gagnant. La course doit
porter sur deux défis distincts.

## 5. Le secret TOTP

`enableTwoFactor` tire 32 caractères (`generateRandomString(32)`), les chiffre
(`symmetricEncrypt`) et les range dans `auth_two_factor.secret`.
**Chiffré, jamais haché — et c'est structurel** : vérifier un TOTP exige de
regénérer le code, donc de relire le secret. La ligne de `docs/security.md` §2
qui range « secrets de second facteur » avec « codes de secours » sous
« hachés » est inapplicable à sa première moitié ; elle l'est à la seconde, et
c'est ce que le §4 ci-dessus livre. L'écart est porté par un ADR plutôt que par
un commentaire, parce qu'il change la manière de lire une ligne du socle.

Le secret sort **une seule fois**, dans `totpURI` de la réponse à
`POST /two-factor/enable`, à une requête authentifiée de son propriétaire.
Trois conséquences à tenir :

- le QR est produit **côté serveur ou côté client, jamais par un tiers** : une
  API d'image externe mettrait le secret dans une URL sortante ;
- `get-totp-uri` n'est pas déclarée ;
- le journal de sécurité ne porte ni `totpURI`, ni `secret`, ni `code`.
  `describeSecurityEvent` filtre déjà sur `/token|password|secret|cookie|hash|authorization|credential/i`
  et sur toute valeur de 16 caractères opaques ; un code de secours fait
  11 caractères et la clé `code` n'est pas dans la liste. **La liste doit
  gagner `code`** — sans quoi le filet ne couvre pas ce que cette story
  introduit. Aucun détail journalisé aujourd'hui ne porte ce nom (vérifié :
  `status`, `provider`, `method`, `class`, `stage`, `field`).

## 6. La désactivation — ce que la bibliothèque impose

`utils/password.mjs` :

```js
async function shouldRequirePassword(ctx, userId, allowPasswordless) {
  if (!allowPasswordless) return true
  …
}
```

`allowPasswordless` n'étant pas posé, `enable`, `disable` et
`generate-backup-codes` **exigent toujours le mot de passe courant**, vérifié
par `validatePassword` contre le compte `credential`.

Le critère de la story dit « un code valide **ou** le mot de passe courant ».
La moitié « code valide » n'est pas atteignable par cette route :
`disableTwoFactor` appelle `validatePassword` avant tout, et il n'existe aucun
crochet pour lui substituer une autre preuve. La reproduire dans le module
voudrait dire réécrire la **rotation de session** hors de la bibliothèque
(`internalAdapter.createSession` + `setSessionCookie` + `deleteSession`, qui
signent le cookie), c'est-à-dire réécrire précisément ce que la frontière du
module confie à la bibliothèque.

**Arbitrage : la preuve exigée est le mot de passe courant.** C'est la moitié
forte de la disjonction — un vol de session ne suffit pas à retirer le second
facteur, ce qui est l'invariant que la story protège. La moitié manquante est
déclarée comme déviation, ici et dans le plan.

Effet de bord mesuré et assumé : un compte **sans mot de passe** (créé par
OAuth seul, s12) ne peut ni activer ni désactiver le second facteur —
`findCredentialAccount` ne rend rien, `validatePassword` rend `false`, la
réponse est `400 INVALID_PASSWORD`. C'est cohérent : ce compte n'a pas de
premier facteur à renforcer.

## 7. La rotation de session

Obtenue **gratuitement** par la bibliothèque, aux deux extrémités, et c'est le
principal argument pour ne pas réécrire la désactivation :

- **activation** — `totp/index.mjs`, à la confirmation du premier code :
  `createSession(user.id, false, activeSession)` puis
  `deleteSession(activeSession.token)`, cookie reposé. C'est bien à ce
  moment-là que le privilège s'élève : `enable` seul ne rend pas encore le
  compte protégé (`verified: false`) ;
- **désactivation** — `index.mjs`, `disableTwoFactor` : même paire ;
- **connexion avec second facteur** — `verify-two-factor.mjs`, `valid()` :
  `consumeVerificationValue` puis `createSession`. La session posée par le mot
  de passe a été détruite par le crochet, donc l'identifiant change deux fois.

`docs/security.md` §2 (« rotation de l'identifiant de session à l'élévation de
privilège : connexion, validation du second facteur ») est donc tenu par la
bibliothèque — ce qui reste à faire est de le **mesurer**, pas de l'écrire.

## 8. Le schéma

`getAuthTables` exécuté sur le paquet installé avec le greffon
(`schema: { twoFactor: { modelName: 'auth_two_factor' } }`) rend :

```
user          -> auth_user        [ …, twoFactorEnabled ]
twoFactor     -> auth_two_factor  [ secret, backupCodes, userId, verified,
                                    failedVerificationCount, lockedUntil ]
```

Donc : **une colonne ajoutée** à `auth_user` (`two_factor_enabled`, booléen,
défaut faux) et **une table ajoutée** au module `auth`. Les deux dans la même
migration, `0001`. Rétro-compatible au sens de `docs/reliability.md` : la
colonne a un défaut, la table est nouvelle, la version en ligne ne lit ni l'une
ni l'autre.

Attention à trois détails du paquet :

- l'adapter Drizzle résout une colonne par le **nom de propriété** de l'objet
  Drizzle, pas par le nom SQL — les clés restent `backupCodes`,
  `failedVerificationCount`, `lockedUntil`, les colonnes sont en `snake_case` ;
- `opts.twoFactorTable` vaut la chaîne littérale `"twoFactor"` dans
  `index.mjs`, `totp/index.mjs` et `backup-codes/index.mjs` : c'est le **nom de
  modèle** qui est passé à l'adapter, jamais le nom de table. Le renommage
  passe donc par `schema.twoFactor.modelName`, pas par l'option
  `twoFactorTable` (qui, elle, ne renomme que la déclaration de schéma et
  laisserait les trois lectures sur `"twoFactor"`) ;
- la clé étrangère `userId → auth_user.id` reste **interne au module**
  (ADR 018).

`generated/schema/auth.ts` réexporte à plat les tables du module ; il est
**régénéré** par `pnpm db:generate` — voir §11.

## 9. Ce que devient le critère « module non activé »

Le module `auth` est socle (ADR 021). La forme mesurable du critère, ici :

1. **aucune option de second facteur** dans les paramètres quand le compte n'en
   a pas d'actif — la carte propose l'activation, elle n'affiche ni codes de
   secours ni bouton de désactivation ;
2. **la connexion se termine après le mot de passe** pour un compte sans second
   facteur : le crochet du greffon ne se déclenche pas, la réponse porte une
   session, et c'est mesurable en comparant les deux comptes ;
3. **`get-totp-uri`, `send-two-factor-otp` et `verify-otp` n'existent pas** :
   non déclarées, elles répondent 404 comme n'importe quel chemin inventé, sans
   atteindre la bibliothèque. C'est la moitié « aucune route » du critère
   d'origine.

La moitié « les tables sont absentes d'une base vierge » n'a pas d'équivalent :
le socle est toujours migré. Le test qui compare les tables créées aux tables
déclarées reste la garde — il rougira si la table apparaît sans être déclarée,
ou l'inverse.

## 10. Ce que la story doit prouver, et où

Rangé selon `tdd-skill` — la règle s'éprouve là où elle vit.

| # | Invariant | Où |
|---|---|---|
| 1 | empreinte d'un code de secours : jamais réversible, déjà-haché non re-haché, code émis jamais confondu avec une empreinte | `src/domain/auth-rules.test.ts` (fonction pure) |
| 2 | la table et la colonne sont créées, et portent les champs que la bibliothèque attend | `tests/auth.test.ts` (cas de schéma existants, étendus) |
| 3 | activation : `enable` puis code valide ⇒ actif, session **rotée**, dix codes rendus une fois | `tests/auth.test.ts` |
| 4 | connexion : compte protégé ⇒ 200 sans session + défi ; code valide ⇒ session | `tests/auth.test.ts` |
| 5 | fenêtre : `-1`, `0`, `+1` acceptés ; `-2`, `+2` refusés | `tests/auth.test.ts` |
| 6 | code rejoué refusé ; 5 échecs tuent le défi | `tests/auth.test.ts` |
| 7 | code de secours : usage unique, **course sur deux défis distincts** | `tests/auth.test.ts` |
| 8 | codes de secours en base : aucune empreinte ne contient un code émis | `tests/auth.test.ts` |
| 9 | désactivation : sans mot de passe refusée, avec mot de passe acceptée + rotation | `tests/auth.test.ts` |
| 10 | non-énumération : mauvais mot de passe indistinguable, avec et sans second facteur | `tests/auth.test.ts` |
| 11 | secret et codes absents du journal | `src/domain/auth-rules.test.ts` |
| 12 | les écrans ne portent aucune chaîne en dur | `tests/rendered-text.test.ts` |
| 13 | le parcours complet dans un navigateur | `e2e/two-factor.spec.ts` |

Budget de fichiers : `tdd-skill` en autorise deux nouveaux par story. Ils sont
pris par `e2e/two-factor.spec.ts` et **rien d'autre** — tout le reste s'ajoute
aux fichiers existants.

## 11. Les fichiers « à ne pas toucher », et le seul qui résiste

La consigne de la voie interdit `config/features.ts`, `generated/`,
`playwright.config.ts`, `apps/web/middleware`, `config/security.ts`, les modules
`marketing` et `organizations`, `docs/STATE.md`.

Tous tenus, **sauf `generated/schema/auth.ts`** : ce fichier est produit par
`pnpm db:generate` depuis `config/features.ts` et réexporte à plat les tables du
module `auth`. Une table ajoutée au module y ajoute une ligne, faute de quoi
`drizzle-kit` ne la voit pas et la migration ne peut pas être générée. La
régénération est **mécanique** (la liste des modules ne change pas), et le
fichier porte lui-même « ne pas éditer à la main : la CI régénère et compare ».
Déviation déclarée, une ligne d'export.

## 12. Dépendance ajoutée : `uqr`

Le critère 1 exige un QR code. Aucun composant du design system n'en rend, et
aucune dépendance du dépôt n'en produit (vérifié : rien dans `node_modules/.pnpm`
ne correspond à `qr`).

`uqr@0.1.3`, MIT, **aucune dépendance** (vérifié par `pnpm view`). Son
`encode(text)` rend une matrice booléenne — pas une image, pas une chaîne SVG.
C'est ce qui compte ici : le QR est rendu en **JSX**, un `<rect>` par module
sombre, donc sans `dangerouslySetInnerHTML` (`docs/security.md` §4) et sans
style en ligne (`docs/security.md` §1, politique livrée par s45). Le secret ne
sort ni par une URL, ni par un service tiers.

Elle est justifiée par la story, comme le socle l'exige (§6 du socle :
« aucune dépendance ajoutée sans qu'une story la justifie »).

## 13. Écarts au socle, à porter dans le plan

1. **`docs/security.md` §2, « secrets de second facteur […] stockés hachés »** :
   inapplicable au secret TOTP, qui est réversible par construction. Chiffré au
   repos, sorti une seule fois. → ADR.
2. **Critère 5 de la story**, « code valide **ou** mot de passe » : seule la
   moitié « mot de passe » est livrée. → déclaré, motivé au §6.
3. **`generated/schema/auth.ts`** régénéré. → déclaré au §11.
4. **`docs/security.md` §7, limitation de débit** : portée par les verrous de la
   bibliothèque (§2.3), pas par un compteur local — `docs/stories.md` réserve la
   limitation partagée à s28.

## 14. Ce qui n'a pas été regardé

Pour que le prochain ne lise pas ce document comme un inventaire :

- le greffon `otp` (code par email/SMS) n'est pas monté et ses trois points
  d'entrée ne sont pas déclarés — non lus au-delà de leur existence ;
- l'option `trustDevice` (« se souvenir de cet appareil 30 jours ») n'est pas
  livrée : le corps du client ne la portera pas, et la route reconstruit son
  corps. Son mécanisme (cookie HMAC + ligne de vérification) a été lu, pas
  éprouvé ;
- `skipVerificationOnEnable` reste faux — c'est ce qui rend le critère 1
  (« exige un code valide pour être confirmée ») vrai côté serveur ;
- le comportement du greffon sur `/sign-in/username` et `/sign-in/phone-number`
  n'est pas pertinent : ces routes n'existent pas dans ce module ;
- la connexion par **magic link** et par **fournisseur externe** n'est pas
  couverte par le crochet du greffon (son `matcher` ne cite que
  `/sign-in/email`). Le second facteur ne s'applique donc **pas** à ces deux
  chemins dans le paquet installé. C'est une limite réelle, écrite ici pour
  qu'elle soit vue : la refermer demanderait un crochet à nous sur les rappels
  et sur `/magic-link/verify`, ce que la story ne demande pas et ce que s14
  (passkeys) rouvrira de toute façon.
