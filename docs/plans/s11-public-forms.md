---
validated: yes
---
# Plan — Story s11-public-forms

Branch: `feature/s11-public-forms`. Base Postgres `s11`, parcours sur `E2E_PORT=3111`.
Research: `docs/research/s11-public-forms.md` — à lire d'abord ; ce plan ne le répète pas.
Design: `docs/designs/s11-public-forms.md` (+ maquette `.html`). Validation déléguée par le propriétaire.

## Target story

Contact et inscription newsletter : les **premiers formulaires du dépôt ouverts à tout venant**.
Quatre critères (`docs/stories.md`, s11) — email de contact vers l'adresse **configurée** avec
confirmation et erreur de champ ; inscription dans une table d'inscriptions publiques portant une
colonne de source, doublons refusés sans erreur visible ; email de confirmation ; module coupé,
aucune route, aucun lien, aucune table sur une base vierge.

### Sections du socle de sécurité touchées (`docs/security.md`)

- **§4 Entrées et sorties** — Zod sur **les deux corps de requête** et sur le nouveau bloc `forms`
  de `config/marketing.ts` (une configuration est une frontière). Requêtes paramétrées
  uniquement : tout passe par Drizzle. Rendu échappé — aucun `dangerouslySetInnerHTML`, et le
  corps d'email est rendu par React Email, dont l'échappement est déjà prouvé
  (`packages/emails/src/render.test.ts`). **Aucune donnée utilisateur n'entre dans un champ
  d'en-tête d'email** : `to` vient de la configuration ou d'une adresse validée par `z.email()`,
  `subject` est celui que le module déclare pour la locale, sans interpolation.
- **§5 Secrets et configuration** — l'adresse de destination du contact est de la
  **configuration**, jamais une constante (piège nommé par la story) ; aucune lecture de
  `process.env` ajoutée ; aucune réponse d'erreur ne porte de trace, de nom de table ni de
  message de fournisseur.
- **§7 Journalisation, détection et abus** — **limitation de débit** sur les deux points
  d'entrée, **partagée entre instances** par un compteur PostgreSQL ; **anti-automatisation**
  par piège à robots et seuils configurables ; **aucune énumération** — adresse nouvelle,
  adresse déjà inscrite et adresse malformée reçoivent la même réponse, au même statut ; l'envoi
  de l'email de confirmation est sorti du temps de réponse pour que la latence ne trahisse pas
  le cas.
  **Écart déclaré** : `docs/security.md` §7, `docs/architecture.md` et
  `packages/modules/marketing/AGENTS.md` renvoient la limitation de débit à **s28**. Elle est
  livrée ici sur consigne explicite de la voie, dans une table du module `marketing`, sans
  créer ni le port `RateLimiter`, ni le module `ratelimit`, ni la table `rate_limit_window` que
  s28 possède. La dette de convergence est écrite dans la recherche §1 et dans l'`AGENTS.md` du
  module.
- **§1 En-têtes et CSP** — **non aggravée, et c'est une contrainte de conception** : rien de ce
  qui est ajouté ne demande une source tierce, un script en ligne ou un attribut `style`. Le
  piège à robots est masqué par une classe de la feuille de style, pas par un style en ligne
  (`style-src-attr` ignore les nonces). Vérifié au navigateur **sous le build de production**.
- **§3 Autorisation** — les deux routes déclarent `protection: { level: 'public' }`, et c'est le
  répartiteur qui l'applique. Rien de ce qui est ajouté ne lit une session.

### Sections du socle de fiabilité touchées (`docs/reliability.md`)

- **§1 Idempotence** — l'unicité `(source, email)` est **en base**, jamais une vérification
  préalable : deux soumissions identiques donnent une inscription et **un seul** email. La
  migration est rejouée deux fois sans effet supplémentaire.
