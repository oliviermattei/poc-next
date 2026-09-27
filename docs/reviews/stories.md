# Revue des stories : killer-boilerplate (ronde 9)

> Relecture en contexte neuf (subagent `stories-reviewer`) de `docs/stories.md` contre `docs/prd.md`, selon `templates/stories-review-checklist.md`. Tout le découpage est relu, et l'examen est serré sur s60–s65. La partition de s61 (`apps/web/app/**/page.tsx`) et chaque référence de fichier et de ligne de s60–s65 ont été vérifiées sur le disque. La numérotation reprend à F89 ; la ronde 8 est dans l'historique git de ce fichier.

## Couverture du périmètre

| Fonctionnalité du PRD (core loop) | Couverte par | OK ? |
|---|---|---|
| Système de modules + `config/features.ts` + CLI toggle | s03, s04, s05 (+ s58) | ✅ |
| Auth | s07, s12, s13, s14, s46, s56 | ✅ |
| Multi-tenant | s15, s16, s17 | ✅ |
| Billing Stripe | s19, s20, s21, s23, s47 | ✅ |
| Admin back-office | s37a, s37b1, s37b2, s37c, s38, s60 | ✅ |
| Emails transactionnels | s06, s09 | ✅ |
| App shell | s08, s15, s18, s61, s62, s63 | ✅ |
| Marketing | s10, s11, s22, s53, s61 | ✅ |
| Blog MDX | s29, s53 | ✅ |
| Docs produit | s30, s54 | ✅ |
| Changelog | s31 | ✅ |
| i18n | s09 | ✅ |
| Stockage de fichiers | s18 | ✅ |
| Notifications in-app | s32 | ✅ |
| Jobs & cron | s33 | ✅ |
| Déploiement | s27, s59, s64 | ✅ |
| Pack RGPD | s34, s34b, s35, s36 | ✅ |
| Rate limiting + anti-bot | s28 | ✅ |
| Guest checkout | s24 | ✅ |
| Serveur MCP | s41 | ✅ |
| Monitoring + analytics | s39 | ✅ |
| Onboarding | s40 | ✅ |
| Plugins bonus | s42 (livrée), s43, s44 (reportées, F74) | ✅ (les stories existent) |
| Tooling & DX | s01, s02, s48, s50, s51, s52, s55, s58 | ✅ |

- [x] Chaque ligne du tableau « Replicated » est livrée par au moins une story : 24 sur 24.

## Périmètre
- [x] Rien ne revient du cimetière :
  - s60 lit des données existantes, ce n'est pas un journal d'audit ;
  - s61 porte sur le site du SaaS généré ;
  - s64 et s65 n'ajoutent ni provider, ni table, ni `eject`.
- [~] Débordement : les hôtes dédiés (s64, et maintenant s65) ne figurent toujours dans aucune ligne du PRD (F88, laissé ouvert délibérément).

## Qualité des stories
- [x] Tranches livrables de bout en bout. Aucune couche technique déguisée dans s60–s65.
- [~] Critères testables : plusieurs sont encore contradictoires ou sous-spécifiés.
  - s61 : sélecteur de langue et bascule de thème perdus sur les écrans Hors zone (F89).
  - s64 : hôte des liens qui ouvrent une session (F90), mapping des chemins (F91), portée du cookie de session (F92), hôtes inconnus (F93).
- [~] Notes agentiques : présentes, et toutes les références vérifiées sont exactes. Il y a quelques imprécisions (F95, F100).
- [~] Complexité : s62, s64 et s65 sont cotées 4 et énoncent leur risque. s65 relève probablement d'un 5 (F102).

## La liste dans son ensemble
- [x] Aucun cycle ni référence en avant : s60 → s37b2/s37c/s38/s36 ; s61 → s60… ; s62 → s61 ; s63 → s60, s61, s62 ; s64 → s63, s60 ; s65 → s64.
- [x] Les ids s60 à s65 sont bien formés et uniques.
- [~] Recouvrements : pas de double revendication. Il reste des amendements non déclarés et des dépendances manquantes (F101).

## Vérification des références (s60–s65)

