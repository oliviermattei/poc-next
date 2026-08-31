# Recherche — s11-public-forms

> Contacter l'éditeur et s'inscrire à la newsletter. **Premiers formulaires du
> dépôt ouverts à tout venant** : jusqu'ici, les seules entrées non
> authentifiées étaient les routes du module `auth`, qui parlent à un compte.
> Ici, l'appelant n'est personne et ne le sera jamais.
>
> Worktree `/Users/olivier/www/boilerplate/.claude/worktrees/agent-af2f329c5c2fb259c`,
> branche `feature/s11-public-forms`, base Postgres `s11`, port de parcours 3111.
> Tout ce qui suit a été **lu dans les paquets installés et dans le code du
> dépôt**, jamais dans une documentation en ligne. Les affirmations mesurées
> disent ce qui a été mesuré, jamais « tout ce qui existe ».

## 0. Ce que la story demande, et ce qu'elle ne demande pas

`docs/stories.md`, s11 — quatre critères :

1. le formulaire de contact envoie un email **à l'adresse configurée** et
   affiche une confirmation ; un champ invalide affiche une erreur sans envoyer ;
2. l'inscription newsletter enregistre l'email dans une **table d'inscriptions
   publiques portant une colonne de source**, et refuse les doublons **sans
   erreur visible** ;
3. un email de confirmation d'inscription est envoyé ;
4. **module non activé** : aucune route de formulaire public, les liens
   correspondants disparaissent du site, table absente d'une base vierge.

Notes de la story, reprises telles quelles :

- la table d'inscriptions est **réutilisée par s42-waitlist**, distinguée par sa
  colonne de source → un seul modèle, jamais un second concurrent ;
- la **consultation / export CSV** des inscrits est s37, pas ici ;
- **piège** : l'adresse de destination du contact est de la configuration,
  jamais une constante.

## 1. Le point de friction n°1 — la limitation de débit

Trois documents du dépôt disent que la limitation de débit appartient à **s28**,
en toutes lettres :

- `docs/security.md` §7 : « Limitation de débit sur tout point d'entrée public,
  partagée entre instances **(s28)**. » ;
- `docs/architecture.md`, « Points de vigilance » : « **La limitation de débit
  arrive en s28.** Tous les états livrables antérieurs exposent inscription,
  invitations, téléversement et checkout anonyme sans limite » ; et le modèle de
  données attribue `rate_limit_window` à un module `ratelimit` ;
- `packages/modules/marketing/AGENTS.md` : « la limitation de débit de ces
  formulaires à **s28**, qui énumère ses points d'entrée ».

La consigne de la voie s11, elle, l'exige ici, partagée entre instances, adossée
à PostgreSQL, et annonce qu'un manquement vaut **constat critique** en revue.

**Tranché : on la livre, dans le module `marketing`, et on l'écrit.** Le
raisonnement :

- le socle de sécurité s'applique à *toute* story, et ces deux routes sont les
  premières que n'importe qui peut marteler sans compte ;
- la note de s28 qui interdit un « compteur local » vise un compteur **en
  mémoire de processus** — c'est le piège qu'elle nomme (« un compteur en
  mémoire est contournable en scalant horizontalement »). Un compteur **en
  base**, partagé entre instances, est exactement la forme que s28 généralisera ;
- ce qui est livré ici n'est **ni un port `RateLimiter`, ni un module
  `ratelimit`, ni une table `rate_limit_window`** : ces trois noms restent
  libres pour s28. C'est une table du module `marketing`
  (`public_form_throttle`), qui disparaît avec lui.

**Dette écrite, à reprendre en s28** : deux mécanismes de comptage coexisteront
le jour où s28 arrive. s28 devra faire migrer ces deux points d'entrée vers son
port et **supprimer** la table de `marketing`. C'est une déviation assumée par
rapport aux notes de la story, déclarée ici, dans le plan, dans
`packages/modules/marketing/AGENTS.md` et dans le rapport final.

### 1.1 L'identifiant de l'appelant, et ce qu'il vaut

