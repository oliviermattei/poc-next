# PRD — killer-boilerplate (nom de code)

## Target SaaS
Quatre boilerplates SaaS commerciaux, pris en **spec composite** (union des features, pas un maître unique) :

| Cible | URL | Stack | Positionnement |
|---|---|---|---|
| Supastarter | https://supastarter.dev | Next.js + Better Auth + Prisma/Drizzle + Hono | Le plus complet : orgs, i18n, 5 providers de paiement, blog/docs, AI |
| MakerKit | https://makerkit.dev | Next.js + Supabase | Le plus B2B : comptes perso + comptes d'équipe, RBAC, 13 feature flags |
| ShipFast | https://shipfa.st | Next.js + Mongo/Supabase | Le plus minimal : auth, Stripe, emails, SEO, composants marketing |
| ShipSaaS | https://ship-saas.now | Next.js + Drizzle + Postgres + Inngest | FR, archi 3 couches, conventions pour agents IA, admin, CI |

## Kill mode
**Interne d'abord, vendable ensuite.** Le boilerplate est construit pour servir de base aux projets d'Olivier. Il est écrit sous les contraintes qui permettent une commercialisation ultérieure (config par `.env`, zéro hardcode personnel, docs minimales, code propre), mais le tunnel de vente, la gestion de licences, l'accès repo et le support client sont **hors périmètre v1**.

Conséquence sur le scope : on n'ajoute aucune feature « pour la grille comparative ». Chaque feature retenue doit servir un projet réel.

## Why kill it
- **Coût des licences.** 199-299 $ par boilerplate, et il en faudrait plusieurs pour obtenir la couverture de l'union. Licences par développeur ou par produit selon les éditeurs.
- **Stack imposée.** Les quatre imposent Next.js, et souvent Supabase ou Mongo par-dessus. Aucun ne laisse le choix de l'ORM ni du provider Postgres sans réécriture.
- **Bloat.** Ils empilent pour vendre sur la grille comparative : 5 providers de paiement, chatbot AI, Figma kit, leaderboards, communauté Discord. En pratique, 70 % ne sert jamais — et le code mort reste dans chaque projet généré.
- **Modularité inexistante.** Vérifié : MakerKit propose 13 booléens d'environnement (`NEXT_PUBLIC_ENABLE_TEAM_ACCOUNTS`, `..._TEAM_ACCOUNTS_BILLING`, …) qui masquent l'UI mais laissent le code et les tables en place ; Supastarter propose des fichiers `config.ts` par app ; ShipFast et ShipSaaS ne proposent rien. **Aucun des quatre ne sait retirer une feature.**

## Problem
Démarrer un SaaS demande à chaque fois de réécrire les mêmes 3 000 lignes : auth, organisations, facturation, emails, back-office, pages marketing. Les boilerplates du marché résolvent ce problème mais en imposent un autre : un monolithe figé, dont on hérite en entier même pour un projet solo qui n'aura jamais d'équipe.

Le besoin : **une base dont on active exactement les modules nécessaires au projet**, du SaaS solo mono-utilisateur au B2B multi-tenant facturé au siège, sans repartir de zéro ni traîner du code mort.

Pourquoi maintenant : plusieurs projets en cours (mdb, feedvox, watchvault, sharepack) ont chacun rebâti ce socle séparément, avec des solutions divergentes et aucune capitalisation.

## Target users
- **Primaire — Olivier, développeur solo multi-projets.** Lance plusieurs SaaS par an, sur des stacks proches mais des besoins différents (l'un a des équipes, l'autre non ; l'un facture au siège, l'autre au forfait). Veut posséder et comprendre chaque ligne du socle.
- **Secondaire (post-v1) — indie makers et développeurs solo.** Cible d'une commercialisation ultérieure : même profil, même douleur, prêts à payer 200-300 $ pour ne pas réécrire le socle. Ils ne sont pas dans le périmètre v1 mais leurs contraintes (config, absence de hardcode) le sont.

## Perimeter — the 20% that matters

### Replicated (core loop)

