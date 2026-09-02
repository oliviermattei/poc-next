---
story: s36-cookie-consent
validated: yes
---

# Plan — s36-cookie-consent

Recherche : `docs/research/s36-cookie-consent.md`.
Design : `docs/designs/s36-cookie-consent.md`.
Décision structurante ouverte par cette story : **ADR 035** — le consentement
est un cookie, jamais une ligne en base.

## Socles nommés

`docs/security.md` **§1** (attributs du cookie de consentement : `HttpOnly`,
`Secure`, `SameSite=Lax` ; politique de sécurité du contenu de s45 — aucune
balise en ligne, aucun script hors `'self'`), **§4** (Zod à la frontière : corps
de la soumission et valeur du cookie ; **liste blanche de redirection** — le
retour est réduit à un chemin d'une seule barre oblique), **§7** (un refus de
soumission ne dit rien d'exploitable).

`docs/reliability.md` **§2** (dégradation : aucun script déclaré ⇒ l'application
fonctionne à l'identique, sans bannière et sans cookie ; le mode de
démonstration est un **opt-in explicite**, jamais déduit de `NODE_ENV`).

`AGENTS.md` racine : un `AGENTS.md` par package neuf ; aucune affirmation
d'exhaustivité ; une règle sans commande est de la documentation ; les documents
vieillissent avec le code qu'ils décrivent.

## Tâches

- [x] **1. Le squelette du module `consent`.**
  `packages/modules/consent/` — `package.json` (deux points d'entrée, ADR 024),
  `tsconfig.json`, `AGENTS.md` (les trois sections exigées), `src/module.ts` au
  contrat complet : `requires: []`, `schema: {}`, `migrations: null`,
  `dataCategories: []`, `retention: {}`, purge et export à vide. Ligne ajoutée à
  `config/features.ts` (annuaire + activation), `generated/` régénéré.
  *Test* : `tests/consent.test.ts` — le module est monté par le registre livré,
  et il ne déclare **aucune** table ni migration (le critère « rien n'est
  stocké » est une assertion, pas un commentaire).

- [x] **2. Le domaine : catégories, état, décision.**
  `domain/consent-category.ts` — `CONSENT_CATEGORIES` (`analytics`,
  `advertising`), `NonEssentialScript`, `resolveConsentState(scripts, decisions)`
  qui rend catégories déclarées, accordées, refusées, en attente, la nécessité
  de la bannière et **les scripts autorisés**, et `decideFrom(submission,
  declared)` qui calcule les décisions d'une soumission.
  *Test* : `packages/modules/consent/src/domain/consent.test.ts` — un script
  n'est autorisé que si **sa** catégorie est accordée ; une catégorie non
  déclarée soumise est ignorée ; aucune catégorie déclarée ⇒ aucune bannière.
  *Mutation* : rendre tous les scripts quelle que soit la décision.

- [x] **3. Le cookie.**
  `domain/consent-cookie.ts` — `CONSENT_COOKIE`, `decodeConsentCookie` (Zod, à la
  frontière), `encodeConsentCookie`, `consentSetCookie` avec `Path=/`,
  `HttpOnly`, `Secure`, `SameSite=Lax`, `Max-Age` de six mois.
  *Test* : mêmes fichiers — un cookie illisible vaut « rien de décidé » et ne
  lève pas ; une catégorie inconnue dans le cookie est ignorée ; l'en-tête porte
  les trois attributs du socle.
  *Mutation* : retirer `HttpOnly` de l'en-tête.

- [x] **4. La garde de soumission et le retour.**
  `domain/request-guard.ts` — `isSameSiteSubmission(origin, referer, url)` et
  `safeReturnPath(referer, fallback)`.
  *Test* : une origine étrangère est refusée ; `//evil.test` et `\\evil.test` ne
  sortent jamais du site ; l'absence des deux en-têtes est acceptée (choix écrit
  dans la recherche §2.3).
  *Mutation* : accepter n'importe quelle origine.

- [x] **5. La route.**
  `application/consent-service.ts` (accès différé au registre de scripts),
  `infrastructure/consent-runtime.ts`, `presentation/consent-routes.ts` :
  `POST /consent/decide`, protection `public`, corps
  `application/x-www-form-urlencoded` **et** JSON, réponse `303` + `Set-Cookie`.
  *Test* : `tests/consent.test.ts` — la route pose le cookie et renvoie vers le
  chemin d'origine ; une soumission inter-site est refusée **sans** poser de
  cookie ; module coupé, le chemin répond 404 (registre construit par le test).
  *Mutation* : renvoyer le cookie avant la garde d'origine.

- [x] **6. Le design system : `Checkbox` et `CookieBanner`.**
  `packages/ui/src/components/checkbox.tsx` (natif, cf. design),
  `packages/ui/src/composed/cookie-banner.tsx`, baril et `packages/ui/AGENTS.md`
  mis à jour (le tableau des composants copiés, et **pourquoi** la case est
  native).
  *Vérification* : `pnpm lint` (la règle « un `<form>` déclare sa méthode » vise
  ce package), `pnpm test` (`tests/design-system.test.ts`), puis vérification
  visuelle au navigateur — thème clair, thème sombre, 390 px.

- [x] **7. Les vues du module et son catalogue.**
  `presentation/consent-banner.tsx`, `consent-preferences.tsx`,
  `consent-settings-card.tsx`, `consent-scripts.tsx`, `consent-intl.ts`,
  `presentation/index.ts` ; `messages/fr.json` et `en.json`.
  *Test* : `tests/i18n.test.ts` (catalogues complets dans les deux locales) et
  `tests/rendered-text.test.ts` — aucune chaîne qui ne soit pas un marqueur.

- [x] **8. Le point de composition et le registre de scripts.**
  `apps/web/lib/consent.ts` — `available`, `scripts`, `categories`, `prepare`,
  `currentConsent()`. Le drapeau `CONSENT_SCRIPT_PROBE` entre dans
  `packages/config/src/env.ts` et dans `.env.example` ; la sonde
  `apps/web/app/api/consent-probe/[script]/route.ts` sert les deux scripts
  factices et 404 sans le drapeau.
  *Test* : `tests/consent.test.ts` — sans drapeau, aucun script déclaré ;
  la sonde répond 404 ; module coupé, `available` est faux et la liste est vide.
  *Mutation* : servir la sonde sans regarder le drapeau.

- [x] **9. Les deux points d'accès, et l'injection.**
  `apps/web/app/app-shell.tsx` (bannière + scripts autorisés),
  `apps/web/app/cookies/page.tsx`, la carte de `apps/web/app/account/page.tsx`,
  le `footerLinks` du module `marketing` (footer + trois vues) et les trois
  écrans publics qui le fournissent. `cookies` réservé dans
  `apps/web/lib/organizations.ts`.
  *Test* : `tests/consent.test.ts` — **dans les deux configurations du module
  `marketing`**, la gestion du consentement est atteignable : le pied de page
  porte le lien quand le module est monté, la carte de compte le porte toujours.
  Rien n'est injecté tant qu'une catégorie n'est pas accordée.
  *Mutation* : retirer la carte de `/account`.

- [x] **10. Le parcours navigateur.**
  `e2e/consent.spec.ts` : première visite (bannière, **aucune requête** vers la
  sonde, `window.__consentProbe` absent) ; refus, rechargement, ni bannière ni
  script ; personnalisation par catégorie (l'un chargé, l'autre non) ; retrait
  depuis `/account` ; le tout **sans JavaScript** dans un contexte dédié.
  Attentes **dérivées** de l'état du module `marketing`.

- [x] **11. Les documents qui vieillissent avec le code.**
  `apps/web/AGENTS.md` (point de composition, écran, sonde, imports),
  `packages/ui/AGENTS.md`, `packages/modules/marketing/AGENTS.md`,
  `packages/modules/consent/AGENTS.md`, `docs/decisions/035-…`. Aucune
  modification de `docs/architecture.md` ni de l'`AGENTS.md` racine : les écarts
  constatés sont **signalés** dans le compte rendu.

- [x] **12. Les deux configurations.**
  Suite complète module `marketing` activé, puis `pnpm ks toggle marketing`,
  suite complète à nouveau, puis remise en marche et arbre vérifié propre. Plus
  une vérification navigateur sous `pnpm build --force`.

## Definition of Done

Les huit critères d'acceptation satisfaits, chacun couvert par un test ou une
vérification visuelle tracée. `pnpm typecheck`, `pnpm lint --max-warnings=0`,
`pnpm test`, `E2E_PORT=3136 pnpm test:e2e`, `pnpm build --force`,
`pnpm run audit` verts **dans les deux états** du module `marketing`. Un seul
commit sur `feature/s36-cookie-consent`, message impératif en français, portant
recherche, design, plan et code. Chaque invariant revendiqué a été neutralisé et
le rouge observé.

## Écarts constatés à l'exécution

Consignés ici parce qu'un plan qui ment sur ce qui a été fait est pire qu'un
plan absent.

1. **`playwright.config.ts` a été modifié**, d'une entrée dans `webServer.env`
   (`CONSENT_SCRIPT_PROBE: '1'`) et de son commentaire. La consigne de la voie
   demandait de ne pas y toucher ; sans cette ligne, le drapeau ne pouvait venir
   que du `.env` d'un poste, ce que la même consigne interdit et ce que la
   fusion de s18 a déjà payé. Aucun autre réglage n'est touché — ni le port, ni
   `retries`, ni `reuseExistingServer`.
2. **Le nonce sur les scripts injectés** n'était pas au plan : il a été trouvé
   par mesure. `script-src` porte `'strict-dynamic'` (s45), qui fait **ignorer
   `'self'` et toute source d'hôte** aux navigateurs CSP 3 — un `<script src>`
   sans nonce est refusé même depuis notre origine. `app/layout.tsx` le passe
   donc à `AppShell`, qui le passe à `ConsentScripts`. Conséquence écrite dans
   l'ADR 036 pour s39 : déclarer l'origine d'un fournisseur dans
   `config/security.ts` **ne suffira pas**.
3. **La bannière réserve sa place** (`pb-64 md:pb-36` sur le contenu). Non
   prévue : posée en surface fixe sans réserve, elle interceptait les clics de
   dix parcours existants. Ce n'était pas un défaut de test — un visiteur ne
   pouvait pas atteindre le bas de la page avant d'avoir répondu.
4. **Deux ADR au lieu d'un** : 035 (le consentement est un cookie) et **036**
   (le registre des scripts vit au point de composition, pas au contrat de
   module). Le second est apparu en écrivant la tâche 8 : c'est une décision
   structurante dont s39 hérite, et le plan ne la nommait pas.
5. **Trois fichiers de test neufs au lieu de deux** — la limite de la méthode.
   `packages/modules/consent/src/domain/consent.test.ts` (les règles, à côté des
   règles), `tests/consent.test.ts` (ce qui traverse les packages) et
   `e2e/consent.spec.ts` (le navigateur, autre exécuteur et autre dossier). Le
   dépôt fait ainsi depuis s10 ; les fondre aurait mis des règles pures dans un
   fichier qui monte l'application.
6. **Deux suites existantes ont reçu une doublure de contexte de requête** :
   `tests/marketing.test.ts` et `tests/rendered-text.test.ts` doublent
   `currentConsent`, que le shell appelle désormais. La seconde double aussi la
   **liste des scripts** — même raison, et même précédent, que
   `oauthProviders: () => ['google','github','local']` : le dépôt n'en déclare
   aucun dans son état livré, et les libellés de la bannière sortiraient du
   filet.
7. **`apps/web/lib/organizations.ts` importe `@repo/module-consent`** pour le
   segment réservé `CONSENT_SCREEN_SEGMENT`. C'est une constante, pas une
   décision sur l'état du module — le même usage que les clés de traduction que
   les écrans importent déjà de `@repo/module-marketing`.

## Ce qui reste ouvert, et qui n'appartient pas à cette story

- **`docs/architecture.md` attribue une entité `consent` au module `gdpr`.** Ce
  texte est **faux** : il n'y a pas de table (ADR 035). Signalé, non corrigé —
  l'architecture n'est pas modifiable depuis une story.
- **`/cookies` n'entre ni dans `sitemap.xml` ni dans `robots.txt`.** Les deux
  dérivent de `marketingSite.publicPaths`, donnée du module `marketing` : y
  faire entrer un écran du socle demanderait de rouvrir ce module pour une page
  qui n'a pas vocation à être indexée.
- **Un visiteur anonyme sur une installation « site public coupé »** n'a aucun
  point d'accès au consentement une fois son choix fait : il n'a ni pied de page
  ni paramètres de compte. C'est le périmètre que la story a fixé — son
  critère 6 parle d'un **utilisateur connecté** —, et il est cohérent : sans
  site public, un anonyme ne voit que les écrans d'authentification.
