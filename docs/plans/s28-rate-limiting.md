---
story: s28-rate-limiting
validated: yes
---
# Plan — Story s28-rate-limiting

Branch: `feature/s28-rate-limiting`
Research: `docs/research/s28-rate-limiting.md` — **à lire d'abord** : deux compteurs existent déjà, et s24 a laissé une consigne qu'il ne faut pas suivre à la lettre.
Pas de design : aucun écran neuf.

## Story visée

Complexité mesurée **4**. Socle **non désactivable** : optionnel, il laisserait
toute installation par défaut exposée sur la connexion, l'inscription et la
réinitialisation.

**28 routes publiques** à couvrir, dont **18 sur `auth`**, le module que le socle
rend non désactivable.

## Les quatre décisions que ce plan prend

**1. s28 fait converger et cesse d'écrire ; elle ne supprime rien.**

Le schéma de s24 dit « s28 devra la supprimer ». Le socle fiabilité dit « cesser
d'écrire avant de supprimer », et s27 vient de mesurer que le basculement n'est
pas instantané. Supprimer dans la même livraison casserait la version encore en
ligne, qui écrit toujours dans l'ancienne table.

`public_form_throttle` et `billing_checkout_throttle` restent donc en place,
vides et inertes. **Leur suppression est une story ultérieure**, et le plan
l'écrit pour que personne ne la fasse ici.

**2. Le magasin indisponible refuse (`fail closed`).**

Le socle dit « un tiers absent dégrade, il ne casse pas ». Mais ce magasin **est
la base de l'application** : si elle est absente, la connexion ne fonctionne pas
davantage — les sessions y vivent. Refuser ne coûte donc aucune disponibilité
réelle, alors que laisser passer ferait disparaître la protection exactement au
moment où l'application est fragile. C'est un cas où le socle ne s'applique pas,
et il faut l'écrire plutôt que de l'appliquer par réflexe.

**3. Le seuil par compte se compte sur l'adresse tentée, condensée.**

Le critère 1 exige la double limitation. L'adresse tentée peut ne correspondre à
aucun compte : compter dessus quand même est le seul moyen de ne pas révéler
quelles adresses existent. Le seau porte un **condensat**, comme les deux tables
existantes, dont le commentaire dit que « l'identifiant d'appelant n'entre jamais
en clair ».

**4. Le captcha est un port, désactivé par défaut, et l'activer coûte une
origine CSP assumée.**

L'ADR 027 refuse les origines tierces par défaut. Le captcha en ajoute une :
l'activer est donc un geste explicite du propriétaire, qui édite
`config/security.ts`. Désactivé, les formulaires restent pleinement
fonctionnels — c'est le critère 5.

## Tâches (ordonnées)

1. [x] **Le port de limitation** — le **quatrième** du dépôt
   (`packages/ports/src/`, qui n'a que `mailer`, `payments`, `storage`). Contrat
   hérité : **aucune méthode ne lève**, l'échec est une valeur discriminée.
   *Test* : le type force l'appelant à traiter l'échec.

2. [x] **L'implémentation PostgreSQL** (`AGENTS.md:159` : « rate limiting
   PostgreSQL »), avec une table `rate_limit_window` et un **condensat** de seau.
   Fenêtre fixe alignée, une écriture atomique — le motif de
   `marketing/domain/rate-limit.ts`, déjà éprouvé deux fois.
   *Test* : **le partage entre instances** (critère 7) — deux clients distincts
   contre le même magasin voient le même compteur. Mutation : un compteur en
   mémoire de processus doit rougir, comme s24 l'a mesuré (6 rouges).

3. [x] **Les seuils en configuration** (critère 4), dans `config/security.ts` —
   la limitation est de la sécurité, et le fichier existe déjà. Validés par Zod.
   *Test* : un seuil absurde (zéro, négatif) est refusé au démarrage, en le
   nommant.

4. [x] **La double limitation** (critère 1) : par appelant **et** par compte
   visé, sur la connexion. C'est le cœur sécurité de la story — un seuil par IP
   seule ne protège pas du bourrage d'identifiants, et `x-forwarded-for` est un
   en-tête que l'appelant écrit.
   *Test* : dix mille tentatives sur un compte depuis autant d'adresses
   distinctes **doivent être bloquées**. Mutation : retirer le seau par compte
   doit rougir.

