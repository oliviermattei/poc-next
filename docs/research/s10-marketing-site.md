# Research — Story s10-marketing-site

## Les cinq faits qui décident

1. **Une résolution de session anonyme n'émet aucune requête SQL — mesuré, pas supposé.**
   Sonde jetable exécutée dans ce worktree contre la vraie base : `service.resolveSession(new Request('/'))`
   sans cookie, puis avec un cookie `better-auth.session_token=abc` forgé, rend `null` dans les deux cas et
   le compteur posé sur `pool.query` **et** `pool.connect` reste à `[]`. Better Auth vérifie la signature du
   cookie avant tout accès à la base (`packages/modules/auth/src/infrastructure/better-auth-service.ts:307`).
   Conséquence : le critère « les pages marketing s'affichent sans session et n'émettent aucune requête base
   de données au rendu » est atteignable **sans sortir les pages marketing de l'`AppShell`**, qui appelle
   `currentViewer()` (`apps/web/app/app-shell.tsx:38`).

2. **Un module ne peut pas livrer de page Next : `ModuleRoute` est un descripteur monté sous
   `/api/modules/…`** (ADR 017, `packages/core/src/module.ts:78`). Les écrans vivent dans `apps/web/app`.
   La modularité d'une page se joue donc au **point de composition** — le modèle exact de
   `apps/web/lib/locale-routing.ts:36`, seul fichier qui connaisse `@repo/module-i18n` et qui rend une forme
   **identique dans les deux états**. `apps/web/AGENTS.md` interdit explicitement tout `if (module activé)`
   ailleurs.

3. **`ks` ne sait pas générer un module.** `pnpm ks --help` (mesuré) n'expose que `list` et `toggle` ; le
   scaffolding est la story s41 (serveur MCP), pas encore livrée. Le squelette de `packages/modules/marketing`
   sera donc écrit à la main **en calquant la forme d'un module existant**, `packages/modules/i18n` (module
   sans schéma ni migration). C'est une déviation à déclarer, pas une liberté.

4. **Trois filets de s09 se referment sur tout nouvel écran**, et chacun est une commande :
   `tests/rendered-text.test.ts:349` exige que la liste `screens` égale **exactement** l'ensemble des
   `page.tsx` sous `apps/web/app` (un écran ajouté sans y être rendu fait rougir la garde) ;
   `tests/i18n.test.ts:610` balaie `apps/web/app`, `packages/ui/src` et `packages/modules` et refuse un mot
   affiché en dur ; `tests/i18n.test.ts:621` exige que toute clé **citée statiquement** existe dans chaque
   locale. Les clés que seul le code compose (`marketing.section.${id}.title`) échappent au troisième :
   il faudra le filet correspondant, comme `i18n.locale.${candidate}` a le sien (`tests/i18n.test.ts:640`).

5. **Deux parcours end-to-end existants supposent que `/` répond 200 et reste `/`.**
   `e2e/i18n.spec.ts:29` boucle sur `['/', '/sign-in', …]` avec `toHaveURL(urlOf(pathname))` ;
   `e2e/health.spec.ts:14` attend 200 et un `h1`. Le critère « module non activé : la racine redirige vers la
   connexion » casse le premier tel quel (le second suit la redirection et reste vert : `page.goto` rend la
   réponse de la **dernière** redirection). La discipline du dépôt est de **dériver** l'attente, jamais de la
   recopier (`e2e/modules.spec.ts:18`, `e2e/support/locale.ts:12`) : c'est ce qu'il faut faire ici.

## Story visée

`s10-marketing-site` — « Consulter la page d'accueil et les mentions légales », complexité annoncée 2.

Critères d'acceptation (docs/stories.md:293) :

- page d'accueil composée de sections réutilisables (héros, fonctionnalités, témoignages, appel à l'action,
  FAQ) dont le **contenu et l'ordre** viennent d'un fichier de configuration typé (`config/marketing.ts`) ;
  réordonner ou retirer une section ne demande **aucune** modification de composant ;