- **§2 Dégradation** — mailer en panne : l'inscription reste enregistrée (l'envoi est hors du
  temps de réponse), le contact répond une erreur explicite sans 500. Base injoignable : la
  soumission échoue proprement. Aucune clé de fournisseur n'est nécessaire en local
  (`EMAIL_LOCAL_CAPTURE=1`), et aucun repli n'est deviné.
- **§4 Migrations** — migration **additive** : deux tables créées, rien d'altéré, rien de
  supprimé. Couper le module ne supprime aucune table.

### Décision structurante ouverte en cours d'exécution

**ADR 027 — un formulaire interactif d'un module vit dans `apps/web`.** Le plan
supposait que le composant vivrait dans `packages/modules/marketing/src/presentation`.
`eslint.config.ts` refuse `fetch` dans un module (règle de s12, adossée à
`docs/reliability.md` §3) et `tests/module-registry.test.ts` l'a mesuré. Le
composant a donc rejoint `apps/web/app/public-form.tsx`, où vit déjà
`auth-form.tsx` depuis s07 ; le module garde la règle, la route, ses clés et la
**place** du formulaire, qu'il reçoit en `ReactNode`. Numéro 027 réservé par
l'orchestrateur pour cette vague.

### Ce que ce plan ne fait pas

- pas de table `contact_message` (recherche §6.1, déviation déclarée) ;
- pas de captcha, pas de source CSP, pas de `config/security.ts` ;
- pas de consultation ni d'export CSV des inscrits — c'est s37 ;
- aucun fichier des modules `auth` et `organizations`, aucun
  `apps/web/proxy.ts`, `config/security.ts`, `playwright.config.ts` ni `docs/STATE.md`.
  **Exception nécessaire et déclarée** : `apps/web/lib/organizations.ts` gagne le segment
  `contact` à `APPLICATION_SEGMENTS` — c'est le point de composition de l'application, pas le
  module, et `tests/organizations.test.ts` dérive cette liste du disque : sans la ligne, ajouter
  `app/contact/page.tsx` fait rougir `pnpm test`.

### Budget de fichiers de test

Deux fichiers nouveaux, et deux seulement :
`packages/modules/marketing/src/application/public-forms.test.ts` (les règles) et
`e2e/public-forms.spec.ts` (le navigateur). Tout le câblage est **replié** dans
`tests/marketing.test.ts`, qui existe déjà et porte ce rôle.

## Tasks

- [x] **1. Le domaine des formulaires publics.** `src/domain/public-forms.ts` — schémas Zod des
  deux soumissions (`z.email()`, longueurs bornées, refus des caractères de contrôle dans les
  champs libres), normalisation de l'adresse (`trim` + minuscules) pour que la contrainte
  d'unicité voie la même chaîne, détection du champ piège, et le type de refus discriminé rendu
  aux cas d'usage. **Comportement, TDD.** Cas qui doivent mordre : adresse malformée refusée,
  `"a@b.co\r\nBcc: x@y.co"` refusée, message vide refusé, message de 20 000 caractères refusé,
  `"  A@B.CO "` et `"a@b.co"` normalisées identiquement, champ piège rempli → refus `automated`.
- [x] **2. Le domaine du seau de limitation.** `src/domain/rate-limit.ts` — fenêtre fixe :
  début de fenêtre dérivé d'un instant et d'une durée (fonction pure), clé de seau
  (`<forme>:<condensat>` et `<forme>:*` pour le seau global), verdict `allowed` / `exceeded` à
  partir du compte rendu par la base et du seuil. Condensat SHA-256 de l'identifiant d'appelant
  — la table ne porte aucune IP en clair. **Comportement, TDD.** Cas : deux instants de la même
  fenêtre donnent le même début, l'instant suivant en donne un autre ; au seuil, encore autorisé ;
  seuil + 1, refusé ; deux identifiants différents ne partagent pas de seau.
