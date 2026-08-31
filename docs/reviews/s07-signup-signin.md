# Revue — Story s07-signup-signin

Contexte frais, dépôt jamais vu. Diff jugé : `git show 8d3706a` (67 fichiers,
+5067/−58), branche `dev`. Contrat : `docs/plans/s07-signup-signin.md`
(10 tâches, interdits de parcours, « le point sur lequel tout tourne »),
`docs/research/s07-signup-signin.md`, `docs/stories.md` (treize critères),
`docs/security.md` §2 §3 §5 §7, `docs/reliability.md` §2, `AGENTS.md` racine et
par package, ADR 004, 007, 016, 017, 020.

## 1. Commandes exécutées moi-même

| Commande | État livré | État tous modules | État vide |
|---|---|---|---|
| `pnpm test` | **417 passés / 2 ignorés** (21 fichiers, 1 ignoré) | 417 / 2 | 417 / 2 |
| `pnpm lint` | vert | vert | non exécuté |
| `pnpm typecheck` | 12 tâches vertes | 12 vertes | 12 vertes |
| `pnpm build` | vert (avec l'avertissement Turbopack, §5 m5) | non exécuté | non exécuté |
| `pnpm run audit` | vert (1 avis, aucun au seuil « élevé » non couvert) | — | — |
| `pnpm test:e2e` | **11 passés** | non exécuté (trou s03 connu, `modules.spec.ts:55`) | **5 échecs / 6 passés** → §4 M3 |

Les états ont été obtenus en éditant `config/features.ts` puis en relançant
`pnpm db:generate`. L'arbre a été restauré et vérifié (`git diff --exit-code`,
plus suppression du `generated/schema/demo-disabled.ts` laissé par la
régénération) avant la rédaction. Les comptes de sonde créés en base ont été
effacés (`auth_user`/`auth_verification` en `s07-probe-%`).

## 2. Les quatre frontières, re-mesurées

**Le schéma.** Re-mesuré. Les tables créées sur un schéma PostgreSQL jetable
sont exactement celles que le contrat déclare, et chaque champ attendu par
`getAuthTables()` de la bibliothèque **installée** est confronté aux propriétés
Drizzle. Renommer la propriété `emailVerified` en `verified` dans
`packages/modules/auth/src/schema.ts` fait rougir le cas de conformité **et**
vingt autres. Le schéma est bien dans le module, généré par le baril de s04 :
`packages/modules/auth/migrations/0000_chunky_dexter_bennett.sql` contient les
quatre tables préfixées `auth_`, les deux clés étrangères restent internes au
module (ADR 018 respecté).

**Les emails.** Le port `Mailer` est le seul chemin : aucun client d'email
n'existe côté module, `emailVerification.sendVerificationEmail` est absent, et
les trois crochets (`sendResetPassword`, `sendMagicLink`, plus l'envoi de
vérification écrit à la main) passent par `useCases`. Une précision toutefois :
la formule « aucun appel réseau ne sort **pendant tous les parcours** » est
au-dessus de ce que la suite mesure. `outboundCalls` n'est asservi que dans
**un** cas (`envoie la vérification, le magic link et la réinitialisation par le
port, et rien d'autre`) ; les autres parcours réinitialisent le tableau sans
jamais l'assertionner. Et la doublure est posée en `beforeAll`, donc **après**
les imports de module : une bibliothèque qui capturerait `globalThis.fetch` au
chargement y échapperait. La mesure reste valable, sa portée est plus étroite
que son énoncé (§5 m10).