| Affirmation | Constat | OK ? |
|---|---|---|
| `NavigationSurface` en `packages/core/src/module.ts:251` | exact (`'app' \| 'footer' \| 'admin'`) | ✅ |
| `apps/web/lib/back-office.ts:67` | exact | ✅ |
| `ADMIN_USERS_SCREEN_PATH` en `admin-routes.ts:513`, `asSuperadmin` en `:182` | exact | ✅ |
| Quatre chemins `ADMIN_*` dans quatre modules | exact : `organization-routes.ts:74`, `billing-routes.ts:60`, `public-form-routes.ts:41` | ✅ |
| `APPLICATION_SEGMENTS` en `organizations.ts:194`, `reservedSlugs` en l. 284, `'admin'` écrit | exact (l. 210) | ✅ (F83 résolu) |
| Entrées de console `authenticated` (`admin-routes.ts:536`, `organization-routes.ts:308`, `billing-routes.ts:327`, marketing `module.ts:57`) | exact | ✅ |
| `sign-in/page.tsx` l. 58 et l. 145, `auth-form.tsx:181` | exact. Mais il existe neuf appels avec repli `'/'` (F95) | ✅ / F95 |
| `protection.test.ts:84-92` | exact | ✅ |
| `app-shell.tsx` l. 1-2, 213, 256-257 | exact. Le fichier porte aussi `LocaleSwitcher` (l. 141) et `ThemeToggle` (l. 147), qu'aucune note ne cite | ✅ / F89 |
| `e2e/support/warm-up.ts:65-68` | exact | ✅ |
| `better-auth-service.ts` : `trustedOrigins` l. 603, passkey l. 985-988, avertissement l. 965 | exact. `baseURL: options.appUrl` en l. 599 n'est cité nulle part (F90) | ✅ / F90 |
| `apps/web/proxy.ts`, `lib/admin.ts` qui rend un `total` | exact (l. 327) | ✅ |

**Partition de s61 contre le disque :**
- Site (9) : tous présents.
- Hors zone (8) : tous présents.
- Application : account, billing, organizations, notifications, onboarding, premium sont nommés ; `/app` est créé par s61.
- Console : `admin/*` (six pages, dont `subscriptions`), déplacé par s60, dont s61 dépend désormais.

La partition est complète sur `page.tsx`. Elle ne range pas `not-found.tsx` ni `global-error.tsx` (F97).

## Statut des constats de la ronde 8

| Constat | Statut |
|---|---|
| F77 | **Résolu** : les six segments sont nommés dans Application et s60 est en dépendance. Il reste un résidu mineur (F97). |
| F78 | **Résolu** par décision du porteur : le bouton appartient au gabarit, exception nommée. L'inscription dans `apps/web/AGENTS.md` n'est pas un critère (F97). |
| F79 | **Résolu** : le critère 3 dérive l'en-tête des entrées `site`, et le critère 6 est limité à `/`. |
| F80 | **Reformulé** : consentement et bandeau d'emprunt sont exigés (s61 c5, s60 c4). Sélecteur de langue et thème ne le sont pas (F89). |
| F81 | **Résolu** : exclusion de la surface `console` et s60 en dépendance. Il reste un résidu sur une entrée d'API (F98). |
| F82 | **Reformulé, en grande partie résolu** : découpage en s64/s65, écran de connexion et API admin sur l'hôte console (s65), emprunt, `rpID`/`origin`, `?next=` entre origines, `Host`, `/api/health`, cookies de consentement et de langue. Restent ouverts : l'hôte des liens et rappels qui ouvrent une session (F90), le mapping (F91), la portée du cookie de session (F92), les hôtes inconnus (F93) et les défauts de s65 (F102). |
| F83 | **Résolu** (vérifié l. 194 et l. 284). Une imprécision reste sur `console` (F100). |
| F84 | **Résolu** pour s62, s63 et s64. Il reste des résidus sur s61 → s10 et s65 → s64 (F101). |
| F85 | **Résolu** pour s61, s63 et s64. Il reste un résidu (F101). |
| F86 | **Résolu** : une seule table, comportement de la barre du haut décrit, parcours doré exigé (s62 c7). |
| F87 | **Résolu** (note de s61). |
| F88 | **Toujours ouvert**, délibérément. Il s'étend maintenant à s65. |
| F74 | **Toujours ouvert**, délibérément. s42 est livrée depuis (F101). |
| F59, F60, F64 (hérités) | Non réévalués dans cette ronde : leur texte n'est que dans l'historique git. La conséquence de F60 (F79) est résolue. |

