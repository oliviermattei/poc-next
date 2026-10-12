# État des lieux — 12/10/2026

> **Instantané figé.** Ce fichier a été établi juste avant le retrait de la
> méthode killer-saas, pour que rien de ce qu'elle tenait ne se perde. Il n'est
> **jamais mis à jour** : la vérité vivante est dans les
> [issues GitHub](https://github.com/oliviermattei/poc-next/issues). Chaque
> élément restant ci-dessous y a son issue.
>
> Base : `dev` à `56ee6a3`. Les chemins `docs/reviews/…`, `docs/plans/…`,
> `docs/research/…`, `docs/stories.md` et `docs/STATE.md` cités ici n'existent
> plus après la migration : ils se lisent à l'état
> [`9f36ea9`](https://github.com/oliviermattei/poc-next/tree/9f36ea9/docs).

## Synthèse

**Ce qui a été balayé** : les 82 stories de `docs/stories.md`, le PRD, 74
revues, 73 plans, 74 recherches, `STATE.md`, `getting-started.md`,
`killer-saas-feedback.md`, les TODO du code, les 11 issues et 7 PR GitHub, la CI
de `dev`, et toutes les branches et worktrees. Les revues ont été lues sur leurs
verdicts et constats, puis chaque constat a été confronté au code de `dev` : un
défaut signalé ailleurs dans le texte d'une revue a pu échapper.

| Statut des stories | Nombre | Lesquelles |
|---|---|---|
| Livrées | 65 | — |
| Partielles | 8 | s25, s27, s28, s31, s39, s53, s64c, s68 |
| En cours | 3 | s43 (code interrompu), s44 (plan seul), s59 (recherche seule) |
| Pas faite | 1 | s65 (optionnelle) |
| Abandonnées (découpées) | 5 | s37, s37b, s62, s64, s64b |

**Constats des revues** : 725 relevés, 536 résolus, 189 encore ouverts, qui
tiennent en 107 sujets après dédoublonnage (94 vérifiés dans le code, 13 qui
demandent un humain, un vrai fournisseur ou un navigateur). 3 doublent une issue
déjà ouverte (#58, #61, #73).

**Ce qui manque au PRD** :
- **Succès 2** — aucun projet réel n'a jamais tourné en production ; aucun
  déploiement (Coolify, Vercel, deux hôtes) n'a été exécuté.
- Widget de retour (s43) et roadmap publique (s44) non livrés.
- Fournisseur de captcha absent.
- Flux RSS du blog et du changelog jamais passés à un vrai validateur.
- Traces Sentry lisibles jamais prouvées.
- Aucun appel réel à Stripe, Resend, Inngest, PostHog ou Sentry consigné ;
  aucune capture d'événement Stripe réel.

**Cimetière** : aucune des 12 exclusions n'est contredite par le code.

## Urgences

1. **La CI de `dev` est rouge depuis le 10/10** sur `pnpm run audit` : 4 avis
   critiques (`next`, `handlebars` ×2, `proxy-addr`) et 8 élevés. Les tests
   passent. La PR #76 (`next` 16.3.8) n'en corrige qu'une partie.
2. **Deux majors de sécurité perdus** : la limitation de débit identifie
   l'appelant par le premier maillon de `x-forwarded-for`, que le client écrit
   lui-même ; le jeton de réinitialisation de mot de passe est stocké en clair.
3. **La recherche s59 contredit trois stories livrées** : l'image ne démarre pas
   avec ses seules variables quand `storage` ou `analytics` sont actifs (s27),
   les erreurs serveur partiraient non symbolisées vers Sentry (s39), et sans
   proxy qui réécrit `x-forwarded-for` la limitation de débit est contournable
   (s28).
4. **`tests/module-migrations.test.ts` détruit des tables** de la base de
   développement partagée.

## Écarts entre la documentation et le code

- **Socle déclaré contre socle verrouillé** : `stories.md` déclarait sept
  stories non désactivables ; le code ne verrouille que `auth` et `rate-limit`.
  `consent` reste coupable tant qu'`analytics` est coupé.
- **Modules requis promis, jamais déclarés** : la waitlist devait requérir le
  back-office ; elle vit dans `marketing`, qui ne requiert rien.
- **Stockage par organisation** : livré dans le domaine, inatteignable par
  l'application.
- **ADR 005 (Hono + oRPC)** : accepté, jamais implémenté.
- **38 revues sur 73 se terminaient par un major** ; ils n'étaient suivis en
  issues qu'à partir de #58.

## Branches et travail en cours

| Branche | Sur origin | Décision |
|---|---|---|
| `experiment/back-office` (`03abe3d`, +8) | **non** | Garder comme référence, pas comme base : structure remplacée par s60, s61, s66. Quatre apports uniques → deux issues. À pousser sur origin avant toute suppression. |
| `feature/s43-feedback-widget` (`16e5556`) | oui | Module complet non revu, écrans aux anciennes adresses → issue « Reprendre s43 ». |
| `feature/s44-public-roadmap` (`007d8a1`) | oui | Plan seul, base périmée → issue « Reprendre s44 ». |
| `origin/feature/s59-premier-deploiement` (`2b2e030`) | oui | Recherche du 10/10, travail actif. |
| `.worktrees/demo` (HEAD détaché) | — | Rien à sauver ; conteneur Postgres possible sur le port 5445. |
| `fix/e2e-ci-parity`, `fix/e2e-click-until` | non | Déjà dans `dev`, supprimables. |
| 8 branches `dependabot/*` de PR fermées | oui | Supprimables. |

## PR ouvertes

| PR | Objet | Décision |
|---|---|---|
| #76 | `next` 16.3.8 | Fusionner en premier : correctif de sécurité. |
| #46, #47, #48, #49 | `typescript-eslint`, `globals`, Playwright, `lucide-react` | Fusionner après rebase, une fois l'audit réglé. |
| #17 | TypeScript 7 dans `tooling/eslint` | Fermer : l'ADR 015 garde TS 6 pour le lint tant que `typescript-eslint` refuse TS 7. Ajouter un `ignore` Dependabot. |
| #50 | Node 25 | Fermer : version impaire non LTS, et `corepack` n'y existe plus. Ajouter un `ignore`, puis passer délibérément à une LTS. |

---

## Annexe A — Stories et périmètre PRD

### 1. Stories

Preuve : sha du commit sur `dev` (le premier `feat`, puis les correctifs `fix(sNN)` quand ils existent ; à partir de s22, le squash de la PR `#n`), puis `docs/reviews/<id>.md:<ligne>` = la dernière ligne `Ship allowed: yes`.

| id | titre | statut | preuve | reste à faire |
|---|---|---|---|---|
| s01-boot-blank-app | Démarrer une application vide qui tourne | livré | `f73f0d9` (+`3cae433`, `6bb1c10`) · reviews/s01:377 | |
| s02-quality-harness | Vérifier la qualité du code en une commande | livré | `e268e58` (+`89d2ade`) · reviews/s02:181 | |
| s03-module-registry | Déclarer et activer un module | livré | `bcb4a03` (+`a3b2db2`) · reviews/s03:162 | |
| s04-module-migrations | Ne pas créer les tables d'un module absent | livré | `396dc4f` (+`364aacc`) · reviews/s04:159 | |
| s05-cli-toggle-module | Activer un module en une commande | livré | `0262b01` (+`67a87e9`, `64264c2`, `7b7353c`) · reviews/s05:418 | |
| s06-transactional-emails | Envoyer un email transactionnel | livré | `ce2a927` (+`36296ce`, `f38e472`) · reviews/s06:581 | |
| s07-signup-signin | Créer un compte et se connecter | livré | `8d3706a` (+`7ced9c6`, `1f382af`) · reviews/s07:776 | |
| s08-app-shell | Naviguer dans l'application connectée | livré | `662f671` (+`ae792da`, `bb747ba`) · reviews/s08:720 | |
| s09-i18n | Utiliser l'application dans sa langue | livré | `bd7abe0` (+`d1e5fe7`, `0a38f8f`) · reviews/s09:787 | |
| s10-marketing-site | Découvrir le produit | livré | `57e9658` · reviews/s10:494 | |
| s11-public-forms | Contacter l'éditeur et s'inscrire à la newsletter | livré | `9cf45c2` · reviews/s11:476 | |
| s12-oauth-signin | Se connecter avec Google ou GitHub | livré | `5e73810` · reviews/s12:577 | |
| s13-two-factor | Protéger son compte par double authentification | livré | `3a6a1cc` · reviews/s13:983 (critère 5 amendé en ligne, stories.md:376) | |
| s14-passkeys | Se connecter sans mot de passe | livré | `0c85639` · reviews/s14:538 | |
| s15-organizations | Travailler dans une organisation | livré | `9bb3309` · reviews/s15:460 | |
| s16-invite-members | Inviter quelqu'un dans son organisation | livré | `6f14cc4` · reviews/s16:603 | |
| s17-roles-permissions | Limiter les actions selon le rôle | livré | `2b997df` · reviews/s17:388 | |
| s18-file-storage-avatar | Envoyer un fichier et changer son avatar | livré | `caaa77c` · reviews/s18:789 (1er tour `Ship allowed: no`, critique corrigé) | |
| s19-subscribe-stripe | Souscrire un abonnement | livré | `448351d` · reviews/s19:1422 | |
| s20-one-time-purchase | Acheter une fois pour toutes | livré | `4793805` · reviews/s20:715 | |
| s21-trials-and-gating | Réserver des fonctionnalités aux offres payantes | livré | `b53b44b` · reviews/s21:310 | |
| s22-pricing-page | Comparer les offres et choisir | livré | `4d770d0` (#1) · reviews/s22:186 | |
| s23-seat-billing | Facturer au nombre de membres | livré | `a24c324` (#2) · reviews/s23:182 | |
| s24-guest-checkout | Payer sans créer de compte d'abord | livré | `44fa757` (#3) · reviews/s24:172 | |
| s25-golden-path-e2e | Vérifier le parcours clone → premier paiement | **partiel** | `286bdaf` (#4) · reviews/s25:208, :130 | Critère 6 : le job de CI « parcours doré » n'est jamais armé (`tests/fixtures/stripe-events/` ne contient que son README ; job `skipped` sur le dernier run). Critère 7 : le régime `live` ne rejoue pas le scénario (`scripts/golden-path.ts:254`) et n'a jamais tourné. |
| s26-minimal-profile-check | Prouver qu'un projet minimal ne traîne rien | livré | `1aeae87` (#5) · reviews/s26:187 | |
| s27-deployment | Déployer l'application en production | **partiel** | `4f30a26` (#6) · reviews/s27:78-79, :241 · docs/deployment.md:21-22 | Recettes manuelles Coolify et Vercel (critères 5 et 6) jamais exécutées. Le critère 1 (« démarre avec les seules variables ») est contredit par la recherche s59 (fait 1). |
| s28-rate-limiting | Résister au spam et aux attaques par force brute | **partiel** | `aba452b` (#7) · reviews/s28:347, :1279 | Critère 5 : le captcha a un drapeau et une garde CSP (`config/security.ts:318`), mais **aucun fournisseur** n'est livré et il n'y a aucune vérification côté serveur (0 occurrence de turnstile/hcaptcha/recaptcha/siteverify). |
| s29-blog-mdx | Publier un article de blog | livré | `b0dda43` (#10) · reviews/s29:141 | |
| s30-docs-site | Consulter la documentation du produit | livré | `f06b171` (#12) · reviews/s30:98 | |
| s31-changelog | Annoncer les nouveautés | **partiel** | `d9c277b` (#34) · reviews/s31:26, :74, :78 | Critère 3 (« flux RSS… **valide** ») : seulement prouvé « analysable » par `@rowanmanning/feed-parser`, jamais passé à un validateur. |
| s32-notifications-inapp | Être notifié dans l'application | livré | `6466ccf` (#22) · reviews/s32:136 | |
| s33-background-jobs | Exécuter des traitements en arrière-plan | livré | `6012d15` (#27) · reviews/s33:74 | |
| s34-account-deletion | Supprimer son compte ou son organisation | livré | `8d8539a` (#29) · reviews/s34:94 (serveur seul, écrans en s34b) | |
| s34b-ecrans-rgpd | Exercer ses droits depuis l'application | livré | `0066a81` (#32) · reviews/s34b:64 | |
| s35-data-export | Exporter ses données | livré | `4c77c1a` (#30) · reviews/s35:75 | |
| s36-cookie-consent | Choisir ses cookies | livré | `4500416` · reviews/s36:737 | |
| s37-admin-users | Administrer les utilisateurs et les organisations | abandonné | stories.md:1041 « DÉCOUPÉE le 05/09… ne pas l'implémenter telle quelle » → s37a, s37b, s37c | |
| s37a-superadmin-et-bannissement | Désigner un superadmin et exclure un compte | livré | `71098e2` (#21) · reviews/s37a:115 | |
| s37b-back-office | Consulter et assister un utilisateur | abandonné | stories.md:1096 « DÉCOUPÉE le 06/09 » → s37b1, s37b2 | |
| s37b1-decompte-et-impersonation | Compter les administrateurs capables d'entrer, et assister un client | livré | `371e496` (#33) · reviews/s37b1:79 | |
| s37b2-back-office-lecture | Consulter les comptes et les organisations | livré | `98998d0` (#37) · reviews/s37b2:82 | |
| s37c-inscriptions-publiques | Consulter et exporter les inscriptions | livré | `31bb166` (#45) · reviews/s37c:123 | |
| s38-admin-revenue | Suivre le revenu de la plateforme | livré | `80424ec` (#39) · reviews/s38:66 (le critère 4 « période », signalé non tenu par la revue :40, est câblé : `parseBackOfficePeriod`, admin/src/domain/back-office.ts:190) | |
| s39-monitoring-analytics | Observer les erreurs et les usages | **partiel** | `daa6f7d` (#35) · reviews/s39:68-75, :82 | Critère 1 (« trace source lisible ») jamais prouvé. Défaut probable côté serveur : l'adaptateur Sentry envoie le chemin disque brut (recherche s59, fait 3). Le test PostHog réel (critère 4) n'a jamais tourné. 7 majors ouverts à la fusion. |
| s40-onboarding | Être guidé à la première connexion | livré | `c17643c` (#41) · reviews/s40:138 | |
| s41-mcp-server | Piloter le boilerplate depuis un agent | livré | `d423ca2` · reviews/s41:513 (M1 « critère 2 non tenu » fermé au tour de correction, :240) | |
| s42-waitlist | Recueillir des inscriptions avant le lancement | livré | `b9bd6d9` (#44) · reviews/s42:63 | |
| s43-feedback-widget | Envoyer un retour depuis l'application | **en cours** | branche `feature/s43-feedback-widget` + worktree `.worktrees/s43-feedback-widget`, `16e5556` « wip(s43): travail interrompu à la mise en pause » (07/09), 54 fichiers / +4168, plan `validated: yes`, sans revue, 53 commits de retard sur `dev` | Finir l'implémentation (« arrêtée avant les mutations »), relire, fusionner. |
| s44-public-roadmap | Voter pour les prochaines fonctionnalités | **en cours** | branche `feature/s44-public-roadmap` + worktree, `007d8a1` « wip(s44): plan seul, implémentation non commencée » ; recherche sur `dev` | Toute l'implémentation. |
| s45-security-headers | Servir l'application derrière une politique de sécurité stricte | livré | `4d87bb5` · reviews/s45:440 | |
| s46-auth-screens-design | Habiller les écrans d'authentification | livré | `d49ba4e` (#40) · reviews/s46:79 | |
| s47-seat-limit | Refuser un membre au-delà de la limite de sièges | livré | `08ec9e3` (#13) · reviews/s47:62 | |
| s48-ci-verte | Rendre la CI verte sur la branche par défaut | livré | `fa0099e` (#8) · reviews/s48:252 | (voir Écarts : la CI de `dev` est rouge aujourd'hui) |
| s49-contraste-des-alertes | Rendre les quatre variantes d'alerte lisibles | livré | `69e392b` (#14) · reviews/s49:113 | |
| s50-tests-deterministes | Rendre déterministes les trois tests intermittents | livré | `64f2cd3` (#9) · reviews/s50:137 | |
| s51-traces-des-echecs | Archiver les traces des parcours en échec | livré | `535d748` (#23) · reviews/s51:74 | |
| s52-derniers-intermittents | Fermer les intermittents restants | livré | `bcc5e41` (#28) · reviews/s52:78 | |
| s53-blog-syndication | Faire trouver les articles | **partiel** | `0e7e313` (#11) · reviews/s53:81, :102, :105 | Critère 2 « littéralement non tenu » d'après la revue : aucun validateur RSS dans le dépôt. |
| s54-docs-recherche | Chercher dans la documentation | livré | `8aa5fe8` (#36) · reviews/s54:80 | |
| s55-harnais-sans-env | Rejouer la suite dans la forme de la CI | livré | `2e725b4` (#31) · reviews/s55:82 | |
| s56-roles-de-session | Servir une route réservée à un rôle | livré | `bc02b5c` (#38) · reviews/s56:70 | |
| s57-contraste-des-jetons | Rendre visibles le focus et le bouton destructif | livré | `fc003a5` (#42) · reviews/s57:63 | |
| s58-donnees-de-demonstration | Découvrir le produit sans le remplir soi-même | livré | `c9cebf3` (#43) · reviews/s58:58 | |
| s59-premier-deploiement | Démarrer l'image ailleurs que sur ce poste | **en cours** | `origin/feature/s59-premier-deploiement` à `2b2e030` (10/10) : seulement `docs/research/s59-premier-deploiement.md`. Pas de worktree local, pas de plan. | Les 6 critères sont des recettes manuelles. Il faut un hôte et des clés. |
| s60-console | Piloter la plateforme depuis une console reconnaissable | livré | `2f11ae9` (#51) · reviews/s60:144 | |
| s61-site-et-application | Séparer le site public de l'application | livré | `4fcf61f` (#53) · reviews/s61:79 | |
| s62-zone-reglages | Régler son compte et son organisation dans une zone dédiée | abandonné | stories.md:1869 « DÉCOUPÉE le 28/09 » → s62a, s62b, s62c | |
| s62a-reglages-deplacement | Donner une adresse sous `/app/settings` à chaque réglage | livré | `0387df4` (#54) · reviews/s62a:85 | |
| s62b-reglages-decoupage | Ranger les réglages en rubriques | livré | `0f450bb` (#56) · reviews/s62b:78 | |
| s62c-barre-du-haut | Changer d'organisation et régler ses notifications depuis la barre du haut | livré | `14627fc` (#60) · reviews/s62c:57 | |
| s63-application-sous-app | Servir tout l'écran applicatif sous `/app` | livré | `95e5952` (#63) · reviews/s63:49 | (major M1 suivi par l'issue #61, ouverte) |
| s64-hote-application | Servir l'application sur son propre sous-domaine | abandonné | stories.md:2003 « DÉCOUPÉE le 29/09 » → s64a, s64b, s64c | |
| s64a-hote-origines | Construire chaque URL de session sur l'origine de l'application | livré | `3705f63` · reviews/s64a:55 | |
| s64b-hote-routage | Router chaque zone vers son hôte | abandonné | stories.md:2074 « DÉCOUPÉE le 29/09 » → s64b1, s64b2 | |
| s64b1-hote-routage | Aiguiller chaque zone vers son hôte | livré | `fdb7ba1` · reviews/s64b1:57 | |
| s64b2-hote-tarifs | Choisir une offre entre le site et l'application | livré | `a5c5cc6` · reviews/s64b2:90 | |
| s64c-hote-cookies | Partager consentement et langue entre les deux hôtes | **partiel** | `9c7aec7` (+`3d4c016`, qui ferme #72) · reviews/s64c:49, :58 | Critère 4 : la recette manuelle du déploiement à deux hôtes n'a pas été jouée. Issue **#73 ouverte**. |
| s65-hote-console | Servir la console sur son propre sous-domaine | pas fait | stories.md:2161 « OPTIONNELLE — reportée le 27/09 ». Complexité 5, « à découper avant d'être reprise ». Aucune branche, recherche, plan ni revue. | Toute la story (découpe préalable). |
| s66-404-par-zone | Rendre une page introuvable avec un seul shell | livré | `2ff47ae` (#52) · reviews/s66:95 | |
| s67-suppression-en-attente | Fermer un compte dès la demande de suppression | livré | `1a5ffa9` (#55) · reviews/s67:75 | |
| s68-recettes-paralleles | Rejouer les recettes depuis deux worktrees à la fois | **partiel** | `3c82d89` (#57) · reviews/s68:7, :33, :49 | Critère 1 « not met as written » : deux `pnpm test:socle` simultanés échouent par saturation du processeur (3 essais sur 3, 8 cœurs). Issue **#58 ouverte**. |

---

### 2. Périmètre PRD (`docs/prd.md` §Perimeter « Replicated », lignes 41-64 ; critères de succès, lignes 101-106)

| item PRD | stories | couvert ? | écart |
|---|---|---|---|
| Système de modules + `config/features.ts` + CLI `toggle` (l.41) | s03, s04, s05, s26, s41, s58 | oui | Le contrat a gagné une clé facultative (`seeds`, s58, ADR 069). Le PRD et l'ADR 007 voulaient un contrat complet dès le premier module. |
| Auth : mot de passe, magic link, OAuth, vérification, réinitialisation, sessions, 2FA, passkeys (l.42) | s07, s12, s13, s14, s46, s56, s67 | oui | Désactivation de la 2FA par mot de passe seul (critère s13 amendé). |
| Multi-tenant : organisations, invitations, rôles, sélecteur, cloisonnement (l.43) | s15, s16, s17, s62c | oui | |
| Billing Stripe + abstraction : checkout, portail, abonnement, achat unique, sièges, webhooks, essais (l.44) | s19, s20, s21, s22, s23, s24, s47 | oui | Aucun appel Stripe réel jamais joué en revue (« geste humain » de s19/s21 resté entier). Aucune capture de webhook réel versionnée. |
| Admin back-office : liste, recherche, ban, reset, sessions, impersonation, revenus (l.45) | s37a, s37b1, s37b2, s37c, s38, s60 | oui | Branche `experiment/back-office` (8 commits, 10/09) jamais fusionnée : voir Écarts. |
| Emails transactionnels : React Email, Resend, templates traduits, guide DNS (l.46) | s06, s09 | oui (sauf envoi réel) | `resend-live.test.ts` jamais exécuté avec une vraie clé (reviews/s06:218). |
| App shell : dashboard, nav dérivée, dark mode, réglages, profil, avatar (l.47) | s08, s18, s61, s62a, s62b, s62c, s63, s66 | oui | |
| Marketing : landing, pricing dérivé, FAQ, témoignages, contact, newsletter, légal, SEO/OG, sitemap, robots (l.48) | s10, s11, s22, s53 | oui | |
| Blog MDX : liste, article, tags, RSS, OG auto (l.49) | s29, s53 | **partiel** | Validité du RSS non prouvée (s53 partiel). |
| Docs produit + recherche plein texte (l.50) | s30, s54 | oui | Pipeline MDX maison, pas Fumadocs (« ou équivalent », donc conforme). |
| Changelog (l.51) | s31 | **partiel** | Flux RSS « analysable », pas « valide » (s31 partiel). |
| i18n : next-intl, routes localisées, sélecteur, emails traduits (l.52) | s09, s64c | oui | `next-intl@4.14.1` (apps/web/package.json:46). |
| Storage S3/R2, upload présigné, contrôle d'accès, avatars (l.53) | s18 | oui, avec réserve | Le périmètre « fichier d'organisation » existe dans le domaine, mais « est inatteignable par l'application livrée » (reviews/s18, §9). Seul l'avatar personnel est servi. |
| Notifications in-app : centre, badge, préférences (l.54) | s32, s62c | oui | |
| Jobs & cron Inngest (l.55) | s33 | oui (sauf réel) | Le test contre le serveur de dev Inngest (critère 3) n'a pas été observé en revue. |
| Déploiement : Dockerfile, compose, guides Coolify et Vercel, checklist env, migrations, `APP_HOST` (l.56) | s27, s59, s64a, s64b1, s64b2, s64c | **partiel** | Aucun déploiement réel, ni Coolify, ni Vercel, ni deux hôtes (s27/s64c partiels, s59 en cours, issue #73). L'image ne démarre pas sur des variables seules avec la configuration livrée (recherche s59, fait 1). |
| Pack RGPD : suppression + purge, export, consentement (l.57) | s34, s34b, s35, s36, s67 | oui | |
| Rate limiting + anti-bot : IP/compte, captcha optionnel (l.58) | s28, s11, s42 | **partiel** | Aucun fournisseur de captcha (s28 partiel). Sans proxy qui réécrit `x-forwarded-for`, la limitation est contournable (recherche s59, fait 5 ; docs/deployment.md §221). |
| Guest checkout (l.59) | s24, s64b2 | oui | |
| Serveur MCP (l.60) | s41 | oui | Le branchement dans un vrai client MCP est resté un « geste humain » (reviews/s41:481). |
| Monitoring + analytics : Sentry + source maps, PostHog (l.61) | s39 | **partiel** | Symbolisation jamais observée, défaut probable côté serveur (s39 partiel). Seul PostHog est implémenté, conformément à la règle « une implémentation par port ». |
| Onboarding multi-étapes (l.62) | s40 | oui | |
| Plugins bonus : waitlist, widget feedback, roadmap publique (l.63) | s42, s43, s44 | **partiel** | Waitlist livrée. Feedback **en cours** (wip interrompu). Roadmap **en cours** (plan seul). |
| Tooling & DX : TS strict, lint, Vitest, Playwright, GHA, compose local, seed, `.env.example`, conventions IA (l.64) | s01, s02, s48, s50, s51, s52, s55, s57, s58, s68 | oui, avec réserve | La CI de `dev` est rouge au dernier run (audit). s68 partiel. Intermittent ouvert #59. |
| **Succès 1** — clone → premier paiement < 30 min (l.102) | s25, s64b2 | **partiel** | Le harnais mesure, mais le seuil de 30 min est une recette humaine. Le régime `recorded` n'a jamais tourné sur des formes Stripe réelles, et le job CI est `skipped`. |
| **Succès 2** — un projet réel en prod, avec un paiement live (l.103) | s59 (aucune autre) | **non** | Aucun déploiement n'a jamais servi l'application. s59 n'en est qu'à la recherche. |
| **Succès 3** — parité sur tout le tableau « Replicated » (l.104) | toutes | **partiel** | Feedback et roadmap manquent. Captcha, RSS valide et symbolisation ne sont pas prouvés. |
| **Succès 4** — preuve de modularité, profil minimal (l.105) | s26, s48 | oui | `pnpm test:minimal-profile` est vert en CI (job « Profil minimal », run 38033504403). Les « seat billing » ne sont pas un module : le profil coupe `billing` entier (`config/profiles.ts`). |
| **Succès 5** — aucune régression au toggle (l.106) | s05, s26, s48 | oui | Le critère 7 de s05 (données retrouvées) n'a été prouvé qu'à la main (reviews/s05:86, F5 minor, « reste ouvert » :432). |

**Items PRD sans story livrée, ou couverts seulement par du partiel ou du non-fait :** succès 2 (projet en prod, aucune story livrée) ; widget feedback et roadmap publique (s43/s44 en cours) ; déploiement réel (s27 et s64c partiels, s59 en cours) ; captcha (s28 partiel) ; Sentry lisible (s39 partiel) ; validité RSS du blog et du changelog (s53 et s31 partiels) ; hôte console dédié (s65 non fait, mais il est explicitement reporté dans le PRD l.56).

---

### 3. Cimetière (`docs/prd.md` l.71-82, verbatim)

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

**Contradictions du cimetière par le code livré : aucune trouvée** sur ce balayage (grep dans `packages/`, `apps/`, `config/`, `scripts/`, hors `node_modules` et `.next`) :
- `eject` : aucune commande. Les occurrences sont des `reject(`.
- Aucun SDK d'IA. Aucune dépendance Prisma, MySQL, SQLite ou Mongo. La seule occurrence `mysql://` est un cas de refus dans `packages/config/src/env.test.ts:13`.
- LemonSqueezy, Polar et Creem n'apparaissent que dans des commentaires qui les déclarent au cimetière.
- Aucun WebSocket ni SSE. La seule occurrence est le commentaire `connect-src` de `config/security.ts:35`.
- Pas de table d'audit : les événements de sécurité vont seulement aux journaux applicatifs (`packages/modules/admin/src/domain/security-event.ts`).
- Adaptateurs livrés : `inngest`, `posthog`, `resend`, `s3`, `sentry`, `stripe`, soit un par port.

Deux zones grises à connaître :
- Les paquets `*-testing` (`mailer-testing` avec capture locale, `payments-testing` avec mode local, `storage-testing`, `jobs-testing`) sont des implémentations alternatives des ports, que les ADR et les `AGENTS.md` déclarent « outils, pas fournisseurs ».
- La ligne PRD l.61 annonce « adapter analytics PostHog/Plausible/GA », et seul PostHog existe, ce qui est conforme à la règle du cimetière l.81.

---

### 4. Écarts notables (doc vs code ou état réel)

1. **La CI de `dev` est rouge.** Le dernier run CI sur `origin/dev` (`9f36ea9`, 10/10, run 38033504403) échoue sur les deux branches de matrice, à l'étape `pnpm run audit` : nouveaux avis, dont des critiques sur `next`, `handlebars` et `proxy-addr`. Tous les tests passent (107 fichiers, 126 parcours e2e en socle). Le dernier vert date de `be6cf08` (29/09). Le critère 4 de s48 (« CI de la branche par défaut verte ») n'est donc plus vrai aujourd'hui. Sept PR Dependabot sont ouvertes (#17, #46-#50, #76 pour next 16.3.8).
2. **La recherche s59 contredit des critères déjà « livrés »** (`origin/feature/s59-premier-deploiement:docs/research/s59-premier-deploiement.md`) :
   - L'image ne démarre pas sur des variables seules avec la configuration livrée : `storage` et `analytics` exigent une origine dans `config/security.ts`, compilée dans l'image. Cela contredit le critère 1 de s27.
   - Les erreurs serveur partiraient non symbolisées (critère 1 de s39).
   - La pile compose expose Next sans proxy, et la limitation de débit lit le premier maillon de `x-forwarded-for` : elle est contournable sur un hôte public sans relais (s28).
   - Les deux amendements qu'elle propose (critère 6 et notes de s59) ne sont appliqués nulle part.
3. **Les en-têtes de `docs/stories.md` sont périmés.** s37c dit encore « Optionnelle — reportée » (stories.md:1189) alors qu'elle est livrée (`31bb166`). s43 et s44 disent « OPTIONNELLE — reportée le 05/09 » (stories.md:1335, :1360) alors que leur recherche est sur `dev` (au commit `6dda2e3`), leur plan est `validated: yes` sur leur branche, et s43 a 4168 lignes de code non fusionnées. Seule s42 a été remise à jour (« Reportée le 05/09, puis reprise et livrée », stories.md:1308).
4. **Aucune section `### Amendments` n'existe** dans `docs/stories.md` (0 occurrence), alors qu'AGENTS.md exige que les amendements y soient écrits. Ils sont en réalité inline : critère 5 de s13 (l.376), « Cette story amende… » dans s60 (l.1788), s61 (l.1835), s62 (l.1874), s63 (l.1976), s64 (l.2018) et s65 (l.2163). Le critère 4 de s34 a été réécrit en place (l.931).
5. **Le socle déclaré et le socle exécutable divergent.** stories.md:15-24 déclare non désactivables s06, s07, s08, s28, s34, s35 et s36. Le code ne verrouille que `requiredModules = ['auth', 'rate-limit']` (`config/features.ts`). `consent` (s36) reste désactivable tant qu'`analytics` est coupé : `analytics` déclare `requires: ['consent']`, `consent` lui-même n'est pas requis.
6. **Les modules requis promis ne sont pas déclarés.** s42 (stories.md:1329) annonce « Modules requis déclarés : back-office et formulaires publics », et s37 (l.1068) dit que l'admin est requis par s42, s43 et s44. Or la waitlist vit dans `marketing`, qui déclare `requires: []` (`packages/modules/marketing/src/module.ts:91`).
7. **Le stockage par organisation est livré dans le domaine, mais injoignable.** reviews/s18 §9 dit que « le périmètre organisation… est inatteignable par l'application livrée ». Le critère 5 de s18 et la promesse PRD l.53 (« contrôle d'accès par organisation ») ne tiennent donc qu'au niveau du domaine.
8. **Les recettes hors CI contre de vrais fournisseurs n'ont jamais été jouées en revue :** Resend (s06), Stripe (s19, s21, s25), Inngest (s33), PostHog et Sentry (s39), MCP dans un vrai client (s41). Les commandes existent, aucune trace d'exécution n'est consignée. Aucune capture Stripe réelle dans `tests/fixtures/stripe-events/`.
9. **Les majors ouverts n'ont pas été tracés en issues.** La règle « open majors become issues at ship » est arrivée tard. Les issues GitHub ne commencent à les suivre qu'à partir de #58. Sur les 73 revues de story, la dernière ligne `Max severity` vaut `major` pour 38, `minor` pour 32 et `none` pour 3. Je n'ai pas vérifié lesquels de ces majors ont été corrigés depuis. Issues encore ouvertes : #58 (s68), #59 (intermittent `e2e/i18n.spec.ts:89`, après s52), #61 (s63, `/premium`), #73 (s64c, recette à deux hôtes).
10. **Branches et worktrees orphelins :**
    - `experiment/back-office` (+ worktree `.worktrees/back-office`) : 8 commits du 09 au 10/09, dont « sert un tableau de bord sur la racine du back-office », « ajoute l'histogramme au design system » et « écrit les deux décisions du back-office autonome ». Elle n'est rattachée à aucune story et est en retard de 51 commits. Sa thèse a été en partie reprise par s60 (console + tableau de bord).
    - `.worktrees/demo` est un HEAD détaché à `c9cebf3` (s58).
    - `fix/e2e-ci-parity` et `fix/e2e-click-until` ont 200 commits de retard. Le second est déjà repris sur `dev` (`90ff7d3`, même sujet).
    - `worktree-agent-a2713247b498ec5ef` et `worktree-agent-a2941357b5b24c199` : branches d'agents.
11. **Les compteurs de documents ne correspondent pas aux revues.** Toutes les cases de critères de `docs/stories.md` sont `[ ]`, livrées comprises. `docs/research/` n'a pas de fichier pour s55 ni pour s59 (s59 seulement sur sa branche distante). `docs/plans/` contient s43 et s44 seulement sur leurs branches. `docs/reviews/stories.md` se termine sur « s65 : un 5 non découpé, à découper avant toute reprise (F105) ».
12. **L'ADR 005 (Hono + oRPC) n'a jamais été livré.** Constat déjà écrit dans `AGENTS.local.md` : 0 import `@orpc/*` ou `hono`. Les routes passent par `dispatchModuleRequest` + `ModuleRoute` + Zod. La ligne PRD l.8 cite Hono pour Supastarter seulement, et aucune story ne l'exigeait. Je le mentionne pour mémoire : un ADR accepté que le code n'implémente pas.

---

## Annexe B — Défauts et suivis ouverts (revues, plans, STATE, feedback)


Légende des colonnes :
- **cat.** : `bug` ou `enh.` (enhancement).
- **grav.** : gravité d'origine. `C` critical, `M` major, `m` minor, `NV` « non vérifié » d'une revue qui nomme un défaut, `dette` dette nommée dans STATE ou un plan.
- **Statut** : `VO` vérifié ouvert, `NV` non vérifié.
- La source cite `docs/reviews/<fichier>:<ligne>` sauf mention contraire.

#### 1. CI, sécurité et socles

| id | Titre (issue-ready) | cat. | grav. | Source | Preuve que c'est toujours ouvert | Statut | Doublon |
|---|---|---|---|---|---|---|---|
| CI-1 | Rétablir la CI de `dev` : traiter les 12 avis de `pnpm run audit` (4 critiques) | bug | dette | `docs/STATE.md:220,258` ; run CI `dev` 9f36ea9 (10/10) | L'étape audit est rouge dans les deux branches de la matrice. **Critiques** : `next` GHSA-vcvr-r3jv-pc5j, `handlebars` ×2 (via `eslint-plugin-boundaries`), `proxy-addr` (via `express` ← `@modelcontextprotocol/sdk`, `inngest`). **Élevés** : `next`, `sharp`, `braces`, `brace-expansion` ×2, `source-map-js`, `@grpc/grpc-js` (via inngest/otel), `@modelcontextprotocol/sdk`. `.audit-exceptions.json` est vide | VO | — (la PR #76 n'en corrige qu'une partie) |
| SEC-1 | Identifier l'appelant de la limitation de débit par un nombre configuré de proxys de confiance, pas par le premier maillon de `x-forwarded-for`, et borner les écritures `public_subscription` / `contact_message` | enh. | M | s11-public-forms.md:464,467 ; `STATE.md:209-214` | `packages/modules/marketing/src/domain/rate-limit.ts:96` lit le 1er maillon, que le client écrit lui-même. `config/security.ts:85-87` le qualifie de « gêne, pas une barrière ». Sans proxy de confiance, tout tombe dans le seau `unknown`, et une inondation peut pousser les webhooks Stripe en 429 (`:288-295`) | VO | — |
| SEC-2 | Hacher le jeton de réinitialisation de mot de passe dans `auth_verification` | enh. | M | s07-signup-signin.md:189 | `packages/modules/auth/src/infrastructure/token-factory.ts:27-44` écrit `reset-password:<jeton>` en clair. Lire la table suffit à reprendre un compte | VO | — |
| SEC-3 | Valider par Zod les corps des routes auth (révocation de session, 2FA, passkey…) | bug | m | s08-app-shell.md:252 | `auth-routes.ts:939, 1162, 1256, 1316, 1348, 1386, 1423, 1499` font `(await jsonBody(request)) as {…}` puis `typeof`. Le socle `docs/security.md` §4 exige Zod | VO | — |
| SEC-4 | Répondre 404 et non 401 à un anonyme sur `/api/modules/admin/*` | bug | m | s37a-superadmin-et-bannissement.md:50 | Les routes admin sont `authenticated` (`admin-routes.ts:219…444`). `packages/core/src/registry.ts:396` renvoie 401, ce qui révèle l'existence de l'API d'administration | VO | — |
| SEC-5 | Contrôler l'`Origin` au démarrage OAuth (`/auth/sign-in/social`) | enh. | m | s12-oauth-signin.md:192 | `auth-routes.ts:663-699` : route publique sans contrôle d'origine. `docs/security.md` n'a aucune règle CSRF | VO | — |
| SEC-6 | Refuser `POST /two-factor/enable` sur un compte déjà protégé (ré-enrôlement sans code confirmé) | bug | m | s13-two-factor.md:242 | `auth-routes.ts:1251-1272` vérifie la session et le mot de passe, puis le nouveau secret devient actif sans code | VO | — |
| SEC-7 | Ne plus relayer le `token` de session dans le corps de `/sign-in/email` | bug | m | s13-two-factor.md:144 | `auth-routes.ts:867` relaie le corps de la bibliothèque, et `tests/auth.test.ts:1001` l'exige encore | VO | — |
| SEC-8 | Filtrer ou retirer `errorCallbackURL` et `newUserCallbackURL` sur `/magic-link/verify` | bug | m | s67-suppression-en-attente.md:61 | `auth-routes.ts:191-196` ne filtre que `callbackURL`. Piège latent de redirection | VO | — |
| SEC-9 | Plafonner la taille du corps du webhook de facturation (413) | bug | NV | s19-subscribe-stripe.md:326 | `billing-routes.ts:263` fait `await request.text()` sans borne. Aucune limite de `content-length` dans core ni dans `apps/web` | VO | — |
| SEC-10 | Refuser un `APP_URL` portant requête, fragment ou IP quand `APP_HOST` est posé | bug | m | s64a-hote-origines.md:42 | `packages/config/src/env.ts:49` ne contrôle que `pathname`. `HOSTNAME_PATTERN` (`:22`) accepte `app.127.0.0.1` | VO | — |
| SEC-11 | Ne pas émettre HSTS `includeSubDomains` (2 ans) en développement | enh. | NV | s45-security-headers.md:291 | `apps/web/lib/security-headers.ts:151` pose HSTS quel que soit `mode` | VO | — |
| SEC-12 | Poser `Vary` / `Cache-Control: no-store` sur les redirections de langue (307/308) et les 404 d'aiguillage par hôte du proxy | bug | m | s09-i18n.md:338 ; s64c-hote-cookies.md:44 | `apps/web/proxy.ts:300-314` (redirections de langue) et `:140,148` (404) n'en posent pas. Seul le 308 d'hôte (`:107`) porte `no-store` | VO | voisin de #67 (fermée, autre périmètre) |
| SEC-13 | Ne plus exposer `?error=seat_limit_reached` dans l'URL de l'invité | enh. | m | s47-seat-limit.md:48 | `organizations/src/domain/invitation.ts:216` le place dans `ACCEPT_REFUSALS`, ce qui révèle l'existence d'un plafond | VO | — |
| SEC-14 | Borner les exports : taille de l'archive RGPD, plafond et limitation de débit de l'export CSV des inscriptions | enh. | m | s35-data-export.md:72 ; s37c-inscriptions-publiques.md:110 | `auth/src/schema.ts:379` : `archive: jsonb` sans borne. `admin-routes.ts:443-446` : `exportSubscriptions` sans `rateLimit` | VO | — |
| SEC-15 | Lire le blocage de connexion (banni) dans la transaction de Better Auth | bug | m (latent) | s37a-superadmin-et-bannissement.md:58 | `better-auth-service.ts:733` lit `isSignInBlocked` sur une autre connexion, alors que l'adaptateur est `transaction: true` (`:666`) | VO | — |

#### 2. Facturation

| id | Titre | cat. | grav. | Source | Preuve | Statut | Doublon |
|---|---|---|---|---|---|---|---|
| BIL-1 | Prévenir le propriétaire quand une invitation est refusée pour plafond de sièges | enh. | M | s47-seat-limit.md:40 ; feedback:1578 | `organizations/src/domain/invitation.ts:154-162` : le propriétaire « n'apprend pas » le refus. Aucune notification `seat_limit`, et `over_limit` ne transporte pas le plafond | VO | — |
| BIL-2 | Retirer le repli transitoire sur `billing_purchase.provider_session_id` | enh. | M (dette) | s20-one-time-purchase.md:356 | `drizzle-billing-repositories.ts:114-119` : `purchaseOfSession` lit encore l'ancienne colonne | VO | — |
| BIL-3 | Rendre la clé d'idempotence du checkout cohérente avec ses paramètres (locale, sièges, email) | bug | m | s20-one-time-purchase.md:404 | `billing-use-cases.ts:909,1024` : la clé `checkout:<ref>:<offre>` est fixe alors que les paramètres varient. Stripe refuse une clé réutilisée avec d'autres paramètres | VO | — |
| BIL-4 | Fermer la fenêtre du double prélèvement (deux sessions de checkout payées pour un même achat) | bug | m | s20-one-time-purchase.md:391 | ADR 038 §« Ce que cela ne répare pas » (l.158-168). Aucune session n'expire côté application | VO | — |
| BIL-5 | Empêcher deux checkouts simultanés d'accorder deux essais au même périmètre | bug | NV | s21-trials-and-gating.md:200 | `billing-use-cases.ts:1022` : `trialDaysFor` lu sans verrou | VO (course non jouée) | — |
| BIL-6 | Fermer (ou écrire dans l'ADR 037) les fenêtres à deux abonnements : statut `incomplete`, checkout ouvert avant le webhook | bug | m | s19-subscribe-stripe.md:1349 | `billing-use-cases.ts:987` ne refuse que si `grantsAccess(current)`. `incomplete` n'accorde rien (`domain/subscription.ts:48`) | VO | — |
| BIL-7 | Rendre `adds` obligatoire dans le contrat `seatSync` | bug | m | s47-seat-limit.md:48 | `apps/web/lib/seat-sync.ts:41`, `billing-use-cases.ts:474` : `adds?` vaut `false` par défaut (`:1293`). Une omission désarme le plafond (`:1348`) | VO | — |
| BIL-8 | Synchroniser les sièges à la suppression de compte, ou planifier `billing:reconcile` | bug | m | s23-seat-billing.md:104 | `organization-use-cases.ts:1282` : `deleteMembershipsOf` sans `seatSync`. `billing/src/module.ts:83` : aucun job de réconciliation. Le décalage est assumé par l'ADR 046, mais rien ne le résorbe | VO | — |
| BIL-9 | Ne plus tenir transaction et verrou d'appartenance pendant deux appels Stripe | enh. | m | s23-seat-billing.md:107 | `stripe-payments.ts:627,650` dans la transaction, avec un pool à `max 10` (`packages/db/src/client.ts:44`) | VO | — |
| BIL-10 | Livrer une offre au siège dans `config/billing.ts` et trancher le proratage Stripe (ADR 046) | enh. | dette | `STATE.md:302` ; s23-seat-billing.md:123 | `config/billing.ts:60,71,93` : `perSeat: false` partout. Aucun `proration_behavior` dans l'adaptateur | VO | — |
| BIL-11 | Vérifier que `amount` et `currency` de `config/billing.ts` concordent avec le prix Stripe de chaque `priceId` | enh. | NV | s22-pricing-page.md:121 | Aucun `prices.retrieve` dans `packages/adapters/stripe` ni dans `scripts/` | VO | — |
| BIL-12 | Rendre `/pricing` indexable (contribuer `/pricing` par `publicUrls`) | bug | dette n°1 | `STATE.md:267` ; s22-pricing-page.md:175 | `billing/src/module.ts:79` : `publicUrls: () => []`. `robots.ts` interdit `/pricing` | VO | — |
| BIL-13 | Supprimer les tables inertes `public_form_throttle` et `billing_checkout_throttle` (migration rétrocompatible) | enh. | dette n°2 | `STATE.md:274` ; plan s28:30 | `marketing/src/schema.ts:89`, `billing/src/schema.ts:399`. Plus écrites depuis s28 | VO | — |
| BIL-14 | Capturer de vrais événements Stripe (dont `checkout.session.completed` en achat unique) pour armer le régime `recorded` et le job CI du parcours doré | enh. | dette n°3 | s19-subscribe-stripe.md:302 ; s25-golden-path-e2e.md:129 ; `STATE.md:280` | `tests/fixtures/stripe-events/` ne contient que `README.md`, donc le job `parcours-dore` est toujours sauté | VO | — |
| BIL-15 | Jouer la recette Stripe en clés de test : achat unique, remboursements, `billing:reconcile`, essai, sièges, idempotence, scénario doré en `live`, ordre de `checkout.sessions.list`, configuration du portail client | enh. | NV | s20:226,456,671 ; s21:178 ; s23:123 ; s24:117 ; s25:130 ; s19:1375 | `scripts/golden-path.ts:126` : `live` ne lance que `stripe-live.test.ts`. `stripe-payments.ts:537` : portail sans `configuration` | NV | — |
| BIL-16 | Mesurer la garde des écrans console qui dépend de `billing.available` et `organizations.available` (profil qui coupe `billing` en gardant `admin`) | enh. | m | s38-admin-revenue.md:48 ; plan s38:51 | `apps/web/AGENTS.md` : « décidée par aucune commande ». `config/profiles.ts` coupe les trois modules ensemble | VO | — |
| BIL-17 | Borner par période le revenu récurrent de la console (instantané daté du parc) | enh. | m | plan s38:46 | Seuls les achats sont bornés par période, comme l'écran l'indique lui-même | VO | — |

#### 3. Authentification, comptes et écrans

| id | Titre | cat. | grav. | Source | Preuve | Statut | Doublon |
|---|---|---|---|---|---|---|---|
| UX-1 | Traiter le 429 (statut avant corps) dans tous les formulaires client | bug | m | s28-rate-limiting.md:1105 | 4 `.tsx` le gèrent sur 14 qui appellent `fetch`. `settings/profile/account-form.tsx:51-63` n'a pas de branche 429, alors que `apps/web/AGENTS.md:405` pose la règle | VO | — |
| UX-2 | Afficher le verrouillage de compte 2FA (900 s) autrement que « vérification expirée » | bug | m | s28-rate-limiting.md:1131 | `auth/src/domain/two-factor.ts:118-121` replie 400 et 429 sur `restart`, et l'utilisateur reboucle pendant 15 min | VO | — |
| UX-3 | Afficher un message de panne (et non « Vérifiez les informations saisies ») sur un 5xx d'authentification | bug | m | s07-signup-signin.md:688 | `apps/web/app/auth-form.tsx:126` : 500 et 503 tombent sur `app.auth.error.invalid` | VO | — |
| UX-4 | Émettre `auth.password_changed` et en faire le producteur de la notification `account.security-alert` | bug | m | s07-signup-signin.md:215 ; partie F (hors tranche) | `auth/src/domain/security-event.ts:28` déclare l'événement, sans aucune émission. `config/notifications.ts:49-55` déclare `account.security-alert`, sans producteur | VO | — |
| UX-5 | Ne plus copier l'email dans `auth_user.name` à l'inscription | bug | m | s07-signup-signin.md:225 | `auth-routes.ts:836` : `{ ...input, name: input.email }` | VO | — |
| UX-6 | Journaliser la cause réelle d'un échec de connexion (session non créée ou mauvais mot de passe) | enh. | m | s07-signup-signin.md:669 | `auth-routes.ts:908-913` ne garde que `{ status }` | VO | — |
| UX-7 | Ajouter un rebond same-site après le magic link (cookie `SameSite=Strict` perdu depuis un webmail) | bug | m | s07-signup-signin.md:253 | `auth-routes.ts:961-998` : pas de rebond. OAuth en a un (`app/(auth)/oauth/return`) | NV (pas de vrai webmail) | — |
| UX-8 | Rendre une page HTML et un refus générique au retour OAuth d'un compte banni ou en attente de suppression (aujourd'hui 401 JSON) | bug | m | s67-suppression-en-attente.md:65 | Le magic link est corrigé (`magicLinkRefusal`, `auth-routes.ts:998`). Rien d'équivalent n'est trouvé pour le retour OAuth | NV (navigateur) | — |
| UX-9 | Rendre le quota d'invitations atomique (21 émises pour 20 sous concurrence) | bug | m | s16-invite-members.md:590 | `drizzle-organization-repositories.ts:376-396` : comptage puis insertion, sans verrou | VO | — |
| UX-10 | Afficher la carte des invitations selon `invitation.resend` / `invitation.revoke` | enh. | m | s17-roles-permissions.md:375 | `organizations-screen.tsx:646` : gate sur `member.invite` seul (latent) | VO | — |
| UX-11 | Corriger l'état « aucune organisation choisie » des écrans Organisation et Membres | bug | m | s62b-reglages-decoupage.md:65 | `organizations-screen.tsx:576-577` décrit « cette organisation » alors qu'il n'y en a aucune | VO | — |
| UX-12 | Permettre de changer d'organisation sans JavaScript sous `md` | bug | m | s62c-barre-du-haut.md:46 | `apps/web/app/app-shell.tsx:159` : sélecteur `hidden md:block` ; le `<noscript>` est dans le bloc masqué | VO | — |
| UX-13 | Expliquer sans JavaScript les boutons éteints des 6 écrans Réglages (`<noscript>`) | bug | dette | plan s46:51 | `account-form`, `avatar-form`, `data-export-card`, `delete-account-card`, `passkey-card`, `two-factor-card` utilisent `useHydrated` sans aucun `noscript` | VO | — |
| UX-14 | Garder l'entrée active de la barre latérale de la console sur les pages de détail (correspondance par préfixe) | bug | m | s60-console.md:116 | `packages/ui/src/composed/sidebar.tsx:34` compare `href === currentPath` | VO | — |
| UX-15 | Aligner la largeur du contenu du site sur celle de son en-tête | bug | m | s61-site-et-application.md:66 | `site-header.tsx:141` utilise `max-w-6xl`, contre `zone-frame.tsx:80` en `max-w-4xl` | VO | — |
| UX-16 | Ne plus charger la liste des notifications pour rendre les préférences | enh. | m | s62c-barre-du-haut.md:44 | `settings/notifications/page.tsx:42` appelle `notifications.view(session, 1)` | VO | — |
| UX-17 | Nettoyer `SignOutButton` mort et la clé `app.account.signOut`, et aligner « Paramètres du compte » sur « Réglages » | enh. | m | s62b-reglages-decoupage.md:66,68 | `apps/web/app/sign-out-button.tsx` n'est importé nulle part. `messages/fr.json:26,89` | VO | — |
| UX-18 | Rendre l'écran 500 (`global-error.tsx`) dans la langue du visiteur | enh. | m | s45-security-headers.md:411 | `global-error.tsx:48` : `lang={fallbackLocale}` | VO | — |
| UX-19 | Stocker la langue préférée du compte pour les emails hors requête | enh. | m | s09-i18n.md:290 | `organization-use-cases.ts:493`, `apps/web/lib/billing.ts:530` : les emails partent dans la langue du site | VO | — |
| UX-20 | Garder la page courante au changement de langue | enh. | m | s09-i18n.md:297 | `apps/web/lib/navigation.ts:85` : `publicPath('/', candidate)` | VO | — |
| UX-21 | Configurer un `timeZone` global pour next-intl (avertissement `ENVIRONMENT_FALLBACK` dans les journaux de CI) | enh. | — (vu en CI) | logs des runs CI des PR #76 et #46 | `apps/web/i18n/request-config.ts:39-44` : la configuration ne fixe pas de `timeZone` | VO | — |
| UX-22 | Faire en un seul saut la redirection inter-hôtes d'un chemin sans préfixe de langue | bug | m | s64b1-hote-routage.md:42 | `apps/web/proxy.ts:119,138,147` : 308 puis 307 | VO | — |
| UX-23 | Découpler la garde d'origine du consentement d'`AUTH_SECRET` | bug | m | s64b1-hote-routage.md:44 | `apps/web/lib/consent.ts:177-178` passe par `resolveAuthConfig`, qui lève sans le secret | VO | — |
| UX-24 | Migrer vers le domaine parent un `app_locale` propre à l'hôte | bug | m | s64c-hote-cookies.md:46 | `apps/web/proxy.ts:349` : la copie d'hôte n'est jamais réécrite | VO | — |
| UX-25 | Définir `robots.txt`, `sitemap.xml` et `public/` sur l'hôte de l'application | enh. | m | stories.md:129 | `apps/web/proxy.ts:112-120` : `/robots.txt` est servi tel quel sur l'hôte app (non mesuré) | NV | — |
| UX-26 | Ajouter à la console les actions bannir/débannir, promouvoir/révoquer et démarrer une impersonation | enh. | obs. | s37b2-back-office-lecture.md:48 | Les routes existent (`admin-routes.ts:218-358`). L'écran n'expose que `revokeSession` et `sendPasswordReset` (`back-office-screens.tsx:437`) | VO | — |
| UX-27 | Inclure le rôle de superadmin dans l'export RGPD | enh. | m | s35-data-export.md:60 | `admin/src/module.ts:116` : `export: async () => ({})` | VO | — |
| UX-28 | Donner aux jobs un déclencheur « à la demande » (la purge de compte est armée chaque nuit à vide) | enh. | dette | feedback:1149 | `packages/core/src/module.ts:397` : `schedule` est obligatoire. `account-purge-job.ts:39` porte un cron inventé, et `inngest-jobs.ts:336` arme l'événement **et** le cron | VO | — |
| UX-29 | Vérifier qu'une écriture confirme le périmètre affiché (organisation basculée dans un autre onglet) | enh. | obs. | s15-organizations.md:228 | La sélection est par compte et `dataOwnerOf` est résolu à la requête. Pas balayé écran par écran | NV | — |
| UX-30 | Vérifier que le rafraîchissement transactionnel (`getCurrentAdapter`) ne contourne pas le gel des sessions empruntées | bug | obs. | s37b1-decompte-et-impersonation.md:74 | Le chemin de rafraîchissement n'est pas transactionnel aujourd'hui. C'est un risque interne à better-auth | NV | — |
| UX-31 | Garantir qu'un refus d'effacement (dernier propriétaire) n'a rien purgé lors d'une tentative antérieure | bug | m | s34-account-deletion.md:83 | Résidu déclaré, comportement inchangé | NV | — |
| UX-32 | Vérifier que la bannière de consentement ne masque pas l'alerte d'étape obligatoire de l'onboarding à 390 px | bug | NV | s40-onboarding.md:74 | Observé sur capture. Aucune mesure sur `/app/onboarding` | NV | — |

#### 4. Stockage, déploiement et plateforme

| id | Titre | cat. | grav. | Source | Preuve | Statut | Doublon |
|---|---|---|---|---|---|---|---|
| PLT-1 | Ajouter la commande de réconciliation objets de stockage ↔ lignes `storage_file` (avatar orphelin après une promotion interrompue) | bug | m | s18-file-storage-avatar.md:770 ; getting-started.md:359 | `packages/modules/storage/AGENTS.md:65-77` : « cette commande n'existe pas ». `scripts/` ne contient que `billing-reconcile.ts` | VO | — |
| PLT-2 | Couvrir (ou retirer) le chemin d'appartenance « organisation » du stockage | enh. | m | s18-file-storage-avatar.md:762 | `storage/src/module.ts:41` : conversion sans `ownerOf` injecté. Aucun écran ne l'emprunte | VO | — |
| PLT-3 | Déclarer l'origine du seau S3 dans la CSP depuis l'environnement, sans éditer `config/security.ts` | enh. | m | s27-deployment.md:127 | `config/security.ts:56` : `connect: []`. Une image avec `storage` ne démarre pas sur ses seules variables | VO | — |
| PLT-4 | Premier déploiement réel (s59) : servir l'image hors du poste, faire aboutir Coolify, exercer Vercel, vérifier que le proxy écrase `x-forwarded-for` | enh. | dette n°4-5 | s27-deployment.md:147 ; `STATE.md:259,290` ; getting-started.md:357 | `docs/deployment.md:18-19` : « exécution non faite ». Branche distante `feature/s59-premier-deploiement` (recherche seule) | VO | lié à #73 |
| PLT-5 | Prouver que la garde de démarrage refuse avant que le serveur accepte une requête (`✓ Ready` avant `register()`) | bug | NV | s27-deployment.md:150 | Ordre jamais mesuré | NV | — |
| PLT-6 | Rendre la taille du pool PostgreSQL configurable (serverless ou conteneur) | enh. | report ADR 003 | s01-boot-blank-app.md:152 | `packages/db/src/client.ts:44` : `max ?? 10`, jamais passé, aucune variable | VO | — |
| PLT-7 | Passer Node 22 à une LTS (24 maintenant, 26 quand elle sera LTS) en remplaçant `corepack enable` dans le Dockerfile | enh. | dette | feedback:1911 | `.nvmrc` = 22. `Dockerfile:21,106` en `node:22-alpine`, `:24` fait `corepack enable` (absent de Node ≥ 25, cf. échec de la PR #50) | VO | lié à la PR #50 |
| PLT-8 | Fournir une recette en régime réel pour Sentry (comme `posthog-live.test.ts`) | enh. | NV | s39-monitoring-analytics.md:70 | Aucun test live dans `packages/adapters/sentry/src/` | VO | — |
| PLT-9 | Valider le flux RSS du blog avec un vrai validateur (critère 2 de s53 jamais tenu) | enh. | M | s53-blog-syndication.md:26 | `tests/blog.test.ts:14,615` : seul `feed-parser` vérifie que le flux est « analysable » | VO | — |
| PLT-10 | Livrer un fournisseur de captcha (déclaré et gardé, sans fournisseur) | enh. | non livré | getting-started.md:358 | `config/security.ts:318-332`. Aucun adaptateur | VO | — |
| PLT-11 | Livrer le widget de feedback (s43) | enh. | non livré | getting-started.md:355 | Aucun module. Branche `feature/s43-feedback-widget` = 1 commit WIP, plus un worktree `.worktrees/s43-feedback-widget` | VO | — |
| PLT-12 | Livrer la roadmap publique avec votes (s44) | enh. | non livré | getting-started.md:355 | Branche `feature/s44-public-roadmap` : plan seul | VO | — |
| PLT-13 | Combler les lacunes du design system : `Form`/`FormField`, `Stepper`, `ConfirmDialog`/`AlertDialog` pour les actions irréversibles, gabarit d'image sociale | enh. | dette | `STATE.md:257` ; plans s46:18, s40:14, s37b2:29 | `packages/ui/src/components/` n'a ni `form`, ni `stepper`, ni `alert-dialog`. `docs/design-system.md:249,256,329,358,370` : « Pas livré ». `delete-account-card.tsx:32` contourne le manque | VO | — |

#### 5. Outillage, CLI et lint

| id | Titre | cat. | grav. | Source | Preuve | Statut | Doublon |
|---|---|---|---|---|---|---|---|
| DX-1 | Laisser `ks scaffold` tourner sur un arbre modifié (refuser seulement un conflit sur ses propres fichiers, ou `--allow-dirty`) | enh. | m | s32-notifications-inapp.md:60 ; feedback:670 | `packages/cli/src/bin.ts:132` : `assertRepositoryClean(root)` sans condition | VO | — |
| DX-2 | Borner dans le temps les sous-processus de `ks` (`db:generate`, `db:migrate`) | bug | NV | s05-cli-toggle-module.md:138 | `packages/cli/src/bin.ts:60-80` : `spawn` sans délai | VO | — |
| DX-3 | Dire quoi rejouer quand `ks toggle` est interrompu entre écriture et régénération | enh. | m | s05-cli-toggle-module.md:80 | Aucun gestionnaire de signal dans `packages/cli/src` | VO | — |
| DX-4 | Refuser par lint l'import du paquet d'un autre module sans `requires` déclaré (ADR 055) | enh. | m | s30-docs-site.md:89 | `tooling/eslint/boundaries.ts:28-30` laisse la règle « à faire ». ADR 055:63 | VO | — |
| DX-5 | Interdire par une règle exécutable qu'un écran de `apps/web/app` importe `@repo/module-*` ou teste l'existence de l'i18n | enh. | m | s09-i18n.md:284 | `tests/agents-md.test.ts:177-180` ne balaie que `apps/web/lib/` | VO | — |
| DX-6 | Valider `RouteProtection.role` contre les rôles connus | enh. | m | s03-module-registry.md:105 | `packages/core/src/module.ts:44` : `role: string` libre. Une faute de frappe rend la route 404 en silence | VO | — |
| DX-7 | Rétablir un lint d'accessibilité (`jsx-a11y` ou équivalent ESLint 10) | enh. | dette | s02-quality-harness.md:178 ; `STATE.md:256` | Aucune occurrence de `a11y` dans `eslint.config.ts` ni dans les `package.json` | VO | — |
| DX-8 | Ne plus ouvrir les types DOM aux scripts Node (`tsconfig.json` racine) | bug | m | s08-app-shell.md:300 | `tsconfig.json:7-12` : `lib: ["DOM", …]` pour `config`, `scripts`, `generated` | VO | — |
| DX-9 | Ne pas rejouer `pnpm run audit` sur un échec de lancement (`ENOENT`) | bug | m | s48-ci-verte.md:89 | `scripts/audit.ts:47-53` : toute `result.error` est retentée | VO | — |
| DX-10 | Supprimer la base `socle_<horodatage>` quand `pnpm test:socle` est interrompu (SIGINT/SIGTERM) | bug | m | s48-ci-verte.md:99 | `scripts/socle.ts` ne nettoie que dans un `finally` | VO | — |
| DX-11 | Garde générique : tout module exposant un service est préparé par `prepareModuleServices` | enh. | dette | feedback:724 | Seules des gardes par module existent (`tests/jobs.test.ts:565`…). Rien ne balaie `module-services.ts:90-126` | VO | — |
| DX-12 | Faire créer et migrer sa propre base à `pnpm test:e2e`, comme les trois recettes | enh. | dette | feedback:656 | `e2e/support/warm-up.ts:146` utilise le `DATABASE_URL` du poste | VO | — |
| DX-13 | Vérifier par un test que chaque fichier de test cité dans un ADR ou un `AGENTS.md` existe | enh. | dette | feedback:116 | Aucun test ne lit `docs/decisions/` | VO | — |

#### 6. Tests

| id | Titre | cat. | grav. | Source | Preuve | Statut | Doublon |
|---|---|---|---|---|---|---|---|
| TST-1 | Empêcher `tests/module-migrations.test.ts` de détruire tables et journaux sur la base de développement partagée (schéma dédié) | bug | dette | s15-organizations.md:221 ; `STATE.md:222` | `tests/module-migrations.test.ts:459-477` : `drop table demo_items/demo_notes` plus purge des journaux `drizzle.*`, en `beforeAll` **et** `afterAll`, sur `DATABASE_URL` | VO | — |
| TST-2 | Rendre `e2e/modules.spec.ts` vert quand tous les modules sont activés | bug | dette | s05-cli-toggle-module.md:432 ; `STATE.md:255` | `e2e/modules.spec.ts:59` exige `disabledModules.length > 0` | VO | — |
| TST-3 | Découpler de l'état du dépôt le cas `env-wiring` « storage activé sans stockage » (`withStorageEnabled`) | bug | — | s26-minimal-profile-check.md:178 | `tests/env-wiring.test.ts:387` : le cas rougit dès que `storage` entre dans le profil | VO | — |
| TST-4 | Stabiliser les intermittents encore sans cause établie | bug | m/M | s52:71 ; s50:110 ; s56:16 ; s62a:72 ; s67:11 ; feedback:1601 ; plan s52:55 | `e2e/rate-limiting.spec.ts:38,163,205`, `e2e/oauth.spec.ts:30,97`, `e2e/blog.spec.ts:134`, `e2e/health.spec.ts` (ECONNRESET), `e2e/passkeys.spec.ts`, `e2e/app-shell.spec.ts:134,470,486`, `e2e/auth.spec.ts:177`, `e2e/organizations.spec.ts:74`, `tests/auth.test.ts:765`, `tests/audit-exceptions.test.ts` (« expected 2 to be 3 »). **Vu en CI des PR** : `e2e/app-shell.spec.ts:134` (PR #49), et `tests/auth.test.ts:1239`, chronométrage du mot de passe oublié (écart 87 ms pour un seuil de 60, PR #46) | NV | #59 en partie (i18n seul) |
| TST-5 | Ajouter le parcours invitation → inscription → vérification → acceptation, et corriger le commentaire qui le dit couvert | bug | NV (critère 2 de s16) | s16-invite-members.md:416 | `e2e/organizations.spec.ts:231-233` l'affirme, mais le parcours (l.477-521) s'arrête aux liens | VO | — |
| TST-6 | Durcir les tests qui passent à vide (checklist) | bug | m | s10:259 ; s07:207,260 ; s08:320,593 ; s19:1329 ; s29:130 ; s37a:98,100 ; s41:448,460 ; s48:219 ; s49:94 ; s62a:68,69 ; s62c:47 ; s68:37 ; s64b2:75 | Ordre des sections sans marqueur (`tests/marketing.test.ts:774`) ; `not.toBe(404)` (`e2e/modules.spec.ts:50`) ; doublure `fetch` tardive (`tests/auth.test.ts:171`) ; aucune fixture `.tsx` (`tests/lint-rules.test.ts:111`) ; attente de 2 s (`e2e/app-shell.spec.ts:288`) ; regex `.handle(` (`tests/module-registry.test.ts:1121`) ; `href` d'API préfixés (`minimal-profile.spec.ts:217`) ; course de 300 ms (`tests/admin.test.ts:2336`) ; `not.toContain` sans témoin (`:3722`) ; `.ts` seul (`tests/lint-rules.test.ts:1134`) ; boucle sans plancher (`tests/agents-md.test.ts:225`) ; aucun plancher navigateur dans `test:socle` ; `alert-contrast.spec.ts:146,165` ; `continue` sans témoin (`tests/legacy-paths.test.ts:122`) ; barre latérale absente (`e2e/settings.spec.ts:113`) ; exemption `organizationId` (`tests/rendered-text.test.ts:1466`) ; port 3100 seul (`tests/minimal-profile.test.ts:864`) ; `GOLDEN_PATH_HOSTS` ignoré sous `live` (`scripts/golden-path.ts:119`) | VO | — |
| TST-7 | Couvrir les comportements non testés (checklist) | enh. | m/NV | s07:375 ; s13:182,809 ; s05:86 ; s37a:96 ; s60:120 ; s53:32 ; s36:687 ; s28:511 | Expiration de session ; non-énumération chronométrée sur un compte à 2FA ; magic link et OAuth sur un compte à 2FA ; cycle activer → couper → réactiver ; 4 événements `admin.*` ; câblage réel d'`isSuperadmin` dans la garde console (`tests/console.test.ts:46`) ; `/og-default.png` en HTTP ; double `Origin` sur le consentement ; plafonds 2FA de better-auth sur un défi réel | VO | — |
| TST-8 | Jouer des parcours sur le build de production et sous Firefox et WebKit | enh. | NV | s02-quality-harness.md:130 ; s08-app-shell.md:381 | Les trois `playwright*.config.ts` lancent `next dev`. Un seul projet `chromium` (`playwright.config.ts:280`) | VO | — |
| TST-9 | Recettes humaines réelles : OAuth (Google, GitHub, Safari/Firefox, TLS) et passkeys sur un vrai `rpID` | enh. | NV | s12-oauth-signin.md:329 ; s14-passkeys.md:315 | Seuls le fournisseur local et l'authentificateur virtuel sont exercés | NV | — |

#### 7. Documentation fausse et migration hors du pipeline

| id | Titre | cat. | grav. | Source | Preuve | Statut | Doublon |
|---|---|---|---|---|---|---|---|
| MIG-1 | Retirer ou remplacer les renvois vers `docs/reviews`, `docs/plans`, `docs/research`, `STATE.md` et `killer-saas-feedback.md` avant leur suppression, et repointer `tests/agents-md.test.ts` si `AGENTS.local.md` disparaît | bug | m | s09-i18n.md:723 + mesure de l'audit | `git grep` : **68 renvois dans 33 fichiers** hors des dossiers supprimés (9 dans `docs/`, 8 `packages/modules`, 6 `tests`, `config/security.ts`, `templates/plan.md`…). Exemples : `tests/i18n.test.ts:460`, `tests/auth.test.ts:950,2204`, `tests/fixtures/intermittents.ts:323`, `packages/db/AGENTS.md:119`, `packages/ui/AGENTS.md:291`, `tests/fixtures/stripe-events/README.md:107`. **`tests/agents-md.test.ts:243` lit `AGENTS.local.md`** et exige ses sections `### Commands`, `### Security baseline`, etc. : il rougit si le fichier est supprimé ou fusionné sans adapter le test. NB : `pnpm ks` est le CLI **produit** (modules) et n'a rien à voir avec le pipeline | VO | — |
| DOC-1 | Corriger `docs/architecture.md`, les ADR et les `AGENTS.md` périmés (checklist) | bug | m | s02:105 ; s07:243 ; s36:299 ; plan s36:193 ; s22:114 ; s03:98 ; s09:279 ; s29:128,131 ; s41:439,443,454 ; s53:89 ; s50:104 | `architecture.md:270` : pureté du `domain` « non appliquée », alors qu'elle l'est (`boundaries.ts:152`) ; `architecture.md:161` : module `gdpr` et table `consent` qui n'existent pas ; `architecture.md:271` : « points ouverts » déjà tranchés ; ADR 004 « schéma généré », or il est écrit à la main ; ADR 045 « `/pricing` cacheable », or la page est dynamique ; `core/src/module.ts:93-95` promet Hono ; `i18n/AGENTS.md:16` ; `ui/AGENTS.md:159` et `design-system.md` omettent `InlineStyleNonce` ; `design-system.md:339` ; `AGENTS.local.md:159` (`ks` = « list et toggle ») et `:88` (exception ADR 042) ; exemption `emails/` hors ADR (`tests/lint-rules.test.ts:1119`) ; `security.md:150` « six citations » ; `tests/billing.test.ts:6305` « seul fichier qui connaisse auth » | VO | — |
| DOC-2 | Corriger les commentaires de code et de test faux (checklist) | bug | m | s01:342 ; s07:674 ; s40:57 ; s41:466 ; s48:213,217 ; s62a:70 ; s62b:67 ; s66:79 ; s67:63 ; s64b2:71 | `config/src/dotenv.ts:29-31` ; `token-factory.ts:38` ; `notification-routes.ts:23` (« limitée au-delà du défaut ») ; `mcp-server/src/server.ts:26` ; `scripts/socle-rules.ts:335` ; `scripts/socle.ts:111` ; anciens chemins `pricing/page.tsx:32,56,61,206`, `lib/organizations.ts:57,103`, `onboarding-screen.tsx:62` ; `pricing-table.tsx:28` ; `not-found-screen.tsx:7` ; `tests/auth.test.ts:1492` ; `golden-path.spec.ts:571` | VO | — |
| DOC-3 | Compléter `docs/deployment.md` et le README des enregistrements Stripe | enh. | m | stories.md:119,124 ; s64b1:45 ; s18:463 ; s68:35 | Relancer boucle OAuth et défi 2FA à la bascule `APP_HOST` (rien n'est écrit) ; `app_consent` sur le domaine parent écrivable par tout sous-domaine (`deployment.md:353`) ; piège de relativisation des `Location` ; règle de cycle de vie `pending/` du seau (seulement dans `.env.example:173`) ; capture live sur le port 3110 où rien n'écoute (`scripts/golden-path.ts:86`, `stripe-events/README.md:79`) | VO | — |

#### 8. Déjà suivis par une issue ouverte (ne pas recréer)

| id | Titre | Source | Preuve | Statut | Doublon |
|---|---|---|---|---|---|
| s63-M1 | Faire servir `/premium` selon la garde réelle de l'écran, pas selon `demo-enabled` | s63-application-sous-app.md:37 | `apps/web/lib/legacy-paths.ts:53` : `module: 'demo-enabled'` | VO | **#61** |
| s68-M1 | Deux `pnpm test:socle` simultanés échouent (saturation CPU) | s68-recettes-paralleles.md:33 | Consigné dans `AGENTS.local.md`, non rejoué | NV | **#58** |
| s64c-R | Recette manuelle à deux hôtes (critère 4 de s64c) | s64c-hote-cookies.md:49 | `docs/deployment.md:367-370` : « Aucun agent ne l'a jouée » | NV | **#73** |

---

### Déjà résolus

Ces constats ont été vérifiés pour qu'on sache qu'ils ne sont pas perdus. Ils sont regroupés par story. Le détail ligne à ligne, avec les preuves fichier:ligne, est dans les sorties de tranche `scratchpad/part-A.md` … `part-F.md`.

| Bloc | Constats résolus | Comment |
|---|---|---|
| s01-s09 | 102 | Fermés dans les revues ou dans leurs boucles de correction (s01 N1-N18, s02, s03 F1-F10, s04, s05 F1-F18, s06 F/G, s07 C1/M1-M3, s08 C1/M1/M2, s09 C1/M1-M5), ou rendus caducs (3 sont sans objet : `docs/research` et `STATE.md`) |
| s10-s19 | 105 | Fermés en revue. Le reste a été traité ensuite : s28 (limitation de débit sur 2FA, passkeys, upload, webhook), s34 (organisation sans propriétaire), s61 |
| s20-s28 | 94 | Rondes 2 à 5 de s20 et s28, reprises `6bc521f` (s24), `a6167e1` (s26), `bd97282` (s27) |
| s29-s42 | 122 | Corrigés en ronde de revue ou par des stories ultérieures (s53 robots/blog, s56 rôles, s57 contraste, s61, s66/s67 ADR). **s37a-F4** (refus générique d'un compte banni sur `/magic-link/verify`) : la tranche le donnait ouvert, mais il est résolu par s67 (`magicLinkRefusal`, `auth-routes.ts:998`) |
| s45-s68 + stories.md | 89 | Les majors de s64a, s64b1, s64b2, s64c et s63-M2 sont couverts par les issues **fermées** #62, #64, #67, #69, #70, #72. Les majors de s46, s54, s56, s57 et s58 ont été corrigés ensuite |
| STATE, plans, feedback | 24 | Passkeys sous 2FA (s14), CSP (s45), TS 7 (`e4b29ee`), `pnpm test:sans-env` (s55), ReDoS client-error (s39), seeds (s58), artefacts CI (s51), course de migration Vitest (reprise sur création concurrente, `packages/db/src/migrate.ts:102-192` : pas de verrou mais un rejeu ; le signalement « non vérifié » de s52 est rangé ici) |

Exclusions volontaires, sans issue : tout le cimetière du PRD (eject, IA in-app, autres PSP, facturation à l'usage, temps réel, multi-ORM, journal d'audit, clés API, secondes implémentations d'adapters), pas d'annulation de suppression de compte (ADR 074), `/cookies` hors sitemap, pas de `loading.tsx` sur les écrans qui refusent (s29), régime `simulated` hors CI (s25). Environ 50 constats de style, nommage ou méthode ont aussi été écartés.

---


---

## Annexe C — Branches en cours (détail)

### 1. `experiment/back-office` — tip `03abe3d` (local seulement)

#### Objet
Session du 09–10/09 (avant s60) : donner au back-office superadmin sa propre surface (châssis, groupes de routes), un tableau de bord sur `/admin` avec métriques et séries temporelles, et clarifier le vocabulaire inscriptions / abonnements. Pas de story `s<id>` associée, pas de plan, pas de revue, pas de `docs/verif` : branche d'expérimentation hors pipeline.

Merge-base : `ba232d6` (2026-09-09). 108 fichiers, +3441 / −507.

#### Les 8 commits

| # | SHA | Résumé | État vs dev actuel |
|---|---|---|---|
| 1 | `8672105` | **refactor(web)** : range les écrans dans deux groupes de routes `(app)` et `(admin)` ; corrige sept mesures qui dérivaient une URL d'un nom de dossier (préambule e2e, sitemap, segments réservés d'organisation, balayage des écrans). Ajoute `CONTEXT.md` (glossaire : superadmin vs membre, organisation, surfaces). | **Dépassé** : s60 (`2f11ae9`) a fait le découpage final en quatre zones `(site)/(auth)/(app)/(console)` (ADR 071), avec les mêmes corrections de dérivation. Le glossaire reste une idée utile — dev a un `GLOSSARY.md` non suivi en cours d'écriture (autre angle : publics propriétaire/client). |
| 2 | `d600e5e` | **feat(admin)** : châssis propre au back-office (barre latérale dérivée de la surface `admin`, badge « Admin », retour à l'app, pas de bandeau de consentement ni de scripts tiers) ; la coquille est rendue **par l'écran**, jamais par une layout de groupe, pour qu'un 404 ne trahisse pas la surface. | **Dépassé et contredit** : s60 a choisi l'inverse — `app/(console)/layout.tsx` porte la garde et `console-shell.tsx`, et la console **rend** la bannière de consentement (critère s60). ADR 070 (console) + ADR 072 (404 par zone) tranchent. |
| 3 | `bbab86f` | **refactor(admin)** : `/admin/subscriptions` → `/admin/signups` (308 depuis l'ancien), messages marketing renommés : un « abonnement » est un contrat payant, une « inscription » un email capturé. Types `AdminSubscription*` laissés en l'état (résidu noté). | **Toujours pertinent sur le fond** : sur dev, l'écran s'appelle « Inscriptions » mais vit sous `/console/subscriptions`, constante `ADMIN_SUBSCRIPTIONS_SCREEN_PATH`, tuile `subscriptions`. La forme 308 doit maintenant passer par `lib/legacy-paths.ts` (ADR 075/077), pas par une redirection de page — ou 404 sans redirection, logique de l'ADR 070 pour une zone cachée. |
| 4 | `8fca9d1` | **feat(ui)** : `BarChart` dans `packages/ui/src/composed/bar-chart.tsx` — SVG calculé côté serveur, sans bibliothèque ni hydratation, une seule série, valeurs dans un `<table>` sous `<details>` (accessible sans script). Entrée ajoutée à `docs/design-system.md`. | **Unique, absent de dev** (aucun graphe dans `packages/ui`). Réutilisable tel quel à peu de chose près. |
| 5 | `7848193` | **feat(admin)** : tableau de bord sur `/admin` — connexions 24 h, comptes, organisations, inscriptions, achats encaissés, revenu récurrent, **trois séries sur 30 jours**, derniers mouvements. Nouveau port `AdminMetricsPort` fourni par le point de composition ; chaque bloc distingue `absent` (module non monté) de `unavailable` (lecture en échec). Lectures SQL `drizzle-auth-metrics.ts`, `drizzle-billing-metrics.ts`, `drizzle-signup-metrics.ts`, décompte d'organisations dans `scoped-reads.ts`. Écrit honnêtement ce qui n'est pas mesurable (pas de DAU, `billing_subscription` sans date de création, fenêtres glissantes). | **Partiellement couvert** : s60 a livré `/console` avec 4 tuiles de **comptes** (comptes, organisations, revenu récurrent, inscriptions), une tuile `error` sur lecture en échec et une tuile absente quand le module est coupé (`apps/web/lib/console.ts`). **Restent uniques** : les séries 30 jours, les connexions 24 h, les achats encaissés, les derniers mouvements, et les trois lecteurs SQL de métriques. |
| 6 | `1ee530e` | **fix(web)** : sépare les deux montages de la page introuvable (`(app)/not-found.tsx` sans coquille, `app/not-found.tsx` avec), après deux coquilles imbriquées vues par `pnpm test:socle`. | **Dépassé** : même problème résolu par s66 (`2ff47ae`, ADR 072) avec `not-found-screen.tsx` partagé. |
| 7 | `72c678a` | **docs** : ADR 070 « la racine ne monte plus de coquille, chaque surface monte la sienne » et ADR 071 « un bloc de mesure dit lui-même pourquoi il est absent » ; règles dans `packages/modules/admin/AGENTS.md`, dont ce que le tableau de bord n'affiche pas et pourquoi. | **Numéros en collision** : dev a déjà ADR 070 (console) et 071 (zones). Le 1er ADR est dépassé ; le 2nd (absent vs unavailable) reste une décision valable à reprendre sous un nouveau numéro (`ks.mjs next-adr`) si les métriques sont reprises. |
| 8 | `03abe3d` | **fix(admin)** : ligne de base du graphe ; « Aucun abonnement en cours » rendu comme une phrase et non dans le corps d'un gros chiffre. | Suit le sort du commit 4/5. |

#### Ce qui s'applique encore à dev, dans l'esprit
- **Conserver** : `BarChart` (commit 4 + 8), les séries temporelles et lecteurs de métriques (commit 5), la règle « absent ≠ indisponible » (ADR du commit 7, déjà partiellement incarnée par la tuile `error` de s60), le renommage inscriptions/abonnements (commit 3).
- **Abandonner** : groupes de routes `(app)/(admin)`, châssis rendu par l'écran, double `not-found`, ADR 070 — tout cela est remplacé par s60/s61/s66 et contredit parfois les décisions prises depuis (console sous `/console`, garde dans le layout, consentement rendu).
- **Un rebase n'est pas réaliste** : 50 commits de retard, l'arborescence `apps/web/app` a été déplacée deux fois (s60, s63). Reprendre en copiant les fichiers ciblés (`packages/ui/src/composed/bar-chart.tsx`, les trois `drizzle-*-metrics.ts`, `AdminMetricsPort`) dans une nouvelle story.

#### Recommandation keep / drop
**Drop la branche comme base de travail, keep comme référence** : pousser `experiment/back-office` sur origin (ou noter le SHA dans l'issue), puis supprimer le worktree. Créer deux issues ci-dessous. Note méthode : les métriques sont une **capacité nouvelle**, donc selon `AGENTS.md` elles relèvent d'une story dans `docs/stories.md` (ex. « s69-console-metriques ») plutôt que d'une issue — l'issue sert de pointeur jusqu'à ce que la story soit écrite.

#### Brouillon d'issue A — enhancement

**Titre** : Ajouter des séries temporelles et un histogramme au tableau de bord de la console

**Corps** :
> **Problème**
> Le tableau de bord `/console` (s60) affiche quatre totaux (comptes, organisations, revenu récurrent estimé, inscriptions publiques). Il ne montre aucune évolution dans le temps, ni les connexions récentes, ni les achats encaissés, ni les derniers mouvements. Le design system n'a aucun composant de graphe.
>
> **Ce qui existe sur la branche**
> Branche `experiment/back-office` (locale, tip `03abe3dc0bca1d5c745f513da8222e1b7e4b2c1d`), antérieure à s60 :
> - `packages/ui/src/composed/bar-chart.tsx` + entrée dans `docs/design-system.md` (commits `8fca9d1`, `03abe3d`) : histogramme SVG rendu côté serveur, sans hydratation, valeurs lisibles dans un `<table>` sous `<details>`.
> - `AdminMetricsPort` dans `packages/modules/admin/src/application/ports.ts` et lecteurs SQL `drizzle-auth-metrics.ts`, `drizzle-billing-metrics.ts`, `drizzle-signup-metrics.ts`, plus un décompte dans `organizations/src/infrastructure/scoped-reads.ts` (commit `7848193`) : connexions 24 h, achats encaissés, trois séries sur 30 jours, derniers mouvements, avec SQL mesuré contre PostgreSQL.
> - Une décision rédigée (ADR « un bloc de mesure dit lui-même pourquoi il est absent », commit `72c678a`) : `absent` (module non monté) vs `unavailable` (lecture en échec).
> - Limites assumées : pas de « DAU » (aucune trace d'activité), `billing_subscription` n'a pas de date de création, fenêtres glissantes.
>
> **Ce qui reste**
> - Écrire la story dans `docs/stories.md` puis passer par le pipeline (research contre dev actuel).
> - Reprendre les fichiers ciblés, pas la branche : la structure de routes `(admin)` et le châssis sont remplacés par `(console)` (s60, ADR 070/071/072).
> - Brancher les séries sur `apps/web/lib/console.ts` / `app/(console)/console/page.tsx` en respectant la tuile qui disparaît avec son module.
> - Renuméroter l'ADR (collision avec 070/071 de dev) via `ks.mjs next-adr`.
> - Vérifier le profil minimal (`pnpm test:minimal-profile`) : modules `billing`/`organizations`/`marketing` coupés.
>
> **Pointeurs** : branche `experiment/back-office` @ `03abe3d` ; commits `8fca9d1`, `7848193`, `72c678a`, `03abe3d`.

**Catégorie** : enhancement

#### Brouillon d'issue B — enhancement (vocabulaire, petit)

**Titre** : Servir l'écran des inscriptions publiques sous une adresse qui ne dit pas « abonnements »

**Corps** :
> **Problème**
> L'écran de la console qui liste les inscriptions publiques (adresses capturées par newsletter/waitlist, sans compte ni paiement) est titré « Inscriptions » mais vit sous `/console/subscriptions`, avec `ADMIN_SUBSCRIPTIONS_SCREEN_PATH` et une tuile `subscriptions`. Dans ce dépôt, « abonnement » désigne un contrat récurrent payant (`billing_subscription`). Le même mot désigne donc deux choses dans la console, à côté de l'écran de revenus.
>
> **Ce qui existe sur la branche**
> Commit `bbab86f` sur `experiment/back-office` (local, tip `03abe3d`) : renommage en `/admin/signups`, 308 depuis l'ancienne adresse, messages marketing renommés ; types `AdminSubscription*` volontairement laissés.
>
> **Ce qui reste**
> - Décider l'ancien chemin : 404 sans redirection (logique de l'ADR 070 pour une zone cachée) ou ligne dans `lib/legacy-paths.ts` (ADR 075/077) — pas de redirection écrite dans une page.
> - Renommer chemin, constante et clé de tuile ; garder ou non les types `AdminSubscription*` (le commit les laissait pour ne pas les confondre avec les abonnements payants).
> - Changement d'URL d'un écran : selon `AGENTS.md`, passe par le pipeline (track flow probable).
>
> **Pointeurs** : `experiment/back-office` @ `bbab86f`.

**Catégorie** : enhancement

(Option : le glossaire `CONTEXT.md` du commit `8672105` peut nourrir le `GLOSSARY.md` en cours sur dev — à signaler au propriétaire, pas d'issue.)

---

### 2. `feature/s43-feedback-widget` — tip `16e5556` (sur origin)

#### Objet
Story **s43-feedback-widget** (`docs/stories.md` l. 1333) : envoyer un retour depuis l'application, catégorie bug/idée/autre ; persisté avec auteur, organisation, URL d'origine ; notification aux superadmins (centre de notifications ou email) ; consultable et filtrable dans le back-office ; marquable « traité » ; module coupé = aucune trace. Complexité 2 (relevée à 3 par la research). Story **OPTIONNELLE, reportée le 05/09** par le porteur.
Research sur dev : `docs/research/s43-feedback-widget.md`. Plan sur la branche : `docs/plans/s43-feedback-widget.md` (`validated: yes`, base `6dda2e3`).

#### Décision du plan
Pas de panneau flottant (la CSP interdit `style` inline, `Dialog`/`Popover` absents du design system, et la bannière de consentement a déjà intercepté les clics de dix parcours) : un **lien** dans la coquille vers un formulaire sur sa propre page.

#### Ce qui est fait (commit unique `wip(s43): travail interrompu à la mise en pause`)
54 fichiers, +4168 / −27 :
- module `packages/modules/feedback` complet en quatre couches : schéma + migration `0000_dear_wallow.sql` (table `feedback` : auteur, organisation, catégorie, message, `origin_path`, statut, `handled_at`, 4 index), domaine + `feedback.test.ts`, cas d'usage, ports, repo Drizzle, routes (`submit` avec `rateLimit: { policy: 'feedback' }`, `handle`, lecture admin), formulaire, messages fr/en, `AGENTS.md` ; `requires: ['auth', 'admin']` ;
- `config/features.ts` (activé), `config/profiles.ts` (coupé dans le profil minimal), `config/security.ts` (politique de débit `feedback`), `config/notifications.ts` (type `feedback.received`, email par défaut, sans texte du retour dans la charge) ;
- écrans `apps/web/app/feedback/page.tsx` et `apps/web/app/admin/feedback/page.tsx`, câblage `lib/feedback.ts`, `lib/admin.ts`, `lib/module-services.ts` ;
- extensions du module admin (ports, cas d'usage, écran de liste filtrable) ;
- `tests/feedback.test.ts` (716 lignes), compléments à `tests/admin.test.ts`, `tests/rendered-text.test.ts`, `tests/account-deletion.test.ts`.

#### Ce qui n'est pas fait
- Aucune case du plan cochée ; arrêté « avant les mutations » : aucune preuve de neutralisation (tâches 2, 3, 4 l'exigent).
- Pas de `docs/verif/s43-feedback-widget.md`, pas de revue, pas de gate.
- Rien ne dit que la suite passe sur ce commit.

#### S'applique-t-il encore à dev ?
**Dans l'esprit oui, en l'état non.** 52 commits de retard, et l'arborescence a bougé sous lui :
- `apps/web/app/admin/feedback` → doit devenir `app/(console)/console/feedback` (s60, surface `console`, garde dans le layout) ;
- `apps/web/app/feedback` → tout écran applicatif doit être sous `/app` dans `(app)` (s63 ; `tests/zones.test.ts` refuse le reste) ;
- navigation : surface `app` ou `settings` (s62a), plus de lien dans la barre latérale du back-office via `admin` ;
- `config/features.ts`, `profiles.ts`, `security.ts`, `generated/schema`, `pnpm-lock.yaml` (chemins exclusifs) ont tous bougé ; le numéro d'ADR éventuel doit venir de `ks.mjs next-adr`.
Le module lui-même (domaine, schéma, routes, tests de domaine) devrait se transposer quasi tel quel. La research et le plan doivent être revérifiés contre dev (plan `base: 6dda2e3`).

#### Brouillon d'issue — enhancement

**Titre** : Reprendre s43-feedback-widget depuis sa branche interrompue

**Corps** :
> **Problème**
> La story s43 (retour depuis l'application, reportée le 05/09) a une implémentation interrompue sur une branche qui a 52 commits de retard. Son worktree va être supprimé ; ce ticket garde le pointeur.
>
> **Ce qui existe sur la branche**
> `feature/s43-feedback-widget` @ `16e5556508d2c06a426e85835a37ab2b791b7f02` (poussée sur origin) :
> - plan validé `docs/plans/s43-feedback-widget.md` (déclencheur = lien dans la coquille + page de formulaire, pas de panneau flottant) ; research déjà sur dev ;
> - module `packages/modules/feedback` (schéma, migration, domaine testé, routes avec limitation de débit déclarée, formulaire, messages) ;
> - type de notification `feedback.received`, politique de débit `feedback`, module coupé dans le profil minimal ;
> - écrans `/feedback` et `/admin/feedback`, extensions du module admin, `tests/feedback.test.ts` (716 lignes).
>
> **Ce qui reste**
> - Revérifier research et plan contre dev actuel (`base: 6dda2e3` périmé).
> - Déplacer les écrans : `/admin/feedback` → `/console/feedback` sous `(console)` ; `/feedback` → sous `/app` dans `(app)` (s60, s63).
> - Rebrancher la navigation sur les surfaces actuelles (`app`/`settings`, `console`).
> - Les 7 tâches du plan, avec les mutations exigées (URL d'origine échappée, débit déclaré, repli email sans centre de notifications).
> - `docs/verif`, revue, ship.
>
> **Pointeurs** : branche `feature/s43-feedback-widget` @ `16e5556` ; `docs/stories.md` § s43 ; `docs/research/s43-feedback-widget.md`.

**Catégorie** : enhancement
(Note méthode : s43 est déjà une story de `docs/stories.md` ; l'issue ne fait que tracer la branche. Ne pas la doubler d'une entrée de story.)

---

### 3. `feature/s44-public-roadmap` — tip `007d8a1` (sur origin)

#### Objet
Story **s44-public-roadmap** (`docs/stories.md` l. 1358) : page publique de propositions par statut (proposé, prévu, en cours, livré), vote d'un utilisateur connecté (un par proposition, retirable), lecture seule pour l'anonyme, modération superadmin (statut, masquage sans perte des votes), limitation de débit, module coupé = pas de page ni de lien de pied de page. Complexité 3. **OPTIONNELLE, reportée le 05/09.** Fusion de propositions explicitement hors périmètre.

#### Ce qui est fait
Un seul fichier : `docs/plans/s44-public-roadmap.md` (`validated: yes`, base `6dda2e3`, +47 lignes). Research déjà sur dev (`docs/research/s44-public-roadmap.md`).
Points clés du plan : unicité `(proposition, votant)` portée par un index ; compteur dérivé, jamais stocké ; masquage = drapeau ; proposer exige un compte **vérifié** ; entrée de pied de page dérivée du registre ; un vote d'un compte supprimé est effacé par la purge.

#### Ce qui n'est pas fait
Toute l'implémentation (8 tâches, aucune commencée).

#### S'applique-t-il encore à dev ?
Oui sur le fond. À revérifier : zone `(site)` pour la page publique (s61), console `(console)` pour la modération (s60), surface `footer` / `site` pour le lien (ADR 073), routes sous `/console`, base du plan périmée.

#### Brouillon d'issue — enhancement

**Titre** : Reprendre s44-public-roadmap à partir de son plan validé

**Corps** :
> **Problème**
> La story s44 (roadmap publique avec votes, reportée le 05/09) n'a qu'un plan, sur une branche dont le worktree va être supprimé.
>
> **Ce qui existe sur la branche**
> `feature/s44-public-roadmap` @ `007d8a1e6f38f22413b3962185e3fa3cddcbc242` (poussée sur origin) : `docs/plans/s44-public-roadmap.md`, `validated: yes`, basé sur `6dda2e3`. Research sur dev. Aucun code.
>
> **Ce qui reste**
> - Revérifier research et plan contre dev actuel : page publique dans `(site)` (s61), modération dans `(console)` sous `/console` (s60), lien de pied de page dérivé du registre.
> - Les 8 tâches du plan (module + 2 tables, statuts fermés, vote unique par index, compteur dérivé, page publique lecture seule, compte vérifié + débit pour proposer, modération 404-et-non-403, module coupé).
> - `docs/verif`, revue, ship.
>
> **Pointeurs** : branche `feature/s44-public-roadmap` @ `007d8a1` ; `docs/stories.md` § s44 ; `docs/research/s44-public-roadmap.md`.

**Catégorie** : enhancement
(Même note méthode que s43.)

---

### 4. `.worktrees/demo` — HEAD détaché sur `c9cebf3`

- `c9cebf3` = « feat(seed): sème des données de démonstration… (#43) », la livraison de s58, **déjà dans dev** (0 commit propre, 59 de retard).
- Arbre propre. Seule particularité locale : son `.env` pointe sur une base dédiée (`POSTGRES_PORT=5445`, base `demo`) et n'a pas `SUPERADMIN_EMAIL`. Il servait vraisemblablement d'instance de démonstration seedée.
- **Aucun travail à sauver, aucune issue.** Avant suppression, éventuellement arrêter/supprimer le conteneur ou volume Postgres sur 5445 s'il existe encore.

### 5. Branches locales `fix/e2e-ci-parity` et `fix/e2e-click-until`

- `fix/e2e-ci-parity` @ `6d81b63` (02/09) : compile les routes avant les parcours (préambule `e2e/support/warm-up.ts`). `git cherry` = `-` : le patch identique est dans dev. **Supprimable.**
- `fix/e2e-click-until` @ `8c83171` (02/09) : remplace `clickUntil` par `clickOnce` (attend l'hydratation, clique une fois). Patch non identique, mais le même correctif est dans dev (`90ff7d3`, puis s50/s52) : `clickOnce` est utilisé partout dans `e2e/`. **Supprimable.**
- Aucune issue.

### 6. `origin/feature/s59-premier-deploiement` @ `2b2e030` (pas de worktree)

- 1 commit, 10/10, à jour avec dev (0 de retard) : `docs/research/s59-premier-deploiement.md` (127 lignes), vérifiée contre `9f36ea9`.
- Story s59 (premier déploiement réel, 6 critères en recette manuelle). Research : la config livrée ne démarre pas en production avec des variables seules (`storage`/PostHog exigent une édition de `config/security.ts`), symbolisation des erreurs serveur Sentry probablement cassée (chemin disque brut envoyé), compose sans proxy qui écrase `x-forwarded-for`.
- **Travail actif, pas concerné par le nettoyage.** Pas d'issue (c'est une story en cours). Les deux défauts probables relevés (Sentry, `x-forwarded-for`) pourraient devenir des issues **bug** si la recette les confirme — à laisser à la story.

### 7. Branches `origin/dependabot/*`

- PR ouvertes (7) : #76 (next 16.3.8, groupe npm_and_yarn), #50 (node 25-alpine), #49 (lucide 1.43), #48 (playwright 1.63), #47 (globals), #46 (typescript-eslint 8.70), #17 (typescript 7.0.2).
- Branches restantes de PR déjà fermées ou mergées (8), supprimables côté remote : `docker/node-26-alpine` (#15 fermée), `aws-sdk/client-s3-3.1124.0` (#19), `aws-sdk/s3-request-presigner-3.1124.0` (#16), `lucide-react-1.39.0` (#24), `next-16.3.4` (#20), `next/eslint-plugin-next-16.3.4` (#25), `simplewebauthn/browser-14.0.0` (#18), `types/node-26.4.1` (#26).
- Aucune issue.

