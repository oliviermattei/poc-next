# Research — Story s12-oauth-signin

## The five structuring facts

1. **Il n'y a pas de module à créer.** OAuth s'ajoute au module `auth` livré par
   s07 : la table de liaison (`auth_account`) existe déjà, avec ses colonnes de
   jetons, et Better Auth y écrit les comptes de fournisseur comme il y écrit
   l'identifiant `credential` du mot de passe. **Aucune migration n'est
   nécessaire**, et le critère « module non activé » de la story n'a pas
   d'état correspondant : `auth` est socle non désactivable (ADR 021). Ce que
   ce critère devient ici est écrit plus bas, dans « Traps ».
2. **Better Auth 1.7.2 fait déjà la liaison de compte, et sa règle par défaut
   est la bonne** — vérifié ligne à ligne dans le paquet installé
   (`dist/oauth2/link-account.mjs:81-87`) : une liaison implicite sur
   correspondance d'adresse exige que le fournisseur atteste l'adresse
   (`userInfo.emailVerified`) **et** que le compte local soit déjà vérifié
   (`accountLinking.requireLocalEmailVerified`, défaut `true`), sauf si le
   fournisseur est dans `trustedProviders` — dont le défaut est **la liste
   vide** (`context/helpers.mjs:152-155`). Le travail n'est donc pas d'écrire la
   règle mais de **l'épingler explicitement** et de la prouver par mutation :
   un défaut qu'aucun test ne tient est un défaut qui change à la prochaine
   montée de version.
3. **Le cookie de session `SameSite=Strict` de s07 casse OAuth de deux façons,
   et une seule est évidente.** `advanced.defaultCookieAttributes` s'applique à
   **tous** les cookies créés par la bibliothèque (`cookies/index.mjs:27-45`),
   donc au cookie `state` de la boucle OAuth. Or ce cookie est lu sur le
   **retour du fournisseur**, qui est une navigation inter-sites : `Strict`
   l'empêche de partir, `parseGenericState` lève `state_security_mismatch`, et
   la connexion échoue systématiquement. Second effet, plus discret : le cookie
   de **session** posé par le rappel ne repart pas non plus sur la redirection
   finale, et l'utilisateur atterrit déconnecté sur la page de destination.
4. **Le répartiteur apparie les routes par chemin exact** (`packages/core`,
   `dispatchModuleRequest`) : le `/callback/:id` de la bibliothèque n'a donc pas
   de segment dynamique à déclarer — il se déclare **un chemin par fournisseur**
   (`/auth/callback/google`, `/auth/callback/github`), ce qui reste conforme à
   l'ADR 017.

   > **Corrigé après mesure** (revue de s12). Cette phrase se terminait par « et
   > ferme l'énumération de fournisseurs non configurés » : c'est faux, et le
   > diff de la story le contredit. Ce qui est réellement fermé, et éprouvé, est
   > l'**état de configuration** : le rappel d'un fournisseur non configuré rend
   > exactement ce que rend celui d'un fournisseur configuré recevant un état
   > inutilisable — même statut, même destination. Ce qui reste énumérable est
   > la liste des identifiants que le code **connaît** : `/callback/github` a un
   > chemin, `/callback/invente` répond 404. Information publique dans un
   > boilerplate ; la fermer demanderait de construire les rappels depuis les
   > fournisseurs configurés, ce que le montage du registre ne permet pas
   > aujourd'hui — la démonstration est dans la clôture de
   > `docs/reviews/s12-oauth-signin.md`.
5. **Il n'y a pas de « clé de test » possible pour Google ni GitHub.** Leurs
   points de terminaison sont écrits en dur dans les fournisseurs de la
   bibliothèque (`@better-auth/core/src/social-providers/github.ts`). Le mode
   local ne peut donc pas être « les mêmes fournisseurs sur un serveur local » :
   c'est un **fournisseur de plus**, monté par un drapeau explicite, et
   `genericOAuth` de 1.7.2 le permet sans aucune route supplémentaire de la
   bibliothèque (« Providers are used through the standard `signIn.social` and
   `callback/:id` core endpoints — no plugin-specific endpoints needed »,
   `dist/plugins/generic-oauth/index.d.mts`).

