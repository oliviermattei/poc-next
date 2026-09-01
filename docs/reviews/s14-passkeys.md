# Revue anti-hallucination — s14-passkeys

Branche `feature/s14-passkeys`, commit unique `0c988a5`, base `dev` au point de
départ `df3806f`. Diff jugé : `git diff dev...feature/s14-passkeys`.
Worktree `.claude/worktrees/agent-a684686c5a05d43a1`, base PostgreSQL `s14`,
port de parcours `3114`.

Tout ce qui suit a été **exécuté**. Quand une affirmation vient d'une lecture de
source et non d'une exécution, c'est écrit. Les listes disent ce qui a été
balayé, jamais ce qui existe.

---

## 1. Ce qui a été exécuté

| Commande | Configuration « tous » | Configuration « socle » |
|---|---|---|
| `pnpm typecheck` | vert | vert |
| `pnpm lint --max-warnings=0` | vert | vert |
| `pnpm test` | **1122 passés**, 2 ignorés, 33 fichiers | **1122 passés**, 2 ignorés |
| `E2E_PORT=3114 pnpm test:e2e` | **60 passés**, 5 ignorés | **48 passés**, 17 ignorés |
| `pnpm build` | vert | vert |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert | — |
| `pnpm db:migrate` ×2 | « Rien à appliquer » au second | vert |
| `pnpm db:generate` | « No schema changes » | — |

La configuration « socle » a été obtenue par `pnpm ks toggle marketing`,
`organizations`, `i18n`, puis **restaurée par les trois bascules inverses** ;
`git diff --exit-code` vérifié vide après restauration. Les **deux** parcours de
`e2e/passkeys.spec.ts` s'exécutent et passent dans les deux configurations —
vérifié par nom dans le journal, et non déduit du total.

`describe.skipIf(!databaseReachable)` n'a rien masqué : `tests/auth.test.ts`
rapporte **100 cas passés**, les 26 cas de passkey compris.

---

## 2. Les mutations posées, et les cas rouges comptés

Chacune restaurée **dans la commande qui la pose**, `git diff --exit-code`
vérifié sur le fichier avant de passer à la suivante. Arbre final propre, HEAD
sur `0c988a5`.

| # | Ce qui a été neutralisé | Rouges | Cas nommés |
|---|---|---|---|
| 1 | `origin: options.appUrl` retiré du greffon | **1** | « refuse une assertion produite pour une autre origine » |
| 2 | `rpID` **retiré** entièrement | **0** | annoncé par le plan — voir §3 |
| 3 | `rpID: 'evil.test'` | **17** | toutes les cérémonies |
| 4 | `/passkey/verify-authentication` **exempté** du crochet de second facteur | **2** | canari `/canari/sign-in` + « défie un compte protégé (ADR 031) » |
| 5 | `/passkey/verify-registration` retiré des exemptions | **1** | « ne déconnecte pas un compte protégé qui enregistre une passkey » |
| 6 | garde du second facteur repassée en **liste d'inclusion** (échoue ouvert) | **1** | canari `/canari/sign-in` |
| 7 | `canUnlinkSignInMethod` désarmé sur le chemin passkey | **1** | « compte les passkeys **et** les comptes » |
| 8 | `total` ne comptant que les passkeys | **5** | dont **2 cas de s12** |
| 9 | les deux `FOR UPDATE` de `lockSignInMethods` retirés (3 exécutions) | **2 / 2 / 1** | les deux cas de concurrence, dont celui de s14 **3 fois sur 3** |
| 10 | `userId` retiré de la condition du renommage | **1** | « renomme la sienne, et répond 404 pour celle d'un autre » |
| 11 | refus de la bibliothèque relayé à la connexion par passkey | **4** | dont « rend le même refus à un justificatif inconnu et à une signature fausse » |
| 12 | révocation de l'ancienne session désarmée à l'enrôlement | **2** | rotation + « n'écoute pas le `createSession` du client » |
| 13 | réponse de la bibliothèque relayée à l'enrôlement | **1** | « ne rend ni jeton ni clé publique » |
| 14 | `/passkey/list-user-passkeys` déclarée en pass-through | **1** | « n'expose pas les trois points d'entrée qu'il ne déclare pas » |
| 15 | `...passkey` étalé dans `describePasskeys` | **1** | « recopie champ par champ » (domaine) |
| 16 | `browserSupportsWebAuthn()` retiré des **deux** écrans | **1** | « sans WebAuthn, l'option disparaît » (parcours) |