Le dépôt n'a pas de résolveur d'IP : `apps/web/proxy.ts` (hors périmètre de
cette voie) ne pose rien de tel, et le répartiteur de modules passe la `Request`
brute au gestionnaire (`packages/core/src/registry.ts:221`). Deux sources
disponibles dans un `Request` Next : `x-forwarded-for` et `x-real-ip`.

Elles sont **falsifiables par le client** quand aucun proxy de confiance ne les
réécrit. Conséquence à écrire plutôt qu'à taire : la limite par identifiant est
un rempart contre le martèlement naïf, pas contre un attaquant qui fait tourner
l'en-tête. Elle est doublée d'une **limite par forme, sans identifiant** (un
seau global par formulaire), qui elle n'est pas contournable de cette façon et
qui borne le coût total.

**Corrigé après la revue (constat F2)** : ce seau global **refusait**, et c'était
l'erreur. Une protection contre un en-tête falsifiable qui, à saturation, ferme
les deux formulaires à tous les visiteurs pendant dix minutes offre à l'attaquant
exactement l'indisponibilité qu'il cherchait — et pour quelques centaines de
requêtes. Il **dégrade** désormais : au-delà de `maxPerForm`, la soumission est
acceptée et enregistrée, mais l'email correspondant n'est pas envoyé. Le coût
réel — l'appel sortant au fournisseur — reste borné, et personne n'est refusé.
Le 429 ne vient plus que du seau de l'appelant, ce qui rend enfin vrai le texte
affiché (« depuis cette connexion »).

Ce qui n'est **pas** fait, et pourquoi : dériver l'identifiant d'une adresse de
pair fiable, ou d'un nombre de sauts de proxy configuré. La pile ne le permet
pas — un gestionnaire de route Next ne voit pas la socket, et le serveur ne pose
`x-forwarded-for` que s'il est absent (`??=`, `next/dist/server/base-server.js`).
La bonne réponse appartient à s28, qui possède la limitation de débit ; ce qui a
été fait ici, c'est de retirer à l'en-tête falsifiable tout pouvoir de nuisance
sur autrui.

L'identifiant est **haché** (SHA-256) avant d'être stocké : la table ne porte
donc aucune adresse IP en clair. **Corrigé après la revue (constat F1)** : ces
lignes étaient conservées sans fin, et une requête déjà refusée en 429 en écrivait
une de plus — 500 identifiants distincts, 500 lignes définitives, sous le contrôle
de quiconque sait boucler. Deux changements : le seau du formulaire n'est plus
consulté quand celui de l'appelant a déjà refusé, et les lignes d'une fenêtre
close sont effacées à la première soumission de la suivante.

## 2. Le point de friction n°2 — l'anti-automatisation

`docs/security.md` §7 : « Protection anti-automatisation sur les formulaires
publics : **captcha activable, pièges à robots, seuils configurables**. » Le
captcha est explicitement *activable* (donc pas livré actif), et `config/security.ts`
réserve déjà `frame`/`script` pour « le captcha de s28 ». Restent les deux
autres, qui sont ceux de cette story.

**Choix : piège à robots (honeypot) + seuils configurables.** Vérifié contre les
trois contraintes de la consigne :

| Contrainte | Pourquoi le honeypot passe |
|---|---|
| aucun service tiers, aucune clé | c'est un `<input>` et une comparaison serveur ; rien à joindre |
| ne casse pas sans JavaScript | le champ est masqué par une **classe CSS** (`hidden`) servie par la feuille de l'application, pas par du script. Sans script, il reste masqué |
| ne casse pas sous la CSP de s45 | aucun style **en ligne**, aucun script en ligne : `style-src-attr` — la seule directive qui ignore les nonces (`packages/ui/AGENTS.md`) — n'est pas sollicitée |

Ce qui a été **écarté**, et pourquoi :

- **piège temporel signé** (jeton horodaté + HMAC) : il faut un secret. Le seul
  disponible est `AUTH_SECRET`, **facultatif** au schéma
  (`packages/config/src/env.ts:103`) et propriété du module `auth` — hors
  périmètre de cette voie. Un horodatage **non signé** est falsifiable en une
  ligne : il ferait un contrôle en trompe-l'œil, exactement le mode d'échec n°10
  de `docs/STATE.md` ;
