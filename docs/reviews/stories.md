# Stories Review — killer-boilerplate (round 5)

> Revue en contexte neuf de `docs/stories.md` (44 stories, 1170 lignes) contre `docs/prd.md`, selon `templates/stories-review-checklist.md`. Numérotation des findings continuée à partir des revues précédentes (F1–F47).

## Perimeter coverage

| PRD feature (core loop) | Covered by | OK? |
|---|---|---|
| Système de modules + `config/features.ts` + CLI `toggle` (5) | s03, s04, s05 (+ s26 recette) | ✅ |
| Auth (password, magic link, OAuth, vérif, reset, sessions, 2FA, passkeys) | s07, s12, s13, s14, sessions en s08 | ✅ |
| Multi-tenant (orgs, invitations, rôles, switcher, scoping) | s15, s16, s17 | ✅ |
| Billing Stripe + abstraction provider (checkout, portail, abos, one-time, seat, webhooks, trials) | s19, s20, s21, s23 (+ s22, s24) | ✅ |
| Admin back-office (users/orgs, recherche, ban, reset, sessions, impersonation, revenus) | s37, s38 | ✅ |
| Emails transactionnels (React Email, adapter Resend, templates traduits, guide DNS) | s06 (+ s09 pour la traduction) | ✅ |
| App shell (layout, nav depuis modules, dark mode, settings compte/org, profil, avatar) | s08, s15 (settings org), s18 (avatar) | ✅ |
| Marketing (landing, sections, pricing depuis config, FAQ, testimonials, contact, newsletter, légales, SEO/OG, sitemap, robots) | s10, s11, s22 | ✅ |
| Blog MDX (liste, article, tags, RSS, OG auto) | s29 | ✅ |
| Docs produit (recherche plein texte) | s30 | ✅ |
| Changelog | s31 | ✅ |
| i18n (routes localisées, switcher, emails traduits) | s09 | ✅ |
| Storage fichiers (S3/R2, presign, contrôle d'accès, avatars) | s18 | ✅ |
| Notifications in-app (centre, badge, préférences) | s32 | ✅ |
| Jobs & cron (adapter, Inngest, events, jobs, planifiées) | s33 | ✅ |
| Déploiement (Dockerfile, compose prod, Coolify, Vercel, checklist env, migrations) | s27 (+ s02 pour la CI) | ✅ |
| Pack RGPD (suppression + purge, export, bannière consentement) | s34, s35, s36 | ✅ |
| Rate limiting + anti-bot (IP/compte, captcha optionnel) | s28 | ✅ |
| Guest checkout | s24 | ✅ |
| Serveur MCP (lister, activer, générer un squelette) | s41 | ✅ |
| Monitoring + analytics (Sentry + source maps, adapter analytics) | s39 | ✅ |
| Onboarding multi-étapes (profil, org, plan, progression) | s40 | ✅ |
| Plugins bonus (waitlist, feedback, roadmap avec votes) | s42, s43, s44 | ✅ |
| Tooling & DX (TS strict, lint, Vitest, Playwright, Actions, compose local, seed, `.env.example`, conventions IA) | s01, s02 (+ s25, s26) | ✅ |

- [x] Chaque feature du tableau « Replicated (core loop) » est livrée par au moins une story. **Aucune lacune de périmètre.** Les deux lignes à complexité 5 (système de modules, billing) sont effectivement éclatées en 3 et 6 stories, ce que le PRD exigeait implicitement.

## Scope
- [x] Aucune story ne réintroduit un item du cimetière. Les frontières sont explicites et correctes : `eject` (s05, sémantique des tables), usage-based (s21 et s23), temps réel (s32), seconds adapters (s06, s33, s39), journal d'audit (s37, borné aux logs applicatifs), providers de paiement autres que Stripe (s19), documentation destinée à des acheteurs (s30).
- [~] Deux extensions légères hors énoncé du PRD (voir minors) : la fusion et le masquage de propositions en s44, le remplacement de la page d'accueil en s42.

## Story quality
- [~] Tranches livrables : oui pour les 44, y compris les stories d'adapter (s06, s18, s33, s39) — le PRD les liste explicitement comme features et le persona `Dev` est un utilisateur réel du produit. s01, s02, s25 et s26 sont de l'outillage de template, assumé et cadré par le préambule.
- [~] Critères testables : très majoritairement oui, trois exceptions (voir minors).
- [x] Notes agentiques présentes et utiles sur les 44 stories (références concurrentielles, pièges concrets, articulations inter-stories).
- [x] Complexité : aucun 5 non éclaté ; les six 4 (s03, s09, s15, s19, s23, s33) énoncent chacun leur risque en gras.

## La liste dans son ensemble
- [x] Ordre de dépendance exécutable : chaque `Dependencies` ne référence que des ids strictement inférieurs, aucun cycle, aucune référence en avant dans les dépendances déclarées. Les écarts avec l'ordre de livraison du PRD (shell avant multi-tenant, storage avant billing) sont documentés et justifiés dans les notes.
- [x] Ids `s01`…`s44`, format `s<numéro>-<slug>`, uniques, sans trou de numérotation.
- [~] Un chevauchement mineur (s37 / s42).

## Findings

**F48 — major — s34-account-deletion** : le critère 4 exige que « chaque module déclare, par catégorie de données, laquelle des deux opérations s'applique » (effacement ou anonymisation). C'est une **extension du contrat de module de s03**, introduite à la story 34, après une vingtaine de modules écrits. C'est exactement le raisonnement que s03 applique à `purge` et `export` (« les ajouter en s34 et s35 obligerait à rouvrir la vingtaine de modules écrits entre-temps ») — appliqué ici à un troisième champ, mais au mauvais endroit. Correctif : ajouter la déclaration de rétention/anonymisation au contrat typé de s03, ou borner explicitement le critère au module de facturation (seul porteur de données légalement conservées) dans s34.

**F49 — major — s37-admin-users** : aucun critère ne dit comment un compte devient superadmin (seed, variable d'environnement, promotion par un superadmin existant). Tous les critères présupposent qu'un superadmin existe ; sans ce critère, la feature « Admin back-office » du périmètre est livrée inaccessible, et s38, s42, s43 et s44 en héritent. Correctif : un critère de désignation et de révocation du superadmin, plus le cas « aucun superadmin configuré ».

**F50 — minor — s37 / s42** : chevauchement et référence en avant douce. s37 critère 10 revendique déjà la consultation et l'export CSV des inscriptions « newsletter, **liste d'attente** » alors que la waitlist n'existe qu'en s42, et s42 critère 4 re-revendique la même tranche. Choisir : s37 livre la vue générique par source (sans nommer la waitlist), s42 se contente d'asserter que sa source y apparaît.

**F51 — minor — s09-i18n, s17-roles-permissions** : deux critères portent sur la **forme du code**, pas sur un comportement observable — « La résolution des chaînes reste la même fonction dans les deux cas » (s09) et « sans branche conditionnelle dans le code appelant » (s17). Ils ne peuvent être vérifiés qu'en revue humaine, pas par un test. Les reformuler en comportement (même signature appelée, mêmes sorties module activé et non activé) ou les marquer explicitement comme points de revue.

**F52 — minor — emails créés après s09** : s09 asserte la traduction des « emails transactionnels existants » (donc ceux de s07). Les emails introduits ensuite — invitation s16, confirmation newsletter s11, lien mot de passe guest s24, confirmation de suppression s34, lien d'export s35, confirmation waitlist s42, notification feedback s43 — n'ont aucun critère de langue, alors que le PRD nomme « templates traduits » et « emails traduits ». Le cas dur n'est couvert nulle part : quelle locale pour un destinataire qui n'a pas encore de compte (invitation, guest checkout, waitlist) ? Correctif : une règle unique dans le contrat de s03 et le cas « destinataire inconnu » tranché en s09.

**F53 — minor — s27-deployment** : deux critères en « recette manuelle » (guides Coolify et Vercel) sont non automatisables. C'est conforme à la convention posée en tête de fichier et la trace est exigée dans la revue, donc acceptable, mais ce sont les deux seuls critères du lot dont le ship dépend d'une exécution humaine : à surveiller au gate de s27.

**F54 — minor — s44-public-roadmap** : la fusion de propositions et le masquage vont au-delà de « roadmap publique avec votes » du périmètre, et les notes en font elles-mêmes « le piège principal » de la story. Élargissement modeste mais réel sur un module d'upsell : à confirmer ou retirer.

**F55 — minor — s42-waitlist** : « remplacer la page d'accueil par la liste d'attente via la configuration » n'est pas dans l'énoncé du périmètre (« page waitlist avec capture email »). Cohérent avec la cible MakerKit, mais c'est une décision à assumer explicitement.

**F56 — minor — s24-guest-checkout vs s28-rate-limiting** : le checkout anonyme est un point d'entrée public créant des comptes, absent de l'énumération de s28 (qui reprend exactement la liste du PRD : auth, invitations, contact, upload). Le mécanisme d'enregistrement de s28 le permet, mais aucun critère ne l'exige. Une ligne à ajouter en s28.

## Points forts (à conserver tels quels)
- Le préambule (socle non désactivable, sémantique des tables d'un module désactivé, régimes CI / hors CI, critères non automatisables) supprime à lui seul une classe entière d'ambiguïtés qui aurait été redécouverte story par story.
- Les critères « module non activé » systématiques et le couple s25 / s26 rendent les critères de succès n°1 et n°4 du PRD vérifiables en continu, pas affirmés.
- Les écarts avec l'ordre de livraison du PRD sont nommés, justifiés et localisés (s08, s18) au lieu d'être silencieux.

## Verdict

Couverture du périmètre complète, cimetière étanche, ordre de dépendance exécutable, complexités correctement éclatées. Les deux majors sont des éditions markdown de quelques lignes (contrat de module en s03, critère de désignation du superadmin en s37), mais le premier se propage à chaque story de module écrite ensuite : c'est précisément le type de défaut que cette revue existe pour attraper avant la phase Architecture.

Max severity: major
Stories ready: no