Les comptes correspondent à ceux annoncés par le plan sur 8 des 9 mutations
recomparables ; l'écart unique est la mutation 7 (1 rouge mesuré ici contre 2
annoncés — le plan neutralisait vraisemblablement aussi le cas d'usage). L'écart
porte sur le compte, pas sur la propriété : l'invariant mord.

### La mutation 16 est la plus importante des seize

C'est le douzième faux test de ce dépôt, et l'implémenteur l'a trouvé
lui-même : `toHaveCount(0)` passait **avant tout rendu client**, donc restait
vert quelle que soit la garde. Le témoin d'hydratation ajouté (attendre un
bouton **actif** — les boutons d'envoi sont désactivés jusqu'à l'hydratation,
`apps/web/app/use-hydrated.ts`) n'est pas décoratif : **vérifié ici par
neutralisation**, la garde retirée des deux composants rougit maintenant le cas.

**Balayage des autres assertions « avant hydratation ».** Sur les trois
`toHaveCount(0)` de `e2e/passkeys.spec.ts` et les deux ajouts d'`exact: true`,
chaque absence constatée est précédée d'un `toBeEnabled()` sur un contrôle du
même écran. Trouvé sur ce balayage-ci, sur ces cinq assertions ; rien ne dit
qu'il n'en existe pas ailleurs dans `e2e/`.

---

## 3. Le point 1 : ce que le défaut de `rpID` accepte réellement

**Mesuré, pas déduit.** `@better-auth/passkey@1.7.2` :

```js
function getRpID(options, baseURL) {
	return options.rpID || (baseURL ? new URL(baseURL).hostname : "localhost");
}
```

et, aux quatre points d'appel (lignes 168, 277, 354, 476 de `dist/index.mjs`),
`baseURL` est `ctx.context.options.baseURL` — **l'option configurée**, jamais un
en-tête.

Le module pose `baseURL: options.appUrl` (`better-auth-service.ts:383`), et
`APP_URL` est validée par Zod au démarrage. Le défaut n'est donc pas « ce que la
bibliothèque devine » : c'est **l'hôte d'une seconde valeur épinglée**. Retirer
`rpID` est strictement neutre — les 0 rouges sont honnêtes et corrects, pas un
trou de couverture.

**Où le défaut deviendrait faux** — mesuré en lisant `better-auth/dist/auth/base.mjs:22-33` :

```js
if (!ctx.options.baseURL) {
  const baseURL = getBaseURL(void 0, basePath, request, void 0, ...trustedProxyHeaders);
  handlerCtx.options = { ...ctx.options, baseURL: getOrigin(baseURL) || void 0 };
}
```

Sans `baseURL` explicite, la bibliothèque le **dérive de la requête** (hôte,
en-têtes de proxy de confiance) et l'écrit dans `ctx.context.options.baseURL` —
donc dans ce que `getRpID` lirait. Le `rpID` deviendrait alors une valeur
d'appelant. **Ce n'est pas l'état de ce dépôt**, et l'y amener demanderait de
retirer `baseURL: options.appUrl`, ce qui casserait aussi `trustedOrigins`, les
liens envoyés par email et les URI de rappel OAuth — ce n'est pas une dérive
plausible, c'est une réécriture.

**Configurations de production plausibles :**

- **sous-domaine** (`APP_URL = https://app.example.com`) : `rpID` vaut
  `app.example.com`. Les passkeys ne valent alors ni pour `example.com` ni pour
  `www.` — c'est un **rétrécissement**, dans le sens fermé (la cérémonie est
  refusée), jamais une session ouverte à tort ;
- **proxy / plateforme de déploiement** : `rpID` suit `APP_URL`, pas l'en-tête
  `Host`. Un proxy qui réécrit `Origin` ne peut pas déplacer l'origine attendue,
  puisqu'elle est posée à `APP_URL` (mutation 1 : c'est la ligne qui mord) ;
