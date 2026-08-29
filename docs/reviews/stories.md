# Stories Review — killer-boilerplate

> Revue en contexte frais de `docs/stories.md` face à `docs/prd.md`. Chaque problème est classé : critical / major / minor.

## Perimeter coverage

| PRD feature (core loop) | Covered by | OK? |
|---|---|---|
| Système de modules + `config/features.ts` + CLI `toggle` (5) | s02-module-registry, s03-cli-toggle-module | ✅ (5 correctement découpé) |
| Auth (password, magic link, OAuth, vérif email, reset, sessions, 2FA, passkeys) (3) | s05, s08, s09, s10, s06 (sessions) | ✅ |
| Multi-tenant (orgs, invitations, rôles, switcher, scoping) (4) | s11, s12, s13 | ✅ |
| Billing Stripe + abstraction (checkout, portail, abonnements, **one-time**, seat billing, webhooks, trials) (5) | s15, s16, s18 | ❌ **`one-time` absent partout** |
| Admin back-office (users/orgs, recherche, ban, reset, sessions, impersonation, métriques) (3) | s29, s30 | ✅ |
| Emails transactionnels (React Email, adapter, templates traduits, guide DNS) (3) | s04 (+ s07 pour la traduction) | ✅ |
| App shell (layout, nav depuis modules, dark mode, settings compte/org, profil, avatar) (3) | s06 (+ s11 settings org, s14 avatar) | ✅ |
| Marketing (landing, sections, pricing depuis config, FAQ, testimonials, contact, newsletter, légales, SEO/OG, sitemap, robots) (2) | s17 | ✅ |
| Blog MDX (liste, article, tags, RSS, OG auto) (3) | s21 | ✅ |
| Docs produit (recherche plein texte) (3) | s22 | ✅ |
| Changelog (2) | s23 | ✅ |
| i18n (next-intl, routes localisées, switcher, emails traduits) (4) | s07 | ✅ |
| Storage fichiers (S3/R2, presign, contrôle d'accès, avatars) (3) | s14 | ✅ |
| Notifications in-app (centre, badge, préférences) (3) | s24 | ✅ |
| Jobs & cron (adapter, Inngest, events, cron) (4) | s25 | ✅ |
| Déploiement (Dockerfile, compose prod, Coolify, Vercel, checklist env, migrations en CI) (3) | s19 (+ s01 pour la CI) | ✅ |
| Pack RGPD (suppression + purge, export, consentement) (3) | s26, s27, s28 | ✅ |
| Rate limiting + anti-bot (captcha optionnel) (3) | s20 | ✅ |
| Guest checkout (3) | s18 | ✅ |
| Serveur MCP (3) | s33 | ✅ |
| Monitoring + analytics (Sentry + source maps, adapter analytics) (2) | s31 | ✅ |
| Onboarding multi-étapes (profil, org, plan, progression) (3) | s32 | ⚠️ étape « profil » jamais nommée |
| Plugins bonus (waitlist, feedback, roadmap) (3) | s34, s35, s36 | ✅ |
| Tooling & DX (TS strict, lint, Vitest, Playwright, GHA, Docker Compose, **seed**, `.env.example` typé, **conventions agents IA**) (3) | s01 | ❌ `seed` et conventions IA sans critère |

- [ ] Chaque feature du tableau « Replicated (core loop) » du PRD est livrée par au moins une story — 1 trou critique (one-time), 1 trou majeur (seed / conventions IA), 1 mineur (étape profil).

## Scope
- [x] Aucune story ne réintroduit un élément du cimetière du PRD — sauf une zone grise (s03, voir F3)
- [x] Aucune story ne dépasse le périmètre (waitlist / feedback / roadmap sont bien dans « Plugins bonus »)

Vérifiés comme correctement tenus à distance : `eject` (exclu explicitement en s03), module AI (absent), autres providers de paiement (s15 le rappelle), usage-based (absent), temps réel (s24 le rappelle), multi-ORM / non-Postgres / mobile (absents), clés API & webhooks sortants (absents), secondes implémentations d'adapters (s04, s25, s31 les excluent), appareil commercial (s22 le rappelle).

## Story quality
- [x] Chaque story est une tranche livrable de bout en bout — s01 est du scaffolding mais reste défendable : le Dev est l'utilisateur primaire du PRD et les critères sont observables
- [ ] Chaque critère d'acceptation peut devenir un test — quelques critères non automatisables sans méthode de vérification déclarée
- [x] Notes agentiques présentes et utiles — présentes dans les 36 stories, avec références aux 4 cibles et pièges concrets
- [x] Complexité notée ; aucun 5 non découpé ; chaque 4 énonce son risque — les six 4 (s02, s07, s11, s15, s16, s25) annoncent leur risque en gras

## La liste dans son ensemble
- [x] Ordre de dépendance exécutable : aucun cycle, aucune référence en avant **dans le graphe** (les 36 dépendances pointent toutes vers un id antérieur)
- [ ] Pas de référence en avant **dans les critères** — trois cas (F2, F4, F5)
- [x] Ids bien formés (`s<numéro>-<slug>`), uniques et stables — s01→s36, aucun doublon, aucun slug ambigu
- [ ] Aucun chevauchement ni doublon — un chevauchement réel (F2)

## Findings

**F1 — critical — coverage** : `one-time` (paiement unique / licence à vie) est nommé dans la ligne Billing du périmètre et n'apparaît dans aucun critère d'aucune story. s15 ne parle que d'abonnements (états actif/essai/retard/annulé, portail, gating « plan supérieur »), s16 de sièges, s18 de guest checkout d'un abonnement. C'est un mode de paiement distinct : `mode: payment` au checkout, événements webhook différents, modèle d'entitlement sans `subscription`. Invisible jusqu'au ship, et bloquant pour tout projet vendant une licence unique.

**F2 — major — s15-subscribe-stripe / s17-marketing-pages** : les deux stories revendiquent la même tranche. s15 AC1 : « Les plans sont définis dans une configuration unique, partagée par la page de tarifs et le checkout ». s17 AC2 : « La page de tarifs est générée depuis la même configuration de plans que le checkout ». Or la page de tarifs est livrée en s17, qui dépend de s15 : le critère de s15 est intestable au moment où s15 est exécutée. s15 ne doit porter que la configuration de plans partagée (et son test) ; s17 porte la dérivation de la page.

**F3 — major — s02-module-registry vs s03-cli-toggle-module** : contradiction sur le cœur de l'angle n°1. s02 AC5 : « Les migrations d'un module désactivé ne sont pas appliquées : ses tables sont absentes de la base ». s03 AC3 : « la désactivation prévient que ses tables resteront en base et indique la commande de nettoyage ». Deux problèmes : (a) aucune story ne dit laquelle des deux sémantiques fait foi pour un module activé puis désactivé, alors que le critère de succès n°4 du PRD exige « aucune table inutilisée » ; (b) « la commande de nettoyage » désigne une commande définie nulle part, et supprimer les tables d'un module désactivé est très exactement ce que le cimetière appelle `eject`. Soit c'est une fuite de cimetière, soit c'est une référence morte.

**F4 — major — s26-account-deletion (contrat de module posé trop tard)** : les notes de s26 disent « C'est le contrat de module de s02 qui doit porter la responsabilité de suppression », et s27 ajoute l'export au même endroit. Or le contrat de s02 (AC1) ne liste que : identifiant, schéma, routes, nav, traductions, webhooks. Entre s02 et s26, une vingtaine de modules auront été écrits sans déclarer purge ni export — chacun devra être rouvert. Ajouter `purge` et `export` au contrat dès s02 AC1 (implémentation vide au départ) élimine la reprise.

**F5 — major — s28-cookie-consent** : trois critères sur six portent sur des scripts d'analyse qui n'existent qu'en s31. s31 dépend de s28, donc l'ordre n'est pas inversable : reformuler les critères de s28 en termes d'état de consentement et de scripts non essentiels (testable avec un script factice), sinon la story n'est pas vérifiable à sa livraison.

**F6 — major — coverage / s01-boot-blank-app** : la ligne « Tooling & DX » nomme un `seed` et des « conventions pour agents IA ». Ni l'un ni l'autre n'apparaît dans un critère d'acceptation, dans s01 ou ailleurs. Le `.env.example` typé n'est mentionné que dans les notes agentiques, pas dans les critères (seule la validation Zod l'est).

