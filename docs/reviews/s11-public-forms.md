# Revue anti-hallucination — s11-public-forms

Branche `feature/s11-public-forms`, commit `0911aa9`, 50 fichiers.
Diff jugé : `git diff dev...feature/s11-public-forms`.
Worktree `/Users/olivier/www/boilerplate/.claude/worktrees/agent-af2f329c5c2fb259c`,
base Postgres `s11`, parcours `E2E_PORT=3111`.

Ce rapport dit **ce qui a été exécuté**, jamais ce qui existe. Chaque affirmation
de conformité ci-dessous a été obtenue par mutation du code de production suivie
d'une restauration prouvée (`git diff --exit-code`), ou par une mesure sur la
base et sur le navigateur.

## 1. Ce qui a été exécuté

| Commande | Module `marketing` activé | Module coupé |
|---|---|---|
| `pnpm typecheck` | vert | vert |
| `pnpm lint --max-warnings=0` | vert (`No issues found`) | vert |
| `pnpm test` | 971 passés, 2 sautés (`resend-live`, clés de recette absentes) | 971 passés, 2 sautés |
| `E2E_PORT=3111 pnpm test:e2e` | 53 passés, 5 sautés | 49 passés, 9 sautés |
| `pnpm build` | vert (`--force`, sortie de production réelle) | vert |
| `pnpm run audit` | « 1 avis remonté, aucun au seuil élevé qui ne soit couvert » | — |
| `pnpm ks toggle marketing` aller-retour | `config/features.ts` et `generated/` **identiques** après retour (`git diff --exit-code` vert) | |
| `pnpm db:migrate` deux fois | la seconde n'applique rien | |

Base réelle, module coupé, tables du module : **absentes**
(`\dt` sur `s11` ne rend que `auth_*`, `organization*`, `demo_items`).
Module activé : `public_subscription` (clé unique `(source, email)`, index sur
`source`) et `public_form_throttle` présentes. **Critère 4 mesuré, pas déduit.**

## 2. Mutations — ce qui mord, et de combien

Onze mutations, toutes restaurées dans la même commande, arbre prouvé propre
après chacune.

| # | Ce qui a été neutralisé | Rouges |
|---|---|---|
| A | `exceedsRateLimit` rend toujours `false` | **3** (dont le 429 servi par le répartiteur) |
| B | le piège à robots ne se déclenche jamais | **5** |
| C | la newsletter distingue une adresse malformée | **2** (dont la comparaison statut+corps+type servie) |
| C2 | la newsletter distingue un **doublon** | **2** |
| D | le contact part vers l'adresse du visiteur, pas celle de la configuration | **1** |
| E | les caractères de contrôle sont acceptés dans un nom | **1** |
| F | la garde « périmètre organisation » de la purge et de l'export est retirée | **1** |
| G | l'idempotence passe d'une contrainte à une lecture préalable | **2** (dont le cas concurrent contre la base réelle) |
| H | le seau n'est plus remis à zéro au changement de fenêtre | **1** |
| I | l'identifiant d'appelant est écrit en clair | **1** |
| J | l'email de confirmation est attendu dans le temps de réponse | **1** (expiration) |
| K | le segment `contact` n'est plus réservé aux organisations | **1** |
| L | `/contact` sort de `publicPaths` | **1** |
| M | la garde 404 de `app/contact/page.tsx` est retirée | **0 module activé**, 1 module coupé — voir F2 |

Le dixième cas signalé par l'implémenteur (doublure complaisante sur le périmètre
organisation) est refermé : la mutation F rougit désormais.

## 3. Ce qui a été instruit sur la machine, pas dans le code

**Le compteur est réellement partagé et réellement atomique.** Vingt `hit`
simultanés sur le même seau rendent exactement `[1…20]` — aucun compte perdu,
aucun compte doublé ; une **seconde connexion** (autre « instance ») rend `21`.
Bascule de fenêtre : retour à `1`.

**La limite par appelant fonctionne, et se contourne comme annoncé.** Huit tirs
depuis une même adresse : `200 200 200 200 200 429 429 429`. Douze tirs avec un
`x-forwarded-for` tournant : `200` douze fois.

