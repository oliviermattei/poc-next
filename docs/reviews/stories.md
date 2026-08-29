# Stories Review — killer-boilerplate (round 3)

> Revue à contexte neuf de `docs/stories.md` contre `docs/prd.md`. 41 stories (s01→s41). Numérotation des findings continuée à partir des revues précédentes (F1–F29) pour éviter les collisions avec les références déjà inscrites dans les notes agentiques.

## Perimeter coverage

| PRD feature (core loop) | Covered by | OK? |
|---|---|---|
| Système de modules + `config/features.ts` + CLI `toggle` (5) | s03-module-registry, s04-cli-toggle-module | OK (le 5 du PRD est bien éclaté en 4 + 3) |
| Auth (password, magic link, OAuth, vérif email, reset, sessions, 2FA, passkeys) | s06, s09, s10, s11 (+ sessions actives en s07) | OK |
| Multi-tenant (orgs, invitations, rôles, switcher, scoping) | s12, s13, s14 | OK |
| Billing Stripe + abstraction (checkout, portail, abonnements, one-time, seat, webhooks, trials) | s16, s17, s18, s19 | OK (5 éclaté en 4/3/3/4) |
| Admin back-office (liste, recherche, ban, reset, sessions, impersonation, revenus) | s34, s35 | OK |
| Emails transactionnels (React Email, adapter, templates traduits, guide DNS) | s05 (+ traduction en s08) | OK |
| App shell (layout, nav depuis modules, dark mode, settings compte + org, profil, avatar) | s07 (+ settings org en s12, avatar en s15) | OK |
| Marketing (landing, pricing depuis config, FAQ, testimonials, contact, newsletter, légales, SEO/OG, sitemap, robots) | s20 | OK (mais bundling, voir F31) |
| Blog MDX (liste, article, tags, RSS, OG auto) | s26 | OK |
| Docs produit (recherche plein texte) | s27 | OK |
| Changelog | s28 | OK |
| i18n (routes localisées, switcher, emails traduits) | s08 | OK |
| Storage fichiers (S3/R2, presign, contrôle d'accès, avatars) | s15 | OK |
| Notifications in-app (centre, badge, préférences) | s29 | OK |
| Jobs & cron (adapter, events, jobs, planifiées) | s30 | OK |
| Déploiement (Dockerfile, compose prod, Coolify, Vercel, checklist env, migrations) | s24 (+ CI en s02) | OK |
| Pack RGPD (suppression + purge, export, bannière consentement) | s31, s32, s33 | OK |
| Rate limiting + anti-bot (IP/compte, captcha optionnel) | s25 | OK |
| Guest checkout | s21 | OK |
| Serveur MCP (lister, activer, générer un squelette) | s38 | OK |
| Monitoring + analytics (Sentry + source maps, adapter analytics) | s36 | OK |
| Onboarding multi-étapes (profil, org, plan, progression) | s37 | OK |
| Plugins bonus (waitlist, feedback, roadmap + votes) | s39, s40, s41 | OK |
| Tooling & DX (TS strict, lint, Vitest, Playwright, GH Actions, compose local, seed, `.env.example`) | s01, s02 | OK |

- [x] Chaque feature du tableau « Replicated (core loop) » est délivrée par au moins une story. **Aucun trou de périmètre.** Les critères de succès n°1 et n°4 du PRD ont désormais leurs porteurs (s22, s23), ce qui referme F16 et F18.

## Scope
- [x] Aucune story ne réintroduit un item du cimetière. Vérifié un par un : `eject` explicitement refusé en s04 et dans le préambule ; pas de module AI ; Stripe seul provider (s16) ; temps réel exclu (s29) ; une seule implémentation par adapter (s05 Resend, s15 S3/R2, s30 Inngest, s36 Sentry/PostHog) ; journal d'audit évité en s34 (logs applicatifs, pas de table alimentée par chaque module) ; aucune clé API ni webhook sortant client ; aucun appareil commercial (s27 borne explicitement la doc au SaaS généré).
- [~] Deux frontières restent des **bordures** correctement bornées mais à surveiller : le compteur de quota de s18 (borné en notes, ne doit jamais alimenter une assiette) et l'export CSV des inscrits en s39 (extension hors tableau PRD, triviale).

## Story quality
- [~] Tranche livrable de bout en bout : s05 reste la plus proche d'une couche technique (assumé en notes) ; s01/s02 sont du bootstrap, défendable pour le persona Dev.
- [~] Critères testables : très bon niveau d'ensemble ; quelques critères documentaires ou subjectifs non marqués « recette manuelle » (F33).
- [~] Notes agentiques présentes partout ; deux stories (s28, s41) n'ont ni contrainte ni piège.
- [x] Aucune complexité 5 résiduelle ; les six 4 (s03, s08, s12, s16, s19, s30) énoncent chacune leur risque en première ligne de notes.

## La liste dans son ensemble
- [x] Ordre exécutable : toutes les dépendances déclarées pointent vers un numéro strictement inférieur. Aucun cycle, aucune référence en avant.
- [x] Ids : 41 stories, format `s<numéro>-<slug>` respecté, numérotation contiguë s01→s41, aucun doublon.
- [~] Chevauchements : les frontières sensibles sont explicitement tranchées en notes (s16/s20 tarifs, s20/s39 inscriptions publiques, s10/s25 compteur, s03/s31/s32 purge, s26/s27/s28 pipeline MDX). Une seule reste non arbitrée (F34), et une story bundle plusieurs valeurs (F31).

## Findings

**F30 — major — s05, s10, s11, s21, s25, s30, s33, s34, s36, s38 : la règle transverse « module non activé » n'est appliquée qu'à la moitié des modules.** Le préambule du fichier pose la règle, et s06 tranche que l'auth est « le seul module obligatoire du socle ». Conséquence logique : tous les autres sont désactivables et doivent définir leur état off. Or dix stories ne portent aucun critère de désactivation. F17 a été corrigé sur i18n et billing uniquement ; le patron n'a pas été généralisé. Le PRD est pourtant explicite (critère de succès n°3 : « chaque feature du tableau est pilotable depuis `config/features.ts` »). Les cas qui cassent réellement, par ordre de gravité :
- **s05-transactional-emails** : s06 (module *obligatoire*) envoie la vérification d'email et le magic link via le mailer, s13 l'invitation, s21 le lien de mot de passe, s31 la confirmation de suppression, s32 le lien d'export. Si le module mail est désactivable, cinq parcours sont indéfinis ; s'il ne l'est pas, il faut l'écrire comme s06 l'a fait pour l'auth. Rien ne le dit.
- **s30-background-jobs** : s31 et s32 orchestrent purge et export « par un job de fond ». Jobs coupé, la suppression de compte (obligation RGPD) n'a plus de chemin défini.
- **s33-cookie-consent** : s36 conditionne le chargement du script d'analyse au registre de s33. Consentement coupé, le comportement légal par défaut n'est pas énoncé.
- **s25-rate-limiting** : s39 AC5 et s41 AC7 disent « soumis aux limites définies en s25 » ; s25 coupé, ces critères n'ont plus de référent.
- **s10 / s11** : s25 énumère l'endpoint de vérification 2FA parmi ses points limités ; 2FA coupé, ce critère devient vide.
- **s34-admin-users** : s35 porte son « module de facturation non activé » mais s34 ne dit rien de son propre off, alors que s39, s40 et s41 dépendent du back-office.
C'est exactement la situation qui a produit F17, à l'échelle du fichier. Correction : une ligne par story, ou une phrase nommant les modules non désactivables (mail, rate limiting, RGPD… si tel est le choix) — mais alors elle contredit s06 et doit être arbitrée.

**F31 — major — s20-marketing-pages : bundle de valeurs distinctes sur le nœud le plus dépendu du fichier.** Neuf critères couvrant quatre tranches sans lien : (a) sections de landing pilotées par `config/marketing.ts` + pages légales + SEO/OG/sitemap/robots, (b) dérivation de la page de tarifs depuis `config/billing.ts`, (c) formulaire de contact avec envoi d'email, (d) capture newsletter avec persistance et déduplication — cette dernière étant un modèle de données réutilisé par s39. Le coût n'est pas cosmétique : parce que (b) est dans le lot, la story entière dépend de s16 **et** s17, ce qui met *toute* la surface marketing derrière la pile de facturation complète. Or sept stories dépendent de s20 (s21, s24, s25, s26, s33, s39, s41) : le bundling sérialise un quart du fichier derrière le billing sans nécessité. Découper en « pages + légales + SEO » (livrable dès s08), « page de tarifs dérivée » (après s17) et « formulaires publics contact + newsletter » supprime la contrainte et rend chaque tranche testable seule.

**F32 — minor — s22-golden-path-e2e : le chrono mesuré n'est pas celui du PRD.** Le critère de succès n°1 mesure « depuis `git clone` […] moins de 30 minutes ». Le scénario de s22 démarre à l'inscription, sur une base vierge déjà migrée et seedée (AC1, AC2) : l'installation des dépendances, la configuration `.env` et la première migration — c'est-à-dire précisément la partie que le boilerplate promet de raccourcir — sont hors mesure. AC7 journalise donc une durée qui n'est pas la durée revendiquée. Soit inclure la phase d'amorçage dans la mesure, soit dire explicitement dans les notes que la recette humaine des 30 minutes couvre le clone et que le harnais ne mesure que le parcours applicatif.

**F33 — minor — s05, s30, s32, s38 : critères documentaires ou subjectifs non marqués « recette manuelle ».** Le préambule institue ce marquage et s24 l'applique correctement. Manquent : s05 AC7 « la documentation décrit la configuration DNS » ; s30 AC8 « mode développement documenté » ; s32 AC6 « format lisible et documenté » (« lisible » n'est pas assertable) ; s38 AC6 « sa configuration client est fournie ». Chacun devient soit un test de présence/schéma, soit une recette manuelle tracée — pas un troisième régime implicite.

