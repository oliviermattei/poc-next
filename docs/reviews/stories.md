# Revue des stories : killer-boilerplate (ronde 8)

> Relecture en contexte neuf (subagent `stories-reviewer`) de `docs/stories.md`, contre `docs/prd.md`, en suivant `templates/stories-review-checklist.md`. Tout le découpage est relu : 70 entrées, dont `s37` et `s37b` marquées « DÉCOUPÉE ». L'examen le plus serré porte sur s60–s64. La partition de s61 et les références de fichiers et de lignes ont été vérifiées sur le disque. Les constats reprennent la numérotation à F77 ; la ronde 7 est dans l'historique git de ce fichier.

## Couverture du périmètre

| Fonctionnalité du PRD (core loop) | Couverte par | OK ? |
|---|---|---|
| Système de modules + `config/features.ts` + CLI toggle | s03, s04, s05 (+ s58) | ✅ |
| Auth | s07, s12, s13, s14, s46, s56 | ✅ |
| Multi-tenant | s15, s16, s17 | ✅ |
| Billing Stripe | s19, s20, s21, s23, s47 | ✅ |
| Admin back-office | s37a, s37b1, s37b2, s37c, s38, s60 (console, tableau de bord) | ✅ |
| Emails transactionnels | s06, s09 | ✅ |
| App shell (dashboard, nav, dark mode, réglages compte/org, profil, avatar) | s08, s15, s18, s61, s62 (zone Réglages), s63 | ✅ |
| Marketing | s10, s11, s22, s53, s61 (en-tête du site) | ✅ |
| Blog MDX | s29, s53 | ✅ |
| Docs produit | s30, s54 | ✅ |
| Changelog | s31 | ✅ |
| i18n | s09 | ✅ |
| Stockage de fichiers | s18 | ✅ |
| Notifications in-app | s32 | ✅ |
| Jobs & cron | s33 | ✅ |
| Déploiement | s27, s59, s64 (hôtes facultatifs) | ✅ |
| Pack RGPD | s34, s34b, s35, s36 | ✅ |
| Rate limiting + anti-bot | s28 | ✅ |
| Guest checkout | s24 | ✅ |
| Serveur MCP | s41 | ✅ |
| Monitoring + analytics | s39 | ✅ |
| Onboarding | s40 | ✅ |
| Plugins bonus | s42, s43, s44 (reportées par le porteur, voir F74) | ✅ (stories présentes) |
| Tooling & DX | s01, s02, s48, s50, s51, s52, s55, s58 | ✅ |

- [x] Chaque ligne du tableau « Replicated » est livrée par au moins une story : 24/24. Le remplacement de s60–s62 par s60–s64 ne retire rien.

## Périmètre
- [x] Aucune fuite du cimetière :
  - la console s60 lit des données existantes, ce n'est pas un journal d'audit ;
  - s61 porte sur le site du SaaS généré, pas sur un « site de vente » ;
  - s64 n'ajoute ni provider, ni table, ni `eject`.
- [~] Débordement : les hôtes dédiés par zone (s64) ne figurent dans aucune ligne du PRD. La décision n'est écrite que dans le préambule de la story (F88).

## Qualité des stories
- [~] Tranches livrables : oui pour s60–s64. Mais s61 n'est pas exécutable seule : sa partition renvoie à s62/s63 (F77).
- [~] Critères testables : plusieurs se contredisent entre eux ou avec des stories livrées :
  - s61, critères 1 et 3 (F78) ;
  - s61, critères 2 et 8 (F79) ;
  - s63, critère 1 face à s60 (F81) ;
  - s64, critères 3 et 4 (F82).
- [~] Notes agentiques : présentes, et les références sont presque toutes exactes. Deux défauts :
  - une référence fausse dans s60 (F83) ;
  - des pièges absents : éléments transverses de l'`AppShell` (F80), groupes de routes (F87), passkeys et `baseURL` sur plusieurs hôtes (F82).
- [~] Complexité : s62 et s64 sont cotées 4 et énoncent leur risque. s64 porte deux valeurs aux propriétés de sécurité distinctes et touche des systèmes externes (URI de rappel OAuth, retours Stripe, `rpID` des passkeys) : à découper, ou à recoter 5 (F82).