- **changement d'hôte d'`APP_URL`** : toute passkey déjà enregistrée cesse de
  fonctionner, sans message ni migration. C'est la seule conséquence
  opérationnelle réelle, et **elle n'est écrite nulle part** (constat M3
  ci-dessous).

**Sévérité du point 1 : aucune sur la sécurité.** Le `rpID` écrit est un défaut
épinglé, comme le dit le plan ; ce qui mord est la vérification du `rpIdHash`,
et elle a ses 17 cas.

---

## 4. Le point 2 : l'ADR 031, vérifié dans le paquet puis mesuré

**L'affirmation, vérifiée dans le paquet installé** —
`node_modules/@better-auth/passkey/dist/index.mjs`, lignes **355** et **483** :
`requireUserVerification: false`, en dur, aux deux vérifications
(enregistrement et authentification). Aucune option du greffon ne l'expose ; les
options générées portent `userVerification: "preferred"`. L'ADR 031 dit vrai.

**La conséquence, mesurée et non lue.** Le cas « défie un compte protégé : une
passkey est un premier facteur (ADR 031) » (`tests/auth.test.ts:3041`) fait,
dans cet ordre : un compte à second facteur actif enregistre une passkey, s'y
connecte, et le test vérifie que la réponse est `{ twoFactor: true }`, qu'**aucun
cookie de session** n'est posé, que le **nombre de lignes de session en base est
inchangé**, puis que le défi posé est **résolvable par un code TOTP** qui, lui,
ouvre la session. Exempter le chemin (mutation 4) rougit ce cas **et** le canari.

La propriété est tenue par la **forme** de la garde, pas par une liste : la
mutation 6 (retour à une liste d'inclusions) rougit le canari `/canari/sign-in`,
une route qui n'existe nulle part.

---

## 5. Le point 3 : la sixième exemption

`'/passkey/verify-registration'`, avec sa raison écrite. Justifiée sur les trois
conditions annoncées, **vérifiées une par une** :

- la route est déclarée `authenticated` (`auth-routes.ts`, `protection: { level:
  'authenticated' }`) — le répartiteur refuse avant la bibliothèque, et le cas
  « refuse l'enrôlement sans session » le mesure (401 sur les deux points
  d'entrée) ;
- le greffon y monte `freshSessionMiddleware` (lu dans `dist/index.mjs`) ;
- le greffon refuse si le compte résolu n'est pas celui de la session
  (`resolveRegistrationUser`, lu lignes 23-33).

Elle ne peut donc pas **ouvrir** une session, seulement faire tourner celle d'un
appelant déjà authentifié. Retirée (mutation 5), le cas qui la justifie rougit.

**Aucune septième n'a été ajoutée** : `TWO_FACTOR_CHALLENGE_EXEMPT_PATHS` compte
exactement six entrées, chacune avec un motif non vide, et le cas « laisse passer
les seuls chemins exemptés » les parcourt toutes. **Route fictive éprouvée** :
`isChallenged('/canari/sign-in')` doit rendre `true` ; la garde repassée en
liste d'inclusion (mutation 6) le rougit. Une voie de connexion qu'aucun humain
n'a encore écrite est donc couverte par défaut.

Six exemptions, c'est **ce qui a été balayé** — les trois points d'entrée du
greffon `two-factor`, les deux rotations appelées par `auth.api.*`, et
l'enrôlement d'une passkey. Rien ne dit qu'un septième chemin n'existe pas
ailleurs dans les bibliothèques.

---

## 6. Le point 4 : le dernier moyen de connexion

**Une seule règle**, `canUnlinkSignInMethod` (`domain/oauth.ts`), inchangée ;
ce sont ses appelants qui comptent désormais `auth_account` **+** `auth_passkey`,
par un unique `lockSignInMethods` partagé entre `unlinkForUser` et
`revokeForUser`. Aucune seconde règle n'a été écrite — vérifié en cherchant
toute autre expression de la règle dans le module : il n'y en a pas.

Trois mesures :

- **compter juste** : `total` ramené aux seules passkeys (mutation 8) rougit
  **5** cas, dont **2 écrits par s12**. Une règle, deux histoires, un seul
  point de rupture ;
- **la course** : les deux `FOR UPDATE` retirés (mutation 9), le cas de
  concurrence de s14 — révocation de la dernière passkey **et** déliement du
  dernier compte lancés ensemble — rougit **3 fois sur 3**, et celui de s12
  2 fois sur 3. La propriété « jamais zéro moyen de connexion » est donc prouvée
  par exécution, pas par un commentaire ;
- **l'ordre des verrous** : `auth_account` puis `auth_passkey` dans les deux
  chemins — lu, identique aux deux appels. Deux retraits croisés ne peuvent pas
  s'interbloquer.

Le refus rend `400 { error: 'last-method' }` à son propriétaire, et `404` pour
la passkey d'autrui (mutation 10 : le propriétaire retiré de la condition du
renommage rougit).