- [x] **3. La configuration `forms`.** `src/domain/marketing-config.ts` gagne le bloc `forms`
  (`contactRecipient` validée par `z.email()`, `newsletterSource` en `kebab-case`,
  `rateLimit: { windowSeconds, maxPerClient, maxPerForm }` entiers ≥ 1), et
  `config/marketing.ts` le renseigne. `resolveMarketingSite` expose `forms` et ajoute
  `/contact` à `publicPaths` ; `EMPTY_MARKETING_SITE.forms` vaut `null`. **Comportement, TDD** :
  chaque refus est nommé (bloc absent, adresse malformée, seuil à zéro, source non `kebab-case`),
  et `publicPaths` contient `/contact` module activé, rien module coupé.
- [x] **4. Les tables et la migration.** `src/schema.ts` — `public_subscription`
  (`id`, `email`, `source`, `locale`, `created_at`, **unique(`source`,`email`)**, index sur
  `source`) et `public_form_throttle` (`bucket` clé primaire, `window_started_at`, `hits`).
  `pnpm db:generate`, migration versionnée, `migrations` déclarée au contrat. **Comportement,
  TDD** dans `tests/marketing.test.ts` : sur une base vierge **sans** le module, aucune des deux
  tables ; avec le module, les deux ; `db:migrate` rejoué ne change rien.
- [x] **5. Les cas d'usage.** `src/application/ports.ts` (repository d'inscriptions, seau,
  `Mailer`, horloge, résolveur d'adresse d'un périmètre) et
  `src/application/public-forms.ts` — `submitContact`, `subscribeToNewsletter`,
  `purgeSubscriptions`, `exportSubscriptions`. **Comportement, TDD**, sur doublures en mémoire
  (le réseau, jamais la règle) : contact valide → un envoi au destinataire **de la
  configuration**, sujet non interpolé ; contact invalide → **aucun envoi** ; piège rempli →
  issue `accepted` et **ni écriture ni envoi** ; newsletter nouvelle → une ligne et un envoi ;
  newsletter rejouée → **une seule** ligne et **un seul** envoi ; adresse malformée, adresse
  déjà inscrite et adresse nouvelle → **la même issue** ; au-delà du seuil → `rate-limited`,
  ni écriture ni envoi ; mailer en échec sur la newsletter → l'inscription reste ; mailer en
  échec sur le contact → issue `mail-failed`, jamais une exception.
- [x] **6. L'infrastructure.** `src/infrastructure/drizzle-public-forms.ts` — inscription par
  `onConflictDoNothing({ target })` + `returning()` (l'idempotence est portée par la contrainte,
  pas par un `select` préalable) ; seau par insertion avec `onConflictDoUpdate` et incrément
  conditionné à la fenêtre, en **une** instruction atomique. `src/infrastructure/marketing-runtime.ts` —
  `provideMarketing` / `requireMarketingService` / `resetMarketingService`, patron de
  `organizations-runtime.ts` : rien n'est construit à l'import. **Comportement, TDD** contre la
  base `s11` (le fichier de test saute proprement si la base est injoignable, comme
  `tests/marketing.test.ts` le fait déjà) : deux insertions concurrentes de la même adresse →
  une ligne ; deux seaux concurrents → deux incréments, pas un.
- [x] **7. Les routes du module.** `src/presentation/public-forms-routes.ts` — `POST
  /marketing/contact` et `POST /marketing/newsletter`, `protection: { level: 'public' }`,
  identifiant d'appelant lu dans les en-têtes, corps JSON **et** formulaire encodé, traduction
  des issues en statuts (200 accepté, 400 champ nommé pour le contact seul, 429 au-delà du
  seuil, 502 quand l'email n'est pas parti). **Comportement, TDD** dans
  `tests/marketing.test.ts` : module coupé, les deux chemins répondent **404 par le
  répartiteur** — même corps, même statut qu'un chemin inventé ; module activé, la route
  newsletter rend **exactement** la même réponse pour trois adresses de nature différente.
