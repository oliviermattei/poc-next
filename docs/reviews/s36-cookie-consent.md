# Revue — s36-cookie-consent

Branche `feature/s36-cookie-consent`, commit unique `8448788`, diff
`git diff dev...feature/s36-cookie-consent` (64 fichiers, +3987/−26).
Worktree `.claude/worktrees/agent-a03ce552e3284efff`.

Tout ce qui suit a été **exécuté**, jamais lu dans un compte rendu. Les
mutations sont posées à l'endroit exact du défaut qu'elles prétendent
démontrer, et l'arbre a été prouvé propre (`git diff --exit-code`) avant
l'écriture de cette ligne.

## 1. Ce qui a été exécuté

### Configuration livrée (module `marketing` activé)

| Commande | Résultat |
|---|---|
| `pnpm typecheck --force` | 20/20 |
| `pnpm lint --max-warnings=0` | vert |
| `pnpm test` | 39 fichiers, **1308 passés**, 2 ignorés |
| `E2E_PORT=3136 pnpm test:e2e` | **73 passés**, 6 ignorés |
| `pnpm build --force` | vert (`/cookies` et `/api/consent-probe/[script]` présents) |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert |

### Après `pnpm ks toggle marketing` (site public coupé)

| Commande | Résultat |
|---|---|
| `pnpm typecheck --force` | 20/20 |
| `pnpm lint --max-warnings=0` | vert |
| `pnpm test` | **1308 passés** |
| `E2E_PORT=3136 pnpm test:e2e` | **68 passés**, 11 ignorés — dont **les six parcours de `e2e/consent.spec.ts`**, y compris « le retrait depuis les paramètres de compte empêche le chargement suivant » |
| `pnpm build --force` | vert |
| `pnpm run audit` | idem |

Module `marketing` remis en marche par `pnpm ks toggle marketing`, arbre
vérifié propre.

## 2. Les mutations, et le rouge observé

Chaque mutation est posée dans le fichier qui porte la règle, jamais à côté.

| # | Mutation, à l'endroit exact | Rouge |
|---|---|---|
| A | `consent-category.ts:99` — `allowedScripts: scripts` (tout est autorisé quelle que soit la décision) | **6 tests**, 3 fichiers ; et **3 parcours sur 6** de `e2e/consent.spec.ts` |
| B | `consent-cookie.ts:109` — `'HttpOnly'` retiré de l'en-tête | **1 test** |
| C | `request-guard.ts:50` — `return true` (toute origine acceptée) | **3 tests**, 2 fichiers |
| D | `apps/web/app/account/page.tsx:296` — la carte de compte retirée | **1 test**, en configuration livrée **et** après `ks toggle marketing` |
| E | `apps/web/lib/consent.ts:163` — `consentFooterLinks` rend `[]` | **1 test** |
| F | `apps/web/lib/consent.ts:85` — drapeau de sonde toujours vrai | **4 tests** |

Les deux invariants que la story existe pour tenir mordent donc dans les deux
sens : ce qu'un script obtient (A), et **les deux points d'accès** (D et E), D
étant vérifié dans la configuration où il est le seul recours.

Constat sur B : seul le test du module rougit. `tests/i18n.test.ts`
(« aucun cookie ne part sans les attributs du socle ») balaie les `Set-Cookie`
du proxy et ne voit pas ceux d'une route de module. Le filet existe, il est
simplement plus étroit que son nom — signalé, non bloquant.

## 3. La politique de sécurité du contenu, mesurée

L'implémenteur affirme que `'strict-dynamic'` fait ignorer `'self'` aux
navigateurs CSP 3, et que le nonce est donc obligatoire. **Vérifié, sous le
build de production**, pas sur parole.

- `apps/web/lib/security-headers.ts:110` porte bien `'strict-dynamic'`, sans
  condition de mode ;
- en-tête servi par `next start` : `script-src 'self' 'nonce-…' 'strict-dynamic'` ;
- cookie `app_consent=v=1&analytics=1` posé : la balise servie est
  `<script src="/api/consent-probe/demo-analytics" defer nonce="…">`, le nonce
  **égal** à l'en-tête `x-nonce` de la même réponse ; le script est demandé et
  **exécuté** (`window.__consentProbe === ['demo-analytics']`), aucune violation
  console ;
- **mutation posée à l'endroit exact** (`consent-scripts.tsx:51`, nonce forcé à
  `undefined`), rebuild de production, remesure : le script est demandé et
  **n'exécute rien**, la console dit mot pour mot
  « *Note that 'strict-dynamic' is present, so host-based allowlisting is
  disabled* ». Fichier restauré, `git diff --exit-code` vert.

L'affirmation est donc exacte, et le nonce est porteur. Aucun script injecté
n'y échappe : `ConsentScripts` est le seul point d'injection, il n'y a aucun
script en ligne dans le module, et `e2e/security-headers.spec.ts` (« le HTML
servi ne porte ni style en ligne ni script sans nonce ») reste vert.

**Corollaire non tenu ailleurs** : voir le constat R2.

## 4. Le cookie, la route

Mesurés sur le serveur de production, pas déduits :

```
set-cookie: app_consent=v=1&analytics=1&advertising=1; Path=/;
            Max-Age=15724800; HttpOnly; Secure; SameSite=Lax
```

