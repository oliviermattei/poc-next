# Revue — Story s06-transactional-emails

Diff jugé : `ce2a927`. Le commit suivant (`577f404`, docs) n'est jugé que pour sa cohérence avec le code.
Contrat : `docs/plans/s06-transactional-emails.md` (7 tâches, interdits de course, « le point qui décide de tout »), `docs/research/s06-transactional-emails.md`, `docs/stories.md` s06 (sept critères), `docs/security.md` §5, `docs/reliability.md` §2 et §3, `AGENTS.md` racine et par package, ADR 006, 008, 010, 013.

## Ce que j'ai exécuté moi-même

| Commande | État A `['demo-enabled']` | État B `[]` | État C les deux |
|---|---|---|---|
| `pnpm typecheck` (racine + 11 packages, `--force`) | ✅ | ✅ | ✅ |
| `pnpm lint` | ✅ | ✅ | ✅ |
| `pnpm test` | **342 ✅ / 2 ignorés** | 342 ✅ / 2 ignorés | 342 ✅ / 2 ignorés |
| `pnpm build --force` | ✅ | ✅ | ✅ |
| `pnpm run audit` | ✅ | ✅ | ✅ |
| `pnpm test:e2e` | 6/6 ✅ | 6/6 ✅ | **5/6 ❌** |

Le compte annoncé (342 + 2 ignorés) est exact ; les deux ignorés sont bien la recette d'envoi réel, exclue par `describe.runIf(process.env.RESEND_LIVE_TEST === '1')`. Le seul rouge est `e2e/modules.spec.ts:43` en état C — **intouché par ce diff**, déjà consigné comme trou s03 en revue de s05. Le changement d'état a été fait sur `config/features.ts` puis `pnpm db:generate`, et restauré : `git diff --exit-code` propre avant l'écriture de ce rapport.

En plus : `pnpm install --frozen-lockfile` passe (le lockfile est cohérent avec les quatre nouveaux manifestes), et un `next build` avec une route qui importe réellement `apps/web/lib/mailer.ts` compile — vérifié puis retiré.

## Vérification anti-hallucination — le paquet installé, jamais la documentation

Ouvert et confronté un par un dans `node_modules` :

**`resend@6.25.0`** (`dist/index.d.mts`, `dist/index.mjs`)

| Ce que l'adapter affirme | Ce que le paquet dit | Verdict |
|---|---|---|
| `ResendOptions = { baseUrl, userAgent }` — ni délai, ni `AbortSignal` | l. 2690 : exactement ces deux clés | **exact** |
| `PostOptions = { query, headers }` | l. 220 : exactement ces deux clés | **exact** |
| `emails.send(payload, options?)` accepte `idempotencyKey` | l. 1982 + `CreateEmailRequestOptions extends PostOptions, IdempotentRequest` (l. 615) ; `post()` pose l'en-tête `Idempotency-Key` (`index.mjs` l. 1361) | **exact** |
| le SDK **ne lève pas** ; panne réseau → `{ data: null, error: { name: 'application_error', statusCode: null } }` | `fetchRequest` (`index.mjs` l. 1286-1350) : `try { fetch } catch { return { data: null, error: {…statusCode: null} } }` | **exact** |
| `new Resend(undefined)` lit `process.env.RESEND_API_KEY`, `getDefaultBaseUrl()` lit `RESEND_BASE_URL` | l. 1269 et l. 1243 | **exact** — les deux sont bien neutralisées en passant clé et `baseUrl` |
| `logError` écrit sur `console.error` hors production | l. 1281 | **exact**, et la limite est écrite dans l'`AGENTS.md` du package |
| `BY_NAME` couvre chaque nom de `RESEND_ERROR_CODE_KEY` | l. 121 : 21 noms ; `retry.ts` en classe **21** | **complet**, aucun oublié |

**`@react-email/components@1.0.12`** réexporte `@react-email/render@1.4.0`, dont `render: (node, options?) => Promise<string>` — **bien asynchrone**, et `{ plainText: true }` est une option réelle. `Html`, `Head`, `Preview`, `Body`, `Container`, `Section`, `Text` existent tous.

**Aucune API inventée dans ce diff.** Les types de `@repo/core` (`EmailTemplateContent`, `RegistryEmailTemplate`, `EmailTemplate.locales`) et de `@repo/config` (`Env`, `getEnv`) correspondent aux définitions ouvertes.

## Preuve par neutralisation

Suite complète après chaque mutation, restauration et `git diff --exit-code` après chacune.

