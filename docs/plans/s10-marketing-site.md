---
validated: yes
---
# Plan — Story s10-marketing-site

Branch: `feature/s10-marketing-site`.
Research: `docs/research/s10-marketing-site.md` — à lire d'abord ; ce plan ne le répète pas.
Design: `docs/designs/s10-marketing-site.md` (+ maquette `.html`). Validation déléguée par le propriétaire.

## Target story

Le site public : accueil sectionné piloté par `config/marketing.ts`, pages légales, métadonnées et Open
Graph, `sitemap.xml` et `robots.txt`, le tout dans un **module optionnel** dont la coupure ne laisse aucune
page publique. Six critères, repris de `docs/stories.md:293`.

### Sections du socle de sécurité touchées (`docs/security.md`)

- **§4 Entrées et sorties** — Zod à la frontière de `config/marketing.ts` (une configuration est une
  frontière au même titre qu'un corps de requête) et sur le paramètre de route `[document]` des pages
  légales. Aucun `dangerouslySetInnerHTML` : la prose vient des catalogues et est rendue échappée.
- **§3 Autorisation** — le niveau de protection de l'entrée de navigation du module est déclaré `public` ;
  la racine ne divulgue rien d'un compte à un visiteur anonyme, et la redirection module coupé ne dépend
  d'aucun paramètre d'URL (pas de redirection ouverte).
- **§5 Secrets et configuration** — `APP_URL` lue par `@repo/config` uniquement, jamais `process.env` ;
  absence refusée en nommant la variable ; `sitemap.xml` et `robots.txt` n'exposent que des chemins
  publics.
- **§7 Journalisation, détection et abus** — **limite déclarée** : s10 n'ajoute aucun formulaire public,
  donc aucune surface d'anti-automatisation. La limitation de débit des points d'entrée publics est livrée
  et énumérée par s28 (`docs/architecture.md`, « Points de vigilance » ; notes de s11 et s13 dans
  `docs/stories.md`). La revendiquer ici produirait un critère invérifiable au ship.
- **§1 En-têtes** — hors périmètre et **non aggravé** : aucun script en ligne, aucune ressource tierce, ni
  police ni image externe. Le dépôt n'a pas encore d'en-têtes de sécurité ; c'est un manque antérieur à
  cette story.

### Sections du socle de fiabilité touchées (`docs/reliability.md`)

- **§2 Dégradation** — le module coupé dégrade sans casser : la racine redirige, les pages légales
  répondent 404, le plan de site est vide. Aucun tiers, aucune clé d'API n'entre dans cette story.
- **§4 Migrations** — sans objet et **dit comme tel** : le module ne déclare ni schéma ni migration en s10
  (`public_subscription` et `contact_message` appartiennent à s11). Le critère « aucune migration appliquée
  sur une base vierge » est donc vrai par construction, pas par une garde.

## Tasks (ordered)

1. [x] **Mesurer avant d'écrire : une visite anonyme émet-elle du SQL ?** Compteur posé sur `pool.query` et
   `pool.connect`, résolution de session sans cookie puis avec un cookie forgé. Si le compte n'est pas nul,
   le critère « aucune requête base de données au rendu » impose de sortir les pages marketing de
   l'`AppShell`, et tout le reste du plan change. *(Fait en recherche : compte nul dans les deux cas.)*
2. [x] **Le domaine du module, pur et testé d'abord.** Schéma Zod de `config/marketing.ts`, résolution
   ordonnée des sections, refus nommé d'une configuration invalide (nature inconnue, identifiant dupliqué,
   section qui attend des éléments et n'en a pas, document légal sans section), résolution d'un document
   légal par slug, et **la liste des clés de traduction qu'une configuration exige**. Aucun framework,
   aucun ORM, aucun React dans `domain/`.
3. [x] **Le plan de site et la politique des robots, en fonctions pures.** Entrées dérivées des chemins
   publics × locales servies, avec alternates ; liste vide → aucune entrée. Politique des robots : liste
   des chemins publics autorisée et le reste interdit quand il y a des pages, tout interdit et aucun plan
   de site sinon.
4. [x] **Le contrat de module**, ses quatorze clés, ses catalogues `fr`/`en`, son entrée de navigation
   publique. `schema: {}`, `migrations: null`, `routes: []`, `emails/webhooks/jobs/dataCategories` vides,
   `retention: {}`, `purge`/`export` inertes.
5. [x] **`Accordion` et `MarketingSection` dans `packages/ui`**, avec la dépendance Radix correspondante,
   les tokens sémantiques uniquement, et `packages/ui/AGENTS.md` mis à jour (le test des `AGENTS.md` exige
   que chaque dépendance déclarée y soit nommée).
6. [x] **La couche `presentation` du module** : sections, pages légales et pied de page, composés depuis
   `@repo/ui`, sans une chaîne écrite en dur — tout arrive par une clé du catalogue.
7. [x] **`config/marketing.ts`**, édité par le propriétaire, et **`apps/web/lib/marketing.ts`**, seul
   fichier de l'application qui connaisse `@repo/module-marketing` et qui rende une forme identique dans
   les deux états.
8. [x] **La racine à trois branches** (`apps/web/app/page.tsx`) et **la page légale**
   (`app/legal/[document]/page.tsx`), avec leurs `generateMetadata` (titre, description, Open Graph).
   Aucune branche ne nomme un module : la condition porte sur des données.
9. [x] **`app/sitemap.ts` et `app/robots.ts`**, évalués à la requête, `APP_URL` résolue par une règle qui
   refuse l'absence en nommant la variable.
10. [x] **Les filets existants, étendus et non contournés** : les nouveaux écrans déclarés dans
    `tests/rendered-text.test.ts`, la garde de clés composées dynamiquement, le parcours `e2e/i18n.spec.ts`
    dont l'attente sur `/` devient **dérivée** au lieu d'être recopiée.
11. [x] **Le module coupé, prouvé par commande** : la suite Vitest et le parcours end-to-end passent
    `marketing` activé **et** coupé, et le parcours dérive ses attentes de l'état — jamais une liste
    d'exceptions.
12. [x] **Nettoyage** : les six clés `app.dashboard.anonymous.*` deviennent mortes avec la branche qu'elles
    servaient ; les retirer des deux catalogues.
13. [x] **Vérification visuelle** de l'accueil et d'une page légale, clair et sombre, 1280 px et 380 px.
    Ajoutée en cours d'exécution parce qu'elle a trouvé deux défauts qu'aucune des six commandes ne
    voyait : les classes des composants du module n'étaient pas générées (`source(none)` + `@source`
    manquant) et un filet doublé au-dessus du pied de page. Trace dans
    `docs/designs/s10-marketing-site.md` ; le premier est désormais tenu par une règle exécutable
    (`tests/design-system.test.ts`).

