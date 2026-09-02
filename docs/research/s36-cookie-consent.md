# Recherche — s36-cookie-consent

> Ce que le dépôt contient déjà, ce que la story tranche, et les pièges mesurés.
> Tout ce qui suit a été vérifié dans les fichiers de **cet arbre** et dans les
> paquets installés, jamais dans une documentation en ligne.

## 0. Ce que la story a déjà décidé, et qu'il ne faut pas rediscuter

`docs/stories.md`, chapitre `s36-cookie-consent`, note issue du finding **F57**
de la revue des stories :

> **Deux points d'accès, pas un.** Le pied de page appartient à
> `s10-marketing-site`, module **optionnel**. Sur une installation marketing
> coupé + analytique activée — combinaison légale au regard de s10 et s39 — un
> point d'accès unique dans le pied de page priverait l'utilisateur de tout
> moyen de retirer son consentement. s36 étant socle, elle ne peut pas déclarer
> s10 en `requires` : elle doit fonctionner sans lui.

Et : « Ce module n'a pas d'état off propre : il est **inerte par construction**
quand aucun script non essentiel n'est déclaré. Couper le consentement tout en
gardant l'analytique serait une non-conformité, pas une option — d'où le
couplage plutôt qu'un booléen. »

Conséquences directes, non négociables :

1. la gestion du consentement est atteignable **dans les deux configurations**
   du module `marketing` ; c'est ce que la suite doit vérifier par une commande,
   pas une intégration accessoire ;
2. le module `consent` ne déclare **aucun requis** ; c'est s39 qui déclarera
   `requires: ['consent']` — le couplage va du dépendant vers le socle ;
3. l'inertie est **dérivée d'une donnée** (la liste des scripts non essentiels
   déclarés), jamais d'un booléen de configuration.

## 1. Ce qui existe déjà et qui décide de la forme

### 1.1 Le contrat de module est **fermé** (ADR 007)

`packages/core/src/module.ts` déclare quatorze clés, toutes obligatoires.
`docs/architecture.md` et l'`AGENTS.md` racine les énumèrent. Ajouter une
quinzième clé — par exemple `scripts` — obligerait à rouvrir les sept modules
existants **et** deux documents de cadrage que l'implémenteur n'a pas le droit
de modifier. **La déclaration des scripts non essentiels ne passe donc pas par
le contrat de module.**

Le mécanisme disponible et idiomatique est le **point de composition** :
`apps/web/lib/marketing.ts`, `lib/organizations.ts`, `lib/storage.ts`,
`lib/locale-routing.ts` sont chacun « le seul fichier de l'application qui
connaisse tel module et regarde s'il est activé ». `apps/web/AGENTS.md` les
nomme un par un et interdit tout autre `if (module activé)`.

→ **`apps/web/lib/consent.ts` est le registre.** s39 y ajoutera trois lignes
(« module analytics monté ⇒ le script PostHog entre dans la liste »), exactement
comme s18 a ajouté `lib/storage.ts`.

### 1.2 Les cookies du dépôt sont `HttpOnly`

`apps/web/AGENTS.md`, section i18n : « Un cookie lu par du JavaScript de page
demanderait une story, pas une exception. » `tests/i18n.test.ts`
(« aucun cookie ne part sans les attributs du socle ») contrôle **tous** les
`Set-Cookie` du proxy : `HttpOnly`, `Secure`, `SameSite=`.

→ Le cookie de consentement est écrit **côté serveur**, donc la bannière est un
`<form method="post">` natif vers une route de module, et non un composant
client qui écrit `document.cookie`. Conséquence heureuse : **la bannière
fonctionne sans JavaScript**, ce que s11 n'a pas su faire (bouton mort,
`<noscript>` correctif).

### 1.3 La politique de sécurité du contenu de s45

`config/security.ts` (que cette story ne touche pas) est vide de sources tierces.
`lib/security-headers.ts` construit `default-src 'self'`, `script-src 'self'
'nonce-…'` en production, sans `unsafe-inline` ni `unsafe-eval`.

Vérifié en lisant `apps/web/lib/security-headers.ts` : les sources sont
**additives**, donc un `<script src>` de **notre propre origine** passe sous
`script-src 'self'` sans nonce. Un script réellement tiers (s39/PostHog)
exigerait une entrée dans `config/security.ts` — c'est le geste que s39 devra
faire, et il est signalé, pas pris ici.

→ Le script factice de cette story est **servi par l'application**
(`/api/consent-probe/<id>`), donc mesurable sous le build de production sans
toucher à la politique.

### 1.4 Le texte affiché est sous filet

Deux filets, et ils ne se remplacent pas :

- `tests/i18n.test.ts` balaie la **source** de `apps/web/app`, `packages/ui/src`
  et `packages/modules` ;
