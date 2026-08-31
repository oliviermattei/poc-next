# Revue — s12-oauth-signin

Branche `feature/s12-oauth-signin`, commit unique `5e49aca`, 39 fichiers.
Diff jugé : `git diff dev...feature/s12-oauth-signin`. Base `s12`.
Documents lus : `docs/stories.md` (s12), `docs/research/s12-oauth-signin.md`,
`docs/plans/s12-oauth-signin.md`, `docs/decisions/023-liaison-de-compte-oauth.md`,
`docs/security.md`, `docs/reliability.md`, `AGENTS.md` (racine, `apps/web`,
`packages/modules/auth`), et la revue de s07.

## Commandes, exécutées par la revue

Toutes sur la configuration **committée**, port 3100 vérifié libre par
`lsof -i :3100` avant chaque lancement de Playwright.

| Commande | Résultat |
|---|---|
| `pnpm test` | 720 passés, 2 ignorés, 26 fichiers |
| `pnpm test:e2e` | 32 passés (3 exécutions consécutives) |
| `pnpm typecheck` | vert |
| `pnpm lint --max-warnings=0` | vert |
| `pnpm build` | vert |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert |
| `git diff --exit-code` après revue | propre |

Contrairement à ce que l'implémenteur rapportait, la suite Playwright passe sur
le port committé : elle n'a pas eu besoin d'une configuration hors dépôt. Une
seule exécution sur les quatre a rendu 29 rouges en `ERR_CONNECTION_REFUSED`
(serveur mort en cours de course, à froid) ; non reproduite sur les trois
suivantes. Signalée telle quelle, pas diagnostiquée.

## Mutations, chacune restaurée immédiatement

Toutes vérifiées par `git checkout` puis `git diff --exit-code` avant d'écrire
une ligne de ce rapport.

