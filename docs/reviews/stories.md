# Stories Review — killer-boilerplate

> Revue en contexte frais de `docs/stories.md` face à `docs/prd.md`. 39 stories (s01→s39). Seconde passe : les findings F1–F16 de la revue précédente ont été vérifiés indépendamment et sont tous traités (one-time en s16, harnais de parcours en s21, contrat `purge`/`export` en s02, s31 reformulé sans PostHog, etc.). Numérotation des findings poursuivie à partir de F17.

## Perimeter coverage

| PRD feature (core loop) | Covered by | OK? |
|---|---|---|
| Système de modules + `config/features.ts` + CLI `toggle` (5) | s02-module-registry, s03-cli-toggle-module | ✅ (5 découpé en 4+3) |
| Auth (password, magic link, OAuth, vérif, reset, sessions, 2FA, passkeys) (3) | s05, s08, s09, s10, s06 (sessions) | ✅ |
| Multi-tenant (orgs, invitations, rôles, switcher, scoping) (4) | s11, s12, s13 | ✅ |
| Billing Stripe + abstraction (checkout, portail, abonnements, one-time, seat, webhooks, trials) (5) | s15, s16, s17, s18 | ✅ (5 découpé en 4 stories) |
| Admin back-office (users/orgs, recherche, ban, reset, sessions, impersonation, métriques) (3) | s32, s33 | ✅ |
| Emails transactionnels (React Email, adapter, templates traduits, guide DNS) (3) | s04 (+ s07 traduction) | ✅ |
| App shell (layout, nav depuis modules, dark mode, settings compte/org, profil, avatar) (3) | s06 (+ s11 settings org, s14 avatar) | ✅ |
| Marketing (landing, sections, pricing depuis config, FAQ, testimonials, contact, newsletter, légales, SEO/OG, sitemap, robots) (2) | s19 | ✅ |
| Blog MDX (liste, article, tags, RSS, OG auto) (3) | s24 | ✅ |
| Docs produit (recherche plein texte) (3) | s25 | ✅ |
| Changelog (2) | s26 | ✅ |
| i18n (next-intl, routes localisées, switcher, emails traduits) (4) | s07 | ⚠️ contenu couvert, désactivation du module absente (F17) |
| Storage fichiers (S3/R2, presign, contrôle d'accès, avatars) (3) | s14 | ✅ |
| Notifications in-app (centre, badge, préférences) (3) | s27 | ✅ |
| Jobs & cron (adapter, Inngest, events, cron) (4) | s28 | ✅ |
| Déploiement (Dockerfile, compose prod, Coolify, Vercel, checklist env, migrations) (3) | s22 (+ s01 CI) | ✅ |
| Pack RGPD (suppression + purge, export, consentement) (3) | s29, s30, s31 | ✅ |
| Rate limiting + anti-bot (captcha optionnel) (3) | s23 | ✅ |
| Guest checkout (3) | s20 | ✅ |
| Serveur MCP (3) | s36 | ✅ |
| Monitoring + analytics (Sentry + source maps, adapter analytics) (2) | s34 | ✅ |
| Onboarding multi-étapes (profil, org, plan, progression) (3) | s35 | ✅ |
| Plugins bonus (waitlist, feedback, roadmap) (3) | s37, s38, s39 | ✅ |
| Tooling & DX (TS strict, lint, Vitest, Playwright, GHA, Docker, seed, `.env.example` typé, conventions IA) (3) | s01 | ✅ |

- [x] Chaque feature du tableau « Replicated (core loop) » est livrée par au moins une story — **aucun trou critique**
- [ ] Les critères de succès du PRD adossés au périmètre sont portés — le n°4 (preuve de modularité) n'a pas de propriétaire (F18)

## Scope
- [x] Aucune story ne réintroduit un élément du cimetière — `eject` explicitement écarté (préambule + s03), module AI absent, providers de paiement autres que Stripe rappelés au cimetière (s15), usage-based rappelé (s18), temps réel rappelé (s27), multi-ORM / non-Postgres / mobile absents, journal d'audit tenu à distance et précisé (s32), clés API et webhooks sortants absents, appareil commercial écarté (s25)
- [x] Aucune story ne dépasse le périmètre — deux zones grises seulement (F23, F24)

## Story quality
- [x] Chaque story est une tranche livrable de bout en bout — s01 (scaffolding), s04 (adapter mail) et s21 (harnais E2E) sont défendables : persona Dev, critères observables ; s04 reste le plus limite (F25)
- [ ] Chaque critère d'acceptation peut devenir un test — deux critères contradictoires (F19, F20)
- [x] Notes agentiques présentes et utiles — 39/39, avec références aux 4 cibles, pièges concrets et justification des écarts d'ordre
- [x] Complexité notée ; aucun 5 non découpé ; chaque 4 énonce son risque — les six 4 (s02, s07, s11, s15, s18, s28) l'annoncent en gras ; deux scores discutables (F26)

## La liste dans son ensemble
- [x] Ordre de dépendance exécutable — les 39 stories ne dépendent que d'ids antérieurs, aucun cycle, aucune référence en avant dans les critères
- [ ] Dépendances déclarées exactes — quatre listes incomplètes ou artificielles (F21, F22)
- [x] Ids bien formés (`s<numéro>-<slug>`), uniques et stables — s01→s39, aucun doublon, aucun slug ambigu
- [x] Pas de chevauchement — les frontières fragiles sont explicitement tranchées (s15 config vs s19 tarifs, s02 contrat vs s29/s30 orchestration) ; un chevauchement résiduel mineur (F27)

## Findings

**F17 — major — s07-i18n (+ s15/s16/s17 billing)** : deux modules pourtant traités comme désactivables ailleurs n'ont aucun critère « module non activé » dans leur propre story.
(a) **i18n** : le critère de succès n°4 du PRD nomme explicitement i18n parmi les trois modules désactivés de la preuve de modularité. Or s07 impose inconditionnellement « les routes sont préfixées par la locale » et n'énonce nulle part ce que devient l'application sans le module. C'est la story la plus traversante du lot : décider après coup que les routes sont toujours préfixées, ou pas, réécrit chaque route livrée entre s07 et s39.
(b) **billing** : s33 AC6 affirme « Module de facturation non activé : la page n'existe pas » et s35 AC3 « sans facturation, l'étape de choix d'offre n'existe pas », alors qu'aucune de s15/s16/s17 ne définit ce comportement. Deux stories tardives s'appuient sur une sémantique que personne n'a livrée.
Comparer avec s11, s14, s18, s26, s27, s33, s38, s39 qui portent bien ce critère : le patron existe, il manque à ces deux-là.

**F18 — major — coverage (critère de succès n°4 du PRD)** : « Sur un projet généré avec multi-tenant, seat billing et i18n désactivés : l'application démarre, la suite de tests passe, et il ne reste aucune route morte, aucune entrée de nav orpheline, aucune table inutilisée. » Aucune story ne porte cette recette combinée. Chaque story de module teste son propre off (s11, s14, s18…), mais l'assemblage « trois modules coupés simultanément » n'est vérifié nulle part — et c'est l'angle n°1 du PRD, celui qui distingue le produit de MakerKit. Exactement la situation qui a fait naître s21 pour le critère n°1 (F16) : il manque son symétrique. Un harnais « profil de configuration minimal » exécuté en CI est peu coûteux tant qu'il est posé tôt.

**F19 — major — s27-notifications-inapp (AC6)** : « un test vérifie qu'aucun appel direct au mailer n'existe hors de cette fonction ». Pris à la lettre, ce test échoue sur le code déjà livré : s05 envoie vérification, magic link et réinitialisation via le mailer, s12 envoie l'invitation, s20 envoie le lien de définition de mot de passe, s29 l'email de confirmation de suppression, s30 le lien d'export. L'implémenteur devra soit restreindre la règle, soit refactorer six stories antérieures dans le tunnel de s27 — expansion de périmètre invisible. Restreindre le critère aux emails **de notification** (types déclarés dans le registre de préférences), pas à tout appel au mailer.

**F20 — major — s21-golden-path-e2e (AC6 vs préambule)** : AC6 dit « Le scénario s'exécute en CI sur les clés de test, et son échec bloque la CI », alors que le préambule du fichier pose comme règle générale que tout critère portant sur un appel réel à un tiers « s'exécute hors CI par défaut », que la CI utilise une implémentation d'enregistrement — et que la note agentique de la story elle-même dit qu'il faut « un tunnel ou un rejeu d'événements enregistrés ». Trois énoncés, trois politiques. Comme ce critère est le seul gate CI du parcours de paiement, l'ambiguïté se paiera à l'exécution : trancher explicitement (rejeu d'événements enregistrés en CI, clés de test hors CI, ou double scénario).