---

## 7. Le point 5 : l'énumération

- **Le point d'entrée d'options ne prend aucun paramètre et ne branche sur
  l'existence d'aucun compte** — lu dans le paquet
  (`generate-authenticate-options` lit la session si elle existe, sinon génère
  des options sans `allowCredentials`). L'écran de connexion n'y attache aucune
  adresse : `PasskeyButton` est rendu sans condition d'adresse. Rien à révéler ;
- **Message et statut** : justificatif inconnu et signature fausse rendent le
  **même** statut et le **même corps** — mesuré par comparaison de
  `response.text()` entre les deux, et rougi (4 cas) quand le refus de la
  bibliothèque est relayé (mutation 11). C'est `SIGN_IN_REFUSAL`, le même que le
  mot de passe ;
- **Le temps** : *non mesuré sur ce chemin* — voir §10. L'analyse : un
  justificatif inconnu sort après une lecture, un justificatif connu après une
  vérification ECDSA P-256. L'écart existe, mais l'identifiant qu'il
  distinguerait est un `credentialID` aléatoire de 16 octets, jamais une
  adresse : **aucun compte n'est énumérable par ce biais**, et rien de ce chemin
  ne prend d'identité fournie par l'appelant.

---

## 8. Le point 6 : la fixture WebAuthn

`tests/fixtures/webauthn.ts` **ne valide rien**. Lu ligne à ligne : elle encode
du CBOR, fabrique un `authenticatorData`, signe avec `createSign('sha256')`, et
ne comporte **aucune branche de refus** — elle signe ce qu'on lui demande, y
compris un `rpId` étranger, une origine étrangère et un compteur qu'on lui
impose. C'est un authentificateur, pas un vérificateur.

**Et c'est prouvé, pas seulement lu** : la mutation 1 retire l'`origin` explicite
**côté serveur**, et la même assertion forgée — inchangée — passe alors de
refusée à acceptée. Le refus venait donc du vrai `@simplewebauthn/server`, pas
de la doublure. C'est exactement le piège de s11, et il n'est pas là.

Ce que la fixture ne prouve pas est écrit dans le fichier lui-même et repris
en §10.

---

## 9. Le point 7 (compteur), le point 8 (les trois fichiers e2e), et le reste

**Le compteur.** Le code fait ce que la story dit qu'il fait :
`@simplewebauthn/server@13.3.3` saute la comparaison quand les deux compteurs
valent zéro (`(counter > 0 || credential.counter > 0) && counter <= credential.counter`,
lu dans `esm/authentication/verifyAuthenticationResponse.js`). Les deux branches
ont leur cas — une assertion à compteur non progressé refusée, une assertion à
compteur nul **acceptée deux fois**, avec le commentaire qui dit pourquoi. La
limite est écrite à **trois** endroits où on la lira : `src/schema.ts` (sur la
colonne), `packages/modules/auth/AGENTS.md` (section s14), et le cas de test
lui-même. Aucune phrase du dépôt ne prétend que le clonage est détecté.

