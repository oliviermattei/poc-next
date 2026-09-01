# Recherche — s14-passkeys

> Tout ce qui suit a été **mesuré dans les paquets installés** ou exécuté.
> Quand une affirmation vient d'une lecture de source et non d'une exécution,
> c'est écrit. Les listes disent ce qui a été balayé, jamais ce qui existe.

Worktree `.claude/worktrees/agent-a684686c5a05d43a1`, branche
`feature/s14-passkeys`, base PostgreSQL `s14`, port de parcours `3114`.

---

## 1. Le paquet, et où il n'est pas

`better-auth@1.7.2` **n'embarque pas** de greffon passkey : ses `exports`
énumèrent vingt-et-un chemins `./plugins/*` (mesuré en lisant
`node_modules/better-auth/package.json`), et `passkey` n'y est pas. Le greffon
vit dans un paquet séparé, `@better-auth/passkey`, publié à la **même
version** (1.7.2 existe, `npm view` le confirme) et déclarant
`better-auth@^1.7.2` en pair.

Ses dépendances directes : `@simplewebauthn/browser@^13.3.0`,
`@simplewebauthn/server@^13.3.1`, `zod@^4.3.6`. Résolues ici en 13.3.0 et
13.3.3.

`docs/architecture.md` et l'ADR 004 nomment déjà ce greffon pour s14 ; l'ADR
025 le reconduit explicitement (« ses plugins `admin`, `two-factor` et
`@better-auth/passkey`, que les stories s13, s14 et s17 emploieront »). Rien à
rouvrir de ce côté.

**Deux dépendances entrent dans le dépôt**, et `docs/security.md` §6 demande
qu'une story les justifie :

| Paquet | Où | Pourquoi celui-là |
|---|---|---|
| `@better-auth/passkey@1.7.2` | `packages/modules/auth` | le greffon officiel, épinglé à la version de la bibliothèque |
| `@simplewebauthn/browser@^13.3.0` | `apps/web` | l'appel `navigator.credentials` côté navigateur, et la détection de support |

Le second mérite un mot. Il est **déjà** dans l'arbre — c'est une dépendance du
greffon — et c'est exactement le point : les deux moitiés de la cérémonie
(l'encodage base64url du défi, des identifiants de justificatif et des trois
champs de réponse) sont ainsi écrites par le **même** auteur, dans la même
version. Les réécrire à la main serait une seconde implémentation d'un format
binaire, dont la divergence ne se verrait qu'à l'exécution, dans un navigateur.

`@better-auth/passkey/client` **n'est pas** employé : il suppose le client
`better-auth`, donc sa table de routes et ses corps de réponse. Le module
réécrit les deux (frontière n°3, `packages/modules/auth/AGENTS.md`), et un
composant client qui importerait le module embarquerait Better Auth et Drizzle
dans le paquet du navigateur — la mesure de la revue s13 (C5).

---

## 2. Ce que le greffon expose, et ce qu'il ne garde pas

### 2.1 Sept points d'entrée

Lus dans `dist/index.mjs` du paquet installé :

| Chemin | Méthode | Garde de la bibliothèque |
|---|---|---|
| `/passkey/generate-register-options` | GET | `freshSessionMiddleware` |
| `/passkey/verify-registration` | POST | `freshSessionMiddleware` |
| `/passkey/generate-authenticate-options` | GET | aucune |
| `/passkey/verify-authentication` | POST | aucune |
| `/passkey/list-user-passkeys` | GET | `sessionMiddleware` |
| `/passkey/delete-passkey` | POST | `sessionMiddleware` + `requireResourceOwnership` |
| `/passkey/update-passkey` | POST | `sessionMiddleware` + `requireResourceOwnership` |

**Quatre seront déclarés, trois non.** Le raisonnement est en §6.

### 2.2 La table

`getAuthTables` exécuté sur la configuration réelle du module, greffon monté
avec `schema: { passkey: { modelName: 'auth_passkey' } }` — sortie effective :

