# packages/modules/auth — règles locales

Le module d'authentification : inscription, vérification d'email, connexion par
mot de passe, magic link, réinitialisation, sessions.

**Socle non désactivable.** Sans compte, il n'y a pas de SaaS : les invitations,
le guest checkout, la suppression de compte et l'export en dépendent. Il n'a
donc **pas** de critère « module non activé » — `config/features.ts` le nomme
dans `requiredModules`, et la validation de la configuration **refuse** un
`enabledModules` qui ne le contient pas, au démarrage comme dans `ks toggle`
(ADR 021). Ce n'est pas la validation des `requires` qui l'empêche : aucun
module ne requiert `auth`, et c'est précisément pourquoi la règle a dû devenir
exécutable. Cette différence est la seule ; pour tout le reste, c'est un module
comme un autre, avec le contrat complet, ses quatre couches et ses migrations à
lui.

## La frontière avec Better Auth

C'est le seul sujet de ce package. Une bibliothèque d'authentification veut
posséder quatre choses ; chacune a déjà un propriétaire ici :

| Ce qu'elle veut posséder | Qui le possède | Ce qui échoue si on le lui rend |
|---|---|---|
| le schéma | `src/schema.ts`, généré par le baril de s04 | `tests/auth.test.ts` compare les tables créées sur base vierge à celles que le module déclare, et les champs attendus par `getAuthTables()` aux propriétés Drizzle |
| les emails | le port `Mailer` (s06), par `src/application/auth-use-cases.ts` | le même fichier vérifie qu'aucun appel réseau ne sort pendant les parcours : un envoi hors du port s'y verrait |
| les routes | le registre, par `src/presentation/auth-routes.ts` | une route non déclarée répond 404 sans atteindre la bibliothèque |
| la session | `resolveSession` du répartiteur | les attributs du cookie, la rotation et la révocation sont mesurés, pas relus |

Deux conséquences qu'il ne faut pas défaire :

- **la vérification d'email est à nous.** Le jeton de la bibliothèque est un JWT
  signé, ni stocké ni consommable : un lien déjà utilisé y répond « c'est bon »
  au lieu de « ce lien a déjà servi », et rien ne l'invalide avant son
  expiration. `emailVerification.sendVerificationEmail` reste donc **absent** de
  la configuration, et le parcours passe par le magasin de jetons à usage unique
  du module ;
- **l'envoi de l'email de réinitialisation est différé.**
  `advanced.backgroundTasks.handler` est branché sur `runInBackground` ; sans
  lui, `runInBackgroundOrAwait` **attend** la promesse, donc seul un compte
  existant paie l'appel au fournisseur et l'existence du compte se lit au
  chronomètre — mesuré à 119 ms d'écart sur un mailer à 120 ms. Le point de
  composition de l'application y branche le `after` de Next, pour que le travail
  survive à la réponse ;
- **`change-password` ne transmet pas le corps du client.** `revokeOtherSessions`
  y est imposé : laisser le client le fournir reviendrait à lui laisser décider
  si ses autres sessions survivent à un changement de mot de passe.

## Le compte agit sur lui-même, jamais sur un autre (s08)

`change-name` et `revoke-session` prennent le compte dans **la session**, jamais
dans le corps de la requête. La révocation individuelle porte le propriétaire
dans sa condition SQL (`id = ? and user_id = ?`), en un seul ordre : il n'existe
pas d'instant où la session d'autrui est trouvée puis supprimée. Une session qui
n'est pas celle de l'appelant répond **404, jamais 403** — un 403 confirmerait
que cet identifiant existe (`docs/security.md` §3).

Les deux cas de `tests/auth.test.ts` envoient un `userId` dans le corps :
c'est ce champ qui fait rougir la suite si une route se met à lire le compte
ailleurs que dans la session. Sans lui, la mutation passait au vert — mesuré.

La liste des sessions ne rend **aucun jeton** : les colonnes sont énumérées
dans le repository, et `describeSessions` recopie champ par champ plutôt que
d'étaler la ligne. Un jeton rendu à un écran, c'est `HttpOnly` annulé.