**L'injection est fermée.** Un corps portant `"to"`, `"subject"` et `"template"`
part quand même vers `bonjour@exemple.test` avec le sujet du module ;
`<img src=x onerror=alert(1)>` et `<script>` ressortent échappés dans l'email
capturé ; aucun marqueur `{…}` non substitué ; aucune adresse dans un journal
(`MailerLogRecord` ne porte que template, code, tentatives, message).

**Sous le build de production**, `/fr` et `/fr/contact` : CSP
`default-src 'self'` sans `unsafe-inline`, **aucun attribut `style`**, **aucune
erreur console**, piège à robots en `display: none`, hors de l'ordre clavier
(`name → email → message → bouton`), `aria-hidden`, non requis. Aucun
débordement horizontal à 1280 px ni à 380 px, en clair comme en sombre.

## 4. Constats

### F1 — majeur — `public_form_throttle` ne se vide jamais, et le code affirme le contraire

Mesuré : 500 identifiants d'appelant distincts ⇒ **500 lignes**. Rien ne les
efface — `jobs: []`, aucune purge, aucune commande. Et comme `withinRateLimit`
appelle `throttle.hit` sur les **deux** seaux *avant* de rendre son verdict, une
requête **refusée** écrit quand même sa ligne : le 429 n'arrête pas la
croissance. Avec un `x-forwarded-for` falsifiable — que la story documente — un
visiteur anonyme écrit une ligne par requête, sans borne.

`infrastructure/drizzle-public-forms.ts` écrit pourtant : « Une ligne par seau
suffit donc, et **la table ne grandit pas avec le temps**. » C'est faux tel que
mesuré, et c'est exactement la forme d'affirmation que l'`AGENTS.md` racine
interdit — le prochain agent la lira comme vérifiée.

Seconde face du même constat : ces lignes portent un condensat SHA-256 **non
salé** d'une adresse IP, conservé **indéfiniment**, sans `dataCategories`, sans
`retention`, sans `purge`. Le module nomme honnêtement la faiblesse du condensat
(`docs/research` §6.4) mais pas la conservation sans fin qui la rend gênante.

Ce qui refermerait : effacer les lignes dont la fenêtre est close (dans la même
instruction, ou par une tâche), et ne plus écrire le seau d'appelant une fois le
seau de formulaire dépassé.

### F2 — majeur — le seau global ferme le formulaire pour tout le monde

Mesuré : `newsletter:all` porté à 200 dans la fenêtre courante ⇒ un client
**neuf** reçoit `429`. Or `maxPerForm: 200` sur dix minutes est atteignable en
quelques secondes par un seul attaquant qui fait tourner son en-tête (F1 :
12/12 acceptés). Le seau censé **borner le coût** d'un identifiant falsifié
**ferme donc aussi les deux formulaires à tous les visiteurs légitimes**, dix
minutes durant, gratuitement.

Ni `config/marketing.ts` — le fichier où le propriétaire pose le seuil — ni
l'`AGENTS.md` du module ni la recherche n'écrivent cette conséquence ; les trois
disent « borne le coût total ». Aggravant : le texte rendu est
« Trop de messages envoyés **depuis cet appareil** », faux dans le cas global.