- pages légales (confidentialité, conditions d'utilisation) existantes et **accessibles depuis le pied de
  page** ;
- chaque page expose titre, méta description et balises Open Graph ; `sitemap.xml` et `robots.txt` sont
  générés et listent les pages publiques ;
- les pages s'affichent **sans session** et n'émettent **aucune requête base de données** au rendu ;
- les pages sont traduites dans les locales livrées lorsque l'i18n est activée ;
- **module non activé** : la racine redirige vers la connexion, aucune page publique n'est servie, et
  `sitemap.xml` ne référence rien.

Dépendance : `s09-i18n` (livrée, commit `e917887`).

## État actuel du code

| Fichier | Ce qu'il fait aujourd'hui | Ce que s10 en fait |
|---|---|---|
| `apps/web/app/page.tsx` | tableau de bord ; branche anonyme affichant deux cartes « Se connecter / Créer un compte » | devient l'aiguillage : session → tableau de bord, anonyme → accueil marketing, anonyme sans module → redirection |
| `apps/web/app/layout.tsx` | polices, thème, `NextIntlClientProvider`, `AppShell` | inchangé |
| `apps/web/app/app-shell.tsx` | barre latérale, en-tête, `main` en `max-w-4xl` ; résout `currentViewer()` | inchangé |
| `apps/web/lib/locale-routing.ts` | **modèle** : seul fichier connaissant `@repo/module-i18n`, rend un `LocaleRouting` de forme constante | modèle recopié pour `lib/marketing.ts` |
| `apps/web/lib/navigation.ts` | navigation dérivée du registre, sans condition | reçoit l'entrée du module marketing sans être modifié |
| `config/features.ts` | annuaire + activés + socle | `marketingModule` ajouté à l'annuaire et aux activés (jamais au socle) |
| `config/i18n.ts` | `appLocales = ['fr','en']`, `defaultLocale = 'fr'` | inchangé |
| `packages/ui/src/index.ts` | 9 primitives copiées + 7 composés | reçoit `Accordion` (primitive de l'inventaire) et `MarketingSection` (composé annoncé par le design system pour s10) |
| `apps/web/messages/{fr,en}.json` | catalogue de l'application | perd les six clés `app.dashboard.anonymous.*`, devenues mortes |

Il n'existe aujourd'hui ni `app/sitemap.ts`, ni `app/robots.ts`, ni `config/marketing.ts`, ni aucune page
publique autre que les écrans d'authentification.

## Points d'ancrage

- **Le point de composition** : `apps/web/lib/marketing.ts`, sur le modèle de `lib/locale-routing.ts`.
  Il importe `config/marketing.ts` et `@repo/module-marketing`, regarde si `moduleRegistry.moduleIds`
  contient `marketingModule.id` (jamais `config/features.ts` en direct — `lib/locale-routing.ts:36` explique
  pourquoi), et rend un objet de **forme constante** : `{ sections, legalDocuments, publicPaths }`, tous
  vides module coupé. Aucun autre fichier de l'application ne connaît le module.
- **La racine** : `apps/web/app/page.tsx`. Trois branches, aucune ne nomme un module :
  `account !== null` → tableau de bord ; `sections.length > 0` → accueil marketing ; sinon
  `redirect(path('/sign-in'))`. La condition porte sur des **données**, exactement comme
  `localeOptions` teste `routing.locales.length < 2` (`apps/web/lib/navigation.ts:79`).
- **Les pages légales** : `apps/web/app/legal/[document]/page.tsx`. Un slug absent de la liste →
  `notFound()`. Liste vide module coupé → 404 sur tout. Le segment dynamique est ici une route **Next**,
  pas un `ModuleRoute` : la limite d'ADR 017 ne s'applique pas.
- **`sitemap.xml` / `robots.txt`** : `apps/web/app/sitemap.ts` et `apps/web/app/robots.ts`, conventions de
  fichier de Next (vérifiées dans le paquet installé, voir plus bas). Les deux dérivent des mêmes
  `publicPaths` : liste vide → aucune URL, et `robots` interdit tout au lieu de pointer un plan de site
  fantôme.
- **La navigation** : le module déclare une entrée publique vers `/`. Elle disparaît avec lui sans qu'aucun
  composant ne bouge — c'est `visibleNavigation` (`packages/core/src/protection.ts:46`) qui décide, et
  `e2e/modules.spec.ts:84` le vérifie déjà pour tous les modules.

## API et fonctions vérifiées (dans les paquets installés, jamais de mémoire)

| Ce qu'il faut | Ce qui existe réellement | Où |
|---|---|---|
| Plan de site | `export default function sitemap(): MetadataRoute.Sitemap` dans `app/sitemap.ts` ; entrées `{ url, lastModified?, changeFrequency?, priority?, alternates?: { languages } }` | `node_modules/next/dist/lib/metadata/types/metadata-interface.d.ts:577` et `dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/sitemap.md` |
| robots.txt | `export default function robots(): MetadataRoute.Robots` ; `{ rules: {userAgent, allow?, disallow?}, sitemap?, host? }` | même fichier, ligne 568, et `…/01-metadata/robots.md` |
| Mise en cache | « `sitemap.js` is a special Route Handler that is cached by default **unless it uses a Request-time API or dynamic config option** » | `…/01-metadata/sitemap.md` |
| Métadonnées de page | `generateMetadata(): Promise<Metadata>` avec `openGraph` | déjà employé dans `apps/web/app/layout.tsx:25` |
| URL publique | `getEnv().APP_URL`, optionnelle au schéma, exigée par qui en a besoin | `packages/config/src/env.ts` (bloc `APP_URL`) ; idiome de refus : `apps/web/lib/auth-config.ts:26` |
| Contrat de module | `defineModule({ id, requires, schema, migrations, routes, navigation, messages, emails, webhooks, jobs, dataCategories, retention, purge, export })` — **14 clés**, toutes obligatoires | `packages/core/src/module.ts:299` |
| Clés de traduction d'un module | qualifiées à la construction du registre : `marketing.` + la clé déclarée | `packages/core/src/registry.ts:65` |
| Refus d'une clé absente | `assertDeclarationsAreComplete` contrôle les libellés de navigation contre `config/i18n.ts` | `packages/core/src/validate.ts:163` |
| Redirection serveur | `redirect()` de `next/navigation`, `notFound()` idem | déjà employés ? non — premier usage du dépôt |

**Note sur le nombre de clés du contrat** : la consigne de lancement parle de « 13 clés ». Le contrat en
compte **14** (`packages/core/src/module.ts:299-338`). Le module les déclarera toutes.

**`APP_URL` et la phase de build.** `getEnv()` rend la source telle quelle, sans validation, pendant
`next build` (`packages/config/src/env.ts`, `isBuildPhase`) — la CI ne pose ni `APP_URL` ni `AUTH_SECRET`
pour `pnpm build` (`.github/workflows/ci.yml`, bloc `env`). Un `app/sitemap.ts` évalué au build lirait donc
`undefined`. Les deux fichiers de métadonnées doivent être **évalués à la requête**
(`export const dynamic = 'force-dynamic'`), et la résolution d'`APP_URL` doit refuser explicitement une
valeur absente en nommant la variable, sur le modèle de `resolveAuthConfig`.

## Pièges et contraintes

1. **`tests/rendered-text.test.ts` est une garde de couverture, pas seulement un détecteur.** La ligne
   `expect([...new Set(screens.map(s => s.file))].sort()).toEqual(pageFilesUnder(SCREEN_ROOT))` fait rougir
   la suite au seul ajout d'un `page.tsx`. Il faudra y déclarer la page légale **et** les nouveaux états de
   la racine (marketing activé / coupé), en enrichissant le mock de `viewerState`.
2. **Le catalogue pseudo-locale de `tests/fixtures/pseudo-locale.ts`** dérive un marqueur de chaque clé du
   catalogue réel. Une clé composée dynamiquement doit donc exister dans les catalogues, sans quoi
   `getMessageFallback` lève (`apps/web/i18n/request-config.ts`) et l'écran tombe en 500 — c'est exactement
   le mécanisme qui a fait tomber le sélecteur de langue en s09 (`apps/web/lib/navigation.ts:79`).
3. **Aucune couleur Tailwind brute, aucun composant hors inventaire** dans `packages/ui`
   (`packages/ui/AGENTS.md`). `Accordion` et `MarketingSection` sont tous deux **dans** l'inventaire de
   `docs/design-system.md` ; les copier est prévu, les inventer ne l'aurait pas été. Un pied de page n'y
   figure pas : il sera **composé** de primitives existantes (`Separator`, `<a>`, tokens sémantiques) dans la
   couche `presentation` du module, et le manque est signalé comme *design system gap*, pas comblé par une
   primitive maison.
4. **Radix ne sort pas de `packages/ui`** (ADR 022, garde de lint reprise dans neuf portées,
   `eslint.config.ts`). L'`Accordion` de shadcn est un composant client : c'est du JavaScript sur une page
   marketing, à assumer et à borner à la seule FAQ.
5. **`<form method>` littéral** (`eslint.config.ts`, `FORM_METHOD_SYNTAX`). s10 ne livre **aucun**
   formulaire — contact et newsletter sont s11 —, donc aucune surface concernée ; l'interdit reste actif si
   un formulaire apparaissait.
6. **Un module n'importe jamais `@repo/db`** (ADR 020, garde de lint sur `packages/modules/**`). Sans objet
   ici : marketing n'a ni schéma ni migration en s10 (`public_subscription` et `contact_message` sont la
   matière de s11, `docs/architecture.md`, tableau du modèle de données).
7. **Frontières de couches** (`tooling/eslint/boundaries.ts`) : `domain/` ne peut importer ni `react`, ni
   `next`, ni `@repo/ui`. Les règles pures (validation de la configuration, résolution des sections, calcul
   des entrées de plan de site) vivent donc dans `domain/`, les composants React dans `presentation/`.
   `zod` est **autorisé** dans `domain` (liste de refus explicite, commentaire de `domainForbiddenSources`).
8. **`config/features.ts` réordonne à la première bascule** (ADR 019) et `pnpm ks toggle` régénère toujours
   les barils : la bascule marketing produira `generated/schema/marketing.ts` (un baril vide, comme
   `generated/schema/i18n.ts`) et la CI compare l'arbre régénéré à l'arbre versionné.
9. **`e2e/modules.spec.ts:74` exige `disabledModules.length > 0`** : `demo-disabled` suffit dans les deux
   états, l'ajout de marketing ne change rien.
10. **La limitation de débit n'appartient pas à cette story.** `docs/security.md` §7 l'exige sur tout point
    d'entrée public, et `docs/architecture.md` dit explicitement qu'elle arrive en s28, qui **énumère** ses
    points d'entrée ; `docs/stories.md` le réaffirme deux fois (notes de s11 et de s13 : « la revendiquer ici
    produirait des critères invérifiables au ship »). s10 n'ajoute aucun formulaire public, donc aucune
    surface d'anti-automatisation. C'est une **limite déclarée**, pas un oubli.