## La connexion par fournisseur externe (s12)

Trois choses à ne pas défaire, et une quatrième qui n'existe que dans un
navigateur.

**La double preuve d'adresse (ADR 023).** Une identité de fournisseur ne
rejoint un compte local que si le fournisseur atteste l'adresse **et** que le
compte local est déjà vérifié. La première moitié est un crochet unique
(`user.validateUserInfo`) branché sur `domain/oauth.ts`, qui refuse sur les
**trois** actions de la bibliothèque — création, liaison, retour d'un compte
déjà lié ; le refus à la création est celui qui empêche une adresse de tiers
d'être squattée par une ligne que personne ne contrôle. La seconde est
`accountLinking.requireLocalEmailVerified`. Mesuré : neutraliser le crochet fait
rougir 1 cas, passer `requireLocalEmailVerified` à `false` en fait rougir 1
autre.

`trustedProviders: []` et `allowDifferentEmails: false` ne font rougir **aucun**
cas à eux seuls, et **pas pour la même raison** — la version précédente de ce
paragraphe attribuait les deux au crochet « qui refuse plus tôt » ; mesuré dans
le paquet installé (1.7.2), c'est faux dans les deux cas :

- **`trustedProviders: []` s'évalue *avant* le crochet.** Dans
  `oauth2/link-account.mjs`, la porte est ligne ~83, `assertValidUserInfo` ligne
  ~92 : le crochet refuse **plus tard**. Ce sont donc deux filets réellement
  indépendants, chacun suffisant — retirer l'un laisse l'autre tenir, retirer
  **les deux ensemble** fait rougir 2 cas. C'est mieux que ce que la note
  disait, pas moins bien ;
- **`allowDifferentEmails: false` n'est lu par aucun chemin déclaré ici.** Ses
  deux seules lectures — `api/routes/callback.mjs:177` (branche `link` de
  l'état) et `api/routes/account.mjs:213` (`/link-social`) — appartiennent à la
  liaison explicite, que ce module ne déclare pas. La mutation est verte parce
  que le chemin est **injoignable**, pas parce qu'un crochet l'a devancée : le
  crochet ne voit jamais ce cas. Qui déclarera `/link-social` devra donc le
  couvrir par un test, pas le supposer tenu.

**Le cookie d'état est `SameSite=Lax`, et c'est la seule exception.**
`advanced.defaultCookieAttributes` s'applique à *tous* les cookies de la
bibliothèque, cookie `state` compris — or celui-là est relu au **retour du
fournisseur**, une navigation inter-sites. En `Strict`, il ne repart pas et
**toute** connexion externe échoue en `state_security_mismatch`. La session, elle,
reste `Strict` (`docs/security.md` §1 : `Lax` au minimum, `Strict` pour la
session).

**Aucun code de la bibliothèque n'atteint le navigateur.**
`account_not_linked` dirait qu'un compte existe à cette adresse,
`email_not_found` dirait le contraire : les deux répondent à une question que
personne n'a le droit de poser depuis une page publique (§7). Tous les retours
en échec passent par `/auth/oauth-error`, qui ne laisse sortir que deux classes.
L'écran, lui, **relit** la classe (`readOAuthFailureClass`) au lieu de
reclasser — il ne reçoit jamais de code.

**Le retour du fournisseur passe par un rebond.** Le cookie de session `Strict`
ne repart pas non plus sur la fin d'une chaîne de navigation venue d'un autre
site : le rappel redirige donc vers `/oauth/return`, page publique qui rebondit
d'elle-même (`meta refresh`, sans JavaScript) vers la destination. La seconde
navigation est initiée par notre document, donc same-site, donc porteuse du
cookie. Ce défaut **passe tous les tests de nœud** : il n'est visible que dans
`e2e/oauth.spec.ts`, où retirer le rebond fait rougir exactement un parcours.

**Le déliement est verrouillé.** La bibliothèque compte puis supprime sans
verrou (`dist/api/routes/account.mjs`) : deux déliements simultanés laissent un
compte sans aucun moyen de connexion. Le module fait les deux dans **une
transaction**, sur les lignes du compte verrouillées (`for update`) ; le
propriétaire est dans la condition, jamais vérifié avant, et un moyen qui n'est
pas le sien répond **404, jamais 403**.

**Tout appel sortant passe par la porte bornée.** s12 ouvre les premiers appels
réseau du module — trois par connexion GitHub —, et `@better-fetch/fetch@1.3.1`
n'arme **aucun** délai par défaut (`getTimeout` n'abandonne que si
`options.timeout` est fourni). Deux bornes, et il faut les deux :