Ce qui refermerait : dériver l'identifiant de l'appelant de l'adresse réelle du
pair, ou d'un nombre de sauts de proxy de confiance **configuré**, pour que la
limite par appelant cesse d'être contournable ; le seau global peut alors
dégrader (cesser d'envoyer les confirmations) au lieu de fermer.

### F3 — mineur — une garde annoncée par la recherche ne mord pas

`docs/research/s11-public-forms.md` §5 annonce : « `tests/marketing.test.ts`
confronte `robots.txt` à **chaque écran du disque** → un `/contact` non déclaré
public serait fermé aux robots, et le test l'exigerait ». Mesuré (mutation L) :
retirer `CONTACT_PATH` de `publicPaths` ne rougit **qu'un** cas, l'assertion
unitaire de `marketing-site.test.ts`. Le test de `robots.txt` dérive l'attendu
**et** le constaté du même `publicPaths` : il vérifie la cohérence, pas la
publicité de `/contact`. L'invariant est couvert — par un autre test que celui
annoncé. La phrase de la recherche est à corriger.

### F4 — mineur — la garde 404 de `/contact` ne mord que dans la configuration que la CI ne joue pas

Mutation M : retirer `notFound()` de `app/contact/page.tsx` laisse `pnpm test`
**tout vert** dans la configuration livrée. La même mutation rougit
(`tests/rendered-text.test.ts`) une fois le module coupé, et le parcours
`e2e/public-forms.spec.ts` « site coupé » ne s'exécute que là aussi. Or
`.github/workflows/ci.yml` ne joue **qu'une** configuration. Le critère 4 est
donc réellement tenu — je l'ai vérifié à la main dans les deux états — mais
aucune commande de la CI ne le tiendrait. C'est un trait hérité de s10 et s15,
pas une invention de s11 ; il devient plus coûteux à chaque story.

### F5 — mineur — sans JavaScript, le bouton reste éteint et ne dit rien

Mesuré sous le build de production, `javaScriptEnabled: false` : le bouton
« Envoyer le message » est **désactivé**, le `<form>` n'a pas d'`action`, et
**aucun message n'explique pourquoi**. L'ADR 027 tranche que le formulaire de
s11 exige JavaScript, et son raisonnement tient ; mais le dépôt porte par
ailleurs deux parcours qui affirment « sans JavaScript » (`oauth.spec.ts`,
`organizations.spec.ts`), et le bouton mort silencieux n'est décidé nulle part.
Un texte de repli coûterait une clé de catalogue.

### F6 — mineur — différence de temps de réponse résiduelle

40 mesures entrelacées, serveur de production chaud : adresse **nouvelle**
médiane 5,46 ms, adresse **déjà inscrite** 5,09 ms, adresse **malformée**
3,95 ms. La réponse n'**attend** pas l'envoi (mutation J le prouve), mais le
préfixe synchrone de `mailer.send` — le rendu du gabarit — reste sur le chemin
de réponse. Les distributions se recouvrent largement ; l'écart est réel et
difficilement exploitable. Nommé parce que `docs/security.md` §7 demande
« aucune différence de temps de réponse observable » et que la story revendique
ce contrôle. L'écart malformée/valide n'est pas une oracle : l'appelant sait
déjà si son adresse est bien formée.

### F7 — mineur — la dette s28 n'est pas écrite là où s28 la lira

Elle est écrite cinq fois : recherche §1, plan, `domain/rate-limit.ts`,
`schema.ts`, `AGENTS.md` du module. Elle ne l'est **pas** dans les trois
documents que l'agent de s28 ouvrira :

- `docs/stories.md`, s28 : « **Absorbe toute limitation locale : aucune autre
  story n'écrit son propre compteur.** » ;
- `docs/architecture.md` : « La limitation de débit arrive en s28 », et
  `rate_limit_window` attribuée à un module `ratelimit` ;
- `docs/security.md` §7 : « partagée entre instances **(s28)** ».

Le cycle de vie des documents interdit à une branche de story de toucher ces
fichiers de cadrage : c'est donc un arbitrage de fusion, pas une correction de
branche. Mais laissé tel quel, s28 découvrira `public_form_throttle` par hasard.

### F8 — mineur — `contact_message` absente : la conséquence n'est pas écrite

La déviation est déclarée et défendue (recherche §6.1, `schema.ts`,
`AGENTS.md`). Ce qui ne l'est pas : un message de contact dont l'envoi échoue
est **perdu**, avec un 502 pour tout accusé et aucune reprise. C'est acceptable
— rien n'est écrit à moitié — mais c'est une limite produit à connaître.
`docs/architecture.md` continue par ailleurs d'attribuer cette table au module.

### F9 — mineur — deux fragilités de câblage

- `tests/marketing.test.ts` **supprime** les deux tables du module sur la base
  de développement partagée et les repose en `afterAll`. Une exécution
  interrompue, ou un `pnpm test:e2e` lancé en parallèle, laisse la base sans ces
  tables — le commentaire du fichier dit que les 500 ont été mesurés. La
  dépendance d'ordre est documentée ; elle reste réelle.
- `MarketingFooter` rend `null` quand aucun document légal n'est déclaré. Un
  projet qui garde `forms` et retire ses documents légaux sert `/contact`,
  l'annonce dans le plan de site, et n'y mène de nulle part.

### F10 — mineur — `technicalProps` s'élargit, et deux cas sont proches du décoratif

`tests/rendered-text.test.ts` blanchit `type` et `labelKey` sur l'accueil et sur
`/contact`. La correction F5 de s15 est respectée — la liste est **par écran**,
pas globale — et la garde de prose reste active. `type` reste un nom très commun.
Côté tests, `expect(CONTACT_FORM).not.toBe(NEWSLETTER_FORM)` et l'inventaire des
locales de chaque template (déjà tenu par le compilateur, `NoInfer<TLocale>`)
n'ajoutent pas de protection.

## 5. Ce qui a été vérifié et tient

- **Aucune référence inventée.** Chaque import du diff a été ouvert :
  `provideMarketing` / `requireMarketingService` / `resetMarketingService`,
  `createPublicFormRoutes`, `marketingRoutePath`, `ContactView`,
  `CONTACT_FORM_KEYS`, `NEWSLETTER_FORM_KEYS`, `TRAP_FIELD`, `CONTACT_PATH`,
  `useHydrated`, `Textarea`, `anonymousLanding`,
  `appAuth().useCases.viewAccount(userId)` (`AccountView.email` existe),
  `ModuleScope`, `onConflictDoNothing({target})` / `onConflictDoUpdate` de
  Drizzle 0.45.2. Aucun nom manquant, aucune signature approximée.
- **Le plan est exécuté tâche par tâche**, les onze cases cochées correspondent
  à du code livré. Deux dérives, toutes deux déclarées : le composant a quitté
  le module (ADR 027, motivée par une règle de lint qui échoue réellement) et le
  fichier de routes s'appelle `public-form-routes.ts` là où le plan écrivait
  `public-forms-routes.ts`. Rien dans le diff n'est hors plan, sauf
  `e2e/oauth.spec.ts` — voir ci-dessous.
- **`e2e/oauth.spec.ts` : attente dérivée, pas relâchée.** `urlOf('/')` devient
  `urlOf(anonymousLanding())`, un helper de s10 qui rend `'/'` site public
  activé et `'/sign-in'` coupé. La destination finale du rebond est exactement
  la même ; le cas passe dans les deux configurations, et j'ai joué les deux.
- **Le destinataire du contact vient de la configuration** (piège nommé par la
  story), le sujet n'interpole rien, `z.email()` refuse `\r\n`, les caractères
  de contrôle sont refusés dans les champs de ligne et admis dans le corps.
- **Idempotence portée par la contrainte** : deux `subscribe` simultanés donnent
  une ligne (mesuré contre la base) ; remplacer la contrainte par une lecture
  préalable rougit.
- **Purge et export exécutés par le contrat du module** contre la base `s11` :
  l'export rend l'inscription, la purge l'efface, un périmètre organisation ne
  rend rien — et retirer la garde rougit.
- **ADR 027 est cohérente avec le code** : la règle de lint refuse bien `fetch`
  dans `packages/modules/**`, la propriété `ReactNode` est obligatoire, et la
  garde n'a pas été élargie.
- **Aucun `process.env` ajouté, aucune source CSP ajoutée**, `config/security.ts`
  intact, `method="post"` en littéral, Zod sur les deux corps **et** sur le bloc
  `forms` de la configuration.

## 6. Ce que je n'ai pas pu vérifier

- **Le vrai fournisseur d'emails.** Tout a été mesuré sous
  `EMAIL_LOCAL_CAPTURE=1`. Ce que Resend fait d'un corps de 4 000 caractères,
  d'un `Reply-To` absent, ou d'un envoi refusé pour réputation, n'a pas été
  exercé. Geste humain : `pnpm` avec de vraies clés de test, un message de
  contact et une inscription, avant le ship.
- **Le comportement derrière un vrai proxy.** `x-forwarded-for` a été mesuré sur
  `next start` local, qui pose `::1` lui-même et laisse passer l'en-tête du
  client. Le comportement derrière Vercel, un ALB ou un Nginx n'a pas été
  exercé, et c'est précisément là que se joue F2. Geste humain : déployer sur un
  environnement de recette et refaire le tir à en-tête tournant.
- **La CSP de production réelle** a été mesurée sur `next start` local, pas
  derrière la plateforme de déploiement, qui peut ajouter ses propres en-têtes.
- **La conformité visuelle à la maquette.** J'ai vérifié l'absence de
  débordement, les deux thèmes et les deux largeurs, et lu le rendu ; je n'ai
  pas comparé pixel à pixel avec `docs/designs/s11-public-forms.html`.
- **Le lecteur d'écran.** `aria-hidden`, `role="status"`, `role="alert"` et
  l'ordre clavier ont été lus par le DOM, pas par VoiceOver ou NVDA.
- **La charge.** L'atomicité a été mesurée à vingt requêtes simultanées sur une
  Postgres locale, pas sous contention réelle ni sur plusieurs processus Node.
- **La CI elle-même** n'a pas été exécutée ; j'ai joué localement les commandes
  qu'elle joue, dans les deux configurations du module.

## 7. Verdict

Le socle de la story est solide et honnêtement documenté : la limitation de
débit est réellement partagée entre instances et réellement atomique, le piège à
robots survit à la CSP stricte et à l'ordre clavier, l'énumération est fermée en
message comme en statut, l'injection d'en-tête et de HTML est fermée, le module
coupé ne laisse aucune trace, et treize mutations sur quatorze rougissent.

Deux constats majeurs restent : une table de compteurs qui grandit sans borne
sous le contrôle d'un anonyme, avec une affirmation contraire écrite dans le
code (F1), et un seau global qui transforme la protection en fermeture du
formulaire pour tout le monde (F2). Aucun des deux ne contredit une ligne des
socles de sécurité ou de fiabilité, aucun ne corrompt de donnée, et les deux se
referment sans toucher à l'architecture livrée.

## 8. Clôture — ce que le tour de correction a fait, constat par constat

Correction menée sur la même branche, un seul commit. Chaque affirmation
ci-dessous a été obtenue en **exécutant** : mutation du code de production suivie
d'une restauration dans la même commande, ou mesure sur la base et sur le
navigateur sous le build de production.

### Commandes rejouées

| Commande | Module `marketing` activé | Module coupé |
|---|---|---|
| `pnpm typecheck` | vert (16 tâches) | vert |
| `pnpm lint --max-warnings=0` | vert (`No issues found`) | vert |
| `pnpm test` | 980 passés, 2 sautés | 980 passés, 2 sautés |
| `E2E_PORT=3111 pnpm test:e2e` | 54 passés, 5 sautés | 49 passés, 10 sautés |
| `pnpm build` | vert | vert |
| `pnpm run audit` | « 1 avis remonté, aucun au seuil élevé qui ne soit couvert » | — |
| `pnpm ks toggle marketing` aller-retour | `config/features.ts` et `generated/` **identiques** (empreintes md5 comparées avant et après) | |
| `pnpm db:migrate` deux fois | la seconde : « Rien à appliquer » | |

Migration **additive** : `0001` crée `contact_message` et deux index, n'altère et
ne supprime rien.

### Mutations, et ce qu'elles font rougir

Neuf mutations, chacune restaurée **dans la commande qui la pose**, empreinte du
fichier vérifiée après restauration.

| # | Ce qui a été neutralisé | Rouges |
|---|---|---|
| N1 | une requête déjà refusée réécrit dans le seau du formulaire | **1** |
| N2 | plus aucun balayage des fenêtres closes à la bascule | **1** |
| N3 | le seau du formulaire refuse au lieu de dégrader | **2** |
| N4 | le message de contact n'est plus enregistré avant l'envoi | **6** |
| N5 | la date de remise est posée malgré l'échec d'envoi | **1** |
| N6 | la purge oublie les messages de contact | **1** |
| N7 | `sweep` ne supprime rien, contre la base réelle | **1** |
| N8 | la garde 404 de `app/contact/page.tsx` est retirée | **1 module activé**, **2 module coupé** |
| N9 | le pied de page redevient conditionné aux seuls documents légaux | **1** |

N8 est la réponse à F4 : la mutation rougit désormais dans **les deux**
configurations, mesuré dans les deux.

### F1 — majeur — fermé

Les deux moitiés, plus l'affirmation.

- **Croissance.** `SubmissionThrottle.sweep(before)` efface les seaux dont la
  fenêtre est close, appelé à la **première soumission d'une nouvelle fenêtre**
  (une fois par fenêtre et par formulaire, pas à chaque requête). Un index sur
  `window_started_at` porte l'effacement. **Prouvé en l'exécutant**, contre la
  base : 500 identifiants d'appelant distincts ⇒ 500 lignes ; un seau de la
  fenêtre en cours ; `sweep` en supprime **500** et en laisse **1**
  (`tests/marketing.test.ts`). Mutation N7 : rouge.
- **Écriture sur une requête déjà refusée.** Les deux seaux étaient incrémentés
  en parallèle. Ils sont désormais **séquentiels** : le seau de l'appelant
  d'abord, et s'il refuse, plus rien n'est écrit. Mutation N1 : rouge.
- **L'affirmation.** « Une ligne par seau suffit donc, et la table ne grandit pas
  avec le temps » est retirée de `infrastructure/drizzle-public-forms.ts` et
  remplacée par ce qui est vrai, avec le chiffre mesuré par la revue et le nom du
  test qui l'exécute.
- **Conservation.** La durée de vie d'un condensat d'adresse est désormais bornée
  par `windowSeconds` (dix minutes dans la configuration livrée), là où elle
  était sans fin. Écrit dans `docs/research/s11-public-forms.md` §6.4.

### F2 — majeur — fermé, et l'échange est écrit

Le seau du formulaire **dégrade au lieu de refuser** : au-delà de `maxPerForm`,
la soumission est acceptée et enregistrée, et seul l'**envoi sortant** est
suspendu. Aucun visiteur n'est plus fermé par ce seau, donc le levier
d'indisponibilité n'existe plus. Le 429 ne vient que du seau de l'appelant, ce
qui rend le texte affiché vrai — il dit maintenant « depuis cette connexion » et
non « depuis cet appareil ». Mutation N3 : 2 rouges.

Ce que cet échange coûte est **écrit** et non tu
(`packages/modules/marketing/AGENTS.md`, `config/marketing.ts`) : en cessant de
refuser, le seau du formulaire cesse aussi de borner le nombre de **lignes**
qu'une vague de soumissions écrit. L'ancien comportement convertissait un risque
de stockage en certitude d'indisponibilité pour tous ; c'est ce qui a été refusé.
La fermeture réelle est un identifiant infalsifiable : la pile ne l'offre pas —
un gestionnaire de route Next ne voit pas la socket, et le serveur ne pose
`x-forwarded-for` que s'il est absent (`??=`, vérifié dans
`next/dist/server/base-server.js`) — et elle appartient à s28.