**F21 — minor — s08, s23, s35 : dépendances déclarées incomplètes** : s08 AC5 exige la page de paramètres du compte (livrée en s06) mais ne déclare que s05 ; s23 limite « l'invitation » (s12) et « le téléversement » (s14) sans les déclarer ; s35 AC7 traite l'utilisateur « arrivé par invitation » (s12) sans le déclarer. L'ordre global reste exécutable (toutes ces stories sont antérieures), mais le préambule promet des dépendances **réelles** et `/ks-research` lira ces listes.

**F22 — minor — s10-passkeys, s21-golden-path-e2e : dépendances artificielles** : s10 déclare s09-two-factor alors que WebAuthn ne dépend pas de TOTP — sa vraie dépendance est s06 (paramètres du compte) ; s21 déclare s18-seat-billing alors qu'aucun de ses scénarios (abonnement, achat unique, guest checkout) n'implique de siège. Deux sérialisations inutiles qui interdisent la parallélisation que le préambule revendique.

**F23 — minor — s17-trials-and-gating (AC6)** : « Une limite quantitative configurée (nombre d'objets, de membres, de fichiers) est vérifiée côté serveur » — c'est du quota de plan, pas de la facturation à l'usage, donc hors cimetière. Mais le compteur d'objets consommés est précisément la brique dont la « facturation à l'usage » du cimetière a besoin. Ajouter une phrase dans les notes : le compteur sert au refus d'action, jamais à une assiette de facturation.

**F24 — minor — s04-transactional-emails** : trois implémentations de `Mailer` sont livrées (Resend, enregistrement CI, capture locale en développement) alors que le cimetière exclut les « secondes implémentations d'adapters ». Ce sont des doublures de test, pas des providers — acceptable, mais l'écrire dans les notes évite qu'un implémenteur en déduise qu'un adapter SMTP est légitime « puisqu'il y en a déjà trois ».

**F25 — minor — s04-transactional-emails** : la story ne livre qu'une interface, un provider et un template de démonstration : aucun email que quelqu'un reçoit réellement dans un parcours produit (le premier arrive en s05). C'est la story la plus proche d'une couche technique du lot. Défendable au vu de l'ordre choisi (justifié dans les notes) ; la rendre pleinement livrable coûterait de la porter avec son premier email réel.

**F26 — minor — s01 et s30 : scores probablement sous-évalués** : s01 vaut 3 pour 10 critères couvrant squelette Next.js, validation d'environnement, migrations, seed, Docker, health, quatre commandes de qualité, conventions agents et workflow CI — au-delà de « business logic / plusieurs états ». s30 vaut 2 pour un export inter-modules, orchestré par job de fond, avec archive, lien signé expirant, permission owner et garde anti-doublon — au-delà de « form + persistence + list ». Aucun n'atteint 5, donc aucun découpage n'est imposé, mais s01 est le candidat naturel à un découpage (démarrage vs harnais qualité/CI).

**F27 — minor — s19-marketing-pages vs s37-waitlist** : les deux capturent un email public avec déduplication silencieuse (s19 AC5, s37 AC1-AC2). Ce ne sont pas la même tranche de valeur, mais rien ne dit si s37 réutilise le stockage de la newsletter ou en crée un second. Le préciser dans les notes de s37 évite deux modèles d'inscription concurrents.

**F28 — minor — s09-two-factor (AC6) vs s23-rate-limiting** : s09 exige « les tentatives de vérification échouées sont limitées en nombre par compte », livré 14 stories avant le module de limitation de débit — et s23 n'énumère pas la vérification 2FA parmi ses points d'entrée protégés. Soit s09 pose un compteur local que s23 devra absorber, soit l'endpoint 2FA échappe à la limitation finale. Nommer lequel.

**F29 — minor — s02-module-registry (AC7)** : « Deux modules de démonstration (l'un activé, l'autre non) prouvent les cinq critères précédents » — les critères portant sur le comportement d'un module sont les AC3 à AC6, soit quatre. Un numéro de critère faux dans la story la plus structurante du projet se propage aux revues.

## Verdict

Aucun trou de périmètre, aucune fuite de cimetière, aucun cycle ni référence en avant : la révision post-F1–F16 a solidement refermé les criticals. Restent quatre majors, tous corrigeables par une édition markdown : deux sémantiques de désactivation manquantes (F17), la recette de modularité orpheline (F18) et deux critères qui se contredisent avec le reste du fichier (F19, F20). Les corriger maintenant coûte quelques lignes ; les découvrir en s07 ou s27 coûte une reprise transversale.

Max severity: major
Stories ready: no