- **par appel**, dans `infrastructure/oauth-outbound.ts` : délai explicite, et
  reprises en recul exponentiel avec dispersion et plafond, sur les **seules**
  erreurs transitoires — un refus du fournisseur (4xx) est définitif, le
  rejouer, c'est le faire refuser trois fois. Cette borne couvre les deux appels
  de profil de GitHub, repris par `options.getUserInfo` ;
- **par requête entrante**, dans `better-auth-service.ts` : une échéance autour
  de `auth.handler` sur les rappels. Elle couvre ce qui n'a pas de crochet —
  l'échange de code de GitHub (`validateAuthorizationCode` ne lit aucune option)
  et la vérification d'ID token de Google (JWKS, par `jose`). Dépassée, elle rend
  le refus générique du module, jamais une exception.

`pnpm lint` refuse un `fetch` écrit ailleurs que dans cette porte — c'est ce qui
empêche le prochain appel sortant d'être écrit sans délai, et
`tests/lint-rules.test.ts` le prouve en soumettant les écritures à la
configuration réelle. Reprendre `getUserInfo` a un prix, écrit dans
`infrastructure/github-user-info.ts` : la dérivation d'`emailVerified` y est
**recopiée** de la bibliothèque (1.7.2), donc une montée de version doit rouvrir
ce fichier.

**Toute connexion est journalisée, quel que soit le moyen.** `docs/security.md`
§7 demande « connexion » et « échec de connexion » avec leur acteur : les trois
rappels de fournisseur et le lien de connexion par email passent par le même
utilitaire (`actorOfSessionSetBy`), qui relit la session que la réponse vient de
poser — sans jamais écrire un nom de cookie, qui appartient à la bibliothèque.
Le refus d'un parcours porte son **propre** nom (`auth.oauth_refused`) : compté
comme un échec de connexion, il doublerait chaque retour refusé, et le
verrouillage progressif de s28 compterait deux fois le même.

**Le mode local est un fournisseur de plus, pas un repli.**
`OAUTH_LOCAL_PROVIDER=1` monte un fournisseur `local` par `genericOAuth`, avec
son propre identifiant, une adresse de test fixe, et aucun appel réseau — ses
deux crochets (`getToken`, `getUserInfo`) remplacent les points de terminaison.
Il n'emprunte l'identité d'aucun fournisseur réel, et le poser en même temps
qu'une clé est **refusé au démarrage** — comme le poser sous
`NODE_ENV=production` : il ouvre une session sans mot de passe à qui clique, et
la règle « jamais déduit de `NODE_ENV` » reste tenue, `NODE_ENV` ne faisant que
restreindre l'opt-in sans jamais l'armer.

## Le second facteur (s13)

Cinq routes déclarées, et **cinq seulement** : le greffon `two-factor` en
expose sept. `two-factor/get-totp-uri` rendrait le secret d'un compte déjà
activé — celui-ci ne sort qu'une fois, à l'enrôlement de son propriétaire — et
les deux points d'entrée du facteur par email appartiennent à `otpOptions`,
que le module ne monte pas. Non déclarés, ils répondent 404 sans atteindre la
bibliothèque — et ce sont bien **ces trois chemins-là** qu'un cas de
`tests/auth.test.ts` nomme et interroge, l'affirmation étant restée sans
commande jusqu'à la revue (C8).