## Target story

`s12-oauth-signin` — complexité annoncée 2, dépend de s07 et s08. Six critères :
boutons Google et GitHub affichés **quand leurs identifiants sont configurés**,
première connexion créant le compte avec l'email vérifié par le fournisseur,
liaison au compte mot de passe existant plutôt qu'un second compte, refus
d'autorisation ramenant à la connexion avec un message explicite et sans
session, fournisseurs liés visibles et déliables sauf le dernier moyen de
connexion, et l'état « module non activé ».

## Current state of the code

s01 à s09 livrées (s10 est en cours sur une autre branche, hors périmètre). Le
module `auth` a ses quatre couches, son magasin de jetons à usage unique haché,
son refus de connexion unique (`SIGN_IN_REFUSAL`), sa liste blanche de
redirection (`safeRedirectPath`), son journal filtré, et treize routes
énumérées une par une. Les écrans `/sign-in`, `/sign-up`, `/account` existent et
passent par les catalogues i18n de s09.

Ce qui manque et que cette story apporte : aucun fournisseur social n'est
configuré, `socialProviders` est absent de la configuration, et les endpoints
`/sign-in/social`, `/callback/:id`, `/link-social`, `/unlink-account`,
`/list-accounts` de la bibliothèque **ne sont pas déclarés**, donc répondent 404
par le répartiteur (vérifié en revue de s07 sur quatre chemins).

## Anchor points

| Fichier | Rôle |
|---|---|
| `packages/modules/auth/src/domain/oauth.ts` (nouveau) | fournisseurs connus, règle de provisionnement, classe d'erreur de retour, règle de déliement |
| `packages/modules/auth/src/infrastructure/better-auth-service.ts` | `socialProviders`, `account.accountLinking`, `user.validateUserInfo`, `advanced.cookies.state`, `onAPIError.errorURL` |
| `packages/modules/auth/src/presentation/auth-routes.ts` | `/sign-in/social`, `/callback/<fournisseur>`, `/oauth-error`, `/unlink-provider`, l'autorisation du fournisseur local |
| `packages/modules/auth/src/infrastructure/drizzle-auth-repositories.ts` | dépôt des comptes liés (liste sans jeton, déliement verrouillé) |
| `apps/web/lib/oauth-config.ts` (nouveau) | la **règle** de configuration des fournisseurs, sur le modèle de `mailer-config.ts` |
| `apps/web/app/sign-in/page.tsx`, `sign-up/page.tsx` | les boutons |
| `apps/web/app/account/*` | les fournisseurs liés, et le déliement |
| `apps/web/app/oauth/return/page.tsx` (nouveau) | le rebond same-site qui rend le cookie `Strict` de nouveau émis |

## Verified APIs / functions — `better-auth@1.7.2`, dans le paquet installé

- **`betterAuth` de `better-auth/minimal` expose les mêmes endpoints** que
  l'entrée complète : `auth/minimal.mjs` ne change que l'initialisation
  (`initMinimal`, sans Kysely) et passe par le même `getEndpoints`. Les routes
  sociales sont donc disponibles sans changer d'import.
- **`socialProviders`** : `context/create-context.mjs:97-105` construit chaque
  fournisseur par `socialProviders[key](config)` — la clé doit être un
  identifiant connu de la bibliothèque —, ignore `enabled: false` et **avertit
  seulement** si `clientId` manque. Un fournisseur à moitié configuré n'échoue
  donc pas : c'est à nous de refuser au démarrage.
- **`/sign-in/social`** (`api/routes/sign-in.mjs`) rend `200` avec
  `{url, redirect:true}` **et** un en-tête `Location` ; ce n'est pas une
  redirection HTTP. Son corps accepte aussi `idToken`, `scopes`, `loginHint`,
  `additionalData`, `disableRedirect` — d'où la réinjection d'un corps validé,
  comme s07 le fait déjà.