## Run interdicts

- **Ne pas déplacer le tableau de bord ni toucher aux écrans d'authentification** (`app/sign-in`,
  `app/sign-up`, `app/forgot-password`, `app/reset-password`, `app/verify-email`, `app/auth-form.tsx`) ni
  au module `auth` : une autre voie y travaille. Leur diff doit rester vide.
- **Ne pas modifier `docs/STATE.md`.**
- **Ne pas modifier `apps/web/app/app-shell.tsx`, `app/layout.tsx`, `lib/navigation.ts`,
  `packages/core/**`, `packages/db/**`, `packages/cli/**`, `tooling/**`, `eslint.config.ts`** : si la
  story a besoin d'y toucher, c'est que le design est faux — s'arrêter et le dire.
- **Aucun `if (module === 'marketing')`** hors de `apps/web/lib/marketing.ts`. Toute autre condition porte
  sur des données (`sections.length`, `legalDocuments`).
- **Aucune migration, aucune table, aucun `db:push`.**
- **Aucun composant ni token hors de `docs/design-system.md`** ; un manque se signale dans le design.
- **Aucune chaîne affichée écrite en dur**, y compris dans `packages/ui`.
- **Ne pas désactiver, assouplir ni exclure un test existant** pour faire passer le module coupé : les
  attentes se dérivent.
- **Aucune exception d'audit ajoutée** pour faire passer `pnpm run audit`.

## The point everything turns on

**La racine `/` appartient à trois lecteurs à la fois**, et c'est là que tout peut casser.

Le pari : une seule page, trois branches, condition sur les données. Trois endroits où il peut être faux, et
ce à quoi les comparer :

- **Le compteur de requêtes SQL.** Si `AppShell` finit par lire la base pour un visiteur anonyme, le
  quatrième critère tombe sans qu'aucun écran ne change d'apparence. À comparer au compteur posé sur le
  pool, pas à une lecture de code.