**Les codes de secours sont hachés, et c'est un montage en deux moitiés**
(ADR 028). Le défaut de la bibliothèque est `storeBackupCodes: 'encrypted'`,
donc réversible avec le secret de l'application. Ici, `encrypt` remplace chaque
code par un HMAC-SHA256 poivré (`domain/backup-code.ts`), `decrypt` est
l'identité, et **la route hache la saisie** avant de la transmettre. Le piège
est le ré-encodage : la bibliothèque rappelle l'encodeur avec le reste du
tableau, qui contient déjà des empreintes — hacher deux fois rendrait les neuf
codes restants inutilisables, sans que rien ne le dise avant le deuxième usage.
C'est le cas « les neuf autres fonctionnent encore » qui l'attrape.

**`incrementOne` de l'adapter Drizzle n'est pas atomique sur PostgreSQL, et la
consommation d'un code en dépendait.** `@better-auth/core` le documente comme
« the race-safe primitive for guarded state transitions » ;
`@better-auth/drizzle-adapter@1.7.2` écrit
`UPDATE … WHERE id IN (SELECT id FROM … WHERE <garde> LIMIT 1)`, où la garde
est dans un sous-select que la ré-évaluation d'EvalPlanQual ne refait pas contre
la ligne mise à jour. Mesuré : **deux consommations simultanées du même code
réussissaient toutes les deux**, une exécution sur quatre.
`infrastructure/two-factor-adapter.ts` enveloppe cette écriture — et elle
seule, reconnue à sa forme entière — dans un
`UPDATE … WHERE id = ? AND backup_codes = ?`. Le compteur d'échecs et le
verrouillage par compte gardent le chemin de la bibliothèque. Le cas de course
porte sur **cinq codes et dix défis distincts** : deux requêtes partageant un
même défi seraient départagées par la consommation du compteur de tentatives,
bien avant la comparaison-et-échange, et ne prouveraient rien.

**La fenêtre de vérification vaut ±1 période de trente secondes, et ce n'est
pas un réglage.** `totp/index.mjs` appelle `.verify(code)` sans second
argument, et `@better-auth/utils@0.4.2` y met `window = 1`. Quatre-vingt-dix
secondes d'acceptation, ce que la RFC 6238 §5.2 prévoit pour la dérive
d'horloge. Les deux bords sont éprouvés — `-1`, `0`, `+1` acceptés, `-2` et
`+2` refusés — en calculant le HOTP du compteur voulu plutôt qu'en déplaçant
l'horloge.

**La devinette est bornée par la bibliothèque, pas par un compteur d'ici.**
`beginAttempt(5)` détruit le défi au sixième essai ; `accountLockout` (dix
échecs consécutifs, quinze minutes) traverse les défis et les facteurs. Les
deux sont actifs par défaut, et le premier est mesuré. **Ils ne s'arment que
sous `isSignIn`** : le chemin `/two-factor/verify-totp` muni d'une session —
celui de la confirmation d'enrôlement — n'a *aucun* compteur (`beginAttempt` y
rend deux fonctions vides). Le gain y est nul aujourd'hui, puisqu'il faut déjà
une session ; s28 ne doit pas pour autant croire les deux branches couvertes.
La limitation **partagée entre instances** de `docs/security.md` §7 reste s28,
que `docs/stories.md` désigne nommément : « aucun compteur local n'est écrit
ici ».

**Rien de la bibliothèque ne sort tel quel.** Ses cinq codes d'erreur
(`INVALID_CODE`, `TOTP_NOT_ENABLED`, `INVALID_TWO_FACTOR_COOKIE`,
`TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE`, `ACCOUNT_TEMPORARILY_LOCKED`) sont repliés
sur **deux classes** — `invalid` quand le défi vit encore, `restart` quand il
n'existe plus —, au **même statut**. La garde de rejeu du module en ajoute une
**troisième**, `used`, qui ne vient pas de la bibliothèque : un compteur déjà
pris refuse un code **juste**, et lui répondre « ce code n'est pas valide »
faisait croire à une compromission (revue s13, C12/C13/C14 — deuxième connexion
dans les mêmes trente secondes, ré-enrôlement dans la même période, horloge du
serveur reculée). Le statut reste celui de tous les refus, et `used` n'est
atteignable qu'avec un défi ouvert ou une session : pour qui n'a pas présenté le
premier facteur, les refus restent indistinguables. **Reste dit comme un code
faux, et ce n'est pas mesuré** : un *code de secours* déjà consommé — la
bibliothèque rend le même `INVALID_CODE` pour un code inconnu et pour un code
consommé, et le module ne garde pas trace des codes retirés. Et ses corps de réponse portent le `token`
de session : la route les **réécrit**, elle ne les relaie pas. Un jeton rendu à
un écran, c'est `HttpOnly` annulé.

