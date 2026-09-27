# Revue des stories — killer-boilerplate (ronde 7)

> Revue en contexte neuf (subagent `stories-reviewer`) de `docs/stories.md` contre `docs/prd.md`, suivant `templates/stories-review-checklist.md`. Tout le découpage est relu : 70 entrées, dont `s37` et `s37b` marquées « DÉCOUPÉE ». L'examen le plus serré porte sur `s60`, `s61` et `s62`. La numérotation reprend après F65 (ronde 6, dans l'historique git de ce fichier).

## Couverture du périmètre

| Fonctionnalité du PRD (core loop) | Couverte par | OK ? |
|---|---|---|
| Système de modules + `config/features.ts` + CLI toggle | s03, s04, s05 (+ s58 : clé facultative `seeds`) | ✅ |
| Auth (password, magic link, OAuth, vérif, reset, sessions, 2FA, passkeys) | s07, s12, s13, s14, s46 (habillage), s56 (rôles de session) | ✅ |
| Multi-tenant (orgs, invitations, rôles, switcher, scoping) | s15, s16, s17 | ✅ |
| Billing Stripe (checkout, portail, abonnements, one-time, sièges, webhooks, essais) | s19, s20, s21, s23, s47 | ✅ |
| Admin back-office (listes, recherche, bannissement, reset, sessions, impersonation, revenu) | s37a (ban), s37b1 (impersonation), s37b2 (listes, détail, sessions, reset), s38 (revenu), s37c, s60 (console, tableau de bord, point d'entrée) | ✅ |
| Emails transactionnels | s06, s09 | ✅ |
| App shell (dashboard, nav depuis les modules, dark mode, paramètres, profil, avatar) | s08, s15, s18, s61 (surfaces site/app), s62 (préfixe `/app`) | ✅ |
| Marketing (landing, pricing, FAQ, témoignages, contact, newsletter, légal, SEO/OG, sitemap, robots) | s10, s11, s22, s53 (robots/sitemap dérivés), s61 (en-tête du site) | ✅ |
| Blog MDX (liste, article, tags, RSS, OG auto) | s29, s53 | ✅ |
| Docs produit + recherche plein texte | s30, s54 | ✅ |
| Changelog | s31 | ✅ |
| i18n | s09 | ✅ |
| Stockage de fichiers | s18 | ✅ |
| Notifications in-app | s32 | ✅ |
| Jobs & cron | s33 | ✅ |
| Déploiement | s27, s59 | ✅ |
| Pack RGPD | s34, s34b, s35, s36 | ✅ |
| Rate limiting + anti-bot | s28 | ✅ |
| Guest checkout | s24 | ✅ |
| Serveur MCP | s41 | ✅ |
| Monitoring + analytics | s39 | ✅ |
| Onboarding | s40 | ✅ |
| Plugins bonus (waitlist, feedback, roadmap) | s42 ; s43 et s44 existent mais le porteur les a marquées « OPTIONNELLE — reportée » (voir F74) | ✅ (stories présentes) |
| Tooling & DX | s01, s02, s48, s50, s51, s52, s55, s58 | ✅ |

- [x] Chaque ligne du tableau « Replicated (core loop) » est livrée par au moins une story. 24/24, aucun trou. Les trois nouvelles stories affinent les lignes App shell, Marketing et Admin sans en retirer quoi que ce soit.

## Périmètre
- [x] Aucune fuite du cimetière. Vérifications pour s60–s62 :
  - Le tableau de bord de s60 lit des données existantes (« aucune table nouvelle ») : ce n'est pas un journal d'audit.
  - s61 porte sur le site public du SaaS généré, pas sur un « site de vente » du boilerplate.
  - s62 écarte explicitement le sous-domaine et ne livre aucun mécanisme multi-hôte.
  - s58 (seed) et s59 (premier déploiement) ne touchent pas non plus au cimetière.
- [x] Rien ne sort du périmètre. s48, s50, s51, s52 et s55 sont des stories d'entretien du harnais. Elles relèvent de la ligne Tooling & DX et de la règle « l'outillage du template n'est pas un module ».

## Qualité des stories
- [~] Tranches livrables : oui pour s60, s61 et s62. Chacune a une valeur visible (point d'entrée de la console, séparation site/application, adresses sous `/app`). Mais la frontière site/application n'est entièrement définie par aucune des deux dernières (F66).
- [~] Critères testables : deux critères de s61 et s62 se contredisent avec des critères déjà livrés ou entre eux (F66, F67). Les critères de s59 ne sont pas marqués « recette manuelle » (F75).
- [~] Notes agentiques : présentes partout. Les références au code de s60–s62 ont été vérifiées (voir « Vérification des affirmations sur le code »). Un piège manque, les identifiants d'organisation réservés (F71).
- [x] Complexité : aucun 5 non découpé (s37, s23, s30 et s37b ont été redécoupées après recherche). s62 est cotée 4 et énonce son risque, tout comme s03, s09, s23 et s33.

## La liste dans son ensemble
- [~] Ordre exécutable :
  - s45 → s62 : toutes les dépendances pointent vers des stories déjà écrites, aucun cycle.
  - s60 → s37b2, s37c, s38 ; s61 → s08, s10, s40 ; s62 → s61, s60 : toutes déjà livrées (leur revue existe).
  - Reste un défaut : des références pendantes vers des stories découpées (F68).
- [~] Ids : uniques et stables. Suffixes alphabétiques (`s34b`, `s37a`, `s37b1`…) hors de la forme `s<number>-<slug>`, et un renvoi vers un id inexistant (F72).
- [~] Recouvrements : s61/s62 se partagent le déplacement vers `/app` de façon voulue, mais sans partition complète (F66).

## Vérification des affirmations sur le code (s60–s62)

| Affirmation | Constaté | OK ? |
|---|---|---|
| `NavigationSurface` en `packages/core/src/module.ts:251`, `'app' \| 'footer' \| 'admin'` | exact | ✅ |
| `apps/web/lib/back-office.ts:67` est le seul lecteur de la surface `admin` | exact : `visibleNavigation(moduleRegistry, session, 'admin')` ; aucun autre lecteur dans `apps/web` | ✅ |
| « quatre entrées portent `surface: 'admin'` » | 4 : admin (`admin-routes.ts:537`), organizations (`organization-routes.ts:309`), billing (`billing-routes.ts:328`), marketing (`module.ts:58`) | ✅ |
| `ADMIN_USERS_SCREEN_PATH` en `admin-routes.ts:513` ; ORGANIZATIONS / REVENUE / SUBSCRIPTIONS dans organizations / billing / marketing | exact (`organization-routes.ts:74`, `billing-routes.ts:60`, `public-form-routes.ts:41`) | ✅ |
| Pas de page `/admin` | exact : seuls `admin/users`, `admin/users/[id]`, `admin/organizations`, `admin/organizations/[id]`, `admin/revenue`, `admin/subscriptions` | ✅ |
| `apps/web/app/admin/`, `e2e/admin.spec.ts`, `apps/web/app/account-menu.tsx`, `apps/web/lib/admin.ts`, `apps/web/proxy.ts` existent | tous présents | ✅ |
| `lib/admin.ts` porte les lectures comptes / organisations / revenu / inscriptions | exact (`adminOrganizationsPort`, `adminRevenuePort`, `adminSubscriptionsPort`, `organizations` rend un `total`) | ✅ |
| `asSuperadmin` est la garde de référence | existe, `admin-routes.ts:182`, locale au module | ✅ |
| `apps/web/app/page.tsx` : quatre sorties, deux partent sur `/app` | exact (onboarding, tableau de bord, accueil, redirection vers la connexion) | ✅ |
| `apps/web/app/auth-form.tsx:181` (`redirectTo`) | ligne 181 = `window.location.assign(props.redirectTo)`. La valeur vient de `apps/web/app/sign-in/page.tsx:145` (`destination`, dérivée de `?next=` via `safeRedirectPath`) | ✅, mais voir F67 |
| ADR 066 / 067 existent | présents | ✅ |
| « Préfixe de langue `/fr/…` » | exact : c'est `proxy.ts` qui l'applique, il n'existe aucun segment `[locale]` | ✅ |

## Constats

**F66 — major — s61 / s62 : la frontière site/application n'est entièrement définie nulle part, et s62 se contredit.**
- **La liste de s62 est incomplète.** Le critère 4 de s62 dit ce qui reste public (site, blog, docs, tarifs, légal, connexion, inscription, mot de passe oublié, liste d'attente). Le critère 1 dit ce qui part sous `/app` (écrans `authenticated`/`entitlement`, plus compte, organisations, facturation, notifications, onboarding). Les deux laissent de côté des écrans qui existent sur le disque :
  - `/verify-email`, `/reset-password`, `/two-factor`, `/oauth/return` ;
  - `/invitations/accept`, servi à un anonyme comme à un connecté ;
  - `/cookies`, `/contact`, `/changelog`, `/premium`.
- **Le critère 3 de s62 contredit ce classement.** Il exige que les liens de vérification, de réinitialisation et d'invitation « pointent le nouveau chemin ». Or ces écrans servent des visiteurs non authentifiés (s07 interdit les routes protégées à un compte non vérifié). Soit ils ne bougent pas et le critère est faux, soit ils bougent et contredisent le critère 1.
- **La dérivation des 308 est donc indécidable.** Le critère 2 dérive les 308 « des chemins déclarés », ce qui dépend du classement ci-dessus.
- **Même lacune dans s61.** Elle ne dit pas quels écrans portent l'en-tête du site et lesquels la barre latérale. Aujourd'hui, `app/app-shell.tsx` entoure tous les écrans, authentification comprise. Le critère 1 (« rendus dans un en-tête, pas dans une barre latérale ») ne peut pas devenir un test déterministe pour `/sign-in`, `/legal`, `/contact` ou `/cookies`.
- **Correctif attendu :** une table exhaustive écran → zone (site / application / hors des deux), dérivée du disque comme `tests/organizations.test.ts` dérive les segments.

**F67 — major — s61, critère 7 : contredit trois critères déjà livrés s'il est pris à la lettre.**
- **Le critère.** « La destination après connexion est une constante du code, jamais un paramètre d'URL. »
- **Ce qu'il casse.** Aujourd'hui, `sign-in/page.tsx` honore `?next=` à travers la liste blanche `safeRedirectPath`, et cela porte :
  - s07, critère 8 (« revient à l'URL demandée après authentification ») ;
  - le retour de l'invitation, s16 (« connexion avec retour vers cette URL, jeton compris ») ;
  - le retour des tarifs, s22/s24 (`/sign-in?next=/pricing?offer=…`), qui est sur le parcours doré.
- **Le risque.** Un implémenteur fidèle au texte supprime ces trois retours : c'est une régression fonctionnelle.
- **L'intention probable.** « La destination **par défaut** est une constante ; un `next` reste soumis à la liste blanche. » Il faut l'écrire ainsi. Il faut aussi ajouter s07 à la liste des critères amendés par s61, car le repli de `safeRedirectPath(next, '/')` pointerait désormais vers le site et non vers `/app`.

**F68 — major — s38, s42, s43, s44 : dépendances vers `s37-admin-users`, une story « DÉCOUPÉE, ne pas implémenter telle quelle ».**
- **Le constat.** `s37-admin-users` n'aura jamais de revue, donc jamais d'état « livrée ». Il en va de même pour `s37b`, que plus personne ne référence.
- **L'impact.** L'état du pipeline se dérive des fichiers (`docs/reviews/<id>.md`). s43 et s44, pas encore livrées, dépendent donc d'une story que `/ks-status` ou l'orchestrateur ne verront jamais livrée. C'est une dépendance inexécutable au sens de la règle du fichier.
- **La note contredit la dépendance.** La note de s37a dit « s42, s43 et s44 ne dépendent que d'elle », mais leur champ `Dependencies` n'a pas été mis à jour.
- **Correctif :** s38 → s37b2 ; s42, s43, s44 → s37a.

**F69 — minor — s61 : destin de l'entrée de navigation `auth /sign-in` non tranché.**
- **Le constat.** Le préambule de s61 range « connexion » parmi les liens du site. Mais le critère 1 ne fait déclarer `site` qu'à l'accueil, au blog, aux docs et aux tarifs. L'entrée publique d'`auth` reste donc en surface `app`, et le critère 5 (« aucun lien du site » dans la barre latérale) ne dit pas si elle doit disparaître.
- **Le risque.** Le « Se connecter » de l'en-tête (critère 2) risque d'être écrit en dur, ce que `apps/web/AGENTS.md` interdit (« aucune entrée de navigation écrite à la main »).
- **Même question** pour l'entrée publique `demo-enabled /api/modules/demo-enabled/items`.

**F70 — minor — s61, critère 6 : « comme aujourd'hui » n'est vrai que pour un anonyme.** Aujourd'hui, avec le site public coupé, un visiteur **connecté** reçoit son tableau de bord sur `/` (`page.tsx`). Le critère le renverrait vers la connexion sans dire ce que `/sign-in` fait d'une personne déjà connectée : un rebond vers `/app` ou un formulaire inutile. Il faut nommer ce cas.

**F71 — minor — s60 / s62 : le piège des identifiants d'organisation réservés manque aux notes.**
- **Le mécanisme actuel.** `apps/web/lib/organizations.ts:194` (`APPLICATION_SEGMENTS`) réserve les segments de premier niveau pour qu'une organisation ne masque pas un écran. `tests/organizations.test.ts` les dérive du disque.
- **Ce que s60 et s62 changent :**
  - s60 crée `superadmin` et libère `admin` ;
  - s62 crée `app`, et retire du disque `billing`, `organizations`, `notifications`, `onboarding`, `account`, `premium`, qui restent pourtant servis en 308 par le proxy.
- **Ce qu'aucune des deux ne dit :**
  - Une organisation **déjà créée** avec l'identifiant `app` ou `superadmin` devient une collision à la migration. C'est le socle de fiabilité : la migration doit rester compatible avec la version en ligne.
  - Les anciens segments redirigés doivent rester réservés même absents du disque.

**F72 — minor — ids et renvois.**
- `s34b`, `s37a`, `s37b`, `s37b1`, `s37b2` et `s37c` s'écartent de la forme `s<number>-<slug>`. Ils sont déjà livrés et nomment des branches : ne pas renuméroter, mais consigner l'extension de format dans l'en-tête du fichier.
- La note de s34 renvoie à `s34b-suppression-ecrans`, un id qui n'existe pas (le vrai est `s34b-ecrans-rgpd`).
- s34 porte deux sections « Agentic notes ».
- s55 est rangée physiquement entre s36 et s37, donc hors de la section « Stories ajoutées après le cadrage initial » où son en-tête la placerait.

**F73 — minor — s60 : amende des stories livrées sans le dire, et ses notes sont périmées ailleurs.**
- **Amendements non déclarés.** s60 change les chemins et la surface de s37b2, s37c et s38 (critères de 404 sur `/admin/...`, `AGENTS.md` du module `admin` et de `apps/web`, tableau « Les écrans du back-office »). Elle n'a pas le paragraphe « Cette story amende… » que s61 porte.
- **Notes devenues fausses.** Celles de s37b et s37b2 disent « aucune story n'en dépend », ce qui est faux depuis s60.
- **Contournement de s56.** La note de s60 oriente vers un lien écrit à la main dans `account-menu.tsx`. Or s56 (livrée) rend précisément une entrée de navigation `role` affichable pour son porteur. La note écarte `ModuleSession.roles` sans dire pourquoi le mécanisme dérivé du registre ne convient pas. C'est à trancher au plan, mais la note ne devrait pas préjuger contre la règle « aucune entrée de navigation écrite à la main ».

**F74 — minor — s43 / s44 : report du porteur face au critère de succès n°3 du PRD.** Les deux stories existent, donc la couverture tient. Mais « le produit est livrable sans elle » contredit « Parité sur le périmètre : chaque feature du tableau Replicated est implémentée ». Soit le PRD est amendé (les plugins passent en post-v1), soit le report est provisoire. La décision doit être écrite dans le PRD, pas seulement dans stories.md.

**F75 — minor — s59 : critères non automatisables non marqués « recette manuelle ».** Plusieurs critères sont par nature manuels : hôte réel, email réellement reçu, trace lisible chez le fournisseur, instance jetable. La note le dit (« ne peut pas être jouée seule par un agent »), mais la règle « Critères non automatisables » du fichier exige le marquage explicite et la trace dans la revue. Il n'existe pas de troisième régime.

**F76 — minor — s61 : dépendances incomplètes.** s61 change la surface des entrées de navigation de s22 (tarifs), s29 (blog) et s30 (docs), et l'atterrissage de s07 (F67). Seules s08, s10 et s40 sont déclarées. Toutes sont livrées, donc il n'y a pas de risque d'exécution, mais le champ ne liste pas les dépendances réelles.

**Report des rondes précédentes, toujours ouverts :**
- F59 : le test de template par locale est revendiqué à la fois par s03 et s09.
- F60 : les arêtes « modules requis » de la famille marketing ne sont pas déclarées.
- F64 : la politique de rétention étend le texte du PRD.
- F57 est **résolu**, par le critère 5 de s36 et la carte « Cookies » de `/account`.

## Verdict

- **Ce qui tient.** La couverture reste complète (24/24), le cimetière est intact et l'ordre ne contient aucun cycle. Les affirmations de s60–s62 sur le code sont exactes, à la ligne près.
- **Ce qui ne tient pas.**
  - s61 et s62 ne partitionnent pas tous les écrans entre site et application (F66).
  - s61 porte un critère qui, lu à la lettre, retire le retour `?next=` sur lequel reposent s07, s16 et le parcours doré (F67).
  - Quatre stories dépendent encore d'une entrée découpée qui ne sera jamais livrée (F68).
- **Avant de lancer `/ks-research`.** Il faut corriger F66 et F67 avant de lancer la recherche sur s61 et s62, et F68 avant d'ouvrir s43 ou s44.

Max severity: major
Stories ready: yes