## Constats

**F89, major. s61 : le sélecteur de langue et la bascule de thème ne sont garantis dans aucun gabarit, et la zone Hors zone les supprime.**
- **Ce que porte l'en-tête aujourd'hui.** `app-shell.tsx` y place `LocaleSwitcher` (l. 140-146) et `ThemeToggle` (l. 147-154) pour tous les écrans, authentification comprise.
- **Ce que dit s61.** La table donne à Hors zone un « gabarit d'authentification, sans en-tête ni barre latérale ». Le critère 5 n'exige que le consentement et le bandeau d'emprunt.
- **Ce qui casse.** `e2e/i18n.spec.ts:95-98` ouvre `/sign-in` et clique sur le bouton « Langue ». Le critère 2 de s09 (sélecteur) et le critère 3 de s08 (thème commutable) régressent pour tout anonyme.
- **Correctif.** Étendre le critère 5 à ces deux éléments pour les gabarits Site, Hors zone et Application, ou déclarer l'amendement de s08 et s09 avec son remplaçant.

**F90, major. s64 : le critère 6 dit d'où vient une URL absolue, mais pas vers quel hôte elle pointe. Un lien qui ouvre une session peut la poser sur le mauvais hôte.**
- **Le mécanisme.** `baseURL` vaut `options.appUrl` (`better-auth-service.ts:599`), et `APP_URL` reste l'origine du site. Le magic link et les rappels OAuth (`/callback/:id`) sont donc des URL d'API sur l'hôte du site. Ces deux routes appellent `setSessionCookie` avant de rediriger (`two-factor-challenge.ts:77-80`).
- **Ce que permet le critère 4.** Il garde `/api/*` servi sur l'hôte du site. La session est alors posée en cookie propre à l'hôte du site, puis `/app` est redirigé en 308 vers l'hôte de l'application, où il n'y a aucune session.
- **Pourquoi aucun critère ne rougit.** Construire depuis `APP_URL` satisfait le critère 6 à la lettre.
- **La promesse du critère 4 est fausse pour ces liens.** « Les liens d'emails déjà envoyés continuent de fonctionner » ne vaut que pour les liens d'écran : `screenUrl('/reset-password…')` (`auth-use-cases.ts:626`), et la vérification, qui redirige en relatif vers `/sign-in` (`auth-routes.ts:973`). Elle ne vaut pas pour un magic link déjà envoyé.
- **Correctif.**
  - Un critère exige que tout lien ou rappel qui ouvre ou consomme une session vise l'origine de l'application : `baseURL`, magic link, OAuth, passkey, 2FA, invitation, définition de mot de passe du guest checkout (s24).
  - Sur l'hôte du site, ces points d'entrée redirigent en 308 vers l'application ou refusent.
  - Un test par parcours d'ouverture de session.

**F91, major. s64, critère 3 : le mapping ne dit rien des chemins déjà préfixés ni des pages du site sur l'hôte de l'application.**
- **Les chemins déjà préfixés.** Après s63, toutes les constantes d'écran valent `/app/...`. Le critère 3 envoie `app.<domaine>/x` vers `/app/x`, donc un lien interne `/app/settings` devient `/app/app/settings`, c'est-à-dire un 404. Il faut trancher :
  - soit `path()` émet des chemins sans `/app` sur l'hôte de l'application ;
  - soit cet hôte redirige `/app/x` en 308 vers `/x`.
- **Les pages du site appelées depuis l'application.** Les écrans applicatifs lient des pages du site : tarifs, pages légales, et l'entrée « Cookies » des Réglages de s62, qui vise `/cookies`, en zone Site. Sur l'hôte de l'application, ces chemins donnent `/app/pricing` et un 404. Le comportement doit être écrit : 308 vers l'hôte du site, ou liens absolus.
- **Les fichiers statiques.** Même question pour `robots.txt`, `sitemap.xml` et `public/` (`og-default.png`). La formule « ressources de build » est ambiguë.
- **À mesurer en research.** Une redirection entre hôtes après un `<form method="post">` peut être soumise à `form-action 'self'` dans Chromium, ce qui heurte « sans source ajoutée » (critère 9).

