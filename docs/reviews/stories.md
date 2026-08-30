# Stories Review — killer-boilerplate (round 6)

> Revue en contexte neuf de `docs/stories.md` (44 stories) contre `docs/prd.md` (24 lignes de périmètre, 11 entrées de cimetière), selon `templates/stories-review-checklist.md`. Numérotation des findings continuée à partir des revues précédentes (F1–F56).

## Perimeter coverage

| PRD feature (core loop) | Covered by | OK? |
|---|---|---|
| Système de modules + `config/features.ts` + CLI `toggle` (5) | s03 (contrat + config typée), s04 (migrations par module), s05 (CLI list/toggle) | ✅ |
| Auth (password, magic link, OAuth, vérif email, reset, sessions, 2FA, passkeys) (3) | s07, s12 (OAuth), s13 (2FA + codes de secours), s14 (passkeys + fallback) | ✅ |
| Multi-tenant (orgs, invitations, rôles, switcher, scoping) (4) | s15, s16, s17 | ✅ |
| Billing Stripe + abstraction provider (checkout, portail, abonnements, one-time, seat, webhooks, trials) (5) | s19, s20, s21, s23 | ✅ |
| Admin back-office (users/orgs, recherche, ban, reset, sessions, impersonation, métriques) (3) | s37, s38 | ✅ |
| Emails transactionnels (React Email, adapter Resend, templates traduits, guide DNS) (3) | s06, s09 (traduction) | ✅ |
| App shell (dashboard, nav depuis modules, dark mode, settings compte/org, profil, avatar) (3) | s08, s15 (settings org), s18 (avatar) | ✅ |
| Marketing (landing + sections, pricing depuis config, FAQ, testimonials, contact, newsletter, légales, SEO/OG, sitemap, robots) (2) | s10, s11, s22 | ✅ |
| Blog MDX (liste, article, tags, RSS, OG auto) (3) | s29 | ✅ |
| Docs produit (recherche plein texte) (3) | s30 | ✅ |
| Changelog (2) | s31 | ✅ |
| i18n (next-intl, routes localisées, switcher, emails traduits) (4) | s09 | ✅ |
| Storage fichiers (S3/R2, presign, contrôle d'accès, avatars) (3) | s18 | ✅ |
| Notifications in-app (centre, badge, préférences) (3) | s32 | ✅ |
| Jobs & cron (adapter Inngest, events, jobs, cron) (4) | s33 | ✅ |
| Déploiement (Dockerfile, compose prod, Coolify, Vercel, checklist env, migrations) (3) | s27 (+ s02 pour migrations en CI) | ✅ |
| Pack RGPD (suppression + purge, export, bannière consentement) (3) | s34, s35, s36 (+ contrat purge/export/rétention posé en s03) | ✅ |
| Rate limiting + anti-bot (3) | s28 | ✅ |
| Guest checkout (3) | s24 | ✅ |
| Serveur MCP (lister, activer, générer un squelette) (3) | s41 | ✅ |
| Monitoring + analytics (Sentry + adapter analytics) (2) | s39 | ✅ |
| Onboarding multi-étapes (3) | s40 | ✅ |
| Plugins bonus (waitlist, feedback, roadmap) (3) | s42, s43, s44 | ✅ |
| Tooling & DX (TS strict, lint, Vitest, Playwright, GHA, compose local, seed, `.env.example`, conventions IA) (3) | s01, s02 | ✅ |

- [x] Chaque feature du tableau « Replicated (core loop) » est livrée par au moins une story. **24/24, aucun trou.** Vérification faite aussi au niveau des sous-items (codes de secours, fallback WebAuthn, portail client, réconciliation seat, OG auto, robots, `Retry-After`, source maps) : tous atterrissent dans un critère, pas seulement dans une note.

## Scope
- [x] Aucune story ne réintroduit une entrée du cimetière. Vérifié un par un : `eject` (s05 l'exclut et interdit toute « commande de nettoyage »), AI in-app (absent), autres providers de paiement (s19 : Stripe seul), facturation à l'usage (s21 exclut nommément les quotas quantitatifs, s23 borne l'exception sièges), temps réel (s32), multi-ORM/framework, hors-Postgres, mobile (absents), journal d'audit (s37 distingue logs applicatifs et table d'audit), clés API clients (absent), secondes implémentations d'adapters (s06, s33, s39), appareil commercial (s30).
- [x] Aucune story ne sort du périmètre. Ajouts hors tableau PRD : s25 (harnais du critère de succès n°1), s26 (critère n°4), politique de rétention (s03/s34), réconciliation seat (s23), promotion superadmin (s37). Tous rattachables aux critères de succès ou à une exigence légale — voir F64 pour la rétention.

## Story quality
- [~] Tranches livrables : 42/44 sont des tranches de bout en bout avec persona et valeur. s06 est un adapter (F58). s25 et s26 sont des harnais de recette, assumés par la section « L'outillage du template n'est pas un module » et adossés aux critères de succès du PRD : acceptable.
- [~] Critères testables : très bonne facture générale (chaque critère est une assertion). Deux exceptions encadrées : les « recette manuelle » de s27 (F62) et le seuil des 30 minutes de s25, qui reste humain mais est bordé par un timeout configuré.
- [x] Notes agentiques présentes dans les 44 stories, avec pièges concrets (404 vs 403, MIME côté serveur, énumération de comptes, ts-morph pour `config/features.ts`, création de compte depuis le webhook et non la page de retour, tri sémantique des versions).
- [x] Complexité : aucun 5 (les deux 5 du PRD sont éclatés en s03/s04/s05 et s19/s20/s21/s23/s24). Les six 4 énoncent tous leur risque.

## La liste dans son ensemble
- [x] Ordre exécutable : les 44 listes de dépendances ont été déroulées. Toutes pointent vers un numéro inférieur, aucun cycle, aucune référence en avant. Les renvois « livré en s28 » de s11 et s13 sont des reports assumés, et s28 déclare bien s11 et s13 en dépendance : le sens est correct.
- [x] Ids : `s01` → `s44`, format `s<numéro>-<slug>`, aucun doublon, aucun trou.
- [~] Recouvrements : le fichier déconflicte activement (table d'inscriptions s11↔s42, `config/billing.ts` s19↔s22, purge/export s03↔s34/s35, pipeline MDX s29↔s30/s31). Deux résidus : F59 et F61.

## Findings

**F57 — major — s36-cookie-consent : point d'entrée de révocation du consentement logé dans un module optionnel.** s36 est déclaré socle non désactivable (« couper le consentement en gardant l'analytique serait une non-conformité »), mais son critère « Le choix est modifiable à tout moment depuis un lien du pied de page » s'appuie sur le pied de page livré par s10-marketing-site, module optionnel dont l'état off « ne sert aucune page publique ». Sur une installation marketing coupé + analytique activée — combinaison parfaitement légale au regard de s10 et s39 — l'utilisateur ne dispose d'aucun moyen de retirer son consentement : exactement la non-conformité que la story prétend interdire. Il manque un critère définissant l'accès à la gestion du consentement quand le module marketing est coupé (entrée dans le shell de s08, par exemple). Une déclaration de module requis vers s10 n'est pas une option : s36 étant socle, elle ne peut pas requérir un module optionnel.

**F58 — minor — s06-transactional-emails : story la plus proche d'une couche technique du lot.** Livre une interface `Mailer`, une implémentation Resend et un template de démonstration ; aucun email n'atteint un utilisateur réel avant s07. Les notes l'assument et l'argument (éviter que s07 porte auth + adapter) est solide, la story reste vérifiable de bout en bout. À surveiller en revue : le critère « en développement, sans clé d'API, l'email est capturé et consultable localement » ne doit pas se transformer en second adapter (SMTP, Mailpit), qui est au cimetière — les notes le disent, le critère ne le dit pas.

**F59 — minor — s03-module-registry / s09-i18n : même critère revendiqué deux fois.** s03 : « Un template d'email déclaré sans version dans chacune des locales livrées fait échouer un test » ; s09 : « Un template d'email déclaré par un module et dépourvu de version dans une locale livrée fait échouer un test, quel que soit le module et sa date d'ajout ». C'est le même test, livré une fois. À l'exécution de s03, aucune locale n'est encore livrée (s09) et aucun template métier n'existe (s06) : le test y est au mieux vacant. Décider qui possède le test — s03 pour le slot du contrat, s09 pour la vérification multi-locale — et reformuler l'autre.

**F60 — minor — s36 / s29 / s30 / s31 / s22 : arêtes « modules requis » déclarées de façon inégale.** Le fichier fait de la déclaration de modules requis le mécanisme qui rend les combinaisons vérifiables « mécaniquement plutôt que répétées dans chaque story ». Elle est explicitement déclarée pour s16, s20, s37, s42, s43 et s44, mais pas pour la famille qui dépend de s10-marketing-site (blog, docs, changelog, page de tarifs, consentement), alors que ces stories s'appuient sur ses routes publiques, son pied de page et son `sitemap.xml`. La combinaison marketing coupé + blog activé reste indéfinie.

**F61 — minor — s37-admin-users : plus grosse story du lot, avec une tranche empruntée à une autre.** 14 critères couvrant amorçage superadmin, promotion et révocation du rôle, modération des comptes, impersonation, annuaire d'organisations et consultation/export CSV des inscriptions publiques — cette dernière relevant du flux de valeur de s11. Le score 3 reste cohérent avec le PRD (qui cote tout le back-office à 3, revenus compris, alors que les stories en extraient déjà s38), donc pas de sur-cotation, mais un découpage (modération + impersonation d'un côté, annuaire d'organisations + inscriptions de l'autre) réduirait le plus gros ticket restant.

**F62 — minor — s27-deployment : deux critères non automatisables.** Les guides Coolify et Vercel sont marqués « recette manuelle » avec trace consignée dans la revue, ce que la section « Critères non automatisables » autorise explicitement. Conforme au cadre posé, mais ce sont les deux seuls critères du fichier qui ne peuvent pas devenir un test : la revue de s27 doit exiger la trace, sinon ils ne prouvent rien.

**F63 — minor — s28-rate-limiting : surface probablement sous-cotée à 3.** Six dépendances, huit points d'entrée à protéger, captcha optionnel, compteur partagé entre instances : périmètre comparable à s19 et s23, cotées 4. Cotée 4, la story devrait énoncer son risque — le magasin partagé n'est fourni par aucune story antérieure, s01 ne livrant que Postgres et Docker Compose.

**F64 — minor — s34-account-deletion / s03 : la politique de rétention étend le texte du PRD.** Le PRD dit « suppression de compte et d'organisation avec purge » ; les stories ajoutent une politique de rétention par catégorie de données, imposée à la compilation à chaque module (s03). L'argument (factures légalement conservables, éviter de rouvrir vingt modules plus tard) est bon, mais c'est un alourdissement du contrat noyau qui mérite une validation humaine explicite.

**F65 — minor — ordre de livraison : quatre écarts assumés avec l'ordre du PRD.** s06 avant l'auth, s08 avant le multi-tenant, i18n en s09, storage avant la facturation. Chacun est argumenté dans les notes de la story concernée et les arguments tiennent. Aucun correctif nécessaire, mais l'écart doit être validé par l'humain plutôt que découvert en phase Architecture. Corollaire à noter : le rate limiting arrivant en s28, tous les états livrables intermédiaires exposent inscription, invitations, téléversement et checkout anonyme sans limite — c'est l'ordre du PRD, mais c'est un risque réel si un projet part du boilerplate avant s28.

## Verdict

Point fort du lot, et il mérite d'être dit : la couverture du périmètre est complète (24/24), l'ordre de dépendances est exécutable sans exception, aucun 5 ne subsiste, et le fichier pré-empte lui-même la plupart des objections classiques (état off systématique, régimes CI et intégration réelle séparés, critères manuels tracés, rappels de cimetière dans les notes). Le seul défaut structurel est le trou de conformité de s36, réparable par un critère.

Max severity: major
Stories ready: yes