| Feature | Complexity (1-5) | Why this score |
|---|---|---|
| **Système de modules + `config/features.ts` + CLI `toggle`** | 5 | Le noyau et l'angle. Chaque module possède son schéma Drizzle, ses routes, sa nav, ses webhooks, ses traductions. Config typée pour activer/désactiver, CLI qui édite la config et déclenche la migration. Traverse tout le reste : c'est une contrainte d'architecture, pas un écran. |
| **Auth** (password, magic link, OAuth Google/GitHub, vérif email, reset, sessions, 2FA TOTP + codes de secours, passkeys) | 3 | Better Auth couvre la logique nativement (plugins `two-factor`, `passkey`, `magic-link`). Le coût réel est l'UI : écrans d'auth, gestion des passkeys dans les settings, fallback appareil non compatible. |
| **Multi-tenant** (organisations, invitations par email, rôles owner/admin/member, switcher, scoping des requêtes) | 4 | Plugin `organization` de Better Auth pour la logique, mais le scoping traverse chaque requête et chaque écran. Le point dur : rester correct quand le module est désactivé. |
| **Billing Stripe + couche d'abstraction provider** (checkout, portail client, abonnements, one-time, seat billing, webhooks, trials) | 5 | Interface provider (`createCheckout`, `portal`, `webhook → events internes`) avec Stripe comme seule implémentation. Le seat billing synchronise la quantité Stripe à chaque invitation ou retrait de membre : idempotence et rejeu des webhooks obligatoires. |
| **Admin back-office** (liste users/orgs, recherche, ban, reset, sessions, impersonation, métriques revenus) | 3 | Le plugin `admin` de Better Auth fournit déjà liste, ban, sessions et impersonation avec garde-fou. Reste les écrans, la vue organisations et les métriques. |
| **Emails transactionnels** (React Email, adapter mail avec Resend comme implémentation, templates traduits, guide DNS DKIM/SPF/DMARC) | 3 | Adapter provider + templates. Le guide de délivrabilité est de la doc, pas du code. |
| **App shell** (layout dashboard, navigation alimentée par les modules actifs, dark mode, settings compte et organisation, profil, avatar) | 3 | La nav doit se construire depuis les modules activés — c'est la première vraie mise à l'épreuve du système de modules. |
| **Marketing** (landing + sections réutilisables, pricing généré depuis la config des plans, FAQ, testimonials, contact, newsletter, pages légales, SEO/OG, sitemap, robots) | 2 | Pages statiques et sections. Le seul point non trivial : la page pricing dérivée de la même config que le billing, pour qu'elles ne divergent jamais. |
| **Blog MDX** (liste, article, tags, RSS, OG auto) | 3 | Canal d'acquisition SEO n°1 d'un SaaS. Présent chez Supastarter, MakerKit et ShipFast. |
| **Docs produit** (Fumadocs ou équivalent, recherche plein texte) | 3 | Parité Supastarter. Sert aussi la commercialisation ultérieure. |
| **Changelog** | 2 | Parité MakerKit. Rendu MDX, faible surface. |
| **i18n** (next-intl, routes localisées, switcher, emails traduits) | 4 | Coûteux en continu : chaque chaîne, chaque email, chaque module doit porter ses traductions. À poser tôt, sinon c'est une reprise intégrale. |
| **Storage fichiers** (S3/R2 compatible, upload presigné, contrôle d'accès, avatars) | 3 | Presign + politique d'accès par organisation. |
| **Notifications in-app** (centre, badge non-lus, préférences email/in-app) | 3 | Temps réel exclu du périmètre v1 (voir cimetière) : lecture au chargement et à la navigation. |
| **Jobs & cron** (adapter tâches de fond, Inngest comme implémentation par défaut : events, jobs asynchrones, tâches planifiées) | 4 | Parité ShipSaaS (Inngest) et Supastarter (trigger.dev, QStash, BullMQ). Sert les relances de trial, les digests, les nettoyages. Infrastructure externe à câbler et à tester. |
| **Déploiement** (Dockerfile + compose de production, guide Coolify, guide Vercel, checklist des variables d'environnement, migrations jouées en CI) | 3 | Parité 4/4. Le point non trivial : rejouer les migrations Drizzle au déploiement sans casser une instance en cours. |
| **Pack RGPD** (suppression de compte et d'organisation avec purge, export des données utilisateur, bannière de consentement liée aux analytics) | 3 | Seule la suppression existe chez MakerKit ; l'export et le consentement n'existent chez aucun des quatre. La purge doit traverser tous les modules actifs : elle dépend directement du système de modules. |
| **Rate limiting + anti-bot** (limitation par IP et par compte sur auth, invitations, contact et upload ; captcha optionnel sur les formulaires publics) | 3 | Aucun des quatre ne le fournit. Sans lui, une inscription publique se fait spammer en quelques jours. |
| **Guest checkout** (payer sans compte, création automatique du compte après paiement, rattachement de l'abonnement) | 3 | Exclusivité ShipSaaS. Le point dur : réconcilier un paiement anonyme avec un compte créé après coup, et traiter le cas de l'email déjà existant. |
| **Serveur MCP** (piloter le boilerplate depuis un agent : lister les modules, activer, générer un squelette de module) | 3 | Exclusivité MakerKit. Prolonge le CLI : même logique de modules, autre surface d'appel. |
| **Monitoring + analytics** (Sentry avec source maps, adapter analytics PostHog/Plausible/GA, marketing et produit) | 2 | Parité 3/4. Essentiellement de la configuration et un adapter. |
| **Onboarding multi-étapes** (profil, création ou jonction d'organisation, choix de plan, progression persistée) | 3 | Annoncé chez Supastarter. Dépend des modules actifs : les étapes doivent disparaître avec leur module. |
| **Plugins bonus** (waitlist avec capture email, widget feedback, roadmap publique avec votes) | 3 | Exclusivité MakerKit, vendue comme des plugins. Positionnés ici comme **modules d'upsell** : livrés en dernier, jamais avant que le socle tourne. |
| **Tooling & DX** (TypeScript strict, lint, Vitest, Playwright, GitHub Actions, Docker Compose local, seed, `.env.example` typé et validé, conventions pour agents IA) | 3 | Parité ShipSaaS et Supastarter. Les conventions IA sont de la parité, pas un angle. |

Scale: 1 trivial CRUD · 2 form + persistence + list · 3 business logic / several states · 4 integrations, payments, roles · 5 real-time, migrations, external systems.

**Ordre de livraison.** Le système de modules d'abord (il conditionne tout le reste), puis le socle utilisable : auth → multi-tenant → billing (guest checkout compris) → app shell → marketing → déploiement. Ensuite les modules périphériques : emails, storage, rate limiting, i18n, notifications, jobs, pack RGPD, blog/docs/changelog, admin, monitoring, serveur MCP. Les **plugins d'upsell (waitlist, feedback, roadmap) et l'onboarding passent en dernier** : ce sont des bonus, pas le socle. Pas de contrainte de délai — l'ordre est technique, pas commercial.

### Explicitly NOT replicated (graveyard)
- **CLI `eject`** (suppression définitive du code, des deps et des tables des modules désactivés). Réévaluable une fois 3-4 modules livrés : les modules étant autonomes par construction, l'ajouter plus tard ne demandera pas de refonte.
- **Module AI in-app** : chatbot, adapters LLM, streaming, quotas par plan. Seul Supastarter l'a réellement — MakerKit et ShipSaaS vendent de l'« AI » qui est de l'outillage pour agents de code, pas une feature utilisateur. Rarement réutilisable tel quel d'un projet à l'autre.
- **Providers de paiement autres que Stripe** (LemonSqueezy, Polar, Creem, Dodo). L'abstraction existe, les implémentations non. Chaque provider double la surface de webhooks à maintenir.
- **Facturation à l'usage (metered/usage-based).** Le seat billing est dans le périmètre, le compteur d'usage non.
- **Notifications temps réel** (websockets, Supabase Realtime). Désactivé par défaut même chez MakerKit.
- **Multi-ORM et multi-framework** : pas de variante Prisma, pas de variante Nuxt/Vue, pas de monorepo Bun + Elysia. Une stack, assumée.
- **Providers de base de données hors PostgreSQL.**
- **Application mobile / Expo.**
- **Journal d'audit** (qui a fait quoi dans l'organisation). Aucun des quatre ne le fournit. Attendu en B2B, mais il impose que chaque module y écrive : à reprendre quand un projet réel le demandera.
- **Clés API et webhooks sortants destinés aux clients du SaaS.** Feature produit, pas socle. Absent des quatre.
- **Secondes implémentations d'adapters** (SMTP, MinIO, Umami, BullMQ, trigger.dev…). L'interface est livrée, une seule implémentation aussi. Ajouter un provider est un exercice de quelques heures, pas un module.
- **Tout l'appareil commercial** : site de vente, gestion de licences, accès au repo client, support, versioning public, communauté Discord, Figma UI kit, leaderboards, bundles de réductions. Conséquence directe du kill mode « interne d'abord ».

### The angle (done differently / better)
1. **Des modules réellement autonomes, pas des flags d'UI.** MakerKit masque avec des booléens d'environnement en laissant les tables `organizations`, `members` et `invitations` dans tous les projets, y compris solo. Supastarter configure sans découper. Ici, un module désactivé ne pose ni table, ni route, ni entrée de nav, ni webhook. Un projet solo n'a aucune trace du multi-tenant.
2. **Un CLI de toggle réversible.** `npx ks toggle <module>` édite la config typée et déclenche la migration correspondante, à tout moment de la vie du projet — pas seulement au scaffolding, contrairement aux générateurs à la create-t3-app.
3. **Traçabilité du pipeline killer-saas.** Chaque module arrive avec sa recherche, son plan, ses tests et sa revue versionnés dans `docs/`. Un boilerplate acheté livre du code sans le raisonnement ; ici on hérite des deux, ce qui rend la reprise et la modification possibles.

4. **Conformité et robustesse par défaut.** Aucun des quatre ne livre de rate limiting, de captcha, d'export de données ni de bannière de consentement — un SaaS européen doit tout ajouter à la main dès son premier utilisateur. Ici c'est dans le socle.

## Constraints
- **Stack imposée** : Next.js (App Router) + Drizzle ORM + PostgreSQL. Le provider Postgres (Neon ou Supabase) reste à trancher en phase Architecture.
- **Auth pressentie** : Better Auth, pour ses plugins `organization`, `admin`, `two-factor` et `passkey` qui couvrent une grande part du périmètre. À valider en Architecture.
- **Politique d'adapters** : chaque module pluggable (mail, storage, analytics, monitoring, jobs, paiement) expose une interface typée avec **une seule implémentation livrée et testée**. Ajouter un provider revient à écrire une classe, sans toucher au domaine.
- **Bundle de providers par défaut** : Resend (mail), S3 / Cloudflare R2 (storage), Sentry (erreurs), PostHog (analytics), Inngest (jobs), Stripe (paiement), Vercel comme cible de déploiement de référence, Docker et Coolify documentés. Choix fait pour la vitesse de mise en service et les offres gratuites ; la dépendance à six SaaS tiers est assumée et isolée derrière les adapters.
- **Modularité dès la première story.** Si le premier module triche sur la règle (schéma, routes, nav, webhooks, traductions à l'intérieur du module), le système entier s'écroule. C'est le risque principal du projet.
- **Pipeline killer-saas obligatoire** : aucune ligne de code avant un plan validé, aucun ship avant une revue passée.
- **Contrainte de commercialisation ultérieure** : aucune donnée ni convention personnelle en dur, toute configuration par `.env` ou `config/`.
- **Pas de contrainte de délai.** L'ordre de livraison est décidé techniquement.

## Success criteria
1. **Chrono clone → premier paiement.** Depuis `git clone` : compte créé, organisation créée, abonnement Stripe encaissé en mode test, en **moins de 30 minutes**, sans écrire une ligne de code applicatif. Mesure de recette du repo, rejouée à chaque story.
2. **Un projet réel en production.** Un SaaS d'Olivier tourne en prod sur le boilerplate, avec au moins un paiement Stripe encaissé en live. Validation finale.
3. **Parité sur le périmètre.** Chaque feature du tableau « Replicated » est implémentée, couverte par des tests, et pilotable depuis `config/features.ts`.
4. **Preuve de modularité.** Sur un projet généré avec multi-tenant, seat billing et i18n désactivés : l'application démarre, la suite de tests passe, et il ne reste **aucune route morte, aucune entrée de nav orpheline, aucune table inutilisée** en base.
5. **Aucune régression au toggle.** Activer puis désactiver un module laisse l'application dans un état sain, migrations comprises.