**F92, major. s64 : la portée du cookie de session est dans le préambule, dans aucun critère.**
- **Ce qui n'est pas vérifié.** « Le cookie de session reste propre à l'hôte de l'application » n'est adossé à aucun test. Or la story impose un domaine parent commun et y écrit délibérément des cookies.
- **Le préfixe `__Secure-` ne suffit pas.** Le nommage est `__Secure-better-auth.*` (`two-factor.ts:151-168`). Ce préfixe n'empêche pas un sous-domaine frère de poser un cookie de même nom avec `Domain=<parent>` (cookie tossing), qui atteint l'hôte de l'application : fixation de session ou login CSRF.
- **Correctif.** Un critère exige que le cookie de session et celui du défi 2FA n'aient aucun attribut `Domain` (idéalement `__Host-`), et qu'aucune requête vers l'hôte du site ne les porte, mesuré au navigateur.
- **La transition des cookies de consentement.** Écrire `app_consent` et `app_locale` sur le parent laisse coexister l'ancien cookie propre à l'hôte et le nouveau, sous le même nom. Il faut dire lequel fait foi et effacer l'ancien. Sinon un refus passé peut être masqué par un nouveau cookie, ou l'inverse, sur un sujet RGPD.

**F93, minor. s64, critère 5 : portée et statut indéfinis.**
- **La portée.** Le critère ne dit pas s'il vaut sans `APP_HOST`. Sans `APP_HOST`, il contredit le critère 2 (« octet pour octet ») et casse les déploiements de prévisualisation (URL `*.vercel.app`) ou un proxy qui pose un `Host` interne.
- **Le statut.** « Ne sert aucune zone » ne donne pas de code : 404 ? 421 ?
- **L'en-tête qui fait foi derrière un proxy.** `Host` ou `X-Forwarded-Host` doit être désigné pour le routage. La construction d'URL, elle, est déjà tenue par le critère 6.

**F94, minor. s64 : la contrainte « `APP_HOST` sous-domaine de l'hôte d'`APP_URL` » exclut la disposition la plus courante.**
- **La disposition exclue.** `www.example.com` + `app.example.com` sont des frères, donc refusés. La parité citée (Supastarter) est elle-même une disposition entre frères.
- **Le coût du contournement.** Passer `APP_URL` de `www` à l'apex change le `rpID` et invalide toutes les passkeys (`better-auth-service.ts:965`). Le critère 10 (documentation) doit le dire.
- **En local.** `Domain=localhost` et un `rpID` `localhost` depuis `app.localhost` dépendent du navigateur. La moitié « consentement » et la moitié « passkey » du critère 8 pourraient ne pas être mesurables sous Playwright : à mesurer en research, ou à passer en recette manuelle.

**F95, minor. s61, critère 8 et note : deux imprécisions.**
- **Ce n'est pas une liste blanche.** `safeRedirectPath` filtre tout chemin de même origine : commence par `/`, pas par `//` (`redirect.ts:17-29`).
- **Neuf appels, un seul cité.** Le repli `'/'` apparaît en `sign-in/page.tsx:58, 69, 126`, `two-factor/page.tsx:42`, `oauth/return/page.tsx:31` et `auth-routes.ts:370, 644, 897`. La note ne cite que l. 58. Un test du seul mot de passe laisserait le magic link, l'OAuth et la 2FA atterrir sur `/`, qui est désormais le site public.
- **Correctif.** Le critère énumère les parcours d'ouverture de session.

**F96, minor. s61, critère 9 : le paramètre `?next=` est perdu.** Un connecté qui ouvre `/sign-in?next=/invitations/accept?token=…` est envoyé sur `/app`. Il faut honorer `?next=`, par le même filtre, quand il est présent.

**F97, minor. s61 : trois bords de la partition et du gabarit.**
- **Deux écrans non rangés.** `not-found.tsx` et `global-error.tsx` sont des écrans au sens de `apps/web/AGENTS.md` (`tests/rendered-text.test.ts`), et la partition ne les range pas. Le 404 est servi dans toutes les zones : il faut dire son gabarit.
- **Le bouton disparaît avec l'en-tête.** Sans aucune entrée `site` visible (marketing, blog, docs et billing coupés), `/changelog` et `/cookies` n'ont plus d'en-tête, donc plus de bouton « Se connecter ». Cela contredit le motif de l'exception : le bouton appartient au gabarit.
- **L'exception n'est pas un critère.** Son inscription dans `apps/web/AGENTS.md` n'est écrite que dans le préambule.

