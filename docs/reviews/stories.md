# Stories Review — killer-boilerplate (round 4)

> Revue à contexte neuf de `docs/stories.md` (44 stories, 1167 lignes) contre `docs/prd.md`, selon `templates/stories-review-checklist.md`. Le périmètre du PRD a été parcouru ligne par ligne avant lecture des stories. Numérotation des findings continuée à partir des revues précédentes (F1–F37).

## Perimeter coverage

| PRD feature (core loop) | Covered by | OK? |
|---|---|---|
| Système de modules + `config/features.ts` + CLI `toggle` (5) | s03, s04, s05 | OK (5 correctement éclaté en 3) |
| Auth (password, magic link, OAuth, vérif email, reset, sessions, 2FA, passkeys) | s07, s12, s13, s14 | OK |
| Multi-tenant (orgs, invitations, rôles, switcher, scoping) | s15, s16, s17 | OK |
| Billing Stripe + abstraction (checkout, portail, abos, one-time, seat, webhooks, trials) | s19, s20, s21, s23 | OK (5 correctement éclaté en 4) |
| Admin back-office (liste users/**orgs**, recherche, ban, reset, sessions, impersonation, métriques) | s37, s38 | Partiel — aucun critère pour la liste des organisations |
| Emails transactionnels (React Email, adapter, templates traduits, guide DNS) | s06 (+ s09 pour la traduction) | OK |
| App shell (layout, nav depuis modules, dark mode, settings compte/org, profil, avatar) | s08 (+ s15 settings org, s18 avatar) | OK |
| Marketing (landing, sections, pricing depuis config, FAQ, testimonials, contact, newsletter, légal, SEO/OG, sitemap, robots) | s10, s11, s22 | OK |
| Blog MDX (liste, article, tags, RSS, OG auto) | s29 | OK |
| Docs produit (recherche plein texte) | s30 | OK |
| Changelog | s31 | OK |
| i18n (routes localisées, switcher, emails traduits) | s09 | OK |
| Storage fichiers (presign, contrôle d'accès, avatars) | s18 | OK |
| Notifications in-app (centre, badge, préférences) | s32 | OK |
| Jobs & cron (adapter, Inngest, events, cron) | s33 | OK |
| Déploiement (Dockerfile, compose prod, Coolify, Vercel, checklist env, migrations) | s27 (+ s02 CI) | OK |
| Pack RGPD (suppression + purge, export, consentement) | s34, s35, s36 | OK |
| Rate limiting + anti-bot (IP/compte, captcha) | s28 | OK |
| Guest checkout | s24 | OK |
| Serveur MCP (lister, activer, squelette) | s41 | OK |
| Monitoring + analytics (Sentry source maps, adapter analytics) | s39 | OK |
| Onboarding multi-étapes | s40 | OK |
| Plugins bonus (waitlist, feedback, roadmap) | s42, s43, s44 | OK |
| Tooling & DX (TS strict, lint, Vitest, Playwright, GHA, compose local, seed, `.env.example`, conventions IA) | s01, s02 | OK |

- [x] Chaque feature du tableau « Replicated (core loop) » est délivrée par au moins une story — un sous-élément (`liste orgs`) a une story mais aucun critère.

Point fort à noter : les critères de succès n°1 et n°4 du PRD sont convertis en recettes exécutables (s25 golden path, s26 profil minimal). La plupart des découpages laissent les critères de succès à l'état de prose.

## Scope
- [x] Aucune story ne réintroduit un item du cimetière. Vérifié un par un : `eject` (s05 le refuse explicitement et interdit toute commande de nettoyage), module AI (absent), providers non-Stripe (s19 pose Stripe seul), facturation à l'usage (s21 trace la limite explicitement), notifications temps réel (s32 exclut), multi-ORM / multi-framework (absents), non-Postgres (absent), mobile (absent), journal d'audit (s37 requalifie la traçabilité de l'impersonation en logs applicatifs, pas en table d'audit), clés API et webhooks sortants client (absents), secondes implémentations d'adapters (s06 Resend seul, s18 S3/R2 seul, s33 Inngest seul, s39 Sentry/PostHog seuls — les doublures d'enregistrement sont explicitement étiquetées outils de test, pas providers), appareil commercial (s30 exclut explicitement la doc destinée aux acheteurs).
- [~] Un élément en bordure de périmètre : le quota quantitatif générique de s21.

## Story quality
- [~] Tranches de bout en bout — s06 est un adapter sans résultat visible par un utilisateur (assumé dans ses propres notes).
- [~] Chaque critère testable — quelques critères ne sont pas vérifiables au moment du ship de leur propre story.
- [x] Notes agentiques présentes et réellement utiles partout (pièges, références aux quatre cibles, écarts avec l'ordre du PRD justifiés en s08 et s18).
- [x] Complexité : aucun 5 non découpé ; chaque 4 (s03, s09, s15, s19, s23, s33) ouvre ses notes par un « Risque de complexité 4 » explicite.

## La liste dans son ensemble
- [x] Aucun cycle dans les dépendances déclarées : chaque entrée `Dependencies` pointe vers une story de numéro inférieur (vérifié sur les 44).
- [~] Deux références en avant au niveau des critères (voir findings).
- [x] Ids : s01…s44, tous conformes à `s<numéro>-<slug>`, tous uniques, aucun trou.
- [x] Aucun chevauchement : les paires risquées sont toutes arbitrées explicitement (s11/s42 table d'inscriptions partagée, s21/s23 compteur de quota unique, s08/s18 avatar, s29/s30/s31 pipeline MDX unique, s05/s41 CLI et MCP comme seconde surface, s13/s28 pas de compteur local).

## Findings

**F38 — major — s37-admin-users** : la ligne admin du PRD dit « liste users/**orgs** » et le titre de la story dit « et les organisations », mais aucun critère d'acceptation ne livre une liste d'organisations (recherche, détail). Les organisations n'apparaissent qu'à l'intérieur du détail d'un utilisateur. Les notes disent pourtant « le travail réel est l'interface et la vue organisations » : ce travail n'a pas de critère, donc il ne sera ni construit ni testé.

**F39 — major — s11-public-forms / s13-two-factor** : les deux portent un critère qui dépend du mécanisme de limitation de débit (« Les deux formulaires sont soumis aux limites de débit du socle », « Les tentatives de vérification échouées sont limitées par le mécanisme… du socle »), livré en s28. Et s28 déclare `s11` et `s13` dans ses dépendances. Aucun de ces critères ne peut passer au ship de sa propre story, et la paire est mutuellement bloquante au gate. Soit déplacer ces critères dans s28 (qui énumère déjà les points d'entrée), soit les marquer explicitement comme vérifiés en s28. En l'état, cela viole la règle du fichier lui-même : un critère est soit un test, soit une recette manuelle marquée, « il n'existe pas de troisième régime ».

**F40 — major — s11-public-forms** : « Les inscriptions sont consultables et exportables en CSV lorsque le back-office est activé » fait référence en avant à s37, 26 stories plus loin. Même problème, autre cible : invérifiable au ship de s11. Cette tranche appartient à s37 ou à s42.

**F41 — minor — s37-admin-users** : référence croisée périmée dans les notes — « Module requis par s41-waitlist… ». La waitlist est **s42** ; **s41** est le serveur MCP. Les ids nomment les branches et les fichiers du pipeline : un id faux se propage.

**F42 — minor — s06-transactional-emails** : la story la plus proche d'une couche technique de la liste — aucun email n'atteint un utilisateur réel, la valeur est une interface. Atténué (template de démonstration rendu, capture locale, doc de délivrabilité en test de présence) et explicitement assumé dans les notes, mais cela reste une couche, pas une tranche utilisateur.

**F43 — minor — s25, s26, s27, s36** : le préambule affirme que tout ce qui n'est pas dans le tableau « socle non désactivable » porte un critère « module non activé ». Ces quatre stories ne sont ni dans le tableau, ni porteuses d'un critère off. s36 plaide sa cause dans ses notes (« inerte par construction ») ; s25, s26 et s27 non. Soit étendre le tableau, soit énoncer pourquoi elles en sont exemptes.

**F44 — minor — s34-account-deletion** : « efface **ou anonymise** ses données » rend le test indécidable — deux comportements différents pour un seul critère. Choisir, ou préciser par catégorie de données laquelle s'applique.

**F45 — minor — s21-trials-and-gating** : la limite quantitative générique (« nombre d'objets, de membres, de fichiers ») n'est nommée nulle part dans le périmètre du PRD et se tient à un pas de la « facturation à l'usage » du cimetière. Les notes la bornent correctement (« ne doit jamais alimenter une assiette de facturation »), mais l'ajout de périmètre lui-même devrait être confirmé par le propriétaire du PRD plutôt qu'introduit par le découpage.

**F46 — minor — s35-data-export** : un critère envoie le lien de téléchargement par email, mais le mailer n'est pas une dépendance déclarée (seulement s33 et s18). Satisfait transitivement, alors que le fichier revendique des `Dependencies` **réelles**.

**F47 — minor — incohérence du PRD, pas défaut de story** : la ligne emails du PRD dit « adapter Resend/**SMTP** » alors que le cimetière interdit les secondes implémentations d'adapters. s06 tranche correctement (Resend seul) et le dit. À noter pour que personne ne « corrige » plus tard la story vers la formulation du PRD.

## Verdict

Le découpage est solide : périmètre entièrement cartographié, cimetière activement défendu (plusieurs notes n'existent que pour empêcher une fuite), aucun 5 non découpé, chaque 4 énonçant son risque, critères « module non activé » systématiques, et critères de succès n°1 et n°4 du PRD convertis en recettes permanentes. Les défauts se concentrent sur trois placements de critères d'acceptation et sont peu coûteux à corriger maintenant — s11 et s13 échoueraient sinon à leur propre gate de revue.

Max severity: major
Stories ready: no