5. [x] **429 avec `Retry-After`** (critère 1), cohérent avec la fenêtre réelle.
   *Test* : l'en-tête existe et sa valeur suit le seuil configuré — un
   `Retry-After` qui ment est pire que pas d'en-tête.

6. [x] **Faire converger les 28 points d'entrée** (critère 2) : inscription,
   réinitialisation, magic link, double authentification, invitation,
   formulaires publics, téléversement, checkout anonyme. **Cesser d'écrire** dans
   les deux anciennes tables (décision 1), sans les supprimer.
   *Test* : chaque point d'entrée nommé au critère 2 refuse au-delà du seuil.
   Vérifier le **compte** de points couverts, pas seulement qu'un l'est.

7. [x] **Un module coupé n'enregistre rien** (critère 3), sans erreur au
   démarrage. s26 a livré la dérivation registre → attendus ; la recette de
   profil minimal l'exercera.
   *Test* : registre sans `billing` — aucune limite de checkout enregistrée,
   aucun démarrage en erreur.

8. [x] **La journalisation du dépassement** (critère 6) avec l'IP et la route.
   Le **stockage** condense, la **journalisation** ne condense pas : les deux
   règles diffèrent, et le plan l'assume. Aucun secret dans le journal.
   *Test* : un dépassement journalise la route et l'appelant.

9. [x] **Le captcha optionnel** (critère 5, décision 4). Désactivé par défaut ;
   désactivé, les formulaires restent pleinement fonctionnels.
   *Test* : les deux états ; et l'activation sans origine CSP déclarée **refuse
   au démarrage** plutôt que de casser silencieusement le formulaire.

10. [x] **Neutralisable par injection, jamais par variable d'environnement**
    (critère 8). Ce dépôt a payé deux fois cette leçon cette session :
    `SKIP_ENV_VALIDATION` traversant un clone (s26), puis une image (s27).
    *Test* : **aucune variable d'environnement ne désactive la limitation** —
    le vérifier, pas l'affirmer.

11. [x] **Documentation.** `docs/security.md` §7 (que s24 a laissé avec un
    inventaire daté), les `AGENTS.md` des modules touchés, `docs/architecture.md`
    pour le quatrième port, et un **ADR** : la limitation devient un port, le
    magasin absent refuse, et deux tables sont abandonnées sans être supprimées.

## Interdits d'exécution

- **Ne supprimer ni `public_form_throttle` ni `billing_checkout_throttle`**
  (décision 1). Le diff de leur `pgTable` doit rester vide.
- **Ne pas laisser passer quand le magasin est indisponible** (décision 2).
- **Ne pas introduire de variable d'environnement qui désactive la limitation** —
  c'est le critère 8, et c'est une porte.
- **Ne pas stocker l'IP en clair** dans la table.
- **Ne pas ajouter d'origine à `config/security.ts`** pour le captcha : c'est le
  propriétaire qui l'ajoute, l'activation la **réclame**.
- **Ne pas écrire un second compteur** : le port est le seul.
- **Ne pas modifier les harnais de s25, s26, s27** ni les specs existantes.
- **Ne pas mettre `hashFiles` dans un `if:` de niveau job.**

## Le point sur lequel tout repose

**La double limitation, et le fait qu'elle soit prouvée sur le bon vecteur.**

Un seuil par IP est facile à écrire, il passera tous les tests évidents, et il ne
protège pas de l'attaque réelle : le bourrage d'identifiants distribué. Dix mille
adresses, un essai chacune, sur le même compte — chaque IP reste sous son seuil,
et le compte tombe.

Le test doit donc simuler **la distribution**, pas la répétition. Un test qui
frappe cent fois depuis la même IP est vert avec un code qui ne protège rien.

Trois endroits où ce plan peut être faux :

1. **Le seau par compte peut fuir l'existence d'un compte.** Si une adresse
   inconnue n'est pas comptée, l'attaquant apprend lesquelles existent. À
   comparer avec la règle du socle : identifiant inconnu et mot de passe erroné
   sont indiscernables, en message **et en temps**.
2. **`Retry-After` peut mentir.** Une valeur figée pendant que la fenêtre est
   glissante donne une information fausse, et un client honnête réessaie trop tôt.
3. **La convergence peut en oublier.** 28 routes, 18 dans un seul module. Compter
   ce qui est couvert et assertionner le compte est la seule protection — s26 a
   établi le motif.