**F98, minor. s63, critère 1 : une entrée d'API serait capturée.** `demo-enabled` déclare une entrée `role` dont le `href` est une route d'API (`/api/modules/demo-enabled/admin/report`, `demo-item-routes.ts:178-181`). Une dérivation par niveau de protection la capturerait, ce qui contredit le critère 6. Restreindre la règle aux entrées dont le `href` est un écran.

**F99, minor. s62 : deux imprécisions.**
- **Un test qui ne peut pas lire le disque.** Le critère 5 exige que « chaque segment d'écran retiré du disque » figure dans la table. Un segment retiré n'est plus sur le disque : il faut un inventaire figé, par exemple la table de s61 en fixture.
- **La cible de l'entrée « Cookies ».** Elle peut viser `/cookies`, en zone Site (donc sur l'hôte du site avec s64), ou un nouvel écran `/app/settings/cookies`. La story ne dit pas lequel.

**F100, minor. s60, note : `console` n'est réservé par son `href` que si `admin` est activé.**
- **Pourquoi c'est un risque.** `apps/web/app/console/` existe sur le disque quel que soit l'état du module. L'usage du dépôt (blog, tarifs, notifications) est donc d'écrire aussi le segment dans `APPLICATION_SEGMENTS`.
- **Aucune configuration ne le verrait.** Aucune ne teste « organisations activé, admin coupé » : `config/profiles.ts` coupe les deux ensemble.

**F101, minor. Libellés périmés, dépendances et amendements.**
- **Libellés périmés.** s37c et s42 portent « OPTIONNELLE — reportée », alors qu'elles sont livrées (`docs/reviews/s37c-inscriptions-publiques.md:123` et `docs/reviews/s42-waitlist.md:63` : `Ship allowed: yes`).
- **Dépendances manquantes.**
  - s61 omet s42 (propriétaire de `/waitlist`), s14 (bouton passkey sur `/sign-in`, qui porte la destination) et s46.
  - s64, dont la recette manuelle suppose un hôte réel, pourrait déclarer s59, qui n'est pas livrée.
- **Amendements non déclarés.**
  - s61 change le critère 6 de s10 (un connecté sur `/`).
  - s65 change les critères 3 et 4 de s64 (API d'administration servie sur l'hôte console seulement).

**F102, minor (story reportée). s65 : trois défauts à corriger avant de la reprendre.**
- **Critère 6 : le même `rpID` ne suffit pas.** Le greffon prend une seule chaîne `origin` (`better-auth-service.ts:988`). Une cérémonie sur l'hôte console porte une autre `clientDataJSON.origin` et sera refusée.
- **Critère 5 : un mécanisme d'élévation de privilège non spécifié.** L'emprunt entre hôtes suppose un transfert de session : jeton à usage unique, durée courte, aucune fuite par `Referer`. C'est une nouvelle surface d'élévation de privilège, et le sens de « fin d'emprunt » (s07 c9, s37b1) change quand la session du superadmin vit sur un autre hôte.
- **Complexité.** Une instance Better Auth avec une seule `baseURL`, deux cookies de session et ce transfert : probablement un 5, à découper.

## Verdict

**Ce qui tient :**
- couverture complète (24 sur 24), cimetière intact, aucun cycle ;
- neuf des douze constats de la ronde 8 sont résolus, et les deux reformulés (F80, F82) le sont en grande partie ;
- s60, s62 et s63 sont prêtes à quelques retouches mineures près (F98, F99, F100).

**Ce qui ne tient pas :**
- s61 : le sélecteur de langue et le thème sont perdus sur les écrans Hors zone, et un parcours livré rougira (F89) ;
- s64 : les liens et rappels qui ouvrent une session peuvent la poser sur l'hôte du site (F90), le mapping produit `/app/app/...` et laisse les pages du site sans comportement (F91), la portée du cookie de session n'est tenue par aucun critère (F92).

**Avant `/ks-research` :** corriger F89 avant s61, et F90 à F92 avant s64. s65, reportée, doit traiter F102 avant d'être reprise.

Max severity: major
Stories ready: yes