**Les trois fichiers e2e modifiés.** Les cinq modifications sont le **même**
resserrement, `{ name: 'Se connecter' }` → `{ name: 'Se connecter', exact: true }` :
`e2e/app-shell.spec.ts` (1, sur un `toBeDisabled`), `e2e/auth.spec.ts` (4 clics),
`e2e/support/account.ts` (1 clic, qui sert **tous** les parcours). Motif réel et
vérifié : l'écran porte désormais « Se connecter » et « Se connecter avec une
passkey ». **Aucune attente n'a été relâchée** — aucun `timeout` allongé, aucun
`toBeVisible` remplacé par un `toHaveCount`, aucun `expect` supprimé : diff des
trois fichiers lu en entier, 5 lignes changées sur 5.

**Diff contre plan, tâche par tâche.** Les 14 tâches sont présentes et cochées ;
chacune a été retrouvée dans le diff. Aucune ligne du diff n'est étrangère au
plan. Les trois déviations sont **déclarées dans le plan** et vérifiées ici :
interface conditionnelle non livrée (décision 7), `generated/schema/auth.ts`
régénéré (décision 8, une ligne d'export), `exportAccount` non touché
(décision 9). Le plan porte `validated: yes`.

**Socles.** `docs/security.md` §2 (rotation prouvée, ancienne session morte),
§3 (404 jamais 403, compte pris dans la session), §4 (Zod aux frontières,
origine en liste blanche), §5 (aucun jeton ni clé publique dans un corps),
§7 (refus unique). `docs/reliability.md` §1 (concurrence prouvée, migration
rejouée), §2 (aucune clé de fournisseur : la vérification est locale — balayé,
aucun `fetch` dans le greffon ni dans `@simplewebauthn/server`), §4 (migration
additive). ADR 018 (clé étrangère interne au module), ADR 021, ADR 025,
ADR 013 (aucune revendication d'exhaustivité dans le nouveau texte
d'`AGENTS.md` : « trouvé sur ce balayage-ci »). **Aucune contradiction trouvée
sur ce balayage.**

**Vérification visuelle**, refaite au navigateur par moi (Chromium, `fr-FR`,
authentificateur virtuel CDP, serveur sur le port 3116) : `/account` et
`/sign-in`, **clair et sombre — ce dernier par le vrai commutateur de
l'application**, à 1280 px et 390 px. Débordement horizontal
(`scrollWidth - clientWidth`) : **0 px sur les huit rendus**, plus l'état
« renommage en cours » à 390 px. La carte des passkeys est cohérente avec les
autres cartes de l'écran : le bouton « Enregistrer une passkey » est à sa taille
(le défaut corrigé par l'implémenteur ne s'est pas reproduit), la ligne porte
nom + date + Renommer/Révoquer, l'état vide et l'état « dernier moyen » rendent
ce que le design décrit.

---

## 10. Ce que je n'ai pas pu vérifier

- **aucun authentificateur réel** : ni Touch ID, ni clé de sécurité, ni
  gestionnaire de mots de passe. Tout passe par la doublure de nœud ou par
  l'authentificateur virtuel de Chrome. *Geste humain* : enregistrer une passkey
  avec Touch ID et une clé USB, sur un vrai domaine, et se reconnecter ;
- **un seul navigateur** (Chromium), **une seule origine** (`localhost`), **un
  seul `rpId`**. Le comportement sur un vrai domaine, un sous-domaine, ou
  derrière un proxy qui réécrit `Origin`, n'est pas mesuré. *Geste humain* :
  déployer sur un `APP_URL` réel et refaire les deux cérémonies ;
- **le temps de réponse** de `/passkey/verify-authentication` : aucun cas
  chronométré, là où `/sign-in/email` et le mot de passe oublié en ont un.
  L'écart existe (lecture seule contre vérification ECDSA), mais il ne
  distingue que des `credentialID` aléatoires — voir §7 ;
- **l'annulation de l'enrôlement** (critère 5 de la story) : le chemin
  `cancelled` du composant n'est exercé par **aucun** test, ni de nœud ni de
  navigateur. La moitié « sans créer d'entrée orpheline » est tenue par la forme
  du parcours (aucune requête ne part) ; la moitié « affiche un message clair »
  n'est pas mesurée. *Geste humain* : cliquer « Enregistrer une passkey » puis
  fermer la fenêtre du système, et lire le message ;
- **la purge d'un compte muni d'une passkey** : la cascade est déclarée dans le
  schéma et dans le SQL de `0003_same_puck.sql`, donc tenue par PostgreSQL, mais
  **aucun test n'exécute `purgeAccount`** — voir M2 ;
- **la synchronisation multi-appareils** d'une passkey (iCloud, Google) : hors
  d'atteinte de ce dépôt, et c'est la population pour laquelle le compteur ne
  protège rien ;
- **la limitation de débit** : `/passkey/generate-authenticate-options` et
  `/passkey/verify-authentication` sont publics et sans compteur. C'est la même
  classe que les points d'entrée publics à jeton déjà en place (magic link, mot
  de passe oublié), et `docs/stories.md` attribue nommément la limitation
  partagée à **s28**. Non tenu contre cette story ; à rouvrir en s28 en
  n'oubliant pas ces deux chemins.

---

## 11. Constats

### Majeur

*(aucun)*

### Mineur

- **M1 — `credentialID` sort par le point d'entrée d'options, pour le compte
  appelant.** Le module a pour discipline explicite que `credentialID` ne quitte
  jamais le serveur (`describePasskeys` le retire, `list-user-passkeys` n'est pas
  déclarée pour cette raison) — mais `/passkey/generate-authenticate-options`,
  déclarée **publique** et traversée avec les cookies, rend `allowCredentials`
  contenant les `credentialID` du compte quand une session existe (lu dans
  `dist/index.mjs`, lignes 264-283 : le greffon les charge par
  `session.user.id`). Aucune fuite inter-comptes, et WebAuthn en a besoin pour
  les clés non découvrables : l'impact est nul. Mais l'énoncé d'`AGENTS.md` est
  plus absolu que le code. Une phrase à ajouter, pas une ligne à changer.
- **M2 — le plan écrit « la purge […] est tenue par la cascade et *mesurée* ».**
  Elle ne l'est pas : aucun test de ce dépôt n'appelle `purgeAccount`, ni pour
  `auth` avant cette story, ni après. La propriété tient (la cascade est dans le
  SQL appliqué), la **mesure** n'existe pas. Dans un dépôt qui range « une règle
  sans commande est de la documentation » parmi ses règles, l'écart mérite d'être
  nommé.
- **M3 — la conséquence opérationnelle du `rpID` n'est écrite nulle part.**
  `AGENTS.md` explique que `rpID` est un défaut épinglé ; il ne dit pas que
  **changer l'hôte d'`APP_URL` invalide toutes les passkeys déjà enregistrées**,
  sans message ni migration possible. C'est la seule surprise de production que
  cette story installe, et c'est une ligne à ajouter là où on la lira.
- **M4 — l'écran de connexion juxtapose un bouton stylé et un formulaire nu.**
  Vérifié au navigateur, sonde DOM à l'appui : sur `/sign-in`, les deux boutons
  de la famille `@repo/ui` mesurent 896×40 px, tandis que les champs du
  formulaire de mot de passe sont des `<input>` natifs de 170×20 px et le `<h1>`
  est rendu à 14 px. **Ce n'est pas une régression de s14** : `apps/web/app/auth-form.tsx`
  n'utilise aucun composant du design system (`<label>`, `<input>`, `<button>`
  bruts, lignes 144-155), et `/sign-up` comme `/forgot-password` — que cette
  story ne touche pas — présentent exactement le même rendu. Le bouton stylé
  arrivé en s12 puis celui de s14 rendent seulement l'écart voyant. À traiter
  hors de cette story ; à ne pas lire comme un défaut de celle-ci.