## Fichiers touchés (anticipé)

| Fichier | Nature |
|---|---|
| `packages/ports/src/rate-limit.ts` | le quatrième port |
| `packages/adapters/…` | implémentation PostgreSQL |
| `config/security.ts` | les seuils |
| `packages/modules/auth/src/presentation/auth-routes.ts` | 18 points d'entrée |
| `packages/modules/{billing,marketing,storage,organizations}/…` | convergence |
| `tests/rate-limiting.test.ts` | critères 1 à 8 |
| `docs/decisions/050-*.md` | ADR |
| `docs/security.md`, `docs/architecture.md`, `AGENTS.md` | docs |

## Stratégie de test

| Niveau | Ce qu'il couvre |
|---|---|
| domaine | fenêtre, seuils, `Retry-After` — pur |
| `tests/rate-limiting.test.ts` | la double limitation, le partage entre instances, les 28 points, le module coupé, la journalisation |
| mutation | **cinq** : seau par compte retiré ; compteur en mémoire ; magasin absent laissant passer ; variable d'environnement désactivant ; un point d'entrée non couvert |
| e2e | une connexion réellement bloquée après N tentatives |

## Definition of Done

- Les huit critères vérifiés, chacun par un test nommé.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` verts.
- Les **cinq** mutations vérifiées rouges, dont celle du bourrage distribué.
- Les deux anciennes tables **présentes et inertes**, leur abandon documenté.
- `actionlint` vert.
- Un seul commit, message impératif en français, portant recherche, plan et ADR.


## Note d'exécution (écrite pendant `/ks-execute`, pas au plan)

Cinq écarts, un manque nommé, et **une régression que cette story a introduite
puis corrigée** — pas une panne préexistante : voir la rectification plus bas.
Une seconde passe, après la revue bloquante, a corrigé un constat critique
(le balayage devenu global) et trois majeurs.

**Écart 1 — la table appartient à un module, pas à un paquet d'adapter.** Le plan
anticipait `packages/adapters/…`. Le dépôt n'a qu'un mécanisme pour qu'une table
ait un propriétaire, une migration et un journal de migration : le contrat de
module. Un `packages/adapters/postgres` aurait exigé un second chemin de
migration, non éprouvé, à côté de celui qui l'est. Le module `rate-limit` a donc
été **généré** (`ks scaffold`, appelé programmatiquement — la garde git de la
commande refuse un arbre modifié) et ajouté au **socle non désactivable**. Écrit
dans l'ADR 050 et dans `packages/modules/rate-limit/AGENTS.md`.

**Écart 2 — le refus vit au répartiteur, et il est fail-closed.** Le plan ne
disait pas où la limitation s'applique. Elle est dans `dispatchModuleRequest`,
**dérivée du registre** : toute route `public`, plus toute route qui déclare un
`rateLimit`. Sans garde injecté, une route limitée répond 429. La contrepartie a
été payée : chaque suite qui sert une route publique injecte désormais un garde
permissif (`tests/fixtures/rate-limit.ts`).

**Écart 3 — les deux modules gardent leur règle, pas leur compteur.**
`marketing` et `billing` portent chacun une **dégradation** que le répartiteur ne
sait pas exprimer (suspendre l'envoi sortant ; repartir par la connexion). Leur
règle reste donc chez eux ; seul le compteur a convergé. Les deux tables ne sont
plus écrites et ne sont pas supprimées, conformément à la décision 1.

**Manque nommé — le captcha n'est pas branché.** `config/security.ts` le déclare
coupé, le démarrage refuse de l'activer sans son origine dans la politique de
sécurité du contenu, et aucun module ne le mentionne. Mais **aucun fournisseur
n'est livré** : le critère 5 est tenu du côté « désactivé, les formulaires restent
pleinement fonctionnels », pas du côté « peut être activé ». C'est un manque, pas
une fonctionnalité.

**Écart 4 — un défaut latent de `@repo/db`, ouvert par cette story et corrigé
ici.** `apps/web/lib/rate-limit.ts` importe `@repo/db`, et `lib/startup.ts`
l'atteint : `composeSchema` s'exécute donc pour la première fois sous le chargeur
de `next.config.ts`. Là, le baril généré d'un module **sans table** (`export {}`)
se matérialise en `{ default: …, __esModule: true }` au lieu d'un espace de noms
vide — mesuré en instrumentant `composeSchema` pendant `pnpm build`. Prises pour
des tables, ces clés faisaient entrer `consent` et `i18n` en collision et
**cassaient `pnpm build`** ; avec un seul baril vide, elles entraient
silencieusement dans `appSchema`. Le correctif est dans `@repo/db`, là où vit le
défaut, avec trois cas dans `tests/migrations.test.ts`.

**Rectification.** Une première version de cette note disait la panne
« préexistante sur `dev` ». **C'était faux**, et la mesure qui l'appuyait était
viciée : elle restaurait le `generated/schema/index.ts` de `HEAD` dans un arbre
qui contenait déjà le nouveau module et le nouvel import — un état mixte, pas
`dev`. Sur `dev`, `pnpm build` sort en 0. La régression venait bien de cette
story.

**Écart 5 — les seuils par appelant ont été élargis après mesure.** Le premier
jeu livré (5 inscriptions par heure et par appelant) a fait échouer **26 parcours
sur 92** : toutes les requêtes viennent de `::1`, comme elles viennent d'une seule
adresse pour toute installation qu'aucun proxy ne précède. Ce n'était pas un
défaut du harnais, c'était le comportement qu'aurait eu le produit. Les seuils par
**compte visé** — là où vit la sécurité — n'ont pas bougé.

**Livré en plus du plan** : `e2e/rate-limiting.spec.ts`, le cas que la stratégie
de test annonçait — une connexion réellement bloquée après N tentatives, contre
l'application démarrée et le vrai PostgreSQL, avec une adresse d'appelant
distincte par tentative pour que ce soit le seau **par compte** qui refuse.


## Seconde passe — ce que la revue bloquante a fait corriger

**C1 (critical) — le balayage devenu global détruisait des seaux encore ouverts.**
`sweep(before)` effaçait toute ligne antérieure à une borne choisie par
l'appelant. La table étant partagée depuis cette story, le balayage de
`marketing` (fenêtre 600 s) remettait à zéro les seaux **horaires** de
`signUp`, `passwordReset`, `magicLink`, `emailVerification` et `invitation` —
tous à cinq par heure. Déclenchable à distance : le balayage part à la première
soumission de chaque fenêtre, et la limitation s'exécute avant toute validation,
donc un **POST vide** suffisait. « 5 par heure » devenait « 5 par dix minutes ».

Corrigé **au contrat**, comme la revue le demandait : chaque ligne porte son
`expires_at`, et `sweep(now)` ne fait plus que comparer à l'instant présent. Un
instant passé ne peut donc que retarder la récupération, jamais effacer un seau
ouvert. La migration a été **régénérée en une seule** — la table n'existe nulle
part en ligne, aucune version ne l'écrit.

**M1 — rien ne balayait dans une configuration valide.** Les deux seuls appelants
étaient dans des modules optionnels. Le garde balaie désormais lui-même, au plus
une fois par intervalle, et il est sur le chemin de toute route limitée ; le
module déclare en plus une tâche planifiée pour l'ordonnanceur de s33.

**M2 — la garantie 2FA était fausse.** `config/security.ts` disait que le seuil
empêchait de parcourir le million de codes, alors que `twoFactor` n'avait que le
seau d'appelant, contournable par en-tête. La route porte maintenant un
`subjectCookie` sur le cookie de défi — posé et signé par le serveur —, et
`maxPerSubject: 10`. Les autres politiques sans seau par compte disent
désormais **ce qui les protège réellement**. `docs/deployment.md` gagne une
section sur le proxy de confiance, avec les trois modes d'échec sans lui et la
configuration Traefik/nginx/Caddy.

**M3 — cinq fichiers portaient encore « s28 supprimera la table ».** Corrigés,
et la règle est devenue **exécutable** : aucun source de production ne peut plus
porter cette consigne, les citations entre guillemets exceptées.

**Mineurs** : le balayage anti-échappatoire est **dérivé du disque** et doublé
d'une recherche d'interrupteur dans toutes les sources ; les deux affirmations
d'exhaustivité sont corrigées ; le résumé de cette note aussi ; « un magasin muet
refuse » est éprouvé aux deux throttles de module ; l'exception `/api/health` est
nommée.


## Troisième passe — la re-revue

**C1 (critical) — le seau de défi 2FA se contournait par un leurre de cookie.**
`subjectOfCookie` retenait le **premier** couple dont le nom se **terminait** par
le suffixe, alors que l'en-tête `Cookie` est écrit intégralement par l'appelant
et que la bibliothèque lit un **nom exact**. Un
`two_factor=<compteur>` posé en tête suffisait : le limiteur comptait le leurre,
le serveur validait le vrai défi, et les six chiffres redevenaient énumérables
sans borne — 401×20 sans un seul 429. Ce qui en faisait un critique plutôt qu'un
majeur : le diff livrait la garantie **inverse** en quatre endroits, dont un
tableau de `docs/security.md` avec `pnpm test` en colonne d'échec.

Corrigé par la première des deux voies proposées, doublée de la seconde :
lecture par **noms exacts** déclarés à la route
(`TWO_FACTOR_CHALLENGE_COOKIES`, dans le domaine de `auth`), et **refus** quand
la requête en présente plus d'un — le nom réel dépend de `useSecureCookies`, que
la déclaration de route ne connaît pas. Le leurre est posé **en tête** dans deux
cas, au répartiteur et contre l'application démarrée ; les quatre affirmations
écrites disent maintenant ce qui est tenu, et par quelle commande.

**M1 — `pnpm test:e2e` se coupait lui-même au troisième passage de l'heure.** Le
préambule Playwright vide `rate_limit_window`, avec la raison écrite, et
`AGENTS.md` enregistre ce troisième mode d'échec. Vérifié : trois passages
d'affilée verts ; sans le nettoyage, le deuxième échoue déjà et le troisième
tombe à 53 parcours.

**Mineurs** : l'exclusion de citation de la règle M3 est réduite à **une chaîne
exacte**, et son existence est elle-même assertionnée ; les contrats de
`marketing` et `billing` disent désormais « **leur propre** fenêtre » et
`sweep(now)` ; les cinq routes hors répartiteur sont nommées avec leur raison et
leur **compte** est assertionné ; `billing` fait voyager `max` avec le seau.

**Non corrigé, et pourquoi** : `tests/billing.test.ts:5605` est instable une fois
sur six sur un compte global de `auth_session`. La revue le dit non imputable à
s28 ; le corriger demanderait de rendre cette assertion locale au périmètre du
cas, ce qui est un changement de la suite de s19 et n'appartient pas à cette
story.


## Quatrième passe — la troisième revue (`Ship allowed: yes`, majeur ouvert)

La porte était franchie ; ces correctifs ferment ce qui restait ouvert, parce
qu'une **fausse garantie de sécurité écrite en cinq endroits** est exactement ce
que ce dépôt se fait relire comme vérifié.

**M1 (majeur) — le limiteur et la bibliothèque lisaient le même nom, pas la même
valeur.** Le serveur lit `parsedCookies.get(nom)`
(`better-call@1.4.0/dist/context.mjs:38` → `dist/cookies.mjs:19-40`) : valeur
détrimée, guillemets encadrants retirés, `decodeURIComponent` dès qu'il y a un
`%`. Le limiteur prenait la sous-chaîne brute, puis la mettait en minuscules pour
sa clé — une **troisième** normalisation. Le même défi ré-encodé ouvrait donc un
seau neuf à chaque essai (401×15 sous quinze encodages, contre 401×10 puis 429×5
sur la valeur brute).

Les **deux** voies de la revue ont été prises, comme elle le demandait :

1. `subjectOfCookies` refait les trois gestes de la bibliothèque, dans cet ordre,
   et **ne lève jamais** — `decodeURIComponent('%zz')` lève, et l'en-tête vient
   de l'attaquant : une exception serait un 500 sur une route publique. Le
   `toLowerCase()` des sujets de cookie disparaît ; la normalisation appartient
   au **lecteur**, et `subjectBucketKey` ne touche plus à rien ;
2. `twoFactor.maxPerSubject` passe de **10 à 4**, sous les cinq essais par défi
   que `better-auth@1.7.2` s'impose déjà (`beginAttempt(5)` dans
   `dist/plugins/two-factor/totp/index.mjs` et
   `dist/plugins/two-factor/backup-codes/index.mjs`, défi détruit par
   `dist/plugins/two-factor/verify-two-factor.mjs`). À dix, ce seuil ne pouvait
   **jamais** mordre le premier sur un défi authentique : la garantie écrite
   reposait en silence sur une dépendance. Le plafond de la bibliothèque est
   nommé comme second filet — et il ne compte **rien** sur un défi fabriqué, que
   seul le seau de ce dépôt borne.

Les cinq endroits disent désormais ce qui est tenu : `config/security.ts`,
`docs/security.md` §7 (deux lignes de plus dans le tableau, chacune avec sa
commande), `packages/core/src/module.ts`,
`packages/modules/rate-limit/AGENTS.md`, et — l'ADR étant **immuable** —
l'**ADR 051**, qui supersède la seule clause 2FA de l'ADR 050 et laisse le reste
en vigueur.

**m1** — `packages/ports/AGENTS.md` ignorait le quatrième port : il a sa section
(« son échec refuse au lieu de dégrader », « pas de mode local parce qu'il n'a
pas de clé », « `sweep(now)`, jamais une borne »), sa ligne dans le tableau de la
forme du journal, et la ligne « une panne de tiers dégrade » porte l'exception.
La règle est **exécutable** : `tests/agents-md.test.ts` dérive du disque les
fichiers de `packages/ports/src` et exige que chacun soit nommé.

**m2** — la ligne du balayage anti-échappatoire de `docs/security.md` ne décrit
plus « les onze fichiers », mais ce qui est balayé et comment (dérivé du disque,
plancher assertionné).

**m3** — la politique `webhook` : décision écrite plutôt que sous-entendue, en
trois endroits (`config/security.ts`, `docs/deployment.md` du point de vue du
**fournisseur** et non du visiteur, `tests/rate-limiting.test.ts`). Hors proxy de
confiance, Stripe partage le seau `unknown` ; c'est assumé — cela dégrade, le
rejeu est idempotent par identifiant d'événement, la signature reste vérifiée
avant tout effet, la vraie réponse est le relais. Ce qu'une commande peut tenir
l'est : la politique du webhook est **la plus large de toutes**, en passages par
minute, donc le tiers n'est jamais le premier refusé.

**nit** — `expect(dispatcher.length).toBeGreaterThanOrEqual(1)` disait moins que
son propre commentaire : l'assertion vaut **2**, comme la phrase.

**m4, toujours non corrigé et toujours écrit** : `tests/billing.test.ts:5605` est
un delta global de `auth_session`, instable à cause d'autres fichiers qui ouvrent
des sessions contre la même base. La revue a confirmé que le laisser est le bon
arbitrage tant qu'il reste écrit ici.

**Écart de forme assumé** : l'en-tête de `packages/ports/AGENTS.md` portait,
depuis avant cette story, deux moitiés de phrase fusionnées et illisibles. La
règle dérivée ci-dessus imposait d'y nommer chaque fichier de capacité ; le
paragraphe a donc été récrit d'un bloc plutôt que rapiécé.


## Cinquième passe — le majeur ouvert par la quatrième, et trois mineurs

La porte était franchie (`Max severity: major`, `Ship allowed: yes`). Cette
passe ferme le majeur né du correctif précédent — deux rondes de suite ont
produit un majeur issu de la ronde d'avant — et n'élargit rien d'autre.

**M1 (majeur) — le 429 arrivait à l'utilisateur habillé en « votre saisie est
fautive ».** Le répartiteur refuse **avant** le gestionnaire : `twoFactorRefusal`
n'est jamais appelé, et le corps du refus est `{"error":"rate_limited"}`. Les
deux formulaires d'authentification le repliaient sur leur message de saisie
fautive — « Ce code n'est pas valide. » et « Demande invalide. Vérifiez les
informations saisies. ». À `maxPerSubject: 10`, ce chemin était hors d'atteinte
sur un défi authentique ; à 4, c'est le **premier** refus qu'un utilisateur
légitime rencontre.

Le motif existant a été **étendu, pas réinventé** : `app/public-form.tsx` porte
la classe `throttled` depuis s11, et l'affordance rendue est celle que chaque
formulaire rendait déjà (`Alert` du design system pour la 2FA, `<p role="alert">`
pour `auth-form.tsx`). **Aucun composant, aucun jeton, aucune couleur nouvelle** —
la seule variante employée, `warning`, est celle que `public-form.tsx` emploie
déjà pour ce même refus. Rien à signaler comme manque du design system.

**La décision sur `Retry-After`, écrite parce qu'elle se relira** : l'attente est
**affichée**, elle vient de l'**en-tête** de la réponse et de nulle part ailleurs
(`app/refusal-message.ts`), et elle est arrondie **à la minute supérieure** —
les fenêtres livrées vont de 60 s à 3 600 s, « réessayez dans 3 542 secondes »
est illisible, et arrondir vers le bas ferait réessayer trop tôt. Un en-tête
absent ou illisible n'affiche **aucun** chiffre, dans la formulation de s11 :
deux clés par formulaire plutôt qu'une valeur sentinelle. Les quatre clés
nouvelles sont livrées dans **chacune des locales que `config/i18n.ts` déclare**
(`fr`, `en` — la liste est dérivée de ce fichier, pas supposée), et
`tests/i18n.test.ts` le tient déjà pour toute clé citée par un écran.

Deux commandes tiennent le correctif, et elles ne disent pas la même chose :
`tests/rate-limiting.test.ts` tient la **classification** (le 429 ne retombe pas
dans le repli, et l'attente vient de l'en-tête), `e2e/rate-limiting.spec.ts` tient
ce que l'**écran affiche** — deux formulaires rendus dans un navigateur, contre
l'application démarrée et le vrai PostgreSQL. Aucun test de nœud ne peut voir le
second : le message n'existe qu'après une soumission, donc après hydratation.

**m1 — il y a trois plafonds sur l'énumération 2FA, pas deux.** Vérifié dans la
bibliothèque installée : `verify-two-factor.mjs` porte aussi
`assertTwoFactorNotLocked` / `recordTwoFactorFailure`, appelés **à la connexion
seulement** (`if (isSignIn)`) par les deux facteurs, et
`resolveAccountLockoutConfig` vaut par défaut actif / 10 vérifications / 900 s ;
ce dépôt ne configure pas `accountLockout`. C'est un axe **par compte**, en
travers des défis et des facteurs. Le paragraphe de
`packages/modules/rate-limit/AGENTS.md` dit désormais ce qui a été **balayé**
(`config/security.ts` et trois fichiers de la bibliothèque) plutôt qu'un compte
présenté comme complet, et les trois valeurs sont **dérivées de la bibliothèque
installée** par `tests/rate-limiting.test.ts` : une montée de version, une
configuration qui les écrase ou un paragraphe qui les oublie fait rougir
`pnpm test`. Ce que le cas ne prouve pas est écrit dans les deux fichiers : le
verrouillage est **lu**, jamais exercé.

**m2 — la phrase a été ramenée à ce que la commande tient**, plutôt que l'inverse.
`tests/agents-md.test.ts` n'exige que la présence du **nom de fichier** ; exiger
« une section, une ligne au tableau du journal, une exception au socle » demandait
d'inventer une forme de section détectable, c'est-à-dire une règle de mise en page
qui rougirait sur une reformulation légitime. `packages/ports/AGENTS.md` distingue
donc explicitement ce que la commande tient de ce qui reste à l'auteur.

**m3 — la puce de l'ADR 050 est corrigée.** L'argument d'immuabilité était le plus
faible des deux : `git diff dev...HEAD -- docs/decisions/` montre que l'ADR 050
est **créé par ce commit**, donc jamais posé sur la branche par défaut.

**nit** — l'en-tête de l'ADR 051 range `Supersedes` en dernier, comme les ADR 011
et 025.

**m4 — reporté, et connu instable.** `tests/billing.test.ts` (le cas « la page de
retour d'un paiement invité n'ouvre aucune session ») a rougi **une fois sur cinq
passages complets** au commit `6559b60` : `expected 1 to be +0`. La ronde 3 le
disait « reporté et stable » sur trois passages ; sur cinq, c'est **reporté et qui
tire**. L'assertion est un **delta global** de `auth_session` mesuré à travers un
rendu de page, donc sensible à tout autre fichier qui ouvre une session contre la
même base ; elle existe telle quelle sur `dev` et `tests/rate-limiting.test.ts`
ne crée aucune session. **Ce qui n'est pas connu** : le déclencheur. L'attribuer
demanderait de faire tourner la suite sur `dev`, ce qui n'appartient pas à cette
story — et le corriger demanderait de rendre l'assertion locale au périmètre du
cas, c'est-à-dire de changer la suite de s19.

**Aucun écart au périmètre demandé.** Rien n'a été corrigé en dehors de M1, m1,
m2, m3 et du nit, et la note ci-dessus est la seule chose écrite pour m4.
