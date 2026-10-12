# ADR 031 — Une passkey est un premier facteur, pas une authentification à deux facteurs

- Status: accepted
- Date: 2026-09-01
- Scope: story s14-passkeys

## Context

s13 a livré le second facteur, et sa deuxième revue a **renversé** la garde qui
le pose (constat C11). Le crochet du greffon `two-factor` ne reçoit plus une
liste de chemins **à protéger** — forme qui échoue *ouvert*, puisque rien ne
rougit le jour où une voie de connexion s'ajoute — mais vaut partout, sauf sur
les chemins **exemptés**, énumérés avec leur raison dans
`packages/modules/auth/src/infrastructure/two-factor-challenge.ts`.

La revue nommait l'échéance : « s14 livre les passkeys, et
`better-auth/plugins/passkey` ouvre une session par
`/passkey/verify-authentication` ». Le cas canari de
`two-factor-challenge.test.ts` cite déjà ce chemin.

La question posée à s14 n'est donc pas « faut-il brancher la garde » — elle
l'est déjà. C'est : **une passkey vaut-elle un facteur, ou deux ?**

La question est réelle. Le W3C et la FIDO Alliance présentent une passkey munie
de vérification de l'utilisateur (`UV`) comme une authentification à deux
facteurs — possession de l'authentificateur, plus biométrie ou code de
l'appareil — et plusieurs produits du marché en dispensent le second facteur.
Répondre « premier facteur » coûte une étape à chaque connexion d'un compte
protégé ; répondre « deux facteurs » ouvre une session sur la seule foi d'un
drapeau.

**Ce qui tranche est mesuré dans le paquet installé**, `@better-auth/passkey@1.7.2`
(`dist/index.mjs`) :

```js
verifyRegistrationResponse({ …, requireUserVerification: false })
verifyAuthenticationResponse({ …, requireUserVerification: false })
```

Les deux valeurs sont **écrites en dur**, et aucune option du greffon ne les
expose. Les options générées portent par ailleurs `userVerification: "preferred"`.
Le drapeau `UV` du `authenticatorData` est donc **écrit par l'authentificateur,
et jamais exigé par le serveur** : une assertion sans vérification de
l'utilisateur est acceptée exactement comme une autre. Poser
`authenticatorSelection: { userVerification: 'required' }` ne changerait rien —
c'est une préférence transmise au navigateur, que seule la vérification côté
serveur peut rendre contraignante, et cette vérification est fermée.

Dans **ce** montage, une passkey prouve la possession d'un authentificateur, et
rien d'autre.

## Decision

**Une passkey est un premier facteur.**

`/passkey/verify-authentication` **n'est pas** exempté du crochet du second
facteur : un compte à second facteur actif qui se connecte par passkey est
renvoyé à l'écran de vérification, exactement comme après un mot de passe, un
magic link ou un rappel de fournisseur.

Une **seule** exemption est ajoutée par cette story, et elle ne concerne pas la
connexion : `/passkey/verify-registration`. Ce point d'entrée fait tourner la
session d'un appelant **déjà** authentifié (rotation à l'enrôlement,
`docs/security.md` §2) ; il exige une session fraîche
(`freshSessionMiddleware`), il est déclaré `authenticated`, et le greffon refuse
si le compte résolu n'est pas celui de la session. Il ne peut donc ouvrir
aucune session — il appartient à la seconde famille d'exemptions, celle de
`/get-session` et `/change-password`.

## Considered options

- **La passkey comme authentification forte, exemptée du second facteur** —
  rejetée pour trois raisons, dont la première est mesurée :
  1. le greffon ne vérifie **jamais** le drapeau `UV`
     (`requireUserVerification: false`, en dur, sans option). Se réclamer de
     « possession + inhérence » supposerait une propriété que le code contredit,
     et le client écrit lui-même le drapeau qui l'affirmerait ;
  2. le **sens de l'échec**. Ne pas exempter échoue *fermé* : au pire un défi de
     trop, visible à la première connexion. Exempter échoue *ouvert* : une
     session ouverte sans second facteur, en silence, sous une suite verte.
     C'est l'arbitrage que la revue de s13 a imposé, au prix d'un tour de
     correction ;
  3. c'est **l'exemption par confort** : le chemin de connexion que cette story
     livre s'exempterait lui-même de la garde qui existe pour lui.