**F7 — minor — s35, s36, s23, s27** : le champ Dependencies encode l'ordre de lecture, pas la dépendance réelle. s35 dépend de s34-waitlist alors que ses vraies dépendances sont s24 (notifications) et s29 (back-office) ; s36 dépend de s35 alors qu'il lui faut s29, s20 et s17 ; s23 dépend de s22 alors que le pipeline MDX vient de s21 ; s27 dépend de s26 pour le contrat de purge. Cela interdit toute parallélisation et envoie une fausse piste à `/ks-research`.

**F8 — minor — s26-account-deletion** : dépendances incomplètes. Le critère « annule son abonnement chez le provider de paiement » implique s15, le critère « dernier propriétaire » implique s11/s13. Ces stories sont antérieures, donc l'ordre reste exécutable, mais la liste est fausse.

**F9 — minor — s04, s25, s31** : critères exigeant un appel tiers réel (« Resend envoie réellement l'email », « Inngest exécute réellement un job », « PostHog envoie réellement les événements ») sans indiquer la méthode de vérification. Préciser sandbox, enregistrement de requête, ou recette manuelle documentée — sinon l'implémenteur choisira et la revue ne pourra pas trancher.

**F10 — minor — s17-marketing-pages** : complexité 2 sous-estimée et AC1 vague. La story empile landing sectionnée, tarifs dérivés de la config, contact avec envoi d'email, newsletter persistée, pages légales, SEO/OG, sitemap et robots — au-delà du « form + persistence + list » que vaut un 2 sur l'échelle du PRD. « Configurables sans modifier leur code » n'est pas testable tel quel : nommer la surface de configuration.

**F11 — minor — s15-subscribe-stripe** : 8 critères couvrant checkout, webhooks idempotents, signature, portail, gating par plan, essais et interface `Payments`. Candidat au découpage, d'autant que F1 va y ajouter le one-time.

**F12 — minor — s19-deployment** : les critères « Le guide Coolify / Vercel permet un déploiement de bout en bout depuis un dépôt neuf » ne sont pas automatisables. Les garder, mais les marquer comme recette manuelle avec une trace attendue.

**F13 — minor — s29-admin-users** : la note « toute action d'impersonation doit être journalisée, y compris sa fin » frôle le « Journal d'audit » du cimetière. Préciser qu'il s'agit de logs applicatifs et non d'une table d'audit alimentée par chaque module.

**F14 — minor — s32-onboarding** : le PRD nomme quatre étapes (profil, création/jonction d'organisation, choix de plan, progression persistée). L'étape « profil » n'apparaît dans aucun critère.

**F15 — minor — ordre de livraison vs PRD** : le PRD ordonne « auth → multi-tenant → billing → app shell → marketing ». Les stories placent l'app shell (s06) avant multi-tenant et billing, et le storage (s14) avant le billing. Réordonnancements techniquement défendables ; deux sont justifiés dans les notes (s04 avant l'auth, i18n tôt), ceux de s06 et s14 ne le sont pas. Une ligne de justification suffit.

**F16 — minor — critère de succès n°1 du PRD** : « Chrono clone → premier paiement en moins de 30 minutes, mesure de recette du repo, rejouée à chaque story » n'est porté par aucune story. Ce n'est pas une feature du tableau, mais sans harnais personne ne le rejouera.

## Note de calibration
F1 vs F6 : les deux sont des éléments nommés d'une ligne du périmètre par ailleurs couverte. `one-time` est retenu en critical parce que c'est un mode de paiement complet (mode checkout distinct, événements webhook distincts, entitlement sans abonnement) dont l'absence rend le module billing inutilisable pour un projet vendant une licence unique. `seed` et conventions IA sont de la plomberie DX qu'un implémenteur ajoutera dans une autre story sans refonte.

## Verdict
Max severity: critical
Stories ready: no