## La liste dans son ensemble
- [~] Ordre exécutable : pas de cycle. s60 → s37b2, s37c, s38 ; s61 → s07, s08, s10, s22, s29, s30, s40 ; s62 → s61 ; s63 → s61, s62 ; s64 → s60, s63. Il reste :
  - une référence en avant dans s61, vers s62/s63 et vers la console de s60 dont elle ne dépend pas (F77) ;
  - des champs `Dependencies` incomplets (F85).
- [x] Ids : bien formés, uniques. L'extension à suffixe est désormais écrite dans l'en-tête (ligne 5).
- [~] Recouvrements :
  - s62 et s63 portent deux mécanismes concurrents pour la table des 308 (F86) ;
  - s63 capture, à la lettre, les écrans de la console de s60 (F81).

## Vérification des références (s60–s64)

| Affirmation | Constaté | OK ? |
|---|---|---|
| `NavigationSurface` en `packages/core/src/module.ts:251` | exact (`'app' \| 'footer' \| 'admin'`) | ✅ |
| `apps/web/lib/back-office.ts:67` | exact (`visibleNavigation(moduleRegistry, session, 'admin')`) | ✅ |
| `ADMIN_USERS_SCREEN_PATH` à `admin-routes.ts:513`, `asSuperadmin` à `:182` | exact | ✅ |
| Chemins `ADMIN_*` répartis dans quatre modules | exact : admin, organizations (`organization-routes.ts:74`), billing (`billing-routes.ts:60`), marketing (`public-form-routes.ts:41`) | ✅ |
| `reservedSlugs` (`apps/web/lib/organizations.ts:194`) « dérive les segments du disque » | **faux** : la ligne 194 est `APPLICATION_SEGMENTS`, une liste écrite à la main. `reservedSlugs` est à la ligne 284. C'est le test qui dérive du disque | ❌ F83 |
| Aucune organisation adressée par URL | exact : le seul segment dynamique de tête est `blog/[slug]` | ✅ |
| `apps/web/app/page.tsx` : quatre sorties, deux vers `/app` | exact (l. 83 onboarding, l. 86 tableau de bord, l. 107 connexion, l. 110 accueil) | ✅ |
| `sign-in/page.tsx:145`, `auth-form.tsx:181` | exact (`destination` est calculée l. 58 et passée l. 145 ; `window.location.assign` l. 181) | ✅ |
| `app/app-shell.tsx` entoure tous les écrans | exact. Il porte aussi `ConsentBanner`, `ConsentScripts` (nonce) et `ImpersonationBanner`, qu'aucune note ne cite | ✅, voir F80 |
| `trustedOrigins: [options.appUrl]` à `better-auth-service.ts:603` | exact. À `:985-988`, `passkey({ rpID: hostname(appUrl), origin: appUrl })`, et le commentaire l. 965 : « Changer l'hôte d'`APP_URL` invalide toutes les passkeys déjà enregistrées » | ✅, voir F82 |
| Cinq fichiers de route Next hors répartiteur | exact : health, i18n-probe, csp-report, consent-probe, billing-local-checkout | ✅ |
| `proxy.ts` applique le préfixe de langue | exact | ✅ |

**Partition de s61 contre le disque.** Segments relevés dans `apps/web/app/**/page.tsx` :
- **Site (9)** : `/`, blog, docs, pricing, changelog, contact, legal, cookies, waitlist. Tous présents dans la table.
- **Hors zone (8)** : sign-in, sign-up, forgot-password, reset-password, verify-email, two-factor, oauth/return, invitations/accept. Tous présents.
- **Aucune zone nommée** : account, billing, organizations, notifications, onboarding, premium, et `admin/*` (six écrans). Ils ne sont couverts que par « ce que s62/s63 y placent » et par `/console/*` (s60), voir F77.

## Statut des constats de la ronde 7