- **captcha** : dépendance tierce + clé + source CSP à déclarer. `config/security.ts`
  est hors périmètre de cette voie, et le document le range en s28.

Le honeypot doit être **silencieux** : rempli, la réponse est celle d'une
soumission acceptée, et rien n'est écrit ni envoyé. Un 400 explicite apprendrait
au robot quel champ éviter.

## 3. Le point de friction n°3 — l'énumération et le message unique

La consigne : « une adresse email invalide ne doit pas produire un message
différent d'une adresse valide inconnue ». Croisée avec le critère 2 (« refuse
les doublons **sans erreur visible** »), la seule forme cohérente est :

> **la route newsletter répond identiquement dans les trois cas** — adresse
> nouvelle, adresse déjà inscrite, adresse malformée. Même statut, même corps.

Sinon on obtient une oracle d'inscription : poster une adresse et lire la
réponse dirait si elle est déjà dans la liste. C'est la même règle que le §7
(« pas d'énumération de comptes »), appliquée à une liste de diffusion.

Le formulaire de **contact**, lui, n'a pas ce problème : le destinataire est
fixe et connu, il n'y a rien à énumérer. Le critère 1 demande explicitement une
erreur de champ → **400 avec le nom du champ fautif**, et aucun email envoyé.

### 3.1 Le temps de réponse

`docs/security.md` §7 exige aussi « pas de différence de temps de réponse
observable ». Une inscription nouvelle envoie un email, un doublon non : sans
précaution, la latence trahit. Le dépôt a déjà le geste, et il est documenté
dans `e2e/support/account.ts` : « le courrier de réinitialisation part **hors du
temps de réponse**, exprès (`docs/security.md` §7) ». On reprend ce patron —
l'écriture en base est dans le temps de réponse (elle porte l'idempotence),
l'envoi ne l'est pas.

## 4. Le point de friction n°4 — l'injection dans l'email

Deux voies possibles, examinées dans le code installé :

1. **En-têtes.** `SendEmailInput` (`packages/ports/src/mailer.ts`) n'expose que
   `to` et `subject` comme champs d'en-tête. `to` vient de la **configuration**
   (contact) ou de l'adresse validée par `z.email()` (newsletter). `subject`
   est celui **déclaré par le module** pour la locale
   (`packages/emails/src/render.ts`, repli sur `EmailTemplateContent.subject`).
   → **Décision : aucun sujet n'interpole de donnée utilisateur.** C'est ce qui
   ferme la voie, parce que `interpolate` (`packages/emails/src/interpolate.ts`)
   n'échappe rien et traite le sujet comme le corps.
   Mesuré : `z.email().safeParse('a@b.co\r\nBcc: x@y.co')` → `success: false`.
2. **HTML.** Le rendu passe par React Email, qui échappe — `packages/emails/src/render.test.ts`
   le prouve déjà (`<script>` → `&lt;script&gt;`). Rien à ajouter, mais le
   domaine refuse quand même les **caractères de contrôle** dans les champs
   libres : ce qui n'entre pas ne peut pas ressortir.

## 5. Ce que le code du dépôt impose déjà (vérifié fichier par fichier)