- **`/callback/:id`** (`api/routes/callback.mjs`) : `state` obligatoire,
  `parseState` avant toute autre chose, refus par redirection vers
  `errorURL ?? onAPIError.errorURL ?? ${baseURL}/error` avec `?error=<code>`.
- **État et PKCE** (`state.mjs`, `oauth2/state.mjs`) : avec une base (notre
  cas : `hasServerSessionStore(options)` est vrai dès qu'`options.database`
  existe), la stratégie est `database` — l'état et le `codeVerifier` sont écrits
  dans `auth_verification`, et **un cookie `state` signé lie l'état au
  navigateur** ; il est comparé au paramètre `state` du retour, puis expiré, et
  la ligne est supprimée. Le `codeVerifier` (128 caractères) ne quitte jamais le
  serveur. PKCE et anti-rejeu sont donc acquis — à condition que le cookie
  `state` puisse revenir (fait n°3).
- **Liaison** (`oauth2/link-account.mjs:81-87`) — condition de refus :
  `!isTrustedProvider && !userInfo.emailVerified || requireLocalEmailVerified &&
  !dbUser.user.emailVerified || accountLinking?.enabled === false ||
  disableImplicitLinking === true` → `{error:"account not linked"}`, transformé
  en `?error=account_not_linked` par le rappel.
- **`user.validateUserInfo`** (`utils/validate-user-info.mjs`,
  `db/internal-adapter.mjs:141-169`) : un crochet **unique** appelé sur les
  trois actions `create-user`, `link-account` et `sign-in`, qui reçoit
  `source.method` (`'oauth'`), `source.oauth.providerId` et l'`emailVerified`
  **du fournisseur**. Il échoue fermé (une exception vaut refus). C'est le seul
  point où l'on peut refuser **avant la création** d'un compte : sans lui, une
  adresse non attestée crée quand même la ligne `auth_user` (branche
  `isRegister` de `link-account.mjs`), et cette ligne squatte l'adresse d'un
  tiers.
- **`/unlink-account`** (`api/routes/account.mjs:263-285`) refuse quand il ne
  reste qu'un compte, mais **compte puis supprime** sans verrou : deux
  déliements simultanés de deux fournisseurs différents laissent le compte sans
  aucun moyen de connexion. C'est exactement la course que s07 a refermée sur
  la consommation de jeton.
- **`genericOAuth`** (`dist/plugins/generic-oauth/index.mjs`) : `getToken` et
  `getUserInfo` remplacent l'appel réseau au point de terminaison de jeton et à
  celui d'`userinfo` ; `emailVerified` remonte tel quel de `getUserInfo`. Seule
  l'`authorizationUrl` est réellement visitée par le navigateur.
- **GitHub** (`@better-auth/core/src/social-providers/github.ts`) : trois appels
  sortants (`login/oauth/access_token`, `api.github.com/user`,
  `api.github.com/user/emails`) et `emailVerified` lu sur l'entrée `verified` de
  l'adresse retenue — donc un vrai signal, doublable au niveau **réseau**.
- **Google** : l'`emailVerified` vient de la claim `email_verified` de l'ID
  token, vérifié contre le JWKS du fournisseur. Non doublable au niveau réseau
  sans fabriquer un JWKS ; les tests passent donc par GitHub et par le
  fournisseur local, qui empruntent le **même** code de décision.

## Traps & constraints

- **Le cookie `state` doit être `SameSite=Lax`**, sinon rien ne marche.
  `advanced.cookies.state.attributes` est appliqué **après**
  `defaultCookieAttributes` (`cookies/index.mjs:38-42`), c'est donc l'échappement
  prévu. `docs/security.md` §1 l'autorise explicitement : `Lax` au minimum pour
  un cookie, `Strict` **pour la session**.
- **Le retour inter-sites ne porte pas le cookie de session `Strict`.** Le
  rappel pose bien le cookie, mais la redirection finale appartient encore à la
  chaîne inter-sites : la destination est servie sans session. Il faut atterrir
  sur une page publique qui **rebondit same-site** vers la destination ; le
  second saut, initié par notre propre document, porte le cookie. C'est le même
  angle mort que le m9 de s07 (lien de magic link ouvert depuis un webmail) — ici
  il n'est pas théorique, il est sur le chemin principal.
