# Revue anti-hallucination — s13-two-factor

Branche `feature/s13-two-factor`, commit unique `bc02ef8`, diff `dev...feature/s13-two-factor`.
Base PostgreSQL `s13`. Worktree `.claude/worktrees/agent-a888146ab90d174a6`.

Rien de ce rapport n'est pris sur parole : chaque affirmation ci-dessous a été
exécutée. Les mutations sont listées avec le nombre de cas rouges, et l'arbre a
été rendu propre (`git diff --exit-code`) avant d'écrire cette ligne.

---

## 1. Ce qui a été exécuté

| Commande | Résultat |
|---|---|
| `pnpm test` | 936 passés, 2 ignorés, 31 fichiers |
| `pnpm typecheck` | vert (16 tâches) |
| `pnpm lint --max-warnings=0` | vert |
| `pnpm build` | vert, `/two-factor` et `/account` servis |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert |
| `E2E_PORT=3113 pnpm test:e2e` | 50 passés, 3 ignorés, dont `e2e/two-factor.spec.ts` |
| `pnpm db:migrate` × 2 | seconde exécution : « Rien à appliquer » |

Vérification visuelle refaite : `/account` en thème **sombre**, à 390 px et à
1280 px, écran d'enrôlement ouvert. Le QR est **noir sur blanc dans les deux
largeurs**, avec sa marge silencieuse et son cadre thémé. Le correctif que
l'implémenteur dit avoir trouvé au navigateur est bien présent et bien visible.
L'orientation de la matrice a été recoupée avec le `renderSVG` de `uqr`
lui-même (`data[row][col]`, `x = col`, `y = row`) : le composant l'écrit dans le
même sens.

---

## 2. Constats

### C1 — critical — l'empreinte stockée d'un code de secours est acceptée telle quelle

`presentation/auth-routes.ts` hache la saisie avant de la transmettre :

```ts
withBody(request, { code: auth.digestBackupCode(body.code) })
```

et `domain/backup-code.ts` :

```ts
export function digestBackupCode(value: string, hash: BackupCodeHash): string {
  return isBackupCodeDigest(value) ? value : `${BACKUP_CODE_DIGEST_PREFIX}${hash(value)}`
}
```

L'aiguillage « déjà une empreinte ⇒ inchangée » est **indispensable** du côté
`storeBackupCodes.encrypt` — c'est ce qui empêche le double hachage des neuf
codes restants, et l'ADR 028 le documente bien. Mais la **même** fonction est
appliquée à l'entrée utilisateur. Conséquence : une chaîne de la forme
`sha256:<64 hexadécimaux>` traverse la route sans être hachée et arrive telle
quelle dans le `codes.includes(code)` de la bibliothèque.

Mesuré, pas déduit. Sonde temporaire (retirée, arbre vérifié propre) : lire
`auth_two_factor.backup_codes` en base, poster la première empreinte sur
`/auth/two-factor/verify-backup-code` avec un défi ouvert →

```
expect(await openedSession(used)).toBeNull()
AssertionError: expected '274mlT4lN1px48yyzj3BZg7XVRBqs0L6' to be null
```

Une session est ouverte. Le second facteur est franchi.

**Ce que cela retire à la story.** La valeur stockée n'est pas une empreinte au
sens où l'entend `docs/security.md` §2 : c'est un **équivalent du secret**. Qui
lit la colonne détient dix codes utilisables, sans rien inverser et **sans
`AUTH_SECRET`**. L'ADR 028 écrit exactement le contraire :

> La base ne contient plus aucun code de secours récupérable, quel que soit
> l'accès au secret de l'application.

Contre un attaquant qui n'a que la base, le montage est donc **moins sûr** que
le défaut `storeBackupCodes: 'encrypted'` qu'il remplace : le défaut exigeait
encore `AUTH_SECRET`, celui-ci n'exige rien. C'est le piège nommé par
`docs/stories.md` (« les codes de secours doivent être stockés hachés, jamais en
clair ») rouvert par le chemin qui prétendait le fermer.

**Pourquoi les tests ne l'ont pas vu.** `tests/auth.test.ts` mesure « aucun des
dix codes rendus n'apparaît dans la colonne » et « chaque entrée a la forme
d'une empreinte ». Les deux sont vrais, et aucun des deux ne pose la question
qui compte : *ce qui est stocké est-il rejouable ?* Un test qui décrit la forme
du magasin ne dit rien de la comparaison.

Brèche de `docs/security.md` §2 ⇒ **critical**, au rang d'une régression
fonctionnelle (AGENTS.md, socle de sécurité).

### C2 — major — le magic link et le rappel de fournisseur franchissent le second facteur

Le `matcher` du crochet `after` du greffon ne cite que `/sign-in/email`,
`/sign-in/username` et `/sign-in/phone-number` (`plugins/two-factor/index.mjs`,
lu dans le paquet installé). L'implémenteur l'écrit comme limite dans
`packages/modules/auth/AGENTS.md`. La conséquence a été **mesurée**, dans les
deux voies, sur un compte au second facteur confirmé :

- `/auth/sign-in/magic-link` puis suivi du lien → session ouverte, aucun code
  demandé ;
- démarrage `/auth/sign-in/social` puis `/auth/callback/github` avec une adresse
  vérifiée identique → session ouverte, aucun code demandé.

Les deux sondes ont rougi ; elles ont été retirées.

Ce n'est pas une abstraction : `/sign-in` **propose le magic link sur le même
écran**, juste sous le formulaire de mot de passe. Quelqu'un qui active la
« Double authentification » depuis `/account` obtient donc une protection qui
tient sur un seul des trois chemins d'entrée que l'application expose.

Retenu **major** et non critical, pour trois raisons nommées : la limite est
écrite dans `AGENTS.md` avant cette revue ; les deux voies exigent la boîte
email de la victime, pas seulement son mot de passe ; et le critère 2 de la
story parle littéralement de « la connexion exige le code TOTP **après le mot de
passe** ». Le degré exact appartient à l'arbitrage humain — la mesure, elle, ne
change pas.

### C3 — major — un code TOTP déjà consommé est accepté une seconde fois

Critère 4 de la story : « Un code TOTP erroné ou **rejoué** est refusé ».
`docs/research/s13-two-factor.md` §10 le range parmi les invariants à prouver
(ligne 6 du tableau : « code rejoué refusé »).

Ce qui est livré et testé, c'est autre chose : *le défi consommé ne se rejoue
pas*. Le code, lui, reste valable dans sa fenêtre. Mesuré, sur un compte
protégé, avec le même code sur deux défis successifs :

```
expect(await openedSession(second)).toBeNull()
AssertionError: expected '1374MUobZk5hd3cyKukKcNjEiP1RzBkq' to be null
```

Un code observé une fois (épaule, relais d'hameçonnage, capture) reste utilisable
jusqu'à ~90 s, sur un défi neuf. Le paquet n'enregistre aucun compteur consommé,
et la table `auth_two_factor` n'a pas de colonne pour le faire.

La déviation est mentionnée en passant dans le plan (tâche 7, entre parenthèses)
mais elle ne figure **ni** dans la liste des déviations déclarées du plan, **ni**
dans `packages/modules/auth/AGENTS.md`, **ni** dans l'ADR. Un critère
d'acceptation est donc coché sur une moitié.

### C4 — minor — `/sign-in/email` rend encore le jeton de session dans son corps

`api/routes/sign-in.mjs:364` rend `{ redirect, token: session.token, url, user }`,
et la route du module relaie cette réponse telle quelle en cas de succès. La
story applique pourtant la règle inverse à ses cinq routes, et l'écrit :
« un jeton rendu à un écran, c'est `HttpOnly` annulé ».

**Est-ce une fuite réelle dans notre configuration ?** Non, pas aujourd'hui, et
c'est vérifié : le cookie de session est **signé** (`setSessionCookie` →
`ctx.setSignedCookie`), donc le jeton nu ne suffit pas à en forger un sans
`AUTH_SECRET` ; et le greffon `bearer` n'est **pas** monté — les seuls greffons
présents sont `magicLink` et `twoFactor`. Le jeton rendu n'est donc pas, en
l'état, un identifiant présentable.