| Fait | Où | Conséquence pour s11 |
|---|---|---|
| Le contrat de module a **quatorze clés**, toutes obligatoires | `packages/core/src/module.ts:275-318` | `dataCategories`, `retention`, `purge`, `export` cessent d'être vides |
| `retention` est indexée par `dataCategories` par le compilateur | idem, `NoInfer<TCategory>` | déclarer une catégorie sans politique ne compile pas |
| `emails[].locales` est indexé par les locales de `messages` | idem, `NoInfer<TLocale>` | un template livré en `fr` seul ne compile pas |
| Une route de module **n'a pas de segment dynamique** | `ModuleRoute`, même fichier | deux chemins fixes, `POST` |
| Le répartiteur monte `/api/modules/<path>` et répond 404 hors liste | `packages/core/src/registry.ts:190-221` | critère 4 obtenu sans condition sur un identifiant de module |
| Un module ne construit **rien** à l'import ; l'application « provide », le module construit à la 1re requête | `organizations-runtime.ts`, `apps/web/lib/module-services.ts` | `pnpm ks list` et `pnpm db:generate` n'ont pas de base : patron obligatoire |
| La connexion est **injectée** au module (ADR 020) | `apps/web/lib/organizations.ts` | `@repo/module-marketing` n'importe jamais `@repo/db` |
| `@repo/module-marketing` a **deux points d'entrée** (ADR 024) : le barril ne réexporte aucun `.tsx` | `packages/modules/marketing/src/index.ts` | les composants de formulaire vont dans `/presentation` |
| Le domaine peut importer `zod`, jamais `@repo/ports` ni `drizzle-orm` | `tooling/eslint/boundaries.ts`, `domainForbiddenSources` | le port `Mailer` vit dans `application/ports.ts` |
| `infrastructure` et `presentation` ne se connaissent pas | `layerPolicies`, même fichier | la route appelle un **cas d'usage**, jamais un repository |
| Tout `<form>` déclare `method` en littéral écrit | `FORM_METHOD_SYNTAX`, `eslint.config.ts` | `method="post"` en toutes lettres, pas de valeur calculée |
| Aucun texte affiché en dur, y compris un `aria-label` | `tests/i18n.test.ts`, `tests/rendered-text.test.ts` | toutes les chaînes en catalogue `fr`/`en` |
| Les clés **composées** échappent au balayage statique | `packages/modules/marketing/src/domain/message-keys.ts` | les clés des formulaires sont fixes → visibles ; on les ajoute à `FIXED_KEYS` |
| `tests/rendered-text.test.ts` dérive la liste des écrans **du disque** et exige une entrée par `page.tsx` | `pageFilesUnder(SCREEN_ROOT)` | un nouvel écran sans entrée fait rougir `pnpm test` |
| `tests/marketing.test.ts` confronte `robots.txt` à **chaque écran du disque** | `probePaths(shippedSite)` | il vérifie la **cohérence** entre la politique servie et `publicPaths` : attendu et constaté dérivent tous deux de la même liste, si bien que retirer `/contact` de `publicPaths` ne le fait pas rougir. **Correction apportée après la revue de s11 (constat F3)** : la phrase précédente promettait davantage. Ce qui exige réellement `/contact` public, c'est l'assertion unitaire de `marketing-site.test.ts` |
| `apps/web/lib/organizations.ts` réserve les segments de premier niveau, **dérivés du disque** par `tests/organizations.test.ts` | `APPLICATION_SEGMENTS` | ajouter `app/contact/` oblige à réserver `contact` |
| Les motifs de `robots.txt` sont **ancrés** (`Allow: /fr$`) | `domain/seo.ts`, correctif F1 de la revue s10 | `/contact` s'ajoute à `publicPaths` et obtient son propre `Allow: /fr/contact$` |
| Les pages publiques n'émettent **aucune requête base** au rendu, compteur posé sur les prototypes de `pg` | `tests/marketing.test.ts:740` | les formulaires sont des composants clients qui postent : rien à lire au rendu |
| Le mailer est un **opt-in explicite** : sans clé et sans `EMAIL_LOCAL_CAPTURE=1`, rien ne se monte | `apps/web/lib/mailer-config.ts` | aucun repli deviné à écrire ici |
| `createRecordingMailer()` expose `sent: readonly SendEmailInput[]` | `packages/mailer-testing/src/recording-mailer.ts` | c'est la doublure des tests de nœud |
| `Textarea` est à l'inventaire de `docs/design-system.md` mais **non copié** dans `packages/ui` | `packages/ui/AGENTS.md`, tableau daté du 31/08/2026 | le copier est le geste sanctionné (précédent `Accordion`, s10), pas une invention |
| `Form` / `FormField` sont **nommés et non construits** (dette ouverte, `docs/STATE.md`) | idem | on compose avec `Input`, `Label`, `Button`, `Alert` — pas de primitive maison |
| Drizzle 0.45.2 expose `onConflictDoNothing({target})` et `onConflictDoUpdate` | `node_modules/.pnpm/drizzle-orm@0.45.2…/pg-core/query-builders/insert.d.ts:138,171` | idempotence par **contrainte**, pas par vérification préalable |
| `z.email()` et `z.int()` existent en zod 4.5.4 | exécuté : `typeof z.email === 'function'` | validation d'adresse sans regex maison |