| # | Invariant neutralisé | Rouges |
|---|---|---|
| M1 | `sanitizeProviderMessage` rend son argument | **6** |
| M1a | motif « adresse email » retiré seul | 3 |
| M1b | motif « clé `re_…` » retiré seul | 3 |
| M1c | troncature retirée seule | 1 |
| M1d | `REDACTIONS` neutralisées, troncature gardée | 5 |
| M2 | mailer choisi par `NODE_ENV === 'production'` | **2** |
| M3 | **clé d'idempotence tirée *dans* la tentative** | **0** |
| M3b | fabrique injectée ignorée (`crypto.randomUUID()` forcé) | 1 |
| M3d | clé suffixée par un compteur de tentative | 1 |
| M4 | `isTransient` toujours vrai | 4 |
| M5 | dispersion retirée | 1 |
| M5b | plafond retiré | 1 |
| M6 | `Promise.race` retiré (plus de délai d'attente) | 2 |
| M7 | `safeSegment` rendu identité | 1 |
| M8 | `basename` retiré | **0** |
| M9 | `'@repo/ports'` retiré de `domainForbiddenSources` | 1 |
| M10 | donnée manquante tolérée dans `interpolate` | 1 |
| M11 | locale demandée ignorée (toujours `fr`) | 2 |
| M12 | **le `catch` de l'adapter relance** | **0** |
| M13 | échec de rendu non rattrapé | 1 |
| M14 | repli sur le code HTTP retiré | 1 |
| M15 | doublure d'enregistrement rend la liste vivante | 1 |
| M16 | destinataire + sujet ajoutés au journal | 1 |
| M17 | idem, jugé par `tsc` | erreur TS2353 |

Les comptes annoncés dans `packages/adapters/resend/AGENTS.md` sont reproduits, **sauf un** : « tirer une clé d'idempotence par tentative → 1 » est faux pour la mutation structurelle (M3 : **0**). Voir F2.

Les tests sont de la vraie couverture : aucun n'asserte une classe CSS, une structure DOM, un libellé statique ou un inventaire de props. `resend-mailer.test.ts` double `globalThis.fetch` et affirme sur l'URL, l'en-tête `authorization`, l'en-tête `idempotency-key` et le corps **réellement sérialisé** — la frontière du doublage est au bon endroit, et c'est ce que le plan demandait de trancher. `render.test.ts` dérive ses attentes du module `demo-enabled` plutôt que d'une copie figée.

## La forme du port — le point qui décide de tout

Les trois choix sont **bons** et méritent d'être recopiés cinq fois :

1. **Granularité.** Un package `@repo/ports` sans aucune dépendance (manifeste vérifié : aucune `dependencies`), un fichier par capacité, un package par adapter. C'est ce qu'annonce `docs/architecture.md`, c'est ce qui isole ce qui mérite de l'être (un SDK), et `packages/ports/AGENTS.md` écrit le raisonnement au lieu de le laisser déduire. Le lint le rend opposable : `@repo/ports`, `@repo/emails`, `@repo/adapter-*` et `@repo/mailer-testing` sont refusés dans `domain/`.
2. **Erreur.** `send` rend `{ok:true,id} | {ok:false,error}` et ne lève jamais. Le corollaire est prouvé pour la panne réseau (M6, M13, `ne rejette jamais`) — avec une réserve, F5. Le code d'erreur porte la décision de reprise (`isTransient`), et `MailerErrorCode` étant une union fermée, un code de plus oblige à dire de quel côté il tombe. C'est la bonne façon d'écrire une politique de reprise.
3. **Frontière du test.** La doublure remplace `globalThis.fetch`, pas `emails.send`. C'est la correction directe du piège de s01, et le régime est lisible dans le nom du fichier : `resend-mailer.test.ts` (CI, réseau doublé) contre `resend-live.test.ts` (hors CI, `RESEND_LIVE_TEST=1`). Les deux régimes ne se mélangent pas.

**La règle de couches mord sur le chemin réel, pas seulement sur les fixtures.** Vérifié à la main, hors fixtures, avec la configuration réelle du dépôt :

```
$ printf "import type { Mailer } from '@repo/ports'\nexport type N = Mailer\n" \
  | pnpm exec eslint --stdin --stdin-filename packages/modules/demo-enabled/src/domain/probe.ts
  1:29  error  Pureté du domain (ADR 006) : « @repo/ports » n'a pas sa place dans domain/…
```

Idem pour `@repo/adapter-resend`, `@repo/emails`, `@repo/mailer-testing` et `resend` ; et le même import dans `…/src/application/probe.ts` passe. La correction de la fausse affirmation du plan (« le lint le vérifie ») est réelle, et pas seulement fixturée.

## Plan vs diff

Les sept tâches sont faites. Les sept critères de la story sont couverts, chacun par un test ou une recette tracée. Les interdits de course sont tenus : un seul adapter, aucun envoi réel depuis la CI (prouvé par les 2 ignorés), aucune sélection par `NODE_ENV` (M2), `domain` ignore le mailer (M9 + chemin réel), aucun secret dans un journal (M1/M16/M17), contrat de module (s03), barils (s04), CLI (s05) et `config/features.ts` intouchés, remote intouché.

Les cinq écarts déclarés sont justifiés et je les retiens tous : `@repo/emails` et `@repo/mailer-testing` (un port sans dépendance ne peut pas héberger React ni `node:fs` — l'alternative aurait pollué le graphe de tous les appelants) ; `apps/web/lib/mailer.ts` et les deux variables d'environnement (le critère 4 exige un choix, il faut bien un endroit qui le fasse) ; la restructuration de `env.ts` (`superRefine` supprime `.shape`, `ENV_KEYS` devait rester énumérable — vérifié : `Object.keys(envShape)`) ; cinq fichiers de test plutôt que deux (quatre unités distinctes plus la recette isolée par régime — le découpage suit les packages, il n'est pas décoratif) ; le texte du template porte désormais `{name}`, ce qui donne un sens à « rendu avec ses données » (M10 et le cas d'échappement en dépendent).

## Findings

### F1 — critical — `.env.example` copié en `.env` empêche l'application de démarrer

`.env.example` s'ouvre sur « Copiez ce fichier en `.env` puis adaptez les valeurs. » Le diff y ajoute :

```
RESEND_API_KEY=
```

`dotenv` charge une valeur vide comme `''`, et le schéma déclare `RESEND_API_KEY: z.string().min(1).optional()` : `optional()` n'accepte que `undefined`, pas la chaîne vide. Mesuré, en chargeant `.env.example` par `loadRootEnv` puis en appelant `getEnv` :

```
RESEND_API_KEY = ""
STARTUP FAILS: Invalid environment variables:
  - RESEND_API_KEY: Too small: expected string to have >=1 characters
```

`apps/web/next.config.ts` appelle `assertStartupEnv({ phase })`, seul point traversé par `next dev` comme par `next start` : **`pnpm dev` échoue au démarrage sur un dépôt fraîchement cloné dont on a suivi l'instruction du fichier lui-même**, et sur une variable que le commentaire juste au-dessus annonce « OPTIONNELLE ». C'est le premier geste du produit — un boilerplate — et il est cassé.

`tests/env-example.test.ts` ne l'attrape pas : il n'inventorie que les **noms** de clés, il ne soumet jamais le contenu du fichier au schéma.

Ce qu'il faut : soit commenter la ligne (`# RESEND_API_KEY=`), soit accepter la chaîne vide comme absence (`z.string().trim().min(1).optional().or(z.literal('').transform(() => undefined))` ou un `preprocess`), soit les deux. Et un cas dans `tests/env-example.test.ts` qui **parse** `.env.example` par `parseEnv` — sans quoi la prochaine variable optionnelle rejouera la même scène.

### F2 — major — L'unique clé d'idempotence pour toutes les tentatives n'est prouvée par aucun test, et l'`AGENTS.md` annonce le contraire

C'est l'invariant qui empêche un utilisateur de recevoir trois fois le même email quand le fournisseur répond en retard : `docs/reliability.md` §1, cité par le commit et par le tableau de `packages/adapters/resend/AGENTS.md` (« **une seule clé pour toutes les tentatives** »).

La mutation canonique — supprimer `const idempotencyKey = newIdempotencyKey()` et appeler la fabrique **dans** `attemptSend` — laisse la suite **verte** (M3 : 0 rouge). Raison : le seul cas qui regarde l'en-tête injecte une fabrique **constante**

```ts
newIdempotencyKey: () => 'idem-fixe',
```

et affirme `['idem-fixe', 'idem-fixe']`. Une fabrique constante rend indiscernables « tirée une fois » et « tirée à chaque tentative ». En production la fabrique est `() => crypto.randomUUID()` : la régression réelle — un UUID neuf par essai, donc des doublons chez le destinataire — passerait au vert.

Ce n'est pas seulement un trou : `packages/adapters/resend/AGENTS.md` écrit « tirer une clé d'idempotence par tentative → 1 » dans la liste de ce qui est « prouvé par mutation ». Le 1 mesuré ne s'obtient qu'en changeant aussi le **texte** de la clé (M3d), c'est-à-dire en mutant autre chose que l'invariant annoncé. Dans un dépôt où « prouvé par mutation » est l'étalon de preuve, une preuve qui ne prouve pas est plus coûteuse qu'une absence de preuve.

Correction : une fabrique **variable** dans le harnais (`let n = 0; () => \`idem-${(n += 1)}\``) et l'assertion « les deux appels portent la même clé **et** la fabrique n'a été appelée qu'une fois ». Deux lignes de test, aucune ligne de production.

### F3 — major — Sans clé en production, l'application écrit les emails sur disque et rend `{ok:true}`, sans le moindre signal

Le choix par présence de clé plutôt que par `NODE_ENV` est le bon, et il est prouvé (M2). Mais la conséquence n'est bornée par rien :

- `RESEND_API_KEY` et `EMAIL_FROM` sont **optionnelles** dans le schéma, y compris en production ;
- sans elles, `createAppMailer` construit `createLocalCaptureMailer`, qui écrit dans `process.cwd()/.mail/` et rend `{ ok: true, id: 'local-…' }` — **indiscernable d'un envoi réussi** pour l'appelant ;
- aucun `console.warn`, aucun journal, aucune garde au démarrage. Le dépôt sait pourtant crier quand il le faut : `getEnv` émet un avertissement explicite pour `SKIP_ENV_VALIDATION`.

`docs/reliability.md` §2 demande que « sans service d'email, l'inscription échoue **proprement en le disant** ». Ici elle réussit et ne dit rien. Son bullet suivant prescrit la capture locale **« en développement local »** — l'étendre silencieusement à la production est l'écart. `apps/web/AGENTS.md` nomme d'ailleurs « écrire sur disque en production » parmi les modes de panne à éviter, puis livre exactement cela.

Aujourd'hui c'est **latent** : `createAppMailer` n'est appelé par aucune route (seulement par `tests/mailer.test.ts`). Ça devient réel en s07, où cinq parcours en dépendent. Il faut le traiter maintenant, pendant que le point de composition est neuf.

Ce qu'il faut, au minimum : un avertissement bruyant au montage quand aucune clé n'est configurée, nommant la conséquence. Mieux : un opt-in explicite (une variable de capture locale) pour que « pas de clé » ne suffise pas à faire taire les emails d'un déploiement.

Note atténuante mesurée : sur un système de fichiers en lecture seule (serverless), `mkdir` échoue et la capture dégrade en `provider_unavailable` — donc l'appelant est prévenu. Sur un conteneur au disque inscriptible, non.

### F4 — major — La justification `tsx` / JSX inscrite dans deux fichiers de règles est fausse à la mesure

`packages/emails/AGENTS.md` et l'en-tête de `packages/emails/src/transactional-email.ts` posent une règle (« les templates s'écrivent avec `createElement`, pas en JSX ») sur cette affirmation :

> `tsx` n'expose aucun moyen de choisir le runtime : ni `jsx` dans un `tsconfig.json`, ni le commentaire `@jsxImportSource`, ni `TSX_TSCONFIG_PATH` — les trois ont été essayés, aucun ne change la sortie d'esbuild.

Mesuré avec le `tsx@4.23.13` du dépôt, sur un `.tsx` réel :

| `tsconfig.json` le plus proche | Résultat |
|---|---|
| sans `jsx` | échec, runtime classique (l'affirmation est vraie ici) |
| `{"compilerOptions":{"jsx":"react-jsx"}}` | **fonctionne** — `rendered function {"type":"div",…}` |
| `{"extends":"…/tooling/typescript/base.json","compilerOptions":{"jsx":"react-jsx"}}` | **fonctionne** |
| pragma `/** @jsxImportSource react */` seul | échec (l'affirmation est vraie ici) |

`tsx` honore bien `jsx` — dans le `tsconfig.json` **le plus proche du fichier**. Ce qui a été essayé est le `tsconfig.json` de la **racine**, qui ne gouverne pas `packages/emails/src/**` (ce package a le sien). L'observation était juste ; la généralisation ne l'est pas.

Le code n'en souffre pas : `createElement` est correct, portable et sans dépendance à un réglage de compilateur, et le tableau des trois transpileurs reste utile. Ce qui est en cause est une **fausse constatation technique gravée dans un fichier de règles** — que ADR 013 rend opposable et qu'un agent lira comme un fait vérifié, ici et dans les cinq packages qui suivront le gabarit. Il faut corriger la phrase : dire que le réglage doit vivre dans le `tsconfig.json` du package, et que `createElement` est préféré pour ne dépendre d'aucun réglage.

Vérifié par ailleurs, comme demandé : le `tsconfig.json` racine et `tooling/typescript/base.json` sont **intouchés** par le diff, `jsx: "preserve"` ne vit que dans `tooling/typescript/nextjs.json` pour `apps/web`, et rien d'autre ne dépendait d'un `jsx` racine.

### F5 — minor — Le `catch` de l'adapter n'est exercé par rien, et le port annonce le contraire

`packages/ports/src/mailer.ts` écrit : « Corollaire opposable, **prouvé par test** : aucune implémentation de ce port ne rejette, quoi qu'il arrive au fournisseur. »

Le cas « ne rejette jamais, quoi qu'il arrive au réseau » rejette bien `globalThis.fetch` — mais `fetchRequest` du SDK **avale** cette exception et rend `{ data: null, error }` (vérifié dans `index.mjs` l. 1345). Le `catch (cause)` de `attemptSend` n'est donc jamais atteint : M12 (le remplacer par `throw cause`) laisse la suite **verte**. Le garde-fou existe pour le cas explicitement nommé en commentaire (« une version ultérieure le pourrait ») et c'est précisément ce cas qui n'est pas couvert.

Un cas qui remplace le SDK par un objet qui lève — l'exception à la règle « on double le réseau », assumée et nommée — le fermerait. Ou, à défaut, une phrase plus modeste dans le port.

### F6 — minor — `EmailTemplateContent.subject` est déclaré par locale et jamais lu

Le critère 1 nomme bien « sujet » parmi les entrées de l'interface, donc `SendEmailInput.subject` est conforme. Mais le renderer résout le **corps** dans le registre (`content.body`) et prend le **sujet** chez l'appelant : `content.subject`, que le contrat de module oblige chaque module à déclarer **par locale**, n'est lu nulle part dans le dépôt.

Deux conséquences pour la suite : chaque appelant (s07 : vérification, magic link, réinitialisation) devra aller chercher le sujet dans le registre pour le repasser au renderer qui l'a déjà — c'est le geste que `tests/mailer.test.ts` fait lui-même — ou coder un sujet en dur, ce que la docstring du port dit vouloir empêcher ; et rien n'empêche un sujet en français avec `locale: 'en'`, exactement la divergence que la docstring invoque pour justifier l'interpolation unique.

Le plus simple qui satisfait le critère : garder `subject` optionnel dans l'entrée (surcharge) et retomber sur `content.subject` quand il est absent. À trancher **avant** s07, pas après.

### F7 — minor — Le `basename` de la capture locale est inerte, et le commentaire du test affirme qu'il mord

`packages/mailer-testing/src/mailer-testing.test.ts` écrit : « Deux gardes s'y appliquent et l'assertion mord sur les deux ». Mesuré : retirer `safeSegment` → 1 rouge (M7) ; retirer `basename` → **0** (M8). Et c'est structurel : `safeSegment` s'exécutant d'abord, `'../../evade'` devient `'evade'`, il ne reste plus rien pour `basename`. La ceinture par-dessus les bretelles est une bonne pratique ; l'affirmation « l'assertion mord sur les deux » est fausse et doit être corrigée en « la seconde garde n'est atteignable que si la première régresse ».

### F8 — minor — Un fournisseur en panne fait attendre l'appelant ~31 s, et le point de composition ne règle aucun délai

Défauts : `timeoutMs` 10 s, `maxAttempts` 3, recul 250 ms plafonné à 5 s. Pire cas : 10 s + [0,125-0,25 s] + 10 s + [0,25-0,5 s] + 10 s ≈ **30,4 à 30,8 s** avant que l'appelant reçoive `{ok:false}`. `createAppMailer` ne passe ni `timeoutMs`, ni `maxAttempts` : c'est le budget qui s'appliquera à une requête d'inscription en s07, au-delà du plafond usuel d'une fonction serverless. `docs/reliability.md` §3 n'exige qu'un délai explicite, donc ce n'est pas une violation — mais le défaut mérite d'être choisi plutôt que subi.

### F9 — minor — L'email rendu déclare `lang="en"` quel que soit la locale demandée

Capture réelle produite et relue, pour `locale: 'fr'` :

```html
<html dir="ltr" lang="en">
```

`TransactionalEmail` ne reçoit pas la locale, et `@react-email/html` retombe sur son défaut. Une ligne (`createElement(Html, { lang: input.locale }, …)`), et c'est réglé avant que s09 n'ait à le découvrir.

### F10 — minor — deux broutilles

- `render(element, { plainText: true })` : l'option est marquée `@deprecated` dans `@react-email/render@1.4.0` au profit de `toPlainText`. Elle fonctionne ; elle disparaîtra à une majeure.
- `apps/web/next.config.ts` liste cinq packages dans `transpilePackages` et pas les quatre nouveaux. **Vérifié : sans effet** — un `next build` avec une route qui importe réellement `lib/mailer.ts` compile. Incohérence de la liste, pas défaut.

## Ce que je n'ai pas pu vérifier

- **Aucun envoi réel.** Je n'ai pas de clé Resend : `resend-live.test.ts` est resté ignoré (les 2 skipped). Que l'API accepte cette requête, que l'en-tête `Idempotency-Key` déduplique réellement côté fournisseur, et qu'un `EMAIL_FROM` d'un domaine vérifié passe, ne sont prouvés par rien ici. **Geste humain** : lancer la recette de `docs/deliverability.md` avec une clé de test, lire l'email reçu et vérifier `spf=pass`, `dkim=pass`, `dmarc=pass` dans l'en-tête d'authentification. C'est le seul geste qui prouve le critère 3 et le critère 7.
- **La capture locale ouverte dans un navigateur.** J'ai produit un fichier et relu son HTML (bandeau + document, corps interpolé, échappement effectif) ; je ne l'ai pas ouvert dans un navigateur. Le fichier est volontairement deux documents concaténés. **Geste humain** : `open .mail/*.html` une fois, pour confirmer que le bandeau et l'email s'affichent tous les deux.
- **Le rendu dans un vrai client de messagerie** (Gmail, Outlook, Apple Mail). Aucun test ne peut le dire, et la mise en page est celle que **tous** les modules hériteront.
- **Le comportement en déploiement réel** : serverless contre conteneur pour l'écriture dans `.mail/` (F3), et le budget de 31 s de F8 contre le plafond de la plateforme. Jamais déployé.
- **La CI elle-même** n'a pas été exécutée : j'ai rejoué localement les commandes de `AGENTS.md`, pas `.github/workflows`.
- **`docs/deliverability.md`** : j'ai vérifié la cohérence interne (`include:amazonses.com`, sélecteur `resend._domainkey`, progression `p=none → quarantine → reject`) et la présence exigée par le test, pas que ces valeurs soient celles que la console Resend affichera pour un domaine donné.

## Conclusion

Le cœur de la story est réussi, et c'est le cœur qui comptait : la forme du port est juste, écrite, et opposable ; la frontière du test est au bon endroit (le réseau, pas le SDK) ; les affirmations sur le SDK Resend sont toutes exactes, relevées dans le paquet installé ; la sélection par présence de clé et le filtrage des secrets mordent tous les deux à la mutation ; la règle de couches a été corrigée et mord sur le chemin réel. C'est du travail solide, et le gabarit peut être copié cinq fois.

Trois choses l'empêchent de partir en l'état. F1 casse le premier geste du produit et se corrige en une ligne. F2 et F4 sont de la même famille et c'est celle que cette revue existe pour attraper : une preuve annoncée qui ne prouve pas, et un fait vérifié qui ne l'était pas — l'un et l'autre inscrits dans des fichiers que les cinq ports suivants liront comme la vérité.

**Verdict de la première passe** : sévérité maximale **critical**, ship **refusé**.
(Les deux lignes de verdict mécaniques ont été converties en prose lors de la
seconde passe : le portillon de `/ks-ship` cherche leur *présence*, et deux
paires contradictoires dans le même fichier seraient un piège. Le verdict qui
fait foi est celui qui clôt ce fichier.)

---

# Revue — seconde passe (correctifs)

Diff jugé : `git diff 577f404..36296ce`, le seul commit de correction. La
première passe ci-dessus n'est pas rejugée ; elle sert de contrat. Contexte
relu : `docs/plans/s06-transactional-emails.md`, `docs/stories.md` s06,
`docs/reliability.md`, `AGENTS.md` racine et par package, ADR 006, 008, 013,
014.

## Ce que j'ai exécuté moi-même

Dans les trois états de `config/features.ts`, chaque fois précédé de
`pnpm db:generate --force`, puis restauré (`git diff --exit-code` propre, aucun
fichier non suivi résiduel) :

| Commande | État A `['demo-enabled']` | État B `[]` | État C les deux |
|---|---|---|---|
| `tsc --noEmit` racine + `turbo run typecheck --force` (11 packages) | ✅ | ✅ | ✅ |
| `pnpm lint` | ✅ | ✅ | ✅ |
| `pnpm test` | **351 ✅ / 2 ignorés** | 351 ✅ / 2 ignorés | 351 ✅ / 2 ignorés |
| `pnpm build --force` | ✅ | ✅ | ✅ |
| `pnpm run audit` | ✅ | ✅ | ✅ |
| `pnpm test:e2e` | 6/6 ✅ | 6/6 ✅ | **5/6 ❌** |

Le compte annoncé (351 + 2 ignorés) est exact. Le seul rouge est
`e2e/modules.spec.ts:43` en état C — intouché par ce diff, déjà consigné comme
trou s03. Après restauration en état A : 351 ✅ / 2 ignorés et 6/6 en e2e.

## F1 — vérifié sur un clone réellement neuf

`git clone` du dépôt dans un répertoire hors arbre, `git checkout 36296ce`,
`cp .env.example .env`, `pnpm install --frozen-lockfile`, puis `next dev` et
deux requêtes :

```
✓ Ready in 388ms
✓ Running next.config.ts took 1349ms
home=200
{"status":"ok","database":"connected"}
```

**Le premier geste du produit fonctionne.** Les trois autres combinaisons,
mesurées sur le même clone, en éditant le seul `.env` :

| `.env` | Démarrage |
|---|---|
| ni clé ni drapeau | **refus** — `RESEND_API_KEY: is required, unless EMAIL_LOCAL_CAPTURE=1 captures emails on disk instead of sending them` ; le processus meurt, `home=000` |
| `RESEND_API_KEY` + `EMAIL_FROM`, drapeau commenté | **démarre**, `home=200` |
| clé **et** drapeau | **refus** — `EMAIL_LOCAL_CAPTURE: cannot be enabled while RESEND_API_KEY is set: choose one` |

Le message de refus nomme bien les deux variables, comme annoncé.

**L'exclusion mutuelle est-elle juste ou trop stricte ?** Elle est juste. La
seule autre forme défendable — la capture l'emporte, avec un avertissement — est
exactement le mode de panne que F3 dénonçait : un déploiement muni d'une clé
tairait ses emails, et personne ne lit les avertissements de démarrage. Refuser
un choix ambigu est le bon arbitrage. Le coût est réel et mérite d'être connu :
il faut deux éditions au lieu d'une pour basculer un poste qui a une vraie clé
vers la capture, et une plateforme qui pose `RESEND_API_KEY` pour tous les
environnements ne peut plus en mettre un seul en capture sans retirer le secret.
Ce coût est acceptable ici ; il ne l'était pas dans l'autre sens.

La normalisation globale des valeurs vides est le bon niveau : elle est prouvée
(voir la neutralisation) et elle immunise les prochaines variables optionnelles,
ce qu'un correctif clé par clé n'aurait pas fait.

## F3 — l'échappatoire est réelle, la garde ne la ferme qu'à moitié

L'échappatoire existe bien : `getEnv` (`packages/config/src/env.ts`) rend
`source as unknown as Env` **sans validation** sous `SKIP_ENV_VALIDATION=1` et
en phase de build, et `createAppMailer` appelle `getEnv()`. La garde dupliquée
au point de composition est donc nécessaire, et elle mord (1 rouge à la
neutralisation).

Mais elle ne ferme le trou que pour l'absence, pas pour le vide — et le vide est
précisément la forme que `.env.example` livre. Mesuré, avec exactement
l'environnement du fichier livré, sous `NEXT_PHASE=phase-production-build` puis
sous `SKIP_ENV_VALIDATION=1` :

```
RESEND_API_KEY = ""
branche Resend prise ? true      (les deux fois)
```

`withoutBlanks` vit dans `parseEnv`, la fonction que ces deux chemins sautent :
`RESEND_API_KEY` vaut `''`, donc `!== undefined`, donc la **première** branche
est prise et la capture demandée par `EMAIL_LOCAL_CAPTURE=1` est ignorée. Voir
G2 : ce n'est pas silencieux (l'adapter refuse une clé vide), mais la décision
n'est pas celle du schéma, et l'affirmation « `lib/mailer.ts` garde la même
décision » est fausse sur ce chemin-là.

## F4 — re-mesuré : c'est le correctif qui a raison

Mesuré moi-même, `tsx@4.23.13`, sur un `.tsx` réel dans un clone propre, chaque
ligne exécutée :

| Expérience | Résultat |
|---|---|
| aucun réglage, `tsx` lancé de la racine | échec — `ReferenceError: React is not defined` |
| `jsx: "react-jsx"` dans `packages/emails/tsconfig.json`, `tsx` lancé **de la racine** | **échec** |
| le même fichier, le même réglage, `tsx` lancé **depuis `packages/emails`** | **fonctionne** |
| `jsx` dans le `tsconfig.json` racine (dont l'`include` ne couvre pas `packages/`), de la racine | échec |
| idem, `"packages"` ajouté à l'`include` | **fonctionne** (via `extends` du préset du dépôt) |
| `TSX_TSCONFIG_PATH` vers un tsconfig qui pose `jsx` | **fonctionne** |
| `/** @jsxImportSource react */` seul | échec |

Les six lignes du tableau de `packages/emails/AGENTS.md` se reproduisent
exactement. **La paire décisive est la deuxième contre la troisième** : même
fichier, même `tsconfig.json` le plus proche, résultats opposés selon le
répertoire de lancement. L'explication « le `tsconfig.json` le plus proche du
fichier » de ma prédécesseure est donc **fausse**, et la constatation inscrite
par ce commit — résolution depuis le répertoire courant du processus, appliquée
seulement si l'`include` couvre le fichier — est **vraie**. Le choix de
`createElement` tient, et sa raison est maintenant exacte. Réserve en G7.

## Preuve par neutralisation

Suite complète après chaque mutation, restauration et `git diff --exit-code`
après chacune. Les deux mutations que la première passe avait trouvées vertes
sont en gras.

| # | Invariant neutralisé | Rouges (avant → après) |
|---|---|---|
| N1 | **clé d'idempotence tirée *dans* `attemptSend`** (mutation structurelle, pas le texte de la clé) | **0 → 1** |
| N2 | **le `catch` de l'adapter relance (`throw cause`)** | **0 → 1** |
| N3 | `withoutBlanks` rendu identité | 0 → **2** (`env.test.ts` *et* `tests/env-example.test.ts`) |
| N4 | règle « aucun mailer configuré » retirée du schéma | 1 |
| N5 | règle d'exclusion mutuelle retirée du schéma | 1 |
| N6 | garde du point de composition remplacée par le repli en capture (l'ancien comportement) | 1 |
| N7 | `timeoutMs`/`maxAttempts` retirés du montage (budget subi) | 1 |
| N8 | `lang` figé à `'en'` | 1 |
| N9 | repli du sujet sur celui du module retiré | 1 |
| N10 | mailer choisi par `NODE_ENV === 'production'` (non-régression) | 3 |
| N11 | `basename` retiré | **0** — conforme au commentaire désormais corrigé |

N1 et N2 étaient les deux fausses preuves de la première passe : elles mordent
maintenant. N3 est celle qui compte le plus, parce que `tests/env-example.test.ts`
est le seul test qui aurait attrapé F1 et qu'il l'attrape réellement — il charge
le fichier par `loadRootEnv` (signature vérifiée dans `packages/config/src/dotenv.ts` :
`{ path, from, target }`) et le soumet à `parseEnv`, le vrai schéma. N11 confirme
que le correctif de F7 est bien un commentaire rendu vrai, pas une garde ajoutée.

**L'exception de doublage du SDK (F5) est acceptable.** Le SDK installé avale ses
propres exceptions (`fetchRequest`, `index.mjs`) : aucun scénario réseau
n'atteint ce `catch`, et le port affirme « aucune implémentation ne rejette ». Le
`vi.doMock('resend')` est le seul moyen de tenir l'affirmation. La porte qu'il
ouvre est bornée par trois choses vérifiées : un seul cas, `vi.doUnmock` +
`vi.resetModules` dans un `finally`, et l'exception nommée comme telle à la fois
dans la docstring du `describe` et dans l'`AGENTS.md` du package (« pas une
autorisation générale de doubler le SDK »). Le cas n'est pas décoratif : il
affirme le code d'erreur **et** l'absence de la clé et du destinataire dans le
message.

## Vérification anti-hallucination

Ouvert un par un, dans le paquet installé et dans le dépôt :
`loadRootEnv({ path, target })` et `LoadRootEnvOptions` existent avec ces noms ;
`parseEnv` et `EMAIL_LOCAL_CAPTURE_ENABLED` sont bien exportés par le barril
`@repo/config` ; `@repo/config/server` est un point d'entrée déclaré du
manifeste ; `Html` de `@react-email/html@0.0.12` accepte `lang` (il étend
`React.HtmlHTMLAttributes<HTMLHtmlElement>`), et le rendu réel porte bien
`lang="fr"` ; `EmailTemplateContent.subject` existe dans
`packages/core/src/module.ts` et est désormais **lu** par `render.ts`, ce qui
clôt F6 ; `z.literal(...).optional()` et `superRefine` se comportent comme le
code le suppose (mesuré, pas déduit). **Aucune API inventée dans ce diff.**

## Findings de la seconde passe

### G1 — major — `pnpm test` régresse sur un clone sans `.env`

`tests/env-wiring.test.ts:167` (« démarre sur une URL bien formée mais
injoignable ») importe le **vrai** `apps/web/next.config`, qui valide
`process.env`. Le cas stubbe `DATABASE_URL` ; il ne stubbe pas la nouvelle
exigence de mailer. Il ne passe donc que si l'environnement ambiant déclare un
mailer — ce que le test ne dit nulle part.

Mesuré sur le même clone, mêmes `node_modules`, sans `.env` :

```
577f404 (avant le correctif) : 336 réussis | 8 ignorés | 0 échec
36296ce (après)              : 344 réussis | 8 ignorés | 1 ÉCHEC
```

Reproductible dans le dépôt : `EMAIL_LOCAL_CAPTURE= pnpm test` → 1 échec, le
même. La CI reste verte (le drapeau est posé au niveau du job) et un poste qui a
suivi `cp .env.example .env` reste vert : c'est pourquoi ce n'est pas un
*critical*. Mais la Definition of Done écrit « No regression on existing code »,
et le commit qui répare « un clone neuf ne démarre pas » introduit « un clone
neuf n'a pas la suite verte ». Le défaut est dans le test, pas dans la
production : il lit un environnement qu'il ne déclare pas. Correctif :
`vi.stubEnv('EMAIL_LOCAL_CAPTURE', '1')` à côté du `stubEnv` de `DATABASE_URL`,
deux lignes, et le cas redevient hermétique.

(Le cas voisin l. 159 reste vert, mais pour une raison en partie fausse : sans
mailer configuré l'erreur porte *deux* variables, et `/DATABASE_URL/` matche
quand même.)

### G2 — minor — la garde dupliquée ne couvre pas la valeur vide, c'est-à-dire la configuration livrée

Mesuré (détail plus haut) : en phase de build et sous `SKIP_ENV_VALIDATION`,
avec exactement le `.env` que `.env.example` produit, `createAppMailer` prend la
branche **Resend** et non la capture, parce que `RESEND_API_KEY` vaut `''` et non
`undefined` — `withoutBlanks` vit dans `parseEnv`, que ces chemins sautent. Le
résultat n'est pas silencieux : `createResendMailer` refuse une clé vide et lève
`« RESEND_API_KEY est vide : construisez la capture locale plutôt que cet
adapter. »`. Mais ce message conseille exactement ce que l'environnement
demandait déjà, et l'affirmation inscrite dans `apps/web/lib/mailer.ts` et
`apps/web/AGENTS.md` — « `lib/mailer.ts` garde la même décision » — est fausse
sur le seul chemin pour lequel la garde a été écrite. Correctif : normaliser au
même endroit que le schéma (`env.RESEND_API_KEY?.trim()` dans la condition), ou
appeler `withoutBlanks` avant de décider.

### G3 — minor — le contrat d'environnement impose désormais un choix de mailer à des processus qui n'envoient aucun email

`packages/db/src/client.ts:62` appelle `getEnv()`, donc la validation complète.
Mesuré :

```
$ EMAIL_LOCAL_CAPTURE= npx tsx packages/db/src/scripts/migrate.ts
EnvValidationError: Invalid environment variables:
  - RESEND_API_KEY: is required, unless EMAIL_LOCAL_CAPTURE=1 …
    at getDatabase (packages/db/src/client.ts:62:59)
```

Un conteneur de migration muni du seul `DATABASE_URL` ne s'exécute plus. C'est
cohérent avec le contrat unique du dépôt (`DATABASE_URL` est déjà exigé de tout
le monde), mais la conséquence n'est écrite nulle part, et elle porte sur la
seule commande dont `AGENTS.md` promet qu'elle « applique les migrations ».
**Décision humaine** : garder un contrat monolithique et le documenter, ou
scoper la règle du mailer au point de composition.

### G4 — minor — le commentaire de la CI nomme la mauvaise étape

`.github/workflows/ci.yml` : « sans lui, l'application refuse de démarrer et
`pnpm test:e2e` le dit ». Mesuré, dans l'ordre réel des étapes du job, la
première à tomber sans le drapeau est **`pnpm db:migrate`** (étape 5), et
`pnpm test` échoue d'un cas avant que `test:e2e` ne soit atteint. Le drapeau
au niveau du job est le bon endroit — pas de secret, garantie qu'aucun email ne
part — mais la justification écrite à côté est fausse à la mesure, ce qui est
la famille de défaut que F4 existait pour attraper. À noter aussi, conséquence
de l'exclusion mutuelle : ajouter un jour un secret `RESEND_API_KEY` à ce job
casserait **toutes** ses étapes, pas seulement les emails.

### G5 — minor — le critère de story et la tâche de plan disent encore le contraire du comportement livré

`docs/stories.md` s06, critère 4 : « En développement, **sans clé d'API**,
l'email est capturé et consultable localement ». `docs/plans/s06-*.md`, tâche
4 : « **Capture locale** — sans clé d'API, l'email est écrit localement ».
Depuis ce commit, l'absence de clé ne suffit plus : il faut le drapeau. Le fond
du critère est tenu — `.env.example` livre le drapeau, donc un développeur qui
suit l'instruction obtient bien la capture sans clé — et l'écart est argumenté
dans cinq fichiers. Mais `docs/stories.md`, le plan, `docs/reliability.md` §2 et
l'`AGENTS.md` racine (« Every port works locally with no API key ») n'ont pas
été amendés, alors que quatre `AGENTS.md` de packages l'ont été. Dans un dépôt
où ADR 013 rend les fichiers de règles opposables, c'est le même défaut que F4,
un cran plus haut. **Décision humaine** : amender le critère 4 (et le bullet de
`docs/reliability.md` §2), ou consigner l'écart comme accepté.

### G6 — minor — deux docstrings restées à l'ancien comportement

`packages/config/src/env.ts`, docstring de `RESEND_API_KEY` : « Sans elle, le
mailer est la capture locale — le choix se fait sur la **présence de la clé** ».
C'est faux depuis ce commit, et c'est écrit huit lignes au-dessus de la
docstring de `EMAIL_LOCAL_CAPTURE` qui dit l'inverse. Même chose pour la
première ligne en gras de la docstring de module de `apps/web/lib/mailer.ts`
(« Le choix se fait sur la présence de la clé d'API »), que le paragraphe suivant
corrige sans corriger la ligne.

### G7 — minor — le tableau `tsx` est exact mais pas exhaustif, et il sera lu comme exhaustif

Mesuré, en plus des six lignes : `/** @jsxRuntime automatic @jsxImportSource
react */` **fonctionne**, sans aucun réglage de `tsconfig.json` et sans
dépendance au répertoire de lancement. La ligne du tableau (« pragma
`@jsxImportSource` seul → échec, il choisit la source d'import, pas le runtime »)
est juste, mais la prose qui l'entoure conclut qu'un package chargé depuis des
répertoires différents « ne contrôle » pas le runtime — ce qui n'est vrai que des
mécanismes `tsconfig.json`. Le choix de `createElement` reste le bon (aucun
pragma, aucun réglage, rien à oublier en tête de fichier) ; c'est la raison qu'il
faut compléter d'une ligne, puisque cinq packages la recopieront.

### G8 — nit — `EMAIL_LOCAL_CAPTURE=0` est une erreur, pas un « désactivé »

`z.literal('1')` refuse `0`, `true`, `false` en nommant la variable et la valeur
attendue — discoverable, et le choix « une seule orthographe » est défendable.
Atténuation vérifiée : *vider* la variable la neutralise bien
(`withoutBlanks`), ce qui reste possible sur les plateformes où l'on ne peut pas
supprimer une variable. À connaître, pas à corriger.

## Le rapport de première passe committé

Le fichier a été créé par le commit de correction lui-même : il n'existe aucun
objet git antérieur auquel le comparer, et une altération éventuelle est donc
**invérifiable par git**. C'est un défaut de procédure à corriger pour les
stories suivantes (committer la revue avant le correctif). J'ai vérifié à la
place tout ce qui y est mesurable, et tout se reproduit : `342 réussis / 2
ignorés` sur `577f404` avec la base disponible (mesuré à l'identique sur un
clone), la fabrique constante `'idem-fixe'` dans le harnais d'origine, la ligne
`RESEND_API_KEY=` vide dans le `.env.example` d'origine, `basename` retiré → 0
rouge. Aucun indice de réécriture complaisante.

## Ce que je n'ai pas pu vérifier

- **Aucun envoi réel.** Pas de clé Resend : `resend-live.test.ts` est resté
  ignoré (les 2 skipped). Que le fournisseur déduplique réellement sur
  `Idempotency-Key`, et qu'un `EMAIL_FROM` d'un domaine vérifié passe, n'est
  prouvé par rien ici. **Geste humain** : la recette de `docs/deliverability.md`
  avec une clé de test, puis lire `spf=pass`, `dkim=pass`, `dmarc=pass` dans
  l'en-tête d'authentification de l'email reçu.
- **Le rendu visuel.** J'ai vérifié `lang="fr"` par assertion et par mutation ;
  je n'ai ouvert aucune capture dans un navigateur, ni dans un client de
  messagerie. **Geste humain** : `open .mail/*.html` une fois, et un envoi de
  contrôle vers Gmail et Outlook.
- **La CI elle-même n'a pas été exécutée.** J'ai rejoué localement les commandes
  du workflow, dans leur ordre, mais pas le workflow. Le comportement de G4 est
  déduit de mesures locales étape par étape, pas d'un run GitHub.
- **Aucun déploiement réel.** G2 et G3 portent sur des chemins (phase de build
  serverless, conteneur de migration) que ce dépôt n'a jamais exécutés ailleurs
  que sur cette machine. **Geste humain** : un déploiement de préproduction avec
  les variables réelles, et un job de migration à `DATABASE_URL` seul.
- **`SKIP_ENV_VALIDATION` en production** : je l'ai éprouvé par appel direct,
  jamais sur un processus Next réellement démarré avec.

## Conclusion

Les quatre findings assignés sont traités, et bien traités. F1 est vérifié là où
il fallait le vérifier — sur un clone réellement neuf, jusqu'à une requête HTTP
servie — et le correctif choisi (normaliser toute valeur vide à la source) vaut
mieux que le rustine par clé qu'on demandait. F2 et F5 passent de 0 à 1 rouge sur
la mutation qui compte, et l'`AGENTS.md` dit maintenant ce que la mutation prouve
vraiment. F4 est re-mesuré et c'est le correctif qui a raison contre ma
prédécesseure : la paire « même fichier, même tsconfig, deux répertoires de
lancement » ne laisse pas de place au doute. L'exclusion mutuelle ajoutée
d'initiative est le bon arbitrage, et l'exception de doublage du SDK est bornée
comme il faut.

Ce qui reste ne bloque pas. G1 est la seule chose à faire tout de suite : le
commit qui répare le premier geste d'un clone neuf en casse un autre, dans un
test qui lit un environnement qu'il ne déclare pas — deux lignes. G2, G3 et G5
demandent une décision plutôt qu'un correctif. G4, G6 et G7 sont des phrases à
rendre vraies, ce qui, dans ce dépôt, n'est pas une broutille : ce sont les
phrases que cinq ports vont recopier.

Max severity: major
Ship allowed: yes