**F34 — minor — s18 AC6 vs s19 AC5 : deux limites de membres, aucun propriétaire déclaré.** s18 pose « une limite quantitative configurée (nombre d'objets, **de membres**, de fichiers) refuse le dépassement » ; s19 pose « l'ajout d'un membre au-delà d'une limite de sièges configurée est refusé ». Ce sont potentiellement deux mécanismes concurrents sur la même action (ajout de membre), avec deux configurations et deux messages. Toutes les autres frontières du fichier sont arbitrées en notes (s16/s20, s20/s39, s10/s25) ; celle-ci ne l'est pas. Dire laquelle des deux fait foi, ou que s19 spécialise le compteur de s18.

**F35 — minor — s03-module-registry : score 4 probablement encore sous-évalué.** Huit critères couvrant le contrat de module (identifiant, schéma Drizzle, routes, nav, traductions, webhooks, purge, export), la config typée avec erreur de compilation, la composition des migrations par module, deux modules de démonstration et le passage de la suite complète dans les deux états. La note reconnaît « risque maximal » et « si le contrat est mal posé ici, chaque story suivante devra être reprise » — c'est la définition d'un 5. Le 5 du PRD a bien été éclaté en s03 + s04, donc la règle est formellement respectée ; mais un second découpage (contrat + config + routes/nav d'un côté, composition des migrations par module de l'autre) réduirait le risque sur la story dont dépendent les 38 suivantes.

**F36 — minor — s28-changelog, s41-public-roadmap : notes agentiques sans contrainte ni piège.** Deux lignes de parité chacune. s41 porte pourtant le critère le plus piégeux du lot (« la fusion reporte les votes sans créer de doublon de votant ») et une page publique ouverte au vote, donc un vecteur de spam au-delà du seul rate limiting. Le fichier tient un standard élevé ailleurs ; ces deux-là ne le tiennent pas.

**F37 — minor (informationnel) — s37-onboarding AC2 : dépendance au storage non couverte par un off.** « Une étape de profil recueille le nom et **l'avatar** » avec s15 en dépendance, mais AC3 et AC8 n'énoncent l'adaptation qu'aux modules organisations et facturation. Storage coupé, le comportement de l'étape profil est indéfini. Cas particulier de F30, listé à part parce qu'il se corrige dans une story qui, elle, porte déjà le patron.

## Résolu depuis la revue précédente (vérifié)
F17 (i18n s08 AC8-AC9, billing s16 AC8), F18 (s23 créée), F19 (s29 AC6 borné au registre de préférences), F20 (deux régimes CI / hors CI explicites en préambule et en s22), F21 (dépendances complétées en s08, s25, s37), F22 (s11 dépend de s07, s22 ne dépend plus du seat billing), F23 et F24 (notes ajoutées), F26 (s01 découpée en s01 + s02, s32 relevée à 3), F27 (réutilisation du stockage d'inscriptions notée en s20 et s39), F28 (articulation s10/s25 tranchée dans les deux sens), F29 (formulation corrigée).

## Verdict

Le périmètre est intégralement couvert, le cimetière tient, l'ordre est exécutable et les ids sont propres : les criticals restent fermés. Il subsiste deux majors, tous deux corrigibles en markdown. F30 est le plus coûteux si on le laisse passer : c'est F17 non généralisé, et il se découvrira story par story, chaque fois dans le tunnel d'une autre story (typiquement en s31, quand la suppression de compte devra décider ce qu'elle fait sans le module jobs). F31 coûte de la sérialisation inutile sur le nœud le plus dépendu du fichier — le corriger maintenant est un découpage de titres ; le corriger après s20 signifie réécrire les dépendances de sept stories.

Max severity: major
Stories ready: no