## 6. Décisions de conception

### 6.1 Trois tables

| Table | Colonnes | Pourquoi |
|---|---|---|
| `public_subscription` | `id`, `email`, `source`, `locale`, `created_at`, **unique(`source`,`email`)** | critère 2, et le nom vient de `docs/architecture.md` (« email + **source** : newsletter, waitlist »). L'unicité **en base** est ce qui porte l'idempotence — `docs/reliability.md` §1 refuse « une simple vérification préalable » |
| `contact_message` | `id`, `name`, `email`, `message`, `locale`, `created_at`, `delivered_at` (nullable) | le message est écrit **avant** l'envoi ; `delivered_at` vide dit « reçu, pas parti » |
| `public_form_throttle` | `bucket` (clé primaire), `window_started_at`, `hits`, index sur `window_started_at` | le compteur partagé de §1. Nom distinct de `rate_limit_window`, qui appartient à s28. L'index sert l'effacement des fenêtres closes |

**`contact_message` a d'abord été écartée, à tort.** L'argument était : aucun
critère de s11 ne l'écrit ni ne la lit, s37 ne consulte que « les inscriptions
publiques », et `packages/modules/marketing/AGENTS.md` interdit « un schéma que
rien n'écrit ». La revue a nommé ce que cet argument ne voyait pas (constat F8) :
sans cette table, un envoi qui échoue rend 502 **et le message du visiteur
disparaît**, sans reprise possible. Un formulaire de contact dont le message se
perd quand le fournisseur d'emails a un mauvais quart d'heure ne rend pas le
service qu'il annonce.

Elle est donc livrée, et elle a un lecteur : le **contrat du module**. La
catégorie `contact-message` est déclarée, donc l'export la rend et la purge
l'efface — c'est ce que ces clés existent pour faire, et c'est ce qui rendait
inacceptable de stocker le nom, l'adresse et le texte libre d'un visiteur sans
elles.

### 6.2 Un écran de plus, une section de plus

- **Contact** : un écran `apps/web/app/contact/page.tsx`, donc un chemin
  `/contact` **ajouté à `publicPaths`** — c'est ce qui le fait entrer dans le
  plan de site et obtenir son `Allow: /<locale>/contact$` ancré. Le lien vit
  dans le pied de page, avec les documents légaux : il disparaît donc avec le
  module, sans condition nulle part.
- **Newsletter** : une **nouvelle nature de section**, `newsletter`, rendue par
  `MarketingHome`. L'ordre et la présence restent pilotés par
  `config/marketing.ts`, comme le veut le critère 1 de s10.

Les deux formes viennent du design system : `MarketingSection`, `Card`,
`Label`, `Input`, `Textarea`, `Button`, `Alert`. Aucun composant inventé.
**Design system gap signalé, non comblé** : `Form` / `FormField` / `FormMessage`
sont à l'inventaire du document et n'existent pas ; les deux formulaires
composent donc à la main, comme `AuthForm` (s07) et `OrgSwitcher` (s15).

### 6.3 La configuration

`config/marketing.ts` gagne un bloc `forms`, validé par le même schéma Zod que
le reste (`docs/security.md` §4 : une configuration est une frontière) :

- `contactRecipient` — **le piège nommé par la story**. Adresse validée par
  `z.email()`, refusée en nommant la clé si elle est absente ou malformée ;
- `newsletterSource` — la valeur de la colonne `source`, en `kebab-case`. C'est
  elle que s42 changera pour la liste d'attente ;
- `rateLimit: { windowSeconds, maxPerClient, maxPerForm }` — les « seuils
  configurables » du §7.

### 6.4 Purge, export, rétention

`dataCategories: ['subscription', 'contact-message']`,
`retention: { subscription: 'erase', 'contact-message': 'erase' }` — une adresse
email **est** l'enregistrement, et un message de contact sans son expéditeur n'a
plus de réponse possible ; dans les deux cas l'anonymisation ne laisserait qu'une
ligne inutile.