Six mois (182 j), les trois attributs du socle, `Path=/`. Le cookie n'est
lisible par aucun script de page — donc pas par le script même qu'il autorise.
Réponse `303`, `location` réduit à un chemin d'une seule barre oblique
(`safeReturnPath`, balayé sur `//evil.test`, `\\evil.test`, l'URL absolue et
`javascript:`). Rejeu : la route est un `POST` idempotent en effet — la même
soumission repose le même cookie et rien d'autre, aucune écriture, aucune
migration, aucun journal.

Origine étrangère (`Origin: https://evil.test`) : **403, sans `Set-Cookie`**,
la garde passant avant toute lecture du corps. Vérifié au navigateur
(`e2e/consent.spec.ts:209`) et au serveur de production.

## 5. Ce que le navigateur a réellement émis

Sous `pnpm build --force` puis `next start`, en production :

- **avant tout choix** : la bannière est là, `grep consent-probe` sur le HTML
  servi rend **0** — aucune balise, donc aucune requête, donc aucune adresse IP
  partie. C'est le piège nommé par la story, et il est fermé au **rendu du
  serveur**, ce qui est plus fort qu'un script bridé ;
- **après un refus** : rien n'est demandé ni exécuté, et la bannière ne revient
  pas au rechargement (`e2e/consent.spec.ts:86`) ;
- **après une acceptation partielle** : `requested === ['demo-analytics']` et
  `executed === ['demo-analytics']` — la catégorie refusée ne produit **aucune**
  balise ;
- **sans JavaScript** (`javaScriptEnabled: false`) : la bannière refuse, et
  l'écran de préférences accorde une catégorie et l'enregistre. Les deux sens
  sont donc exercés script coupé, l'un par la bannière, l'autre par l'écran.

**Refuser n'est pas plus long qu'accepter** : les deux boutons de la bannière
sont dans le même `<form>`, même composant `Button`, même variante, même taille,
et `CookieBanner` **n'expose aucune variante par bouton** — un appelant ne peut
pas rendre le refus discret. « Tout refuser » est en outre placé **avant**
« Tout accepter ». Sur l'écran de préférences, « Enregistrer » porte la variante
principale et les deux raccourcis partagent `secondary`. Le choix est révocable
à tout moment depuis `/cookies`, un clic depuis le pied de page ou la carte de
compte.

## 6. La réserve `pb-64 md:pb-36`

Mesurée au navigateur, build de production :

| Largeur | Hauteur réelle de la bannière | Réserve |
|---|---|---|
| 390 px | 241 px | 256 px (`pb-64`) |
| 1280 px | 121 px | 144 px (`pb-36`) |

Les **quatre** liens du pied de page marketing — dont « Cookies » — sont
atteignables et non couverts aux deux largeurs. La bannière ne masque donc rien
d'utilisable, et elle n'est pas modale (`role="region"`, pas de piège de focus,
pas de voile).

**Aucune attente existante n'a été relâchée** : le diff ne touche **aucun**
fichier de `e2e/` autre que le `consent.spec.ts` neuf, et aucun `expect` des 67
parcours antérieurs. La réserve est bien une correction du produit, pas du
filet.

## 7. Le diff contre le plan

Les douze tâches sont faites. Écarts, tous consignés par l'implémenteur dans le
plan lui-même — ce qui est la bonne façon de les porter :

1. **`playwright.config.ts`** reçoit une ligne, `CONSENT_SCRIPT_PROBE: '1'`, et
   son commentaire. **Le bon arbitrage** : l'alternative interdite par la même
   consigne était le `.env` d'un poste, et c'est exactement ce que la fusion de
   s18 a payé. La ligne suit à la lettre le patron des quatre variables déjà
   posées là (`I18N_MISSING_KEY_PROBE`, `OAUTH_LOCAL_PROVIDER`,
   `STORAGE_LOCAL_DIRECTORY`, `EMAIL_LOCAL_CAPTURE`) ; ni le port, ni `retries`,
   ni `reuseExistingServer` ne bougent. Vérifié ligne à ligne.
2. **Le nonce** : hors plan, trouvé par mesure, et la mesure est juste (§3).
3. **La réserve** : hors plan, et justifiée par une mesure reproductible (§6).
4. **Deux ADR** au lieu d'un : 035 et 036, tous deux `accepted`, tous deux avec
   leurs options rejetées. Aucun ne contredit un ADR antérieur ; 036 est
   cohérent avec ADR 007 (contrat fermé) et reprend le patron des six points de
   composition existants.
5. **Trois fichiers de test** : `domain/consent.test.ts` (règles pures),
   `tests/consent.test.ts` (ce qui traverse), `e2e/consent.spec.ts`. Conforme à
   la règle des deux emplacements + `e2e/`.
6. Doublures de contexte de requête dans deux suites existantes : vérifiées,
   elles doublent `currentConsent` et — pour `rendered-text` seulement — la
   liste des scripts, en gardant `consent.available` réel. Le précédent invoqué
   (`oauthProviders`) existe bien au-dessus, dans le même fichier.
7. `lib/organizations.ts` importe une **constante** du module, pas une décision.

Dérive résiduelle, sans conséquence : le plan nommait
`application/consent-service.ts`, le code livre
`application/consent-use-cases.ts`.