**La connexion a un troisième cas.** `200 + twoFactorRedirect` n'est ni un
succès ni un échec : le mot de passe est bon, mais le crochet du greffon a
détruit la session que la bibliothèque venait de créer. `auth.sign_in_succeeded`
y aurait nommé `anonymous`, ce corps ne portant aucun compte ;
`auth.two_factor_challenged` a donc son nom, et son acteur est relu par
l'adresse — déjà validée à ce point du code.

**La rotation de session est celle de la bibliothèque, aux trois moments** :
confirmation du premier code, désactivation, et vérification à la connexion.
C'est le principal argument pour ne pas réécrire la désactivation, et c'est ce
qui décide de la preuve exigée : `disableTwoFactor` appelle `validatePassword`
avant tout (`shouldRequirePassword` rend `true` dès qu'`allowPasswordless`
n'est pas posé), sans crochet pour y substituer une autre preuve. **Le critère 5
de `docs/stories.md` a donc été amendé** : il disait « un code valide **ou** le
mot de passe courant », il dit désormais « le mot de passe courant ». Ce n'est
pas une renonciation — le mot de passe est la plus forte des deux preuves, et
l'invariant qui compte est tenu : un vol de session ne retire pas le second
facteur. Livrer l'autre moitié voudrait dire réécrire `createSession` +
`setSessionCookie` hors de la bibliothèque, pour un affaiblissement.

Conséquence à connaître : un compte **sans mot de passe** — créé par un
fournisseur externe seul — ne peut ni activer ni désactiver le second facteur.
C'est s14 qui rouvrira la question.

**Le second facteur vaut sur les trois voies d'entrée, pas sur une seule.**
Le `matcher` du crochet du greffon ne cite que `/sign-in/email`,
`/sign-in/username` et `/sign-in/phone-number` : le **magic link** et les
**rappels de fournisseur** ouvraient donc une session sur un compte protégé
sans demander le moindre code — les deux mesurés, et `/sign-in` propose le
magic link juste sous le formulaire de mot de passe. Une protection qu'un
bouton voisin ignore ne protège pas.
`infrastructure/two-factor-challenge.ts` reprend le handler du greffon tel quel
et **remplace son `matcher`** : `/magic-link/verify` et `/callback/:id` posent
le même défi, et les deux routes du module redirigent vers l'écran de
vérification au lieu de la destination demandée.

**Et c'est une liste d'exemptions, pas une liste d'inclusions** (revue s13,
C11). La première forme livrée *ajoutait* deux chemins au `matcher` : aucune
commande ne rougissait le jour où une quatrième voie de connexion apparaissait,
et s14 en monte une (`/passkey/verify-authentication`). Le crochet vaut donc
partout, et `TWO_FACTOR_CHALLENGE_EXEMPT_PATHS` énumère les **cinq** chemins qui
ont le droit de poser une session sans défi : les trois points d'entrée de
vérification du second facteur — s'en exempter est ce qui empêche la boucle —,
plus `/get-session` et `/change-password`, qui font tourner la session d'un
appelant **déjà authentifié** (les deux seuls points d'entrée que le module
appelle par `auth.api.*`). Une exemption manquante échoue *fermée* : un défi de
trop, visible tout de suite. Une inclusion manquante échouait *ouvert*.

La propriété tenue, mesurée sur les trois voies que l'application expose
aujourd'hui, et **maintenue par la forme de la garde** plutôt que par une liste
à mettre à jour : *aucune session n'existe sur un compte à second facteur actif
tant que le facteur n'a pas été présenté*. La commande qui le vérifie :
`packages/modules/auth/src/infrastructure/two-factor-challenge.test.ts` fait
passer par la garde une **route de connexion fictive**, que rien du module ne
cite — rendre au `matcher` une liste d'inclusions la rend rouge.