- `tests/rendered-text.test.ts` **rend** chaque écran (`page.tsx`,
  `not-found.tsx`, `global-error.tsx`) avec un catalogue pseudo-locale et refuse
  toute chaîne qui n'est pas un marqueur. Une garde de couverture compare la
  liste des écrans déclarés au contenu du disque : **un écran ajouté sans être
  rendu là fait rougir**.

Le fichier remplace déjà des **configurations** pour rendre le filet plus
fourni : `oauthProviders: () => ['google','github','local']`. C'est le précédent
exact du registre de scripts, qui est vide dans la configuration livrée.

### 1.5 Les segments d'écran sont réservés

`tests/organizations.test.ts` dérive du disque les segments de premier niveau de
`apps/web/app` et exige que **chacun** soit refusé à une organisation
(`APPLICATION_SEGMENTS` dans `apps/web/lib/organizations.ts`). Un nouvel écran
`/cookies` doit donc y entrer, sinon `pnpm test` rougit.

### 1.6 Le pied de page vit dans le module `marketing`

`packages/modules/marketing/src/presentation/marketing-footer.tsx` construit ses
liens depuis `site.legalDocuments` et `site.forms`, et **rend `null` quand il n'a
rien à dire** (constat F9 de s11). Il est rendu par trois vues du module
(`MarketingHome`, `ContactView`, `LegalDocumentView`), elles-mêmes rendues par
trois écrans de l'application.

Le libellé du lien de consentement est **traduit par requête** : il ne peut donc
pas être baké dans `marketingSite` (constante de module). Il faut le faire
descendre en propriété — d'où `footerLinks` sur les trois vues.

### 1.7 Le harnais de parcours

`playwright.config.ts` pose dans `webServer.env` ce dont le harnais a besoin :
`AUTH_SECRET`, `APP_URL`, `EMAIL_LOCAL_CAPTURE`, `STORAGE_LOCAL_DIRECTORY`,
`I18N_MISSING_KEY_PROBE`, `OAUTH_LOCAL_PROVIDER`. La leçon de la fusion de s18
est écrite juste à côté : « ce dont le harnais a besoin se déclare **ici**,
jamais laissé au `.env` du poste ».

`reuseExistingServer: false`, `retries: 0`, `E2E_PORT` pour le port de la voie.

## 2. Ce que la recherche a tranché

### 2.1 Le consentement est un **cookie**, pas une ligne en base

Le module ne persiste **rien** : `schema: {}`, `migrations: null`,
`dataCategories: []`, `retention: {}`, purge et export à vide — la forme du
module `i18n`.

La raison n'est pas la paresse : un visiteur **anonyme** a le même droit qu'un
compte (critère implicite de la story, et exigence légale). Enregistrer son choix
côté serveur demanderait de lui attribuer un identifiant persistant,
c'est-à-dire **de le pister pour enregistrer son refus d'être pisté**. Le choix
vit donc là où il appartient : sur l'appareil du visiteur, dans un cookie
strictement nécessaire.

`docs/architecture.md` attribue une entité `consent` au module `gdpr` (s34/s35).
**Ce texte est faux pour s36** et le restera : il n'y a pas de table. Signalé, non
corrigé — la story n'a pas le droit de modifier l'architecture.

### 2.2 Le retour après soumission vient du `Referer`, et il est réduit à un chemin

Aucun moyen fiable de connaître le chemin courant dans un composant serveur de
Next 16 sans passer par le proxy (`apps/web/proxy.ts`, propriété de s45, hors
périmètre). `usePathname()` dans un composant client rendrait la valeur au
rendu serveur mais dépend du rendu dynamique — un repli silencieux.

Le `Referer` d'une soumission **de même origine** porte l'URL complète sous
`Referrer-Policy: strict-origin-when-cross-origin`, qui est celle du dépôt. Il
est réduit à `pathname + search` puis soumis à la **même liste blanche de forme**
que `safeRedirectPath` du module `auth` : une seule barre oblique de tête, pas de
barre inversée. Une redirection ouverte est donc impossible, y compris via
`//evil.test` (que `new URL('https://evil.test//x').pathname` rend en `//x`).

### 2.3 Intégrité du consentement : la soumission doit être de même site

Une soumission inter-site poserait un consentement au nom du visiteur —
« consentement forgé », pire qu'un refus perdu. Le cookie est `SameSite=Lax`,
ce qui ne l'empêche pas d'être **écrit** par une requête inter-site.

Garde retenue, purement fonctionnelle et testable : l'en-tête `Origin` (que tout
navigateur envoie sur un `POST`, y compris de même origine) doit avoir le **même
hôte** que la requête ; à défaut d'`Origin`, le `Referer` ; à défaut des deux,
la requête est acceptée. Ce dernier point est **délibéré et borné** : un
attaquant ne peut pas faire retirer ces en-têtes au navigateur d'une victime, et
refuser une requête sans en-tête casserait le retrait de consentement chez les
utilisateurs dont un outil de confidentialité les supprime — c'est-à-dire
exactement ceux que cette fonctionnalité sert.