### F8 — fermé, au-delà du constat

`contact_message` est livrée : le message est **écrit avant d'être envoyé**, et
`delivered_at` reste vide quand le fournisseur ne l'a pas pris. Un envoi en échec
rend toujours 502, mais le message n'est plus perdu — il est en base, repérable
par sa date de remise vide, ce qui est aussi ce qui rend acceptable la
suspension des envois de F2. La catégorie `contact-message` est déclarée au
contrat, avec `retention: 'erase'`, et la purge comme l'export du module la
traitent. Mutations N4 (6 rouges), N5 et N6 : rouges.

`purgeSubscriptions` / `exportSubscriptions` sont renommés
`purgeVisitorData` / `exportVisitorData` : une purge qui efface deux catégories
sous un nom qui n'en annonce qu'une est le genre de silence que le prochain agent
lit de travers.

### F5 — fermé

`app/public-form.tsx` porte un `<noscript>` qui explique pourquoi le bouton est
éteint, texte de catalogue dans les deux langues. **Mesuré sous le build de
production** (`next start`), `/fr/contact`, quatre combinaisons clair/sombre ×
1280/380 px, JavaScript activé **et** désactivé :

- sans JavaScript : bouton désactivé, bloc d'explication réellement rendu
  (622 × 66 px), **aucun** attribut `style`, aucune erreur console, aucun
  débordement horizontal ;
