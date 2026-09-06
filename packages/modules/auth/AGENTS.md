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
  du module. **Deux chemins écrivent cette marque depuis s24**, et il faut les
  connaître tous les deux : le lien de vérification, et la **consommation d'un
  lien de réinitialisation de mot de passe** (`onPasswordReset`
  → `users.markEmailVerified`). Le second existe parce qu'un compte créé par un
  paiement invité (ADR 047) n'a jamais reçu d'email d'inscription et resterait
  autrement incapable de se connecter ; il vaut pour **tous** les comptes du
  produit, pas seulement pour ceux-là. Ce qui le rend légitime est que le lien
  ne part que vers l'adresse du compte — donc **le jeu de greffons monté**, et
  rien d'autre : `better-auth@1.7.2` appelle `onPasswordReset` depuis trois
  sites, dont un greffon `phoneNumber` qui prouverait la possession d'un
  **numéro**. Monter ce greffon-là oblige à rouvrir la ligne ; le commentaire
  d'`auth-use-cases.ts` porte le tableau des trois appelants, et le cas de
  `tests/auth.test.ts` (« rend l'adresse vérifiée en consommant un lien de
  réinitialisation ») ne couvre que le premier ;
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
son propre identifiant et aucun appel réseau — ses deux crochets (`getToken`,
`getUserInfo`) remplacent les points de terminaison. Il n'emprunte l'identité
d'aucun fournisseur réel, et le poser en même temps qu'une clé est **refusé au
démarrage** — comme le poser sous `NODE_ENV=production` : il ouvre une session
sans mot de passe à qui clique, et la règle « jamais déduit de `NODE_ENV` »
reste tenue, `NODE_ENV` ne faisant que restreindre l'opt-in sans jamais l'armer.

