# Review — Story s28-rate-limiting

> Fresh-context review. Diff : `git diff dev...feature/s28-rate-limiting` (commit `18dfb9d`, 73 fichiers, +4132/−323).

## Commandes exécutées par la revue

| Commande | Résultat |
|---|---|
| `pnpm test` | **1912 passés, 8 sautés, 60 fichiers** |
| `pnpm test` avec `DATABASE_URL` sur port mort | 2 échecs, **341 sautés** contre 8 → **333 cas adossés à la base ont réellement tourné** |
| `pnpm typecheck` · `pnpm lint` · `pnpm build` | verts |
| `pnpm test:e2e` | **87 passés, 8 sautés** ; `e2e/rate-limiting.spec.ts` passe avec un vrai 429, `retry_after=146s` |
| `pnpm db:generate` · `pnpm run audit` | sans dérive ; 1 avis, aucun non excepté |

Arbre final propre, aucun schéma de sonde laissé en base.

## Plan compliance

- [x] Les onze tâches sont présentes et réelles. Les tâches 4 (double limitation) et 6 (convergence) sont porteuses et tiennent.
- [x] **Les huit interdits vérifiés un par un.** Les deux anciennes tables sont **identiques à `dev`** au octet près, aucune migration supprimée, `public_form_throttle` toujours asserté présent en base réelle. IP jamais en clair : condensat SHA-256 asserté sur une vraie ligne (`^[0-9a-f]{64}$`). Aucune origine CSP ajoutée. Aucun second compteur : les deux implémentations locales sont supprimées.

## Anti-hallucination

- [x] Chaque import et appel ouvert et vérifié — aucune référence inventée. Les **deux** appelants de production du répartiteur passent la garde ; un oubli aurait rendu 429 sur tout.
- [x] Pas de contournement par type de contenu : la garde analyse JSON **et** formulaire, un sur-ensemble strict de ce que lit le gestionnaire.
- [ ] **Une valeur plausible-mais-fausse a survécu** : `sweep(before: Date)` ne peut plus signifier « fenêtre close » depuis que les seaux portent des durées différentes — constat **C1**, prouvé contre la base réelle.

## Tests

- [x] **Le vecteur distribué est réellement simulé, pas répété.** 40 × 250 = **10 000 adresses distinctes**, un essai chacune, un seul compte. Assertions : `allowed === maxPerSubject` (20), `refused === 9980`, et le refus n'atteint jamais le gestionnaire. Le parcours navigateur fait de même contre l'application démarrée.
- [x] Le double de test **n'est pas complaisant** : il réemploie les fonctions de production. La propriété qu'il ne peut pas montrer — le partage entre instances — est mesurée contre PostgreSQL avec **deux pools distincts**.
- [x] **Morsure prouvée** — neuf mutations, chacune au site du défaut, chacune restaurée :

| # | Mutation | Site | Rouges |
|---|---|---|---|
| M1 | seau par compte retiré | `route-rate-limit.ts` | **3** |
| M2 | magasin absent → laisse passer | idem | **2** |
| M3 | aucune garde → laisse passer | `packages/core/src/registry.ts` | **1** |
| M4 | filtre des artefacts de chargeur retiré | `packages/db/src/schema.ts` | **`pnpm build` échoue** + **3** |
| M5 | `routeIsRateLimited` perd la clause `public` | `registry.ts` | **1** |
| M6 | `REFUSE_WHEN_STORE_IS_DOWN = 0` dans les deux throttles | marketing + billing | **0** ← m4 |
| M7a | échappatoire d'environnement dans un fichier balayé | `rate-limit-rules.ts` | **1** |
| M7b | même échappatoire dans un **nouveau** fichier | `escape-probe.ts` | **0**, et `pnpm lint` vert ← m1 |
| M8 | réécrire dans `public_form_throttle` | `drizzle-public-forms.ts` | **1** |

## Findings

### C1 — **critical** — un balayage devenu global détruit des seaux encore ouverts, et affaiblit six fois cinq limites par compte

`sweep` supprime toute ligne dont `window_started_at < before`, **sur toute la table partagée**. `marketing` l'appelle avec **sa** fenêtre de 600 s, `billing` avec la sienne. Avant s28 chacun ne balayait que sa propre table : c'était sûr. Désormais il efface les seaux de **toutes** les routes — y compris les seaux **par compte encore ouverts**, de 3600 s : `signUp`, `passwordReset`, `magicLink`, `emailVerification`, `invitation`, tous à `maxPerSubject: 5` par heure.

Prouvé contre la base réelle, sonde créée puis supprimée :

```
5 consommations de '/auth/request-password-reset:subject:victime@example.test'
  (max 5, fenêtre 3600 s) à 10:00:10  →  la 6ᵉ à 10:05 est refusée ✔
limiter.sweep(windowStartOf(10:20:00, 600))  →  { ok: true, removed: 1 }
consommation suivante à 10:21  →  hits = 1, exceeded = false
```

Le compteur horaire est remis à zéro **quarante minutes avant** la fermeture de sa fenêtre. Et c'est déclenchable à distance, en boucle : le balayage de `marketing` part dès que le seau global de formulaire atteint 1, donc **à la première soumission** de `/marketing/contact` ou `/marketing/newsletter` de chaque fenêtre de 600 s — et la vérification de débit s'exécute **avant toute validation**, donc un **POST vide** suffit. Une requête toutes les dix minutes transforme « 5 par heure » en « 5 par dix minutes », soit environ six fois la valeur déclarée, pour le bombardement de réinitialisation, de magic link, l'abus d'inscription, et le seau que `config/security.ts` appelle « celui qui empêche le harcèlement ».

La cause est dans le **contrat du port**, pas aux points d'appel : `sweep(before: Date)` ne peut pas exprimer « fenêtre close » quand les seaux portent des durées différentes, et le schéma ne persiste jamais `window_seconds` bien que l'implémentation le calcule. La documentation du port affirme l'inverse — « efface les seaux dont la fenêtre est **close** ». La propriété vedette (bourrage distribué sur `signIn`, fenêtre 300 s) n'est **pas** touchée : un seau de 300 s est réellement clos à chaque frontière de 600 s.

### M1 — **major** — rien ne balaie sur le chemin de s28 : croissance non bornée depuis un point d'entrée anonyme

`sweep` n'a que **deux** appelants de production, tous deux dans des modules **optionnels**. Le répartiteur ne balaie jamais, le point de composition non plus, et `rateLimitModule` déclare `jobs: []` alors que le contrat de module porte les tâches planifiées. Coupez `marketing` et `billing` — deux configurations livrables légitimes — et `rate_limit_window` n'est **jamais** récupérée. La clé de ligne dérive de `x-forwarded-for`, que l'appelant écrit : n'importe quel client anonyme insère un nombre illimité de lignes permanentes dans la base de l'application. C'est le constat F1 de la revue de s11, réintroduit sur 31 points d'entrée au lieu de 2.

### M2 — **major** — le seau par appelant est contournable par en-tête, et la politique 2FA affirme le contraire

`clientIdentifierOf` prend le premier élément de `x-forwarded-for` sans condition. Aucun proxy de confiance configuré, aucun compte de sauts, aucune liste d'adresses — et `docs/deployment.md` ne contient ni « proxy », ni « nginx », ni « caddy », ni « traefik » : la pile livrée expose Next directement. L'attaquant fait tourner l'en-tête, et le seau par appelant n'existe pas pour lui ; il peut aussi **brûler celui d'une victime** en envoyant son adresse.

La réponse de conception est `maxPerSubject`, et elle est juste pour `signIn`. Mais `config/security.ts:175-178` dit de `twoFactor` : « Six chiffres, donc un million de possibilités : le seuil est ce qui empêche de les parcourir » — alors que `twoFactor` a **`maxPerSubject: null`**, que la route est `public` (correctement, le défi n'a pas encore de session), que le corps ne porte que `code`, et qu'aucun compteur de tentatives n'existe dans le domaine `auth`. Le seul seau protégeant la vérification TOTP et les codes de secours est donc **le seau contournable**, et l'affirmation écrite n'est pas tenue. Même forme pour `passkey`, `upload`, `guestCheckout` et `publicForm`.

Ce n'est pas une régression — rien ne les limitait avant s28 — mais c'est une **fausse garantie dans le fichier que lit l'exploitant**, sans la moindre consigne de proxy de confiance.

### M3 — **major** — cinq fichiers portent encore l'instruction que l'ADR de cette story refuse

`marketing/src/schema.ts:79`, `billing/src/schema.ts:389`, `billing/src/domain/checkout-throttle.ts:16`, `marketing/src/module.ts:57`, `marketing/src/domain/rate-limit.ts:7,18` disent tous que « s28 supprimera la table » — et le dernier renvoie à une fonction que ce diff **supprime**. La recherche avait identifié ce piège mot pour mot, l'ADR 050 lui consacre un paragraphe, et les deux en-têtes de table le portent toujours. Après la fusion, la phrase se lit « s28 a oublié ».

### m1 — **minor** — le balayage anti-échappatoire est énuméré, pas dérivé
Onze chemins écrits à la main. Prouvé : un fichier neuf portant `process.env['DISABLE_RATE_LIMIT']` laisse les 1912 tests **et** `pnpm lint` verts. Le fichier sait pourtant dériver ailleurs.

### m2 — **minor** — deux affirmations d'exhaustivité
`AGENTS.md` du module et `tests/fixtures/rate-limit.ts` disent que le balayage couvre « le dépôt ». Il couvre onze fichiers nommés. L'ADR 050 le dit correctement.

### m3 — **minor** — le résumé de la note d'exécution du plan dit encore « trois écarts, et une panne préexistante »
La rétractation elle-même est complète et committée ; seule la ligne de résumé n'a pas suivi, et c'est elle qu'on lit en diagonale.

### m4 — **minor** — « un magasin muet refuse » n'est vérifié par aucune commande aux deux throttles de module
`REFUSE_WHEN_STORE_IS_DOWN = 0` dans les deux fichiers laisse 1912 tests verts. Sans conséquence exploitable aujourd'hui — le répartiteur refuse en amont — mais c'est le mode de défaillance que le dépôt nomme, sur un chemin de sécurité.

### m5 — **minor** — `/api/health` est un point d'entrée public hors répartiteur, donc hors couverture, et l'exclusion n'est jamais nommée
Elle est défendable — une sonde de disponibilité limitée serait absurde — mais `AGENTS.md` dit désormais « every public entry point », ce qui se lit plus large que ce qui est livré.

## Ce que la revue a tranché, point par point

**Bourrage distribué** : tenu et prouvé, 10 000 adresses distinctes. **Couverture dérivée** : vérifiée par grep — aucun identifiant de module ni chemin de route dans le chemin du limiteur — et par mutation. **Pas d'échappatoire d'environnement** : le code livré n'en a aucune ; le garde qui le tient est énuméré (m1). **Magasin absent refuse** : prouvé au répartiteur, et l'exception au socle est argumentée à cinq endroits. **`composeSchema`** : la seconde faute est vérifiée indépendamment — le `composeSchema` de `dev` ne filtre rien, donc un seul baril vide serait entré dans le schéma comme une table ; la faute était **latente**, la régression bien celle de s28, et le correctif ne peut pas avaler une déclaration réelle. **Seuils élargis** : défendables, mesurés, et ils n'affaiblissent pas la propriété de sécurité, qui vit dans `maxPerSubject`. **Les deux vieilles tables** : présentes et non écrites, les deux moitiés vérifiées. **Le captcha** : le manque est nommé honnêtement aux cinq endroits attendus.

## Non vérifié

- **Aucun proxy inverse réel.** `x-forwarded-for` était toujours absent ou écrit par le test. Un humain doit déployer derrière le vrai proxy et confirmer qu'il **écrase** l'en-tête au lieu de l'ajouter.
- **Aucune exécution multi-conteneurs.** Le partage est prouvé par deux pools contre une base — le bon substitut, mais deux instances réelles n'ont jamais tourné.
- **Aucune mesure de charge.** `guest-checkout:all` et `contact:all` sont des lignes chaudes uniques derrière un délai de 2 s.
- **Aucun Stripe réel** : la politique de webhook (600/min) n'a jamais vu un fournisseur rejouer une rafale après panne.
- **`actionlint` et le scan de secrets** non exécutés, bien que la DoD du plan nomme `actionlint`.
- **L'exploitation de C1 de bout en bout** a été prouvée au niveau du limiteur contre la base réelle, pas en pilotant les deux routes HTTP à la suite. Qui corrigera devra le faire : cinq demandes de réinitialisation, un POST vide au formulaire, puis une sixième — elle doit rester 429.

## Verdict


---

# Re-revue après correctifs (commit `2cafa1c`)

`pnpm test` **1926 passés / 8 sautés** (335 cas adossés à la base, prouvé par
port mort) · `pnpm build --force` vert · `pnpm test:e2e` **88 passés** ·
`pnpm test:minimal-profile` vert · `actionlint` vert · `gitleaks` 0 alerte sur un
fichier suivi.

## C1 de la revue précédente — réellement corrigé, au contrat

`sweep(now)` compare `expires_at`, porté par la ligne et réécrit à chaque
`consume`. La propriété tient pour **toute** forme de seau :
`expires_at = windowStartOf(now, W) + W`, donc `expires_at <= now` est
exactement la négation de « ouvert ». Vérifié qu'aucun appelant ne passe un
instant futur, et qu'une collision de clé fabriquée est impossible.

Mutation A (retour au balayage global) : **3 rouges vitest + 2 rouges e2e**. La
preuve de bout en bout est réelle — sous mutation, `e2e/rate-limiting.spec.ts`
rougit à la ligne 127, `200` au lieu de `429`.

**M1, M3, m1 à m5 sont fermés**, chacun vérifié par mutation.

## C1 (nouveau) — **critical** — le seau de défi 2FA se contourne par un leurre de cookie

`subjectOfCookie(header, 'two_factor')` retient **le premier** couple dont le nom
se **termine** par le suffixe. L'en-tête `Cookie` est écrit intégralement par
l'appelant. Better Auth, lui, lit son cookie par **nom exact**
(`dist/cookies/index.mjs:266`, `dist/plugins/two-factor/verify-two-factor.mjs:16-18`).

Les deux ne lisent donc pas le même cookie :

```
Cookie: two_factor=<compteur>; __Secure-better-auth.two_factor=<le vrai défi>
```

Mesuré contre l'application démarrée :

```
sans leurre  → 401×10 puis 429×10   (le seau mord à maxPerSubject: 10)
avec leurre  → 401×20, aucun 429    (le seau ne mord jamais)
```

Au répartiteur, avec le vrai registre : **200 tentatives, 0 refus**. Le seau par
appelant ne rattrape rien — il repose sur `x-forwarded-for`, que la sonde faisait
déjà tourner. Résultat net : **énumération non bornée des six chiffres** pour qui
détient le mot de passe.

Ce qui en fait un `critical` plutôt qu'un major : le diff **livre la garantie
inverse en quatre endroits**, dont `docs/security.md` dans un tableau intitulé
« Ce qui est tenu / Ce qui échoue si on le viole », colonne `pnpm test` — et
`pnpm test` ne rougit pas. Le seul cas vérifie l'inverse du risque (que
`two_factor_autre` ne corresponde pas), jamais qu'un leurre correspondant
**prime**.