```
passkey => modelName auth_passkey
    name        {"type":"string","required":false}
    publicKey   {"type":"string","required":true}
    userId      {"type":"string","required":true,"references":{"model":"user","field":"id"}}
    credentialID{"type":"string","required":true}
    counter     {"type":"number","required":true}
    deviceType  {"type":"string","required":true}
    backedUp    {"type":"boolean","required":true}
    transports  {"type":"string","required":false}
    createdAt   {"type":"date","required":false}
    aaguid      {"type":"string","required":false}
```

Trois choses à retenir :

1. **aucun `updatedAt`** — contrairement aux quatre tables de s07 et à celle de
   s13. La table du module ne le déclarera donc pas : une colonne que rien
   n'écrit est une colonne qui ment ;
2. `mergeSchema` accepte `modelName`, et le greffon passe `model: "passkey"`
   littéral à l'adapter — c'est **la bibliothèque** qui résout le nom de modèle,
   comme pour `twoFactor` en s13. Le nom de table préfixé est donc tenu par la
   même mécanique, déjà éprouvée ;
3. la référence vers `user` reste **interne au module** (ADR 018) : `auth_user`
   appartient à `auth`, et c'est `auth` qui déclare `auth_passkey`.

Le greffon **n'ajoute aucune colonne** à `auth_user` ni à `auth_session` — la
lecture de `src/schema.ts` du paquet le montre, et `getAuthTables` ci-dessus le
confirme (les quatre autres tables sont inchangées par rapport à s13). C'est ce
qui distingue ce greffon de celui d'`organization`, écarté par l'ADR 025 pour
cette raison exacte.

### 2.3 Aucun appel réseau sortant

La vérification WebAuthn est **locale** : `@simplewebauthn/server` fait de la
cryptographie, pas des requêtes. Balayé sur `dist/index.mjs` du greffon et sur
`esm/` de `@simplewebauthn/server` : aucun `fetch`, aucun `betterFetch`. La
porte bornée du module (`infrastructure/oauth-outbound.ts`,
`docs/reliability.md` §3) n'a donc rien de neuf à couvrir, et la règle de lint
qui refuse un `fetch` ailleurs reste satisfaite sans exception.

C'est aussi ce qui fait qu'une passkey **fonctionne en local sans aucune clé de
fournisseur** : il n'y a pas de fournisseur. Le §2 de `docs/reliability.md` est
tenu par construction, pas par un mode local à armer.

---

## 3. Les trois pièges du greffon, mesurés

### 3.1 L'origine attendue est celle que l'appelant déclare

```js
const passkey = (options) => {
  const opts = { origin: null, ...options, advanced: {…} }
```

et, dans les deux vérifications :

```js
const origin = options?.origin || ctx.headers?.get("origin") || "";
…
expectedOrigin: origin,
```

**Sans `origin` explicite, l'origine attendue est l'en-tête `Origin` de la
requête** — c'est-à-dire une valeur que l'appelant écrit. La comparaison
`clientDataJSON.origin === expectedOrigin` devient alors une comparaison d'une
chaîne fournie par le client avec une autre chaîne fournie par le client : elle
ne peut plus échouer.