---

## 12. Ce que la fusion avec `dev` exposera

`dev` a avancé de quatre commits depuis la base de cette branche (`df3806f`) :
s17 y est fusionnée. Fusion à blanc, sans toucher à l'arbre
(`git merge-tree --write-tree dev feature/s14-passkeys`) :

- **un conflit réel**, `tests/fixtures/screen-viewer.ts` : s14 y ajoute
  `FIXTURE_PASSKEYS` / `FIXTURE_PASSKEY_NAME`, s17 y ajoute ses propres
  fixtures, au même endroit du fichier. Résolution mécanique — les deux blocs
  coexistent — mais elle doit être faite à la main ;
- `tests/rendered-text.test.ts` **s'auto-fusionne** : les deux stories y
  touchent des entrées d'écran différentes ;
- aucun autre recouvrement : s17 travaille dans `packages/modules/organizations`,
  `eslint.config.ts` et `e2e/organizations.spec.ts`, que s14 ne touche pas.

Après résolution, `pnpm test` et `pnpm test:e2e` doivent être rejoués **dans les
deux configurations de modules** : la fixture partagée alimente l'écran de
compte que les deux stories modifient.

---

## 13. Verdict

Seize invariants neutralisés, quinze rouges, un vert **annoncé et instruit**.
Les trois propriétés qui décident de la story — une passkey ne dispense pas du
second facteur, l'origine attendue ne vient pas de l'appelant, le dernier moyen
de connexion ne peut pas disparaître même sous concurrence — sont tenues par du
code et prouvées par des cas qui rougissent quand on les désarme. Le douzième
faux test du dépôt a été trouvé par l'implémenteur, corrigé, et sa correction
est vérifiée ici par mutation. Les quatre constats sont mineurs, et l'un d'eux
(M4) n'appartient pas à cette story.