Ce qui reste : une défense en profondeur cassée, une incohérence avec la règle
que la même story fait respecter ailleurs, et une surface qui **s'élargit** avec
s13 — `auth-form.tsx` lit désormais ce corps (`response.json()`) pour y chercher
`twoFactor`. Antérieur à s13, hors de son périmètre. **minor**, avec la
condition d'escalade nommée : le jour où une story monte `bearer` ou livre des
jetons d'API, c'est **major** sans autre changement.

### C5 — minor — `readTwoFactorFailureClass` n'a aucun appelant de production

La fonction est écrite (`domain/two-factor.ts`), exportée sur la surface
publique du module (`src/index.ts`), et testée. `git grep` sur `apps`,
`packages`, `tests`, `e2e` ne trouve que sa définition, son export et ses
assertions. `apps/web/app/two-factor/two-factor-form.tsx` réécrit le ternaire à
la main :

```ts
setErrorKey(payload?.error === 'restart' ? REFUSAL_KEYS.restart : REFUSAL_KEYS.invalid)
```

La tâche 2 du plan dit « pour l'écran, qui **relit** au lieu de reclasser
(précédent s12) ». L'écran ne relit pas : il reclasse, avec une seconde écriture
de la même règle. Le test qui mord mord donc du code mort, et le prochain agent
qui lira l'export croira le contrat tenu.

### C6 — minor — la mutation annoncée pour la non-énumération ne rougit pas le cas de s13