| Constat | Statut |
|---|---|
| F66 | **Reformulé, en grande partie résolu**. La table de partition existe. La contradiction de s62 sur les liens d'email est levée (note de s62 : ils visent des écrans Hors zone). Le reste devient F77 |
| F67 | **Résolu** : critère 5 de s61, destination par défaut plus liste blanche, et s07 est déclaré amendé |
| F68 | **Résolu** : s38 → s37b2 ; s42, s43, s44 → s37a. Plus aucune dépendance vers `s37-admin-users` |
| F69 | **Résolu** : `auth /sign-in` passe en `site`, `demo-enabled` reste en `app`. Il en découle F78 |
| F70 | **Résolu** : critère 6 de s61 |
| F71 | **Passé en note** (s60, s62). La note de s60 est inexacte (F83) |
| F72 | **Résolu** : extension écrite en l. 5, `s34b-ecrans-rgpd` corrigé, une seule section de notes dans s34, s55 déplacée |
| F73 | **Résolu** : paragraphe « amende » dans s60, notes de s37b et s37b2 à jour. La question du lien écrit à la main disparaît avec la décision « aucun lien » |
| F74 | **Toujours ouvert**, laissé ouvert délibérément (décision de PRD) |
| F75 | **Résolu** : tous les critères de s59 portent « Recette manuelle » |
| F76 | **Résolu** pour s07, s22, s29, s30. Un résidu figure en F85 |

Hérités des rondes précédentes, non touchés par cette édition : F59 et F64 restent ouverts. **F60 aussi, et il a maintenant une conséquence** : F79.

## Constats

**F77, major. s61 : partition non exhaustive au moment où s61 sera livrée, par une référence en avant.**
- **Ce que dit la story.** La table se dit « exhaustive sur les segments de `apps/web/app` », mais la zone Application vaut « `/app` et ce que s62/s63 y placent ».
- **Ce qui reste sans zone.** Tant que s62 et s63 ne sont pas livrées, `/account`, `/billing`, `/organizations`, `/notifications`, `/onboarding` et `/premium` restent à la racine, sans zone ni gabarit. `/admin/*` aussi, si s60 n'est pas livrée d'abord, et s61 ne dépend pas de s60.
- **Conséquence.** Le test du critère 2 (« chaque écran appartient à exactement une zone ») ne peut pas passer à la livraison de s61.
- **Correctif.** Nommer ces six segments dans la zone Application (gabarit application, chemins inchangés jusqu'à s62/s63). Pour la console, ajouter s60 aux dépendances de s61, ou ranger `/admin/*` dans la zone Console en attendant.

**F78, major. s61, critères 1 et 3 : non satisfaisables ensemble avec le contrat actuel.**
- **Le mécanisme.** `satisfiesProtection` montre une entrée `public` à tout le monde (`packages/core/src/protection.test.ts:84-92`). Il n'existe pas de niveau « anonyme seulement ».
- **« Se connecter ».** L'entrée `auth /sign-in`, déclarée `site`, restera donc visible pour un connecté, ce que le critère 3 interdit.
- **« Ouvrir l'application ».** Aucun module ne la déclare : `/app` est un écran de `apps/web`. Elle serait donc écrite à la main, ce que le critère 1 et `apps/web/AGENTS.md` interdisent.
- **Correctif.** La story doit trancher : nouvelle visibilité au contrat (avec un ADR), ou exception nommée.

**F79, major. s61, critère 8 contre critère 2 : l'en-tête disparaît avec `marketing`, pas les pages du site.**
- **Le constat.** `blog`, `docs`, `changelog` et `billing` déclarent `requires: []`. La configuration « site public coupé, blog activé » est valide et déjà mesurée par s53.
- **Ce que produit le critère 8.** Dans cette configuration, `/blog`, `/docs` et `/pricing` sont rendus sans en-tête ni barre latérale. Cela contredit le critère 2, et leurs entrées `site` ne sont rendues nulle part.
- **Correctif.** Dire à qui appartient l'en-tête : dérivé du registre, il existe dès qu'une entrée `site` existe. Et limiter le critère 8 à la redirection de `/`.

**F80, major. s61 (et le shell de console de s60) : les éléments transverses de l'`AppShell` ne sont garantis dans aucun des quatre gabarits.**
- **Ce que porte l'`AppShell` aujourd'hui** (`app-shell.tsx` l. 1-2, 213, 256-257) :
  - `ConsentBanner` et `ConsentScripts` avec le nonce (s36, socle légal non désactivable) ;
  - `ImpersonationBanner` (s37b1 : « taire un emprunt en cours serait pire ») ;
  - la réserve `pb-64` de la bannière.
- **Le risque.** Découper en `(site)`, `(auth)`, `app/` et console peut faire perdre la bannière de consentement sur une zone, ou le bandeau d'emprunt sur le site, sans qu'aucun critère ne rougisse.
- **Correctif.** Un critère exige ces éléments dans chaque gabarit concerné. La note rappelle que `tests/marketing.test.ts` compte les connexions au rendu du shell et doit suivre le nouveau gabarit du site.

**F81, major. s63, critère 1 : à la lettre, il déplace la console sous `/app`.**
- **Le constat.** « Chaque écran qu'un module déclare `authenticated`, `role` ou `entitlement` » inclut les quatre entrées de la console. Elles sont déclarées `protection: { level: 'authenticated' }` (`admin-routes.ts:536`, `organization-routes.ts:308`, `billing-routes.ts:327`, marketing `module.ts:57`).
- **Ce que cela casse.** Le critère 2 dériverait alors des 308 depuis `/console/*`. Cela contredit le 404 sans redirection de s60, la zone Console de s61 et le mapping de s64.
- **Correctif.** Exclure explicitement la surface `console`, et ajouter s60 aux dépendances : le critère 3 cite déjà la console.

**F82, major. s64 : le mapping d'hôtes est sous-spécifié, et la séparation de session de la console n'est pas cohérente.**
- **a) Le mapping prend tout le chemin.** Le critère 4 envoie `console.<domaine>/x` vers `/console/x` pour tout `x`, `/api/*` et `/_next/*` compris ; le critère 3 fait de même pour l'hôte de l'application.
  - Or l'API ne bouge pas (s63).
  - Et les écrans Hors zone ne sont servis que sur l'hôte de l'application : l'hôte console n'a **ni écran de connexion, ni API d'auth joignable**. Le superadmin ne peut pas « s'y connecter séparément ».