`purge` et `export` reçoivent un `ModuleScope` qui ne porte qu'un identifiant
(`packages/core/src/module.ts`, `ModuleScope`). Le module ne peut pas résoudre
l'adresse d'un compte — il ne connaît pas `auth`, et lire la table d'un autre
module est interdit. Le point de composition de l'application lui injecte donc
`subscriberEmailOf(scope)`, construit sur `auth.useCases.viewAccount(userId)`
(`apps/web/lib/auth.ts:174-180`) — même patron que `reservedSlugs` pour les
organisations et `emailLocaleFor` pour `auth`. Périmètre organisation :
`null`, une inscription publique n'appartient à aucune organisation.

`public_form_throttle` n'est **pas** déclarée comme catégorie de données : sa
clé est un condensat SHA-256 de l'identifiant d'appelant, qu'aucune requête du
module ne peut relier à un compte, et rien d'autre n'y est stocké. C'est écrit
ici parce que c'est discutable, et parce que s28 héritera de la question.

**Ce que la revue a corrigé (constat F1)** : ces lignes étaient conservées
**indéfiniment**, ce qui rendait la faiblesse du condensat — SHA-256 non salé
d'une adresse IPv4, retrouvable par force brute — nettement plus gênante. Elles
ne survivent plus à leur fenêtre : `SubmissionThrottle.sweep` les efface à la
première soumission de la fenêtre suivante. La durée de conservation d'un
condensat d'adresse est donc bornée par `windowSeconds`, dix minutes dans la
configuration livrée.

## 7. Sections du socle de sécurité touchées

`docs/security.md` — **§4** (Zod à chaque frontière : corps de requête,
configuration ; requêtes paramétrées ; rendu échappé), **§5** (aucun secret dans
une réponse d'erreur ; l'adresse de destination vient de la configuration),
**§7** (limitation de débit partagée entre instances, anti-automatisation sur
formulaire public, aucune énumération et aucune différence de temps de réponse
observable). §1 est touchée **négativement** : rien de ce qui est ajouté ne
demande une source CSP ni un style en ligne — c'est une contrainte de
conception, vérifiée au navigateur sous le build de production.

`docs/reliability.md` — **§1** (idempotence : deux soumissions identiques, une
seule inscription, un seul email ; migration rejouée deux fois), **§2**
(dégradation : mailer en panne → l'inscription reste enregistrée, le contact
répond une erreur explicite ; aucune clé de fournisseur nécessaire en local),
**§4** (migration additive, jamais destructive).

## 8. Questions tranchées, et ce qui reste ouvert

**Tranché ici** (une décision de conception, pas d'ADR : aucune de ces
questions n'ouvre un choix structurant que `docs/decisions/` n'aurait pas déjà
réglé) :

1. limitation de débit livrée dans `marketing`, pas de port ni de module
   `ratelimit` — §1 ;
2. anti-automatisation = honeypot + seuils, pas de captcha — §2 ;
3. réponse newsletter identique dans les trois cas — §3 ;
4. `contact_message` livrée, avec la purge et l'export du contrat pour lecteurs
   — §6.1, tranché après la revue ;
5. `/contact` est une page publique déclarée, indexée — §6.2.

**Ouvert, à dire dans le rapport** :

- la coexistence avec s28 (§1), et la suppression de `public_form_throttle`
  qu'elle devra faire ;
- la falsifiabilité de `x-forwarded-for` hors d'un proxy de confiance (§1.1).
  **Elle n'est pas refermée ici** : la pile n'offre aucune adresse de pair
  fiable — Next ne pose `x-forwarded-for` que s'il est absent
  (`node_modules/next/dist/server/base-server.js`, `??=`), et un gestionnaire de
  route ne voit pas la socket. Ce qui a été fait à la place, c'est de retirer à
  cet en-tête tout pouvoir de nuisance sur autrui : le seau du formulaire
  **dégrade au lieu de refuser** (§1), si bien qu'un identifiant falsifié ne
  ferme le formulaire à personne. Dériver l'identifiant d'un nombre de sauts de
  proxy **configuré** reste la bonne réponse ; elle appartient à s28, qui possède
  la limitation de débit ;
- l'instabilité de parcours d'une exécution sur sept relevée en s45
  (`docs/STATE.md`), qui n'est pas de cette story mais qui peut la salir.