La comparaison porte sur l'**hôte** et non sur le schéma : derrière une
terminaison TLS, l'origine vue par le navigateur est `https://…` alors que
`request.url` peut être `http://…`.

### 2.4 Le script factice est monté par un drapeau explicite

Même forme que `I18N_MISSING_KEY_PROBE` (s09) et `OAUTH_LOCAL_PROVIDER` (s12) :
`CONSENT_SCRIPT_PROBE=1`, littéral unique, jamais déduit de `NODE_ENV`. Sans le
drapeau : aucun script non essentiel déclaré, aucune bannière, aucun cookie de
consentement — c'est **l'état livré du boilerplate** et le critère 7.

Deux scripts, deux catégories (`analytics`, `advertising`) : c'est ce qui rend
« consentement **de sa catégorie** » mesurable — accepter l'analytique et refuser
la publicité doit charger l'un et pas l'autre. Un seul script rendrait le critère
2 satisfiable par un mécanisme tout-ou-rien.

Ils sont servis par `/api/consent-probe/<id>` et **s'exécutent** : ils poussent
leur identifiant dans `window.__consentProbe`. Asserter l'exécution, et non la
seule présence dans le DOM, est ce qui prouve le piège nommé par la story — « le
consentement conditionne le **chargement**, pas seulement l'envoi ».

### 2.5 Deux points d'accès, une seule destination

- écran `/cookies`, servi par l'application (donc **indépendant de
  `marketing`**), public — un visiteur anonyme y a le même droit qu'un compte ;
- **lien du pied de page** du site public quand `marketing` est activé ;
- **carte des paramètres de compte** (`/account`) — présente dans les deux
  configurations, et c'est elle qui tient le critère 6.

La bannière porte « tout accepter » / « tout refuser » (un clic chacun, même
variante, même taille : le refus doit être aussi facile que l'acceptation) et un
lien « personnaliser » vers `/cookies`, où vivent les cases par catégorie.

## 3. Pièges mesurés, à ne pas repayer

1. **`pnpm build --force` avant toute vérification navigateur.** `turbo` sert le
   `.next` de l'autre configuration de modules après un `pnpm ks toggle`.
2. **Next 16.3.3 charge sa configuration après `✓ Ready`.** Une mesure de
   démarrage qui s'arrête à cette ligne conclut à tort.
3. **Le drapeau du harnais se déclare dans `playwright.config.ts`**, jamais dans
   le `.env` du poste (fusion de s18).
4. **La bannière est visible sur tous les écrans pendant les parcours** dès que
   le drapeau est posé : une surface fixe en bas de fenêtre peut intercepter les
   clics des 67 parcours existants. À mesurer, pas à supposer.
5. **`tests/rendered-text.test.ts` a une garde de couverture** : `/cookies` doit
   y être déclaré avec son champ `refuses`, dérivé de l'état du module.
6. **`tests/organizations.test.ts` dérive les segments du disque** : `cookies`
   doit entrer dans `APPLICATION_SEGMENTS`.
7. **Le `domain` d'un module ne peut pas importer `react`** (ADR 006,
   `checkAllOrigins: true`). Les composants vivent en `presentation`, exposés par
   le **second point d'entrée** `@repo/module-consent/presentation` (ADR 024) :
   réexporter un `.tsx` depuis le barril principal fait échouer le `typecheck` de
   `@repo/db`.
8. **`packages/ui` ne connaît aucun texte** : tout arrive en propriété.
9. **`@source` de Tailwind** : `apps/web/app/globals.css` couvre déjà
   `packages/modules/*/src/presentation/**/*.tsx`. Rien à ajouter, mais
   `tests/design-system.test.ts` le vérifie.

## 4. Ce que la story ne fait pas, et pourquoi

- **aucune table, aucune migration** (§2.1) ;
- **`config/security.ts` n'est pas touché** : le script factice est de notre
  origine. Un vrai script tiers demandera à s39 d'y déclarer son domaine, et
  c'est écrit dans l'`AGENTS.md` du module ;
- **`/cookies` n'entre pas dans `sitemap.xml` ni dans `robots.txt`** : ces deux
  fichiers dérivent de `marketingSite.publicPaths`, donnée du module `marketing`.
  Y faire entrer un écran du socle demanderait de rouvrir ce module pour un gain
  nul (une page de préférences n'a pas vocation à être indexée). Signalé ;
- **aucun bandeau de « consentement légitime »**, aucun mode « refus par
  inaction » : tant qu'aucune catégorie n'est décidée, rien n'est chargé.

## 5. Sections des socles concernées

- `docs/security.md` §1 (attributs de cookie), §4 (Zod à la frontière, liste
  blanche de redirection), §7 (aucune information exploitable dans un refus) ;
- `docs/reliability.md` §2 (une dégradation, jamais une casse : sans script
  déclaré l'application fonctionne à l'identique).