| # | Ce qui a été neutralisé | Fichier | Rouges |
|---|---|---|---|
| M1 | `oauthProvisioningRefusal` rend toujours `null` | `domain/oauth.ts` | **3** (2 unitaires + « ne crée aucune ligne ») |
| M2 | `requireLocalEmailVerified: false` | `infrastructure/better-auth-service.ts` | **1** (pré-enregistrement) |
| M3 | `trustedProviders: ['github']` | idem | **0** |
| M4 | `allowDifferentEmails: true` | idem | **0** |
| M5 | **M1 et M3 ensemble** | les deux | **2** — dont « refus qui ne dit rien de l'état du compte » |
| M6 | `.for('update')` retiré du déliement | `infrastructure/drizzle-auth-repositories.ts` | **1** (deux déliements simultanés) |
| M7 | `oauthFailureClass` rendue transparente | `domain/oauth.ts` | **3** |
| M8 | liste blanche retirée de `/sign-in/social` | `presentation/auth-routes.ts` | **1** |
| M9 | contrôle de propriété du déliement neutralisé | `drizzle-auth-repositories.ts` | **1** (404 sur le moyen d'autrui) |
| M10 | corps du client transmis tel quel à la bibliothèque | `auth-routes.ts` | **3** (dont `idToken`) |
| M11 | cookie d'état repassé en `sameSite: 'strict'` | `better-auth-service.ts` | **2** (e2e) |
| M12 | rebond same-site supprimé (`oauthReturnPath` rend la destination) | `domain/oauth.ts` | **1** (e2e — exactement « le retour venu d'un autre site atterrit connecté ») |
| M13 | liste blanche retirée de la page de rebond | `apps/web/app/oauth/return/page.tsx` | **1** (e2e) |

**Ce que M5 tranche, et que l'implémenteur n'avait pas mesuré.** Il soutenait
que `trustedProviders: []` est un « second filet » parce que le crochet du
`domain` refuse avant. La mesure dit mieux que lui : ce sont **deux filets
réellement indépendants**, chacun suffisant à tenir le cas « compte local
vérifié + fournisseur qui n'atteste pas ». Retirer l'un laisse l'autre tenir
(M1 et M3 seuls) ; retirer les deux fait rougir (M5). La surface est couverte.
La justification écrite, elle, est fausse — voir N3.

Le rebond same-site (M12) et le cookie d'état en `Lax` (M11) sont les deux
choix que le brief demandait de juger : ils sont **tenus par une mesure
navigateur**, pas par une intention. `docs/security.md` §1 autorise nommément
`Lax` au minimum et n'exige `Strict` que pour la session ; la session reste
`Strict` et le parcours sans JavaScript le lit dans le bocal du navigateur. Le
choix est bon et il est prouvé.

## Constats

### N1 — critical — Aucun délai d'attente sur les appels sortants OAuth

`docs/reliability.md` §3 : « **Tout appel réseau sortant porte un délai
d'attente explicite. Aucun appel sans délai.** » §2 : « Une panne de service
tiers ne bloque jamais une requête au-delà de son délai d'attente. »

s12 introduit les **premiers** appels sortants du module `auth` — la suite de
s07 mesurait justement qu'il n'en faisait aucun (`expect(outboundCalls).toEqual([])`).
Trois par connexion GitHub, dans le paquet installé
(`@better-auth/core/dist/social-providers/github.mjs`) :

- `betterFetch("https://github.com/login/oauth/access_token", { method, body, headers })`
- `betterFetch("https://api.github.com/user", { headers })`
- `betterFetch("https://api.github.com/user/emails", { headers })`

Aucun n'a d'option `timeout`. Et il n'y a **pas de défaut** : vérifié dans
`@better-fetch/fetch@1.3.1/dist/index.js`, `getTimeout` n'arme un
`controller.abort()` que `if (!options?.signal && options?.timeout)`. Un
point de terminaison de fournisseur qui pend tient donc la requête de rappel
ouverte sans borne applicative.

Le dépôt sait faire : `packages/adapters/resend/src/resend-mailer.ts` porte un
délai explicite, un recul exponentiel et un plafond. Le module `auth` ne le
fait pas, et le plan ne nomme pas §3 dans ses « socles couverts » — c'est un
point que personne n'a regardé, pas un arbitrage rendu.

Ce qui fermerait le constat, dans le module et sans attendre l'amont :
`ProviderOptions` expose `getUserInfo` (et `verifyIdToken`, `refreshAccessToken`)
— vérifié dans `oauth2/oauth-provider.d.mts` — donc les appels de profil sont
bornables ; l'échange de code de `github`, lui, n'est pas surchargeable, ce qui
laisse la borne au niveau du gestionnaire (une échéance autour de
`auth.handler(request)` sur les routes de rappel). Les deux ensemble
suffisent ; aucune des deux n'est écrite.

### N2 — major — Le parcours OAuth ne journalise aucun événement de sécurité

`docs/security.md` §7 : « Événements de sécurité journalisés avec leur acteur :
**connexion, échec de connexion**, réinitialisation… ».

Trouvé jusqu'ici, en parcourant les **16 routes déclarées** de
`presentation/auth-routes.ts` : les cinq routes du parcours externe
— `/auth/callback/google`, `/auth/callback/github`, `/auth/callback/local`,
`/auth/sign-in/social`, `/auth/oauth-error` — n'appellent jamais
`useCases.log`. Une connexion réussie par fournisseur et un retour refusé sont
donc invisibles du journal, alors que `/auth/sign-in/email` journalise ses deux
issues et que s12 a par ailleurs ajouté deux événements pour le déliement
(`auth.provider_unlinked`, `auth.provider_unlink_refused`).

Ce n'est pas propre à s12 : `/auth/magic-link/verify` ne journalise rien non
plus, et c'est antérieur. Le constat est donc « une lacune existante que cette
story étend à un nouveau moyen de connexion », pas une régression pure — d'où
major et non critical. Il compte : les tentatives de liaison refusées à
répétition sur l'adresse d'une victime sont exactement ce que l'ADR 023 décrit
comme l'attaque, et rien ne les rend visibles. s28 (verrouillage progressif)
en aura besoin.

### N3 — major — L'ADR 023 et l'`AGENTS.md` du module enregistrent une cause fausse

Trois documents disent la même chose : `docs/decisions/023-liaison-de-compte-oauth.md`
(« le crochet refuse plus tôt, sur les trois actions déclarées »),
`packages/modules/auth/AGENTS.md` (« le crochet refuse plus tôt »), et le
commentaire de `better-auth-service.ts` (« ce n'est pas un trou du filet : le
crochet `validateUserInfo` ci-dessus refuse plus tôt »). Mesuré dans le paquet
installé, c'est faux sur les deux lignes concernées :

- **`allowDifferentEmails`** n'est lu qu'à deux endroits — `api/routes/callback.mjs:177`
  (branche `link` de l'état) et `api/routes/account.mjs:213` (`/link-social`).
  Les deux appartiennent au parcours de liaison explicite, que ce module
  **ne déclare pas** (404, et le plan l'écrit). La mutation est verte parce que
  le chemin est **injoignable**, pas parce qu'un crochet l'a devancée. Le
  crochet ne voit jamais ce cas.
- **`trustedProviders`** : l'ordre est inversé. Dans `oauth2/link-account.mjs`,
  la porte `!isTrustedProvider && !userInfo.emailVerified || …` est évaluée
  **avant** `assertValidUserInfo` (ligne ~81 contre ligne ~92). Le crochet
  refuse donc **plus tard**, pas plus tôt. Le résultat est meilleur que ce que
  la note dit — M5 prouve deux filets indépendants — mais le mécanisme écrit
  n'est pas celui qui s'exécute.

L'`AGENTS.md` racine nomme précisément ce risque : « The next agent reads such a
claim as verified and stops looking. » Celui qui déclarera `/link-social` en
s13 ou s16 lira « le crochet tient » et pourra retirer `allowDifferentEmails:
false` — que le crochet ne couvre pas. Un ADR accepté est immuable : la
correction passe par un ADR qui le supersède, ou par une note de revue liée.
Je n'ai pas classé ce constat critical parce que rien ne part cassé en
production et parce que le caractère mesuré des deux mutations vertes est, lui,
correctement consigné.

### N4 — major — `OAUTH_LOCAL_PROVIDER=1` est un contournement d'authentification, sans défense en profondeur

Le drapeau monte un fournisseur qui ouvre **toujours** une session sur
`local@example.test`, avec `emailVerified: true`, sans mot de passe et sans
réseau. C'est exactement ce que `docs/reliability.md` §2 demande — un opt-in
explicite, jamais déduit de `NODE_ENV` — et la garde croisée « drapeau + clé =
refus » est écrite, éprouvée (`env.test.ts`, `env-wiring.test.ts`) et bonne.

Ce qui manque est la deuxième ligne : posé **seul** dans un déploiement de
production, le drapeau donne un bouton « Continuer avec Fournisseur local » à
tout visiteur anonyme de `/sign-in`, et rien ne s'y oppose. `.env.example` livre
désormais `OAUTH_LOCAL_PROVIDER=` au milieu des variables qu'on demande de
remplir. Le précédent invoqué, `EMAIL_LOCAL_CAPTURE`, a la même forme mais un
rayon d'action sans commune mesure : au pire, des emails ne partent pas.

Refuser le drapeau quand `NODE_ENV === 'production'` ne violerait pas la règle
« jamais déduit de `NODE_ENV` » : le drapeau resterait l'unique opt-in,
`NODE_ENV` ne ferait que le **restreindre**, jamais l'activer.

### N5 — minor — `reuseExistingServer: true` : le harnais ne distingue pas « mon arbre » d'un autre

`playwright.config.ts` (ligne préexistante, hors diff s12) réutilise tout
serveur qui répond sur 3100. L'implémenteur de s12 s'est fait prendre par la
face bruyante (20 rouges parasites, serveur d'une autre voie). La face
silencieuse est pire et n'est signalée nulle part : une suite peut passer au
**vert en interrogeant l'application d'une autre branche**. Le vert n'est alors
la preuve de rien, et rien dans la sortie ne le dit.

Ce qui le fermerait, par ordre de coût : `reuseExistingServer: false` (le
serveur appartient à la course, le port occupé devient une erreur franche) ;
ou un port dérivé du worktree ; ou une sonde d'identité de build interrogée
avant la première assertion, qui échoue si le serveur n'est pas celui que la
course a démarré. Constat porté ici parce que la revue devait mesurer dessus,
et non parce que s12 l'a introduit — s12 n'y ajoute que des variables
d'environnement.

### N6 — minor — Un fait faux consigné dans `e2e/oauth.spec.ts`

Ligne 65 : « L'en-tête `Origin` est celui qu'un navigateur envoie : la
bibliothèque refuse en 403 une demande qui n'en porte pas, et c'est une bonne
chose. » Mesuré par exécution (sonde temporaire, retirée) sur
`/api/modules/auth/sign-in/social` avec le fournisseur GitHub configuré :

- `Origin: https://evil.test` → **302** vers `https://github.com/login/oauth/authorize`, cookie d'état posé ;
- aucun en-tête `Origin` → **302**, idem.

La bibliothèque ne refuse ni l'un ni l'autre. Le test ne passe pas *grâce* à
cette garde, il passe parce qu'il fournit l'en-tête. Conséquence réelle : un
site tiers peut déclencher le début d'un parcours de connexion dans le
navigateur d'une victime (login CSRF). La variante dangereuse — faire atterrir
la victime dans le compte de l'attaquant — reste fermée par la liaison de
l'état au cookie, et c'est mesuré (« état d'un autre navigateur » est rouge
sans elle). Le constat porte donc sur le fait consigné, pas sur une brèche
ouverte. `docs/security.md` ne pose pas de règle CSRF.

### N7 — minor — La déviation sur le 404 des rappels : arbitrage défendable, troisième option non explorée

Le plan annonçait « 404 identique à un chemin non déclaré » ; l'amendement fait
céder la propriété sur les rappels parce que `e2e/modules.spec.ts:36` itère sur
**toutes** les routes publiques GET du registre et exige qu'aucune ne rende 404.
Vérifié : avec la configuration Playwright (drapeau local, aucune clé
Google/GitHub), un 404 conditionné par la configuration fait bien rougir cette
garde. L'arbitrage — ne pas relâcher une garde de montage pour tenir une
propriété que la story ne demande pas, `auth` étant socle — est raisonnable, et
il est écrit là où il se lit.

Trois réserves, à l'arbitrage du propriétaire :

1. Une troisième voie existait et n'est pas discutée : construire
   `oauthCallbacks` depuis la liste des fournisseurs **configurés** plutôt que
   depuis la constante `OAUTH_CALLBACK_PROVIDERS`. Le point de composition
   résout déjà `resolveOAuthConfig(env)` avant de monter le registre : une
   route non déclarée n'est alors 404 ni par condition ni par exception, et la
   garde de montage reste intacte.
2. Le fait n°4 de la recherche — « un chemin par fournisseur, ce qui **ferme
   l'énumération de fournisseurs non configurés** » — est contredit par le
   diff. `/api/modules/auth/callback/github` rend 302 quand GitHub n'est pas
   configuré, `/callback/invente` rend 404 : les identifiants connus du code
   sont énumérables. Information publique dans un boilerplate, impact faible,
   mais la recherche affirme le contraire et personne ne l'a corrigée.
3. Asymétrie assumée mais fragile : `/sign-in/social` garde le 404 exact,
   les rappels non, et `/auth/local-provider/authorize` garde un 404
   **conditionné par la configuration** qui ne reste vert que parce que
   `playwright.config.ts` pose le drapeau. Le commentaire le dit ; c'est un
   test dont le résultat dépend d'une variable d'environnement de la
   configuration de test.

### N8 — minor — La rotation de session est plus étroite que le nom de son test

Le test « fait tourner l'identifiant de session : le retour du fournisseur est
une élévation de privilège » n'assertit qu'une chose : le nouveau cookie diffère
de l'ancien. Sonde temporaire (retirée) : après le retour OAuth, **l'ancienne
session résout toujours côté serveur** (`resolveSession` rend `{userId, roles}`).

Ce n'est pas un défaut : Better Auth ne crée pas de session avant
authentification, il n'y a donc rien à fixer, et garder les sessions des autres
appareils est le comportement attendu (s07 en fournit la liste et la
révocation). Mais `docs/security.md` §2 dit « rotation de l'identifiant à
l'élévation de privilège », et ce qui est mesuré est « un identifiant neuf est
émis », pas « l'ancien ne vaut plus ». À écrire dans le test, ou à laisser —
c'est un choix, pas un oubli à corriger en silence.

### N9 — minor — Une clé i18n construite par concaténation, que le fichier voisin s'interdit

`apps/web/app/account/connection-list.tsx` : `const key = \`app.auth.oauth.provider.${providerId}\``,
avec repli `t.has(key)`. `apps/web/app/oauth-buttons.tsx` écrit ses clés en
toutes lettres et explique pourquoi trente lignes plus haut : « une clé
construite par concaténation échappe au contrôle qui vérifie que chaque clé
citée existe dans **chaque** locale ». Les deux catalogues sont complets et
symétriques aujourd'hui (7 clés `provider.*` de part et d'autre, `credential` et
`unknown` compris) ; le repli évite le crash. La règle est simplement appliquée
à un endroit et pas à l'autre.

### N10 — minor — Le filet des textes en dur s'élargit d'un cran

`tests/rendered-text.test.ts` ajoute `role` à `TECHNICAL_PROPS`. Avec
`PROSE = /[À-ÿ]|\p{L}{2,}[  ]+\p{L}{2,}/u`, un **mot unique
non accentué** placé dans un `role` échappe désormais au filet ; une phrase y
est toujours attrapée. Justifié (`Alert` demande `role="alert"` à son appelant)
et étroit, mais c'est un assouplissement d'une garde, consigné ici pour qu'il ne
se relise pas comme neutre.

## Ce qui a été vérifié et tient

- **Les six critères de la story.** Boutons conditionnés à la configuration
  (aucun fournisseur ⇒ le composant ne rend rien, séparateur compris) ;
  création avec l'adresse attestée ; liaison au compte mot de passe **vérifié**
  au lieu d'un second compte ; refus d'autorisation ramenant à `/sign-in` sans
  session et en deux messages ; fournisseurs liés visibles et déliables sauf le
  dernier. Le sixième — « module non activé » — est réinterprété par la
  recherche et le plan (`auth` est socle, ADR 021), et la réinterprétation est
  écrite avant la première ligne de code : c'est la bonne manière de dévier.
- **Les imports et les API appelées** ont été ouverts un par un dans le paquet
  installé : `user.validateUserInfo` et sa signature `{user, source}`,
  `assertValidUserInfo` qui échoue fermé, `account.accountLinking.*`,
  `advanced.cookies.state.attributes`, `onAPIError.errorURL`, `genericOAuth`
  et ses crochets `getToken`/`getUserInfo`, `redirectOnError`, `parseState`.
  Rien d'inventé.
- **La casse et l'unicode de l'adresse** : `link-account.mjs` appelle
  `findUserByEmail(userInfo.email.toLowerCase())` et écrit
  `email: userInfo.email.toLowerCase()` ; le module normalise déjà en
  minuscules à l'inscription. Les deux côtés convergent, aucun second compte
  ne peut naître d'une différence de casse.
- **Aucun code de la bibliothèque n'atteint le message ni le paramètre lu par
  l'écran** : M7 le prouve (3 rouges), et l'écran **relit** la classe au lieu
  de reclasser un code. Sonde : le refus « adresse non attestée » sort en
  `302 → /api/modules/auth/oauth-error?error=oauth_email_not_asserted`, code
  **nôtre**, replié ensuite en `/sign-in?oauth=failed` — aucun
  `account_not_linked` ni `email_not_found` dans l'URL finale.
- **PKCE et anti-rejeu** : `code_challenge_method=S256` sur l'URL
  d'autorisation, vérificateur jamais sorti du serveur, état lié au navigateur
  par cookie signé, et les trois cas — état absent, état d'un autre navigateur,
  état rejoué — sont rouges quand la propriété tombe.
- **Redirection ouverte** : fermée deux fois, et les deux mordent (M8 côté
  route, M13 côté page de rebond). `callbackURL` et `errorCallbackURL` sont
  imposés par le serveur ; M10 prouve que le corps du client n'atteint pas la
  bibliothèque, `idToken` compris.
- **404 et jamais 403** sur le moyen de connexion d'autrui, avec la même
  réponse qu'un identifiant inventé (M9).
- **Course au déliement** fermée par transaction + `SELECT … FOR UPDATE`, et
  M6 la rouvre : `docs/reliability.md` §1 « jamais une simple vérification
  préalable » est tenu par une exécution, pas par un commentaire.
- **Interdits de la course respectés** : ni `docs/STATE.md`, ni
  `config/features.ts`, ni `generated/`, ni migration, ni module créé, ni
  `process.env` dans le module, ni `@repo/db` importé par lui. Un seul fichier
  de test nouveau (`e2e/oauth.spec.ts`), sous le plafond du plan.
- **Les huit tâches du plan** sont présentes dans le diff, et le diff ne
  contient rien que le plan n'ait demandé, à l'exception des trois lignes de
  `tests/rendered-text.test.ts` et `tests/fixtures/screen-viewer.ts` que la
  tâche 6 implique.

## Ce que je n'ai pas pu vérifier

- **Google n'a jamais été exécuté**, pas une fois. Son `emailVerified` vient
  d'une claim d'ID token vérifiée contre le JWKS du fournisseur : non doublable
  au niveau réseau sans fabriquer des clés. La **décision** de liaison est du
  code commun que j'ai exercé par GitHub, mais l'échange de jeton Google, la
  vérification du JWKS, l'URL de rappel déclarée chez le fournisseur et l'écran
  de consentement ne l'ont pas été. *Geste humain* : une vraie clé de test
  Google, un compte neuf, puis un compte qui possède déjà un compte mot de
  passe **vérifié** à la même adresse — et vérifier qu'il n'y a qu'une ligne
  `auth_user`.
- **GitHub réel non plus.** Seuls trois motifs d'URL ont été servis par une
  doublure de réseau. L'écran d'autorisation, le bouton « Cancel » et le vrai
  retour `error=access_denied` de github.com n'ont jamais tourné. *Geste
  humain* : refuser l'autorisation sur l'écran GitHub et vérifier l'atterrissage
  sur `/sign-in?oauth=denied`, sans cookie de session.
- **Un seul navigateur, une seule origine.** Tout le parcours inter-sites est
  mesuré dans Chromium, sur `http://localhost:3100`. `Secure` est asserté mais
  localhost est traité comme origine sûre : la propriété n'a jamais franchi une
  vraie frontière TLS. Les politiques de cookies de Safari et de Firefox, et
  une CSP de production face au `meta http-equiv="refresh"` du rebond, ne sont
  pas exercées. *Geste humain* : le parcours complet sur le déploiement de
  prévisualisation, dans Safari **et** Firefox, en regardant que la destination
  s'affiche connectée.
- **Le temps de réponse du parcours OAuth n'est pas mesuré.** s07 a un harnais
  de médiane pour le couple mot de passe ; il n'a pas été étendu ici. J'ai
  raisonné qu'un appelant anonyme ne peut atteindre le code qui décide sans un
  code d'autorisation du fournisseur, donc qu'il n'y a pas d'oracle accessible
  — mais je ne l'ai pas chronométré. *Geste humain, ou story* : reprendre le
  harnais de s07 sur `/callback/:id` si s28 en dépend.
- **`pnpm dev`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm ks`** n'ont pas été
  lancés : cette story n'ajoute ni migration ni module, et le brief bornait la
  base à `s12`.
- **Aucune revue visuelle.** `docs/designs/s12-oauth-signin.html` n'a pas été
  ouvert dans un navigateur ni comparé aux écrans rendus.
- Cette liste dit **ce qui a été balayé**, sur les cas nommés ci-dessus. Elle ne
  prétend pas dire ce qui existe.

## Verdict

Le cœur de la story est solide, et il est solide **par mesure** : la double
preuve d'adresse mord aux deux moitiés (M1, M2, M5), le rebond same-site est
exactement ce que le plan annonçait et il est rouge sans lui (M12), le cookie
d'état en `Lax` est un choix documenté par le socle et prouvé dans le bocal du
navigateur (M11), la course au déliement est fermée sous verrou (M6), et aucun
code de la bibliothèque n'atteint le visiteur (M7). Onze mutations sur treize
font rougir ce que leur nom promet ; les deux vertes sont expliquées, et
l'explication écrite est fausse (N3) sans que le filet le soit.

Ce qui bloque n'est pas la liaison de compte : c'est que la story ouvre les
premiers appels sortants du module sans aucun délai d'attente, sur une règle du
socle de fiabilité qui ne souffre pas d'exception et que le plan n'a jamais
nommée.

## Clôture — après le tour de correction (`711c069`)

Second commit sur la même branche, tour de correction demandé par le
propriétaire. Toutes les commandes rejouées sur la configuration **committée**,
port 3100 vérifié libre par `lsof -i :3100` avant Playwright.

| Commande | Résultat |
|---|---|
| `pnpm typecheck` | vert (14 tâches) |
| `pnpm lint --max-warnings=0` | vert |
| `pnpm test` | 737 passés, 2 ignorés, 26 fichiers (720 avant) |
| `pnpm test:e2e` | 32 passés |
| `pnpm build` | vert |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert |
| `git status` après build | propre, hors ce rapport |

### Mutations du tour de correction, chacune restaurée immédiatement

| # | Ce qui a été neutralisé | Fichier | Rouges |
|---|---|---|---|
| C1 | `isTransientOutboundFailure` rend toujours `true` | `domain/outbound.ts` | **1** |
| C2 | échéance retirée de `handleOAuthCallback` | `infrastructure/better-auth-service.ts` | **1** (le cas pend jusqu'au délai Vitest) |
| C3 | délai **et** reprises retirés de la porte réseau | `infrastructure/oauth-outbound.ts` | **2** |
| C4 | sélecteur `fetch` retiré du bloc de lint des modules | `eslint.config.ts` | **3** |
| C5 | garde `NODE_ENV === 'production'` neutralisée | `apps/web/lib/oauth-config.ts` | **2** (la règle, et le témoin de démarrage) |
| C6 | journal retiré du rappel de fournisseur | `presentation/auth-routes.ts` | **1** |
| C7 | journal retiré de `/magic-link/verify` | idem | **1** |
| C8 | les deux journaux `auth.oauth_refused` retirés | idem | **1** |
| C9 | `trustedProviders: ['github']` **seule** | `infrastructure/better-auth-service.ts` | **0** — re-mesuré pour N3 |
| C10 | C9 **et** `oauthProvisioningRefusal` rendue permissive | les deux | **2** |

Deux sondes temporaires, retirées et vérifiées retirées :

- **origine de `/sign-in/social`** — `Origin` du site, `Origin: https://evil.test`
  et **aucun** `Origin` rendent tous les trois `302` vers
  `github.com/login/oauth/authorize` avec un cookie d'état. Le fait consigné
  ligne 65 d'`e2e/oauth.spec.ts` était faux ; il est remplacé par cette mesure ;
- **rotation de session** — après le retour du fournisseur, l'ancienne session
  résout encore (`{userId, roles}`). Confirmé.

### Constat par constat

**N1 — critical — délais d'attente. Fermé.**
Deux bornes, parce qu'une seule ne couvre pas tout :

- **par appel** (`infrastructure/oauth-outbound.ts`) : `AbortSignal.timeout`
  *et* une course, délai explicite, reprises en recul exponentiel avec
  dispersion et plafond, sur les **seules** erreurs transitoires — un refus 4xx
  du fournisseur est définitif, le rejouer serait le défaut que
  `docs/reliability.md` §3 nomme. Elle couvre les deux lectures de profil de
  GitHub, reprises par `options.getUserInfo` (`social-providers/github.mjs`
  consulte ce crochet avant ses deux `betterFetch`) ;
- **par requête entrante** : une échéance autour de `auth.handler` sur les
  routes de rappel, qui rend le refus générique du module. Elle couvre ce qui
  n'a **pas** de crochet — l'échange de code de GitHub
  (`validateAuthorizationCode` ne lit aucune option) et la vérification d'ID
  token de Google, faite par `jose` avec son propre `fetch`. Reprendre le
  `getUserInfo` de Google reviendrait à réécrire une vérification de signature :
  non fait, et dit.

Preuve : C2 et C3. **Et la partie qui compte pour la suite** : `pnpm lint`
refuse désormais un `fetch` écrit ailleurs que dans cette porte
(`no-restricted-syntax` sur `packages/modules/**`, exception nommée pour
`*/src/infrastructure/oauth-outbound.ts`). C4 le prouve : sans le sélecteur,
3 cas de `tests/lint-rules.test.ts` rougissent. Un appel sortant ajouté plus
tard sans délai fait donc échouer une commande, il n'échappe pas à une note.

Prix payé, écrit dans `infrastructure/github-user-info.ts` : reprendre
`getUserInfo` oblige à **recopier** la dérivation d'`emailVerified` de la
bibliothèque 1.7.2, dont dépend l'ADR 023. Elle est exercée par les parcours
existants (création attestée, refus non attesté, liaison), et une montée de
version doit rouvrir ce fichier.

**N2 — major — journalisation. Fermé, et un peu plus.**
Les trois rappels journalisent `auth.sign_in_succeeded` avec l'acteur ou
`auth.sign_in_failed` sans acteur, détail `{provider, method}`.
`/sign-in/social` et `/auth/oauth-error` journalisent `auth.oauth_refused` —
**un nom à part**, et c'est délibéré : un retour refusé journalise déjà l'échec
de connexion au rappel, et compter les deux doublerait chaque occurrence pour
le verrouillage progressif de s28.

Le même utilitaire rend `/magic-link/verify` couvert en une ligne : **fait**,
et c'est une lacune antérieure à s12 qui se ferme au passage (C7). Aucun secret
n'entre dans le journal : le cas assertit l'absence du jeton d'accès du
fournisseur **et** de l'adresse en clair, et l'acteur reste un identifiant.
Preuves : C6, C7, C8.

**N3 — major — cause fausse consignée. Fermé, aux trois endroits.**
Re-mesuré ici plutôt que repris : C9 rend 0 rouge, C10 en rend 2 — les deux
filets sont donc **indépendants et chacun suffisant**. Et dans le paquet
installé, la porte de `oauth2/link-account.mjs` (ligne ~83) s'évalue **avant**
`assertValidUserInfo` (ligne ~92) : le crochet refuse **plus tard**, pas plus
tôt. `allowDifferentEmails`, lui, n'est lu qu'en `api/routes/callback.mjs:177`
(branche `link` de l'état) et `api/routes/account.mjs:213` (`/link-social`),
tous deux non déclarés : la mutation est verte parce que le chemin est
**injoignable**, et le crochet ne voit jamais ce cas.

Corrigé dans `docs/decisions/023-liaison-de-compte-oauth.md` **en place**, dans
`packages/modules/auth/AGENTS.md` et dans le commentaire de
`better-auth-service.ts`. La correction en place est justifiée dans l'ADR et
dans le message de commit : l'immuabilité d'un ADR accepté porte sur sa
**décision**, inchangée ; une affirmation de fait mesurée fausse est un défaut,
et la superséder laisserait la version fausse comme référence courante d'une
décision encore valide.

**N4 — major — `OAUTH_LOCAL_PROVIDER` en production. Fermé.**
`resolveOAuthConfig` refuse le démarrage quand le drapeau est posé sous
`NODE_ENV=production`, en nommant la variable et en disant quoi faire. La règle
du socle tient : `NODE_ENV` n'**arme** jamais le drapeau, il le **restreint** ;
le drapeau reste l'unique opt-in. Éprouvé à la règle et par un témoin de refus
au démarrage ; C5 fait rougir les deux. `.env.example`, le schéma
d'environnement et l'`AGENTS.md` de l'application portent l'avertissement.

**N5 — minor — `reuseExistingServer`. Laissé ouvert, hors périmètre.**
`playwright.config.ts` était interdit à ce tour : le sujet est traité sur `dev`
après fusion des deux voies. Le risque reste réel et il est nommé ici.

**N6 — minor — fait faux dans `e2e/oauth.spec.ts`. Fermé par correction.**
La mesure ci-dessus remplace l'affirmation : l'en-tête est fourni pour
ressembler à un vrai formulaire, pas parce qu'une garde l'exigerait. La variante
dangereuse — atterrir dans le compte de l'attaquant — reste fermée par la
liaison de l'état au cookie, ce que `tests/auth.test.ts` tient déjà. La rendre
« vraie » (refuser une origine tierce) serait une story : `docs/security.md` ne
pose pas de règle CSRF, et l'ajouter changerait le comportement d'un formulaire
sans JavaScript.

**N7 — minor — la troisième voie. Non faite, et voici la mesure.**
Le propriétaire a demandé de construire les rappels depuis les fournisseurs
configurés. Mesuré, ce n'est pas réalisable sous les interdits de ce tour :

1. `authModule.routes` est **matérialisé à l'import** de `config/features.ts`
   — fichier interdit à ce tour —, donc aussi par `pnpm ks`, `pnpm db:generate`
   et le processus node de Playwright, dont aucun n'a l'environnement validé de
   l'application. Le contrat de module déclare `routes` comme une liste, pas
   comme une fonction ;
2. faire dépendre le registre de l'environnement diverge entre les deux
   processus : `webServer.env` de `playwright.config.ts` — fichier également
   interdit — ne s'applique qu'au serveur. Vérifié : `.env` ne contient aucune
   variable OAuth, et un processus node lancé depuis le même shell voit
   `OAUTH_LOCAL_PROVIDER` à `undefined`. Le registre côté Playwright perdrait
   donc les trois rappels **et** `/auth/local-provider/authorize`, et
   `e2e/modules.spec.ts:36` cesserait de les vérifier — vert, et plus faible.
   C'est exactement la « face silencieuse » que N5 décrit.

Ce qui a été fait à la place, et qui est éprouvé : la propriété réellement
tenue est écrite et pinée — le rappel d'un fournisseur **non configuré** rend
statut et destination **identiques** au rappel configuré recevant un état
inutilisable, donc l'état de configuration ne se lit pas de l'extérieur. Ce qui
reste énumérable est la liste des identifiants que le code connaît
(`/callback/github` a un chemin, `/callback/invente` non). Le fait n°4 de
`docs/research/s12-oauth-signin.md` est corrigé pour dire cela, avec la mesure ;
le commentaire de la route aussi.

**N8 — minor — rotation de session. Fermé par le nom, pas par le test.**
Le propriétaire préférait « le test tient ce que le nom dit ». Mesuré, ce n'est
pas atteignable : le cookie de session est `SameSite=Strict`, donc il **n'est
pas envoyé** sur le rappel, qui est une navigation inter-sites — c'est la raison
d'être du rebond de `/oauth/return`. Le serveur ne connaît pas l'ancien
identifiant au moment où il en émet un neuf ; le révoquer ne serait vert que
dans un test de nœud qui, lui, fournit le cookie, et inerte en production. Le
cas s'appelle donc désormais « émet un identifiant de session neuf au retour, et
remplace le cookie du navigateur », et il tient exactement cela : identifiant
neuf, **même nom de cookie** — le navigateur remplace au lieu de garder deux
valeurs —, session résolue sur le bon compte. Le résidu (l'ancienne session
résout encore côté serveur, révocable par la liste de s07) est écrit dans le
test.

**N9 — minor — clé i18n concaténée. Fermé.**
`connection-list.tsx` écrit ses cinq clés en toutes lettres, comme
`oauth-buttons.tsx` : elles entrent donc dans le balayage statique de
`tests/i18n.test.ts`, et le repli `t.has` disparaît. En retirer une d'un
catalogue fait rougir.

**N10 — minor — `role` dans `TECHNICAL_PROPS`. Laissé tel quel, et consigné.**
L'assouplissement est justifié et étroit ; il reste écrit dans le rapport pour
ne pas se relire comme neutre.

### Ce qui n'a pas changé depuis le premier rapport

Les recettes manuelles restent dues, à l'identique : Google jamais exécuté,
GitHub réel jamais exécuté, un seul navigateur et une seule origine, temps de
réponse du parcours non chronométré, aucune revue visuelle. La liste dit ce qui
a été balayé, pas ce qui existe.

### Verdict après correction

Le constat bloquant est fermé, et il l'est **par mesure** : la borne par appel
et l'échéance du rappel font rougir ce que leur nom promet, et — ce qui compte
davantage — la règle a maintenant une commande qui échoue quand on la casse,
au lieu d'une conformité vraie à un instant. Les trois majeurs sont fermés, les
trois mineurs traitables aussi. Restent ouverts, nommés et hors périmètre de ce
tour : N5 (`playwright.config.ts`, à traiter sur `dev`), N7 (non réalisable sous
les interdits, propriété de repli éprouvée et documentation corrigée), N10
(consigné).

Max severity: minor
Ship allowed: yes