- **Marquer la session « à moitié authentifiée » plutôt qu'élargir le crochet** —
  rejetée, et pour la raison exécutable que s13 a déjà écrite : la branche
  « session déjà ouverte » de `verifyTwoFactor` n'arme **ni** `beginAttempt(5)`,
  **ni** `accountLockout` (relu dans `verify-two-factor.mjs` : `beginAttempt` y
  rend deux fonctions vides). Laisser la session s'ouvrir puis exiger le code en
  aval offrirait une devinette à six chiffres sans aucun compteur.
- **Exiger `UV` nous-mêmes, en relisant le drapeau après coup** — rejetée : le
  greffon ne rend pas le `authenticatorData` parsé à ses crochets
  (`authentication.afterVerification` reçoit le résultat de vérification, dont
  `authenticationInfo.userVerified`), mais **la session est déjà créée** quand
  ce crochet s'exécute ; la refuser demanderait de défaire une session que la
  bibliothèque vient de poser, à chaque connexion, pour transformer une
  propriété que le client contrôle en garantie qu'il ne contrôlerait toujours
  pas. Un drapeau écrit par l'authentificateur n'est pas une preuve : c'est une
  déclaration.
- **Ne pas livrer les passkeys tant que le greffon n'exige pas `UV`** —
  rejetée : la story est au périmètre du PRD, et une passkey premier facteur
  reste strictement meilleure qu'un mot de passe (rien à hameçonner, rien à
  rejouer, liée à l'origine). Le défaut est de ne pas *remplacer* le second
  facteur, pas d'être faible.

## Consequences

**Ce qui devient plus simple.** La propriété de s13 reste vraie sans exception
de connexion : *aucune session n'existe sur un compte à second facteur actif
tant que le facteur n'a pas été présenté*, quelle que soit la voie. Elle est
tenue par la **forme** de la garde, pas par une liste à tenir à jour, et le cas
canari de `two-factor-challenge.test.ts` la mesure.

**Ce qui devient plus coûteux.** Un compte à la fois protégé par un second
facteur et muni d'une passkey présente deux preuves à chaque connexion. C'est
assumé : les deux populations se recouvrent peu, et celle qui les cumule a
choisi la ceinture et les bretelles.

**Ce qu'il faut surveiller.** Le jour où `@better-auth/passkey` expose une
option de vérification de l'utilisateur — ou vérifie `UV` par défaut — le
premier argument de cet ADR tombe, et la question se rouvre. Elle se rouvrira
par un **nouvel ADR** superséquent, pas par une ligne ajoutée à la liste
d'exemptions. Le point exact à relire est nommé dans
`packages/modules/auth/AGENTS.md`.

**Ce que ce montage impose au domaine servi, et qu'on découvre sinon un lundi
matin.** Le `rpID` de ce dépôt est l'hôte d'`APP_URL`, et il est **scellé dans
le justificatif** par l'authentificateur au moment de l'enrôlement. **Changer
l'hôte d'`APP_URL` invalide donc toutes les passkeys déjà enregistrées** :
le navigateur refuse une cérémonie dont le `rpId` attendu a changé, avant même
d'atteindre le serveur, et il n'existe ni message ni migration pour rattraper
cela. C'est la seule surprise de production que cette story installe. Ce qu'il
faut faire quand un domaine doit bouger : prévenir avant, compter sur l'autre
moyen de connexion — la règle du dernier moyen garantit qu'il en reste un —,
faire réenregistrer depuis le nouvel hôte, et **ne pas** figer l'ancien `rpID`,
qui doit rester un suffixe enregistrable de l'origine servie. Le mode d'emploi
vit dans `packages/modules/auth/AGENTS.md`, section s14, et le commentaire de
`better-auth-service.ts` le dit à l'endroit où la valeur est posée.

**Ce qui reste vrai des exemptions.** Elles sont désormais six. Elles disent ce
qui a été **balayé** — les trois points d'entrée du greffon `two-factor`, les
deux rotations de session appelées par `auth.api.*`, et l'enrôlement d'une
passkey —, jamais un inventaire de ce que les bibliothèques exposent. Une
septième se mesure comme les précédentes : on la retire, et le cas qui la
justifie doit rougir.
