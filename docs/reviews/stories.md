# Revue des stories : killer-boilerplate (ronde 10)

> Relecture de `docs/stories.md` contre `docs/prd.md` (subagent `stories-reviewer`, en lecture seule), selon `templates/stories-review-checklist.md`. Tout le découpage est relu, et l'examen se concentre sur s60–s65 après le commit e797fc6. Chaque référence de fichier et de ligne de s60–s65 a été ouverte sur le disque, comme les affirmations de s64 sur `resolveAuthConfig`, le `rpID`, la table de routage par hôte et les cookies. La numérotation reprend à F103 ; la ronde 9 est dans l'historique git de ce fichier.

## Couverture du périmètre

Le PRD n'a pas changé : le tableau « Replicated » compte toujours 24 lignes.

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
- [x] Rien ne revient du cimetière. s60 lit des données existantes (ce n'est pas un journal d'audit). s64 et s65 n'ajoutent ni provider, ni table, ni `eject`.
- [~] Débordement : les hôtes dédiés (s64, s65) ne figurent toujours dans aucune ligne du PRD. `docs/prd.md` ne contient ni `APP_HOST` ni « sous-domaine ». F88 reste ouvert, délibérément.

## Qualité des stories
- [x] Chaque story est une tranche livrable de bout en bout. Aucune couche technique n'est déguisée en story dans s60–s65.
- [~] Tous les critères ne sont pas encore testables ni cohérents. Deux défauts sont majeurs :
  - s64 c9 : les tarifs vus depuis l'hôte du site (F103) ;
  - s64 c6 : ce critère contredit le code livré (F104).
- [~] Notes agentiques : présentes. Deux énumérations restent inexactes (F111).
- [~] Complexité : s62 et s64 sont cotées 4 et énoncent leur risque. s65 est cotée 5 sans être découpée, et sa note dit encore 4 (F105).

## La liste dans son ensemble
- [x] Aucun cycle ni référence en avant. La chaîne est s60 → s61 → s62 → s63 → s64 → s65, et chaque dépendance amont est livrée ou située plus haut dans la chaîne.
- [x] Les ids s60 à s65 sont bien formés et uniques.
- [~] Recouvrements : aucune double revendication. Il reste deux libellés et dépendances périmés (F112).

## Vérification des références (s60–s65)

| Affirmation | Constat | OK ? |
|---|---|---|
| `NavigationSurface` en `packages/core/src/module.ts:251` | exact | ✅ |
| `back-office.ts:67`, `admin-routes.ts:513` et `:182`, `organizations.ts:194` et `:284` | exact | ✅ |
| Entrées de console `authenticated` (`admin-routes.ts:536`, `organization-routes.ts:308`, `billing-routes.ts:327`, marketing `module.ts:57`) ; `demo-item-routes.ts:178-181` | exact | ✅ |
| `app-shell.tsx` l. 1-2, 141, 147, 213, 256-257 ; `layout.tsx:96` ; `warm-up.ts:65-68` ; `e2e/i18n.spec.ts:95-98` | exact | ✅ |
| s61 : le repli `'/'` serait « écrit huit fois », dont `auth-routes.ts:897` | **inexact** : l. 897 a pour repli `'/account'`, et le `: '/'` nu de l. 371 manque | F111 |
| `redirect.ts:17` | exact | ✅ |
| s64 : `auth-config.ts:28` (`appUrl`) | exact : la fonction commence en l. 26 et lit `env.APP_URL` en l. 28 | ✅ |
| `better-auth-service.ts:599` (`baseURL`), `:603` (`trustedOrigins`), `:965` (avertissement), `:985-988` (`rpID: hostname(appUrl)` en l. 986, `origin` en l. 988) | exact | ✅ |
| `lib/organizations.ts:320`, `lib/billing.ts:228, 285, 382` | exact | ✅ |
| `lib/guest-account.ts:97` présenté comme les « liens du guest checkout » | **imprécis** : cette ligne construit des requêtes **internes** vers `service.handle`. Le lien envoyé par email est construit par le module `auth` (`auth-use-cases.ts:455-458, 626`) depuis le même `appUrl`, donc la conclusion tient | F111 |
| « `resolveAuthConfig` est le seul point dont partent les URL absolues qui ouvrent une session » | tient sur ce qui a été balayé : `apps/web/lib` et `appUrl`/`origin` dans `packages/modules`. `site-url.ts` lit bien `APP_URL` directement ; les emails de notification et de marketing ne portent aucun lien. Un autre consommateur existe, `auth.ts:297` (`incomingRequest`), qui n'est pas un lien sortant | ✅ |
| « Le seul endroit où les deux origines se séparent dans l'auth » (`rpID`) | cohérent : l'auth ne reçoit qu'un `appUrl` (`auth.ts:143`), qui sert à la fois `rpID` et `origin`. La séparation impose de passer une seconde valeur, et le critère 10 le fait rougir si elle manque | ✅ |
| `billing.ts:331-349` (`guestFallbackUrl`) | exact | ✅ |
| `proxy.ts:142` (cookie de langue), `consent-routes.ts:123`, `security-headers.ts:130` | exact | ✅ |
| Cookie de défi 2FA `__Secure-better-auth.*` (`two-factor.ts:168`) ; session `SameSite=Strict`, sans `Domain` (`better-auth-service.ts:305-310`) | exact | ✅ |