- **b) La séparation est cosmétique.** `/api/modules/admin/*` reste servi sur l'hôte de l'application avec la session de l'application. Bannir ou emprunter reste possible sans la session console. La propriété « une session de l'application n'ouvre pas la console » doit couvrir l'API d'administration, ou être réécrite.
- **c) L'emprunt (s37b1) casse.** Lancé depuis l'hôte console, il pose un cookie host-only sur un hôte qui ne sert aucun écran applicatif.
- **d) Better Auth n'a qu'une URL.** `baseURL`, les URI de rappel OAuth, les liens d'email, puis `rpID` et `origin` des passkeys (`better-auth-service.ts:985-988`) sont liés à une seule URL. Le code l'écrit (l. 965) : changer l'hôte d'`APP_URL` invalide toutes les passkeys, sans migration. La story ne dit pas quel hôte `APP_URL` désigne après s64, ni comment une passkey fonctionne sur l'hôte console. s14 n'est pas citée.
- **e) Les retours `?next=` changent d'hôte.** `/sign-in?next=/pricing?offer=…` (s22/s24, parcours doré) part de l'hôte de l'application et revient vers une page du site, sur un autre hôte. `safeRedirectPath` ne connaît que des chemins, et l'élargir est une surface de redirection ouverte. Ce n'est pas traité.
- **f) Trois pièges de sécurité à écrire :**
  - « l'hôte de leur zone » (critère 6) doit venir de la configuration, jamais de l'en-tête `Host` (empoisonnement de lien de réinitialisation, `apps/web/AGENTS.md`) ;
  - aucune variable ne nomme l'hôte du site, alors que le critère 5 en dépend ;
  - le refus des hôtes inconnus doit épargner `/api/health`, sondé en `localhost` par l'orchestrateur.