**Il sert un créneau d'identité par appelant qui le demande** (s52,
`localOAuthIdentity`), et non plus une adresse unique : deux parcours qui
l'ouvraient en parallèle sur une base vierge entraient en course d'insertion sur
`auth_user_email_key`, et le perdant atterrissait sur `/sign-in?oauth=failed`.
Le créneau arrive par `?identity=<étiquette>` sur la route d'autorisation, et
c'est **une étiquette, jamais une adresse** : celle-ci est composée dans le
domaine réservé `example.test`, si bien qu'aucune valeur reçue ne peut désigner
le compte d'un tiers — la propriété que l'adresse unique protégeait. Une
étiquette hors forme est **refusée** (400), jamais repliée sur l'identité par
défaut : un repli rendrait indiscernables « ce parcours a son créneau » et « ce
parcours partage celui des autres », et la course reviendrait en silence. Le
code du rappel transporte le créneau, et `getUserInfo` refuse un code que ce
fournisseur n'a pas émis. Éprouvé dans `packages/modules/auth/src/domain/auth-rules.test.ts`
(« créneau d'identité du fournisseur de développement »).

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
partout, et `TWO_FACTOR_CHALLENGE_EXEMPT_PATHS` énumère les **six** chemins qui
ont le droit de poser une session sans défi : les trois points d'entrée de
vérification du second facteur — s'en exempter est ce qui empêche la boucle —,
plus `/get-session`, `/change-password` et, depuis s14,
`/passkey/verify-registration`, qui font tourner la session d'un appelant
**déjà authentifié**. Une exemption manquante échoue *fermée* : un défi de
trop, visible tout de suite. Une inclusion manquante échouait *ouvert*.

**Six exemptions, c'est ce qui a été balayé — pas un inventaire de ce que les
bibliothèques exposent.** Ce balayage-ci : les points d'entrée du greffon
`two-factor`, les deux appels `auth.api.*` du module, et l'enrôlement d'une
passkey. Une septième se mesure comme les six : on la retire, et le cas qui la
justifie doit rougir.

La propriété tenue, mesurée sur les **quatre** voies que l'application expose
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

## Les passkeys (s14)

**Une passkey est un premier facteur, et c'est un ADR** (031). Un compte à
second facteur actif qui se connecte par passkey est renvoyé à l'écran de
vérification, exactement comme après un mot de passe. La raison est mesurée, pas
choisie : `@better-auth/passkey@1.7.2` appelle
`verifyRegistrationResponse` **et** `verifyAuthenticationResponse` avec
`requireUserVerification: false`, en dur, sans option pour y toucher. Le drapeau
`UV` est écrit par l'authentificateur et jamais exigé — une passkey prouve la
**possession**, et rien de plus. `authenticatorSelection: { userVerification:
'required' }` n'y changerait rien : c'est une préférence transmise au
navigateur, que seule la vérification côté serveur peut rendre contraignante.
**Le jour où le greffon expose cette option — ou l'exige par défaut —, c'est ce
paragraphe et l'ADR 031 qu'il faut relire**, et la réponse s'écrira dans un ADR
superséquent, jamais dans une ligne ajoutée à la liste d'exemptions.

**Quatre points d'entrée déclarés sur sept.** Le greffon en expose sept ; les
trois autres répondent 404 sans atteindre la bibliothèque, et chacun a sa
raison, mesurée dans le paquet :

- `list-user-passkeys` rend la **ligne entière** — `publicKey`, `credentialID`,
  `counter`, `aaguid`. Le module énumère ses colonnes depuis s07 ; l'écran lit
  la liste par un cas d'usage, et `describePasskeys` recopie champ par champ ;
- `delete-passkey` **compte puis supprime hors transaction**
  (`api/routes/account.mjs`), et ne connaît pas la règle du dernier moyen de
  connexion. Même défaut, même correctif que le déliement de s12 ;
- `update-passkey` monte `requireResourceOwnership` avec
  `notFoundError: PASSKEY_NOT_FOUND` **et** `forbiddenStatus: "UNAUTHORIZED"` :
  un identifiant inconnu et celui d'un autre compte ne rendent donc pas la même
  chose. C'est un oracle d'existence, et `docs/security.md` §3 demande
  l'inverse. Les routes du module (`/passkey/rename`, `/passkey/revoke`)
  répondent **404 dans les deux cas**.

Ces trois-là sont nommés un par un dans `tests/auth.test.ts`, interrogés **avec
une session valide** : ce qui répond 404 n'y est pas une protection, c'est une
route qui n'existe pas.

**Où `credentialID` sort malgré tout, et pourquoi la règle s'arrête là.** Ce que
le module tient, c'est que `credentialID` ne parte **pas vers un écran** :
`describePasskeys` ne le recopie pas, et c'est une des raisons pour lesquelles
`list-user-passkeys` n'est pas déclarée. La règle n'est pas plus large que cela.
`/passkey/generate-authenticate-options`, elle, est **publique** et traversée
avec les cookies : quand une session existe, le greffon charge les justificatifs
par `session.user.id` et rend un `allowCredentials` qui **contient** leurs
`credentialID` (`dist/index.mjs`, lignes 264-283). WebAuthn en a besoin — un
justificatif non découvrable ne se présente que si on le nomme —, et ce que
l'appelant reçoit est ce qu'il détient déjà : aucun compte n'apprend rien d'un
autre, aucune adresse n'entre dans la requête. Écrire ici « `credentialID` ne
quitte jamais le serveur » rendrait ce point d'entrée lisible comme une
violation, et l'agent suivant le contournerait au lieu de le comprendre.

**L'origine attendue est posée, jamais lue dans la requête.** Sans `origin`
explicite, `opts.origin` vaut `null` et les deux vérifications prennent
l'origine attendue dans `ctx.headers.get("origin")` — une valeur que l'appelant
écrit. La comparaison `clientDataJSON.origin === expectedOrigin` devient alors
une chaîne du client contre une autre chaîne du client, et ne peut plus
échouer. Mesuré : retirer `origin: appUrl` rend rouge le cas qui présente une
assertion produite pour `https://evil.test` **avec** l'en-tête `Origin`
correspondant. `rpID` est écrit aussi, et le retirer ne fait rougir aucun cas :
ce n'est pas un trou de couverture, c'est une propriété du montage.
`getRpID(options, baseURL)` retombe sur l'hôte de `baseURL`, et ce module
**épingle** `baseURL` à `APP_URL` (`better-auth-service.ts`) — le repli calcule
donc la même valeur épinglée, pas une valeur devinée. Le vrai repli de la
bibliothèque (`getBaseURL` sur l'en-tête `Host` et les en-têtes de proxy,
`better-auth/dist/auth/base.mjs`) ne s'arme que si `baseURL` **disparaît**, ce
qui casserait du même coup `trustedOrigins`, les liens envoyés par email et les
URI de rappel OAuth. Ce qui mord, ici, est la vérification du `rpIdHash` : elle
a ses cas, et `rpID: 'evil.test'` en rougit dix-sept.

**Changer l'hôte d'`APP_URL` invalide toutes les passkeys déjà enregistrées.**
C'est la seule surprise de production que s14 installe, et elle n'a ni message
ni migration : le `rpID` est scellé **dans le justificatif** par
l'authentificateur au moment de l'enrôlement, et une cérémonie dont le `rpId`
attendu a changé est refusée par le navigateur avant même d'atteindre le
serveur. Passer de `example.com` à `app.example.com` — ou l'inverse, ou vers un
autre domaine — casse donc silencieusement la connexion par passkey de tout le
monde. Ce qu'il faut faire quand cela arrive :

- prévenir **avant** de déplacer le domaine, et rappeler que l'autre moyen de
  connexion existe toujours : la règle du dernier moyen garantit qu'il en reste
  un (mot de passe, lien de connexion ou compte externe) ;
- faire **réenregistrer** une passkey depuis le nouvel hôte ; les anciennes
  lignes restent en base sans jamais pouvoir servir, et se révoquent depuis
  l'écran de compte ;
- ne pas « rattraper » en figeant l'ancien `rpID` : il doit rester un suffixe
  enregistrable de l'origine servie, donc le mensonge ne tient que si le nouvel
  hôte est un sous-domaine de l'ancien — et le navigateur refuse le reste.

**Ce que le compteur de signature détecte, et ce qu'il ne détecte pas.**
`@simplewebauthn/server@13.3.3` refuse une assertion dont le compteur n'a pas
progressé — donc un rejeu, ou un clone resté en arrière — **à condition** que
l'un des deux compteurs soit non nul :
`if ((counter > 0 || credential.counter > 0) && counter <= credential.counter)`.
Un authentificateur qui rend toujours zéro, ce qui est le cas de la plupart des
passkeys synchronisées, n'est **pas** protégé, et aucune ligne de ce dépôt ne
peut y changer quelque chose. Les deux branches ont leur cas : une assertion à
compteur décroissant refusée, une assertion à compteur nul acceptée deux fois.
Écrire « le clonage est détecté » serait faux pour l'authentificateur le plus
répandu.

**La règle du dernier moyen de connexion n'a pas été dupliquée.**
`canUnlinkSignInMethod` (`domain/oauth.ts`) est toujours la seule ; ce qui a
changé est son **entrée**, qui compte désormais `auth_account` **et**
`auth_passkey`. Les deux tables sont verrouillées dans le **même ordre** —
comptes puis passkeys, `lockSignInMethods` — par le déliement d'un compte comme
par la révocation d'une passkey : deux retraits croisés qui prendraient les
verrous en sens inverse se bloqueraient l'un l'autre. Le cas de concurrence
lance les deux retraits ensemble et exige qu'un seul passe.

**L'enrôlement fait tourner la session, et l'ancienne meurt.**
`createSession: true` est **imposé** par la route, jamais lu du corps du client
— le laisser décider reviendrait à lui laisser désarmer la rotation que
`docs/security.md` §2 exige. Mais `internalAdapter.createSession` **ajoute** une
ligne, il n'efface pas la précédente : la route révoque donc explicitement la
session de l'appelant, lue avant l'appel. Sans cette révocation, l'ancien
identifiant resterait valable et la « rotation » n'en serait pas une — mesuré,
2 cas rouges.

**Aucun appel réseau sortant.** La vérification WebAuthn est de la
cryptographie locale : balayé sur `dist/index.mjs` du greffon et sur `esm/` de
`@simplewebauthn/server`, aucun `fetch`, aucun `betterFetch`. La porte bornée du
module (`oauth-outbound.ts`) n'a rien de neuf à couvrir, et une passkey
fonctionne en local **sans aucune clé de fournisseur** — il n'y a pas de
fournisseur (`docs/reliability.md` §2).

**Un justificatif, une ligne.** `auth_passkey.credential_id` porte un index
**unique** : la bibliothèque résout une connexion par `findOne({ credentialID })`,
et deux lignes de même identifiant rendraient cette résolution arbitraire.
L'attestation `none` que le greffon demande n'empêche personne de présenter
l'identifiant d'un autre ; c'est la base qui ferme.

**Ce que le module ne fait pas, et qu'il ne faut pas croire fait :**
l'interface conditionnelle (`autocomplete="webauthn"` et `useBrowserAutofill`)
n'est pas livrée — le bouton de `/sign-in` est explicite. Un attribut
`autocomplete="webauthn"` posé sans l'appel qui l'arme ne fait rien du tout.

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
- `@better-auth/passkey` dans `infrastructure/` **uniquement**, et dans le seul
  fichier qui monte les greffons (s14). Le greffon officiel, épinglé à la même
  version que la bibliothèque ; son sous-chemin `/client` n'est jamais importé
  ici — il appartient au navigateur, et `apps/web` l'écarte au profit de
  `@simplewebauthn/browser` ;
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
- **Les passkeys sont livrées (s14)**, le second facteur aussi (s13), OAuth
  aussi (s12) — les trois sections plus bas. Ce qui reste hors du module est la
  liaison explicite depuis les paramètres (`/link-social`, non déclarée, donc
  404) ;
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
  l'écran de vérification au lieu du tableau de bord ;
- `e2e/passkeys.spec.ts` (s14) : la cérémonie **réelle** du navigateur, avec
  l'authentificateur virtuel de Chrome (CDP `WebAuthn.addVirtualAuthenticator`).
  Ce qu'aucun test de nœud n'y voit — la liaison entre le bouton et
  `navigator.credentials`, et le fait que le bouton **n'existe pas** quand le
  navigateur ne sait pas faire de WebAuthn. Les cérémonies de
  `tests/auth.test.ts`, elles, sont fabriquées par
  `tests/fixtures/webauthn.ts` : cette doublure remplace **l'authentificateur,
  jamais le vérificateur**, et ne dit rien de ce qu'un navigateur accepte de
  produire.

## La suppression de compte (s34)

Trois choses à savoir avant d'y toucher.

**La cascade n'attrape pas tout, et l'exception est mesurée.** `auth_session`,
`auth_account`, `auth_passkey` et `auth_two_factor` référencent `auth_user` en
`on delete cascade` : effacer le compte les emporte. `auth_verification`, non —
ses lignes sont désignées par une **adresse** (ou par « identifiant espace
adresse » pour un changement d'email en attente), jamais par une clé étrangère.
`purgeAccount` lit donc l'adresse **pendant que le compte existe**, puis appelle
`tokens.deleteNaming({ userId, email })`. Sans cet appel, un jeton de
vérification survivait au compte en portant son adresse — trouvé par le balayage
de `tests/account-deletion.test.ts`.

**Ce que ce balayage couvre, exactement** — la première rédaction de ce
paragraphe promettait plus, et la revue l'a démentie en mesurant : les **tables**
sont dérivées du contrat — celles des modules activés **qui existent réellement
dans le schéma**, l'intersection étant lue dans `information_schema` parce que la
suite ne migre que les modules dont elle écrit des données —, toutes leurs
colonnes, comparées en texte ; les **lignes**, elles, ne sont pas dérivées. Le balayage ne
trouve que ce que le cas a lui-même écrit, donc une table qu'aucune écriture ne
peuple est balayée **vide**. Ajouter une table qui nomme un compte ne fait donc
rougir ce balayage que si un cas y écrit une ligne.

C'est pour cela que le cas nomme les tables qu'il peuple (`POPULATED`) et
**asserte cette liste** : les quatre qui nomment un compte sans clé étrangère
vers lui — `admin_platform_role.granted_by`, `auth_verification.value`,
`organization_invitation.email`, `notification.payload` —, plus quatre témoins
que la cascade emporte. Une table qui cesse d'être peuplée fait rougir ; une
table neuve qui devrait l'être se décide en ajoutant sa ligne à cette liste. La
mesure qui a produit cette rédaction : neutraliser l'effacement de l'adresse
invitée laissait le balayage **vert** ; il en rougit désormais.

**Le prédicat de `deleteNaming` est ancré, et il l'est en deux fois.** Il a
d'abord cherché `%<valeur>%` sur une table **partagée par tous les comptes**,
avec deux débordements successivement mesurés : les jokers de `LIKE` — `_` est
légal dans une adresse —, puis la sous-chaîne elle-même, `a@b.co` emportant les
jetons de `a@b.com`. Les valeurs à atteindre étant connues et fermées, il les
nomme désormais : les **égalités** — l'adresse, et `<identifiant> <adresse
visée>` — et **un seul motif, ancré à gauche**, `<identifiant> %`, pour un
changement d'email dont l'adresse visée n'est pas connue de l'appelant. La
liste qui fait foi est le tableau `conditions` du repository ; ce paragraphe la
décrit, il ne la compte pas.

`escapeLikePattern` ne garde donc plus que ce dernier motif, et il faut le
savoir avant de lire les cas : « n'efface pas le jeton d'un voisin dont
l'adresse ne diffère que par un joker » passe aujourd'hui sur l'**égalité**, et
ne mesure plus l'échappement malgré son nom — mesuré, retirer l'échappement le
laissait vert. Ce qui le mesure est « n'efface pas le changement d'email d'un
compte dont l'identifiant est voisin », qui pose ses lignes à la main parce que
la bibliothèque ne produit pas d'identifiant portant un joker.

**Ce qui tient « les sessions sont révoquées », mesuré :** la cascade, pas
l'appel. `purgeAccount` appelle `sessions.revokeAllForUser` **et** supprime le
compte ; neutraliser le premier laisse la suite verte, neutraliser le second fait
rougir largement — **11 cas sur l'ensemble de `pnpm test`, mesuré le 05/09/2026**,
et le nombre vieillira : ce qui compte est qu'il ne soit pas nul, la commande qui
le dit est `pnpm test` avec `users.deleteById` neutralisé. L'appel explicite est
une ceinture, il n'est pas la bretelle — ne pas le citer comme la garantie.

**L'orchestration n'est pas dans ce module, elle y arrive.** `purgeScope`
(l'effacement de tous les modules activés), `soleOwnerships` (les organisations
qu'un compte bloquerait en partant) et `jobs` (le port d'émission) sont
**injectés** par `apps/web/lib/auth.ts`, comme le mailer : `@repo/core` construit
le registre à partir des modules, donc un module ne peut pas le lire. Les trois
sont **fail-closed** en l'absence de câblage — la purge échoue en nommant ce qui
manque, l'émission refuse — sauf `soleOwnerships`, qui rend une liste vide parce
que c'est l'état légitime d'un projet dont le module `organizations` est coupé.

**L'ordre de l'effacement, et la raison pour laquelle il rend l'opération
rejouable :** `auth` est purgé **en dernier** (ordre inverse du graphe, ADR 029,
tous les autres modules le requièrent). Un compte encore présent est donc un
compte dont l'effacement n'a pas abouti, et un compte absent est un compte dont
tout a abouti — c'est ce qui autorise `runAccountPurge` à sortir sans rien faire
quand `findById` rend `null`, donc à ne produire **qu'un seul** email de
confirmation quel que soit le nombre de rejeux.

**Le moment de l'email :** l'adresse est retenue **avant** l'effacement, la
confirmation part **après** — le précédent de `organizations.purge` (s16).
Envoyée avant, elle accuserait réception d'une opération qui peut encore
échouer ; l'adresse ne se relit pas après, elle n'existe plus.

## L'export de ses données (s35)

Le module possède la **demande** et le **lien** ; il ne possède pas l'archive.
Celle-ci traverse tous les modules activés, et seul le registre sait lesquels le
sont : `collectArchive` est donc **reçu** du point de composition
(`apps/web/lib/auth.ts`), au même titre que `purgeScope` l'est depuis s34 et que
`readableScopes` l'est à `storage`. Sans ce câblage, les deux routes répondent
**404** — la fonctionnalité n'est pas montée à moitié, elle n'existe pas. Le
placement complet, avec ses options rejetées : `docs/decisions/061-…`.

**Un seul port de tâches pour les deux traitements du module.** L'effacement de
compte (s34) et la construction d'archive (s35) empruntent `AuthDependencies.jobs`
— le même. Deux ports pour deux tâches du même module seraient deux vérités sur
« où s'exécute une tâche », et l'un des deux finirait par mentir. Il n'y a donc
**aucun repli synchrone écrit ici** : c'est `apps/web/lib/jobs.ts` qui rend un
port exécutant dans la requête quand le module `jobs` est coupé.

Ce qui vit ici, et où :

| Pièce | Fichier | Pourquoi là |
|---|---|---|
| forme du jeton, échéance, seuil d'âge du balayage, schéma de l'archive, identifiant de la tâche | `src/domain/data-export.ts` | aucune primitive : le `domain` ne connaît ni `node:crypto`, ni la base, ni HTTP |
| HMAC, comparaison à temps constant, empreinte | `src/infrastructure/data-export-signer.ts` | la primitive appartient à `infrastructure/`, comme `token-factory.ts` |
| revendication sous verrou consultatif | `src/infrastructure/drizzle-data-export-repository.ts` | c'est une transaction, pas une règle |
| demande, construction, lien, oubli | `src/application/data-export-use-cases.ts` | le seul endroit où les six pièces se rencontrent |
| traduction en réponse HTTP | `src/presentation/auth-routes.ts` | le tableau état par état vit dans le docblock de la route de téléchargement |

Huit décisions, et chacune a une commande qui échoue si on la défait :

1. **une archive partielle n'est jamais livrée.** Un module qui refuse fait
   passer la demande à `failed` en nommant le module ; aucun lien ne part, et
   redemander repart de zéro ;
2. **l'archive vit dans `auth_data_export_request.archive`**, pas dans le
   stockage d'objets (`docs/decisions/062-…`). C'est ce qui la fait disparaître
   avec le compte — la cascade de `requested_by` — **et** avec l'organisation,
   dont le périmètre ne porte aucune clé étrangère (ADR 018) et que seule la
   purge du contrat emporte. C'est le second cas qui mesure : sans l'appel
   explicite dans `purgeAccount`, l'archive complète d'une organisation
   supprimée reste en base, et le cas du périmètre compte reste vert ;
3. **l'échéance est écrite en base et relue à chaque téléchargement.** Le jeton
   ne porte que l'identifiant de la demande et sa signature ; il n'y a rien à
   réécrire dans l'URL. L'empreinte du jeton survit à l'échéance, pour répondre
   410 (« ce lien a expiré ») plutôt que 404 ;
4. **l'archive échue est effacée par deux déclencheurs, et il en fallait deux.**
   Le balayage de la tâche n'existe que si le module `jobs` est activé : coupé —
   et `config/profiles.ts` le coupe —, la tâche n'est jamais appelée sans
   `requestId`, donc cette branche ne s'exécute pas. Mesuré par la revue :
   archive échue, `status = ready`, copie JSON complète restée en base.
   L'effacement est donc **aussi** accroché à `requestDataExport`, qui existe
   dans toutes les configurations, et il porte sur **toutes** les archives
   échues. Ce qu'il ne couvre pas : un dépôt sans ordonnanceur où plus personne
   ne demande d'export ;
5. **la signature est vérifiée avant toute lecture.** Mesuré : l'empreinte du
   jeton refusait déjà un jeton forgé, mais **après** une requête en base, si
   bien que retirer la comparaison de signature laissait la suite au vert. Le
   cas qui mord compte donc les lectures, pas le code de retour ;
6. **une mise en file refusée close la demande et répond 503.** Rien ne
   construira l'archive, et **le balayage ne la reprendra pas** : il ne rend que
   les demandes encore `pending`. Rendre 202 serait un accusé de réception pour
   un travail que personne ne fera, et laisser la demande « en cours »
   bloquerait le périmètre derrière elle. C'est la décision de s34 sur le même
   port ; le refus n'étant celui d'aucun module, `failed_module_id` reste vide.
   L'événement s'appelle donc `auth.data_export_refused` — il s'est appelé
   `…_deferred`, ce qui promettait une reprise que le code interdit ;
7. **aucun refus de l'export ne répond 404, et les refus de lien sont
   indiscernables.** `e2e/modules.spec.ts` balaie toute route publique d'un
   module activé et exige qu'elle ne réponde jamais 404 — la garantie « une
   route déclarée est une route servie ». Elle a refusé la route de
   téléchargement, qui rendait 404 sur un jeton absent, exactement comme elle
   avait refusé la route de rappel du module de tâches en s33. Jeton absent,
   illisible, mal signé ou demande inconnue rendent donc **400 `invalid_token`**,
   code **et** corps identiques : les distinguer dirait à qui essaie s'il a
   trouvé un identifiant réel. L'export non câblé rend **503**, comme s33 — une
   absence du côté du serveur, pas une requête invalide. Le tableau complet, état
   par état, vit dans le docblock de la route ; le cas qui mord vit dans
   `pnpm test`, pas seulement dans le navigateur, et c'est la leçon de s33 ;
8. **la demande est limitée en débit alors qu'elle est authentifiée.**
   `routeIsRateLimited` est dérivé du registre : une route non publique n'est
   comptée que si elle le **déclare**. Sans `rateLimit: { policy: 'dataExport' }`,
   une session valide boucle — la revendication ne refuse que tant qu'une
   demande est en cours, et une demande servie ne refuse plus la suivante —, et
   chaque tour parcourt l'export de tous les modules, écrit une copie complète
   en base et envoie un email. C'est la raison exacte qui fait déclarer `upload`
   au module `storage` : une session n'est pas une limite. Le seuil est **par
   appelant seulement**, parce que le seau par compte visé se construit depuis
   le corps ou un cookie et que le périmètre d'un export vient de la session.

**Ce que le balayage reprend, et ce qu'il ne reprend pas.** Il reprend une
demande **mise en file avec succès et jamais exécutée** — événement perdu,
processus tombé —, et seulement passé `DATA_EXPORT_SWEEP_MIN_AGE_SECONDS`. Le
seuil d'âge n'est pas décoratif : le balayage et l'exécution du fournisseur ont
des clés d'idempotence différentes, donc rien ne les déduplique. Mesuré sur deux
constructions concurrentes de la même demande — **deux emails partent**, portant
le **même** lien, et ce lien **fonctionne** (le jeton dérive de l'identifiant de
la demande, il n'est pas tiré au hasard). Le défaut est un doublon d'email et un
parcours d'export payé deux fois, pas un lien mort : la revue l'avait raisonné
comme un lien mort, la mesure dit autre chose.

`AuthDatabase` inclut `execute` depuis cette story : la revendication prend un
`pg_advisory_xact_lock`, qui ne s'appelle pas autrement. Contrairement à
`organizations`, ce module n'a pas de périmètre organisationnel à tenir : aucune
règle de lint n'y restreint la lecture.

### Ce qui a été prouvé par mutation (s35)

Comptes des cas passés au rouge par `pnpm vitest run tests/data-export.test.ts`
(33 cas verts sans mutation), mesurés le 6 septembre 2026 **après la fusion de
s34 et après la première revue**. C'est la liste des mutations **posées**, jamais un inventaire de ce qui
est couvert.

| Mutation | Rouges |
|---|---|
| `exportModules` avale l'échec d'un module et rend une charge partielle | 1 |
| un module qui déclare une catégorie n'exporte plus rien (`storage`) | 1 |
| un module qui détient des tables cesse de déclarer ses catégories (`billing`) | 2 : le plancher ici, et `tests/billing.test.ts` |
| `auditDataCategoryCoverage` ne constate plus rien | 3 |
| l'exception `admin` / `grant-authorship` est retirée de la table | 1 |
| la même exception perd sa raison écrite | 1 |
| une exception dont le module est coupé redevient « périmée » | 1 |
| l'archive ne porte plus la version de format documentée | 7 |
| le verrou consultatif de la revendication est retiré | 1, sur cinq courses |
| la purge du contrat n'emporte plus les demandes du périmètre | 1 |
| l'oubli des archives échues à la demande est retiré | 1 |
| `forgetExpiredArchives` n'efface plus rien | 2 |
| le balayage perd son seuil d'âge | 1 |
| un module excepté du plancher se met à déclarer une catégorie (`jobs`) | 2 |
| la signature du lien n'est plus comparée | 1 |
| la route de téléchargement cesse d'être publique | 9 |
| la demande ne déclare plus de politique de limitation | 1 |
| le refus d'un lien inutilisable redevient 404 | 3 |
| l'échéance n'est plus comparée à l'horloge du serveur | 2 |
| le schéma n'est plus vérifié avant de servir l'archive | 1 |
| un non-membre reçoit 403 au lieu de 404 | 1 |
| la construction ignore le port de tâches | 4 |
| l'échec de mise en file est ignoré | 1 |
| un `admin` obtient `organization.export` | 1 ici, 1 dans `organization-rules.test.ts` |

**Trois de ces mutations sont revenues vertes avant de mordre**, et c'est ce
qu'elles ont appris qui compte :

- **la purge**, parce que la cascade de `requested_by` couvrait déjà le périmètre
  **compte** et que le cas ne mesurait que celui-là ;
- **la signature**, parce que l'empreinte du jeton refusait à sa place, mais
  après une lecture en base ;
- **le seuil d'âge du balayage**, parce que le cas figeait l'horloge : avec
  `requestedAt = maintenant`, la comparaison stricte `requestedAt < maintenant`
  est fausse, et retirer le seuil ne changeait rien. Le cas avance désormais
  l'horloge d'une minute avant de balayer.

Les trois cas ont été réécrits, aucune des trois gardes.