## Statut des constats de la ronde 9

| Constat | Statut |
|---|---|
| F89 | **Résolu** : s61 c5 exige le sélecteur de langue et le thème dans les gabarits Site, Hors zone et Application, et garde `e2e/i18n.spec.ts` vert. Il reste un résidu sur la console (F109). |
| F90 | **Résolu** : s64 c5 (toute URL qui ouvre une session vise l'application, un test par parcours) et c4 (`/api/modules/auth/*` en 308 en `GET`). La promesse sur les rappels OAuth déjà émis est fausse (F106). |
| F91 | **En grande partie résolu** : pas de réécriture, donc plus de `/app/app` ; pages du site en 308 ; `form-action` porté par c11. Les fichiers non écrans sur l'hôte de l'application restent sans comportement (F108). |
| F92 | **Résolu** : c7 (aucun `Domain`, mesuré au navigateur) et c8 (transition des cookies). Un résidu nouveau apparaît (F107). |
| F93 | **Partiellement résolu** : sans `APP_HOST`, c2 exclut tout contrôle d'hôte, et c6 désigne l'en-tête qui fait foi. Avec `APP_HOST`, un hôte qui n'est ni l'un ni l'autre reste sans comportement (F108). |
| F94 | **Résolu** : c12 documente le coût de `www` + `app`, et la note renvoie ce qui ne se mesure pas en local à la recette manuelle. |
| F95 | **En grande partie résolu** : c9 énumère les parcours et corrige « liste blanche ». L'énumération de la note est inexacte (F111). |
| F96 | **Résolu** (s61 c9 et c10). |
| F97 | **Résolu** : `not-found.tsx` rendu avec le gabarit Site, `global-error.tsx` hors partition, en-tête et bouton sans entrée `site` (c3), exception écrite dans `AGENTS.md` (c6). |
| F98 | **Résolu** (s63 c1 exclut les `href` d'API). |
| F99 | **Résolu** : fixture figée (s62 c5), `/app/settings/cookies` (c1). |
| F100 | **Résolu** : `console` est écrit dans `APPLICATION_SEGMENTS`, `admin` en est retiré (note de s60). |
| F101 | **Partiellement résolu.** Corrigés : libellé de s42, dépendances s42, s14 et s46 ajoutées à s61, amendements s61 → s10 et s65 → s64 déclarés. Restent le libellé de s37c et s59 absent des dépendances de s64 (F112). |
| F102 | **Traité sur le fond** : c5 décrit le jeton de transfert, c6 l'origine de la passkey, et la story est cotée 5. Remplacé par F105 : un 5 doit être découpé. |
| F88, F74 | **Toujours ouverts**, délibérément (décisions du PRD). |

## Constats

**F103, major. s64 c9 et préambule : sur l'hôte du site, `/pricing` ne voit jamais la session, donc un client connecté achète par le checkout invité, pour son compte personnel et non pour son organisation.**
- **Le mécanisme.** Le cookie de session est propre à l'hôte de l'application (c7). `/pricing`, servi par le site, rend donc `session === null` pour tout le monde. Le formulaire vise alors `guestCheckout` (`apps/web/app/pricing/page.tsx:147`).
- **Où va l'achat.** Le webhook rattache le paiement invité à un **compte** (`billing-use-cases.ts:802-806`, `promotion: { userId }`), pas à l'organisation active (s15, s23). Il envoie en plus un magic link (s24) et consomme le seau anonyme global.
- **Pourquoi aucun critère ne rougit.** La note ne traite que le retour après connexion (`guestFallbackUrl`). La preuve citée par c9, `pnpm test:golden-path`, ne passe par `/pricing` que dans la variante invitée (`golden-path.spec.ts:403`), jamais connectée. Or « aboutit au checkout » est satisfait à la lettre.
- **Correctif.** Écrire ce que fait le bouton d'offre de `/pricing` avec `APP_HOST`. Par exemple : il vise toujours un écran de l'application qui porte l'offre, et le checkout invité reste un choix explicite. Ajouter un test « membre d'une organisation, depuis `/pricing` de l'hôte du site » qui vérifie que l'abonnement est rattaché à l'organisation.

**F104, major. s64 c6 : « toute URL absolue est construite depuis la configuration, jamais depuis l'en-tête `Host` » contredit le code livré.**
- **Ce que fait le code livré.** Plusieurs réponses construisent aujourd'hui un `Location` absolu depuis `request.url`, c'est-à-dire, selon c6 lui-même, depuis l'hôte « tel que Next la reçoit » :
  - `proxy.ts:93` (redirection de langue) ;
  - `admin-routes.ts:148-150`, dont le commentaire dit « L'origine vient de la requête entrante » ;
  - `organization-routes.ts:136`, `notification-routes.ts:90`, `onboarding-routes.ts:87` ;
  - `app/api/billing-local-checkout/route.ts:141, 150`.
- **Une garde fondée sur le même hôte.** La garde de consentement compare `Origin` à l'hôte de `request.url` (`consent/src/domain/request-guard.ts:56`).
- **Pourquoi c'est un défaut.** Pris à la lettre, le critère impose de réécrire des redirections dans cinq modules, sans que la story le dise. Pris au sens large, il est déjà faux au moment où la revue le lira.
- **Correctif.** Restreindre c6 aux URL qui **quittent** la réponse : emails, URL de retour chez les fournisseurs, `baseURL` et rappels. Autoriser explicitement les redirections vers la même origine. Ou bien énumérer les redirections à réécrire.

**F105, major (story reportée). s65 est cotée 5 et n'est pas découpée. Sa note dit encore « Risque (complexité 4, sécurité) ».**
- La règle est qu'un 5 ne reste jamais une seule story. La mention « à découper avant d'être reprise » décrit le défaut, elle ne le corrige pas.
- Cela ne bloque aucune story active.
- Deux corrections sont nécessaires : découper (par exemple un hôte console avec sa connexion, puis le transfert d'emprunt entre hôtes), et aligner la note sur la cote.

**F106, minor. s64 c4 : « rappels OAuth déjà émis » ne peut pas fonctionner après un 308 entre hôtes.**
- Le cookie d'état OAuth est posé sans `Domain` sur l'hôte qui a lancé la boucle (`better-auth-service.ts:810`). Un rappel redirigé vers l'hôte de l'application arrive donc sans lui et échoue en `state_security_mismatch`. Il en va de même pour un défi 2FA en cours.
- Seuls les liens qui ne dépendent pas d'un cookie survivent : magic link, vérification, téléchargement d'export.
- Correctif : reformuler la promesse de c4, et dire dans `docs/deployment.md` qu'une boucle en cours au moment de la bascule est à relancer.

**F107, minor. s64 c8 : un cookie de consentement posé sur le domaine parent peut être écrit par n'importe quel sous-domaine.**
- **Ce que c8 contourne.** La garde même hôte de s36 (`request-guard.ts:22-69`) existe parce qu'un consentement forgé « est pire qu'un refus perdu ». Avec c8, tout sous-domaine du parent peut écrire `app_consent`, y compris ceux hébergés par un tiers (page de statut, support).
- **« Fait foi » n'est pas décidable tel quel.** L'en-tête `Cookie` ne transmet pas l'attribut `Domain`. Le critère doit énoncer une règle que le serveur peut appliquer, par exemple : deux valeurs présentes, on garde la plus récente et on efface celle qui est propre à l'hôte.
- Il faut aussi assumer le risque par écrit, ou le borner.

**F108, minor. s64 c3 et c4 : deux cas restent sans comportement avec `APP_HOST`.**
- Un hôte qui n'est ni celui du site ni celui de l'application : URL de prévisualisation, IP, `Host` interne (résidu de F93).
- Les ressources qui ne sont pas des écrans sur l'hôte de l'application : `robots.txt`, `sitemap.xml`, `public/` (`og-default.png`) (résidu de F91).

**F109, minor. s60 c4 et s61 c5 : le gabarit Console n'est pas tenu de rendre le sélecteur de langue ni la bascule de thème.** Aujourd'hui, les écrans `/admin/*` les portent via `AppShell` (`app-shell.tsx:141, 147`). s61 c5 ne les exige que des gabarits Site, Hors zone et Application. s08 c3 (thème) et s09 (sélecteur) régressent donc pour le superadmin. Il faut étendre s60 c4, ou déclarer l'exclusion.

**F110, minor. s63 c5 : « les liens d'emails de notification » ne désignent rien.** `packages/emails/src/notifications.ts` et `apps/web/lib/notifications.ts` ne construisent aucune URL. Le critère sera vert sans rien vérifier. Il faut le limiter aux liens internes, ou nommer les emails visés.

**F111, minor. Références inexactes.**
- **Note de s61.**
  - `auth-routes.ts:897` a pour repli `'/account'`, pas `'/'` : c'est le magic link sans `callbackURL`, qui atterrirait après s62 sur une redirection 308.
  - Le `: '/'` nu de `auth-routes.ts:371` n'est pas cité. C'est la 2FA dont la destination a une origine étrangère. « Une seule constante » le manquerait.
- **Préambule de s64.** `guest-account.ts:97` construit des requêtes internes, pas le lien envoyé par email (voir le tableau de vérification).

**F112, minor. Résidus de F101.**
- `docs/stories.md:1189` : s37c porte toujours « **Optionnelle** — reportée », alors que `docs/reviews/s37c-inscriptions-publiques.md:123` dit `Ship allowed: yes`.
- La recette manuelle de s64 c12 suppose un déploiement réel à deux hôtes. s59 n'est pas livrée (aucun `docs/reviews/s59*`) et n'est pas en dépendance.

**Ce qui n'a pas été vérifié :**
- Le comportement de `Domain=localhost` et d'un `rpID` `localhost` depuis `app.localhost` sous Chromium : la note le renvoie déjà à la research.
- Si Better Auth permet `__Host-`.
- Que `request.url` sous Next 16 dérive exactement de `Host` plutôt que de `X-Forwarded-Host`. F104 s'appuie sur la formulation de c6 lui-même et sur les commentaires du code, pas sur une mesure.

## Verdict

**Ce qui tient :**
- Couverture complète (24 sur 24), cimetière intact, aucun cycle ni référence en avant.
- F89 et F96 à F100 sont résolus, F90 et F92 aussi sur le fond. s60 à s63 sont prêtes à des retouches mineures près (F109, F110, F111).

**Ce qui ne tient pas :**
- s64 : avec `APP_HOST`, un client connecté qui achète depuis `/pricing` passe par le checkout invité et paie pour son compte personnel au lieu de son organisation, sans qu'aucun critère ne rougisse (F103). Et c6 contredit le code livré (F104).
- s65 : un 5 non découpé, à découper avant toute reprise (F105).

**Avant `/ks-research` :** corriger F103 et F104 avant s64. F105 bloque la reprise de s65, pas les autres stories.

Max severity: major
Stories ready: yes