- **g) Les cookies `app_consent` et `app_locale` sont host-only.** Le consentement donné sur le site ne vaut pas sur l'application (s36).
- **Recommandation.** Découper en deux stories, `APP_HOST` puis `CONSOLE_HOST`. Ou recoter 5, ce qui impose le découpage.

**F83, minor. s60, note : référence inexacte.**
- `apps/web/lib/organizations.ts:194` est `APPLICATION_SEGMENTS`, une liste écrite ; `reservedSlugs` est à la ligne 284. Ce n'est pas `reservedSlugs` qui « dérive du disque » : c'est `tests/organizations.test.ts`.
- Conséquence pratique : `console` sera réservé par le `href` de navigation (`firstSegmentOf`), mais `admin` ne « sort » pas tout seul. Il faut le retirer à la main d'`APPLICATION_SEGMENTS`.

**F84, minor. Amendements non déclarés (même forme que F73).**
- s62 change les chemins et la surface de s08 (menu de compte), s15, s16, s17 (`/organizations`), s18 (avatar dans `/account`), s19 (`/billing`), s32 (préférences sur `/notifications`), s34b et s36 (carte « Cookies » de `/account`), sans paragraphe « Cette story amende… ».
- s63 amende s21 (`/premium`), s32 et s40 sans le dire.
- s64 amende le critère 3 de s61 dans une note seulement.

**F85, minor. Champs `Dependencies` incomplets.** Tout est livré, donc il n'y a pas de risque d'exécution, mais les champs ne listent pas les dépendances réelles :
- s63 : manquent s60, s21, s32, s40 ;
- s64 : manquent s12, s14, s19/s24 et s37b1 ;
- s61 : manquent les propriétaires des écrans qu'elle partitionne (s11, s12, s13, s16, s31, s36).

**F86, minor. s62 / s63 : trois imprécisions.**
- **Deux formes pour la table des 308.** « une donnée » dans s62, « dérivée des chemins déclarés » dans s63. Il faut en choisir une.
- **La barre du haut de s62, critère 3.** Le comportement de la cloche (module `notifications` coupé) et du sélecteur (module `organizations` coupé) n'est pas dit. Le critère 7 ne couvre que la zone Réglages.
- **Le parcours doré n'est pas exigé.** s62 déplace `/billing`, que traverse le parcours doré, sans exiger que `pnpm test:golden-path` reste vert. Seule s63 l'exige.

**F87, minor. s61, note : piège des groupes de routes absent.** `e2e/support/warm-up.ts:65-68` refuse tout segment qui commence par `(` et fait échouer tout Playwright jusqu'à ce qu'il soit traduit. `tests/rendered-text.test.ts` demande aussi une mise à jour de déclaration. C'est documenté dans `apps/web/AGENTS.md`, mais la note de s61 propose `(site)` et `(auth)` sans le signaler.

**F88, minor. s64 : extension de périmètre écrite hors du PRD.** Les hôtes dédiés par zone ne figurent dans aucune ligne « Replicated ». Même remède que F74 : consigner la décision du porteur dans le PRD.

## Verdict

- **Ce qui tient.**
  - La couverture est complète (24/24) et le cimetière intact.
  - Il n'y a aucun cycle.
  - Huit des onze constats de la ronde 7 sont résolus, dont les trois majors (F66 en grande partie, F67, F68).
  - s60 et s62 sont prêtes à quelques retouches près (F83, F84, F86).
- **Ce qui ne tient pas.**
  - s61 : partition incomplète le jour de sa livraison (F77), critères 1/3 contradictoires (F78), critères 2/8 contradictoires (F79), éléments transverses du shell non garantis (F80).
  - s63 : le critère 1 capture la console (F81).
  - s64 : la console n'a pas d'écran de connexion sur son hôte, et sa séparation de session est cosmétique ; les passkeys, `baseURL` et les retours entre hôtes ne sont pas traités (F82).
- **Avant de lancer `/ks-research`.** Il faut corriger F77 à F80 avant s61, qui est la racine de s62 à s64, F81 avant s63, et F82 avant s64.

Max severity: major
Stories ready: yes