---

## 14. Clôture — le tour de correction (commit `2c80a67`)

Les quatre constats mineurs ont été instruits ; M4 ne l'a **pas** été, et c'est
délibéré : la revue elle-même l'attribue à `auth-form.tsx`, que `/sign-up` et
`/forgot-password` — intouchés par s14 — rendent à l'identique. Il appartient à
s46.

### Ce qui a été mesuré, et ce qui a rougi

| Ce qui a été neutralisé | Rouges | Cas nommé |
|---|---|---|
| `users.deleteById` retiré de `purgeAccount` | **1** | « efface les passkeys avec le compte, et se rejoue sans rien de plus » |
| la contrainte `auth_passkey_user_id_auth_user_id_fk` **repassée en `no action`** sur la base `s14` | **1** | le même cas — la suppression du compte échoue sur la clé étrangère |
| `REFUSAL_KEYS.cancelled` → `REFUSAL_KEYS.refused` dans `passkey-card.tsx` | **1** | « une cérémonie d'enrôlement annulée le dit, et n'écrit rien » (parcours) |

Chacune restaurée dans la commande qui la pose ; la contrainte a été rendue à
`on delete cascade` et relue dans `pg_constraint` (`confdeltype = c`).

### M2 — la purge est exécutée, plus seulement déclarée

Première branche des deux proposées : **`purgeAccount` est appelée**, sur un
compte muni d'une passkey, par le contrat du module (`authModule.purge`). Objet
et ligne : la ligne d'`auth_passkey` est comptée à 1 avant, à 0 après, la ligne
d'`auth_user` disparaît, la purge est rejouée sans effet supplémentaire, et le
justificatif effacé est présenté une dernière fois — 401, aucune session. La
seconde mutation ci-dessus prouve que c'est bien **la cascade** qui porte la
propriété, et pas un effacement écrit à la main.

Le plan porte désormais la correction à l'endroit où il affirmait « mesurée ».

### Critère 5 — l'annulation est exercée, et le message est jugé

Le parcours reproduit le seul geste qu'aucune automatisation ne produit —
fermer la fenêtre du système — par le rejet que Chrome rend alors :
`NotAllowedError` sur `navigator.credentials.create`, posé par
`addInitScript`, la même technique que le cas « sans WebAuthn » du même fichier.
L'authentificateur virtuel ne sait pas produire ce rejet : mesuré,
`WebAuthn.removeVirtualAuthenticator` sur une cérémonie en attente
(`automaticPresenceSimulation: false`) laisse la promesse **en attente** au bout
de quinze secondes.