Élargir le crochet plutôt que marquer la session est un choix, et il a une
raison exécutable : la branche « session déjà ouverte » de `verifyTwoFactor`
n'arme **ni** `beginAttempt(5)`, **ni** `accountLockout`. Laisser la session
s'ouvrir puis exiger le code en aval aurait donc offert une devinette à six
chiffres sans aucun compteur.

**Un code TOTP ne sert qu'une fois.** La bibliothèque ne mémorise aucun
compteur : un code accepté restait valable jusqu'à quatre-vingt-dix secondes,
donc rejouable sur un défi neuf par qui l'avait vu une fois — le critère 4 dit
pourtant « erroné **ou rejoué** ». La colonne `auth_two_factor.last_totp_step`
porte le dernier pas consommé par compte, et la prise est une
comparaison-et-échange (`where user_id = ? and (last_totp_step is null or
last_totp_step < ?)`), jamais une lecture suivie d'une écriture. Le compteur du
code est retrouvé avec la primitive de la bibliothèque elle-même
(`@better-auth/utils@0.4.2`, version épinglée par `better-auth@1.7.2`, déclarée
en dépendance directe pour cela) : une seconde implémentation du HOTP pourrait
diverger, et une divergence refuserait toutes les connexions. Un pas déjà pris
⇒ refus au même statut qu'un code faux, **et la session que la bibliothèque
venait d'ouvrir est révoquée**.

Conséquence à connaître pour les tests : après une confirmation ou une
connexion, le compteur employé est brûlé. Le cas qui mesure la **fenêtre**
(±1 période) remet donc `last_totp_step` à `null` entre ses trois bords — ce
sont deux propriétés distinctes, et chacune a son cas.

**Le jeton de session de `/sign-in/email` sort encore dans le corps de la
réponse de la bibliothèque** (`api/routes/sign-in.mjs:364`), et la route du
module relaie cette réponse en cas de succès — contrairement aux cinq routes du
second facteur, qui réécrivent la leur. Ce n'est **pas** exploitable dans ce
montage, et c'est vérifié : le cookie de session est *signé*
(`setSessionCookie` → `ctx.setSignedCookie`), donc le jeton nu n'en forge pas
un sans `AUTH_SECRET`, et le greffon `bearer` n'est pas monté — les seuls
greffons présents sont `magicLink` et `twoFactor`. **Le jour où une story monte
`bearer` ou livre des jetons d'API, ce relais devient une fuite de session :
c'est ce fichier-ci qu'il faut relire, et la réponse de `/sign-in/email` qu'il
faut réécrire comme les autres.**

Cette condition d'escalade était écrite en gras, et **aucune commande ne la
vérifiait** (revue s13, C4) : elle en a une désormais. `tests/auth.test.ts`,
« n'authentifie rien avec le jeton que la bibliothèque laisse dans le corps de
la connexion », relit le `token` du corps et le présente en `Authorization:
Bearer` — sur une route protégée du module et au résolveur de session. Monter
`bearer` rend ce cas rouge, ce qui est exactement le moment où ce paragraphe
doit être relu.

## Ce que la bibliothèque fait déjà bien, et qu'il ne faut pas réécrire

Mesuré dans le paquet **installé** (1.7.2), sur les quatre points regardés :
`sign-in/email` hache un mot de passe factice quand le compte est inconnu (d'où
l'égalité des temps de réponse — et elle ne vérifie l'adresse qu'**après** le
mot de passe, donc son `403` n'était atteignable qu'en connaissant déjà celui-ci),
`consumeVerificationValue` consomme une ligne
de vérification en transaction, `revokeSessionsOnPasswordReset` supprime les
sessions à la réinitialisation, et un magic link résolvant un compte non vérifié
efface les identifiants accumulés avant la preuve. Ce sont les cas examinés, pas
un inventaire de ce que la bibliothèque garantit.

