---
story: s14-passkeys
validated: yes
---

# Plan — s14-passkeys

Recherche : `docs/research/s14-passkeys.md`.
Design : `docs/designs/s14-passkeys.md` (+ `.html`).

**Sections des socles engagées** — `docs/security.md` **§2** (rotation de
l'identifiant de session à l'élévation de privilège : enrôlement et connexion ;
révocation effective côté serveur), **§3** (vérification côté serveur ; le
compte agit sur lui-même ; 404 et jamais 403 sur la passkey d'un autre),
**§4** (Zod / corps reconstruit à chaque frontière ; **origine attendue en
liste blanche**, jamais lue dans la requête), **§5** (aucun secret ni jeton de
session dans une réponse ni dans un journal), **§6** (deux dépendances ajoutées,
justifiées : recherche §1), **§7** (aucun refus qui renseigne — un justificatif
inconnu et une signature fausse rendent le **même** refus ; événements de
sécurité journalisés avec leur acteur ; la limitation partagée reste s28).
`docs/reliability.md` **§1** (révocation du dernier moyen de connexion prouvée
sous concurrence ; migration rejouée deux fois), **§2** (aucune clé de
fournisseur : la vérification WebAuthn est locale), **§4** (migration additive,
rétro-compatible).

**Un seul fichier de test neuf** — `e2e/passkeys.spec.ts`. Le reste s'ajoute à
`packages/modules/auth/src/domain/auth-rules.test.ts`,
`packages/modules/auth/src/infrastructure/two-factor-challenge.test.ts`,
`tests/auth.test.ts`, `tests/rendered-text.test.ts` et `tests/i18n.test.ts`.
S'y ajoute une **fixture**, `tests/fixtures/webauthn.ts` — un authentificateur
de laboratoire, pas un fichier de test (recherche §4).

## Décisions portées par ce plan

1. **Une passkey est un premier facteur** → **ADR 031**. Un compte à second
   facteur actif reste défié après sa passkey. L'option rejetée — la passkey
   comme authentification forte, exemptée — est écrite dans l'ADR avec sa raison
   de rejet mesurée : le greffon vérifie avec `requireUserVerification: false`,
   en dur (recherche §3.2 et §5).
2. **Une sixième exemption** au crochet du second facteur :
   `/passkey/verify-registration`, parce que la rotation de session à
   l'enrôlement pose `newSession` sur un appelant **déjà** authentifié. Mesurée
   comme s13 a mesuré `/get-session` (recherche §5.1). Les six exemptions
   restent *ce qui a été balayé*, pas un inventaire.
3. **`origin` posé explicitement**, à `APP_URL`. Sans lui, l'origine attendue
   est l'en-tête `Origin` de la requête — donc une valeur de l'appelant
   (recherche §3.1). `rpID` est écrit aussi, bien que son défaut calcule la même
   valeur.
4. **Quatre des sept points d'entrée du greffon sont déclarés.** `list`,
   `delete` et `update` ne le sont pas : le premier rend la ligne entière, le
   deuxième compte puis supprime hors transaction et ignore la règle du dernier
   moyen, le troisième rend `401` là où le socle veut `404` (recherche §6).
5. **La règle du dernier moyen de connexion ne change pas** ;
   `canUnlinkSignInMethod` reçoit désormais `comptes + passkeys`. Aucune seconde
   règle n'est écrite (recherche §7).
6. **Le critère « module non activé » est réinterprété** — `auth` est socle
   (ADR 021), précédent s12 et s13. Forme retenue : recherche §10.
7. **L'interface conditionnelle n'est pas livrée** (`autocomplete="webauthn"` et
   `useBrowserAutofill`). **Déviation déclarée** à une note de `docs/stories.md`.
   Raison : recherche §9.
8. **`generated/schema/auth.ts` régénéré** (une ligne d'export) : la story crée
   réellement une table. **Déviation déclarée** à la consigne de la voie, qui
   l'autorise dans ce cas.
9. **`exportAccount` n'est pas touché**, comme s13 ne l'a pas touché pour le
   second facteur : le nombre de passkeys n'entre pas dans l'export de cette
   story. La purge, elle, est tenue par la cascade de la clé étrangère.
   **Corrigé au tour de revue (M2)** : au moment où ce plan écrivait
   « mesurée », elle ne l'était pas — aucun cas n'appelait `purgeAccount`. Elle
   l'est depuis, par « efface les passkeys avec le compte, et se rejoue sans
   rien de plus » (`tests/auth.test.ts`), qui compte la ligne avant et après.

---

## Tâches

- [x] **1. ADR 031 — la passkey est un premier facteur.**
      `docs/decisions/031-la-passkey-est-un-premier-facteur.md` (MADR,
      `@templates/adr.md`) : contexte (la garde renversée de s13, qui cite déjà
      `/passkey/verify-authentication`), décision, options rejetées avec leur
      raison **mesurée**, conséquences.
      *Pas de test propre* : la propriété est portée par la tâche 9 et par le
      cas canari de `two-factor-challenge.test.ts`, qui existe déjà.

- [x] **2. Les règles pures.**
      `src/domain/passkey.ts` : `PASSKEY_NAME_MAX_LENGTH`,
      `parsePasskeyName(input)` (Zod, trim, 1..max, refus par
      `InvalidCredentialsError` comme `parseDisplayName`),
      `DEFAULT_PASSKEY_NAME_KEY` (le nom affiché quand la personne n'en donne
      pas — une **clé**, pas un texte : le module ne parle aucune langue),
      `PASSKEY_REFUSAL_STATUS`, `passkeyRefusal(status)` →
      `'stale' | 'refused'`, et `describePasskeys(rows, {removable})` — la
      projection qui **recopie champ par champ**, comme `describeSessions`.
      *Test* (`src/domain/auth-rules.test.ts`) : un nom vide, blanc, ou trop
      long est refusé ; un nom valide est rogné ; `403` donne `stale` et tout le
      reste `refused` ; `describePasskeys` ne laisse sortir ni `publicKey`, ni
      `credentialID`, ni `counter`, même si la ligne les porte.
      *Mutation* : étaler la ligne (`...row`) dans `describePasskeys` — le cas
      « aucune clé publique ne sort » doit rougir.

- [x] **3. La table, la migration, l'agrégat.**
      `src/schema.ts` : `authPasskey` (`auth_passkey`), les dix champs que
      `getAuthTables` attend (recherche §2.2), **sans `updatedAt`**, clé
      étrangère `userId → auth_user.id` en cascade (ADR 018 : interne au
      module), index sur `userId`, **index unique sur `credentialID`**.
      `pnpm db:generate` → `migrations/0003_*.sql` ; `generated/schema/auth.ts`
      régénéré.
      *Test* (`tests/auth.test.ts`) : les deux cas de frontière existants —
      « ne crée sur une base vierge que les tables que le module déclare » et
      « déclare chaque champ que la bibliothèque attend » — reçoivent le greffon
      `passkey` dans leur appel à `getAuthTables`. Ils sont **rouges avant** la
      déclaration de la table.
      *Vérification* : `pnpm db:migrate` deux fois de suite ⇒ « Rien à
      appliquer » ; `pnpm db:generate` ⇒ « No schema changes ».

- [x] **4. Le greffon monté, et borné.**
      `infrastructure/better-auth-service.ts` : `AUTH_MODELS.passkey`, l'entrée
      `auth_passkey` du schéma de l'adapter Drizzle, et
      `passkey({ rpID, origin, rpName, schema })` où `rpID` est l'hôte
      d'`appUrl` et `origin` **est** `appUrl`.
      *Test* (`tests/auth.test.ts`, avec `tests/fixtures/webauthn.ts`) :
      l'enregistrement puis la connexion aboutissent par les routes du module ;
      une assertion dont `clientDataJSON.origin` est `https://evil.test`,
      **présentée avec l'en-tête `Origin: https://evil.test`**, est refusée ;
      une assertion dont le `rpIdHash` est celui d'`evil.test` est refusée.
      *Mutations* : retirer `origin: appUrl` — le cas de l'origine forgée doit
      rougir ; poser `rpID: 'evil.test'` — les cérémonies légitimes doivent
      rougir. **À annoncer honnêtement** : retirer `rpID` sans le remplacer ne
      fait rougir aucun cas. La raison, corrigée au tour de revue : ce n'est pas
      que la bibliothèque devine juste, c'est que `getRpID` lit `baseURL` — que
      ce module **épingle** à `APP_URL`. Le vrai repli (en-tête `Host`, en-têtes
      de proxy) ne s'arme que si `baseURL` disparaît, ce qui casserait du même
      coup les liens envoyés par email et les URI de rappel OAuth. Un vert
      compris, donc, et pas un trou déclaré.

- [x] **5. Quatre routes déclarées, trois non.**
      `presentation/auth-routes.ts` : `passkeyRegisterOptions` (GET,
      `authenticated`), `passkeyRegister` (POST, `authenticated`),
      `passkeyAuthenticateOptions` (GET, **public**), `passkeyAuthenticate`
      (POST, **public**). La requête d'options est **reconstruite sans sa
      requête d'URL** : `name`, `authenticatorAttachment` et `context` du client
      ne traversent pas.
      *Test* (`tests/auth.test.ts`) : `/passkey/list-user-passkeys`,
      `/passkey/delete-passkey` et `/passkey/update-passkey`, **nommés un par
      un**, répondent 404 **avec** une session valide — donc sans atteindre la
      bibliothèque ; et une requête d'options portant `?name=…` ne fait pas
      apparaître cette valeur dans les options rendues.
      *Mutation* : déclarer `/passkey/list-user-passkeys` en pass-through — 1 cas
      rouge.

- [x] **6. L'enrôlement : corps imposé, réponse réécrite, session rotée.**
      La route `passkeyRegister` reconstruit le corps —
      `{ response, name: parsePasskeyName(...), createSession: true }` : le
      `createSession` du client n'est jamais lu, et le `name` passe par la règle
      pure. La réponse de la bibliothèque **ne sort pas** (elle porte `session`,
      `user` et le `publicKey` de la ligne) : `withoutSessionToken(response, {
      status: true })`. Après succès, la session **précédente** de l'appelant
      est révoquée (`resolveSessionId` avant l'appel,
      `useCases.revokeSession` après).
      Journal : `auth.passkey_registered` / `auth.passkey_registration_refused`.
      *Test* : après enrôlement, (a) le corps rendu ne contient ni `token`, ni
      `session`, ni `user`, ni `publicKey` ; (b) **l'ancien cookie
      n'authentifie plus** et le nouveau oui ; (c) poster
      `createSession: false` rote quand même la session.
      *Mutations* : relayer la réponse de la bibliothèque — le cas (a) rougit ;
      retirer la révocation de l'ancienne session — le cas (b) rougit.

- [x] **7. La sixième exemption du crochet de second facteur.**
      `infrastructure/two-factor-challenge.ts` :
      `'/passkey/verify-registration'` rejoint
      `TWO_FACTOR_CHALLENGE_EXEMPT_PATHS`, avec sa raison écrite ; et
      `CHALLENGE_JOURNAL` reçoit `'/passkey/verify-authentication': 'passkey'`,
      `ChallengedSignInMethod` la valeur `'passkey'`.
      *Test* (`tests/auth.test.ts`) : un compte **à second facteur actif**
      enregistre une passkey et **garde une session**.
      Le cas « laisse passer les seuls chemins exemptés » de
      `two-factor-challenge.test.ts` couvre la nouvelle entrée sans être
      réécrit ; le cas canari (`/canari/sign-in`,
      `/passkey/verify-authentication`) ne bouge pas.
      *Mutation* : retirer l'exemption — le cas neuf rougit.

- [x] **8. La connexion par passkey.**
      La route `passkeyAuthenticate` : réponse réécrite en `{ status: true }`,
      refus replié sur `SIGN_IN_REFUSAL` — **le même** que la connexion par mot
      de passe, statut compris. Journal `auth.sign_in_succeeded` /
      `auth.sign_in_failed` avec `method: 'passkey'`, acteur relu par
      `actorOfSessionSetBy`.
      *Test* : un justificatif inconnu et une signature fausse rendent le
      **même** statut et le **même** corps ; une connexion réussie pose une
      session et n'expose aucun jeton.
      *Mutation* : relayer le statut de la bibliothèque — le cas
      « indistinguables » rougit.

- [x] **9. Le second facteur s'applique à la passkey.**
      La route détecte `isTwoFactorChallenge` et rend `{ twoFactor: true }`,
      cookies recopiés, **sans journaliser** (c'est le crochet qui le fait,
      tâche 7).
      *Test* (`tests/auth.test.ts`) : sur un compte protégé, la connexion par
      passkey rend `{ twoFactor: true }`, **aucune session n'existe en base**,
      et le défi posé est résolvable par un code TOTP — qui, lui, ouvre la
      session.
      *Mutation* : exempter `/passkey/verify-authentication` — le cas neuf
      **et** le cas canari de `two-factor-challenge.test.ts` doivent rougir.

- [x] **10. Le compteur de signature, et ce qu'il ne dit pas.**
      *Test* (`tests/auth.test.ts`) : une assertion présentant un compteur
      **inférieur ou égal** au compteur stocké est refusée et n'ouvre aucune
      session ; une assertion à compteur **nul**, rejouée, est acceptée deux
      fois — le cas est écrit avec son commentaire : c'est ce que le
      vérificateur fait, et aucune ligne de ce dépôt ne peut y changer quelque
      chose.
      *Mutation* : retirer la colonne `counter` de `authPasskey` — mesurer ce
      qui rougit, et l'annoncer tel quel.

- [x] **11. Renommer, révoquer, lister — le module possède les trois.**
      - `application/ports.ts` : `AuthPasskeyRepository` — `listForUser`,
        `renameForUser`, `revokeForUser` (issue `revoked | not_found |
        last-method`) ;
      - `infrastructure/drizzle-auth-repositories.ts` : colonnes **énumérées**
        (jamais `publicKey`) ; le renommage porte le propriétaire dans sa
        condition ; la révocation est **une transaction** verrouillant les
        lignes de `auth_passkey` **et** d'`auth_account` du compte, et appelle
        `canUnlinkSignInMethod(comptes + passkeys)` ;
      - `unlinkForUser` d'`auth_account` compte lui aussi les passkeys, dans la
        même transaction ;
      - `auth-use-cases.ts` : `listPasskeys`, `renamePasskey`, `revokePasskey`,
        et `listSignInMethods` dont le `removable` compte désormais les deux ;
      - routes `/auth/passkey/rename` et `/auth/passkey/revoke`
        (`authenticated`), compte pris **dans la session**, `404` pour une
        passkey qui n'est pas la sienne comme pour une inventée,
        `400 { error: 'last-method' }` pour le dernier moyen.
      Journal : `auth.passkey_renamed`, `auth.passkey_revoked`,
      `auth.passkey_revoke_refused` (ajoutés à `SecurityEventName`).
      *Tests* (`tests/auth.test.ts`) : **une passkey révoquée n'ouvre plus de
      session, immédiatement** ; la passkey d'un autre compte répond 404, jamais
      401 ni 403 ; un compte mot de passe + passkey peut retirer l'une **ou**
      l'autre, jamais les deux ; deux révocations simultanées des deux derniers
      moyens ne passent pas toutes les deux ; le renommage d'une passkey d'autrui
      répond 404 et ne renomme rien.
      *Mutations* : `canUnlinkSignInMethod` rendu toujours vrai dans le chemin
      passkey ; compter les passkeys seules (ignorer `auth_account`) ; rendre
      403 au lieu de 404 ; retirer `userId` de la condition du renommage.
      Chacune doit rougir, et le compte est annoncé.

- [x] **12. Les deux surfaces, et leurs textes.**
      `apps/web/app/account/passkey-card.tsx` (client) et
      `apps/web/app/sign-in/passkey-button.tsx` (client), montés par
      `app/account/page.tsx` et `app/sign-in/page.tsx` ;
      `apps/web/lib/auth.ts` expose `currentPasskeys()`. Catalogues `fr`/`en`
      sous `app.account.passkeys.*` et `app.signIn.passkey.*` — **clés
      entières**, jamais composées.
      *Tests* : `tests/i18n.test.ts` et `tests/rendered-text.test.ts` passent
      sans nouvelle entrée d'écran (aucun fichier de page nouveau) ;
      `tests/design-system.test.ts` reste vert.
      *Vérification visuelle* : `/account` et `/sign-in`, thèmes clair et
      sombre, 390 px et 1280 px.

- [x] **13. Le parcours navigateur.**
      `e2e/passkeys.spec.ts`, avec l'authentificateur virtuel de Chrome
      (`WebAuthn.enable`, `WebAuthn.addVirtualAuthenticator` par CDP) :
      enregistrer une passkey depuis `/account`, la voir apparaître nommée et
      datée, se déconnecter, se **reconnecter sans mot de passe**, la renommer,
      la révoquer, et constater qu'elle n'ouvre plus rien. Puis, sur un contexte
      **sans** authentificateur virtuel et WebAuthn retiré du navigateur, que le
      bouton de connexion par passkey n'est pas rendu et que le formulaire de
      mot de passe fonctionne toujours (critère 4).
      *Ce que ce parcours prouve et qu'aucun test de nœud ne prouve* : la
      cérémonie réelle du navigateur, la liaison entre le bouton et
      `navigator.credentials`, et le fait que le bouton **n'existe pas** sans
      support.

- [x] **14. La documentation qui voyage avec le code.**
      `packages/modules/auth/AGENTS.md` : une section « Les passkeys (s14) » —
      les quatre routes déclarées et les trois qui ne le sont pas, l'origine et
      le `rpId` bornés, ce que le compteur détecte **et ce qu'il ne détecte
      pas**, la sixième exemption et sa raison, la règle du dernier moyen
      étendue, et le fait qu'une passkey est un premier facteur. Aucune
      affirmation d'exhaustivité : « trouvé sur ce balayage-ci, sur ces N cas ».

---

---

## Mutations posées, et le nombre de cas rouges

Toutes restaurées **dans la commande qui les pose**, arbre vérifié propre après
chacune.

| # | Ce qui a été neutralisé | Rouges |
|---|---|---|
| 1 | `...passkey` étalé dans `describePasskeys` | **1** (domaine) |
| 2 | `origin: appUrl` retiré du greffon | **1** (origine forgée) |
| 3 | `rpID: 'evil.test'` | **17** (toutes les cérémonies) |
| 4 | `rpID` **retiré** (le repli lit `baseURL`, épinglé à `APP_URL`) | **0** — annoncé, et c'est la mesure |
| 5 | la réponse de la bibliothèque relayée à l'enrôlement | **1** (la ligne entière sortait) |
| 6 | la révocation de l'ancienne session désarmée | **2** |
| 7 | `/passkey/verify-authentication` **exempté** du crochet | **2** (intégration + canari) |
| 8 | `/passkey/verify-registration` **retiré** des exemptions | **1** |
| 9 | `SIGN_IN_REFUSAL` retiré de la connexion par passkey | **4** |
| 10 | `canUnlinkSignInMethod` toujours vrai sur le chemin passkey | **2** |
| 11 | `total` ne comptant que les passkeys | **5** (dont 2 de s12) |
| 12 | `userId` retiré de la condition du renommage | **1** |
| 13 | 403 au lieu de 404 sur la passkey d'un autre | **1** |
| 14 | `/passkey/list-user-passkeys` déclarée en pass-through | **1** |
| 15 | colonne `counter` retirée de `authPasskey` | **19** |
| 16 | `browserSupportsWebAuthn()` retiré des deux écrans | **1** (parcours) |

**La mutation 16 est d'abord restée verte, et c'est le test qui était faux.**
`toHaveCount(0)` passait avant que React n'ait rendu quoi que ce soit de
client : l'absence constatée n'était pas une absence, c'était une page pas
encore hydratée. Le cas attend désormais un bouton **actif** — les boutons
d'envoi sont désactivés jusqu'à l'hydratation — avant de constater l'absence.
Remesurée : 1 rouge.

## Vérification visuelle (tâche 12)

Faite au navigateur, serveur de développement sur `http://localhost:3115`,
authentificateur virtuel de Chrome, locale `fr-FR`. **Huit rendus** :
`/account` et `/sign-in`, en **clair** et en **sombre**, à **1280 px** et à
**390 px**. Débordement horizontal mesuré
(`scrollWidth - clientWidth`) : **0 px sur les huit**.

Quatre états de la carte observés, chacun sur une capture : liste d'une
passkey nommée, **état vide** (`EmptyState` avec son action), **renommage en
cours** (un seul champ à l'écran), et **dernier moyen de connexion** — le
mot de passe délié, le bouton « Révoquer » remplacé par la mention, ce qui
vérifie au navigateur que la règle compte bien les deux tables.

Un défaut trouvé et corrigé au navigateur, invisible en test : le bouton
« Enregistrer une passkey » s'étirait sur toute la largeur de la carte (enfant
d'une colonne flex), là où les autres cartes de l'écran gardent un bouton à sa
taille. Corrigé par un conteneur, revérifié aux quatre rendus de `/account`.

Un second, trouvé au parcours : trois contrôles nommés « Enregistrer… » sur le
même écran. Le bouton de renommage s'appelle désormais **« Enregistrer ce
nom »**.

## Ce que ce plan ne fait pas

- il ne touche ni `config/features.ts`, ni le module `organizations`, ni
  `apps/web/middleware`, ni `config/security.ts`, ni `playwright.config.ts`, ni
  `docs/STATE.md` ;
- il n'ajoute **aucun** compteur de limitation de débit : `docs/stories.md`
  attribue nommément la limitation partagée à s28, comme pour s13 ;
- il ne modifie ni `docs/security.md`, ni `docs/stories.md`, ni
  `docs/architecture.md` : aucun de leurs énoncés n'est contredit par cette
  story.