- avec JavaScript : le `<noscript>` n'est pas visible, aucune erreur console,
  aucun débordement. Les seuls attributs `style` de la page sont posés par
  Next et `next-themes` **après** hydratation (`color-scheme` sur `<html>`,
  `position` sur `next-route-announcer`) — le HTML servi n'en porte aucun, et
  `e2e/security-headers.spec.ts` continue de l'exiger ;
- CSP inchangée : `default-src 'self'`, ni `unsafe-inline` ni `unsafe-eval`,
  vérifié sur l'en-tête réel dans les huit combinaisons. Aucune source ajoutée.

Un parcours le garde (`e2e/public-forms.spec.ts`, contexte
`javaScriptEnabled: false`). **Piège mesuré et écrit** dans `apps/web/AGENTS.md` :
les moteurs de texte et de rôle de Playwright ignorent le sous-arbre d'un
`<noscript>` — `getByText` y rend zéro alors que le bloc est à l'écran ; il faut
un sélecteur de structure.

### F4 — fermé

Un cas remplace le point de composition (`apps/web/lib/marketing.ts`) pour poser
l'état « site public sans formulaires », quelle que soit la configuration du
dépôt : `ContactPage()` doit alors refuser avec le digest 404. Mutation N8 jouée
dans les **deux** configurations : 1 rouge module activé, 2 rouges module coupé.
Le trait de dépôt signalé par la revue — la CI ne jouait qu'une configuration —
est traité ailleurs, et la CI en joue désormais deux.