Ce que cela ne casse **pas**, et il faut le dire pour ne pas surestimer le
constat : le navigateur refuse de produire une assertion pour un `rpId` qui
n'est pas un suffixe enregistrable de son origine, donc un site tiers ne peut
pas obtenir d'assertion pour notre `rpId`. Le contrôle d'origine est une
**seconde serrure** — celle qui tient quand la première a cédé (un sous-domaine
compromis, un navigateur non conforme, un client qui n'est pas un navigateur).
`docs/security.md` §4 range les redirections et les entrées sous « liste
blanche, jamais un paramètre non validé » ; une origine attendue lue dans la
requête est le cas d'école.

**Décision** : `origin` est posé explicitement, à l'URL publique de
l'application (`APP_URL`), comme `trustedOrigins` l'est depuis s07.

`rpID`, lui, n'a pas ce défaut : `getRpID(options, baseURL)` retombe sur
`new URL(baseURL).hostname`, donc sur l'hôte d'`APP_URL`, jamais sur une valeur
reçue. Il sera malgré tout **écrit** — comme les trois lignes
d'`accountLinking` de s12 le sont : un défaut qu'aucun test ne tient change à
la montée de version.

### 3.2 La vérification de l'utilisateur n'est jamais exigée

Les deux vérifications sont appelées avec `requireUserVerification: false`,
**en dur**, sans option pour y toucher :

```js
verifyRegistrationResponse({ …, requireUserVerification: false })
verifyAuthenticationResponse({ …, requireUserVerification: false })
```

et les options générées portent `userVerification: "preferred"`,
`residentKey: "preferred"`.

Conséquence, et elle décide de l'ADR : **une passkey de ce montage ne prouve
que la possession**. Le drapeau `UV` du `authenticatorData` n'est pas exigé, et
il est écrit par l'authentificateur — donc par le client. Poser
`authenticatorSelection: { userVerification: 'required' }` ne changerait rien :
c'est une *préférence* transmise au navigateur, que seule la vérification
côté serveur peut rendre contraignante, et cette vérification est fermée.

### 3.3 Le compteur de signature — ce qui est vraiment détecté

`@simplewebauthn/server@13.3.3`,
`esm/authentication/verifyAuthenticationResponse.js` :

```js
if ((counter > 0 || credential.counter > 0) && counter <= credential.counter) {
  throw new Error(`Response counter value ${counter} was lower than expected ${credential.counter}`);
}
```

et le greffon écrit ensuite `counter: verification.authenticationInfo.newCounter`.

Donc :

- un authentificateur **qui tient un compteur** est protégé : une assertion
  rejouée, ou produite par un clone resté en arrière, est refusée ;
- un authentificateur **qui rend toujours zéro** — c'est le cas de la plupart
  des passkeys synchronisées (iCloud Keychain, Google Password Manager) — n'est
  pas protégé : `counter > 0 || credential.counter > 0` est faux, et la
  comparaison est sautée. **Il n'y a alors aucune détection de clonage**, et
  aucune ligne de ce dépôt ne peut en créer une.

C'est écrit ici, et ce sera écrit dans `packages/modules/auth/AGENTS.md` :
prétendre « le clonage est détecté » serait faux pour l'authentificateur le
plus répandu. Ce qui est vrai : *le compteur est vérifié et rangé quand
l'authentificateur en fournit un*. Les deux branches seront mesurées — une
assertion à compteur décroissant refusée, une assertion à compteur nul
acceptée deux fois.

---

## 4. Les mesures faites sur un authentificateur de laboratoire

Une passkey ne se teste pas en postant un formulaire : la seule chose qu'un
serveur voit est une attestation ou une assertion **signées**. La suite de nœud
reçoit donc `tests/fixtures/webauthn.ts` — une paire de clés ES256, un encodeur
CBOR minimal pour l'objet d'attestation et la clé COSE, et de quoi signer une
assertion. Il **remplace l'authentificateur, jamais le vérificateur** : les
réponses produites traversent le vrai `@simplewebauthn/server` embarqué par le
greffon.

Écrit et exécuté pendant la recherche, contre le vérificateur réel — **quatre
mesures, toutes vertes** :

| Ce qui a été présenté | Résultat |
|---|---|
| attestation `none`, ES256, `UP+UV+AT` | acceptée, `credential.id` conservé |
| assertion signée, compteur 1 | acceptée, `newCounter = 1` |
| assertion dont `clientDataJSON.origin` vaut `https://evil.test` | **refusée** — « Unexpected authentication response origin » |
| assertion dont le `rpIdHash` est celui d'`evil.test` | **refusée** |
| assertion à compteur 3 contre un compteur stocké de 5 | **refusée** — « Response counter value 3 was lower than expected 5 » |

Ce que cette doublure **ne prouve pas**, et qu'il ne faudra pas lire comme
prouvé :

- elle ne dit rien de ce qu'un navigateur accepte de **produire**. Le refus du
  navigateur de signer pour un `rpId` étranger, la découverte d'une clé
  résidente, le geste de l'utilisateur : rien de tout cela n'est ici. C'est le
  rôle de `e2e/passkeys.spec.ts` et de l'authentificateur virtuel de Chrome ;
- elle fabrique ses drapeaux, donc elle ne dit rien de ce qu'un authentificateur
  réel met dans `UV` ;
- l'attestation est `none`, la seule que le greffon demande
  (`attestationType: "none"`) : aucune chaîne de certificats n'est exercée.

---

## 5. Le point qui décide de la story : passkey et second facteur

La garde de s13 a été **renversée** juste avant cette story : le crochet du
greffon `two-factor` vaut sur **tout** chemin, et
`TWO_FACTOR_CHALLENGE_EXEMPT_PATHS` énumère les cinq exemptions. Mieux :
`packages/modules/auth/src/infrastructure/two-factor-challenge.test.ts` **cite
déjà** `/passkey/verify-authentication` et exige qu'il soit couvert.

Autrement dit, la question n'est pas « faut-il brancher la garde ? » — elle
l'est. La question est : **une passkey est-elle un premier facteur, ou une
authentification forte qui dispense du second ?**

Les deux se défendent. Le W3C et la FIDO Alliance présentent une passkey avec
vérification de l'utilisateur comme une authentification à deux facteurs
(possession de l'appareil + biométrie ou code de l'appareil), et plusieurs
produits la traitent ainsi.

**Ce montage-ci ne peut pas s'en réclamer**, et c'est mesuré (§3.2) : le
greffon vérifie avec `requireUserVerification: false`, sans option. Le drapeau
`UV` est écrit par le client et n'est jamais exigé. Une passkey vaut donc ici
*possession*, et rien de plus.

Deux arguments s'y ajoutent, et ils sont de méthode :

- **le sens de l'échec.** Ne pas exempter échoue *fermé* : au pire un défi de
  trop, visible immédiatement. Exempter échoue *ouvert* : une session sans
  second facteur, en silence. C'est exactement l'arbitrage que la revue s13 a
  imposé (C11) ;
- **l'exemption par confort est ce que la consigne interdit.** Le chemin de
  connexion de cette story ne s'exempte pas lui-même.

**Décision, portée par un ADR** (numéro 031) : *une passkey est un premier
facteur.* Un compte à second facteur actif qui se connecte par passkey est
renvoyé à l'écran de vérification, exactement comme après un mot de passe, un
magic link ou un rappel de fournisseur.

### 5.1 L'enrôlement, lui, demande une exemption — et elle est mesurée

`docs/security.md` §2 exige la rotation de l'identifiant de session à
l'élévation de privilège, et la consigne de la story la demande nommément
« à l'enrôlement comme à la connexion ». Le seul moyen de rotation offert par
le greffon est `createSession: true` dans le corps de
`/passkey/verify-registration`, qui appelle `internalAdapter.createSession`
puis `setSessionCookie` (lu dans le paquet).

Or `setSessionCookie` pose `ctx.context.newSession` — c'est le fait n°2 que
`two-factor-challenge.ts` documente. Sans exemption, **un compte protégé par un
second facteur perdrait sa session en enregistrant une passkey** : le crochet
détruirait la session que la bibliothèque vient de poser, et la personne se
retrouverait déconnectée au milieu des paramètres. C'est la même forme que le
défaut trouvé par s13 sur `/get-session` (une déconnexion inexpliquée au bout
d'un jour), et elle sera mesurée de la même façon : un cas neuf, et la mutation
qui retire l'exemption doit le rougir.

L'exemption est **sûre**, et pas seulement souhaitable :

- la route est déclarée `authenticated` : le répartiteur refuse avant la
  bibliothèque ;
- `freshSessionMiddleware` exige en plus une session **fraîche** ;
- le greffon refuse (`UNAUTHORIZED`) si l'identifiant résolu du défi n'est pas
  celui de la session.

Elle ne peut donc **ouvrir** aucune session : elle ne peut que faire tourner
celle d'un appelant déjà authentifié — la seconde famille d'exemptions, celle
de `/get-session` et `/change-password`.

**Les six exemptions seront donc ce qui a été balayé, pas un inventaire.** Ce
balayage-ci : les trois points d'entrée de vérification du second facteur, les
deux rotations de session déjà connues, et celle-ci. Rien ne dit qu'un
septième chemin n'existe pas ailleurs dans la bibliothèque.

### 5.2 La rotation, pour de bon

`internalAdapter.createSession` **ajoute** une ligne ; il n'efface pas la
précédente. Une « rotation » qui laisse l'ancien identifiant vivant n'en est pas
une. Le module révoquera donc explicitement la session de l'appelant après un
enrôlement réussi, avec l'utilitaire qui existe déjà
(`useCases.revokeSession`), et la propriété mesurée sera : *l'ancien cookie
n'authentifie plus, le nouveau oui.*

---

## 6. Quatre routes déclarées, trois non

`docs/architecture.md` et l'ADR 017 : ce qui n'est pas déclaré n'existe pas —
404 du répartiteur, sans jamais atteindre la bibliothèque. Comme s13 a déclaré
cinq des sept points d'entrée du second facteur, s14 en déclare quatre sur
sept, et les trois autres ont chacun leur raison.

| Point d'entrée | Déclaré ? | Pourquoi |
|---|---|---|
| `/passkey/generate-register-options` | oui, `authenticated` | le navigateur en a besoin |
| `/passkey/verify-registration` | oui, `authenticated` | idem |
| `/passkey/generate-authenticate-options` | oui, **public** | il n'y a pas encore de session |
| `/passkey/verify-authentication` | oui, **public** | c'est la connexion elle-même |
| `/passkey/list-user-passkeys` | **non** | il rend la **ligne entière** : `publicKey`, `credentialID`, `counter`, `aaguid`. Le module énumère ses colonnes depuis s07 (sessions) et s12 (moyens de connexion) ; l'écran lit la liste par un cas d'usage, comme `currentSessions()` |
| `/passkey/delete-passkey` | **non** | la bibliothèque **compte puis supprime** hors transaction, et ne connaît pas la règle du dernier moyen de connexion. Même défaut, même correctif que le déliement de s12 |
| `/passkey/update-passkey` | **non** | un `UPDATE` avec le propriétaire dans la condition, comme `changeName` de s08. Passer par la bibliothèque n'apporte rien et rend `401` là où le socle veut `404` |

Le dernier point mérite d'être écrit précisément, parce qu'il est le seul qui
soit une **brèche** et non une préférence. `requireResourceOwnership` est monté
par le greffon avec :

```js
notFoundError: PASSKEY_ERROR_CODES.PASSKEY_NOT_FOUND,
forbiddenStatus: "UNAUTHORIZED"
```

Un identifiant inconnu et l'identifiant d'un autre compte ne rendent donc
**pas** la même chose : c'est un oracle d'existence, et `docs/security.md` §3
demande l'inverse (« 404, jamais 403 »). Les routes du module rendent `404`
dans les deux cas, comme `revoke-session` et `unlink-provider`.

### 6.1 Les deux routes du module

`/auth/passkeys/rename` et `/auth/passkeys/revoke`, toutes deux
`authenticated`, toutes deux avec le compte pris **dans la session** et jamais
dans le corps.

---

## 7. Le dernier moyen de connexion — une règle, pas deux

`domain/oauth.ts` porte déjà `canUnlinkSignInMethod(signInMethods)`, appelée
par `listSignInMethods` (pour l'affichage) et par `unlinkForUser` (sous verrou,
dans la transaction qui supprime). Elle compte les lignes d'`auth_account`,
c'est-à-dire le mot de passe et les fournisseurs.

Avec les passkeys, ce compte devient **faux dans les deux sens** :

- un compte qui n'a qu'un fournisseur **et** une passkey se voit refuser le
  déliement du fournisseur, alors qu'il lui resterait un moyen de connexion.
  Refus trop strict, mais sans danger ;
- un compte qui n'a **que** des passkeys pourrait supprimer la dernière : la
  règle n'est pas appelée sur ce chemin, il n'existait pas. Compte perdu.

La règle ne change donc **pas** ; ce sont ses appelants qui comptent désormais
`comptes + passkeys`. Écrire une seconde règle « le dernier moyen de connexion,
pour les passkeys » serait le geste que la consigne interdit.

La conséquence pratique, à mesurer : un compte créé par mot de passe puis muni
d'une passkey peut retirer l'un **ou** l'autre, jamais les deux.

L'atomicité suit le précédent de s12 : la suppression et le comptage sont dans
**une** transaction, sur les lignes verrouillées des deux tables. Deux
suppressions simultanées — la dernière passkey et le dernier compte — ne
doivent pas passer toutes les deux.

---

## 8. L'énumération de comptes

`/passkey/generate-authenticate-options` ne prend **aucun paramètre** : lu dans
le paquet, il lit la session si elle existe (pour remplir `allowCredentials`
avec les passkeys du compte) et, sinon, génère des options sans
`allowCredentials`. C'est le parcours « clé découvrable » : le navigateur
propose les passkeys qu'il détient, le serveur n'apprend rien.

Il n'y a donc **rien à révéler** : pas d'adresse en entrée, pas de branche sur
l'existence d'un compte, une réponse de même forme pour tout le monde. Le bouton
de connexion par passkey sera affiché **sans condition** sur l'écran de
connexion (sous réserve du support navigateur, §9), et jamais conditionné à une
adresse saisie.

`/passkey/verify-authentication` refuse un justificatif inconnu par
`PASSKEY_NOT_FOUND` (401) et une signature invalide par `AUTHENTICATION_FAILED`
(401 ou 400). Les deux seront repliés sur **un refus unique**, au même statut,
comme `genericSignInRefusal` le fait depuis s07 : un justificatif inconnu ne
doit pas se distinguer d'une signature fausse.

---

## 9. Le navigateur, et l'absence de navigateur

`@simplewebauthn/browser@13.3.0` expose `browserSupportsWebAuthn()`,
`startRegistration({ optionsJSON })` et `startAuthentication({ optionsJSON })`
(signatures lues dans les `.d.ts` du paquet installé).

Critère 4 de la story : « sur un navigateur ou un appareil incompatible
WebAuthn, l'option est masquée et les autres moyens de connexion restent
accessibles ». La forme retenue : le bouton n'est rendu qu'après hydratation
**et** si `browserSupportsWebAuthn()` rend vrai. Un rendu serveur ne peut pas le
savoir — c'est une propriété du navigateur —, donc c'est la seule forme
possible. Les formulaires de mot de passe, de magic link et les boutons de
fournisseur ne bougent pas : ils sont rendus par le serveur, indépendamment.

**Ce que la story ne livre pas, et c'est une déviation déclarée.** Les notes de
`docs/stories.md` mentionnent « l'UI conditionnelle exige `autocomplete="webauthn"`
sur le champ ». L'interface conditionnelle (l'autocomplétion du champ email par
une passkey) demande `startAuthentication({ useBrowserAutofill: true })`, un
appel qui reste ouvert pendant toute la vie de la page et qui doit être annulé à
chaque navigation. Elle n'est **pas** livrée : le bouton explicite satisfait le
critère 2 (« se connecter sans mot de passe »), et un attribut
`autocomplete="webauthn"` posé sans l'appel qui l'arme ne ferait rien du tout —
c'est le genre de conformité décorative que ce dépôt refuse.

Le piège nommé par la story — « les erreurs d'enregistrement renvoient toujours
un objet de données, `throw: true` est sans effet » — concerne le **client**
`better-auth`, que le module n'emploie pas. Ici, l'échec se lit sur le statut
de la réponse, comme partout ailleurs dans le module.

### 9.1 L'annulation

`startRegistration` rejette avec un `WebAuthnError` — `NotAllowedError` quand la
personne ferme la fenêtre du système. C'est un rejet **côté navigateur** :
aucune requête n'est partie, aucune ligne n'est écrite. Le critère 5 (« un
échec ou une annulation… sans créer d'entrée orpheline ») est donc tenu par la
forme du parcours : la ligne `auth_passkey` n'existe qu'après
`/passkey/verify-registration`, et le défi laissé en base est consommé ou
expire seul au bout de cinq minutes (`MAX_AGE_IN_SECONDS = 300`, lu dans le
paquet).

---

## 10. Le critère « module non activé »

Le module `auth` est **socle** (ADR 021) : il n'a pas d'état « non activé ».
Précédent posé par s12 et reconduit par s13 (recherche §9), validé deux fois en
revue. La forme mesurable pour s14 :

1. **aucune option de passkey dans les paramètres** quand le compte n'en a
   aucune enregistrée : la carte propose l'enregistrement, elle n'affiche ni
   liste ni bouton de révocation ;
2. **trois des sept points d'entrée du greffon n'existent pas** —
   `list-user-passkeys`, `delete-passkey`, `update-passkey` répondent 404 comme
   un chemin inventé, sans atteindre la bibliothèque. C'est la moitié « aucune
   route WebAuthn » du critère d'origine, appliquée à ce qui peut l'être ;
3. **la connexion se termine sans passkey** pour un compte qui n'en a pas : le
   bouton mène à une cérémonie que le navigateur abandonne, et les autres moyens
   restent servis.

La moitié « la table `passkey` est absente d'une base vierge » n'a pas
d'équivalent : le socle est toujours migré. La garde qui reste est celle de
s07 — les tables réellement créées sur une base vierge sont comparées à celles
que le module déclare, ni plus ni moins.

---

## 11. Ce que la story doit prouver, et où

| Propriété | Où c'est prouvé |
|---|---|
| le nom d'une passkey est borné, le défaut est rendu | `src/domain/auth-rules.test.ts` |
| la classe d'un refus de passkey (`stale`, `refused`) | idem |
| le dernier moyen de connexion compte les passkeys | idem (règle pure) + `tests/auth.test.ts` (sous verrou) |
| l'origine et le `rpId` sont bornés côté serveur | `tests/auth.test.ts` (authentificateur de laboratoire) |
| le compteur refuse un rejeu, et ne prétend rien à zéro | idem |
| une passkey supprimée n'ouvre plus de session | idem |
| une passkey d'un autre compte répond 404, jamais 401 | idem |
| un compte protégé par un second facteur est **défié** après sa passkey | idem |
| l'enrôlement fait tourner la session, l'ancienne meurt | idem |
| l'enrôlement d'un compte protégé ne le déconnecte pas (exemption) | idem |
| aucun jeton de session dans un corps de réponse | idem |
| trois points d'entrée non déclarés répondent 404 | idem |
| l'écran, la cérémonie réelle, le bouton masqué sans support | `e2e/passkeys.spec.ts` |
| aucune chaîne en dur, les deux écrans sous pseudo-locale | `tests/rendered-text.test.ts`, `tests/i18n.test.ts` |

**Un seul fichier de test neuf** — `e2e/passkeys.spec.ts` — plus une fixture,
`tests/fixtures/webauthn.ts`, qui n'est pas un fichier de test.

---

## 12. Ce qui n'a pas été vérifié

- **aucun authentificateur réel.** Ni Touch ID, ni clé de sécurité, ni
  gestionnaire de mots de passe. Tout ce qui est mesuré passe par la doublure de
  nœud ou par l'authentificateur virtuel de Chrome ;
- **un seul navigateur** (Chromium), **une seule origine** (`localhost`), **un
  seul `rpId`**. Le comportement sur un vrai domaine, avec un sous-domaine, ou
  derrière un proxy qui réécrit `Origin`, n'est pas mesuré ;
- **`counter` à zéro** : la branche « aucun clonage détecté » est mesurée comme
  un fait du vérificateur, pas comme un comportement d'authentificateur réel ;
- **la synchronisation multi-appareils** d'une passkey (iCloud, Google) est hors
  d'atteinte de ce dépôt ;
- **la limitation de débit** de `/passkey/verify-authentication` appartient à
  s28, comme celle de la vérification du second facteur. Aucun compteur local
  n'est écrit ici.