**Les routes.** Re-mesuré en direct à travers `dispatchModuleRequest` : les
douze chemins de `PATHS` sont appariés exactement, et tout le reste répond 404
sans atteindre la bibliothèque — vérifié sur `/list-sessions` (404),
`/delete-user` (404), `/ok` (404), `/update-user` (404), et sur une **méthode**
non déclarée pour un chemin déclaré (`GET /sign-in/email` → 404, pas 405,
conforme à l'ADR 017). Aucun attrape-tout.

**La session.** Cookie lu dans le vrai `Set-Cookie` (`getSetCookie()`) et dans
le bocal Playwright : `HttpOnly`, `Secure`, `SameSite=Strict`, invisible de
`document.cookie`. Passer `sameSite` à `lax` fait rougir. Rotation vérifiée dans
la forme « fixation de session » (le cookie précédent est présenté à la
connexion suivante, l'identifiant change). Révocation vérifiée côté serveur : la
ligne `auth_session` n'existe plus, et l'ancien cookie répond 401.

## 3. La justification du mécanisme écrit à la main — vérifiée dans le paquet installé

L'affirmation qui justifie d'écrire soi-même la vérification d'email est
**exacte**, ligne par ligne, dans `better-auth@1.7.2` :

- `dist/api/routes/email-verification.mjs:14` —
  `createEmailVerificationToken` est `signJWT({email, updateTo, ...}, secret, expiresIn)`.
  Aucune écriture en base : le jeton n'est ni stocké ni consommable ;
- même fichier, fin de `verifyEmail` — `if (user.user.emailVerified) { … return ctx.json({ status: true, user: null }) }`.
  Un lien déjà servi répond bien « c'est bon » ;
- rien n'invalide le JWT avant son expiration.

Le mécanisme écrit à la main n'est donc pas un risque gratuit : il est la seule
façon d'obtenir « ce lien a déjà servi » et l'invalidation des frères. Son
implémentation tient : jetons de 32 octets `randomBytes`, empreinte SHA-256
stockée, consommation par un unique `DELETE … RETURNING`, frères invalidés
**après** consommation.

Les deux autres écarts sont également fondés :
`storeToken: { type: 'custom-hasher', hash }` existe bien dans le greffon
magic-link installé (`dist/plugins/magic-link/index.mjs:33-37`), et
`changePassword` impose `revokeOtherSessions: true` côté serveur au lieu de
relayer le corps du client.

## 4. Constats

### CRITICAL

**C1 — Énumération de comptes par code de statut et par message à la connexion.**

Mesuré en direct, à travers le répartiteur :

```
POST /api/modules/auth/sign-in/email
  compte existant non vérifié → 403 {"message":"Email not verified","code":"EMAIL_NOT_VERIFIED"}
  compte inconnu              → 401 {"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}
```

Un appelant anonyme distingue donc « cette adresse a un compte » de « cette
adresse n'a pas de compte », sans authentification, en une requête. La suite le
constate elle-même sans le nommer : `tests/auth.test.ts` attend `403` sur le
compte non vérifié et compare `401` à `401` pour l'indistinguabilité, et
`apps/web/app/auth-form.tsx` porte une branche `if (status === 403)` dédiée.

Ce qui est violé :

- `docs/plans/s07-signup-signin.md`, interdit de parcours :
  « **Aucune énumération de comptes, ni par message, ni par code de statut, ni
  par temps de réponse.** » ;
- `docs/security.md` §7 : « Aucune information exploitable dans une réponse
  d'erreur publique : **pas d'énumération de comptes** » — et le préambule du
  socle : « Un manquement à ce socle est un finding **critical** en revue » ;
- `AGENTS.md` racine, *Security baseline (non-negotiable)*.

Le `packages/modules/auth/AGENTS.md` reformule la règle en la **rétrécissant**
(« un message d'erreur qui distingue un compte inconnu d'un mot de passe faux »),
ce qui rend l'écart invisible au prochain lecteur. Le critère 2 de la story
(« voit un message l'invitant à vérifier son email ») est réel et légitime, mais
il n'impose pas de le dire **à la connexion** : l'écran `/verify-email` et la
route publique `/auth/send-verification-email` — qui répond déjà de façon
indistinguable — offrent un chemin qui satisfait les deux règles. Le compromis
n'a été ni arbitré ni consigné.

Correctif attendu : rendre le refus générique (même statut, même corps) pour
`EMAIL_NOT_VERIFIED`, ou consigner l'arbitrage dans un ADR qui amende
explicitement §7. Tant que l'un des deux n'est pas fait, la porte reste ouverte
et le socle est contredit dans le module qui le porte.

### MAJOR

**M1 — Canal temporel d'énumération sur `/auth/request-password-reset`.**
Dans `better-auth@1.7.2`, `dist/api/routes/password.mjs` prend deux chemins :
compte inconnu → `generateId(24)` + une lecture de vérification factice ;
compte connu → écriture du jeton **puis**
`runInBackgroundOrAwait(sendResetPassword(...))`. Or
`dist/context/create-context.mjs:214` montre que, sans
`advanced.backgroundTasks.handler` — qui n'est pas configuré ici —,
`runInBackgroundOrAwait` fait `await promise`. L'envoi réel est donc dans le
temps de réponse. En capture locale l'écart est une écriture de fichier ; avec
l'adapter Resend (budget de 4 s, 2 essais) c'est plusieurs centaines de
millisecondes, directement mesurables. Aucun test ne chronomètre ce point
d'entrée — la mesure livrée ne couvre que `/sign-in/email`. Même interdit de
parcours, même §7.

**M2 — La règle d'ADR 020 est mise en échec par un guillemet.**
`tests/module-registry.test.ts` refuse l'import de `@repo/db` dans un module par
la regex `/from '@repo\/db'|require\('@repo\/db'\)|import\('@repo\/db'\)/`.
Mesuré :

| Sonde insérée dans `packages/modules/auth/src/infrastructure/token-factory.ts` | Garde | `pnpm lint` | `tsc --noEmit` |
|---|---|---|---|
| `import type { ModuleSchema } from '@repo/db'` | **rouge** | — | — |
| `"@repo/db"` en dépendance du manifeste | **rouge** | — | — |
| `import type { ModuleSchema } from "@repo/db"` (guillemets doubles) | **vert** | vert | vert |

Aucune autre commande ne rattrape le cas : `@repo/db` se résout depuis la racine
du dépôt, donc ni le manifeste absent ni le compilateur ne s'en émeuvent. L'ADR
020 affirme « La règle est exécutable, et pas seulement écrite : […] `pnpm test`
échoue si on la viole » — c'est vrai à une convention de style près, non
vérifiée. Le dépôt a déjà été pris à cette faute exacte
(`eslint.config.ts` : « s01 gardait cette frontière avec une expression
régulière […] un `import … from "node:fs"` passait, prouvé par mutation en
revue »). La conséquence annoncée d'une violation n'est pas une erreur de
compilation mais une `ReferenceError` intermittente dans le module le plus
sensible : la garde doit mordre. Une règle ESLint `no-restricted-imports` sur
`packages/modules/**` la rendrait insensible au lexique.

**M3 — « Socle non désactivable » est de la documentation, pas une règle — et l'état vide n'est pas vert.**
`config/features.ts` écrit : « le retirer ferait échouer la validation des
modules qui le requièrent ». Vérifié : **aucun module ne déclare
`requires: ['auth']`** (`demo-disabled` requiert `demo-enabled`, les deux autres
ne requièrent rien). Rien n'empêche donc `pnpm ks toggle` de couper `auth`.
Mesuré dans cet état : `pnpm test:e2e` **échoue, 5 cas rouges** sur
`e2e/auth.spec.ts` (les écrans `/sign-up`, `/sign-in`, `/account`,
`/forgot-password`, `/reset-password` vivent dans `apps/web` et continuent
d'être servis, mais postent vers des routes qui répondent 404). La *Definition
of Done* du plan affirme « `test:e2e` […] vert dans les trois états de
configuration » : c'est faux, et ce n'est pas le trou s03 connu.
Deux sorties possibles, aucune coûteuse : rendre la règle exécutable (validation
du registre refusant un `enabledModules` sans `auth`, ou `requires: ['auth']`
là où c'est vrai), ou consigner que l'état vide n'est plus un état valide et
corriger la DoD.

**M4 — Propriété de sécurité affirmée et fausse pour le jeton le plus sensible.**
`packages/modules/auth/src/infrastructure/token-factory.ts` : « la base ne
contient que l'empreinte SHA-256. Une copie de la table `auth_verification` ne
rend **aucun lien utilisable** » ; `application/ports.ts` : « L'empreinte
stockée : une base volée ne rend aucun lien utilisable ». C'est vrai des jetons
émis par le module et du magic link (`custom-hasher`). C'est **faux du lien de
réinitialisation de mot de passe**, que la bibliothèque écrit en clair :
`dist/api/routes/password.mjs:78`, `identifier: \`reset-password:${verificationToken}\``,
`value: user.user.id`. L'invalidation des frères du module dépend d'ailleurs
explicitement de cette forme en clair (`prefix: 'reset-password:'`,
`value: userId`) — donc la contradiction est structurelle, pas accidentelle. Une
lecture de `auth_verification` donne un lien de reprise de compte immédiatement
utilisable. La bibliothèque installée n'offre pas d'option de hachage sur ce
chemin ; la limite doit alors être **écrite** là où la propriété inverse est
affirmée, sous peine qu'un lecteur suivant s'y fie.

### MINOR

- **m1 — `e2e/modules.spec.ts` assoupli.** Passer de `toBe(200)` à
  `not.toBe(404)` va au-delà du besoin invoqué : une route déclarée `public` qui
  répondrait 401 ou 500 passe désormais la garde « la route publique d'un module
  activé est servie ». Le motif est réel (les trois routes GET publiques d'`auth`
  redirigent ou refusent sans paramètre) mais l'assertion pouvait rester
  discriminante — `expect(status).not.toBe(404)` **et** `not.toBe(401)`, ou
  `toBeLessThan(500)`. Ce n'est pas la garde de modularité (celle-ci est le cas
  suivant, inchangé et toujours strict), donc l'affaiblissement est borné.
- **m2 — Événement de sécurité déclaré et jamais émis.**
  `SecurityEventName` porte `auth.password_changed` ; aucune émission dans le
  dépôt, et la route `/auth/change-password` ne journalise rien. §7 n'exige pas
  nommément le changement de mot de passe, mais un membre d'énumération mort
  suggère une couverture qui n'existe pas.
- **m3 — Traductions du module déclarées et inutilisées.** `signIn.title`,
  `signUp.title`, `error.invalidCredentials`, `error.emailNotVerified` ne sont
  lues nulle part : les écrans écrivent leurs chaînes en dur et
  `auth-form.tsx` redéfinit les deux messages d'erreur. L'i18n est s09, mais la
  duplication est déjà là.
- **m4 — `auth_user.name` reçoit l'adresse email**
  (`withBody(request, { ...input, name: input.email })`). Le formulaire ne
  demande pas de nom ; la colonne devient une seconde copie de l'adresse.
- **m5 — Trace de build non bornée (défaut s06 remonté à la surface).**
  `apps/web/lib/mailer.ts` construit son dossier de capture par
  `join(process.cwd(), LOCAL_MAIL_DIRECTORY)`. Depuis que `lib/auth.ts` importe
  `lib/mailer.ts`, ce chemin est sur le graphe serveur de `app/sign-up/page.tsx`
  et de `app/api/modules/[...path]/route.ts`, et Turbopack le signale au build
  (« make sure the path is statically scoped to some subfolder »). Le build
  reste vert. Gravité **minor** et non major : c'est du poids et une trace de
  sortie imprécise, pas un défaut de comportement ni une fuite démontrée — mais
  la sortie serveur d'un déploiement n'est plus bornée, ce qui mérite un
  correctif court (sous-dossier statique, ou capture montée seulement quand le
  drapeau est posé).
- **m6 — `@repo/db` tire désormais `better-auth`.** Conséquence assumée mais non
  consignée d'ADR 020 : `generated/schema/auth.ts` réexporte depuis
  `@repo/module-auth`, donc tout consommateur de `@repo/db` — `pnpm db:migrate`,
  `pnpm db:seed`, `/api/health` — charge la bibliothèque d'authentification.
- **m7 — ADR 004 devenu inexact.** Il écrit « Le schéma des tables
  d'authentification est **généré par Better Auth** ». Il est ici écrit à la
  main et épinglé par un test contre `getAuthTables()`. Le choix est meilleur ;
  le texte de l'ADR ne le dit plus (`AGENTS.md` : « Docs ship with the code that
  changes them »).
- **m8 — Un « port » qui lève.** `application/auth-service.ts` se déclare port
  et lève `AuthNotConfiguredError` en rendant des `Response`, là où la règle
  racine dit « A port never throws — it returns a discriminated result ». La
  règle vise les ports d'infrastructure externe (s06) ; l'appellation reste
  trompeuse.
- **m9 — `SameSite=Strict` et les liens ouverts depuis une boîte email.** Le
  socle §1 l'exige, c'est donc conforme. Mais un magic link ou un lien de
  vérification cliqué dans un webmail est une navigation inter-sites : le cookie
  fraîchement posé peut ne pas accompagner la redirection vers `/account`, et
  l'utilisateur atterrit déconnecté. Le parcours Playwright ne l'exerce pas
  (`page.goto` équivaut à une saisie dans la barre d'adresse, qui est
  same-site). À vérifier à la main.
- **m10 — Portée de la doublure `fetch`.** Voir §2 : une seule assertion, et une
  pose en `beforeAll` postérieure aux imports.

## 5. Mutations pratiquées (et restaurées)

Chaque mutation a été défaite et l'arbre vérifié (`git diff --exit-code`) ; la
mutation dans `node_modules` a été restaurée par copie et confirmée par
empreinte MD5 identique.

| Invariant neutralisé | Où | Rouges |
|---|---|---|
| Hachage factice sur compte inconnu (**dans `better-auth` installé**) | `dist/api/routes/sign-in.mjs` | **1** — *uniquement* le cas de chronométrage ; le cas « même réponse, même statut » reste **vert**. Les deux moitiés confirmées. |
| `DELETE … RETURNING` → lecture puis suppression | `drizzle-auth-repositories.ts` | **1, trois fois sur trois** (3 exécutions successives). La course mord désormais de façon déterministe. |
| `sameSite: 'strict'` → `'lax'` | `better-auth-service.ts` | 1 |
| `revokeOtherSessions: true` → `false` | `better-auth-service.ts` | 1 |
| `invalidateSiblings` rendu inerte | `drizzle-auth-repositories.ts` | 2 (magic link frère, réinitialisation frère) |
| Garde `emailVerified` de `sessionOf` retirée | `domain/session.ts` | 1 — *unitaire seulement*. Aucun cas d'intégration n'éprouve la « seconde serrure » indépendamment, la bibliothèque refusant déjà en amont. |
| Filtrage du journal supprimé | `domain/security-event.ts` | 2 (tâche 9 du plan : « prouvé par mutation » — satisfait) |
| Liste blanche de redirection supprimée | `domain/redirect.ts` | 4 |
| Propriété `emailVerified` renommée dans le schéma | `schema.ts` | 21 (dont la conformité `getAuthTables()`) |
| Import `'@repo/db'` dans un module | `token-factory.ts` | 1 |
| `@repo/db` en dépendance du manifeste du module | `package.json` | 1 |
| Import `"@repo/db"` **guillemets doubles** | `token-factory.ts` | **0** → constat M2 |

La mutation verte que l'implémenteur signale (la course à deux clics simultanés,
rouge une fois sur trois avant correction) est **refermée** : mesurée trois fois,
rouge trois fois.

Sonde de type et d'exécution ajoutée puis retirée : `db.query.authUser.findMany`
compile et s'exécute contre la base réelle. Le résidu s04 est donc réellement
fermé, et l'apport annoncé par ADR 020 est vérifié, pas seulement écrit.

## 6. Écarts au plan, jugés

- **`config/features.ts` édité malgré l'interdit** — deux lignes plus un
  commentaire. L'interdit est écrit « ne pas toucher au mécanisme » dans son
  esprit, et un module socle doit bien être monté quelque part ; la tâche 1 du
  plan l'implique. **Acceptable.**
- **Génération de barils de s04 étendue** — l'interdit l'exclut, la tâche 2
  l'exige explicitement (« il doit aussi résoudre `enabledModuleSchemas = []` […]
  le baril de s04 est déjà l'endroit qui sait le faire »). Contradiction interne
  au plan ; la tâche, plus précise, l'emporte. **Acceptable**, et l'extension est
  propre (agrégat versionné, comparé à sa régénération par un test).
- **Trois fichiers de test au lieu de deux** — les trois portent des assertions
  réelles, aucun n'est décoratif. **Acceptable.**
- **`AUTH_SECRET` / `APP_URL` optionnelles au schéma, exigées par ce qui monte
  l'authentification** — forme G3 de s06 respectée à la lettre, `min(32)` et URL
  http(s) absolue validées par Zod, garde de démarrage éprouvée dans les deux
  sens et neutralisée pendant `next build` et sous `SKIP_ENV_VALIDATION`.
  **Bon.**
- **`APP_URL` obligatoire plutôt que déduite du `Host`** — le raisonnement est
  juste : la déduction est un vecteur de lien de réinitialisation empoisonné.
  **Bon.**
- **`e2e/modules.spec.ts` assoupli** — voir m1 : justifié dans son motif, plus
  large que nécessaire dans sa forme.
- **ADR 020** — jugé recevable. Le renversement de `packages/db/AGENTS.md` est
  argumenté (le typage de `db.query.<table>` exige une connaissance statique),
  les quatre options rejetées le sont pour des raisons vérifiables — j'ai
  confirmé que l'injection à l'exécution perdrait le type et que le cycle
  inverse serait un défaut d'ordre d'initialisation, pas de compilation. La
  contrepartie est bien écrite dans les deux `AGENTS.md` concernés et le fichier
  `packages/db/src/schema.ts`. Seule la **mise en œuvre** de la garde est
  perméable (M2).
- **ADR 017** — le besoin de segment dynamique s'est présenté (le lien
  `/reset-password/<jeton>` de la bibliothèque) et a été **contourné par
  conception** (jeton en paramètre de requête vers l'écran, qui le repasse à la
  route déclarée), pas par un second routeur. C'est la bonne réponse dans une
  story qui n'a pas le droit d'introduire Hono ; l'ADR nomme ce besoin comme
  « le signal d'introduire Hono », et le signal a été traité par un
  contournement légitime. À noter pour la story qui introduira Hono, pas un
  constat.

## 7. Les treize critères

| Critère | Statut | Preuve |
|---|---|---|
| Inscription + email de vérification | ✅ | `tests/auth.test.ts`, `e2e/auth.spec.ts` |
| Compte non vérifié bloqué + message | ✅ (mais voir **C1**) | 403 + `sessionOf` |
| Lien de vérification ; expiré/consommé explicite | ✅ | 3 cas, dont l'expiration forcée en base |
| Magic link à usage unique | ✅ | premier lien refusé après le second |
| Message générique identique | ⚠️ **partiel** | vrai pour inconnu/mauvais mot de passe, faux pour non vérifié (**C1**) |
| Réinitialisation invalidant les liens frères | ✅ | mutation → 2 rouges |
| Déconnexion révoquant la session | ✅ | ligne supprimée + 401 côté serveur |
| Redirection puis retour à l'URL demandée | ✅ | e2e |
| Rotation à l'élévation de privilège | ✅ | forme fixation de session |
| Cookie `HttpOnly`/`Secure`/`SameSite` | ✅ | `Set-Cookie` réel + bocal Playwright |
| Changement mot de passe/email → révocation | ✅ | compté en base ; mutation → rouge |
| Événements journalisés sans secret | ✅ | mutation → 2 rouges |
| Temps de réponse indistinguable | ⚠️ **partiel** | prouvé sur `/sign-in/email` ; **M1** sur `/request-password-reset` |

## 8. Ce que je n'ai **pas** pu vérifier

Cette liste dit ce qui a été balayé, pas ce qui existe.

- **Un vrai fournisseur d'email.** Tout a tourné en capture locale ou avec la
  doublure d'enregistrement. Le comportement de l'adapter Resend sous panne
  réelle, et l'écart temporel de M1 en conditions réseau, ne sont pas mesurés.
  *Geste humain* : une passe avec une clé de test Resend, chronomètre en main sur
  `/auth/request-password-reset` avec une adresse connue puis inconnue.
- **Un lien ouvert depuis une vraie boîte email** (Gmail, Outlook web). C'est le
  seul contexte où `SameSite=Strict` peut faire perdre la session posée par
  `/magic-link/verify` (m9). Playwright navigue par `page.goto`, ce qui ne
  reproduit pas une navigation inter-sites.
  *Geste humain* : s'envoyer un magic link, l'ouvrir depuis un webmail, vérifier
  qu'on atterrit connecté sur `/account`.
- **Le contenu réel de la sortie de build.** `pnpm build` est vert et
  l'avertissement Turbopack est reproduit, mais je n'ai pas ouvert
  `.next/standalone` pour savoir ce que la trace non bornée y embarque (m5).
  *Geste humain* : `next build` puis inspection de la trace de fichiers,
  notamment la présence ou non de `.env` et des sources du dépôt.
- **`pnpm test:e2e` dans l'état « tous modules activés ».** Non exécuté ; le
  trou est annoncé comme pré-existant à s03 (`e2e/modules.spec.ts:55`,
  `expect(disabledModules.length).toBeGreaterThan(0)`), et la lecture du fichier
  le confirme — son propre commentaire ne revendique que **deux** états, pas
  trois. `pnpm test`, `pnpm lint` et `pnpm typecheck` y sont verts, mesurés.
- **La durée de vie des sessions.** `sessionTtlSeconds` (7 jours) et
  `sessionRefreshAfterSeconds` (1 jour) ne sont exercés par aucun test : rien ne
  prouve qu'une session expire ni que le rafraîchissement se déclenche.
  *Geste humain* : une recette avec `expiresAt` reculé en base.
- **Le verrouillage progressif par compte et par IP** (`docs/security.md` §2) et
  **la limitation de débit** (§7) sont absents. Le socle les renvoie
  explicitement à s28 ; ils ne sont pas un manquement de cette story, mais les
  points d'entrée `/sign-up/email`, `/send-verification-email`,
  `/sign-in/magic-link` et `/request-password-reset` sont aujourd'hui des
  amplificateurs d'email non bridés.
- **`docs/security.md` §1 (en-têtes et CSP).** Aucun en-tête de sécurité n'existe
  dans le dépôt (`Content-Security-Policy` absent partout). Hors du périmètre
  nommé par ce plan (§2, §3, §5, §7), donc pas un constat de s07 — mais c'est une
  dette ouverte du socle, à ne pas oublier.
- **Le rendu des écrans.** Aucun navigateur n'a été piloté à la main ; je m'en
  remets aux parcours Playwright, qui vérifient les URL, les rôles ARIA et le
  cookie, pas l'apparence.

## 9. Conclusion

Le travail est d'une qualité inhabituelle : la frontière avec Better Auth est
réellement tenue et réellement mesurée, les trois affirmations sur la
bibliothèque installée sont exactes, les invariants centraux mordent tous à la
mutation, et la course qui restait verte est refermée de façon déterministe.
ADR 020 est un bon ADR — le renversement est justifié, les options rejetées le
sont pour de vraies raisons, et l'apport (`db.query.<table>` typé) est vérifié.

Ce qui bloque n'est pas une faiblesse de l'implémentation mais une règle
explicitement écrite dans le plan et dans le socle, contredite par le code et
masquée par une reformulation plus étroite dans la documentation locale : un
appelant anonyme distingue un compte existant d'un compte inconnu, par code de
statut et par message. Sur la story qui pose l'authentification d'un
boilerplate, cette porte-là doit être fermée ou l'arbitrage consigné avant de
livrer.

Verdict de cette première passe : **gravité maximale `critical`, livraison
refusée** (C1). Le verdict qui fait foi pour la porte de livraison est celui de
la seconde passe, en fin de fichier.

---

# Seconde passe — commit correctif `7ced9c6`

Contexte frais, dépôt jamais vu, première passe lue mais non rejouée. Diff jugé :
`git diff 8d3706a..7ced9c6` (27 fichiers, +748/−90). Périmètre assigné : C1, M1,
M2, M3, M4 de la première passe, plus les écarts déclarés.

## 1. Commandes exécutées moi-même

| Commande | État livré | Tous modules | Socle seul (`enabledModules = ['auth']`) |
|---|---|---|---|
| `pnpm typecheck` | 12 vertes (relancé `--force`) | 12 vertes | 12 vertes |
| `pnpm lint` | vert | vert | vert |
| `pnpm test` | **438 passés / 2 ignorés** (21 fichiers, 1 ignoré) | 438 / 2 | 438 / 2 |
| `pnpm test:e2e` | **11 passés** | 10 passés / **1 rouge** — `modules.spec.ts:55`, trou s03 connu, hors périmètre | **11 passés** |
| `pnpm build` | vert | vert | vert |
| `pnpm run audit` | vert (1 avis, aucun au seuil « élevé » non couvert) | vert | — |
| `pnpm db:generate` / `db:migrate` | verts | verts | verts |

Les trois états ont été obtenus en éditant `config/features.ts` puis en
relançant `pnpm db:generate`. L'arbre a été restauré et vérifié
(`git diff --exit-code`, `git status --porcelain` vide) avant la rédaction, y
compris les barils générés ; les comptes de sonde (`zzprobe-%`) ont été effacés
de `auth_user` et `auth_verification`.

**Le troisième état d'ADR 021 est vert, mesuré** : configuration réduite au
socle, 438 tests, **11 parcours Playwright**, lint, typecheck, build, génération
et migrations. L'ADR ne se contente pas de redéfinir les trois états, il en
livre un qui passe.

## 2. C1 — refermé, et le raffinement de l'implémenteur est exact

**Les trois cas, re-mesurés moi-même**, d'abord contre la bibliothèque
(`service.handle`, avant réécriture), puis à travers le répartiteur :

```
BIBLIOTHÈQUE  compte inconnu                    → 401 {"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}
              mot de passe faux / non vérifié   → 401 {"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}
              bon mot de passe / non vérifié    → 403 {"message":"Email not verified","code":"EMAIL_NOT_VERIFIED"}

ROUTE         les trois                         → 401 {"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}
                                                  en-têtes identiques : [["content-type","application/json"]]
```

La cause est bien où l'implémenteur la situe : `better-auth@1.7.2`,
`dist/api/routes/sign-in.mjs`, la branche
`if (requireEmailVerification && !user.emailVerified)` est **après**
`await ctx.context.password.verify(...)` — j'ai lu les lignes. **La première
passe a donc énoncé C1 plus largement que les faits** : ce n'était pas une
énumération anonyme en une requête, mais un **oracle de bourrage
d'identifiants**, atteignable seulement en connaissant déjà le mot de passe. Le
correctif ferme la porte quand même, et le commentaire de
`domain/credentials.ts` écrit la nuance au lieu de la gommer. C'est la bonne
manière de corriger un constat surestimé.

**Le 5xx passe bien.** `genericSignInRefusal` ne réécrit que 401 et 403 ; tout
le reste — 200, 400, 500, 502 — traverse tel quel, et une panne reste une panne
(`docs/reliability.md` §2). Deux mutations le prouvent dans les deux sens :

| Invariant neutralisé | Rouges |
|---|---|
| `genericSignInRefusal` rend toujours `null` (la réponse de la bibliothèque repasse) | **6** — dont les trois cas d'intégration, le parcours e2e des trois états, et la matrice unitaire |
| `genericSignInRefusal` élargi à `status >= 400` (une panne déguisée en refus) | **1** — `ne masque pas ce qui ne parle pas du compte` |

Le journal, lui, garde le statut réel de la bibliothèque : la ligne
`auth.useCases.log(...)` est **avant** la réécriture. Vérifié dans le fichier.

Le chemin de compensation nommé par le correctif tient : la route publique
`/auth/send-verification-email` appelle `useCases.sendVerificationEmail` **sans
brancher sur l'existence du compte** — un jeton est émis et un email part dans
tous les cas. Réponse, statut et temps sont donc indistinguables par
construction, et pas par accident.

## 3. M1 — refermé, chiffres à l'appui

`advanced.backgroundTasks.handler` existe réellement :
`dist/context/create-context.mjs:211-221` — sans lui, `runInBackgroundOrAwait`
fait `await promise`. `after` est bien exporté par `next@16.3.3`
(`next/server.d.ts:21 → export { after } from 'next/dist/server/after'`).

Écart re-mesuré moi-même, mailer retardé à 120 ms, médiane sur 5 essais :

| État | Écart connu / inconnu |
|---|---|
| Livré | **0,19 ms** |
| `backgroundTasks: { handler }` retiré (mutation) | **119,29 ms** — soit exactement le retard du mailer, et exactement le chiffre annoncé |

La mutation fait rougir **1** cas, et c'est le bon. **L'email différé atterrit
vraiment** : le parcours Playwright `mot de passe oublié` passe par le vrai
serveur Next, attend jusqu'à 10 s la capture locale, lit le lien et s'en sert
pour changer le mot de passe — il est vert dans les trois états de
configuration. Ce n'est pas la doublure de la suite qui le prouve, c'est
l'application.

Le crochet est global à la bibliothèque, pas au seul mot de passe oublié : j'ai
balayé les vingt appels à `runInBackgroundOrAwait` dans `dist`. Sur les douze
routes déclarées par le module, **un seul** est atteignable
(`password.mjs:83`) — `sign-in.mjs:346` exige `emailVerification.sendOnSignIn`,
non configuré ; `sign-up.mjs:254` exige `emailVerification.sendVerificationEmail`,
non configuré (le module envoie lui-même) ; `update-user.mjs:482` n'est pas
déclarée, `/change-email` étant servie par le module. L'affirmation « un seul
appelant aujourd'hui » du `AGENTS.md` est donc juste, sur ces vingt sites.

## 4. M2 — la garde mord enfin, mais elle a deux nouveaux trous

**La sonde de la première passe est refermée.**
`import type { ModuleSchema } from "@repo/db"` en guillemets doubles, dans
`packages/modules/auth/src/infrastructure/` : `pnpm lint` **rouge** (message
nommant l'ADR 020), `tests/module-registry.test.ts` **rouge**. Le passage d'une
expression régulière à un sélecteur AST était la bonne décision, et l'insistance
sur `no-restricted-syntax` plutôt que `no-restricted-imports` est justifiée —
`libraryConfig` occupe déjà le second sur `packages/**`, le redéfinir
l'écraserait. J'ai vérifié.

**Mais j'ai défait la nouvelle garde, deux fois.** Sondes posées dans le module
`auth`, chacune vérifiée sur `pnpm lint`, `tsc --noEmit` du package, et
`pnpm test` :

| Sonde | `pnpm lint` | `tsc --noEmit` | `tests/module-registry.test.ts` |
|---|---|---|---|
| `import type { ModuleSchema } from "@repo/db"` (guillemets doubles, `.ts`) | **rouge** | — | **rouge** |
| ``export const load = async () => await import(`@repo/db`)`` (littéral gabarit, `.ts`) | **vert** | **vert** | **vert** |
| `import { getDatabase } from "@repo/db"` dans un fichier **`.tsx`** du module | **vert** | **vert** | **vert** |

- Le sélecteur est `ImportExpression > Literal[value=/…/]`. Un
  `TemplateLiteral` n'est pas un `Literal` : l'import dynamique en accents
  graves traverse. Le commentaire d'`eslint.config.ts` revendique pourtant que
  les cinq sélecteurs couvrent « l'import dynamique », sans réserve — c'est
  précisément la revendication d'exhaustivité que `AGENTS.md` interdit
  (« Never claim exhaustiveness […] say what was swept »). `require` en accents
  graves, lui, est rattrapé par `@typescript-eslint/no-require-imports` ; ce
  n'est pas la garde d'ADR 020 qui le tient.
- La portée est `packages/modules/**/*.ts`, qui **ne couvre pas `.tsx`**, et le
  balayage de `tests/module-registry.test.ts` ne collecte que `.ts`
  (`entry.name.endsWith('.ts')`). Or `docs/architecture.md` place les composants
  React dans le `presentation/` de chaque module : le premier module qui livrera
  un composant sortira du périmètre de la règle **en silence**. Aucun module
  n'en a aujourd'hui — c'est pour ça que le trou est invisible, pas pour ça
  qu'il n'existe pas. (Contexte, hors périmètre de ce correctif : les règles de
  frontières de couches et `libraryConfig` visent elles aussi `packages/**/*.ts`
  et manqueront le même fichier.)

Deux autres contournements existent — `import('@repo/' + 'db')` et un
`createRequire` aliasé — mais ils ne se tapent pas par accident et ne rendent
rien de typé ; je les cite pour dire ce qui a été balayé, pas pour les compter.

Ce constat vaut ce que valait M2 : la règle est **exécutable dans sa forme
courante et sur les fichiers `.ts`**, et la formulation du commentaire promet
plus. **major** — cadré, non silencieusement corrupteur, et le cas le plus
plausible (le guillemet) est fermé.

## 5. M3 — c'est devenu une règle, et elle refuse par le nom

Tentatives de couper `auth`, toutes celles que j'ai trouvées :

| Geste | Résultat |
|---|---|
| `pnpm ks toggle auth` | **refusé**, code 1, nomme « auth » et « socle » |
| `npx ks toggle auth --json` | refusé, code 1, message sur `stderr` |
| `npx ks toggle auth --with-requires` | refusé |
| `npx ks toggle auth --apply-migrations` | refusé |
| après chacun : `git status` | `config/features.ts` **intact** — le refus précède l'écriture |
| `config/features.ts` édité à la main, puis `pnpm db:generate` | **échoue**, `ModuleConfigurationError`, nomme « auth » |
| idem, `pnpm db:migrate` | **échoue**, même message |
| idem, `pnpm build` | **échoue** à la collecte de `/` et `/sign-in`, même message |

Trois points de composition en production (`apps/web/lib/module-registry.ts`,
`packages/db/src/scripts/generate.ts`, `.../migrate.ts`) — j'ai balayé le dépôt
pour `buildRegistry(` et `resolveEnabledModules(` : ce sont les seuls hors
tests, et les trois passent `required`. Le CLI est le quatrième.

Mutations :

| Invariant neutralisé | Rouges |
|---|---|
| Boucle `for (const id of configuration.required ?? [])` rendue inerte (`validate.ts`) | **5** |
| `requiredModules = []` dans `config/features.ts` | **1** — `refuse la configuration du dépôt privée de son socle` ; et `ks toggle auth` **réussit** alors, ce qui prouve que c'est bien cette liste qui arme la règle |

Le maillon que la première passe réclamait — « que `config/features.ts` arme
réellement la règle » — est donc lui-même testé. Le refus d'un socle absent de
l'annuaire (`required: ['auht']`) est un bon réflexe : sans lui une faute de
frappe désarmerait tout en silence.

## 6. M4 — la limite est vraie, écrite au bon endroit, et l'arbitrage tient

Vérifié dans le paquet installé, pas dans la documentation :

- `dist/api/routes/password.mjs:75-79` — `const verificationToken = generateId(24)`
  puis `identifier: \`reset-password:${verificationToken}\``, `value: user.user.id`.
  Le jeton est bien stocké **en clair**, et c'est le même que celui de l'URL
  (ligne 82). La propriété inverse, telle qu'elle était écrite, était fausse ;
  elle est maintenant bornée aux jetons de la fabrique, et la limite est écrite
  **là où la propriété était affirmée**.
- `generateId(24)` = `createRandomStringGenerator('a-z','A-Z','0-9')(24)`, soit
  ~142 bits : rien à deviner, le risque est bien un accès en lecture à la base
  et rien d'autre.
- TTL réellement câblé : `resetPasswordTokenExpiresIn: policy.passwordResetTtlSeconds`,
  et `passwordResetTtlSeconds: 60 * 30` dans `domain/auth-policy.ts`.

L'arbitrage — accepté, borné par 30 minutes, usage unique, invalidation des
frères, et « à reprendre » nommément — est proportionné. **Je ne l'escalade
pas** : la propriété n'est plus affirmée à tort, et la conséquence exacte est
écrite. Une réserve tout de même, en m3 ci-dessous.

## 7. Les écarts déclarés, jugés

- **Le CLI touché malgré le DO-NOT (~20 lignes).** Justifié, et je l'ai vérifié
  plutôt que cru : sans le fil `required` de `bin.ts` jusqu'à `planToggle`, la
  règle était armée dans `@repo/core` et jamais atteinte par la commande qui
  peut la violer — `ks toggle auth` aurait écrit le fichier, puis échoué plus
  loin à la régénération, avec un message qui ne parle pas du socle. Le
  changement est additif (`required?` facultatif partout), le CLI ne rejoue pas
  la règle mais soumet la configuration candidate à la validation, et le refus
  précède l'écriture — mesuré. **Acceptable.**
- **`config/features.ts` édité.** C'est le fichier que le propriétaire du projet
  édite, et le seul endroit correct pour une décision de produit. ADR 021 rejette
  les quatre alternatives pour des raisons que j'ai pu contrôler : j'ai confirmé
  qu'**aucun module ne déclare `requires: ['auth']`**, donc l'option « déclarer
  le requis » ne protégeait rien dans l'état livré. **Acceptable.**
- **`apps/web/lib/auth.ts` branché sur `after` sans qu'on le demande.** Bonne
  API, bon endroit (le seul fichier de l'application qui connaît le module), et
  le résultat est prouvé par le parcours navigateur. **Acceptable.**
- **Garde régulière remplacée plutôt que réparée.** Le principe est le bon — le
  dépôt s'est fait prendre deux fois par des gardes textuelles. L'exécution est
  incomplète : voir §4. **Acceptable dans le principe, incomplet dans le fait.**
- **`tests/auth.test.ts` : mailer retardable et collecteur de tâches.** Les deux
  sont nécessaires — sans retard le chronomètre ne voit rien, sans collecteur la
  suite ne sait pas quand l'email est parti. Le collecteur n'introduit pas de
  course : j'ai vérifié que **les six** appels à `/request-password-reset` du
  fichier sont chacun suivis d'un `settled()`. **Acceptable.**
- **DoD du plan.** « verts dans les trois états de configuration » est
  redéfinie par ADR 021 (livré / tous modules / socle seul) et non annotée dans
  `docs/plans/s07-signup-signin.md`. L'ADR l'écrit, et j'ai éprouvé les trois
  états ; c'est une dérive de documentation, pas de code (m4).

## 8. Constats de cette passe

### MAJOR

**N1 — La garde d'ADR 020 est défaite par un accent grave, et ignore `.tsx`.**
Détail et mesures en §4. Deux sorties, aucune coûteuse : ajouter les sélecteurs
`ImportExpression > TemplateLiteral[quasis.0.value.raw=…]` (et le réexport
équivalent), et élargir la portée à `packages/modules/**/*.{ts,tsx}` **des deux
côtés** — la règle d'`eslint.config.ts` et le collecteur `sourceFiles` de
`tests/module-registry.test.ts`. Corriger aussi la phrase du commentaire, qui
revendique une couverture de « l'import dynamique » qu'elle n'a pas.

### MINOR

- **m1 — `ks list` ne dit pas qui est socle.** `auth` s'y affiche « activé »
  comme les autres ; la colonne existe déjà pour « requis par ». Un utilisateur
  découvre la règle en se faisant refuser, alors que la liste est l'endroit où
  la lire. ADR 021 annonce un mécanisme générique : la prochaine entrée héritera
  du même angle mort.
- **m2 — `FAILED_TO_CREATE_SESSION` devient `INVALID_EMAIL_OR_PASSWORD`.** La
  bibliothèque rend déjà cet échec en 401, donc la réécriture ne change pas le
  statut ; mais le journal n'enregistre que `status`, et un échec de création de
  session y est désormais indiscernable d'un mauvais mot de passe pour
  l'exploitant. Étroit, et sans conséquence pour l'appelant.
- **m3 — Une revendication d'exhaustivité de trop dans `token-factory.ts`.**
  « vérifié : `storeToken` n'existe que dans le greffon magic-link » est faux :
  `dist/plugins/one-time-token/index.mjs:12-17` l'expose aussi. Aucun des deux
  n'est sur le chemin de la réinitialisation, donc la conclusion tient — mais
  c'est la formulation que `AGENTS.md` interdit nommément, dans le fichier même
  qui corrige une affirmation trop large. Écrire « sur les greffons balayés,
  `storeToken` apparaît dans magic-link et one-time-token, et sur aucun chemin
  de `emailAndPassword` ».
- **m4 — La DoD du plan n'a pas suivi ADR 021.** Voir §7. `AGENTS.md` :
  « Docs ship with the code that changes them ».
- **m5 — ADR 020 pointe vers l'ancien domicile de la règle.** Sa ligne 19 dit
  que `tests/module-registry.test.ts` refuse l'import ; la règle vit désormais
  dans `eslint.config.ts` et le test délègue. Les ADR sont immuables, donc c'est
  inhérent — mais `packages/db/AGENTS.md` est l'endroit vivant où le redresser.
- **m6 — Un 500 s'affiche « Demande invalide ».** `messageFor` d'`auth-form.tsx`
  n'a de branche que pour 401 et 502 ; une panne serveur atterrit dans le défaut
  « Vérifiez les informations saisies », qui accuse l'utilisateur. Forme
  préexistante, mais c'est ce commit qui fait du passage des 5xx une propriété
  revendiquée.

Les constats de la première passe non assignés à ce correctif (m1 à m10) n'ont
pas été rejugés et restent ouverts.

## 9. Mutations pratiquées (et restaurées)

Chaque mutation a été défaite et l'arbre vérifié (`git diff --exit-code` et
`git status --porcelain` vide). Aucune mutation dans `node_modules` cette
passe : les affirmations sur la bibliothèque viennent de la lecture de `dist` et
d'une sonde exécutée contre le vrai service.

| Invariant neutralisé | Où | Rouges |
|---|---|---|
| `genericSignInRefusal` → toujours `null` | `domain/credentials.ts` | **6** |
| `genericSignInRefusal` → `status >= 400` | `domain/credentials.ts` | **1** (le cas « ne masque pas une panne ») |
| `backgroundTasks: { handler }` retiré | `better-auth-service.ts` | **1** — écart remonté à 119,29 ms |
| Validation du socle rendue inerte | `packages/core/src/validate.ts` | **5** |
| `requiredModules = []` | `config/features.ts` | **1**, et `ks toggle auth` réussit alors |
| Import `"@repo/db"` guillemets doubles | module `.ts` | **rouge** (lint + suite) — sonde de la 1re passe refermée |
| Import dynamique `` `@repo/db` `` en accents graves | module `.ts` | **0** → constat N1 |
| Import `"@repo/db"` dans un fichier `.tsx` | module `.tsx` | **0** → constat N1 |
| Seuil du chronomètre abaissé à 0 (pour lire l'écart livré) | `tests/auth.test.ts` | écart mesuré : **0,19 ms** |

Aucun test décoratif dans ce diff : les treize cas ajoutés portent tous une
assertion de comportement, et les deux cas négatifs de `tests/lint-rules.test.ts`
(le module a le droit d'importer `@repo/core`, le point de composition a le
droit d'importer `@repo/db`) empêchent la règle d'être vraie pour la mauvaise
raison. Le cas de `bin.test.ts` va jusqu'au binaire et vérifie que le fichier
n'a pas bougé — c'est la bonne forme.

## 10. Ce que je n'ai **pas** pu vérifier

Cette liste dit ce qui a été balayé, pas ce qui existe.

- **Un vrai fournisseur d'email.** Le 0,19 ms est mesuré avec un mailer
  artificiellement retardé de 120 ms, en local, un client à la fois. L'écart
  sous latence réseau réelle et sous charge n'est pas mesuré.
  *Geste humain* : une passe avec une clé de test Resend, chronomètre sur
  `/auth/request-password-reset`, adresse connue puis inconnue, plusieurs
  clients en parallèle.
- **`after` sur un vrai hébergeur.** Tout a tourné contre le serveur Next local
  piloté par Playwright. C'est précisément le cas « le processus gèle dès la
  réponse rendue » que `after` est censé couvrir qui n'est pas éprouvé.
  *Geste humain* : déployer une préversion (Vercel), demander une
  réinitialisation, vérifier que l'email arrive **et** chronométrer connu contre
  inconnu sur l'URL déployée.
- **Le rendu des écrans.** Aucun navigateur piloté à la main. La nouvelle phrase
  de refus et le lien « Adresse non vérifiée » de `/sign-in` ne sont vérifiés
  que par leurs rôles ARIA et leur texte dans Playwright.
  *Geste humain* : ouvrir `/sign-in`, se tromper de mot de passe, lire ce que
  voit l'utilisateur, suivre le lien jusqu'au renvoi d'un lien de vérification.
- **Le trou `.tsx` en conditions réelles.** Démontré avec un fichier synthétique
  que j'ai supprimé ; aucun module ne livre de composant aujourd'hui. La
  conséquence est future, pas actuelle.
- **`e2e/modules.spec.ts:55` dans l'état « tous modules ».** Rouge, annoncé
  pré-existant à s03 et hors périmètre ; je l'ai constaté, pas instruit.
- **Tout ce que la première passe n'a pas pu vérifier** reste non vérifié :
  lien ouvert depuis un vrai webmail (`SameSite=Strict`), contenu de la trace de
  build, durée de vie des sessions, verrouillage progressif et limitation de
  débit (s28), en-têtes et CSP du §1.

## 11. Conclusion

Les cinq constats assignés ont été traités, et quatre le sont complètement.
C1 est fermé et, mieux, **corrigé dans son énoncé** : la mesure de
l'implémenteur est exacte, la mienne la confirme, et le code écrit la nuance au
lieu de la gommer. M1 est fermé avec un chiffre avant et un chiffre après, et
l'email différé atterrit vraiment — le parcours navigateur le prouve, pas la
doublure. M3 n'est plus une phrase : couper `auth` est refusé par son nom au
CLI, à la génération, aux migrations et au démarrage, et le troisième état de
configuration que l'ADR annonce est vert. M4 dit désormais la vérité là où elle
était fausse, avec un arbitrage borné et daté d'un « à reprendre ».

Reste M2, à moitié. Le guillemet qui défaisait la règle ne la défait plus ; un
accent grave la défait encore, et un fichier `.tsx` sort de sa portée sans un
bruit. Ce n'est pas un défaut de raisonnement — le passage à l'AST était le bon
geste — c'est une couverture plus étroite que la phrase qui la décrit, dans un
dépôt dont le `AGENTS.md` dit à haute voix que c'est la faute qui s'y répète.
Rien ne s'exécute mal aujourd'hui, aucun module ne viole la frontière, et la
correction tient en deux lignes de sélecteur et une extension de glob : ça se
livre, et ça se ferme au cycle suivant.

Max severity: major
Ship allowed: yes