Toutes les importations et signatures du diff ont été ouvertes et vérifiées :
`MODULE_ROUTE_PREFIX` (`packages/core/src/registry.ts:158`), `defineModule`,
`buildRegistry`, `dispatchModuleRequest`, `z.partialRecord`, `URL.canParse`,
`Checkbox`/`CookieBanner` (inventoriés par `docs/design-system.md` lignes 115 et
142 — **rien d'inventé hors système**), `CONSENT_SCRIPT_PROBE_ENABLED`,
`FIXTURE_CONSENT_SCRIPTS`. Aucune référence hallucinée trouvée, sur ces onze
cibles.

## 8. Les tests, lus comme du code de production

Pas de test décoratif trouvé dans ce diff : aucune assertion sur une classe
CSS, aucune structure DOM assertée pour elle-même, aucun inventaire de
composant, aucun écho de propriété. Les assertions portent sur des
comportements — ce qu'un script obtient, ce qu'un cookie vaut, ce qu'une origine
étrangère obtient, ce qu'un point d'accès rend. Les attentes de
`tests/consent.test.ts` sont **dérivées** de l'état du module `marketing` et de
`localeRouting.publicPath`, jamais recopiées ; c'est ce qui rend le fichier
rejouable dans les deux configurations, et c'est ce qui a été fait.

Le seul test qui pouvait n'être qu'une tautologie — « le module est monté » —
dérive de `config/features.ts` et du registre, donc reste vrai quelle que soit
la liste. Acceptable.

## 9. Socles et ADR

- **`docs/security.md` §1** : trois attributs mesurés sur l'en-tête réel (§4).
- **§4** : Zod à trois frontières — corps de soumission, valeur du cookie,
  segment de route de la sonde ; liste blanche de forme sur le retour.
- **§7** : la réponse d'erreur est `{ error: 'invalid_request' }`, identique en
  400 et 403, et ne dit rien de ce que le produit déclare.
- **`docs/reliability.md` §2** : sans le drapeau, aucun script déclaré, aucune
  bannière, aucun cookie, sonde en 404 — dégradation, pas casse. Opt-in
  explicite (`CONSENT_SCRIPT_PROBE=1`), jamais déduit de `NODE_ENV`. Le module
  n'appelle aucun tiers, donc pas de délai d'attente à déclarer.
- **ADR 006** : `domain/` sans React ni ORM ; `presentation/` seul importe
  `@repo/ui` et `react`. `pnpm lint` vert.
- **ADR 024** : second point d'entrée `@repo/module-consent/presentation`, le
  barril principal ne réexporte aucun `.tsx`. `@repo/db` typecheck vert.
- **ADR 007** : quatorze clés remplies, aucune ajoutée.
- **ADR 013** : un `AGENTS.md` par package neuf, avec les trois sections ; aucune
  revendication d'exhaustivité relevée dans les fichiers neufs (la section
  « garde d'origine » écrit « quatre cas, énumérés dans… », ce qui est la bonne
  forme).
- **Cimetière du PRD** : rien de réintroduit — pas d'eject, pas de table, pas de
  seconde implémentation de port, pas de commande de nettoyage.

## Constats

### C1 — major — `Origin: null` est accepté, et la justification écrite est fausse

`packages/modules/consent/src/domain/request-guard.ts:42-51`.

La garde retient `hostOf(origin) ?? hostOf(referer)`, et `hostOf` rend `null`
pour une valeur qui n'est pas une URL — donc pour l'en-tête `Origin: null`, qui
est une valeur **présente et légale**. La requête retombe alors sur la branche
« aucun des deux en-têtes », qui accepte.

Mesuré sur le serveur de production :

```
POST /api/modules/consent/decide   Origin: null   (aucun Referer)
→ 303, set-cookie: app_consent=v=1&analytics=1&advertising=1; …
```

Un consentement complet est donc **forgé** par une requête qui n'a pas prouvé
son origine. Or `Origin: null` est précisément ce qu'un attaquant obtient sans
effort : `<iframe sandbox="allow-forms">`, un document `data:`, ou une chaîne de
redirections inter-origines. La justification écrite en trois endroits
(`request-guard.ts:36-40`, `consent.test.ts:217-223`,
`packages/modules/consent/AGENTS.md`, section « Ce que la garde couvre ») dit :

> « un attaquant ne peut pas faire retirer `Origin` au navigateur d'une
> victime : refuser ici ne fermerait aucune attaque »