### F3 — fermé

La phrase du §5 de la recherche annonçait que le test de `robots.txt` exigerait
`/contact` public. Elle est corrigée : ce test dérive attendu et constaté du
**même** `publicPaths` et ne vérifie que leur cohérence ; ce qui exige réellement
`/contact` public, c'est l'assertion unitaire de `marketing-site.test.ts`.

### F6 — répondu : non exploitable, et écrit

L'écart mesuré par la revue (nouvelle 5,46 ms, connue 5,09 ms, malformée
3,95 ms) est reporté dans `packages/modules/marketing/AGENTS.md` avec la
conclusion : **non exploitable comme oracle d'inscription** — les distributions
se recouvrent largement, la gigue réseau est d'un ordre de grandeur supérieur, et
l'écart malformée/valide n'est pas une oracle puisque l'appelant sait déjà si son
adresse est bien formée. La réponse n'attend toujours pas l'envoi ; ce qui reste
sur le chemin est le préfixe synchrone de `mailer.send`. Rien n'a été changé dans
le code : différer davantage l'envoi (`setTimeout`) le ferait perdre sur une
plateforme sans état qui gèle la fonction après la réponse.

### F9 — fermé, les deux moitiés

- La suite ne supprime plus rien dans `public`. Tout ce qui touche la base —
  migrations, repositories, routes servies — se passe dans un **schéma dédié**
  (`marketing_probe`) créé au début et détruit à la fin, avec un journal de
  migration à son nom. La base de développement partagée n'est plus touchée, et
  une exécution interrompue ne la laisse plus sans tables. *(La bascule a
  d'ailleurs pris la suite en flagrant délit : l'ancienne forme avait laissé la
  base avec `contact_message` seule et son journal désynchronisé — réparé.)*