## Imports autorisés

- `@repo/core` pour le contrat de module, le préfixe de montage et la session ;
- `@repo/ports` pour le port `Mailer` — jamais un client d'email ;
- `better-auth` dans `infrastructure/` **uniquement** ;
- `drizzle-orm` dans `src/schema.ts` et dans `infrastructure/` uniquement ;
- `zod` pour la validation, y compris dans `domain/` où c'est la seule
  bibliothèque tierce admise ;
- `node:crypto` dans `infrastructure/` pour les jetons ;
- `@repo/typescript-config` pour la configuration du compilateur ;
- `vitest` dans les fichiers de test.

Sens des dépendances, vérifié par `pnpm lint` :
`presentation → application → domain` et `infrastructure → application →
domain`. `infrastructure` et `presentation` ne se connaissent pas — c'est
pourquoi le service de la bibliothèque est déclaré comme un **port** dans
`application/auth-service.ts` et implémenté dans `infrastructure/`.

## Ne doit jamais contenir

- **d'import de `@repo/db`** : la connexion est **injectée** par le point de
  composition. L'agrégat de schémas généré importe ce package ; la dépendance
  inverse fermerait un cycle, et une table serait lue avant d'être initialisée
  (ADR 020). `tests/module-registry.test.ts` le refuse ;
- de client d'email, de SMTP, de fournisseur : le port `Mailer` est le seul
  chemin d'envoi. Un second chemin rendrait le §5 du socle invérifiable ;
- de secret dans un journal : ni jeton, ni mot de passe, ni cookie. La forme de
  `SecurityEventRecord` est fermée, et les valeurs sont filtrées ;
- de réponse publique qui distingue **un état de compte d'un autre**, ni par le
  texte, ni par le code de statut, ni par le temps de réponse. Les états sont
  au moins au nombre de trois — compte inconnu, mot de passe faux, adresse non
  vérifiée — et la liste n'est pas close : la règle porte sur la distinction,
  pas sur ce triplet. C'est `SIGN_IN_REFUSAL` du `domain` qui la tient, et la
  route de connexion réécrit par-dessus la réponse de la bibliothèque, qui
  rend `403 EMAIL_NOT_VERIFIED` là où elle rend `401` pour les deux autres. Le
  critère « inviter à vérifier son adresse » est tenu **ailleurs** : sur
  `/verify-email` et par une invitation constante dans le refus, jamais par un
  refus qui varie ;
- de constante de politique en dur : longueurs de mot de passe et durées de vie
  des liens vivent dans `AuthPolicy`, injectée au point de composition ;
- de passkey : c'est s14. **Le second facteur est livré (s13)**, voir plus bas ;
  **OAuth est livré (s12)** ; ce qui reste hors du module est la liaison
  explicite depuis les paramètres (`/link-social`, non déclarée, donc 404) ;
- de **lecture d'une variable d'environnement** : les identifiants de
  fournisseur sont **reçus** du point de composition, comme la connexion et le
  mailer. Une paire incomplète a déjà arrêté le démarrage, en nommant la
  variable.

## Tests

- `src/domain/auth-rules.test.ts` : les règles pures, éprouvées là où elles
  vivent — identifiants, destination de retour, session dérivée du compte,
  filtrage du journal, jetons. Leurs appelants prouvent qu'ils les appellent,
  ils ne rejouent pas ces matrices ;
- `tests/auth.test.ts` à la racine : tout ce qui traverse — base réelle,
  répartiteur, port `Mailer`, cookie, temps de réponse. C'est là que vivent les
  trois mesures de frontière ;
- `e2e/auth.spec.ts` : le parcours complet dans un navigateur ;
- `e2e/two-factor.spec.ts` (s13) : l'enrôlement, puis les deux moyens de
  vérification. Ce qu'aucun test de nœud n'y voit — le **secret affiché à
  l'écran** est celui qui vérifie le code, le parcours le lit dans la page au
  lieu de le recevoir d'une API ; et le formulaire de connexion **va** à
  l'écran de vérification au lieu du tableau de bord.