**Deux voies** : lire par nom exact en dérivant le préfixe de la configuration
d'authentification, ou **refuser quand plusieurs cookies correspondent**. Dans
les deux cas, un cas de test doit poser le leurre en tête. Si la propriété ne
peut pas être tenue, ce sont les quatre affirmations qui doivent partir — elles
sont plus dangereuses que l'absence de seau.

## M1 — **major** — `pnpm test:e2e` se coupe lui-même au troisième passage de l'heure

Premier essai de la revue : **2 rouges**, bloqués à l'inscription. Cause en base,
pas dans les specs : `sha256('/auth/sign-up/email:client:::1')` à **122
passages** pour un `maxPerClient` de 120. Magasin vidé, la même commande passe
88/88 en laissant 41 passages — donc **le troisième `pnpm test:e2e` d'une même
heure échoue** contre une base persistante.

Trois raisons d'en faire un constat : le message **ne nomme rien** (un locator
qui expire, ni 429 ni limitation) ; la marge de deux passages n'est écrite nulle
part alors que `config/security.ts` documente longuement la mesure qui a fixé le
seuil ; et la CI n'est verte que par accident de conception — chaque branche a sa
base neuve. Un `truncate` dans le préambule Playwright suffirait, avec la raison.

## Mineurs

- **m1** — l'exclusion des citations de la règle M3 s'abuse en une paire de
  guillemets : `« s28 supprimera cette table. » Faites-le.` laisse 35 verts.
- **m2** — les contrats de `marketing` et `billing` déclarent encore
  `sweep(before: Date)` et « fenêtre close » sans le « **leur propre** ». Le
  vocabulaire qui a autorisé le défaut survit là où un agent lit avant d'écrire.
- **m3** — « Named exception : `/api/health` » se lit comme exhaustif ; il y a
  six routes hors répartiteur, dont trois 404 en production.
- **m4** — `tests/billing.test.ts:5605` instable 1 fois sur 6 (compte global de
  `auth_session`), sur une assertion dont tout le propos est « aucune session
  n'a été ouverte ». Non imputable à s28.
- **m5** — `billing` passe `max: maxGlobal` pour son seau **par appelant** ; sans
  effet aujourd'hui car le module ignore `exceeded`, faux pour le premier
  appelant qui le lira.

## Ce qui tient, re-vérifié

Vecteur distribué (10 000 adresses, 4 rouges sous mutation) · couverture dérivée
du registre (1 rouge) · répartiteur fail-closed (1 rouge) · `composeSchema`
(3 rouges + build) · les deux vieilles tables **à 0 ligne** après suite et e2e
complets · condensat SHA-256 sur lignes réelles · balayage anti-échappatoire
désormais **dérivé du disque** (2 et 1 rouges là où la revue précédente avait 0)
· configuration à modules coupés verte.

## Non vérifié

Aucun proxy inverse réel · aucune exécution multi-conteneurs, donc **dérive
d'horloge** jamais observée sur `expires_at` · aucune mesure de charge sur les
lignes chaudes · aucun Stripe réel sur la politique `webhook` ·
`pnpm test:golden-path` non exécuté sous limitation, alors qu'il enchaîne des
inscriptions depuis une seule adresse — même famille de risque que M1 · le
contournement C1 prouvé au limiteur et lu dans la bibliothèque, **pas joué
contre un défi 2FA authentique de bout en bout**.

> Verdict de la ronde 2 — **dépassé par la ronde 3 ci-dessous** :
> Max severity: critical · Ship allowed: no

---

# Troisième revue — après le correctif du contournement 2FA (commit `b6ad568`)

> Contexte neuf. Diff : `git diff dev...feature/s28-rate-limiting`, 85 fichiers, +5460/−365.
> Les deux critiques des rondes précédentes ont été rejoués contre l'application démarrée,
> pas relus.

## Commandes exécutées par la revue

| Commande | Résultat mesuré ici |
|---|---|
| `pnpm typecheck` | **0** — 25 tâches |
| `pnpm lint` | **0** — « ESLint: No issues found » |
| `pnpm test` | **1932 passés / 8 sautés (1940)**, deux passages complets, exit 0 |
| `pnpm build --force` | **0** |
| `pnpm test:e2e` | **89 passés / 8 sautés**, **trois passages consécutifs** (ports 3161, 3163, 3164), exit 0 chacun |
| `pnpm test:minimal-profile` | **4 passés**, exit 0 — 4 modules coupés, 14 routes et 4 entrées balayées |
| `pnpm run audit` | **vert** : « 1 avis remonté(s), aucun au seuil « élevé » qui ne soit couvert » |
| `pnpm db:migrate` ×2 | appliqué, puis « Rien à appliquer » — `rate-limit` dans la liste des modules migrés |
| `pnpm db:generate` | « No schema changes » — aucune dérive |
| `actionlint` | **non exécuté** : le diff ne touche aucun fichier de `.github/` |

Arbre propre après chaque mutation (`git diff --exit-code`), et propre à la fin.

**Sur le `pnpm run audit` que l'implémenteur n'a pas su rendre vert.** C'était bien un
aléa d'infrastructure. Vérifié de deux façons : la commande passe ici, et le diff de
`pnpm-lock.yaml` (+28, −0) n'ajoute **que** des liens d'espace de travail
(`link:packages/modules/rate-limit`) et des résolutions déjà présentes dans le graphe
(`drizzle-orm@0.45.2`, `zod@4.5.4`, `typescript@7.0.2`, `@types/node@22.20.1`). Aucun
paquet de registre nouveau n'entre par cette story — il n'y avait donc rien de neuf à
auditer. Ce n'est pas une défaillance de porte.