- `MarketingFooter` dérive ses liens de ce qui existe : documents légaux **et**
  contact, ce dernier suivant `site.forms`. Un projet qui retire ses documents
  légaux garde donc un chemin vers `/contact`. Mutation N9 : rouge.

### F10 — fermé pour les deux cas décoratifs

`expect(CONTACT_FORM).not.toBe(NEWSLETTER_FORM)` et l'inventaire des locales de
chaque template (déjà tenu par le compilateur) sont **supprimés**.
`technicalProps` n'a pas été élargi.

### F7 — hors branche, inchangé

`docs/stories.md`, `docs/architecture.md` et `docs/security.md` continuent
d'attribuer la limitation de débit à s28. Arbitrage de fusion, traité sur `dev` ;
rien n'y a été touché ici.

### Ce qui reste ouvert

- l'identifiant d'appelant reste **falsifiable** : la pile n'offre pas d'adresse
  de pair fiable. La conséquence sur autrui est supprimée (F2), pas la cause. À
  s28 ;
- la croissance de `public_subscription` et `contact_message` sous un en-tête qui
  tourne n'est bornée que par un identifiant honnête — écrit dans l'`AGENTS.md`
  du module ;
- les points de la §6 du présent rapport que la correction ne touche pas : le
  vrai fournisseur d'emails, le comportement derrière un proxy réel, la CSP de la
  plateforme de déploiement, la conformité pixel à la maquette, le lecteur
  d'écran, la charge.

Max severity: none
Ship allowed: yes