11. **La politique de sécurité du contenu n'existe pas encore dans le dépôt** : `apps/web/next.config.ts` ne
    pose aucun en-tête. C'est un manque antérieur à s10 (à traiter par la story qui livre les en-têtes) ; la
    contrainte que s10 doit respecter est de **ne pas l'aggraver** — aucun script en ligne, aucune police ni
    image servie par un domaine tiers (`docs/design-system.md`, section Do/Don't).

## Questions ouvertes, tranchées ici pour le plan

**Q1 — Qui possède `/` ?** Les deux critères en tension : s08 « une fois connecté, l'utilisateur atteint un
tableau de bord » et s10 « module non activé : la racine redirige vers la connexion ».
**Tranché** : la racine est un aiguillage à trois branches (session → tableau de bord ; anonyme + sections →
accueil marketing ; anonyme sans sections → redirection). Les deux critères restent vrais, et les six
parcours de s07/s08 qui atteignent `/` connectés restent verts. L'alternative — déplacer le tableau de bord
en `/dashboard` — touche le repli de destination de l'écran de connexion, c'est-à-dire un écran
d'authentification explicitement hors périmètre de cette voie.

**Q2 — Les pages marketing sortent-elles de l'`AppShell` ?** **Non.** Le fait n°1 rend la sortie inutile
pour tenir le critère « aucune requête base de données », et la garder évite de réécrire les layouts de
`apps/web/app` (groupes de routes) et les quatre parcours qui atteignent `/` anonymement. Coût assumé et
écrit dans le design : les sections marketing vivent dans la colonne `max-w-4xl` du shell, et non en pleine
largeur. Un « chrome marketing » plein cadre est un *design system gap* signalé, pas improvisé.

**Q3 — Le pied de page.** Il appartient à s10 (`docs/stories.md:977`, finding F57 de la revue de s36) et
s'affiche sur les pages marketing. Il est rendu par la couche `presentation` du module, en fin de contenu de
page, et non dans le shell : dans le shell, il survivrait à la désactivation du module.

**Q4 — Où vit le contenu ?** `config/marketing.ts` porte la **structure et l'ordre** (identifiants de
sections, nature de chaque section, identifiants de leurs éléments, documents légaux). La **prose** vit dans
les catalogues du module (`messages/{fr,en}.json`), sans quoi le critère « traduites dans les locales
livrées » et la règle « aucun texte en dur » seraient contradictoires. Réordonner ou retirer une section
reste une édition d'une seule ligne de `config/marketing.ts`, ce que le critère demande.

## Complexité réelle

**2, comme annoncé** — mais le poids n'est pas là où le score le laisse croire. Il n'y a aucune règle métier,
aucune donnée, aucune migration : le travail est (a) un huitième module qui doit être exemplaire parce qu'il
est le premier à livrer des écrans publics, (b) trois branches à la racine qui sont le seul endroit du dépôt
où la modularité décide de ce qu'un visiteur voit, et (c) six commandes à faire passer **dans les deux
états**. Le risque principal est le n°5 des faits : un parcours existant qui suppose `/`.

## Proposition de découpe

Sans objet (verdict 2).