Ce qui est jugé est entièrement à nous, et les deux moitiés du critère y sont :
le message affiché est celui de l'**annulation** (« Enregistrement annulé.
Aucune passkey n'a été ajoutée. »), pas celui de l'échec — la mutation qui
échange les deux clés rougit —, et rien n'a été écrit : aucune requête `POST`
vers `/passkey/verify-registration` n'est partie, et la liste servie après
rechargement est toujours vide.

### M3 — la surprise de production est écrite, avec la conduite à tenir

« Changer l'hôte d'`APP_URL` invalide toutes les passkeys déjà enregistrées »
figure aux trois endroits demandés : `packages/modules/auth/AGENTS.md`
(section s14), l'**ADR 031** (Consequences), et le commentaire de
`better-auth-service.ts` à l'endroit où `rpID` est posé. Chacun dit quoi faire :
prévenir avant de déplacer le domaine, compter sur l'autre moyen de connexion
que la règle du dernier moyen garantit, faire réenregistrer depuis le nouvel
hôte, et ne pas figer l'ancien `rpID` — il doit rester un suffixe enregistrable
de l'origine servie.

### M1 — la règle est ramenée à ce que le code tient

`AGENTS.md` énonce désormais la discipline telle qu'elle est : `credentialID`
ne part pas **vers un écran** (`describePasskeys` ne le recopie pas, et c'est
une des raisons pour lesquelles `list-user-passkeys` n'est pas déclarée), et il
sort bien par `/passkey/generate-authenticate-options`, dans
`allowCredentials`, pour le compte de la session, parce qu'un justificatif non
découvrable ne se présente que si on le nomme. Aucune fuite inter-comptes. Le
paragraphe dit pourquoi la formulation plus forte était dangereuse : le prochain
agent l'aurait lue comme violée.

### Le vert de la mutation `rpID`, avec sa vraie raison

Le plan et `AGENTS.md` écrivaient « le défaut de la bibliothèque calcule la même
valeur ». C'est vrai mais incomplet, et la raison exacte est celle qu'a établie
cette revue : `getRpID` lit `baseURL`, que le module **épingle** à `APP_URL`, et
le vrai repli de la bibliothèque (en-tête `Host`, en-têtes de proxy de
confiance) ne s'arme que si `baseURL` disparaît — ce qui casserait du même coup
`trustedOrigins`, les liens envoyés par email et les URI de rappel OAuth. Les
trois textes le disent maintenant : un vert **compris**, pas un trou déclaré.

### Les commandes, dans les deux configurations de modules

| Commande | Configuration « tous » | Configuration « socle » |
|---|---|---|
| `pnpm typecheck` | vert (16 tâches) | vert (16 tâches) |
| `pnpm lint --max-warnings=0` | vert | vert |
| `pnpm test` | **1123 passés**, 2 ignorés, 33 fichiers | **1123 passés**, 2 ignorés |
| `E2E_PORT=3114 pnpm test:e2e` | **61 passés**, 5 ignorés | **49 passés**, 17 ignorés |
| `pnpm build` | vert | vert |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert | — |

Les **trois** parcours de `e2e/passkeys.spec.ts` ont été relus **par leur nom**
dans le journal des deux configurations, et non déduits du total ; le cas de
purge de `tests/auth.test.ts` de même. La configuration « socle » a été obtenue
par `pnpm ks toggle marketing`, `organizations`, `i18n`, puis restaurée par les
trois bascules inverses : `git status` ne montre ensuite ni `config/features.ts`
ni `generated/`.

### Ce qui reste ouvert

- **M4** — l'écart de rendu de `/sign-in` : hors périmètre, à traiter en s46 ;
- **le conflit de fusion** dans `tests/fixtures/screen-viewer.ts` (§12) : laissé
  tel quel, la branche n'a pas été rebasée ;
- tout ce que la §10 énumère et que ce tour ne touche pas : aucun
  authentificateur réel, un seul navigateur, une seule origine, aucun
  chronométrage de `/passkey/verify-authentication`, la limitation de débit
  attribuée à s28. L'annulation et la purge en **sortent** : elles y étaient
  listées comme non mesurées, elles le sont désormais.

Ce tour n'a introduit aucun comportement neuf : deux cas de test, quatre textes,
et aucune ligne de production hors commentaires.

Max severity: minor
Ship allowed: yes