- **Les parcours qui atteignent `/`.** Six d'entre eux existent (`e2e/health.spec.ts`,
  `e2e/i18n.spec.ts` ×3, `e2e/app-shell.spec.ts` ×4, `e2e/modules.spec.ts`). À comparer à leur exécution
  réelle dans les **deux** états de configuration, pas au raisonnement de ce plan.
- **La garde de couverture de `tests/rendered-text.test.ts`.** Elle égale la liste des écrans rendus à
  l'ensemble des `page.tsx` du disque : un écran ajouté sans y être déclaré fait rougir la suite, et un
  écran déclaré sans que ses états soient rendus passe sans rien prouver. À comparer au nombre de marqueurs
  observés, qui doit monter.

## Files touched

- Nouveaux : `packages/modules/marketing/**` (manifeste, `AGENTS.md`, `tsconfig.json`, `src/domain/*`,
  `src/application/*`, `src/presentation/*`, `src/messages/{fr,en}.json`, `src/module.ts`, `src/index.ts`),
  `config/marketing.ts`, `apps/web/lib/marketing.ts`, `apps/web/lib/site-url.ts`,
  `apps/web/app/legal/[document]/page.tsx`, `apps/web/app/sitemap.ts`, `apps/web/app/robots.ts`,
  `packages/ui/src/components/accordion.tsx`, `packages/ui/src/composed/marketing-section.tsx`,
  `tests/marketing.test.ts`, `e2e/marketing.spec.ts`, `generated/schema/marketing.ts` (généré),
  `docs/research/…`, `docs/designs/…`, `docs/plans/…`.
- Modifiés : `apps/web/app/page.tsx`, `apps/web/messages/{fr,en}.json`, `apps/web/AGENTS.md`,
  `config/features.ts`, `packages/ui/src/index.ts`, `packages/ui/package.json`, `packages/ui/AGENTS.md`,
  `apps/web/package.json`, `apps/web/next.config.ts` (`transpilePackages`), `package.json`,
  `pnpm-lock.yaml`, `tests/rendered-text.test.ts`, `e2e/i18n.spec.ts`.

## Test strategy

Deux fichiers de test neufs, et pas un de plus : `tests/marketing.test.ts` (Vitest) et
`e2e/marketing.spec.ts` (Playwright). Le reste s'ajoute aux fichiers existants.

- **Règles pures** (`domain`) — validation de configuration : chaque refus nommé, chaque acceptation.
  Ordre des sections = ordre de la configuration. Clés de traduction exigées par une configuration.
  Entrées de plan de site et politique des robots, dans les deux états.
- **Complétude des catalogues** — toute clé qu'une configuration exige existe dans **chaque** locale du
  projet. C'est le filet des clés composées dynamiquement, que le balayage statique de `tests/i18n.test.ts`
  ne voit pas.
- **Modularité** — registre construit **par le test** sans `marketing` : aucune entrée de navigation,
  aucune clé `marketing.*` dans le catalogue, aucun chemin public, plan de site vide. Vrai quel que soit
  l'état de `config/features.ts`.
- **Écrans** — la racine dans ses trois branches et la page légale dans ses deux issues, rendues ;
  la garde de couverture de `tests/rendered-text.test.ts` étendue.
- **Aucune base de données** — compteur sur le pool pendant une résolution de session anonyme : zéro.
- **Navigateur** — `sitemap.xml` et `robots.txt` réellement servis et cohérents avec l'état ; balises de
  titre, description et Open Graph présentes ; les liens du pied de page mènent aux pages légales ; le
  parcours **dérive** ses attentes de l'état du module.
- **Les deux configurations** — les six commandes exécutées `marketing` activé, puis coupé
  (`pnpm ks toggle marketing`), puis réactivé.

## Definition of Done

Les six critères satisfaits, chacun couvert par un test ou une vérification visuelle tracée.
`pnpm typecheck`, `pnpm lint --max-warnings=0`, `pnpm test`, `pnpm test:e2e`, `pnpm build`,
`pnpm run audit` verts **dans les deux états** du module. Aucun interdit violé. Un seul commit sur
`feature/s10-marketing-site`, message impératif en français, portant recherche, design, plan et code.
Chaque invariant revendiqué a été neutralisé et le rouge observé.