C'est **faux au sens strict**, et c'est mesurable : il ne le retire pas, il le
rend opaque, ce que le code traite comme une absence. Le cas « les deux en-têtes
absents » (l'outil de confidentialité) est un cas **différent** de « `Origin`
présent et opaque », et le code les confond.

Pourquoi *major* et non *critical* : l'exploitation réelle suppose d'écrire un
cookie de première partie depuis un contexte tiers, ce que les navigateurs
actuels partitionnent ou bloquent ; le socle `docs/security.md` ne pose par
ailleurs aucun contrôle CSRF nommé qui serait ici enfreint. Rien n'est
silencieusement corrompu aujourd'hui. Mais le contrôle ne tient pas ce que son
commentaire promet, et la correction tient en une ligne — refuser un `Origin`
présent qui n'est pas une URL, au lieu de le confondre avec son absence —, avec
un cas de test à ajouter à la liste des quatre déjà balayés.

### C2 — major — trois documents affirment encore ce que la story a mesuré faux

L'ADR 036 et `consent-scripts.tsx` écrivent la vérité mesurée : sous
`'strict-dynamic'`, **déclarer l'origine d'un fournisseur dans
`config/security.ts` ne suffit pas**, c'est le nonce qui autorise.

Trois autres endroits, écrits par la même story, affirment encore l'inverse — le
geste que s39 devra faire serait de déclarer l'origine, `script-src 'self'` la
refusant « autrement » :

- `packages/modules/consent/src/domain/consent-category.ts:28-31` ;
- `apps/web/lib/consent.ts:50-53` ;
- `packages/modules/consent/AGENTS.md`, section « Ne doit jamais contenir »,
  dernier point.

L'`AGENTS.md` racine place la règle là où le code s'écrit, et c'est justement
l'`AGENTS.md` du module que l'agent de s39 lira en premier. Il y trouvera la
consigne périmée, ajoutera l'origine dans `config/security.ts`, et le script de
PostHog ne s'exécutera toujours pas — l'échec n'apparaissant que dans le
navigateur du premier visiteur, exactement le mode de panne que ces trois
commentaires prétendent prévenir. Le dépôt s'est déjà fait prendre à laisser une
règle périmée survivre à sa mesure ; c'est le même piège.

Ce n'est pas bloquant — le code est juste, seule la prose ment — mais c'est un
document qui a vieilli **dans le commit qui l'écrit**.

### C3 — minor — `docs/architecture.md:119` attribue une entité `consent` au module `gdpr`

L'implémenteur le signale et ne le corrige pas, l'architecture n'étant pas
modifiable depuis une story. **Je suis d'accord** : le cycle interdit à une
story de réécrire un document de cadrage, l'ADR 035 est le mécanisme prévu pour
porter la décision, et il nomme explicitement la ligne périmée sous « ce qu'il
faut surveiller ». Le geste était le bon.

Avec une réserve à porter au cadrage : la ligne 119 appartient à `gdpr`
(s34/s35), pas à `consent`. Un agent de s34 qui la lira créera une table
`consent` que l'ADR 035 interdit pour le consentement aux cookies — et il aura
raison de la créer s'il s'agit d'autre chose. La ligne doit être tranchée
**avant** s34, pas pendant.

### C4 — minor — aucune maquette `.html` pour la première story à écran depuis s10

`docs/designs/` porte un `.md` **et** un `.html` pour les huit stories à écran
antérieures (s10 à s18). s36 n'a que le `.md`. `AGENTS.md` racine décrit la
paire (« docs/designs/<id>.md (+ a reference .html mockup) »). Le `.md` est
substantiel et n'invente ni composant ni token, et le plan ne demandait pas le
`.html` — mais la règle du dépôt, elle, le décrit.

### C5 — minor — la route publique de décision n'est pas limitée en débit

`docs/security.md` §7 demande une limitation de débit sur tout point d'entrée
public, et la renvoie à s28. Le module `marketing` s'en est doté lui-même pour
ses formulaires (ils envoient des emails) ; `POST /api/modules/consent/decide`
n'a rien. La route n'écrit qu'un en-tête, ne touche ni base, ni tiers, ni email :
il n'y a pas d'amplification à obtenir. Signalé pour que s28 ne l'oublie pas,
pas pour être corrigé ici.

### C6 — minor — le filet « attributs de cookie » ne couvre pas les routes de module

Constat de la mutation B : retirer `HttpOnly` de `consentSetCookie` ne fait
rougir que le test du module. `tests/i18n.test.ts`, qui porte le nom du contrôle
de socle (« aucun cookie ne part sans les attributs du socle »), balaie les
`Set-Cookie` du proxy et ne voit pas ceux qu'une route de module émet. Le
contrôle existe et mord ; c'est sa **portée** qui est plus étroite que son nom.
À élargir quand une story touchera ce filet.

## Ce que je n'ai pas pu vérifier

- **Le thème sombre.** La tâche 6 du plan annonce une vérification visuelle
  « thème clair, thème sombre, 390 px ». J'ai mesuré le thème clair à 390 px et
  1280 px, sous le build de production. Le thème sombre de la bannière et de
  l'écran de préférences n'a **pas** été rendu par moi. *Geste humain* : ouvrir
  `/fr/cookies` et la bannière en thème sombre, vérifier le contraste du texte
  secondaire et de la case cochée (`accent-primary`).
- **Le critère 7 dans un navigateur.** « Aucun script déclaré ⇒ aucune bannière,
  aucun cookie » est prouvé par `tests/consent.test.ts` et
  `tests/rendered-text.test.ts` avec le vrai registre vide, mais **jamais rendu
  dans un navigateur** : `playwright.config.ts` pose toujours le drapeau, et le
  serveur de production que j'ai monté exigeait un contournement de la
  configuration de stockage que je n'ai pas voulu conserver. *Geste humain* :
  `pnpm build && pnpm start` sans `CONSENT_SCRIPT_PROBE`, ouvrir la racine — pas
  de bannière —, puis `/fr/cookies` — l'état vide, aucun formulaire.
- **Un autre navigateur que Chromium.** `playwright.config.ts` ne déclare qu'un
  projet. La propriété « sans JavaScript » et le comportement de
  `'strict-dynamic'` sont donc mesurés sur un seul moteur. *Geste humain* : un
  passage manuel sur Safari et Firefox, la case native et le `<form>` natif
  n'ayant pas le même rendu par défaut.
- **L'exploitation réelle de C1.** J'ai mesuré que la route accepte
  `Origin: null` et pose le cookie ; je n'ai **pas** monté une page attaquante
  dans un `<iframe sandbox>` pour observer si le navigateur écrit le cookie dans
  le pot de première partie ou dans un pot partitionné. C'est ce qui sépare ici
  *major* de *critical*. *Geste humain* : monter la page d'attaque sur une
  seconde origine et observer, sur Chrome, Firefox et Safari.
- **Le comportement derrière une terminaison TLS réelle.** La comparaison
  d'hôte plutôt que de schéma est testée en unité et raisonnée ; aucun
  déploiement derrière un proxy réel n'a été exercé. *Geste humain* : une
  soumission de consentement sur l'environnement de recette.
- **La durée de six mois.** Mesurée dans l'en-tête (`Max-Age=15724800`), pas
  observée à l'expiration.

Sur les mutations : **six** posées, six restaurées, `git diff --exit-code` vert
à chaque fois et une dernière fois avant l'écriture de ce rapport. Les
modifications temporaires de `config/security.ts` (pour démarrer un serveur de
production) et le `pnpm ks toggle marketing` ont été défaits de la même façon.
Aucune revendication d'exhaustivité : ce qui précède est **ce qui a été
balayé**, sur les cas nommés, pas la liste de ce qui existe.

## Verdict

La story tient ce pour quoi elle existe. Les deux points d'accès sont réels et
mesurés **dans les deux configurations de modules**, en nœud comme au
navigateur ; rien de non essentiel ne part avant le choix, mesuré sur le réseau
sous le build de production ; refuser est un clic au même rang qu'accepter, et
révocable ; tout fonctionne sans JavaScript ; le cookie porte les trois
attributs du socle ; et l'affirmation sur `'strict-dynamic'` — la seule qui
aurait pu être une hallucination confortable — est vraie, vérifiée par mutation
au bon endroit et rebuild de production.

Restent deux constats *major* qui ne corrompent rien aujourd'hui mais qui
mentent tous les deux sur ce que le code fait : une garde d'origine dont la
justification écrite est fausse pour le cas `Origin: null`, et trois documents
qui donnent à s39 une consigne que cette même story a mesurée insuffisante. Les
deux se corrigent en quelques lignes et méritent le prochain cycle, pas un
blocage.

*(Les deux lignes de verdict qui figuraient ici ont été déplacées en fin de
fichier, mises à jour par le tour de correction ci-dessous : le dépôt lit les
**deux dernières lignes** du rapport, et deux paires seraient une ambiguïté.)*

## 10. Tour de correction — ce qui a été corrigé, et comment c'est prouvé

Commit `c634007`, un seul de plus. Rien n'a été touché en dehors des constats
ci-dessous.

### C1 — `Origin: null` est refusé, et les trois textes disent enfin vrai

`packages/modules/consent/src/domain/request-guard.ts` sépare désormais deux cas
que le premier jet confondait :

- **absent** (`Origin` et `Referer` manquent) → accepté, décision inchangée ;
- **présent mais pas une URL**, `Origin: null` au premier chef → **refusé**. Le
  premier en-tête présent décide : un `Origin` opaque n'est plus rattrapé par un
  `Referer` de bonne mine.

Mesuré **sur le serveur de production** (`pnpm build --force` puis
`next start`), et pas seulement en nœud :

| Requête | Avant (mutation posée) | Après |
|---|---|---|
| `POST` `Origin: null` | **303** + `app_consent=v=1&analytics=1&advertising=1` | **403**, aucun `Set-Cookie` |
| `POST` `Origin: https://evil.test` | 403 | 403 |
| `POST` même origine | 303 + cookie | 303 + cookie |
| `POST` sans aucun des deux en-têtes | 303 + cookie | 303 + cookie (choix écrit, inchangé) |

Et **au navigateur**, sous le même build, avec la page d'attaque que la revue
disait n'avoir pas montée : une page servie sur `https://evil.test` porte un
`<iframe sandbox="allow-forms allow-scripts">` dont le formulaire se soumet
seul. Chromium émet bien `Origin: null` — la prémisse du constat est donc
vérifiée dans un vrai navigateur, pas raisonnée.

- build **muté** (garde ramenée au comportement d'origine) :
  `{"status":303,"origin":"null","setCookie":["app_consent=v=1&analytics=1&advertising=1; …"]}` ;
- build **corrigé** : `{"status":403,"origin":"null","setCookie":[]}`.

Dans les deux cas le pot de cookies de première partie reste vide côté Chromium
(la requête part d'un contexte tiers) : c'est ce qui séparait *major* de
*critical*, et c'est maintenant **mesuré** plutôt que supposé. Le serveur, lui,
ne délivre plus de consentement forgé.

Les trois textes qui affirmaient le contraire sont réécrits, et ils nomment
maintenant les deux cas séparément : `request-guard.ts` (bloc de documentation
de la fonction), `src/domain/consent.test.ts` (le commentaire du cas « aucun des
deux en-têtes ») et `packages/modules/consent/AGENTS.md` (section « Ce que la
garde d'origine couvre »), dont le décompte passe de quatre à **cinq cas
balayés**.

### C2 — les trois documents ne renvoient plus s39 dans le mur

`consent-category.ts`, `apps/web/lib/consent.ts` et l'`AGENTS.md` du module
disent désormais ce qu'ADR 036 a mesuré : sous `'strict-dynamic'`, un navigateur
CSP 3 ignore `'self'` et toute source d'hôte, et c'est le **nonce** — porté par
`ConsentScripts` — qui autorise la balise. Déclarer l'origine du fournisseur
dans `config/security.ts`, champ `script`, ne sert à rien.

Une précision a été ajoutée aux trois, parce que l'inverse serait le piège
symétrique : `'strict-dynamic'` ne vaut que pour `script-src`. Les origines que
le fournisseur **appelle** (`connect`, `img`) restent à déclarer, et c'est bien
un geste que s39 devra faire.

### C6 — la garde des cookies voit maintenant les routes de module

`tests/i18n.test.ts` balayait les `Set-Cookie` du proxy et rien d'autre. Il
balaie maintenant aussi **le registre de modules de l'application** : chaque
route déclarée reçoit une requête de même site, minimale et sans session, et
tout `Set-Cookie` rendu doit porter `HttpOnly`, `Secure` et `SameSite`. Le
balayage part du registre et non d'une liste de chemins : une route ajoutée
demain y entre sans que personne y pense. Une garde contre le vide exige qu'au
moins un cookie soit observé, sinon le filet pourrait devenir muet en silence.

Ce qu'il ne voit **pas**, et c'est écrit dans le test : un cookie posé derrière
une session ou derrière une configuration absente — ces routes refusent (401) ou
réclament leur configuration avant d'écrire.

Mutation, à l'endroit du défaut (`consent-cookie.ts`, `'HttpOnly'` retiré de
l'en-tête) : **2 tests rouges dans 2 fichiers**, contre **1** avant la
correction.

### C4 — la maquette de référence est livrée

`docs/designs/s36-cookie-consent.html`, sur le patron des huit stories à écran
antérieures (s10 à s18) : bannière en thème clair ≥ 768 px, la même en thème
sombre à 390 px, l'écran `/cookies` avec ses badges d'état enregistré, son
`EmptyState` « aucun script déclaré », la carte de `/account` et le lien du pied
de page. Les libellés sont ceux de `messages/fr.json`, et les variantes de
bouton sont celles de `CookieBanner` (même variante pour refuser et accepter,
« Tout refuser » en premier) : une divergence entre la maquette et le composant
se voit ici.

### C3 — l'avertissement est écrit là où l'agent de s34 le lira

`docs/architecture.md` n'a **pas** été touché : une story n'en a pas le droit.
L'avertissement est dans l'ADR 035, sous « Ce qu'il faut surveiller », et il
tranche les deux lectures possibles de la ligne 119 : s'il s'agit du
consentement aux cookies, la table est interdite et c'est la ligne qu'il faut
corriger ; s'il s'agit d'autre chose (acceptation datée des CGU, par exemple),
la table est légitime mais ne doit pas porter le nom nu `consent`. Dans les deux
cas, l'arbitrage se prend en cadrage, avec le droit de réécrire l'architecture.

### C5 — non traité, et c'est délibéré

La limitation de débit de `POST /api/modules/consent/decide` reste une dette
s28, comme partout ailleurs dans le dépôt.

### Les commandes, dans les deux configurations de modules

| Commande | Livrée (`marketing` activé) | Après `pnpm ks toggle marketing` |
|---|---|---|
| `pnpm typecheck --force` | 20/20 | 20/20 |
| `pnpm lint --max-warnings=0` | vert | vert |
| `pnpm test` | **1310 passés**, 2 ignorés (1308 avant) | **1310 passés**, 2 ignorés |
| `E2E_PORT=3136 pnpm test:e2e` | **73 passés**, 6 ignorés | **68 passés**, 11 ignorés |
| `pnpm build --force` | vert | vert |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert | idem |

Module `marketing` remis en marche, `git status` vérifié : seuls les fichiers du
tour de correction sont modifiés.

### Les mutations de ce tour, et le rouge observé

| # | Mutation, à l'endroit exact | Rouge |
|---|---|---|
| G | `request-guard.ts` — `isAbsent(declared) \|\| hostOf(declared) === null` (l'opaque redevient une absence) | **1 test**, celui de la règle ; et **303 + cookie complet** sur `Origin: null`, au serveur de production comme au navigateur |
| H | `consent-cookie.ts` — `'HttpOnly'` retiré | **2 tests**, 2 fichiers (contre 1 avant) |

Les deux fichiers ont été restaurés depuis une copie prise avant la mutation, et
l'arbre revérifié. Les modifications temporaires nécessaires pour démarrer un
serveur de production — l'origine du seau S3 dans `config/security.ts` — ont
été défaites de la même façon.

### Ce que ce tour n'a pas vérifié

Inchangé par rapport à la section « Ce que je n'ai pas pu vérifier » ci-dessus,
sauf sur un point : **l'exploitation réelle de C1 a été montée et observée**, sur
Chromium seulement. Safari et Firefox n'ont pas été exercés, et le thème sombre
de la bannière n'a été rendu que dans la maquette de référence, pas dans
l'application.

*(Les deux lignes de verdict du tour de correction ont été retirées d'ici : le
dépôt lit les **deux dernières lignes** du fichier, et deux paires seraient une
ambiguïté. Le verdict qui fait foi est celui de la seconde revue, ci-dessous.)*

## 11. Seconde revue — le seul delta `8448788..c634007`

Portée : les quatre points du tour de correction, et rien d'autre. Ce que la
première revue a validé n'a pas été refait. Huit fichiers, +500/−41.

### Les commandes, réexécutées, dans les deux configurations

| Commande | Livrée (`marketing` activé) | Après `pnpm ks toggle marketing` |
|---|---|---|
| `pnpm typecheck --force` | 20/20 | 20/20 |
| `pnpm lint --max-warnings=0` | vert | vert |
| `pnpm test` | **1310 passés**, 2 ignorés | **1310 passés**, 2 ignorés |
| `E2E_PORT=3136 pnpm test:e2e` | **73 passés**, 6 ignorés | **68 passés**, 11 ignorés |
| `pnpm build --force` | vert | vert |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert | idem |

Les chiffres annoncés par le tour de correction sont donc exacts, mesurés et non
lus. Module `marketing` remis en marche, arbre reprouvé propre.

### 1. La règle d'origine — mesure refaite, puis attaquée

`pnpm build --force`, puis `next start` sur le port 3137, **sans toucher à
`config/security.ts`** : le blocage décrit par l'implémenteur est réel (le seau
S3 exige son origine en `connect`, `next.config.ts` refuse de démarrer en le
disant), et il se contourne autrement — `pnpm ks toggle storage`, restauré
ensuite. Mesuré sur ce serveur de production, dix requêtes :

| Requête | Réponse |
|---|---|
| `Origin` de même origine | 303 + cookie |
| aucun des deux en-têtes | 303 + cookie |
| `Origin: null` | **403**, aucun `Set-Cookie` |
| `Origin: NULL` | **403** |
| `Origin: null` + `Referer` de bonne mine | **403** |
| `Origin: https://evil.test` | 403 |
| `Referer: null` seul | **403** |
| `Referer` de même origine seul | 303 + cookie |
| en-tête `ORIGIN:` (casse) | **403** |
| `Origin` répété deux fois | **403** |

La mesure de l'implémenteur est donc confirmée, y compris le sens qui compte le
plus : **aucun parcours légitime ne casse** — l'absence des deux en-têtes reste
acceptée, et les six parcours de `e2e/consent.spec.ts` passent dans les deux
configurations de modules.

Ce que la règle couvre au-delà de ce qui est écrit, balayé sur **vingt-trois
formes** passées à `isSameSiteSubmission` (ce qui a été balayé, pas la liste de
ce qui existe) : `data:`, `about:blank`, `file:`, `blob:`, la casse de l'hôte,
la barre oblique finale, le port par défaut explicite (`:443`), un
sous-domaine (`evil.app.example.test` → refusé), un `Referer` opaque, un
`Origin` vide chaîne. Aucun faux refus trouvé sur une forme qu'un navigateur
émet réellement ; aucune acceptation trouvée sur une forme opaque.

Un seul comportement mérite d'être nommé, et il n'est écrit nulle part : un
en-tête `Origin` **répété** est joint par l'API `Headers` en
`« a, a »`, que `URL.canParse` refuse — la requête est donc refusée même quand
les deux valeurs sont la bonne. Aucun navigateur ne duplique `Origin` ; un
intermédiaire mal réglé, si. Sens sûr, mais non testé et non dit.

**Mutation, à l'endroit du défaut** — `request-guard.ts`, la boucle ramenée à
`if (isAbsent(declared) || hostOf(declared) === null)`, c'est-à-dire l'opaque
redevenu une absence : **1 test rouge**
(`consent.test.ts > refuse une origine opaque`). Restauré depuis une copie,
`git diff --exit-code` vert. Le rouge est étroit — aucun test de câblage ne
couvre le 403 de la route sur `Origin: null` —, mais l'invariant est bien dans
le domaine, et il mord.

### 2. Le balayage des cookies — où il ne voit rien, et si c'est écrit

**Mutation** — `consent-cookie.ts`, `'HttpOnly'` retiré : **2 tests rouges dans
2 fichiers** (`tests/i18n.test.ts` et `consent.test.ts`), contre 1 avant le tour
de correction. Le filet est bien élargi. Restauré, arbre vérifié.

Ce que le balayage voit réellement, **mesuré** (fichier de sonde temporaire dans
`tests/`, exécuté puis supprimé, `git status` reprouvé) : les **52 routes du
registre** sont sollicitées ; **une seule** rend un `Set-Cookie`, la route de
consentement (303). Les autres se répartissent en 31 refus 401 (route non
publique, gestionnaire jamais appelé), 20 exceptions « module non configuré »
avalées par le `.catch`, et un 200 sans cookie. C'est **exactement** ce que le
commentaire du test écrit — « derrière une session ou derrière une configuration
absente » —, et la garde contre le vide (`cookies.length > 0`) tient à un seul
cookie : elle rougira le jour où la route de consentement cessera d'en poser.

Le cookie de session, lui, échappe à ce balayage (Better Auth, base absente),
mais il est couvert ailleurs : `tests/auth.test.ts:614` et
`e2e/auth.spec.ts:49`. Aucun trou de couverture trouvé ; la portée annoncée est
la portée réelle.

### 3. Les trois textes — vrais sur l'essentiel, trop absolus sur un point

Vérifié contre la source : `apps/web/lib/security-headers.ts:105-112` pose bien
`script-src 'self' 'nonce-…' 'strict-dynamic'` sans condition de mode, et
`connect-src` / `img-src` sont bien alimentés par `config/security.ts`. La
précision symétrique ajoutée aux trois textes — `'strict-dynamic'` ne vaut que
pour `script-src`, les origines **appelées** par le fournisseur restent à
déclarer en `connect` et `img` — est donc juste, et c'est elle qui évitera le
piège inverse à s39.

Voir toutefois le constat C7 : la formulation absolue « **rien** à déclarer »
dépasse ce que le dépôt écrit ailleurs.

### 4. L'ADR 035 modifié — la lecture est la bonne

`docs/decisions/035` reçoit vingt-trois lignes sous « Ce qu'il faut surveiller »,
et l'immuabilité des ADR est une règle du dépôt. Elle est ici **respectée**, et
pas contournée, pour trois raisons qui tiennent ensemble :

- l'ADR **naît dans cette branche** et n'existe nulle part ailleurs. Les commits
  d'une story sont écrasés à la fusion : le dépôt ne verra jamais qu'un seul
  texte, celui-ci. Un ADR 037 qui superséderait un 035 que personne n'a jamais
  lu serait du bruit, pas de la traçabilité ;
- l'ajout ne touche **ni la décision, ni son statut, ni ses options rejetées** :
  c'est un avertissement adressé à s34/s35, dans la section prévue pour ça. Rien
  n'est réécrit, tout est ajouté ;
- la règle protège une décision **en vigueur**, c'est-à-dire fusionnée et lisible
  par d'autres. Le droit invoqué ici expire à la fusion : après elle, toute
  reprise de 035 passe par un ADR qui le supersède.

Le geste de ne **pas** toucher `docs/architecture.md` reste, lui, le bon.

### Constats de cette seconde revue

#### C7 — minor — « rien à déclarer » est plus absolu que ce que le dépôt écrit ailleurs

`packages/modules/consent/src/domain/consent-category.ts:28`,
`apps/web/lib/consent.ts:50` et `packages/modules/consent/AGENTS.md:66` disent
qu'un script tiers **n'a rien à déclarer** dans `config/security.ts`, champ
`script`. Deux fichiers du même dépôt disent l'inverse, et ils ont raison :

- `apps/web/lib/security-headers.ts:85-88` — « ceux qui ne le comprennent pas
  retombent sur `'self'` » ;
- `packages/modules/consent/src/presentation/consent-scripts.tsx:36-38` — « la
  source d'hôte ne sert qu'aux navigateurs qui ne comprennent pas
  `'strict-dynamic'` ».

Un navigateur CSP 2 (Safari antérieur à 15.4) ignore `'strict-dynamic'` et
applique la liste d'origines : sans la ligne dans `script`, le script du
fournisseur y sera refusé. La correction du constat C2 était juste dans son
sens, elle a seulement dépassé la cible d'un cran — et l'ADR 036 comme
`consent-scripts.tsx`, eux, gardent la bonne nuance (« ne suffira pas »). Écart
de prose entre deux fichiers du même commit, sans effet sur le code livré ; à
aligner sur « ne suffit pas, et ne sert que de repli ».

#### C8 — minor — un `Origin` répété est refusé, et ce n'est ni testé ni dit

Mesuré 403 sur le serveur de production avec deux en-têtes `Origin` **identiques
et légitimes** : l'API `Headers` les joint, la valeur jointe n'est plus une URL,
la garde refuse. Le sens est sûr et aucun navigateur ne produit ce cas ; un
intermédiaire mal réglé le produirait, et le refus serait alors muet pour
l'exploitant. À écrire dans la liste des cas balayés le jour où quelqu'un
touchera ce fichier.

### Ce que cette seconde revue n'a pas vérifié

- **La page d'attaque réelle.** J'ai mesuré `Origin: null` au client HTTP contre
  le serveur de production, pas par un `<iframe sandbox>` servi depuis une autre
  origine dans un vrai navigateur. Le tour de correction affirme l'avoir fait
  sur Chromium ; je n'ai pas rejoué ce geste. *Geste humain* : remonter la page
  d'attaque et observer, sur Chrome, Firefox et Safari.
- **Safari et Firefox**, sur `'strict-dynamic'` comme sur le formulaire natif :
  un seul projet Playwright, un seul moteur.
- **Le thème sombre**, toujours pas rendu dans l'application. La maquette
  `docs/designs/s36-cookie-consent.html` a été **lue** — ses libellés
  correspondent un à un à `src/messages/fr.json`, ses composants (`Badge`,
  `EmptyState`, `CookieBanner`, `CookieIcon`) existent tous au design system et
  dans l'écran réel — mais elle n'a pas été **ouverte** dans un navigateur.
  *Geste humain* : l'ouvrir, et ouvrir `/fr/cookies` en thème sombre à côté.
- **Le comportement derrière un proxy réel** qui réécrit l'hôte : la garde
  compare des hôtes, et `request.url` dépend de l'en-tête `Host`. Inchangé par ce
  delta, toujours non exercé. *Geste humain* : une soumission sur la recette.
- **La mesure du serveur de production avec `storage` activé** : je l'ai fait
  module coupé, faute de pouvoir démarrer autrement sans modifier
  `config/security.ts`. La route de consentement ne dépend pas de `storage`.

Sur les mutations : **deux** posées à l'endroit exact du défaut, deux
restaurées ; un fichier de sonde temporaire créé dans `tests/` puis supprimé ;
deux `pnpm ks toggle` (storage, marketing) défaits. `git diff --exit-code` vert
et `config/security.ts` **intact** (`git diff HEAD` vide sur ce fichier) avant
l'écriture de ces lignes. Aucune revendication d'exhaustivité : ce qui précède
est ce qui a été balayé, sur les cas nommés.

### Verdict de la seconde revue

Les deux constats *major* du premier tour sont **réellement** fermés, et fermés
là où ils avaient été ouverts : la règle d'origine refuse l'opaque, mesurée dans
les deux sens sur un serveur de production que j'ai monté moi-même ; le filet des
cookies voit désormais la route qui posait le problème, prouvé par mutation ; les
textes ne renvoient plus s39 dans le mur. La modification de l'ADR 035 est
légitime tant que la branche n'est pas fusionnée, et son contenu n'est qu'un
avertissement. Restent deux imprécisions de prose, l'une trop absolue, l'autre
non écrite — aucune ne corrompt quoi que ce soit.

Max severity: minor
Ship allowed: yes