- **La liaison par adresse est la faille classique** (la story le dit) : la
  règle retenue est double preuve — le fournisseur atteste l'adresse **et** le
  compte local est déjà vérifié. Un compte mot de passe non vérifié qui porte
  l'adresse de la victime ne peut donc pas capter son identité de fournisseur.
- **Aucune énumération.** Le code d'erreur de la bibliothèque
  (`account_not_linked`) dit qu'un compte existe à cette adresse ; il ne doit
  atteindre ni l'URL, ni le message. Tous les refus autres que « l'utilisateur a
  refusé l'autorisation » se replient sur un message unique.
- **Aucune redirection ouverte** : `callbackURL` et `errorCallbackURL` sont
  imposés par le serveur à partir de `safeRedirectPath` (s07), jamais repris du
  corps tel quel — et la page de rebond revalide sa destination.
- **Aucun secret dans le dépôt** : les identifiants de fournisseur sont des
  variables d'environnement optionnelles au schéma ; ce qui monte
  l'authentification refuse une paire incomplète **en nommant la variable**.
- **Le mode local est un opt-in, jamais un repli** (précédent
  `EMAIL_LOCAL_CAPTURE`) : `OAUTH_LOCAL_PROVIDER=1` monte un fournisseur de
  développement ; posé **en même temps** qu'une clé de fournisseur, il est
  refusé — comme la capture locale l'est en présence de `RESEND_API_KEY`.
- **En CI, les doublures remplacent le réseau, pas le SDK** : le vrai
  `callback.mjs` et le vrai `link-account.mjs` s'exécutent ; seuls les trois
  points de terminaison de GitHub sont servis par la doublure de `fetch` déjà
  posée par `tests/auth.test.ts`.
- **Le critère « module non activé »** n'a pas d'état correspondant : `auth` est
  socle. Ce qu'il devient, et qui est mesurable : **aucun fournisseur
  configuré** ⇒ aucun bouton sur les écrans, et les chemins de rappel répondent
  exactement ce que répond un chemin non déclaré (404, même corps, mêmes
  en-têtes). La table de liaison, elle, est celle de s07 et reste présente.
- `packages/modules/**` n'est couvert par le lint de frontières **que pour
  `.ts`** (N1 de la revue de s07) : aucun `.tsx` n'entre dans le module, les
  écrans restent dans `apps/web`.

## Open questions

1. **Le fournisseur local doit-il pouvoir choisir son adresse ?** Une adresse
   fixe suffit à exercer le parcours ; une adresse choisie transformerait le
   drapeau en « se connecter en tant que n'importe qui ». Trancher au plan.
2. **La liaison depuis les paramètres (`/link-social`) fait-elle partie de
   s12 ?** Les critères demandent de **voir** et de **délier** ; lier depuis les
   paramètres n'est demandé nulle part. Trancher au plan (et l'écrire).
3. **Le rebond same-site doit-il servir aussi les liens d'email (m9 de s07) ?**
   Hors périmètre de s12, mais la page existera : à signaler, pas à généraliser.

## Real complexity

**Verdict : 3**, contre 2 annoncé. Les critères sont peu nombreux et la
bibliothèque fait l'essentiel du travail, mais trois choses sortent du cadre
d'un « ajout de boutons » : le cookie d'état contre le `SameSite=Strict` du
socle (sans lequel la story ne fonctionne simplement pas), le rebond du retour
inter-sites, et le mode local sans clé — qui, pour OAuth, n'est pas une capture
mais un fournisseur de plus. La règle de liaison, elle, est un réglage plus
qu'un développement ; son coût est dans la preuve, pas dans le code.

Pas de découpage proposé : livrer les boutons sans le rebond donnerait un
parcours qui « marche » en local et laisse l'utilisateur déconnecté en
production.