**Un point d'environnement, à dire plutôt qu'à taire.** `pnpm test:e2e` **ne démarre
pas** dans ce worktree tel quel : le `.env` importé porte `STRIPE_SECRET_KEY` et
`STRIPE_WEBHOOK_SECRET`, et `PAYMENTS_LOCAL_MODE=1` que pose `playwright.config.ts` les
refuse au démarrage, en le nommant — le comportement voulu. Les trois passages ci-dessus
ont été obtenus avec ces deux variables vidées dans l'environnement. Ce n'est pas un
défaut de la story (`.env` n'est pas suivi), mais le « 89 passés trois fois » n'est pas
reproductible sans ce geste.

## C1 de la ronde 2 (leurre de cookie) — rejoué, et réellement fermé

Application démarrée (`next dev`, port 3155), vrai PostgreSQL (5438), politique
`twoFactor` = 300 s / `maxPerClient: 60` / `maxPerSubject: 10`.

```
leurre en tête, valeur du leurre qui tourne, x-forwarded-for qui tourne, 20 essais
Cookie: two_factor=leurre-N; __Secure-better-auth.two_factor=<défi fixe>
  → 401 401 401 401 401 401 401 401 401 401 429 429 429 429 429 429 429 429 429 429
```

Refus **exactement** au seuil. La mesure de la ronde 2 était 401×20 sans un seul 429.

Les deux formes que la ronde 2 n'avait pas jouées, et qui comptent parce que le nom réel
dépend de `useSecureCookies` :

```
__Secure-better-auth.two_factor=<leurre> ; better-auth.two_factor=<vrai>   → 429 dès le 1er
__Secure-better-auth.two_factor=<leurre> ; __Secure-better-auth.two_factor=<vrai> → 429 dès le 1er
```

Le refus d'ambiguïté couvre donc **les deux** formes de déploiement, pas seulement celle
que la CI joue.

Les noms déclarés sont les bons, vérifiés dans la bibliothèque et non déduits :
`dist/cookies/index.mjs:20-46` compose `${secureCookiePrefix}${prefix}.${cookieName}`,
`SECURE_COOKIE_PREFIX = "__Secure-"` (`dist/cookies/cookie-utils.mjs:10`),
`TWO_FACTOR_COOKIE_NAME = "two_factor"` (`dist/plugins/two-factor/constant.mjs:2`).
`betterAuth(` n'apparaît qu'une fois dans le dépôt
(`packages/modules/auth/src/infrastructure/better-auth-service.ts:380`) et son
`advanced.cookies` ne pose que `state` : le cas
« n'invente pas le nom du cookie » couvre bien les deux façons dont ce nom pourrait bouger.

## Morsure prouvée — cinq mutations, chacune au site du défaut, chacune restaurée

| # | Mutation | Site | Rouges |
|---|---|---|---|
| A | `subjectOfCookies` remis en **correspondance par suffixe**, premier couple retenu (le défaut C1 de la ronde 2) | `rate-limit-rules.ts` | **2 vitest** + **1 e2e** — `e2e/rate-limiting.spec.ts:169`, contre l'application démarrée |
| B | l'ambiguïté ne refuse plus (`found.kind === 'ambiguous' && false`) | `route-rate-limit.ts` | **1 vitest** |
| C | le seau par **compte visé** n'est jamais poussé | `route-rate-limit.ts` | **5 vitest** — bourrage distribué, adresse inconnue, énumération 2FA, leurre 2FA, journalisation du dépassement |
| D | `sweep` remis à comparer `window_started_at` (le défaut C1 de la ronde 1) | `drizzle-rate-limiter.ts` | **3 vitest**, contre la **vraie base** |
| E | `routeIsRateLimited` perd la clause `public` | `packages/core/src/registry.ts` — le **point de composition** | **1 vitest** |

La mutation A est la seule qui rougisse **aussi** en navigateur : c'est la preuve que le
parcours e2e n'est pas décoratif. Aucune mutation n'a été posée ailleurs qu'au site du
défaut. `git diff --exit-code` propre après chacune, et `pnpm test` re-vert à la fin
(1932/8).

## `pnpm test:e2e` est réellement répétable, et le nettoyage est porteur

Trois passages d'affilée, 89 passés chacun. Le préambule est **mesuré porteur**, pas
supposé : après un passage complet, `sha256('/auth/sign-up/email:client:::1')` porte
**41** passages, fenêtre `09:00 → 10:00`, seuil `maxPerClient: 120` — le troisième
passage d'une même heure franchit donc bien la borne.

Vérifié par mutation du préambule : nettoyage désactivé et ce seau amené à 110, la suite
tombe à **62 passés / 27 échoués**, et **pas un seul échec ne nomme la limitation** — des
locators qui expirent, exactement le symptôme que le fichier décrit. Préambule restauré,
magasin vidé.

## Ce que la base dit, après suite complète et parcours complets

`rate_limit_window` : 176 lignes, toutes les clés en SHA-256 hexadécimal — aucune adresse
en clair. `public_form_throttle` : **0 ligne**. `billing_checkout_throttle` : **0 ligne**.
Les deux moitiés de la décision 1 tiennent : plus écrites, toujours déclarées.

Refus observé en direct, en-têtes et corps compris :

```
HTTP/1.1 429 Too Many Requests
retry-after: 136                        (fenêtre 300 s — la valeur suit la fenêtre réelle)
{"error":"rate_limited"}                (ni seau, ni seuil, ni cible)
[rate_limit.exceeded] POST /auth/two-factor/verify-totp client=203.0.199.11 bucket=subject retry_after=136s
```

Critère 6 tenu et sans fuite : l'IP et la route au journal, jamais la valeur du cookie,
ni l'adresse visée, ni le code.

## Plan compliance

- [x] Les onze tâches sont faites. Les cinq écarts de la note d'exécution sont réels et
      argumentés ; le manque nommé (captcha sans fournisseur) l'est aux six endroits attendus.
- [x] Les huit interdits vérifiés. Les deux `pgTable` sont intacts, aucune migration
      supprimée, aucune origine ajoutée à la politique de sécurité du contenu
      (`frame` et `script` restent vides, asserté), aucun second compteur, aucune variable
      d'environnement.
- [x] Les cinq routes Next hors répartiteur sont **nommées avec leur raison** dans
      `docs/security.md` §7 et dans `AGENTS.md` racine, et le **compte** est asserté :
      `find apps/web/app/api -name route.ts` rend bien 6 fichiers, dont 1 point de montage.

## Anti-hallucination

- [x] Chaque import et chaque appel ouvert. `is`, `Table`, `lte`, `sql` existent bien dans
      `drizzle-orm` (vérifié à l'exécution). Les deux appelants de production de
      `dispatchModuleRequest` passent tous deux le garde — un oubli aurait fait 429 partout.
- [x] `expires_at` porté par la ligne, réécrit à chaque `consume`, indexé ; `sweep` ne fait
      plus que comparer. La propriété tient pour toute durée de seau, et la mutation D le
      montre contre la vraie base.
- [ ] **Une valeur plausible-mais-fausse subsiste** : le limiteur et la bibliothèque lisent
      maintenant le même **nom**, mais toujours pas la même **valeur** — constat M1.

## Rules compliance

- [x] ADR 050 respecté dans les deux sens : le magasin absent refuse, les deux tables sont
      abandonnées sans être supprimées, la table appartient à un module du socle.
- [x] ADR 027 : aucune origine tierce ajoutée. ADR 020 : le module reçoit sa connexion.
      ADR 008 : une seule implémentation. ADR 021 : `rate-limit` dans `requiredModules`,
      et `pnpm test:minimal-profile` reste vert avec 4 modules coupés.
- [x] Design system : le diff ne contient **aucun** `.tsx`, aucun composant, aucun token,
      aucune couleur. Il n'y a pas d'écran à regarder.
- [x] Les quatre affirmations que la ronde 2 avait déclarées inverses du code disent
      maintenant ce qui est tenu — sauf sur le point exact de M1 ci-dessous.

## Findings

### M1 — **major** — le limiteur et la bibliothèque lisent le même **nom**, toujours pas la même **valeur**

`subjectOfCookies` rend la sous-chaîne **brute** qui suit le `=`, seulement `trim()`ée,
puis `subjectBucketKey` la met en minuscules. La bibliothèque, elle, ne lit pas cette
valeur-là. Le chemin exact du second facteur est
`ctx.getSignedCookie(...)` → `better-call@1.4.0/dist/context.mjs:38` →
`parsedCookies.get(nom)`, et ce `parsedCookies` vient de
`better-call/dist/cookies.mjs:19-40`, qui **retire les guillemets encadrants** puis
applique `tryDecode`, c'est-à-dire `decodeURIComponent` dès que la valeur contient `%`.

Conséquence : l'appelant, qui écrit l'en-tête `Cookie` en entier, peut envoyer **le même
défi** sous autant d'encodages qu'il veut. Mesuré contre l'application démarrée, quinze
essais portant chacun un caractère différent encodé en `%XX` de la **même** valeur, contre
quinze essais portant la valeur brute :

```
encodages du MÊME défi  : 401 401 401 401 401 401 401 401 401 401 401 401 401 401 401
même valeur brute       : 401 401 401 401 401 401 401 401 401 401 429 429 429 429 429
```

Le seau par défi se scinde à volonté. C'est la même classe de défaut que C1 de la ronde 2,
sur un autre axe de normalisation : la ronde 2 a rendu le **nom** exact, elle n'a pas
rendu la **valeur** identique.

Ce qui l'empêche d'être un critique, et il faut l'écrire parce que c'est ce qui a manqué
aux deux rondes précédentes : **l'énumération reste bornée, mais par la bibliothèque, pas
par s28**. `dist/plugins/two-factor/totp/index.mjs:184-185` appelle `beginAttempt(5)` dès
que `isSignIn` — c'est-à-dire exactement sur le chemin du défi —, et
`verify-two-factor.mjs:69-96` compte sur l'identifiant `2fa-attempts-<valeur décodée>`,
détruisant le défi au cinquième essai (`TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE`) ; s'y ajoute
un verrouillage de compte (`assertTwoFactorNotLocked` / `recordTwoFactorFailure`). **Cinq
est plus serré que les dix de `maxPerSubject`** : sur un défi authentique, le seau de s28
ne peut jamais mordre le premier. Sa neutralisation ne change donc rien à ce qu'un
attaquant obtient — et c'est aussi ce qui fait que le seuil de 10 est, en l'état, sans
effet.

Ce qui est faux, en revanche, est ce que le diff écrit. `config/security.ts` :
« c'est `maxPerSubject` qui borne l'énumération, et il est compté sur le cookie de défi ».
`docs/security.md` § 7 met la même phrase dans un tableau intitulé « Ce qui est tenu / Ce
qui échoue si on le viole », colonne `pnpm test`, `pnpm test:e2e` — et ni l'un ni l'autre
ne rougit sur la mesure ci-dessus. `packages/core/src/module.ts`, l'ADR 050 et
`packages/modules/rate-limit/AGENTS.md` répètent que « la bibliothèque lit un nom exact,
donc ce qui compte doit lire par nom exact aussi » : le raisonnement est juste, il n'a
simplement pas été mené jusqu'à la valeur.

Deux voies, et la seconde n'est pas un repli honteux :

1. **normaliser comme la bibliothèque** avant de fabriquer la clé — retirer les guillemets
   encadrants, puis `decodeURIComponent` si la valeur contient `%` —, retirer le
   `toLowerCase()` sur les sujets de cookie (c'est une troisième normalisation, qui ne
   correspond à personne), et ajouter un cas qui rejoue **le même défi encodé** et exige
   le 429 ;
2. **ou** dire ce qui borne réellement : les cinq essais par défi de `better-auth@1.7.2` et
   le verrouillage de compte, en nommant les deux fichiers, et ramener le seau de s28 au
   rang de second filet — auquel cas `maxPerSubject: 10` doit descendre sous 5 pour servir
   à quelque chose, ou disparaître.

Ne rien faire laisserait une garantie de sécurité écrite en cinq endroits que la seule
commande citée ne vérifie pas, et un dépôt dont la protection contre l'énumération
dépendrait en silence du compteur interne d'une dépendance.

### m1 — **minor** — `packages/ports/AGENTS.md` n'a pas suivi le quatrième port

Le fichier de règles qui vit **à côté** du code des ports ne mentionne nulle part
`rate-limit.ts` : pas de section « ce que ce port ajoute au gabarit », pas de ligne dans
le tableau de la forme du journal (qui nomme `MailerLogRecord` et `StorageLogRecord`), et
surtout sa ligne « une panne de tiers **dégrade** » n'est assortie d'aucune mention de
l'exception que cette story assume précisément. L'agent qui lit la règle la plus proche du
code y lit l'inverse de la décision. L'exception est écrite à cinq autres endroits
(ADR 050, `route-rate-limit.ts`, `docs/architecture.md`, `docs/security.md`, `AGENTS.md`
racine), ce qui borne le risque — mais la règle du dépôt est que la doc voyage avec le
code qu'elle décrit.

### m2 — **minor** — `docs/security.md` décrit encore le balayage anti-échappatoire comme énuméré

La ligne « **Aucune variable d'environnement** ne désactive la limitation | balayage des
**onze fichiers** du chemin de limitation » décrit l'énumération manuelle que le constat m1
de la ronde 1 a fait retirer. Le balayage est désormais **dérivé du disque** (tout
`packages/modules/rate-limit/`, plus quatre chemins nommés) avec un plancher assertionné à
onze. Le compte est juste aujourd'hui — c'est la formulation qui invite à recopier une
liste.

### m3 — **minor** — la politique `webhook` partage le seau `unknown` avec n'importe qui

`/billing/webhook` est `public`, donc limitée par `maxPerClient: 600/min` sur le seau de
l'appelant. Hors d'un proxy de confiance, Stripe et un attaquant anonyme tombent dans le
**même** seau (`unknown`) : une inondation anonyme peut pousser les livraisons du
fournisseur en 429. Cela dégrade plutôt que ça ne casse — Stripe rejoue, le `Retry-After`
est honnête, la signature reste vérifiée avant tout effet —, et
`docs/deployment.md` documente bien le mode « tout le monde partage un seul seau ». Mais
il le documente du point de vue des visiteurs, pas du webhook, et c'est le seul point
d'entrée du dépôt où le seau partagé a un effet sur un **tiers** qui ne peut pas
réessayer indéfiniment.

### m4 — **minor, reporté sciemment** — `tests/billing.test.ts:5605` : d'accord pour ne pas le corriger ici

Vérifié : l'assertion est bien un **delta**
(`(await countRows('auth_session')) - before`), donc son instabilité vient d'autres
fichiers qui ouvrent des sessions en parallèle contre la même base, pas de s28. Elle est
passée aux trois passages complets de cette revue. La rendre locale au périmètre du cas
est un changement de la suite de s19 ; le laisser est le bon arbitrage, à condition qu'il
reste écrit — il l'est, dans la note d'exécution du plan.

### nit — l'assertion du cas « cinq routes hors répartiteur » est plus lâche que son propre commentaire

`expect(dispatcher.length).toBeGreaterThanOrEqual(1)` alors que le commentaire juste au-dessus
dit « deux fichiers appellent le répartiteur ». L'assertion porteuse — `apiRoutes` vaut 6 —
mord bien (une sixième route hors répartiteur force la décision) ; c'est la ligne
d'à-côté qui ne tient pas ce qu'elle raconte.

## Ce qui tient, re-vérifié cette ronde

Bourrage distribué (10 000 adresses distinctes, **5 rouges** sous mutation C) · couverture
dérivée du registre (**1 rouge** au point de composition) · répartiteur fail-closed ·
balayage par `expires_at` contre la vraie base (**3 rouges** sous mutation D) · balayage
indépendant de tout module optionnel, plus la tâche planifiée déclarée · les deux vieilles
tables déclarées et **à 0 ligne** · condensats SHA-256 sur lignes réelles · `Retry-After`
qui suit la fenêtre, mesuré en direct à 136 s sur 300 · corps de refus muet · journal avec
IP et route, sans secret · aucune échappatoire d'environnement (balayage dérivé + recherche
d'interrupteur dans plus de 200 sources) · captcha coupé, sans origine, absent de tout
module · configuration à modules coupés verte, y compris `pnpm test:minimal-profile` ·
migrations rejouables sans effet supplémentaire · `pnpm db:generate` sans dérive.

## Non vérifié

- **Aucun proxy inverse réel.** Troisième ronde de suite. `x-forwarded-for` a toujours été
  absent ou écrit par la revue. **Geste humain** : déployer derrière Traefik/nginx/Caddy et
  confirmer, en lisant les en-têtes reçus par l'application, que le relais **écrase**
  `x-forwarded-for` au lieu d'y ajouter — la section de `docs/deployment.md` est correcte
  mais n'a jamais été exercée.
- **Le plafond de cinq essais par défi de `better-auth@1.7.2` est *lu*, pas exercé**
  (`dist/plugins/two-factor/totp/index.mjs:184-185`,
  `dist/plugins/two-factor/verify-two-factor.mjs:69-96`). C'est exactement ce qui maintient
  M1 en `major` plutôt qu'en `critical`. **Geste humain** : enrôler un vrai second facteur,
  brûler six codes faux d'affilée sur un défi authentique, et vérifier que le sixième rend
  bien « recommencez la connexion » et non « code invalide ». Si ce plafond n'existait pas,
  M1 deviendrait un critique.
- **Le leurre n'est toujours pas joué contre un défi authentique.** Le cas vitest et le
  parcours e2e posent tous deux un défi **fabriqué** ; sous `next dev` (HTTP), le vrai
  cookie s'appelle d'ailleurs `better-auth.two_factor`, pas
  `__Secure-better-auth.two_factor` que le parcours envoie. Ils mesurent **qui compte**,
  pas **qui valide** — c'est écrit dans le fichier, et c'est le même trou qu'en ronde 2.
- **Le chemin « session » de la vérification 2FA** (`isSignIn === false`, aucun cookie de
  défi) n'a pas été exercé : le seau par sujet y est absent et seul le seau d'appelant,
  falsifiable, s'applique. Le compte concerné est celui de l'appelant, donc aucun risque
  inter-comptes n'a été identifié — mais rien ne le mesure.
- **Aucune exécution multi-conteneurs** : le partage est prouvé par deux connexions
  distinctes contre une base, ce qui est le bon substitut, mais la **dérive d'horloge**
  entre deux instances n'a jamais été observée sur `expires_at`.
- **Aucun Stripe réel** : la politique `webhook` n'a jamais vu un fournisseur rejouer une
  rafale après panne (voir m3).
- **`pnpm test:golden-path` non exécuté** — il exige un clone, une base créée pour
  l'exécution et un régime de paiement. L'arithmétique dit que sa poignée d'inscriptions
  reste très loin de `signUp.maxPerClient: 120/h`, mais c'est de l'arithmétique, pas une
  mesure.
- **`actionlint` et le scan de secrets non exécutés** : aucun fichier de `.github/` dans le
  diff pour le premier ; pas de Docker disponible pour le second.
- **Aucune mesure de charge** sur les lignes chaudes uniques (`guest-checkout:all`,
  `contact:all`, et désormais le seau `unknown` de chaque route publique derrière un délai
  de 2 s).
- **Aucune preuve navigateur visuelle**, et il n'y en a pas à faire : le diff ne contient
  aucun `.tsx`, aucun composant, aucun token.

## Verdict

Les deux critiques des rondes précédentes sont réellement fermés, et je les ai rejoués
plutôt que relus : le balayage ne détruit plus de seau ouvert (3 rouges contre la vraie
base sous mutation), et le leurre de cookie ne passe plus (401×10 puis 429×10 contre
l'application démarrée, dans les deux formes de déploiement). Le harnais est répétable et
son nettoyage est mesuré porteur. Ce qui reste est une **inexactitude d'une garantie
écrite** — le limiteur ne bucketise pas la valeur que la bibliothèque valide — sans
conséquence exploitable aujourd'hui, parce qu'un compteur de la bibliothèque, plus serré,
mord avant. C'est un défaut réel sur un chemin de sécurité, il doit être corrigé au
prochain cycle, il ne justifie pas un troisième blocage.

> Verdict de la ronde 3 — **dépassé par la ronde 4 ci-dessous** :
> Max severity: major · Ship allowed: yes

---

# Quatrième revue — après le correctif de M1 (commit `6559b60`)

> Contexte neuf. Portée annoncée : ce que la ronde 3 a relevé, et ce que le correctif
> lui-même a pu casser. Les rondes 1 et 2 ne sont pas rouvertes, mais leurs re-preuves de
> la ronde 3 ont été rejouées ici, parce que le code de lecture du cookie a changé depuis.
> Diff jugé : `git diff dev...feature/s28-rate-limiting` (88 fichiers, +6145/−373).

## Commandes exécutées par la revue

| Commande | Résultat mesuré ici |
|---|---|
| `pnpm typecheck` | **0** — 25 tâches |
| `pnpm lint` | **0** — « ESLint: No issues found » |
| `pnpm test` | **cinq passages complets** : quatre à **1941 passés / 8 sautés (1949)**, **un rouge** — `tests/billing.test.ts:5627`, le constat m4 (voir plus bas) |
| `pnpm build` puis `pnpm build --force` | **0** dans les deux cas (`Cached: 0 cached, 1 total` sur le forcé) |
| `pnpm test:e2e` | **90 passés / 8 sautés**, **trois passages consécutifs**, exit 0 chacun — avec `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` vidés, comme la ronde 3 l'a documenté |
| `pnpm test:minimal-profile` | **4 passés**, exit 0 — 14 routes de modules activés sondées en contrôle positif |
| `pnpm run audit` | **vert** : « 1 avis remonté(s), aucun au seuil « élevé » qui ne soit couvert » |
| `pnpm db:generate` | « No schema changes, nothing to migrate » — aucune dérive |
| `pnpm db:migrate` ×2, `pnpm test:golden-path`, `actionlint`, gitleaks | **non exécutés** (voir « Non vérifié ») |

Arbre propre (`git diff --exit-code`) après **chaque** mutation et à la fin. Aucun fichier
parasite laissé derrière.

Les comptes annoncés par l'implémenteur sont exacts : 1941/8 (+9 cas vitest), 90/8 e2e
(+1 cas). **Rien n'a été supprimé** — le diff `b6ad568..HEAD` porte **0** déclaration
`it(`/`test(`/`describe(` retirée et **10** ajoutées (9 vitest + 1 Playwright), ce qui
recompose exactement 1932 → 1941 et 89 → 90.

## Ce que j'ai vérifié dans la bibliothèque, pas dans la revue précédente

- `better-call@1.4.0/dist/cookies.mjs` — `parseCookies` fait, dans cet ordre : `.trim()`,
  puis `if (val.codePointAt(0) === 34) val = val.slice(1, -1)`, puis `tryDecode(val)`.
  `tryDecode` (`dist/utils.mjs:58-64`) est `try { return str.includes("%") ?
  decodeURIComponent(str) : str } catch { return str }`. `asTheServerReadsIt`
  (`rate-limit-rules.ts`) refait ces trois gestes **geste pour geste**, repli sur la valeur
  brute compris. La différence de découpage (`split(';')` ici, balayage indexé là-bas) est
  sans effet : une valeur de cookie ne peut pas contenir `;`, et là où la bibliothèque
  garde la première occurrence, ce dépôt **refuse** — strictement plus strict.
- `beginAttempt(5)` : **exactement une** occurrence dans
  `dist/plugins/two-factor/totp/index.mjs` et **exactement une** dans
  `backup-codes/index.mjs`, et **aucun autre** appel `beginAttempt(...)` dans ces deux
  fichiers. Le motif `beginAttempt\((\d+)\)` ne peut donc pas accrocher un site étranger,
  et `expect(caps).toHaveLength(2)` rougirait si l'un disparaissait.
- `verify-two-factor.mjs` : sur le chemin `isSignIn`, un cookie de défi absent, non signé
  ou sans valeur de vérification lève `UNAUTHORIZED` **avant** que l'objet portant
  `beginAttempt` ne soit rendu. **La revendication est vraie** : un défi *fabriqué* est
  refusé 401 sans jamais être compté par la bibliothèque, et le seau de ce dépôt est le
  seul à borner ce trafic-là.
- Une précision d'un cran, sans conséquence sur la décision : `beginAttempt` refuse à
  `attempts >= allowedAttempts`, donc la bibliothèque **compte cinq échecs** et refuse la
  **sixième** requête. Cinq documents écrivent « détruit le défi au cinquième ». `4 < 5`
  tient dans les deux lectures ; la phrase est imprécise d'une unité, pas fausse dans sa
  conséquence.
- Le chemin `packages/modules/auth/node_modules/better-auth` que lit le test dérivé est
  stable en CI : `better-auth: "1.7.2"` est une dépendance **directe et exacte** de ce
  package. Sous un `node-linker` hoisté le chemin n'existerait pas et `readFileSync`
  lèverait — le test est **fail-closed**, il ne verdit pas par absence.

## Morsure prouvée — sept mutations, chacune au site du défaut, chacune restaurée

| # | Mutation | Site | Commande | Rouges |
|---|---|---|---|---|
| A | `subjectOfCookies` remis à la **sous-chaîne brute** (`asTheServerReadsIt` retiré) | `rate-limit-rules.ts:270` | `pnpm test` | **3** — 1 au répartiteur (`tests/rate-limiting.test.ts`), 2 au domaine |
| A′ | idem | idem | `pnpm test:e2e` | **1** — `e2e/rate-limiting.spec.ts:219`, **contre l'application démarrée** |
| B | `twoFactor.maxPerSubject` **4 → 6** (au-dessus du plafond de la bibliothèque) | `config/security.ts:216` | `pnpm test` | **1** |
| B′ | `beginAttempt(5)` → `beginAttempt(3)` **dans la bibliothèque installée** | `node_modules/.../two-factor/totp/index.mjs` | `pnpm test` | **1** — « expected 4 to be less than 3 » |
| C | `webhook.maxPerClient` **600 → 100** | `config/security.ts:288` | `pnpm test` | **1** — « la politique default est plus large que celle du webhook » |
| D | `rate-limit.ts` renommé hors de `packages/ports/AGENTS.md` | `packages/ports/AGENTS.md` | `pnpm test` | **1** |
| E | `subjectOfCookies` remis en **correspondance par suffixe**, premier couple retenu (re-preuve du C1 de la ronde 2) | `rate-limit-rules.ts` | `pnpm test` | **6** |

**Les deux nouvelles lignes de `docs/security.md` §7 mordent l'une et l'autre**, et chacune
par la commande qu'elle nomme : la ligne « le seau compte la valeur que le serveur lit »
par `pnpm test` **et** `pnpm test:e2e` (mutations A et A′), la ligne « mord avant le
plafond de la bibliothèque » par `pnpm test`, **dans les deux sens** — seuil qui remonte
(B) et plafond de la bibliothèque qui descend (B′). La dérivation n'est pas décorative :
elle lit réellement le `dist/` installé.

`B′` a été posée sur un fichier de `node_modules` copié avant, restauré après, et
`diff -q` a confirmé l'identité octet pour octet.

## Mesures contre l'application démarrée (`next dev`, PostgreSQL 5438)

**Séquence percent malformée, comme demandé — aucun 500.**

```
même valeur '%zz' malformée, IP tournante, 6 essais  → 401 401 401 401 429 429
'%'  'defi%A'  'defi%%41'  '%E0%A4%A'  '%ED%A0%80'   → 401  401  401  401  401
```

Le rattrapage tient : la valeur malformée est comptée comme une valeur, dans **un seul**
seau, et refuse exactement au seuil. Aucune de ces formes ne produit de 500.

**M1 rejoué — réellement fermé.**

```
même défi, un %XX de plus à chaque essai, IP tournante → 401 401 401 401 429 429 429 429
```

La mesure de la ronde 3 était `401×15` sans un seul 429. Le seau ne se scinde plus.

**Re-preuves de la ronde 3, rejouées sur le code modifié :**

```
leurre en tête, valeur du leurre qui tourne, IP qui tourne, vrai défi fixe → 401×4 puis 429
deux noms déclarés présents dans la même requête                          → 429 dès le 1er
```

**Le seau par adresse email est bien inchangé** (l'écart n°2, la normalisation déplacée du
composeur de clé vers le lecteur) — mesuré, pas déduit :

```
inscription, MÊME adresse en 7 variantes de casse et d'espaces, IP tournante → 200×5 puis 429 429
inscription, adresse DIFFÉRENTE, IP neuve                                    → 200
```

`signUp.maxPerSubject` vaut 5 : le refus tombe exactement là où il doit, et une autre
adresse n'est pas touchée. Les deux seuls sites de production qui composent une clé de
sujet (`route-rate-limit.ts:186` et `:192`) sont tous deux alimentés par un lecteur qui
normalise — il n'y a pas de troisième appelant.

## Findings

### M1 — **major** — le refus 429 arrive à l'utilisateur habillé en « votre code est invalide »

Nouveau, et **causé par ce correctif** : c'est la partie « ce que le correctif a pu
casser ».

Mesuré contre l'application démarrée, un utilisateur légitime, une seule adresse IP, un
seul défi :

```
essai 1..4 : {"error":"invalid"}       [401]
essai 5    : {"error":"rate_limited"}  [429]  retry-after: 87
essai 6    : {"error":"rate_limited"}  [429]  retry-after: 87
```

`apps/web/app/two-factor/two-factor-form.tsx:69-79` ne connaît que trois classes de refus —
`restart`, `used`, et le repli `invalid` :

```ts
if (payload?.error === 'restart')      { setErrorKey(REFUSAL_KEYS.restart) }
else if (payload?.error === 'used')    { … }
else                                   { setErrorKey(REFUSAL_KEYS.invalid) }
```

`rate_limited` tombe donc dans le repli, et l'écran affiche
`app.twoFactor.error.invalid` = « **Ce code n'est pas valide.** » — à un utilisateur dont
le code est **correct**, pendant jusqu'à 300 s, en l'invitant implicitement à réessayer,
c'est-à-dire à faire exactement ce qu'une limitation demande de ne pas faire. Le
`Retry-After` que le serveur calcule honnêtement n'est jamais montré.

**Pourquoi c'est ce correctif qui l'ouvre.** À `maxPerSubject: 10`, ce chemin était hors
d'atteinte sur un défi authentique : la bibliothèque refusait la première, en 400, et
`twoFactorRefusal(400)` (`auth-routes.ts:408`) traduit ce 400 en `{"error":"restart"}`,
donc en « Cette vérification a expiré. Recommencez la connexion. » — le message **juste**.
À 4, le 429 du répartiteur devient le **premier** refus qu'un utilisateur qui se trompe
rencontre, et il court-circuite ce mappage : le gestionnaire n'est pas appelé, donc
`twoFactorRefusal` non plus. La conséquence écrite dans l'ADR 051 — « reçoit un 429 au lieu
d'un cinquième "code invalide" » — décrit ce que le **serveur** renvoie, pas ce que
l'**utilisateur** lit ; ce qu'il lit est justement « code invalide ».

**Le dépôt sait déjà faire.** `apps/web/app/public-form.tsx:85-90` porte une classe de
refus `throttled` dédiée au 429 depuis s11. s28 ouvre des 429 sur les formulaires
d'authentification sans y étendre ce motif.

**Ce n'est pas propre à la 2FA** : mesuré aussi sur l'inscription —
`{"error":"rate_limited"}` en 429, et `apps/web/app/auth-form.tsx:76-86` classe tout ce qui
n'est ni 401 ni 502 en `app.auth.error.invalid` = « Demande invalide. Vérifiez les
informations saisies. » Cette moitié-là n'est pas née de ce correctif : elle est ouverte
depuis le début de s28 et les trois rondes précédentes ne l'ont pas regardée. Les seuils
d'inscription et de connexion étant larges, elle est bien moins probable — mais c'est la
même classe.

Ce n'est **pas** une faille : le refus refuse, la signature, la protection et le
`Retry-After` sont intacts, et rien n'est corrompu. C'est un défaut réel sur le chemin
d'authentification, cadré, qui produit des tickets « je n'arrive plus à me connecter et
l'application dit que mon code est faux ». Il ne bloque pas la porte, il doit être corrigé
au prochain cycle — et si l'objectif est que le parcours 2FA soit correct en production, il
doit l'être **avant** la mise en ligne, parce que c'est le seuil livré qui le rend
atteignable.

### m1 — **minor** — « Deux plafonds bornent l'énumération 2FA » : il y en a trois, et le troisième était nommé par la ronde 3

`packages/modules/rate-limit/AGENTS.md` écrit « **Deux plafonds bornent l'énumération 2FA,
et l'ordre compte** ». Vérifié dans la bibliothèque installée : `verify-two-factor.mjs`
porte aussi `assertTwoFactorNotLocked` / `recordTwoFactorFailure`, dont
`resolveAccountLockoutConfig` vaut par défaut `enabled: true`, `maxFailedAttempts: 10`,
`durationSeconds: 900` — et ce dépôt ne configure **pas** `accountLockout`
(`better-auth-service.ts:621-633`), tandis que `packages/modules/auth/src/schema.ts:177-178`
porte bien `failed_verification_count` et `locked_until`. C'est un verrouillage **par
compte**, en travers des défis et des facteurs : un axe différent des deux nommés, et le
plus serré pour une attaque suivie sur un compte. La ronde 3 le citait explicitement ; le
correctif l'a perdu en route.

C'est le mode d'échec que `AGENTS.md` racine nomme par son nom : « Never claim
exhaustiveness… Write "found so far, over these N cases", and name the cases. » Un compte
écrit comme complet dans le fichier de règles le plus proche du code sera relu comme
vérifié.

### m2 — **minor** — `packages/ports/AGENTS.md` promet plus que ce que sa commande tient

Le fichier écrit : « *un cinquième port **non documenté** ici fait rougir `pnpm test`* ».
Le test dérivé (`tests/agents-md.test.ts:139-162`) n'exige que ceci :
`expect(content).toContain(capability)` — c'est-à-dire que la **chaîne du nom de fichier**
apparaisse quelque part. Un cinquième port mentionné en passant, sans section, sans ligne
dans le tableau du journal et sans son exception au socle, resterait **vert**. La mutation
D prouve que la règle mord ; elle ne mord pas sur « documenté », seulement sur « nommé ».
Écrire ce que la commande tient réellement suffirait.

### m3 — **minor** — l'ADR 050 garde « les onze fichiers », et l'argument d'immuabilité ne s'applique pas encore

L'écart n°6, déclaré par l'implémenteur : la puce *Considered options* de l'ADR 050 dit
toujours « `tests/rate-limiting.test.ts` **balaie les onze fichiers** du chemin de
limitation ». Le balayage est désormais dérivé du disque avec un plancher assertionné à 11
(`tests/rate-limiting.test.ts:1140`), donc la phrase n'est pas fausse aujourd'hui — c'est
exactement la formulation que le constat m2 de la ronde 3 a fait retirer partout ailleurs,
et qui invite le prochain agent à recopier une liste.

**L'avoir signalé était juste ; l'avoir laissé est le plus faible des deux choix
disponibles.** L'ADR 050 est créé par **ce commit** (`git diff dev...HEAD --
docs/decisions/` : deux fichiers, 306 insertions, **0 suppression**) : il n'a jamais été sur
la branche par défaut, personne ne s'y est jamais adossé, et l'immuabilité qui justifie de
ne pas le toucher n'a pas encore de prise. La conséquence est qu'une phrase déjà corrigée
partout ailleurs atterrit sur `dev` non corrigée, dans le document que la règle du dépôt
désigne comme faisant autorité. Corriger la puce, ou lui consacrer une ligne dans l'ADR 051,
coûtait moins.

### m4 — **minor, reporté — mais il faut réviser le constat de la ronde 3**

`tests/billing.test.ts:5627` a **rougi**, une fois sur cinq passages complets à ce commit :

```
FAIL  tests/billing.test.ts > la page de retour d'un paiement invité
      > n'ouvre aucune session, ni sur un identifiant forgé ni sur un authentique
      AssertionError: expected 1 to be +0
```

La ronde 3 a écrit « elle est passée aux trois passages complets de cette revue » et en a
conclu que le report était sûr. Sur cinq passages, ce n'est plus « reporté et stable », c'est
**reporté et qui tire**. C'est une porte de CI qui rougit au hasard.

Le diagnostic de la ronde 3 tient : l'assertion est un **delta global**
(`(await countRows('auth_session')) - before`) mesuré à travers un rendu de page, donc
sensible à tout autre fichier qui ouvre une session en parallèle contre la même base. Et
ce n'est pas s28 qui l'ouvre : `tests/rate-limiting.test.ts` ne crée **aucune** session
(aucune occurrence de `auth_session`, `signUp`, `anAccount`), et l'assertion existe telle
quelle sur `dev`. Je n'ai pas pu attribuer le déclencheur — cela demanderait de faire tourner
la suite sur `dev`, donc de sortir de mon répertoire de travail. Le reporter reste le bon
arbitrage ; ce qui change est qu'il faut le reporter en le sachant instable, pas en le
croyant stable.

### nit — l'en-tête de l'ADR 051 range `Supersedes` avant `Date`/`Scope`

Les ADR 011 et 025 le placent en dernier. Purement cosmétique ; la forme de la clause,
elle, est bien celle du dépôt.

## Les six écarts déclarés, jugés un par un

1. **En-tête de `packages/ports/AGENTS.md` récrit d'un bloc — vrai, et le bon choix.**
   Vérifié sur `dev` : le paragraphe portait bien deux moitiés de phrase fusionnées
   (« `Mailer` est le premier ; `Storage` (s18) est le deuxième… » puis, sans sujet,
   « le premier, `Payments` le second (s19, Stripe) ; storage (s18)… », avec « alors il est
   écrit ici plutôt que déduit : » **deux fois**). Antérieur à cette story. **Rien n'a été
   perdu** : Mailer/s06, Storage/s18, Payments/s19 et les ports à venir sont tous conservés,
   `RateLimiter`/s28 ajouté. Déclarer l'écart était juste.
2. **Normalisation déplacée dans les lecteurs plutôt que retirée — bon choix, et vérifié
   sans régression** (mesure du seau email ci-dessus, plus l'inventaire des deux seuls
   appelants de `subjectBucketKey`). C'était même le seul choix cohérent : une clé qui
   normalise en plus du lecteur est la troisième normalisation que l'ADR 051 refuse.
3. **Deux cas pour le rejeu encodé (vitest *et* Playwright) — obligatoire, pas
   surérogatoire.** La ligne de §7 nomme les deux commandes ; une ligne dont une des
   commandes citées ne rougit pas est précisément le défaut que la ronde 3 a relevé. Les
   deux rougissent (mutations A et A′).
4. **m3 a reçu un test alors que le constat ne demandait qu'une décision — bon choix.**
   La règle du dépôt est « une règle doit être exécutable » ; et le test ne surpromet pas :
   sa docstring écrit noir sur blanc ce qu'il **ne** prouve pas (« qu'une inondation réelle
   laisse passer les livraisons »). Il mord (mutation C).
5. **Le sixième site (`two-factor.ts:142-165`) laissé intact — conclusion juste, motif
   faux.** La phrase « le seau qui borne l'énumération des six chiffres est compté **sur ce
   cookie** » est vraie aujourd'hui — mais **pas** parce qu'elle parlerait de *noms* : elle
   est vraie parce que le seuil est passé sous 5. À `maxPerSubject: 10`, cette phrase était
   membre exact de la famille des cinq affirmations fausses. Le motif écrit protège donc
   moins que la conclusion. Ce qui sauve la ligne, c'est le test dérivé, qui rougit dès que
   `maxPerSubject ≥ 5` — la phrase est adossée à une commande, ce n'est simplement pas celle
   que l'implémenteur invoque.
6. **« Les onze fichiers » laissé dans l'ADR 050 — mauvais arbitrage, cf. m3 ci-dessus.**
   L'avoir signalé était juste ; l'avoir laissé ne l'est pas, parce que l'ADR n'a jamais été
   sur la branche par défaut.

## Le compromis de sécurité : `maxPerSubject: 10 → 4`

**Sur l'axe sécurité, c'est le bon arbitrage, et c'est la moitié qui compte.** À 10, le
seuil ne pouvait jamais refuser le premier sur un défi authentique : cinq documents lui
attribuaient une garantie que le compteur interne d'une dépendance tenait en silence. À 4,
il mord d'abord, la phrase redevient vraie, le plafond de la bibliothèque redevient ce
qu'il doit être — un second filet nommé, versionné et **dérivé** —, et le trafic que la
bibliothèque ne compte pas (défi fabriqué, refusé 401 avant `beginAttempt`) reste borné par
ce seau-là, qui est désormais le seul à le faire.

Le coût est écrit, et il est réel : quatre erreurs de frappe dans une fenêtre alignée de
5 minutes suffisent. Il est borné (un `Retry-After` honnête, jusqu'à 300 s), réversible, et
il ne détruit pas le défi — la bibliothèque l'aurait de toute façon détruit un essai plus
tard. **Le trou n'est pas dans le seuil, il est dans ce que l'utilisateur en lit** : voir
M1. Corrigez M1 et le compromis est sain tel quel.

## Plan compliance, règles, ADR

- [x] Les onze tâches du plan restent faites ; la note d'exécution porte la quatrième passe,
      et les six écarts y sont écrits.
- [x] **Aucun ADR accepté n'a été récrit.** `git diff dev...HEAD -- docs/decisions/` : deux
      fichiers, **306 insertions, 0 suppression**. `git diff b6ad568..HEAD --
      docs/decisions/` : l'ADR 051 seul. La clause de supersession suit bien la forme du
      dépôt (`Supersedes:` en en-tête, comme aux ADR 011 et 025), et elle nomme la seule
      clause visée en laissant le reste en vigueur.
- [x] **Design** : confirmé plutôt que supposé — `git diff dev...HEAD --name-only` ne
      contient **aucun** `.tsx`, `.css` ni `.svg`, et `docs/designs/` ne porte rien pour
      s28. Il n'y a pas d'écran à dériver du design system. *(La lecture de
      `two-factor-form.tsx` en M1 est une lecture d'un fichier **hors diff**, au titre des
      régressions sur les chemins touchés.)*
- [x] ADR 050 respecté dans les deux sens ; ADR 051 cohérent avec le code livré, y compris
      son propre « ce qu'il faut surveiller » (« le test dérive le plafond ; il ne dérive
      pas la manière de lire un cookie — un changement de `parseCookies` ne rougirait pas
      tout seul »), qui est exact et honnête.
- [x] ADR 008 (une implémentation par port), ADR 020, ADR 021, ADR 027 : inchangés par cette
      passe.
- [ ] **Socle « dépôt orienté agents »** : deux écarts, m1 et m2 — un compte écrit comme
      complet qui ne l'est pas, et une garantie écrite plus large que la commande qui la
      tient.

## Non vérifié — et ce qu'un humain doit faire à la place

- **Le plafond de `better-auth` reste *lu*, pas *exercé*.** Quatrième ronde de suite.
  Personne n'a enrôlé un vrai second facteur ni brûlé six codes faux sur un défi
  **authentique**. **Geste humain** : enrôler la 2FA, brûler cinq codes faux et vérifier
  que le cinquième donne bien « Ce code n'est pas valide » puis que le sixième donne
  « Cette vérification a expiré » — c'est aussi la mesure qui chiffrerait exactement
  l'ampleur de M1.
- **Le « avant » de M1 est dérivé de la source de la bibliothèque, pas mesuré.** J'ai
  mesuré l'état *après* (429 → « Ce code n'est pas valide »). Que l'état *avant* affichait
  « Cette vérification a expiré » se lit dans `verify-two-factor.mjs` + `twoFactorRefusal`,
  je ne l'ai pas joué faute de défi authentique.
- **Aucune preuve navigateur du message de M1.** Le mappage a été lu dans
  `two-factor-form.tsx` et `auth-form.tsx`, et le corps du refus mesuré au réseau ; l'écran
  lui-même n'a pas été rendu. **Geste humain** : atteindre le 429 dans un navigateur et
  photographier l'alerte.
- **Aucun proxy inverse réel.** Quatrième ronde. `x-forwarded-for` n'a jamais été qu'absent
  ou écrit par la revue. **Geste humain** : déployer derrière Traefik/nginx/Caddy et
  confirmer que le relais **écrase** l'en-tête au lieu d'y ajouter.
- **`tests/billing.test.ts` non joué sur `dev`** : je n'ai donc pas pu prouver que m4 flambe
  identiquement hors de cette branche. Le raisonnement (delta global, aucune session créée
  par le nouveau fichier) est solide, la mesure comparative manque.
- **`pnpm test:golden-path` non exécuté** — il exige un clone, une base créée pour
  l'exécution et un régime de paiement.
- **`pnpm db:migrate` ×2 non rejoué** cette ronde (la ronde 3 l'a fait ; `pnpm db:generate`
  ne montre aucune dérive ici).
- **`actionlint` et le scan de secrets non exécutés** : aucun fichier `.github/` dans le
  diff pour le premier, pas de Docker disponible pour le second.
- **Aucun Stripe réel, aucune exécution multi-conteneurs, aucune mesure de charge** — comme
  aux rondes précédentes.
- **Le port `packages/ports/src/rate-limit.ts` n'est pas dans le balayage anti-échappatoire**
  dérivé (`limiterPath`). Il ne lit rien de l'environnement — je l'ai ouvert — et le second
  balayage, sur plus de 200 sources, le couvre par identifiant. Constaté, pas un défaut.

## Verdict

Le M1 de la ronde 3 est **réellement fermé**, et je l'ai rejoué plutôt que relu : le même
défi ré-encodé retombe dans un seul seau et refuse au seuil (401×4 puis 429, là où la ronde
3 mesurait 401×15), une séquence percent malformée ne produit aucun 500 et se compte comme
une valeur ordinaire, la normalisation du sujet email est inchangée, et les deux nouvelles
lignes de `docs/security.md` §7 rougissent chacune par la commande qu'elle nomme — y compris
la dérivation du plafond, qui lit bien le `dist/` installé et rougit quand ce `dist/` bouge.
Les re-preuves de la ronde 3 tiennent sur le code modifié. Le harnais est vert et répétable.

Ce qui reste est **le revers du correctif** : en amenant le seuil sous celui de la
bibliothèque, la story a déplacé le premier refus qu'un utilisateur légitime rencontre du
gestionnaire vers le répartiteur — et le répartiteur parle une langue que l'écran de second
facteur ne comprend pas. L'utilisateur s'entend dire que son bon code est faux. Ce n'est ni
une faille ni une corruption, et le dépôt sait déjà y répondre (`public-form.tsx` a la
classe `throttled` depuis s11) ; c'est un défaut cadré, sur le chemin d'authentification, à
corriger au prochain cycle — et de préférence avant la mise en ligne, puisque c'est le seuil
livré qui le rend atteignable.

> Verdict de la ronde 4 — **dépassé par la ronde 5 ci-dessous** :
> Max severity: major · Ship allowed: yes

---

# Cinquième revue — **revue de delta ciblée**, après le correctif de M1 de la ronde 4 (commit `a077982`)

> **Portée.** Contexte neuf. Je juge `git diff 6559b60..a077982` (13 fichiers, +548/−43) : le
> correctif du M1 de la ronde 4, m1, m2, m3, le nit, et la note m4. Les rondes 1 à 4 ne sont
> **pas** rouvertes.
>
> **Ce que je n'ai pas ré-examiné, parce que la ronde 4 l'a fait et que le delta ne touche
> aucune source de production de la limitation** (`git diff 6559b60..a077982 --stat` ne
> contient ni `rate-limit-rules.ts`, ni `route-rate-limit.ts`, ni `drizzle-rate-limiter.ts`,
> ni `registry.ts`, ni `config/security.ts`, ni `auth-routes.ts`, ni `packages/ports/src/`) :
> la fidélité de `asTheServerReadsIt` à `parseCookies`, la dérivation du plafond
> `beginAttempt(5)`, l'inventaire des appelants de `subjectBucketKey`, le balayage
> anti-échappatoire, la forme du port, les onze tâches du plan, la conformité ADR 008 / 018 /
> 020 / 021 / 024 / 027 / 043 / 046 / 050. Les six écarts déclarés de la ronde 4 restent jugés
> par la ronde 4.

## Commandes exécutées par cette revue

| Commande | Résultat mesuré ici, à `a077982` |
|---|---|
| `pnpm typecheck` | **0** |
| `pnpm lint` | **0** |
| `pnpm build` | **0** |
| `pnpm test` | **cinq passages complets, cinq verts** — **1946 passés / 8 sautés (1954)** à chaque fois |
| `pnpm test:e2e` | **trois passages consécutifs, trois verts** — **92 passés / 8 sautés**, `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` vidés |
| `pnpm test:minimal-profile` | **cinq passages, cinq verts** — suite du clone **1943 exécutés / 11 sautés** à chaque fois, 4 parcours navigateur verts |
| `pnpm db:generate` | « No schema changes, nothing to migrate » — aucune dérive |
| `pnpm run audit` | **non concluant** : `ERR_SOCKET_TIMEOUT` sur `registry.npmjs.org`, deux fois. Aucun réseau dans cet environnement (voir « Non vérifié ») |

Les comptes annoncés par l'implémenteur sont **exacts** : 1946/8, 92/8, 1943/11.
**Rien n'a été supprimé** : `git diff 6559b60..a077982 -U0` porte **0** déclaration
`it(`/`test(`/`describe(` retirée et **8** ajoutées (5 `it` + 1 `describe` vitest, 2 `test`
Playwright), ce qui recompose exactement 1941 → 1946 et 90 → 92.

Arbre propre après **chaque** mutation et à la fin (`git diff --exit-code`), le fichier de
revue non suivi mis à part.

## Morsure prouvée — huit mutations, chacune au site du défaut, chacune restaurée

| # | Mutation | Site | Commande | Rouges |
|---|---|---|---|---|
| A | `if (status === 429)` → `4029` | `two-factor-form.tsx:75` | `pnpm test` | **1** — « ne dit pas à un code juste qu'il est faux » |
| B | `Math.ceil(seconds / 60)` → `Math.floor` | `refusal-message.ts:50` | `pnpm test` | **1** — l'arrondi **au-dessus** est réellement tenu |
| C | `response.headers.get('retry-after')` → `'300'` | `refusal-message.ts:42` | `pnpm test` | **2** — la clause « en-tête seulement » mord dans les deux sens |
| D | clé `app.twoFactor.error.throttledIn` retirée de **`en.json` seul** | `apps/web/messages/en.json` | `pnpm test` | **2** — dans `tests/i18n.test.ts` |
| E | `if (status === 429)` → `4029` | `auth-form.tsx:91` | `pnpm test` | **1** |
| F | `lockout?.maxFailedAttempts ?? 10` → `?? 8` **dans la bibliothèque installée** | `node_modules/.../verify-two-factor.mjs:121` | `pnpm test` | **1** — la dérivation lit bien le `dist/` posé sur le disque |
| G | « **10 vérifications** » → « **dix vérifications** » | `packages/modules/rate-limit/AGENTS.md` | `pnpm test` | **1** |
| A′ | A **et** E ensemble | les deux formulaires | `pnpm test:e2e -g "annonce l'attente"` | **2 / 2** — contre l'application démarrée, dans un navigateur |

`F` a été posée sur une copie octet-pour-octet, restaurée puis vérifiée par `diff -q`.
**Aucune mutation n'est verte** : les deux nouvelles familles de cas mordent, et elles
mordent **au site du défaut**, pas au point de composition.

## Preuve navigateur — ce que la ronde 4 avait explicitement laissé non vérifié

Rendu réel, `next dev` + PostgreSQL 5438, trace Playwright extraite.

**`/two-factor`, seau `subject` plein, IP neuve** — le serveur journalise
`[rate_limit.exceeded] POST /auth/two-factor/verify-totp client=198.51.104.251 bucket=subject retry_after=124s`
(la route et l'IP, jamais la valeur du sujet), et l'écran affiche, dans un `Alert`
`variant="warning"` conforme au design system :

> « Trop de tentatives. Votre code n'est pas en cause : réessayez dans **3** minutes. »

Le défaut de la ronde 4 est **réellement fermé à l'écran**, pas seulement au réseau :
« Ce code n'est pas valide » n'apparaît plus. `124 s → 3 min` : l'arrondi **au-dessus** est
visible dans le rendu.

**`/forgot-password`**, même geste : « Trop de tentatives. Réessayez dans 13 minutes. »
(`retry_after=724s` → 13 min). Voir n4 ci-dessous sur l'**apparence** de cet écran-là.

## Ce que j'ai vérifié dans la bibliothèque plutôt que dans la revue précédente (m1)

Ouvert indépendamment, `better-auth@1.7.2` installé sous `packages/modules/auth/node_modules` :

- `resolveAccountLockoutConfig` (`verify-two-factor.mjs:117-124`) : `enabled ?? true`,
  `maxFailedAttempts ?? 10`, `durationSeconds ?? 900`. **Les trois valeurs du fichier de
  règles sont exactes.**
- `assertTwoFactorNotLocked` et `recordTwoFactorFailure` sont appelés **`if (isSignIn)`** dans
  `totp/index.mjs:184,201` **et** `backup-codes/index.mjs:198,212`. La docstring de la
  bibliothèque écrit elle-même « across challenges and factors » : l'axe **par compte** est réel.
- Ce dépôt ne configure pas `accountLockout` — balayage de tous les `.tsx`/`.ts` de
  `apps/`, `packages/`, `config/` : **aucune occurrence**.
- La dérivation n'est pas décorative : mutation **F** (bibliothèque) et mutation **G**
  (paragraphe) rougissent toutes deux le même cas.

Le paragraphe dit désormais ce qui a été **balayé** (`config/security.ts` + trois fichiers,
nommés) plutôt qu'un compte présenté comme complet, et écrit noir sur blanc que le troisième
plafond est **lu, jamais exercé**. C'est exactement ce que le socle « dépôt orienté agents »
demande. **m1 est fermé.**

## Les cinq revendications de l'implémenteur, jugées

1. **`refusal-message.ts`, `authRefusalOf`, `twoFactorRefusalOf`, statut avant corps — vrai.**
   Lu ligne à ligne : dans les deux fonctions le `if (status === 429)` précède toute lecture de
   `error`. **Aucun mappage antérieur n'a été perdu** : 401→`unauthorized`, 502→`mail`,
   repli→`invalid` côté auth ; `restart`, `used`, repli `invalid` côté 2FA, et le cas vitest
   les ré-assertionne un par un. Le point que la ronde 4 nommait tient : `twoFactorRefusal`
   (`domain/two-factor.ts:113-122`) rend un **401** pour un 400 de la bibliothèque, donc
   `twoFactorRefusalOf(401, 'restart', …)` → « Cette vérification a expiré », inchangé.
2. **`Retry-After` : en-tête seulement, arrondi au-dessus, rien quand illisible — vrai, et tenu
   par une commande.** `retryAfterMinutes` ne lit que `response.headers.get('retry-after')` ;
   aucune importation de `config/security.ts` dans le fichier. Mutations B et C. La forme
   « date HTTP », `''`, `'0'`, `'-1'` et une chaîne quelconque rendent tous `null`.
3. **Quatre clés dans chaque locale — vrai, et la liste est bien dérivée du code.**
   `config/i18n.ts` déclare `appLocales = ['fr', 'en']`. Les quatre clés sont présentes et
   **traduites** dans les deux catalogues, avec la forme ICU `plural` correcte. Mutation D :
   retirer une clé d'un seul catalogue rougit deux cas de `tests/i18n.test.ts`. (Les quatre
   clés vivent bien dans des `.tsx` sous `apps/web/app`, donc dans `RENDER_FILES` — la
   couverture n'est pas supposée.)
4. **m1 — fermé** (ci-dessus).
5. **m2 — la reformulation est juste, et c'était le bon geste.** `tests/agents-md.test.ts:152-162`
   n'exige que `expect(content).toContain(capability)` où `capability` est un **nom de fichier** :
   la phrase « non documenté » valait bien « non nommé », et le fichier sépare désormais
   explicitement les deux. *Une réserve sur l'argument, pas sur la décision* : le fichier porte
   déjà un tableau, donc « une ligne de tableau citant chaque fichier de capacité » aurait été
   une forme détectable sans inventer de gabarit de section. Ne pas ajouter une règle qui
   rougirait sur une reformulation légitime reste un arbitrage défendable ; l'impossibilité
   annoncée est un cran trop forte.
6. **m3 et le nit — faits, et le périmètre ADR est intact.** `git diff dev...HEAD -- docs/decisions/` :
   **deux fichiers, 306 insertions, 0 suppression** — les ADR 050 et 051 sont créés par ce
   commit, **aucun ADR accepté n'a été récrit**. La puce corrigée de l'ADR 050 est exacte :
   `tests/rate-limiting.test.ts:1202-1211` dérive bien le balayage du disque avec un plancher
   assertionné à 11.

## Les deux signaux d'instabilité, chiffrés

| Recette | Ronde 4 | Implémenteur | **Ici** | Cumul connu |
|---|---|---|---|---|
| `pnpm test` | 1 rouge / 5 (`tests/billing.test.ts:5627`) | 5 verts / 5 | **5 verts / 5** | **1 rouge sur 15** |
| `pnpm test:e2e` | 3 verts / 3 | 3 verts / 3 | **3 verts / 3** | 0 rouge sur 9 |
| `pnpm test:minimal-profile` | 1 vert / 1 | **1 rouge / 7**, sortie non capturée | **5 verts / 5** | **1 rouge sur 13** |

**Ce qui est connu** : `pnpm test` est vert cinq fois de suite au commit livré ; la seule
rougeur jamais observée est `tests/billing.test.ts` — un delta **global** de `auth_session`
mesuré à travers un rendu de page, présent tel quel sur `dev`, dans un fichier de s19, et
`tests/rate-limiting.test.ts` ne crée aucune session.

**Ce qui n'est pas connu, et que je ne comblerai pas par une hypothèse** : le déclencheur de
la rougeur de `test:minimal-profile`. L'étape qui a échoué est le `vitest run` du clone,
c'est-à-dire **la même suite** qui porte l'assertion instable — l'hypothèse économique est
donc qu'il s'agit du même constat m4. Mais la sortie n'a pas été capturée : personne n'a lu
le nom du cas. **Rien ne l'attribue.** Je n'ai pas reproduit en cinq exécutions.

**Classement** : une porte de CI qui rougit au hasard est un défaut de fiabilité, et c'en est
un — mais il est dans `tests/billing.test.ts`, pas dans le diff de s28, et le corriger
demande de rendre l'assertion locale au périmètre du cas, c'est-à-dire de toucher la suite de
s19. **Il n'appartient pas à cette story.** La note du plan le dit désormais correctement
(« reporté, et connu instable »), ce que la ronde 4 réclamait. **m4 reste minor, reporté.**

## Findings de cette ronde

Aucun critical. Aucun major. Quatre mineurs, tous des résidus ou des constats de portée, aucun
introduit comme régression de comportement.

### n1 — **minor** — « Les formulaires classent le statut avant le corps » est une règle qu'aucune commande ne tient, et sept formulaires ne la suivent pas

`apps/web/AGENTS.md` écrit, au présent prescriptif : « Les formulaires classent donc le
**statut** avant le corps », puis nomme trois fichiers. **Balayage du littéral `429` sur les
`.tsx` de `apps/web/app`** : il apparaît dans exactement **trois** fichiers —
`public-form.tsx:86`, `auth-form.tsx:91`, `two-factor/two-factor-form.tsx:75`. Or **douze**
fichiers de ce dossier appellent `fetch` vers une route montée. Ouvert et vérifié pour l'un
d'eux, `apps/web/app/account/account-form.tsx:51-65` :

```ts
const messageKeyFor = (status: number): string => {
  if (status === 400) { return 'app.account.error.invalid' }
  if (status === 401 || status === 403) { return 'app.account.error.refused' }
  if (status === 502) { return 'app.account.error.mail' }
  return 'app.account.error.failed'
}
```

Un 429 y devient « échec » générique — la classe exacte que M1 a fermée ailleurs. C'est
**bien moins grave** : ces routes tombent sur la politique `default` (120 passages / 60 s
**par appelant**), qu'un humain ne franchit pas en tapant. Mais la phrase du fichier de règles
le plus proche du code sera relue comme vérifiée, et rien ne rougit si le prochain formulaire
l'oublie. Le socle du dépôt le nomme : *« A rule must be executable… If none, it is
documentation, not a rule. »* Écrire ce qui a été balayé (trois fichiers sur les douze qui
appellent `fetch`, nommés) suffirait ; un cas dérivé serait mieux.

### n2 — **minor** — le troisième plafond, que ce commit documente, arrive à l'écran en « Cette vérification a expiré »

`domain/two-factor.ts:118-121` replie **400 et 429** de la bibliothèque sur `restart`, avec un
statut de sortie `TWO_FACTOR_REFUSAL_STATUS = 401`. Or le verrouillage de compte — le
troisième plafond que ce commit ajoute au fichier de règles — lève précisément
`TOO_MANY_REQUESTS` (`verify-two-factor.mjs:133`). Conséquence : un compte verrouillé
**900 s** lit « Cette vérification a expiré. Recommencez la connexion. », recommence, et
reboucle un quart d'heure — le repliage est **délibéré** (anti-énumération, `docs/security.md`
§7), antérieur à s28, et **non touché par ce delta**. Ce n'est donc pas une régression. C'est
un angle mort de la documentation qu'on vient d'écrire : le paragraphe qui nomme le plafond ne
dit rien de ce qu'il produit à l'écran, et le geste humain qu'il réclame (« brûler dix
vérifications fausses ») est exactement celui qui le ferait apparaître. Une phrase dans
`packages/modules/rate-limit/AGENTS.md` le refermerait.

### n3 — **minor** — le message atterrit dans la variante la moins lisible du design system (mesurée)

**Conformité au design system : vraie sur tous les points revendiqués.** Vérifié plutôt
qu'accepté — `packages/ui/src/components/alert.tsx` déclare bien `warning` parmi ses quatre
sémantiques ; `docs/design-system.md:121` porte `Alert` ; les jetons `--warning` /
`--warning-foreground` existent aux lignes 38-39 et 72-73 ; `public-form.tsx:155` emploie
`variant={throttled ? 'warning' : 'destructive'}` **depuis s11 pour ce même refus**, et
`two-factor-form.tsx:136` le recopie mot pour mot. **Aucun composant, aucun jeton, aucune
couleur nouvelle.** Aucune dérive.

Le constat est ailleurs, et il vient de la capture d'écran. Contraste calculé sur les jetons
livrés, mode clair, texte `text-warning` sur `bg-warning/10` au-dessus du fond de carte :

| variante | texte | contraste |
|---|---|---|
| `destructive` | `#e7000b` | 3.99 : 1 |
| `info` | `#2389e2` | 3.24 : 1 |
| `success` | `#13a147` | 3.03 : 1 |
| **`warning`** | **`#e8b10c`** | **1.83 : 1** |

Les quatre sont sous le 4.5:1 de WCAG AA ; `warning` est aussi sous 3:1. En mode sombre le
même calcul donne 7.23:1 — le problème est **le mode clair seul**. Ce delta déplace ce
message-ci de `destructive` (3.99) vers `warning` (1.83) sur le chemin d'authentification, où
il est la seule explication qu'un utilisateur bloqué reçoive. **La cause est le jeton, pas la
story** : elle est antérieure (s09/s11) et vaut pour tout `Alert warning` déjà livré. C'est un
**écart du design system à signaler**, au sens de la règle du dépôt — pas à combler ici.

### n4 — **minor** — l'écran d'authentification qui reçoit le message ne rend aucun composant du design system

Capture de `/forgot-password` sous la nouvelle sortie : le titre, le libellé, le champ, le
bouton et **le refus** sont des `<p>`, `<label>`, `<input>`, `<button>` **sans une seule
classe**. « Trop de tentatives. Réessayez dans 13 minutes. » y est typographiquement
identique à l'étiquette « Adresse email » juste au-dessus — pas d'encadré, pas de couleur,
pas de hiérarchie. La coquille applicative (barre latérale, bandeau cookies) est stylée : ce
n'est pas un artefact de trace, c'est `auth-form.tsx` qui n'émet aucune classe, **depuis
s07**. Le CSS charge bien.

Ce n'est **pas** une dérive introduite ici, et ce n'est pas cette story qui doit refondre les
écrans d'authentification. Mais la note du plan — « l'affordance rendue est celle que chaque
formulaire rendait déjà (…) Rien à signaler comme manque du design system » — est une
conclusion tirée des **composants employés**, pas de l'**écran rendu** ; c'est cette passe qui
a rendu l'écran pour la première fois, et la réponse est maintenant mesurée : sur
`/two-factor` c'est conforme et lisible, sur les cinq écrans d'`auth-form.tsx` c'est du HTML nu.

### nit — la note du plan conclut « Aucun écart au périmètre demandé »

Le paragraphe ajouté à `apps/web/AGENTS.md` **n'était pas dans la liste de constats**.
**Le l'avoir écrit est juste** : la règle du dépôt est « Docs ship with the code that changes
them », la décision `Retry-After` avait besoin d'un domicile exécutable à côté du code, et le
paragraphe est exact sur les deux points qu'il porte (en-tête seul, arrondi au-dessus) — voir
n1 pour sa seule surpromesse. C'est le **déclarer** qui manque : les quatre passes
précédentes listaient leurs écarts, celle-ci écrit qu'il n'y en a aucun.

## Conformité au plan, aux règles et aux ADR

- [x] Les **onze** tâches du plan restent cochées ; la cinquième passe est écrite, avec sa
      mesure m4.
- [x] **Aucun ADR accepté récrit** : `git diff dev...HEAD -- docs/decisions/` = 2 fichiers,
      306 insertions, **0 suppression**. Les deux fichiers touchés par le delta sont ceux que
      ce commit crée.
- [x] **Design system** : aucun composant, jeton ou couleur hors système ; `warning` est la
      variante que `public-form.tsx` emploie déjà pour ce même refus. Aucun manque du système
      à combler — mais deux constats d'apparence, n3 et n4, l'un mesuré au contraste, l'autre
      à la capture.
- [x] **Socle sécurité** : le corps du refus reste `{"error":"rate_limited"}` — ni seau, ni
      seuil, ni cible. Le journal serveur porte la route et l'IP, jamais la valeur du sujet.
      **Aucun oracle nouveau** : `retryAfterSecondsOf(now, windowStartOf(now, w), w)`
      (`rate-limit-rules.ts:67-86`) est le temps restant d'une fenêtre **alignée sur l'horloge
      absolue** — une fonction pure de l'heure et de la politique, indépendante de l'instant
      où qui que ce soit a émis sa première requête. Afficher l'attente ne dit donc rien d'un
      autre compte, et l'en-tête était de toute façon déjà lisible au réseau depuis s28.
      401 reste indiscernable entre compte inconnu et mot de passe faux.
- [x] **Socle fiabilité** : aucun appel sortant ajouté, aucun rejeu, aucune migration.
- [x] Les quatre re-preuves demandées **tiennent** : le rejeu encodé
      (`e2e/rate-limiting.spec.ts:222`, vert aux trois passages), le leurre de cookie
      (`rate-limit-rules.test.ts:163-201` + `tests/rate-limiting.test.ts:674` +
      `e2e:148`), la séquence percent malformée (`rate-limit-rules.test.ts:254-263`), le seau
      par adresse email — tous verts aux cinq passages `pnpm test` et aux trois `pnpm test:e2e`,
      et **aucune source de production de la limitation n'est dans le delta**.
- [ ] **Socle « dépôt orienté agents »** : un écart résiduel, n1 — une règle prescriptive sans
      commande, et sept formulaires qui ne la suivent pas.

## Non vérifié — et ce qu'un humain doit faire à la place

- **`pnpm run audit` n'a pas pu s'exécuter** : `ERR_SOCKET_TIMEOUT` vers `registry.npmjs.org`,
  deux tentatives — aucun réseau dans cet environnement. Atténuation, pas preuve : le delta
  ne touche **ni `package.json`, ni `pnpm-lock.yaml`**, donc l'inventaire des dépendances est
  celui que la ronde 4 a audité vert. **Geste humain** : rejouer `pnpm run audit` sur une
  machine connectée avant le merge.
- **La rougeur de `pnpm test:minimal-profile` n'est ni reproduite ni attribuée.** Cinq
  exécutions vertes ici, la sortie de la rougeur n'a jamais été capturée. **Geste humain** :
  si elle revient, garder le journal — le nom du cas suffira à trancher entre le constat m4 et
  autre chose.
- **Le troisième plafond reste *lu*, jamais *exercé*.** Cinquième ronde. Personne n'a brûlé
  dix vérifications fausses sur un compte authentique. **Geste humain** : enrôler la 2FA,
  brûler dix codes faux en plusieurs défis, et vérifier ce que l'écran dit au onzième — c'est
  la mesure qui trancherait n2.
- **Le contraste de n3 est *calculé* depuis les jetons, pas mesuré à la pipette.** Le calcul
  OKLCH→sRGB→WCAG est le mien ; il concorde avec l'aspect délavé de la capture, il n'a pas été
  confronté à un outil d'audit d'accessibilité. **Geste humain** : passer axe/Lighthouse sur
  `/two-factor` en état refusé, mode clair.
- **Aucun proxy inverse réel.** Cinquième ronde : `x-forwarded-for` n'a jamais été qu'absent
  ou écrit par la revue.
- **`pnpm test:golden-path`, `pnpm db:migrate` ×2, `actionlint`, le scan de secrets** :
  non exécutés (base dédiée et régime de paiement requis pour le premier ; aucun `.github/`
  dans le delta pour le troisième ; pas de Docker pour le quatrième).
- **Aucun Stripe réel, aucune exécution multi-conteneurs, aucune mesure de charge.**
- **Le mode sombre n'a pas été rendu** — seul le mode clair a été capturé.
- **Les neuf autres composants clients de `apps/web/app` qui appellent `fetch`** : j'ai balayé
  le littéral `429` sur tous les `.tsx` du dossier, et ouvert **un seul** d'entre eux
  (`account-form.tsx`) pour lire ce qu'un 429 y devient. Les huit autres sont classés par le
  balayage, pas par lecture.

## Verdict

Le M1 de la ronde 4 est **réellement fermé, et pour la première fois à l'écran** : sur
`/two-factor` comme sur `/forgot-password`, l'application dit « Trop de tentatives » avec
l'attente que le serveur a écrite, arrondie au-dessus, et « Ce code n'est pas valide » a
disparu du chemin. Le correctif est adossé à deux commandes qui ne disent pas la même chose,
et les deux mordent au site du défaut — six mutations vitest, une mutation de bibliothèque,
une mutation jouée dans un navigateur, aucune verte. m1 est fermé par une dérivation que j'ai
vérifiée dans la bibliothèque installée avant de la croire ; m2 dit désormais exactement ce
que sa commande tient ; m3 et le nit sont faits, et le périmètre des ADR est intact. Le
harnais est vert et répétable — cinq `pnpm test`, trois `pnpm test:e2e`, cinq
`pnpm test:minimal-profile`, tous verts, aucun test supprimé.

Ce qui reste tient en quatre mineurs, dont **aucun n'est né de ce delta** : une règle écrite
plus large que ce qu'une commande tient (n1), une conséquence non écrite du plafond qu'on
vient de documenter (n2), et deux constats d'apparence sur des écrans que personne n'avait
rendus avant cette passe (n3, n4). Le rougissement aléatoire de la porte de CI est réel, mesuré
à 1 sur 15 pour `pnpm test` et 1 sur 13 pour `test:minimal-profile`, non attribué — et il vit
dans la suite de s19, pas dans ce diff.

Max severity: minor
Ship allowed: yes