Tâche 10 du plan : *« Mutation : retirer `genericSignInRefusal` de la route de
connexion. »* Exécutée : **4 cas rouges, tous de s07**, et le cas neuf
(« rend le même refus qu'un compte soit protégé, non protégé ou inexistant »)
reste **vert**. C'est cohérent avec le code — rien dans le chemin de s13 ne
distingue les trois comptes avant le premier facteur —, mais cela veut dire que
le cas neuf est tenu par la mesure de s07, pas par la sienne. Il n'est pas
décoratif (il ajoute le compte protégé à la comparaison), il est simplement plus
étroit que la mutation qui l'accompagne.

À noter aussi : il compare statut, corps et session, **jamais le temps de
réponse**, que le critère de non-énumération de `docs/security.md` §3 nomme
pourtant.

### C7 — minor — l'enveloppe atomique court-circuite les transformations de l'adapter

`withAtomicBackupCodeConsumption` enveloppe l'adapter **externe** : elle reçoit
donc l'entrée non transformée (`model: 'twoFactor'`, champs au nom de modèle),
ce qui est correct, mais elle écrit ensuite en Drizzle sans repasser par
`transformInput`/`transformOutput` de `@better-auth/core`
(`db/adapter/factory.mjs:719-769`). Deux effets, tous deux inoffensifs
aujourd'hui et vérifiés comme tels :

- aucun champ `onUpdate` n'est appliqué — le schéma du greffon
  (`plugins/two-factor/schema.mjs`) n'en déclare aucun, donc rien ne manque ;
- la ligne rendue est brute, castée `as T`. Le seul appelant n'en teste que la
  vérité, donc rien ne casse.

Le fichier énumère trois hypothèses de version dans son commentaire ; celle-ci
est la quatrième, et elle n'y est pas.

### C8 — minor — trois points d'entrée « qui répondent 404 » sans commande qui le vérifie

L'ADR 028, `packages/modules/auth/AGENTS.md` et le commentaire de `PATHS`
affirment tous trois que `two-factor/get-totp-uri`, `two-factor/send-otp` et
`two-factor/verify-otp` répondent 404 sans atteindre la bibliothèque. C'est vrai
par construction — le répartiteur ne sert que les chemins déclarés, et cette
propriété générale est mesurée ailleurs —, mais **aucun cas ne nomme ces trois
chemins**. `get-totp-uri` est celui qui rendrait le secret d'un compte déjà
activé : c'est précisément l'affirmation qui mérite sa commande (AGENTS.md
racine, « une règle doit être exécutable »).

### C9 — minor — deux inexactitudes de commentaire, et un événement mal nommé

- La route `enable` commente que la réponse de la bibliothèque « porte le
  `token` de la session qu'elle vient de reposer ». Faux sur le chemin TOTP :
  `enableTwoFactor` ne rend que `{ method, totpURI, backupCodes }`, et ne repose
  de session que sous `skipVerificationOnEnable` ou `method: 'otp'`. La
  réécriture reste juste, sa justification est fausse.
- `settleTwoFactorVerification` journalise `auth.two_factor_enabled` dès qu'une
  session existe à l'entrée. Un compte **déjà connecté** qui consomme un code de
  secours sur `/two-factor/verify-backup-code` est donc journalisé comme une
  *activation*. Le chemin n'est pas offert par l'interface, mais la route est
  publique et le journal ment sur ce cas.
- Plan tâche 11 : « `apps/web/lib/auth.ts` expose l'état du second facteur du
  compte courant ». Le fichier n'est pas touché par le diff ; l'état arrive par
  `AccountView.twoFactorEnabled`. Le résultat est là, la tâche décrit autre
  chose.

### C10 — observation — la ré-inscription silencieuse

`POST /two-factor/enable` sur un compte **déjà** protégé remplace le secret et
les dix codes, en gardant `verified: true`
(`plugins/two-factor/index.mjs:149`) : le nouveau secret devient actif **sans
qu'aucun code ne le confirme**. Il faut la session **et** le mot de passe, donc
le même niveau de preuve que la désactivation, et aucun gain de privilège n'en
découle ; l'interface ne l'offre pas. Mais le critère 1 (« exige un code valide
pour être confirmée ») ne vaut que pour le premier enrôlement, et ce n'est écrit
nulle part.

---

## 3. Le point central : le défaut de course, instruit

L'affirmation de l'implémenteur est **exacte, et elle est plus forte que ce
qu'il en dit**.

**Le défaut, lu dans le paquet.**
`@better-auth/drizzle-adapter@1.7.2`, `dist/index.mjs`, branche non-MySQL de
`incrementOne` :

```js
const targetIds = db.select({ id: idColumn }).from(schemaModel).where(...clause).limit(1);
return (await db.update(schemaModel).set(assignments).where(inArray(idColumn, targetIds)).returning())[0] ?? null;
```

La garde vit bien dans un sous-select. Et
`plugins/two-factor/backup-codes/index.mjs` consomme bien un code par cette
primitive, avec la garde `[id, backupCodes]` et `increment: {}` — la forme exacte
que l'enveloppe reconnaît. `@better-auth/core` la documente bien comme
« race-safe ». Les trois maillons sont vérifiés un par un.

**La reproduction.** Mutation : `backupCodeSwap` rendu `null` d'entrée, ce qui
renvoie toute la consommation à l'adapter de la bibliothèque. Quatre exécutions
du seul cas de course :

| Exécution | Résultat |
|---|---|
| 1 | `AssertionError: code « iVIc8-MHmtF »: expected [ …(2) ] to have a length of 1 but got 2` |
| 2 | `code « gB8v6-cSb5H » … got 2` |
| 3 | `code « z0X2f-MRtIb » … got 2` |
| 4 | `code « uRsR4-zv2kP » … got 2` |

**4 rouges sur 4.** Et sur l'arbre corrigé, 3 exécutions vertes sur 3, avant
mutation. Le cas n'est pas « une fois sur quatre » : il boucle sur **cinq codes
indépendants**, chacun une course, et c'est exactement ce qui le rend
reproductible. Mutation restaurée, `git diff --exit-code` vert.

**Ce que l'enveloppe ne reconnaît pas.** Trois autres appels à `incrementOne`
existent dans le greffon (`verify-two-factor.mjs`) ; les trois ont été relus, et
les trois retombent hors de la reconnaissance pour une raison **indépendante** :
`recordTwoFactorFailure` porte un `increment` non vide ; sa seconde écriture
porte un `set` qui ne contient pas `backupCodes` ; `assertTwoFactorNotLocked`
porte deux champs posés **et** un opérateur `lte`. La reconnaissance est donc
étroite comme annoncé, sur ces trois cas-là.

**Ce qui rougirait à une montée de version.** La reconnaissance échoue en
silence si la bibliothèque change de forme (un `updatedAt` ajouté au `set`, un
passage à `adapter.update`, un renommage de modèle). Dans ce cas, la
consommation redescend au chemin défectueux — et le cas de course rougit, comme
il vient de le faire sous mutation. Le filet existe donc réellement. Deux
réserves : `better-auth` est épinglé exactement (`"better-auth": "1.7.2"`), ce
qui est la bonne moitié ; et si l'adapter corrigeait sa branche PostgreSQL, le
cas resterait vert des deux côtés et plus rien ne dirait que l'enveloppe est
devenue inutile — ce que le fichier assume explicitement.

---

## 4. Mutations exécutées, et ce qu'elles ont fait rougir

Toutes restaurées dans la même commande, arbre vérifié propre après chacune.

| # | Ce qui a été neutralisé | Cas rouges |
|---|---|---|
| 1 | `backupCodeSwap` → `return null` (l'enveloppe atomique) | **1**, reproductible 4/4 exécutions |
| 2 | la garde « déjà une empreinte » de `digestBackupCode` | **3** (ré-encodage, « les neuf autres », course) |
| 3 | `code` retiré de `SECRET_KEY_PATTERN` | **1** |
| 4 | corps du client transmis à `enable` au lieu du corps reconstruit | **1** |
| 5 | `genericSignInRefusal` retiré de `/sign-in/email` | **4**, toutes de s07 — cf. C6 |

Sondes temporaires ajoutées puis retirées (`git diff --exit-code` vert à chaque
fois) : magic link sur compte protégé, rappel de fournisseur sur compte protégé,
rejeu d'un code TOTP sur un défi neuf, empreinte volée soumise telle quelle.
**Les quatre ont rougi.**

---

## 5. Diff contre plan

Les treize tâches sont présentes et cochées, et le code correspondant existe.
Les écarts trouvés, sur ces quatre points relevés :

- tâche 2 — `readTwoFactorFailureClass` écrite pour l'écran, jamais appelée par
  lui (C5) ;
- tâche 10 — la mutation annoncée ne rougit pas le cas qu'elle accompagne (C6) ;
- tâche 11 — `apps/web/lib/auth.ts` annoncé modifié, ne l'est pas (C9) ;
- tâche 7 — « un code accepté puis rejoué sur un nouveau défi passe » est écrit
  dans le plan comme un fait, mais n'est ni testé, ni déclaré comme déviation au
  critère 4 (C3).

Rien dans le diff que le plan n'ait demandé. Les deux déviations déclarées
(désactivation par mot de passe seul ; `generated/schema/auth.ts` régénéré) sont
justifiées et vérifiées : `disableTwoFactor` appelle bien `validatePassword` via
`shouldRequirePassword`, sans crochet de substitution, dans le paquet installé —
l'affirmation de l'implémenteur est exacte. **Mon arbitrage : le critère 5 est à
amender, pas la bibliothèque à réécrire.** L'invariant qui compte (un vol de
session ne retire pas le second facteur) est tenu, et la moitié « ou un code
valide » n'ajouterait aucune sécurité — elle en retirerait.

## 6. Socles et ADR

- `docs/security.md` §2 — **brèche** (C1). La rotation de session, elle, est
  tenue et mesurée aux trois moments.
- §3, §4, §5, §7 — tenus sur ce qui a été balayé : corps reconstruits aux cinq
  routes, aucun code de bibliothèque rendu, aucun secret dans le journal (mesuré
  sur le secret, l'URI et les dix codes), 404 plutôt que 403.
- §7, limitation partagée — absente par décision de la story, renvoyée à s28,
  conforme à `docs/stories.md`.
- `docs/reliability.md` §1 et §4 — tenus : consommation prouvée sous
  concurrence, migration additive, `db:migrate` rejouable sans effet.
- ADR 021 (socle non désactivable), ADR 018 (clé étrangère interne), ADR 020
  (connexion reçue), ADR 006 (frontières de couches, `node:crypto` en
  `infrastructure/`) — respectés.
- **ADR 028 — contredit par le code qu'il décrit** (C1). Sa section
  « Conséquences » affirme une propriété que la sonde infirme.
- `uqr@0.1.3` — MIT, `unjs`, **aucune dépendance de production**, version
  épinglée exactement, `encode` et `{ size, data: boolean[][] }` vérifiés dans
  le `.d.ts` installé. Dépendance proportionnée, et justifiée par le besoin réel
  (une matrice, pas une image, donc pas de `dangerouslySetInnerHTML`).

---

## 7. Ce que je n'ai pas pu vérifier

La liste dit ce qui a été balayé, pas ce qui existe.

- **Aucune application d'authentification réelle** n'a scanné le QR. L'orientation
  de la matrice est recoupée avec le rendu de `uqr` lui-même, jamais décodée.
- **Le temps de réponse** n'a jamais été chronométré : la non-énumération est
  mesurée sur le statut et le corps, pas sur la durée. C'est un geste humain à
  faire, sur un compte protégé, un compte simple et une adresse inconnue.
- **Deux écrans jamais rendus au navigateur** : `/two-factor` (les deux
  formulaires, les deux messages de refus) et l'affichage des dix codes de
  secours. Seul `/account` en enrôlement a été capturé, en **sombre**, à 390 px
  et 1280 px. Le thème clair n'a pas été repris ce tour-ci.
- **Un seul navigateur** (Chromium), **une seule langue** (français), **une
  seule origine** (`localhost`). Ni Safari, ni Firefox, ni un vrai domaine, ni
  la CSP de production.
- **Le verrouillage par compte** (`lockedUntil`, dix échecs, quinze minutes)
  n'est exercé par aucun cas, et je ne l'ai pas exercé non plus : la forme
  `assertTwoFactorNotLocked` traverse mon enveloppe sans être reconnue, ce que
  j'ai vérifié par lecture, pas par exécution.
- **La course a été mesurée sur une seule machine**, un PostgreSQL 16 local en
  `READ COMMITTED`, sans pooler. Un PostgreSQL géré, un pooler en mode
  transaction ou un autre niveau d'isolement n'ont pas été essayés.
- **Aucune limitation de débit** n'existe encore (s28) : la devinette n'est
  bornée que par les compteurs de la bibliothèque, et je n'ai vérifié que le
  premier (cinq essais par défi).
- **Aucun déploiement.** Rien de ce rapport ne dit ce que fait le code en
  production.

---

## 8. Verdict

Le cœur technique de la story est solide, et son constat le plus lourd est
**vrai** : le défaut de course de `incrementOne` existe, il est reproductible,
et le correctif le ferme — quatre rouges sur quatre sous mutation, trois verts
sur trois sans. C'est du travail mesuré, pas affirmé.

Ce qui bloque est ailleurs, et c'est le même endroit que le piège nommé par la
story : les codes de secours ne sont pas hachés au sens utile du terme, puisque
la valeur stockée est acceptée telle quelle à l'entrée. La correction est
étroite — la saisie doit être hachée **inconditionnellement**, seule la
ré-encodage du magasin a besoin de l'aiguillage — mais tant qu'elle n'est pas
faite, l'ADR 028 affirme une propriété que le code n'a pas.

---

## 9. Clôture du tour de correction (commit `9362aaf`)

Écrite par l'implémenteur, après le tour de correction. Chaque ligne dit **ce
qui a été fait** et **ce qui le mesure** ; les nombres de rouges sont ceux
observés, mutation posée et restaurée dans la même commande.

| Constat | État | Ce qui le tient |
|---|---|---|
| C1 — empreinte acceptée telle quelle | **fermé** | `digestBackupCode` (la saisie) hache sans condition ; `digestBackupCodes` (le magasin) garde seul l'aiguillage. Cas neuf : « refuse l'empreinte lue en base, soumise telle quelle ». **Mutation** — refusionner les deux chemins ⇒ **3 rouges** (1 d'intégration, 2 de domaine) |
| C2 — magic link et rappel de fournisseur | **fermé** | `infrastructure/two-factor-challenge.ts` élargit le `matcher` du crochet du greffon à `/magic-link/verify` et `/callback/:id`, handler repris tel quel ; les deux routes redirigent vers `/two-factor`. Deux cas neufs, un par voie, chacun vérifiant qu'aucune session n'existe **et** que le défi posé est jouable. **Mutation** — `matcher` d'origine ⇒ **2 rouges** |
| C3 — rejeu TOTP | **fermé** | `auth_two_factor.last_totp_step` (migration additive `0002`), prise par comparaison-et-échange ; session révoquée sur refus. Cas neuf : « refuse un code déjà consommé, même sur un défi neuf ». **Mutations** — neutraliser la garde ⇒ **1 rouge** ; ne pas révoquer ⇒ **1 rouge** ; retirer le pas `-2` de `totpStepsToTry` ⇒ **1 rouge** |
| C4 — jeton dans le corps de `/sign-in/email` | **écrit, non corrigé** | Antérieur à s13 et hors de son périmètre, comme la revue le dit. La condition d'escalade est désormais **dans `packages/modules/auth/AGENTS.md`**, en gras, à l'endroit où la lira une story qui monterait `bearer` ou livrerait des jetons d'API |
| C5 — `readTwoFactorFailureClass` sans appelant | **fermé par suppression** | La fonction, son export et son cas sont retirés. Le précédent s12 ne transfère pas : `readOAuthFailureClass` est relu par un composant **serveur**, l'écran de vérification est un composant **client** — lui faire importer `@repo/module-auth` embarquerait Better Auth et Drizzle dans le navigateur. `domain/two-factor.ts` porte le paragraphe qui empêche de la réécrire |
| C6 — mutation de non-énumération mal annoncée | **fermé par correction de l'annonce** | Réexécutée : **4 rouges, tous de s07**, le cas de s13 reste vert. Le plan le dit maintenant, avec la raison — rien dans le chemin de s13 ne distingue les trois comptes **avant** le premier facteur, donc ce cas ne peut pas avoir de mutation propre. Il n'est pas décoratif (il ajoute le compte protégé au balayage), il est tenu par la mutation de s07. **Le temps de réponse n'est toujours pas comparé sur ce cas** |
| C7 — l'enveloppe court-circuite les transformations | **écrit** | La quatrième hypothèse est dans le commentaire de `two-factor-adapter.ts`, avec ce qui la rouvre : un `onUpdate` ajouté au modèle `twoFactor`, ou un appelant qui lirait un champ de la ligne rendue |
| C8 — trois « 404 » sans commande | **fermé** | Cas neuf nommant `two-factor/get-totp-uri`, `send-otp` et `verify-otp`, vérifiant le 404 **et** l'absence de `otpauth`/`secret` dans le corps. **Mutation** — déclarer `get-totp-uri` en pass-through ⇒ **1 rouge** |
| C9 — commentaires inexacts, événement mal nommé | **fermé** | Le commentaire d'`enable` dit désormais que la réponse ne porte **pas** de `token` sur le chemin TOTP, et pourquoi la réécriture reste la règle. `auth.two_factor_enabled` n'est plus journalisé quand un **code de secours** est consommé en session ; cas neuf, **mutation** — journaliser toute vérification en session comme une activation ⇒ **1 rouge**. La tâche 11 du plan est corrigée : `apps/web/lib/auth.ts` n'est pas touché |
| C10 — ré-inscription silencieuse | **non traité** | Observation, pas constat. Elle exige la session **et** le mot de passe, l'interface ne l'offre pas, et la revue ne demandait pas de la fermer |

**Critère 5 amendé.** `docs/stories.md` dit désormais « La désactivation exige le
mot de passe courant », avec sa raison en une phrase, et
`packages/modules/auth/AGENTS.md` porte la même. Amender un critère que la
bibliothèque rend intenable est légitime ; l'afficher faux ne l'est pas.

**Les deux écrans, au navigateur.** `/two-factor` — les deux formulaires et le
message de refus — et l'affichage des dix codes de secours, en **clair et en
sombre**, à 1280 px et à 390 px, sur Chromium, en français. Le QR n'a toujours
été scanné par aucune application réelle.

**Commandes exécutées après correction** : `pnpm typecheck` (16 tâches, vert),
`pnpm lint --max-warnings=0` (vert), `pnpm test` (945 passés, 2 ignorés,
31 fichiers), `E2E_PORT=3113 pnpm test:e2e` (50 passés, 3 ignorés),
`pnpm build` (vert), `pnpm run audit` (1 avis, aucun au seuil « élevé » non
couvert), `pnpm db:migrate` × 2 (seconde exécution : « Rien à appliquer »).

**Ce que ce tour n'a pas mesuré**, et la liste dit ce qui a été balayé, pas ce
qui existe : le temps de réponse de la non-énumération sur un compte protégé ;
le verrouillage par compte (`lockedUntil`) ; un autre navigateur que Chromium ;
la course sur autre chose qu'un PostgreSQL 16 local en `READ COMMITTED` ; et le
comportement de la garde de rejeu sous une horloge qui recule.

**Sur les deux dernières lignes.** Les dix constats sont adressés et l'arbre est
vert, mais la barrière n'est pas levée ici : l'auteur des correctifs ne certifie
pas ses propres correctifs. La revue doit être rejouée sur le diff
`bc02ef8..9362aaf` avant tout ship.

Le verdict que l'implémenteur avait posé à la fin de ce tour, conservé ici parce
que la §10 le remplace : `Max severity: none` / `Ship allowed: no`.

---

# Seconde revue — s13-two-factor (tour de correction `bc02ef8..9362aaf`)

Revue indépendante, contexte neuf, sur le diff de correction **et** sur la story
entière (`dev...feature/s13-two-factor`, base PostgreSQL `s13`, worktree
`.claude/worktrees/agent-a888146ab90d174a6`). Rien n'est repris de la première
revue sans être réexécuté : les six mutations qu'elle annonce ont été reposées
une par une, et chacune restaurée dans la commande qui la pose.

## 10.1 Ce qui a été exécuté, moi-même

| Commande | Résultat observé |
|---|---|
| `pnpm test` | **945 passés, 2 ignorés**, 31 fichiers (+1 ignoré) |
| `pnpm typecheck` | vert, 16 tâches |
| `pnpm lint --max-warnings=0` | vert |
| `pnpm build` | vert, `/two-factor` et `/account` servis |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert |
| `E2E_PORT=3113 pnpm test:e2e` | **50 passés, 3 ignorés**, dont `e2e/two-factor.spec.ts` |
| `pnpm db:migrate` × 2 | 2ᵉ exécution : « Rien à appliquer » |
| `pnpm db:generate` | « No schema changes » — aucune dérive entre schéma et migrations |

Les nombres annoncés par la clôture de l'implémenteur sont donc exacts.

## 10.2 Mutations reposées — ce qui a rougi, et combien

Toutes restaurées dans la même commande ; `git diff --exit-code` vert après
chacune, et l'arbre vérifié propre avant l'écriture de cette section.

| # | Ce qui a été neutralisé | Rouges | Annoncé |
|---|---|---|---|
| 1 | l'aiguillage « déjà une empreinte » **refusionné** dans `digestBackupCode` | **3** (1 intégration + 2 domaine) | 3 ✔ |
| 2 | `matcher` du crochet ramené à sa forme d'origine | **2** (magic link, rappel de fournisseur) | 2 ✔ |
| 3 | `claimTotpStep` du magasin rendu toujours vrai (`length >= 0`) | **1** | 1 ✔ |
| 4 | la révocation de session sur rejeu désarmée | **1** | 1 ✔ |
| 5 | le pas `-2` retiré de `totpStepsToTry` | **1** | 1 ✔ |
| 6 | `backupCodeSwap` rendu `null` (l'enveloppe atomique) | **1**, sur **3/3** exécutions ; **3/3 vertes** sans mutation | reproductible ✔ |
| 7 | `get-totp-uri` déclarée en pass-through | **1** | 1 ✔ |
| 8 | toute vérification en session journalisée comme activation | **1** | 1 ✔ |
| 9 | `genericSignInRefusal` retiré de `/sign-in/email` | **4**, toutes de s07 ; le cas de s13 reste vert | 4, s13 vert ✔ |

**La mutation restée verte est honnêtement annoncée, et son explication tient.**
Vérifié par lecture du chemin : sur un compte protégé, `/sign-in/email` rend
`200 + {twoFactor:true}` **avant** d'atteindre `genericSignInRefusal`, et un
mot de passe faux — protégé ou non — emprunte exactement le même code de s07.
Rien dans le chemin neuf ne distingue les trois comptes avant le premier
facteur : ce cas **ne peut pas** avoir de mutation propre. Il n'est pas
décoratif pour autant (il ajoute le compte protégé au balayage, et rougirait si
quelqu'un déplaçait la détection de défi sur le chemin d'échec).

## 10.3 Les deux chemins d'empreinte — fermés, et par où j'ai cherché à rentrer

Au-delà de la mutation, six formes voisines ont été **postées** sur
`/auth/two-factor/verify-backup-code` avec un défi ouvert, l'empreinte étant
lue en base : l'empreinte exacte, la même en majuscules, la même avec le
préfixe `SHA256:`, la même entourée d'espaces, la même privée de son préfixe, et
la même suivie d'un saut de ligne. **Les six : `401 {"error":"invalid"}`, aucune
session ouverte, et aucun code consommé** (le code dont c'est l'empreinte vaut
toujours ensuite). Sonde retirée, arbre vérifié propre.

Deux appuis rendent ce résultat structurel plutôt qu'heureux :

- `digestBackupCode` ne regarde plus la forme de ce qu'elle reçoit — il n'y a
  donc **aucune** classe d'entrée à contourner, pas une famille de casses ou
  d'encodages ;
- `verifyBackupCode` de `better-auth@1.7.2` compare par `codes.includes(data.code)`,
  **sans normalisation** (lu dans le paquet) : rien ne rapproche deux formes
  voisines côté bibliothèque non plus.

**Les entrées qui atteignent ces fonctions ont été énumérées par `git grep` sur
`packages`, `apps`, `tests`, `e2e` :** un seul appelant de production sur le
chemin de saisie (`presentation/auth-routes.ts:1153`) et un seul sur le chemin
du magasin (`infrastructure/better-auth-service.ts:609`). Trouvé sur ces deux
chemins-là ; le reste des occurrences sont la définition, la surface du port et
les cas.

**C1 est fermé.**

## 10.4 Les voies de connexion — mesurées, et ce que l'enumération ne tient pas

Sur un compte au second facteur confirmé, les trois voies rendent le même
résultat, et c'est la mutation 2 qui le tient (2 rouges) : aucune session en
base, un défi jouable, la redirection vers `/two-factor`. La propriété est bien
tenue **côté serveur** — le crochet détruit la session que la bibliothèque vient
de créer, il ne marque pas une session « à moitié authentifiée ». L'arbitrage
d'élargir le `matcher` plutôt que de marquer la session est le bon, et pour la
raison exécutable que l'`AGENTS.md` écrit : la branche « session déjà ouverte »
de `verifyTwoFactor` n'arme **ni** `beginAttempt(5)` **ni** `accountLockout`
(relu dans `verify-two-factor.mjs` : `beginAttempt` y est une paire de fonctions
vides, et `assertTwoFactorNotLocked` / `recordTwoFactorFailure` ne sont appelés
que sous `isSignIn`). Marquer la session aurait offert une devinette à six
chiffres sans compteur.

**J'ai cherché une quatrième voie, et sur ce balayage-ci je n'en ai pas trouvé.**
Ce qui a été balayé, et rien de plus :

1. les **sept** points d'entrée de `better-auth@1.7.2` qui appellent
   `setSessionCookie` ou `createSession` (`/sign-in/email`, `/sign-in/social`,
   `/sign-up/email`, `/callback/:id`, `/magic-link/verify`, la famille
   `email-verification`, `update-user` / `update-session` / `session`),
   croisés avec les **22 chemins déclarés** par le module ;
2. `emailVerification.autoSignInAfterVerification` — **non posé**, donc
   `/verify-email` n'ouvre rien ; et de toute façon `/auth/verify-email` et
   `/auth/verify-email-change` du module passent par ses **propres** cas d'usage
   et redirigent vers `/sign-in`, sans jamais appeler la bibliothèque ;
3. **réinitialisation de mot de passe** — sondée : `200`, **aucune session**
   ouverte (`api/routes/password.mjs` n'appelle ni `createSession` ni
   `setSessionCookie`) ;
4. **fournisseur local de développement** — `genericOAuth@1.7.2` **ne déclare
   aucun point d'entrée** (lu : il n'a qu'un `init` qui injecte dans
   `socialProviders`), donc `/auth/callback/local` retombe sur `/callback/:id`,
   couvert ;
5. **aucune création de session hors bibliothèque** dans le dépôt : `git grep`
   sur `createSession|setSessionCookie|impersonat` dans les sources suivies ne
   rend que deux lignes de **commentaire**.

Le `path` que reçoit le `matcher` est bien celui de la **déclaration** de
l'endpoint (`api/dispatch.mjs` : `path: endpoint.path`), donc `/callback/:id` et
non `/callback/github` — vérifié dans le paquet, et c'est ce que le fichier
suppose.

### C11 — major — la propriété est **énumérée**, et rien ne fait échouer l'oubli du prochain

`ADDITIONAL_TWO_FACTOR_SIGN_IN_PATHS` est une liste écrite à la main de deux
chemins. Elle **ajoute** au `matcher` du greffon, elle ne le remplace pas : la
règle est donc « ces cinq chemins-là posent un défi », jamais « toute voie qui
ouvre une session pose un défi ». Trois cas d'intégration nomment les trois
voies d'aujourd'hui ; **aucune commande n'échoue quand une quatrième apparaît.**

Ce n'est pas théorique, et l'échéance a un numéro : **s14 livre les passkeys**,
et `better-auth/plugins/passkey` ouvre une session par
`/passkey/verify-authentication`. Monté tel quel, il rouvrira exactement le trou
que C2 vient de fermer — en silence, avec la suite verte, et sous un
`AGENTS.md` de module qui affirme entre-temps la propriété **universelle** :

> La propriété tenue, et c'est elle qui est mesurée sur les trois voies :
> *aucune session n'existe sur un compte à second facteur actif tant que le
> facteur n'a pas été présenté*.

C'est la phrase que l'`AGENTS.md` racine interdit (« Never claim
exhaustiveness », et « une règle doit être exécutable : quelle commande échoue
si je la casse ? »). Le dépôt s'est fait prendre trois fois là-dessus ; c'est la
quatrième position.

La forme de la garde est renversable à peu de frais, et c'est ce qui rend le
constat actionnable plutôt que théorique : au lieu d'énumérer les chemins **à
protéger** (liste ouverte, qui échoue *ouvert*), énumérer les chemins
**exemptés** — les points d'entrée de vérification du second facteur eux-mêmes,
qui sont les seuls à devoir poser une session sans défi — et laisser le
`matcher` valoir partout ailleurs. Le handler du greffon sort déjà tout seul
quand il n'y a pas de `newSession` ou que le compte n'est pas protégé
(`index.mjs` : `if (!data) return; if (!data?.user.twoFactorEnabled) return;`),
donc l'élargissement ne coûte rien aux autres chemins.

**major** — pas critical : sur le balayage ci-dessus, aucune voie ouverte
aujourd'hui, et les trois qui existent sont mesurées et tenues par mutation.
C'est la **durabilité** de la propriété qui manque, pas la propriété.

## 10.5 Le rejeu TOTP — fermé, et trois conséquences mesurées

La garde est prise par comparaison-et-échange dans la qualification de
l'`UPDATE` (`where user_id = ? and (last_totp_step is null or last_totp_step < ?)`),
jamais une lecture suivie d'une écriture. Les deux bords de la fenêtre et le
rejeu sont couverts par trois cas distincts, et les trois mutations rougissent
(§10.2, lignes 3 à 5). La couverture des compteurs est prouvée par un cas de
domaine qui place la vérification à **29 999 ms** dans sa période — le seul
instant où le pas `-2` compte —, et retirer ce pas rougit.

**C3 est fermé.** Trois conséquences ont été **mesurées** ici, qu'aucun cas ne
tient et que la clôture de l'implémenteur nomme comme non mesurées :

### C12 — minor — l'horloge qui recule ferme le TOTP, et ne dit pas pourquoi

Sonde : `last_totp_step` porté cinq pas en avant, puis un code frais et valide
présenté sur un défi neuf. Résultat : **`401 {"error":"invalid"}`, aucune
session** — et le **code de secours du même compte fonctionne toujours**. La
garde échoue donc *fermée*, avec une porte de sortie : c'est le bon sens de
l'échec, et `docs/reliability.md` §2 est tenu (ça dégrade, ça ne casse pas).

Deux choses restent à savoir, et aucune n'est écrite :

- le message rendu est celui d'un **code faux**. Quelqu'un dont le serveur a
  reculé son horloge lit « code invalide » pendant que son application affiche
  le bon ;
- en **multi-instances**, une dérive d'horloge entre instances a la même forme :
  une instance en retard de *k* périodes refuse le TOTP pendant *k* périodes
  après une connexion servie par une instance en avance. Non mesuré (une seule
  machine), nommé.

### C13 — minor — deux connexions TOTP dans la même période de trente secondes s'excluent

Sondé : première connexion acceptée, seconde connexion avec **le même code**
(c'est celui que l'application d'authentification affiche encore) sur un défi
neuf ⇒ `401`, aucune session. C'est le comportement que la RFC 6238 §5.2
recommande, et c'est ce que le critère 4 demande — mais c'est aussi ce qui a
obligé la suite à contourner la garde en **trois endroits** (`totpAt(…, 1)` dans
`tests/auth.test.ts` et dans `e2e/two-factor.spec.ts`, plus l'utilitaire
`forgetLastTotpStep`). Le coût est réel côté personne : ouvrir un second
navigateur dans les trente secondes rend « code invalide » sur un code juste, et
aucun message ne distingue les deux.

L'`AGENTS.md` du module écrit la conséquence **pour les tests** ; il n'écrit pas
la conséquence pour l'écran.

### C14 — minor — un ré-enrôlement confirmé dans la même période est refusé, et l'écran ne le dit pas

Sondé sur un compte déjà protégé : `POST /two-factor/enable` réussit (`200`,
nouveau secret, dix nouveaux codes), puis la confirmation du code de ce nouveau
secret dans la **même** période ⇒ `401 {"error":"invalid"}`. `enable` ne remet
pas `last_totp_step` à `null`, et la ligne garde `verified: true` — donc le
compte reste protégé, avec le **nouveau** secret déjà en place et l'ancien
perdu. Mesuré aussi : la session courante **survit** (le chemin en session de
`valid()` ne fait pas tourner la session, relu dans `verify-two-factor.mjs`), et
la personne s'en sort à la période suivante. C'est donc récupérable, jamais un
verrouillage — mais c'est trente secondes pendant lesquelles l'écran affirme un
code faux sur un code juste, sur le chemin que C10 avait déjà signalé comme non
offert par l'interface.

## 10.6 Les codes de secours sous concurrence — rejoué, chiffres à l'appui

Cas de course réexécuté **six fois** au total : **3/3 vertes** sur l'arbre
corrigé, **3/3 rouges** avec `backupCodeSwap` rendu `null`. Le cas ne tire pas
une fois : il boucle sur **cinq codes indépendants**, chacun sa course sur deux
défis distincts, ce qui est exactement ce qui le rend reproductible. La garde de
l'enveloppe est donc toujours en place et toujours mesurée.

## 10.7 Les points que la commande m'a demandé d'arbitrer

**`@better-auth/utils@0.4.2` promue en dépendance directe — décision saine, et
elle est la bonne version.** Vérifié dans le paquet installé :
`node_modules/better-auth/package.json` déclare `"@better-auth/utils": "0.4.2"`
en dépendance **épinglée exactement**, le module déclare la même chaîne exacte,
et pnpm résout le module sur la **même instance**
(`node_modules/.pnpm/@better-auth+utils@0.4.2`, lien symbolique vérifié). Un
`0.5.0` existe dans le magasin pour un autre dépendant ; ni la bibliothèque ni le
module ne s'y résolvent. Calculer le HOTP avec la primitive de la bibliothèque
plutôt qu'en réécrire une est le bon arbitrage : une divergence refuserait
*toutes* les connexions TOTP. Et ce risque-là **est** tenu par une commande —
la suite calcule son HOTP de son côté (`hotp(secretOf(totpURI), step)`), donc
une divergence entre les deux implémentations rougit immédiatement. Rien à
corriger.

**Migration `0002` — conforme.** `ALTER TABLE "auth_two_factor" ADD COLUMN
"last_totp_step" integer;` : additive, nullable, sans défaut, sans reprise de
données ; la version encore en ligne (`bc02ef8`) ne la lit ni ne l'écrit
(`docs/reliability.md` §4). Rejouée : deuxième `db:migrate` ⇒ « Rien à
appliquer ». `db:generate` ⇒ « No schema changes » : aucune dérive entre le
schéma et les migrations. La seule conséquence à connaître, inhérente et bornée,
est la **fenêtre de déploiement** : tant qu'une instance de l'ancienne version
sert du trafic, elle accepte un code TOTP rejoué. Rien à corriger.

**C5 fermé par suppression — le bon choix.** La raison tient à la lecture :
`apps/web/app/two-factor/two-factor-form.tsx` porte `'use client'`, et lui faire
importer `@repo/module-auth` embarquerait Better Auth et Drizzle dans le paquet
du navigateur. Le précédent s12 ne transfère pas, parce que son écran est un
composant **serveur**. Un test qui protège une fonction sans appelant donne une
fausse impression de couverture ; la retirer et laisser dans
`domain/two-factor.ts` le paragraphe qui empêche de la réécrire est mieux que de
la garder. Résidu, nommé et non retenu comme constat : les deux littéraux
`'invalid'` / `'restart'` sont désormais écrits des deux côtés du réseau, et
seul le côté serveur est mesuré (`expect(await replayed.json()).toEqual({ error: 'invalid' })`) ;
un renommage côté route laisserait l'écran afficher « code invalide » pour
toujours, en silence. Une ligne de contrat, pas une fonction.

**C4 — non, l'écrire en gras ne suffit pas, et c'est votre arbitrage.** La
mesure de la première revue est confirmée : le jeton relayé n'est pas
présentable aujourd'hui — le cookie de session est **signé**, et les greffons
montés sont `magicLink`, `twoFactor` et, sous drapeau, `genericOAuth` ; **pas
`bearer`** (relu dans le tableau `plugins` de `better-auth-service.ts`). Ce qui
me gêne est la **forme** de la garde, pas sa gravité : la condition d'escalade
que l'`AGENTS.md` écrit en gras (« le jour où une story monte `bearer` ou livre
des jetons d'API ») est précisément une règle dont l'`AGENTS.md` racine demande
quelle commande échoue quand on la casse. La réponse est : aucune. Un cas d'une
ligne qui affirme que `bearer` n'est pas dans les greffons montés, avec le
renvoi au paragraphe, échouerait le jour exact où il faut relire ce fichier —
et coûte moins cher que la phrase en gras. Je le laisse **minor** comme la
première revue, avec cette précision : le correctif attendu est une commande,
pas une meilleure typographie.

## 10.8 Diff contre plan

Les treize tâches et les quatre lignes de correction sont présentes, cochées, et
le code correspondant existe. Les nombres de rouges annoncés dans la section
« Corrections de revue » du plan sont **tous exacts** (§10.2). Rien dans le diff
que le plan n'ait demandé.

Deux écarts de forme, ni l'un ni l'autre retenu comme constat :

- `docs/security.md` et `docs/stories.md` sont des **documents de cadrage**, que
  `AGENTS.md` range parmi ceux qui se commitent sur la branche par défaut ; ils
  sont ici amendés sur `feature/s13-two-factor`. La règle « les documents
  voyagent avec le code qui les change » tire dans l'autre sens, et ADR 028
  porte le raisonnement. **C'est un arbitrage qui vous appartient**, pas un
  constat : l'amendement du critère 5 est légitime au fond (la moitié « ou un
  code valide » est intenable dans le paquet installé, et c'est la moitié
  faible) ;
- l'écran `/two-factor` ne fonctionne pas sans JavaScript (`disabled={!hydrated}`
  sur le bouton, pas d'`action` sur le `<form>`), là où s12 a livré des boutons
  de fournisseur qui marchent sans JS. Le `method="post"` littéral est bien là,
  sur les cinq formulaires de la story. Cohérent avec `auth-form.tsx`, donc pas
  une régression : une observation.

## 10.9 Socles et ADR

- **`docs/security.md` §2 — la brèche de C1 est refermée**, et la propriété est
  désormais celle que l'ADR affirme : la base ne contient rien de rejouable, ce
  qui est mesuré par le cas neuf et par six formes voisines (§10.3). ADR 028 ne
  contredit plus le code qu'il décrit — sa section « Ce qui a été corrigé après
  la revue » dit exactement ce que la sonde disait.
- §2, rotation de session : tenue et mesurée aux trois moments. Le cookie de
  défi hérite de `defaultCookieAttributes` — `HttpOnly`, `Secure`,
  `SameSite=Strict` — comme celui de session.
- §3, §4, §5 : corps reconstruits aux cinq routes ; **sondé** que `trustDevice`
  et `disableSession` du corps de la bibliothèque ne traversent pas (les seuls
  cookies posés par une vérification réussie sont `session_token` et l'expiration
  de `two_factor` — **aucun `trust_device`**) ; aucun secret au journal ; 404
  plutôt que 403.
- §7, limitation partagée : renvoyée à s28, conforme à `docs/stories.md`. À
  écrire pour que s28 n'hérite pas d'une prémisse fausse : les compteurs de la
  bibliothèque (`beginAttempt(5)`, `accountLockout`) **n'arment que la branche
  connexion**. Le chemin `/two-factor/verify-totp` **avec** session — celui de
  l'enrôlement — n'a **aucun** compteur (relu : `beginAttempt` y rend deux
  fonctions vides). Le gain d'un attaquant y est nul aujourd'hui, puisqu'il
  faut déjà une session ; la recherche §2.3 le présente pourtant comme couvrant
  « six chiffres se devinent », ce qui n'est vrai que d'une des deux branches.
- `docs/reliability.md` §1 et §4 : consommation prouvée sous concurrence
  (6 exécutions, §10.6), migration additive et rejouable (§10.7).
- ADR 006 (frontières de couches — `node:crypto` et `@better-auth/utils` restent
  en `infrastructure/`, le `domain` reçoit la primitive), ADR 007/017 (routes
  énumérées, cinq sur sept), ADR 018 (clé étrangère interne au module), ADR 020
  (connexion reçue), ADR 021 (socle non désactivable), ADR 028 : **respectés**.
  Aucun ADR accepté n'est contredit.

## 10.10 Ce que je n'ai pas pu vérifier

La liste dit ce qui a été balayé, pas ce qui existe.

- **Le magic link et le rappel de fournisseur n'ont jamais été joués dans un
  navigateur.** Les deux cas passent par des chaînes de cookies posées à la
  main ; `e2e/two-factor.spec.ts` ne couvre que la voie mot de passe. Le point
  qui mérite le geste humain : le cookie de défi est `SameSite=Strict`, et il
  est posé au bout d'une **chaîne de redirections venue d'un autre site** (le
  client mail, le fournisseur). Le raisonnement dit que ça passe — le cookie est
  posé sans contrainte, et il n'est *lu* qu'au `fetch` déclenché depuis notre
  propre page, donc en same-site. Ce raisonnement n'a pas été exécuté. **À
  faire à la main : activer le second facteur, se déconnecter, entrer par le
  magic link puis par GitHub, dans Chrome et dans Safari.**
- **Aucune preuve navigateur des deux écrans dans ce dépôt.** L'implémenteur
  écrit avoir contrôlé `/two-factor` et l'affichage des dix codes en clair et en
  sombre, à 1280 px et 390 px ; aucune capture n'est versionnée, et je n'ai pas
  rendu ces écrans. C'est une affirmation, pas un fait vérifié ici.
- **Le QR n'a été scanné par aucune application d'authentification réelle.**
- **Le temps de réponse n'a pas été chronométré sur le compte protégé.** Le cas
  de chronométrie existe (s07) mais ne compare qu'un compte connu et une adresse
  inconnue. La lecture du chemin dit que le mot de passe faux d'un compte
  protégé est *identique* à celui d'un compte simple (le crochet du greffon ne
  s'exécute pas sans `newSession`), donc le risque est faible — il n'est pas
  mesuré.
- **Le verrouillage par compte** (`lockedUntil`, dix échecs, quinze minutes) n'a
  été ni exercé par un cas, ni exercé par moi : vérifié par lecture seulement.
- **La course a été mesurée sur une seule machine**, PostgreSQL 16 local en
  `READ COMMITTED`, sans pooler. Ni base gérée, ni pooler en mode transaction,
  ni autre niveau d'isolement.
- **La dérive d'horloge entre instances** (C12) est raisonnée depuis le
  prédicat, pas reproduite : une seule instance, une seule horloge.
- **Un seul navigateur** (Chromium), **une seule langue** (français), **une
  seule origine** (`localhost`). Ni Safari, ni Firefox, ni un vrai domaine.
- **Aucun déploiement.** Rien de ce rapport ne dit ce que fait le code en
  production.

## 10.11 Verdict

Les trois constats lourds de la première revue sont **fermés, et fermés par
mesure** : l'empreinte volée est refusée sur six formes d'entrée et la mutation
qui refusionne les deux chemins rougit trois cas ; le second facteur vaut sur
les trois voies que l'application expose, et rendre au `matcher` sa forme
d'origine rougit deux cas ; un compteur TOTP ne sert qu'une fois, et les trois
mutations annoncées rougissent une par une. La course de `incrementOne` reste
fermée, 3/3 vertes contre 3/3 rouges. Aucun `critical` ne reste.

Ce qui bloque le calme, sans bloquer le ship, est d'une autre nature : la
propriété que ce tour a payé cher tient sur une **liste écrite à la main**, et
aucune commande n'échoue quand un prochain chemin de connexion s'ajoute. s14
livre les passkeys, qui ouvrent une session par leur propre point d'entrée. La
garde doit changer de forme — énumérer les exemptions, pas les protections —
avant que le trou ne se rouvre en silence sous une suite verte.

Les trois `minor` mesurés (horloge, deux connexions dans la même période,
ré-enrôlement dans la même période) partagent un même angle mort : la garde de
rejeu rend « code invalide » à des gens dont le code est juste, et rien dans
l'interface ne les distingue d'un vrai refus.


---

## 11. Clôture du second tour de correction (C11, C4, les messages)

Écrit par l'implémenteur, après la seconde revue. Trois corrections, chacune
avec la commande qui la tient et la mutation qui l'a prouvée. Les mutations ont
toutes été restaurées dans la commande qui les pose, et l'arbre vérifié propre.

### C11 — la garde est renversée : exemptions, plus inclusions

`infrastructure/two-factor-challenge.ts` ne complète plus le `matcher` du
greffon, il le **remplace** : le crochet vaut sur **tout** chemin, et le fichier
énumère les **cinq** exemptions, chacune avec sa raison écrite. Deux familles,
et rien d'autre :

- les **trois points d'entrée de vérification** du second facteur
  (`/two-factor/verify-totp`, `/two-factor/verify-backup-code`,
  `/two-factor/verify-otp` — ce dernier non monté, exempté par famille) : leur
  poser un défi bouclerait, puisque ce sont eux qui les résolvent ;
- les **deux rotations de session d'un appelant déjà authentifié** que le module
  appelle par `auth.api.*` : `/get-session` et `/change-password`.

Cette seconde famille n'était pas dans le constat, et elle **était nécessaire** :
mesuré avant de l'écrire, `setSessionCookie` pose `newSession` sur les deux
(`api/routes/session.mjs:204` sous `updateAge`, un jour ici ;
`api/routes/update-user.mjs:185`), et un appel direct `auth.api.*` traverse le
même répartiteur de crochets (`api/to-auth-endpoints.mjs`). Sans exemption, un
compte protégé perdait sa session **au premier renouvellement**, c'est-à-dire un
jour après sa connexion, sans qu'aucun cas existant ne le voie. Les deux cas
neufs de `tests/auth.test.ts` (« ne pose pas de défi quand… ») le mesurent :
retirer les deux exemptions ⇒ **2 rouges**.

`/update-user` et `/change-email` font tourner la session eux aussi et ne sont
**pas** exemptés : le module ne les monte pas. C'est le sens d'échec voulu — une
exemption manquante donne un défi de trop, visible tout de suite ; une inclusion
manquante donnait une session sans second facteur, en silence.

**La commande qui échoue.**
`packages/modules/auth/src/infrastructure/two-factor-challenge.test.ts` fait
passer par la garde une **route de connexion fictive** — `/canari/sign-in`, que
rien du module ne cite — et `/passkey/verify-authentication`, celle que s14
monte. Écrit **avant** le correctif, il était rouge sur la forme d'origine
(mesuré : 2 cas rouges, dont l'échec de la route fictive). Rendre au `matcher`
une liste d'inclusions le rougit à nouveau.

Ce que ce tour ne prouve pas, et qu'il ne faut pas lire comme prouvé : la garde
échoue désormais *fermée*, elle ne devine pas quel nouveau point d'entrée
mériterait une exemption. Les cinq exemptions sont celles trouvées sur ce
balayage-ci — les points d'entrée du greffon `two-factor` et les deux appels
`auth.api.*` du module —, pas un inventaire de ce que la bibliothèque expose.

### C4 — la condition d'escalade a sa commande

`tests/auth.test.ts`, « n'authentifie rien avec le jeton que la bibliothèque
laisse dans le corps de la connexion » : le `token` relayé par `/sign-in/email`
est relu dans le corps, puis présenté en `Authorization: Bearer` — sur une route
protégée du module (**401**) et au résolveur de session (**null**).

*Mutation* : monter `bearer()` dans les greffons ⇒ **1 rouge**, sur ce cas et
lui seul. C'est exactement le jour où le paragraphe en gras de l'`AGENTS.md` du
module doit être relu ; il renvoie désormais à ce cas.

### Les trois mineurs — le refus ne ment plus

C12, C13 et C14 partageaient un angle mort : la garde de rejeu rendait « code
invalide » sur un code **juste**. Une troisième classe, `used`, est rendue par
ce chemin-là et par lui seul (`domain/two-factor.ts`,
`presentation/auth-routes.ts`), avec son message dans les deux locales : « Ce
code a déjà servi. Attendez celui que votre application affichera ensuite. »

Ce qui ne change pas, et c'est ce qui empêche l'oracle : le **statut** reste
`401`, identique à tous les autres refus, et `used` n'est atteignable qu'avec un
défi ouvert ou une session — donc après le premier facteur, sur son propre
compte. Pour qui n'a rien présenté, les refus du module restent indistinguables.
Un code **faux** reste `invalid` : c'est le cas « détruit le défi au sixième
essai » qui le mesure, et il n'a pas bougé.

*Mutations* : rendre `invalid` sur le chemin de rejeu ⇒ **1 rouge**
(`tests/auth.test.ts`) ; retirer la branche `used` de l'écran ⇒ **1 rouge**
(`e2e/two-factor.spec.ts`), les cas de nœud restant verts — c'est ce qui prouve
que le message atteint bien la page.

**Le parcours navigateur** porte le cas de tous les jours : après la connexion
par code d'application, le **même** code est représenté sur un défi neuf, et
l'écran affiche « a déjà servi ». Aucun tour de connexion supplémentaire n'a été
ajouté — la tentative se greffe sur le défi du dernier tour, après le code de
secours rejoué, parce qu'une vérification acceptée par la bibliothèque consomme
le défi.

**Reste dit comme un code faux, et ce n'est pas mesuré** : un **code de secours**
déjà consommé. La bibliothèque rend le même `INVALID_CODE` pour un code inconnu
et pour un code retiré, et le module ne garde aucune trace des codes consommés —
c'est le prix du stockage haché (ADR 028). Nommé dans l'`AGENTS.md` du module,
non corrigé ici.

### La recherche §2.3

L'affirmation « `beginAttempt(5)` répond au *six chiffres se devinent* » est
corrigée dans `docs/research/s13-two-factor.md` : les deux verrous ne s'arment
que sous `isSignIn`, et le chemin `/two-factor/verify-totp` **avec** session n'a
aucun compteur. Propagé à `packages/modules/auth/AGENTS.md`, pour que s28
n'hérite pas de la prémisse inverse.

### Les commandes de ce tour

| Commande | Résultat |
|---|---|
| `pnpm typecheck` | vert, 16 tâches |
| `pnpm lint --max-warnings=0` | vert |
| `pnpm test` | **950 passés**, 2 ignorés, 32 fichiers (+5 cas, +1 fichier) |
| `E2E_PORT=3113 pnpm test:e2e` | **50 passés**, 3 ignorés |
| `pnpm build` | vert |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert |

Les deux lignes de verdict ci-dessous sont celles de la seconde revue, laissées
telles quelles : le verdict appartient au relecteur, pas à l'implémenteur.

Max severity: major
Ship allowed: yes