- [x] **8. Le contrat de module rempli.** `src/module.ts` — `schema`, `migrations`, `routes`,
  `dataCategories: ['subscription']`, `retention: { subscription: 'erase' }`, `emails` (deux
  templates × deux locales), `purge`, `export` branchés sur les cas d'usage. **Comportement,
  TDD** : export d'un compte inscrit rend son inscription, purge l'efface, et un périmètre
  organisation ne rend rien.
- [x] **9. La présentation et les écrans.** `Textarea` copié dans `packages/ui` (inventaire du
  design system, précédent `Accordion`) ; `src/presentation/public-form.tsx` — le formulaire
  client partagé, `method="post"` en littéral, bouton désactivé jusqu'à l'hydratation, champ
  piège masqué par classe, retours en `Alert` avec `role="status"` / `role="alert"` ;
  nature de section `newsletter` dans `MarketingHome` ; `MarketingFooter` gagne le lien
  `/contact` dérivé de `marketingSite` ; `apps/web/app/contact/page.tsx` ; catalogues `fr`/`en`
  du module ; `apps/web/lib/organizations.ts` réserve `contact`. **Comportement, TDD** :
  le nouvel écran entre dans `tests/rendered-text.test.ts` avec son champ `refuses` **dérivé**
  de `marketingSite` (404 module coupé), et `tests/marketing.test.ts` exige que `/contact` soit
  autorisé aux robots dans chaque langue tandis que les écrans applicatifs restent fermés.
- [x] **10. Le câblage de l'application.** `apps/web/lib/marketing.ts` fournit au module sa
  connexion, son mailer, son horloge et le résolveur d'adresse d'un périmètre — **sans rien
  construire** ; `apps/web/lib/module-services.ts` l'appelle. **Comportement, TDD** : le rendu
  des pages publiques n'émet **toujours** aucune requête base de données (le cas existant doit
  rester vert, et il mord — le fichier prouve son propre compteur), et une soumission servie par
  le répartiteur trouve le module configuré.
- [x] **11. Les parcours et la documentation.** `e2e/public-forms.spec.ts` — attentes
  **dérivées** de `marketingSite` pour passer dans les deux configurations : inscription depuis
  l'accueil et email de confirmation capturé, seconde inscription identique sans second email,
  envoi d'un message de contact et email reçu à l'adresse configurée, champ invalide qui
  n'envoie rien, page `/contact` absente module coupé. `packages/modules/marketing/AGENTS.md`
  mis à jour (tables, routes, seuils, dette s28, ce qui n'est **pas** livré) ;
  `apps/web/AGENTS.md` pour le nouveau point de composition ; `packages/ui/AGENTS.md` pour
  `Textarea`.

## Run

- `pnpm typecheck`, `pnpm lint --max-warnings=0`, `pnpm test`, `E2E_PORT=3111 pnpm test:e2e`,
  `pnpm build`, `pnpm run audit` — **module `marketing` activé et coupé**, puis remis en marche,
  `config/features.ts` et `generated/` vérifiés identiques après aller-retour.
- `pnpm db:migrate` deux fois de suite : la seconde n'applique rien.
- Vérification au navigateur : `/` et `/contact`, clair et sombre, 1280 px et 380 px, **plus le
  build de production** pour la politique de sécurité du contenu (aucun attribut `style`, aucune
  violation en console).

## Run interdicts

- ne pas assouplir un test existant pour le faire passer : une attente se **dérive**, elle ne se
  concède pas (constat F4 de la revue de s10) ;
- ne pas écrire de condition sur l'identifiant d'un module hors de `apps/web/lib/marketing.ts` ;
- ne pas ajouter de source CSP, ne pas toucher `config/security.ts` ;
- ne pas créer de port `RateLimiter`, de module `ratelimit` ni de table `rate_limit_window` ;
- ne pas laisser une mutation en place : elle se restaure juste après avoir été mesurée.
