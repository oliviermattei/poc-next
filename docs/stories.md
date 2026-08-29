# User Stories — killer-boilerplate

> Une story = une tranche livrable, écrite pour être exécutée par un agent.
> Id : `s<numéro>-<slug>` — repris dans chaque fichier du pipeline et dans le nom de branche.

**Personas.** `Dev` = le développeur qui démarre un projet depuis le boilerplate (l'utilisateur principal du PRD). `User` = l'utilisateur final du SaaS généré. `Admin` = le superadmin du SaaS généré. `Visiteur` = visiteur non authentifié du site marketing.

**Ordre.** Les stories sont classées par dépendance. Le champ `Dependencies` liste les dépendances **réelles**, pas l'ordre de lecture : deux stories sans dépendance commune peuvent être menées en parallèle.

**Sémantique des tables d'un module désactivé.** Un module **jamais activé** n'a jamais joué ses migrations : ses tables n'existent pas. Un module **activé puis désactivé** conserve ses tables et ses données : les supprimer serait une migration destructive, c'est-à-dire `eject`, explicitement au cimetière du PRD. Le toggle est réversible sans perte de données. Aucune commande de nettoyage n'existe et aucune story ne doit en introduire.

**Règle transverse : tout module désactivable porte son critère « module non activé ».** Une story qui livre un module optionnel décrit ce que devient l'application sans lui — routes, navigation, tables sur base vierge, et comportement de repli des fonctionnalités qui l'interrogeaient. Aucune story ultérieure ne peut s'appuyer sur une sémantique de désactivation qu'une story antérieure n'a pas définie.

**Vérification des intégrations tierces.** Deux régimes, jamais mélangés :
- **En CI** : implémentation d'enregistrement (requêtes capturées et assertées) pour les envois sortants, et **rejeu d'événements webhook enregistrés** pour les entrants (Stripe, Inngest). Ces tests sont bloquants.
- **Hors CI**, sur commande explicite et clés de test du service (Resend, Stripe, Inngest, PostHog) : les tests d'intégration réelle, activés par variable d'environnement. Non bloquants en CI, exécutés avant chaque ship.
Un critère explicitement marqué « recette manuelle » se vérifie à la main, avec une trace consignée dans la revue de la story.

---

## Story s01-boot-blank-app — Démarrer une application vide qui tourne
**As a** Dev **I want** cloner le dépôt et obtenir une application qui démarre, connectée à Postgres **so that** je puisse construire dessus sans plomberie préalable.

### Complexity
3

### Acceptance criteria
- [ ] `pnpm install && pnpm dev` démarre l'application Next.js sans erreur, sur un dépôt fraîchement cloné
- [ ] Une variable d'environnement manquante ou malformée fait échouer le démarrage avec un message nommant la variable fautive (validation Zod)
- [ ] `.env.example` liste toutes les variables lues par le schéma de validation ; un test échoue si une variable du schéma en est absente
- [ ] `pnpm db:migrate` applique les migrations Drizzle sur une base Postgres vide et est idempotent au second lancement
- [ ] `pnpm db:seed` peuple la base de développement avec un jeu de données minimal et est rejouable sans erreur
- [ ] `docker compose up` fournit une base Postgres locale utilisable par l'application, sans installation Postgres sur la machine
- [ ] Une route `/api/health` répond 200 avec l'état de la connexion base de données

### Dependencies
Aucune — première story.

### Agentic notes
Squelette du projet : Next.js App Router, TypeScript strict, Drizzle ORM, PostgreSQL, Docker Compose. Le harnais de qualité et la CI sont livrés séparément en s02 (découpage recommandé par la revue, finding F26).
Contrainte PRD : aucune donnée ni convention personnelle en dur, toute configuration par `.env` ou `config/`.
Référence : ShipSaaS revendique une architecture en trois couches (présentation / services / persistance) — poser cette séparation dès maintenant, elle conditionne la modularité de s03.
Piège : les migrations Drizzle doivent être versionnées en fichiers SQL (`drizzle-kit generate`), jamais appliquées par `push` en production.

---

## Story s02-quality-harness — Vérifier la qualité du code en une commande
**As a** Dev **I want** un harnais de qualité et une CI qui tourne dès le premier commit **so that** aucune régression ne passe et mes agents de code connaissent les règles du dépôt.

### Complexity
2

### Acceptance criteria
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` et `pnpm test:e2e` s'exécutent et passent sur le dépôt vide
- [ ] `pnpm lint` échoue sur une violation introduite volontairement et la commande de correction automatique la répare
- [ ] Un test unitaire et un test end-to-end de démonstration existent et échouent si l'application ne démarre pas
- [ ] Un fichier de conventions pour agents de code (`AGENTS.md` du template généré) décrit l'architecture en couches, les règles de module et les commandes ; un test vérifie sa présence et ses sections obligatoires
- [ ] Le workflow GitHub Actions exécute typecheck, lint, tests unitaires et end-to-end sur chaque push, et échoue si l'un d'eux échoue
- [ ] Le workflow démarre une base Postgres de test et joue les migrations avant les tests

### Dependencies
s01-boot-blank-app

### Agentic notes
Découpée de s01 sur recommandation de la revue (F26) : dix critères dans une seule story dépassaient la taille tenable.
Référence : ShipSaaS met en avant ses « 50+ conventions » pour cadrer les agents de code, MakerKit ses « règles LLM pré-configurées pour Cursor, Claude Code et Windsurf ». C'est de la parité, pas un angle.
Cette story conditionne s03 : la preuve de modularité s'exprime par « la suite de tests passe module activé, puis non activé ».

---

## Story s03-module-registry — Activer et désactiver un module par configuration
**As a** Dev **I want** déclarer les modules de mon projet dans une configuration typée **so that** un module non activé ne laisse ni route, ni navigation, ni table dans mon application.

### Complexity
4

### Acceptance criteria
- [ ] Un module se déclare via un contrat typé exposant : identifiant, schéma Drizzle, routes, entrées de navigation, traductions, handlers de webhooks, **fonction de purge** (données d'un utilisateur ou d'une organisation) et **fonction d'export** (mêmes périmètres)
- [ ] `config/features.ts` liste les modules activés ; la configuration est typée et un identifiant inconnu provoque une erreur de compilation
- [ ] Un module non activé n'expose aucune route : l'accès à une de ses URL renvoie 404
- [ ] Un module non activé n'apparaît dans aucune entrée de navigation
- [ ] Les migrations d'un module non activé ne sont pas appliquées : ses tables sont absentes de la base après `pnpm db:migrate` sur une base vierge
- [ ] Les fonctions de purge et d'export d'un module non activé ne sont pas appelées et leur absence ne provoque aucune erreur
- [ ] Deux modules de démonstration, l'un activé et l'autre non, prouvent chacun des comportements ci-dessus dans les tests
- [ ] La suite de tests passe intégralement avec le module de démonstration activé, puis non activé

### Dependencies
s02-quality-harness

### Agentic notes
**Story la plus structurante du projet — risque maximal.** C'est l'angle n°1 du PRD. Si le contrat de module est mal posé ici, chaque story suivante devra être reprise.
Le contrat inclut `purge` et `export` **dès maintenant**, avec une implémentation vide pour les modules sans données : les ajouter en s31 et s32 obligerait à rouvrir la vingtaine de modules écrits entre-temps.
Référence : MakerKit se contente de 13 booléens d'environnement (`NEXT_PUBLIC_ENABLE_TEAM_ACCOUNTS`, `NEXT_PUBLIC_ENABLE_TEAM_ACCOUNTS_BILLING`…) qui masquent l'UI mais laissent les tables `organizations`, `members` et `invitations` en base. Supastarter utilise des fichiers `config.ts` par application. **Aucun des deux ne retire quoi que ce soit** — c'est précisément ce que cette story doit faire.
Le critère sur les tables porte sur une base vierge : un module activé puis désactivé conserve ses tables (voir la sémantique en tête de fichier).
Piège : la composition du schéma Drizzle. Les migrations doivent être générées par module et assemblées selon la configuration, pas dans un schéma monolithique.

---

## Story s04-cli-toggle-module — Activer un module en une commande
**As a** Dev **I want** activer ou désactiver un module par une commande **so that** je n'aie ni à éditer la configuration à la main ni à me souvenir des migrations à jouer.

### Complexity
3

### Acceptance criteria
- [ ] `npx ks list` affiche les modules disponibles et leur état (activé / désactivé)
- [ ] `npx ks toggle <module>` inverse l'état du module dans `config/features.ts` en préservant le formatage et les commentaires du fichier
- [ ] L'activation d'un module génère et propose d'appliquer ses migrations
- [ ] La désactivation informe que les tables et les données du module sont conservées et qu'une réactivation les retrouvera ; elle ne supprime ni table ni donnée
- [ ] Un module activé, désactivé, puis réactivé retrouve ses données intactes
- [ ] Un identifiant de module inconnu affiche la liste des modules valides et sort en code d'erreur non nul
- [ ] Un toggle suivi du toggle inverse laisse `config/features.ts` identique à son état initial
- [ ] Les commandes sont couvertes par des tests exécutés sur un dépôt temporaire

### Dependencies
s03-module-registry

### Agentic notes
Angle n°2 du PRD : la réversibilité à tout moment, contrairement aux générateurs de scaffolding à la create-t3-app qui décident une fois pour toutes.
**La réversibilité impose la conservation des données.** Supprimer les tables d'un module désactivé est une migration destructive, c'est-à-dire `eject` — explicitement au **cimetière** du PRD. Ne pas l'implémenter, ne pas l'amorcer, et ne mentionner aucune « commande de nettoyage » : elle n'existe pas.
Piège : éditer `config/features.ts` sans casser le formatage ni les commentaires. Préférer une manipulation d'AST (ts-morph) à une réécriture par expression régulière.

---

## Story s05-transactional-emails — Envoyer un email transactionnel
**As a** Dev **I want** envoyer un email transactionnel depuis une interface unique **so that** je puisse brancher n'importe quel provider sans toucher au code métier.

### Complexity
3

### Acceptance criteria
- [ ] Une interface `Mailer` typée expose l'envoi d'un email (destinataire, sujet, template, données) et est la seule surface appelée par le code métier
- [ ] En CI, une doublure d'enregistrement capture les envois et le test asserte destinataire, template et données
- [ ] Hors CI, sur commande explicite, un test contre la clé de test Resend vérifie l'envoi réel
- [ ] En développement, sans clé d'API, l'email est capturé et consultable localement au lieu d'être envoyé
- [ ] Un template React Email de démonstration est rendu avec ses données et couvert par un test de rendu
- [ ] Un échec du provider est journalisé et remonté à l'appelant sans faire tomber la requête
- [ ] La documentation décrit la configuration DNS de délivrabilité (SPF, DKIM, DMARC)

### Dependencies
s03-module-registry

### Agentic notes
Placée avant l'authentification : la vérification d'email, le magic link et la réinitialisation de mot de passe en dépendent tous. Elle ne livre pas d'email reçu par un utilisateur réel — le premier arrive en s06. C'est la story la plus proche d'une couche technique du lot, assumée pour éviter que s06 porte à la fois l'authentification et l'adapter mail.
**Une seule implémentation de provider est livrée : Resend.** La doublure d'enregistrement et la capture locale sont des outils de test, pas des providers : elles ne rendent pas légitime l'ajout d'un adapter SMTP ou SendGrid, qui reste au cimetière (finding F24 de la revue).
Référence : MakerKit expose une abstraction `@kit/mailers` (Resend, Nodemailer, SendGrid) ; Supastarter documente Resend, Postmark et Nodemailer ; ShipFast appelle Resend directement.
Piège : le mailer de test doit être injecté, jamais conditionné par `NODE_ENV`.

---

## Story s06-signup-signin — Créer un compte et se connecter
**As a** User **I want** créer un compte et me connecter **so that** j'accède à la partie protégée de l'application.

### Complexity
3

### Acceptance criteria
- [ ] Une inscription avec email et mot de passe valides crée le compte et envoie un email de vérification
- [ ] Un compte non vérifié ne peut pas accéder aux routes protégées et voit un message l'invitant à vérifier son email
- [ ] Le clic sur le lien de vérification marque le compte comme vérifié ; un lien expiré ou déjà consommé affiche une erreur explicite sans vérifier le compte
- [ ] Une connexion par magic link envoie un lien à usage unique qui ouvre une session
- [ ] Un mot de passe invalide ou un email inconnu affiche le même message d'erreur générique, sans révéler l'existence du compte
- [ ] Le parcours « mot de passe oublié » envoie un lien de réinitialisation ; le lien consommé invalide les autres liens en cours
- [ ] La déconnexion révoque la session ; une requête ultérieure avec l'ancien cookie est refusée
- [ ] Une route protégée accédée sans session redirige vers la connexion, puis revient à l'URL demandée après authentification

### Dependencies
s05-transactional-emails

### Agentic notes
Better Auth est la solution pressentie par le PRD (à confirmer en phase Research) : password, magic link, vérification, réinitialisation et sessions nativement.
Le module `auth` est le premier module réel : il doit respecter le contrat de s03 (schéma, routes, nav, traductions, emails, purge, export). Il n'est pas désactivable — c'est le seul module obligatoire du socle, à écrire explicitement dans `config/features.ts`.
Piège : longueur minimale de mot de passe et durées de validité des liens sont de la configuration, pas des constantes en dur.
Piège de sécurité : ne jamais différencier les messages d'erreur entre « email inconnu » et « mot de passe faux » (énumération de comptes).

---

## Story s07-app-shell — Naviguer dans l'application connectée
**As a** User **I want** un tableau de bord avec navigation, thème et paramètres de compte **so that** je circule dans l'application et gère mon profil.

### Complexity
3

### Acceptance criteria
- [ ] Une fois connecté, l'utilisateur atteint un tableau de bord avec navigation latérale et menu de compte
- [ ] La navigation est construite depuis les modules activés : désactiver un module retire son entrée sans modifier le composant de navigation
- [ ] Le thème clair / sombre est commutable et persiste entre deux sessions
- [ ] La page de paramètres du compte permet de modifier le nom et l'email ; un changement d'email exige une revérification avant d'être effectif
- [ ] Le changement de mot de passe exige le mot de passe courant et révoque les autres sessions actives
- [ ] La liste des sessions actives est affichée et chacune peut être révoquée individuellement
- [ ] L'interface est utilisable en dessous de 400 px de large sans débordement horizontal

### Dependencies
s06-signup-signin

### Agentic notes
**Écart assumé avec l'ordre du PRD** (« auth → multi-tenant → billing → app shell ») : le shell est livré avant le multi-tenant parce que c'est lui qui prouve que la navigation se construit depuis le registre de modules (s03). Livrer les organisations avant le shell reviendrait à écrire une navigation en dur puis à la réécrire.
La page de paramètres du compte livrée ici est le point d'accroche de s09 (fournisseurs OAuth liés), s10 (double authentification) et s11 (passkeys).
Référence : layout de tableau de bord de MakerKit et de Supastarter — shadcn/ui, Tailwind, thème commutable.
L'avatar est traité en s15 (il dépend du module storage) : ici, initiales ou placeholder.

---

## Story s08-i18n — Utiliser l'application dans sa langue
**As a** User **I want** afficher l'application et recevoir mes emails dans ma langue **so that** je l'utilise sans barrière linguistique.

### Complexity
4

### Acceptance criteria
- [ ] Deux locales sont livrées (français, anglais) ; module activé, les routes sont préfixées par la locale
- [ ] Un sélecteur de langue change la locale et persiste le choix entre deux sessions
- [ ] Aucune chaîne visible n'est écrite en dur : un test échoue si un texte affiché ne provient pas des fichiers de traduction
- [ ] Chaque module apporte ses propres traductions ; désactiver un module retire ses clés sans casser le chargement des autres
- [ ] Les emails transactionnels existants sont envoyés dans la langue de l'utilisateur destinataire
- [ ] Une clé manquante dans une locale est détectée par un test, et non silencieusement remplacée en production
- [ ] Les écrans déjà livrés (authentification, tableau de bord, paramètres) sont entièrement traduits
- [ ] **Module non activé** : les routes sont servies sans préfixe de locale, l'application et les emails utilisent la langue par défaut configurée, aucun sélecteur de langue n'apparaît, et aucune redirection de locale n'a lieu
- [ ] La résolution des chaînes reste la même fonction dans les deux cas : un module écrit après s08 n'a pas à savoir si l'i18n est activée

### Dependencies
s07-app-shell, s05-transactional-emails

### Agentic notes
**Risque de complexité 4 : dette permanente.** Le PRD impose de poser l'i18n tôt, précisément pour éviter une reprise intégrale plus tard. À partir d'ici, toute story ajoute ses traductions — c'est une règle du contrat de module, à faire respecter en revue.
**Les deux derniers critères sont la partie critique** (finding F17 de la revue) : le critère de succès n°4 du PRD nomme l'i18n parmi les trois modules désactivés de la preuve de modularité (recette en s23). Décider après coup si les routes sont préfixées réécrirait chaque route livrée entre ici et s41. La forme d'URL et la fonction de traduction doivent être tranchées maintenant.
Référence : Supastarter découpe ses messages en `marketing`, `saas`, `mail` et `shared` avec quatre locales ; MakerKit expose un `NEXT_PUBLIC_LANGUAGE_PRIORITY`.
Piège : le rattrapage sur les écrans déjà livrés est borné aujourd'hui (authentification et shell) et ne le sera plus dans dix stories.

---

## Story s09-oauth-signin — Se connecter avec Google ou GitHub
**As a** User **I want** me connecter avec mon compte Google ou GitHub **so that** je n'aie pas de mot de passe supplémentaire à gérer.

### Complexity
2

### Acceptance criteria
- [ ] Les boutons Google et GitHub apparaissent sur les écrans d'inscription et de connexion lorsque leurs identifiants sont configurés, et sont masqués sinon
- [ ] Une première connexion OAuth crée le compte avec l'email vérifié par le fournisseur
- [ ] Une connexion OAuth avec un email déjà rattaché à un compte mot de passe lie le fournisseur au compte existant au lieu d'en créer un second
- [ ] Un refus d'autorisation côté fournisseur ramène à la connexion avec un message explicite, sans session ouverte
- [ ] Les fournisseurs liés sont visibles dans les paramètres du compte et peuvent être déliés, sauf s'il s'agit du dernier moyen de connexion

### Dependencies
s06-signup-signin, s07-app-shell (page de paramètres du compte)

### Agentic notes
Parité 4/4 : les quatre cibles proposent au minimum Google.
Piège : la liaison de comptes par email est la faille classique. Ne lier automatiquement que si le fournisseur atteste l'email comme vérifié.
Piège : ne jamais laisser un compte sans moyen de connexion après un déliement.

---

## Story s10-two-factor — Protéger son compte par double authentification
**As a** User **I want** activer une double authentification **so that** mon compte reste protégé si mon mot de passe fuite.

### Complexity
3

### Acceptance criteria
- [ ] L'activation affiche un QR code TOTP et exige un code valide pour être confirmée
- [ ] Une fois activée, la connexion exige le code TOTP après le mot de passe
- [ ] Dix codes de secours à usage unique sont générés à l'activation, affichés une seule fois, et chacun n'est utilisable qu'une fois
- [ ] Un code TOTP erroné ou rejoué est refusé
- [ ] La désactivation exige un code valide ou le mot de passe courant
- [ ] Les tentatives de vérification échouées sont limitées par un compteur par compte, verrouillant temporairement la vérification au-delà du seuil

### Dependencies
s07-app-shell

### Agentic notes
Better Auth fournit le plugin `two-factor`. Le coût est dans l'interface : activation, QR code, codes de secours, écran de vérification à la connexion.
Parité Supastarter et MakerKit.
**Articulation avec s25-rate-limiting** (finding F28 de la revue) : le compteur posé ici est un verrouillage par compte, local à la vérification 2FA. s25 énumère explicitement l'endpoint de vérification 2FA parmi ses points d'entrée limités et absorbe ce compteur dans le mécanisme commun. Ne pas dupliquer la logique : l'implémenteur de s25 remplace, il n'ajoute pas une seconde limite.
Piège : les codes de secours doivent être stockés hachés, jamais en clair.

---

## Story s11-passkeys — Se connecter sans mot de passe
**As a** User **I want** enregistrer une passkey **so that** je me connecte sans mot de passe depuis mes appareils.

### Complexity
3

### Acceptance criteria
- [ ] Depuis les paramètres, l'utilisateur enregistre une passkey ; elle apparaît dans une liste avec son nom et sa date de création
- [ ] Une passkey enregistrée permet de se connecter sans mot de passe
- [ ] Une passkey peut être renommée et révoquée ; une passkey révoquée ne permet plus la connexion
- [ ] Sur un navigateur ou un appareil incompatible WebAuthn, l'option est masquée et les autres moyens de connexion restent accessibles
- [ ] Un échec ou une annulation de l'enregistrement affiche un message clair sans créer d'entrée orpheline

### Dependencies
s07-app-shell (page de paramètres du compte)

### Agentic notes
Dépend du shell, pas de la double authentification : WebAuthn n'a aucun lien avec TOTP, les deux stories peuvent être menées en parallèle (finding F22 de la revue).
Better Auth fournit le plugin officiel `@better-auth/passkey` (SimpleWebAuthn) : `plugins: [passkey()]` côté serveur, `passkeyClient()` côté client, plus une migration ajoutant une table `passkey`. Le travail réel est l'interface de gestion et le repli.
Parité Supastarter et MakerKit.
Piège documenté par Better Auth : les erreurs d'enregistrement renvoient toujours un objet de données, l'option `throw: true` est sans effet. L'UI conditionnelle exige `autocomplete="webauthn"` sur le champ.

---

## Story s12-organizations — Travailler dans une organisation
**As a** User **I want** créer une organisation et basculer entre mes organisations **so that** mes données soient séparées par contexte de travail.

### Complexity
4

### Acceptance criteria
- [ ] Un utilisateur crée une organisation avec un nom et un slug ; le slug est unique et les slugs réservés (routes système) sont refusés
- [ ] Un sélecteur permet de basculer d'organisation ; l'organisation courante persiste entre deux sessions
- [ ] Toute donnée rattachée à une organisation n'est lisible que par ses membres : un accès depuis une autre organisation renvoie 404, pas 403
- [ ] Le créateur d'une organisation en est propriétaire
- [ ] Les paramètres d'organisation permettent d'en modifier le nom et le slug
- [ ] **Module non activé** : l'application fonctionne en mode mono-utilisateur, aucune route ni entrée de navigation d'organisation n'existe, les tables correspondantes sont absentes d'une base vierge, et toute donnée est rattachée directement à l'utilisateur
- [ ] La suite de tests passe avec le module activé, puis non activé

### Dependencies
s07-app-shell

### Agentic notes
**Risque de complexité 4 : le scoping traverse chaque requête et chaque écran.** C'est aussi la story qui prouve l'angle du PRD — un projet solo ne doit garder aucune trace du multi-tenant.
Better Auth fournit le plugin `organization`.
Référence : MakerKit conserve `organizations`, `members` et `invitations` en base même avec `NEXT_PUBLIC_ENABLE_TEAM_ACCOUNTS=false`. C'est exactement le comportement à ne pas reproduire pour un projet généré sans le module.
Piège : renvoyer 404 et non 403 sur une ressource d'une autre organisation, pour ne pas divulguer son existence.
Piège : le rattachement des données (utilisateur ou organisation) doit passer par une seule fonction de résolution du propriétaire, sinon le mode mono-utilisateur duplique chaque requête.

---

## Story s13-invite-members — Inviter quelqu'un dans son organisation
**As a** User **I want** inviter une personne par email dans mon organisation **so that** nous travaillions sur les mêmes données.

### Complexity
3

### Acceptance criteria
- [ ] Une invitation est envoyée par email et apparaît dans la liste des invitations en attente
- [ ] L'acceptation par un utilisateur existant l'ajoute comme membre ; par un nouvel utilisateur, elle enchaîne sur l'inscription puis l'ajoute
- [ ] Une invitation expirée, déjà acceptée ou révoquée affiche une erreur explicite et n'ajoute aucun membre
- [ ] Une invitation vers un email déjà membre est refusée avec un message explicite
- [ ] Une invitation en attente peut être révoquée ou renvoyée
- [ ] Un membre peut être retiré de l'organisation et perd immédiatement l'accès à ses données
- [ ] Le dernier propriétaire d'une organisation ne peut pas être retiré ni se retirer lui-même

### Dependencies
s12-organizations, s05-transactional-emails

### Agentic notes
Parité Supastarter et MakerKit.
Piège : le lien d'invitation est un jeton à usage unique et à durée limitée, distinct de la session.
Piège : le retrait d'un membre doit invalider ses sessions actives sur cette organisation, pas seulement son appartenance.

---

## Story s14-roles-permissions — Limiter les actions selon le rôle
**As a** User **I want** que les rôles owner, admin et member déterminent ce que chacun peut faire **so that** mon organisation reste sous contrôle.

### Complexity
3

### Acceptance criteria
- [ ] Les rôles owner, admin et member existent ; le créateur de l'organisation est owner
- [ ] Un member ne peut ni inviter, ni retirer un membre, ni modifier les paramètres de l'organisation : l'action est refusée côté serveur et son déclencheur est masqué dans l'interface
- [ ] Un admin peut inviter et retirer des members, mais ne peut ni supprimer l'organisation ni modifier un owner
- [ ] Un owner peut transférer la propriété ; l'ancien owner devient admin
- [ ] Une organisation conserve toujours au moins un owner
- [ ] Toute vérification de permission est effectuée côté serveur : un appel direct à l'API avec un rôle insuffisant renvoie 403
- [ ] Module organisations non activé : la vérification de permission accorde toujours l'accès au propriétaire des données, sans branche conditionnelle dans le code appelant
- [ ] Chaque combinaison rôle × action sensible est couverte par un test

### Dependencies
s13-invite-members

### Agentic notes
Parité MakerKit (RBAC) et ShipSaaS (CASL). Better Auth fournit un contrôle d'accès dans le plugin `organization`.
Piège : masquer un bouton n'est pas une permission. Chaque critère doit être testé au niveau de l'API, pas seulement de l'interface.

---

## Story s15-file-storage-avatar — Envoyer un fichier et changer son avatar
**As a** User **I want** téléverser une image de profil **so that** mon compte soit identifiable.

### Complexity
3

### Acceptance criteria
- [ ] Une interface `Storage` typée expose l'obtention d'une URL présignée, la lecture et la suppression, et est la seule surface appelée par le code métier
- [ ] Le téléversement se fait directement vers le stockage via URL présignée, sans transiter par le serveur applicatif
- [ ] Les types MIME et la taille maximale sont contrôlés côté serveur avant l'émission de l'URL présignée
- [ ] L'avatar téléversé s'affiche dans le menu de compte et dans les paramètres ; le remplacement supprime le fichier précédent
- [ ] Un fichier rattaché à une organisation n'est lisible que par ses membres
- [ ] La fonction de purge du module supprime les fichiers d'un utilisateur ou d'une organisation ; sa fonction d'export les liste
- [ ] **Module non activé** : aucune route de téléversement, aucune table de fichiers sur base vierge, et l'avatar retombe sur les initiales sans erreur

### Dependencies
s07-app-shell, s14-roles-permissions (contrôle d'accès par organisation)

### Agentic notes
**Écart assumé avec l'ordre du PRD** : le storage est livré avant la facturation parce que l'avatar complète le shell et les paramètres de compte déjà livrés, et parce qu'il est la première story à implémenter réellement `purge` et `export` du contrat de s03 — une répétition utile avant que le pack RGPD (s31, s32) en dépende.
Contrainte PRD : une seule implémentation livrée (S3 / Cloudflare R2, API compatible S3).
Référence : Supastarter documente S3, R2, DigitalOcean Spaces, MinIO et Supabase Storage ; MakerKit se limite à Supabase Storage.
Piège : valider le type MIME côté serveur, jamais sur la seule extension fournie par le client.

---

## Story s16-subscribe-stripe — Souscrire un abonnement
**As a** User **I want** souscrire un plan par abonnement et le gérer **so that** j'accède aux fonctionnalités payantes de façon récurrente.

### Complexity
4

### Acceptance criteria
- [ ] Les offres sont déclarées dans une configuration unique et typée (`config/billing.ts`) : identifiant, mode (`subscription` | `one_time`), prix, devise, intervalle, période d'essai, facturation au siège ; une offre malformée fait échouer le démarrage
- [ ] Une interface `Payments` typée expose checkout, portail et traitement de webhook, et est la seule surface appelée par le code métier
- [ ] Le choix d'une offre en mode `subscription` ouvre un checkout Stripe et le retour de paiement affiche l'abonnement actif
- [ ] Le webhook Stripe met à jour l'état de l'abonnement (actif, en essai, en retard de paiement, annulé) et est idempotent : un webhook rejoué ne produit aucun effet supplémentaire
- [ ] Un webhook à la signature invalide est rejeté en 400 sans modifier l'état
- [ ] Le portail client Stripe est accessible depuis la facturation et permet de changer de plan, de mettre à jour le moyen de paiement et d'annuler
- [ ] Un abonnement annulé conserve l'accès jusqu'à la fin de la période payée, puis le perd
- [ ] **Module non activé** : aucune route de facturation ni de webhook, aucune entrée de navigation, aucune table de facturation sur base vierge, et l'application reste pleinement utilisable
- [ ] En CI, les parcours sont vérifiés par rejeu d'événements webhook enregistrés ; hors CI, sur commande explicite, par un test contre les clés de test Stripe

### Dependencies
s07-app-shell, s14-roles-permissions (si le module organisations est activé, pour rattacher l'abonnement)

### Agentic notes
**Risque de complexité 4 : l'idempotence des webhooks est le point de rupture classique.** Journaliser chaque événement reçu avec son identifiant Stripe et refuser les doublons.
Le critère « module non activé » est requis par s35 (page de revenus absente) et s37 (étape de choix d'offre absente), qui s'y appuient sans le définir (finding F17 de la revue).
Cette story porte la **configuration des offres**, pas la page de tarifs : la dérivation de la page publique appartient à s20. Les deux stories ne doivent pas revendiquer le même critère.
Contrainte PRD : couche d'abstraction provider avec **Stripe comme seule implémentation**. LemonSqueezy, Polar, Creem et Dodo sont au cimetière.
Piège : l'abonnement se rattache soit à l'utilisateur, soit à l'organisation, selon les modules actifs. Prévoir ce basculement dès maintenant (Supastarter le nomme `billingAttachedTo`).

---

## Story s17-one-time-purchase — Acheter une fois pour toutes
**As a** User **I want** acheter un accès à vie en un paiement unique **so that** je ne sois pas obligé de m'abonner.

### Complexity
3

### Acceptance criteria
- [ ] Une offre déclarée en mode `one_time` ouvre un checkout Stripe en paiement unique, sans création d'abonnement
- [ ] Le paiement confirmé accorde un droit d'accès permanent, visible dans la page de facturation
- [ ] Le droit d'accès survit à l'absence d'abonnement : aucune vérification d'abonnement actif ne le révoque
- [ ] Le portail client n'est pas proposé pour un achat unique ; l'historique des paiements et les factures restent accessibles
- [ ] Un remboursement reçu par webhook révoque le droit d'accès
- [ ] Un utilisateur peut cumuler un achat unique et un abonnement sans que l'un n'écrase l'autre
- [ ] Les webhooks de paiement unique sont idempotents : un événement rejoué n'accorde pas un second droit

### Dependencies
s16-subscribe-stripe

### Agentic notes
Nommé dans la ligne Billing du périmètre PRD (« one-time »).
Différences réelles avec l'abonnement, à ne pas sous-estimer : `mode: payment` au checkout, événements webhook distincts (`checkout.session.completed` sans `subscription`, `charge.refunded`), et surtout un modèle de droit d'accès qui ne peut pas s'appuyer sur l'état d'un abonnement.
Référence : ShipFast vend lui-même en licence unique ; les quatre cibles supportent le paiement unique en plus de l'abonnement.
Piège : un droit permanent stocké comme « abonnement toujours actif » casse dès le premier calcul de revenu récurrent (s35). Le modéliser comme un droit distinct.

---

## Story s18-trials-and-gating — Réserver des fonctionnalités aux offres payantes
**As a** Dev **I want** conditionner une fonctionnalité à une offre et proposer un essai **so that** je monétise mon produit sans écrire de logique d'accès à chaque écran.

### Complexity
3

### Acceptance criteria
- [ ] Une fonctionnalité est déclarée comme requérant une offre ou un niveau donné ; la vérification est une fonction unique appelée côté serveur
- [ ] Un accès à une fonctionnalité réservée sans droit suffisant renvoie 403 côté API et affiche une invitation à souscrire côté interface
- [ ] Le droit est accordé aussi bien par un abonnement actif que par un achat unique (s17)
- [ ] Une période d'essai configurée sur une offre donne accès aux fonctionnalités payantes jusqu'à son terme, puis les retire
- [ ] Un essai expiré, un abonnement en retard de paiement et un abonnement annulé après période payée retirent tous l'accès
- [ ] Une limite quantitative configurée (nombre d'objets, de membres, de fichiers) est vérifiée côté serveur et refuse le dépassement avec un message nommant la limite atteinte
- [ ] **Module de facturation non activé** : la fonction de vérification accorde l'accès à toutes les fonctionnalités et aucune invitation à souscrire n'apparaît
- [ ] Chaque combinaison état de facturation × fonctionnalité réservée est couverte par un test

### Dependencies
s17-one-time-purchase

### Agentic notes
Découpée de s16 sur recommandation de la revue : le gating et les essais sont une tranche à part entière, avec leur propre matrice de tests.
Le gating doit interroger un **droit d'accès** consolidé (abonnement OU achat unique OU essai), jamais directement l'état d'un abonnement — sinon s17 est inutilisable.
**Frontière avec le cimetière** (finding F23 de la revue) : le compteur de limite quantitative sert exclusivement à **refuser une action** au-delà d'un quota de plan. Il ne doit jamais alimenter une assiette de facturation ni un relevé de consommation : la facturation à l'usage est explicitement au cimetière du PRD.
Piège : une vérification côté client seule est une faille. Le critère porte sur l'API.

---

## Story s19-seat-billing — Facturer au nombre de membres
**As a** User **I want** que ma facture suive le nombre de membres de mon organisation **so that** je paie ce que j'utilise réellement.

### Complexity
4

### Acceptance criteria
- [ ] Une offre peut être marquée comme facturée au siège dans la configuration des offres
- [ ] L'ajout d'un membre incrémente la quantité de l'abonnement Stripe ; son retrait la décrémente
- [ ] La quantité facturée est toujours égale au nombre de membres actifs après toute opération d'ajout ou de retrait
- [ ] Une invitation en attente n'est pas facturée ; elle le devient à son acceptation
- [ ] L'ajout d'un membre au-delà d'une limite de sièges configurée est refusé avec un message explicite
- [ ] Un échec de synchronisation Stripe n'ajoute pas le membre : l'opération est atomique et rejouable
- [ ] Une commande de réconciliation compare la quantité Stripe au nombre réel de membres et corrige l'écart
- [ ] **Module non activé** : la facturation reste au forfait, aucune synchronisation de quantité n'a lieu, et aucune limite de sièges n'est appliquée

### Dependencies
s18-trials-and-gating, s14-roles-permissions

### Agentic notes
**Risque de complexité 4 : la cohérence entre le nombre de membres et la quantité Stripe.** C'est un état distribué entre deux systèmes ; toute opération doit être rejouable et réconciliable.
Référence : Supastarter expose `seatBased` par offre ; MakerKit annonce une facturation par siège, à l'usage et au forfait. La facturation à l'usage reste au **cimetière**.
Piège : sans commande de réconciliation, la dérive est silencieuse et ne se découvre qu'à la facture du client.

---

## Story s20-marketing-pages — Découvrir le produit et ses tarifs
**As a** Visiteur **I want** consulter la page d'accueil, les tarifs et les mentions légales **so that** je comprenne le produit et puisse le contacter.

### Complexity
3

### Acceptance criteria
- [ ] La page d'accueil est composée de sections réutilisables (héros, fonctionnalités, témoignages, appel à l'action, FAQ) dont le contenu et l'ordre proviennent d'un fichier de configuration typé (`config/marketing.ts`) ; réordonner ou retirer une section ne demande aucune modification de composant
- [ ] La page de tarifs est dérivée de `config/billing.ts` (s16) : ajouter une offre la fait apparaître sans modifier la page, et les prix affichés sont ceux envoyés au checkout
- [ ] Les offres en mode `subscription` et `one_time` sont toutes deux présentables, avec la mention de périodicité adéquate
- [ ] Module de facturation non activé : la page de tarifs n'existe pas et son lien disparaît de la navigation publique
- [ ] Le formulaire de contact envoie un email et affiche une confirmation ; un champ invalide affiche une erreur sans envoyer
- [ ] L'inscription à la newsletter enregistre l'email et refuse les doublons sans erreur visible
- [ ] Les pages légales (confidentialité, conditions d'utilisation) existent et sont accessibles depuis le pied de page
- [ ] Chaque page expose un titre, une méta description et des balises Open Graph ; `sitemap.xml` et `robots.txt` sont générés et listent les pages publiques
- [ ] Les pages marketing s'affichent sans session et n'émettent aucune requête base de données au rendu

### Dependencies
s08-i18n, s16-subscribe-stripe (configuration des offres), s17-one-time-purchase

### Agentic notes
La dérivation de la page de tarifs appartient **à cette story seule** — s16 ne porte que la configuration des offres.
Le stockage des inscriptions newsletter livré ici est réutilisé par s39-waitlist : une seule table d'inscriptions publiques, avec une colonne de source, jamais deux modèles concurrents (finding F27 de la revue).
Parité 4/4. ShipFast en fait son argument principal ; Supastarter livre héros, fonctionnalités, tarifs, newsletter et contact.
Piège : les pages marketing doivent rester statiques et rapides.

---

## Story s21-guest-checkout — Payer sans créer de compte d'abord
**As a** Visiteur **I want** payer directement depuis la page de tarifs **so that** je n'aie pas à créer un compte avant de savoir si j'achète.

### Complexity
3

### Acceptance criteria
- [ ] Depuis la page de tarifs, un visiteur non connecté peut ouvrir un checkout sans compte préalable, pour une offre en abonnement comme en paiement unique
- [ ] Après paiement, un compte est créé automatiquement avec l'email du paiement et le droit d'accès lui est rattaché
- [ ] Le visiteur reçoit un email lui permettant de définir son mot de passe ou de se connecter par magic link
- [ ] Si l'email du paiement correspond à un compte existant, le droit d'accès est rattaché à ce compte au lieu d'en créer un second
- [ ] Un paiement abandonné ne crée ni compte ni droit d'accès
- [ ] Un webhook de paiement rejoué ne crée pas de second compte ni de second droit
- [ ] Aucune session n'est ouverte depuis la page de retour de paiement

### Dependencies
s20-marketing-pages, s18-trials-and-gating

### Agentic notes
Exclusivité ShipSaaS parmi les quatre cibles : « guest checkout qui crée automatiquement le compte ».
Piège principal : la création de compte doit se faire depuis le **webhook**, pas depuis la page de retour — le visiteur peut fermer son navigateur avant la redirection.
Piège de sécurité : ne jamais ouvrir de session automatiquement depuis la page de retour. Toujours passer par un lien envoyé à l'email vérifié par le paiement.

---

## Story s22-golden-path-e2e — Vérifier le parcours clone → premier paiement
**As a** Dev **I want** un test de bout en bout qui rejoue le parcours complet **so that** le critère de succès n°1 du PRD soit vérifié à chaque story et non une seule fois.

### Complexity
3

### Acceptance criteria
- [ ] Un scénario Playwright unique enchaîne : inscription, vérification d'email, création d'organisation, souscription d'une offre, et accès à une fonctionnalité réservée
- [ ] Le scénario part d'une base vierge et d'un jeu de données de seed, sans état résiduel d'une exécution précédente
- [ ] Une variante du scénario couvre l'achat unique, une autre le guest checkout
- [ ] **En CI**, le scénario s'exécute avec rejeu d'événements webhook Stripe enregistrés, sans appel réseau sortant, et son échec bloque la CI
- [ ] **Hors CI**, sur commande explicite, le même scénario s'exécute contre les clés de test Stripe et un tunnel de webhooks ; il est exécuté avant chaque ship et sa trace consignée dans la revue de la story
- [ ] Le scénario s'exécute sur une commande unique (`pnpm test:golden-path`) et échoue explicitement si une étape dépasse un temps configuré
- [ ] La durée totale du parcours est mesurée et journalisée à chaque exécution

### Dependencies
s21-guest-checkout

### Agentic notes
Porte le critère de succès n°1 du PRD (« clone → premier paiement en moins de 30 minutes, rejoué à chaque story »), qu'aucune story de fonctionnalité ne vérifiait.
**Les deux régimes CI / hors CI sont explicites** (finding F20 de la revue) : la CI est déterministe et bloquante par rejeu d'événements enregistrés ; l'intégration réelle est une commande manuelle avant ship. Ne pas mélanger les deux, c'est la source d'échecs intermittents la plus classique sur ce type de harnais.
Ne dépend pas du seat billing : aucun de ses scénarios n'implique de siège.
Le harnais mesure et journalise la durée sans imposer de seuil bloquant : le seuil de 30 minutes est une recette humaine, la mesure automatisée en est la trace.

---

## Story s23-minimal-profile-check — Prouver qu'un projet minimal ne traîne rien
**As a** Dev **I want** une recette automatisée sur un projet aux modules optionnels coupés **so that** la promesse de modularité soit vérifiée en continu et non affirmée.

### Complexity
3

### Acceptance criteria
- [ ] Un profil de configuration « minimal » désactive simultanément multi-tenant, seat billing et i18n, et sert de base à la recette
- [ ] Sous ce profil, l'application démarre et la suite de tests complète passe
- [ ] Aucune route des modules désactivés n'est joignable : chaque URL connue de ces modules renvoie 404
- [ ] Aucune entrée de navigation orpheline n'est rendue : la navigation est comparée à la liste des modules activés
- [ ] Après `pnpm db:migrate` sur une base vierge, aucune table appartenant à un module désactivé n'existe ; la comparaison est faite sur le schéma réel de la base, pas sur les fichiers de migration
- [ ] Le parcours d'inscription et de connexion fonctionne de bout en bout sous ce profil
- [ ] La recette s'exécute sur une commande unique et en CI, et son échec bloque la CI
- [ ] Ajouter un module désactivé au profil ne demande aucune modification du harnais

### Dependencies
s19-seat-billing, s08-i18n, s12-organizations, s02-quality-harness

### Agentic notes
Porte le **critère de succès n°4 du PRD** — « aucune route morte, aucune entrée de nav orpheline, aucune table inutilisée » —, qui n'avait aucun propriétaire (finding F18 de la revue). Chaque story de module teste son propre off ; personne ne testait les trois coupés simultanément, c'est-à-dire précisément l'angle n°1 face à MakerKit.
Symétrique de s22 : s22 prouve que le socle complet mène à un paiement, s23 prouve que le socle réduit ne traîne rien.
Piège : lire le schéma réel de la base (`information_schema`) et non les fichiers de migration — c'est la seule vérification qui attrape une table créée par un import transitif.
Piège : ce harnais doit rester générique. Un profil codé en dur avec trois noms de modules deviendrait faux dès le module suivant.

---

## Story s24-deployment — Déployer l'application en production
**As a** Dev **I want** déployer l'application sur Vercel ou sur mon serveur Coolify **so that** je mette mon SaaS en ligne sans réinventer la chaîne de déploiement.

### Complexity
3

### Acceptance criteria
- [ ] Un `Dockerfile` multi-étapes produit une image de production qui démarre avec les seules variables d'environnement
- [ ] Un `docker-compose.prod.yml` démarre l'application et sa base de données et sert l'application sur un port configurable
- [ ] Les migrations sont jouées au déploiement, avant le basculement du trafic, et un échec de migration interrompt le déploiement
- [ ] Une checklist exhaustive des variables d'environnement de production est documentée et vérifiée au démarrage
- [ ] **Recette manuelle** : le guide Coolify permet un déploiement de bout en bout depuis un dépôt neuf ; la trace (URL déployée, date, version) est consignée dans la revue de la story
- [ ] **Recette manuelle** : le guide Vercel permet un déploiement de bout en bout depuis un dépôt neuf ; trace consignée de même
- [ ] Le pipeline CI construit l'image et échoue si le build de production échoue

### Dependencies
s20-marketing-pages

### Agentic notes
Parité 4/4. Supastarter documente Vercel, Render, Fly.io, Netlify, Docker, Coolify et Railway.
Contrainte PRD : Vercel est la cible de référence, Docker et Coolify sont documentés (l'utilisateur opère déjà un Coolify).
Deux critères sont marqués recette manuelle : un déploiement réel n'est pas automatisable dans ce cadre, mais il doit laisser une trace vérifiable.
Piège : les migrations doivent être rétrocompatibles avec la version encore en ligne pendant le basculement.

---

## Story s25-rate-limiting — Résister au spam et aux attaques par force brute
**As a** Dev **I want** que les points d'entrée publics soient limités en débit **so that** mon application ne soit pas spammée ni forcée dès sa mise en ligne.

### Complexity
3

### Acceptance criteria
- [ ] Les tentatives de connexion sont limitées par IP et par compte ; au-delà du seuil, la réponse est 429 avec un en-tête `Retry-After`
- [ ] L'inscription, la réinitialisation de mot de passe, le magic link, **la vérification de double authentification**, l'invitation, le formulaire de contact et le téléversement sont limités avec des seuils configurables
- [ ] Le verrouillage par compte posé en s10 pour la double authentification est remplacé par ce mécanisme : une seule logique de limitation subsiste dans le code
- [ ] Les seuils sont définis dans la configuration, jamais en dur dans le code
- [ ] Un captcha optionnel peut être activé sur les formulaires publics ; désactivé, les formulaires restent pleinement fonctionnels
- [ ] Le dépassement de seuil est journalisé avec l'IP et la route concernées
- [ ] Le compteur est partagé entre instances ; un test le prouve en simulant deux instances contre le même magasin
- [ ] Les limites sont neutralisables dans les tests par injection, sans variable d'environnement exploitable en production

### Dependencies
s20-marketing-pages, s06-signup-signin, s10-two-factor, s13-invite-members, s15-file-storage-avatar

### Agentic notes
**Aucune des quatre cibles ne le fournit** — angle n°4 du PRD (conformité et robustesse par défaut).
Les dépendances listent tous les points d'entrée à protéger : chacun doit exister avant d'être limité (finding F21 de la revue).
Piège : un compteur en mémoire est contournable en scalant horizontalement. Documenter la dégradation en mono-instance.
Piège : limiter par IP seule est insuffisant contre le bourrage d'identifiants ; limiter aussi par compte visé.

---

## Story s26-blog-mdx — Publier un article de blog
**As a** Dev **I want** publier des articles en MDX **so that** mon SaaS ait un canal d'acquisition organique.

### Complexity
3

### Acceptance criteria
- [ ] Un fichier MDX déposé dans le dossier des articles apparaît dans la liste du blog après build, sans autre intervention
- [ ] Un article expose titre, description, date, auteur et tags depuis son frontmatter ; un frontmatter invalide fait échouer le build avec le nom du fichier fautif
- [ ] La liste est paginée et filtrable par tag
- [ ] Chaque article génère ses balises méta et Open Graph, et une image Open Graph par défaut si aucune n'est fournie
- [ ] Un flux RSS est généré et valide
- [ ] Les articles sont traduisibles : module i18n activé, un article sans traduction dans la locale courante n'apparaît pas dans cette locale ; module non activé, tous les articles sont servis dans la langue par défaut
- [ ] Les articles sont référencés dans `sitemap.xml`
- [ ] Module non activé : aucune route de blog, et le lien disparaît de la navigation publique

### Dependencies
s20-marketing-pages, s08-i18n

### Agentic notes
Parité Supastarter (MDX multilingue), MakerKit (Markdoc) et ShipFast.
Cette story pose le pipeline MDX réutilisé par s27 et s28.
Piège : le rendu MDX ne doit pas exécuter de composant applicatif nécessitant une session.

---

## Story s27-docs-site — Consulter la documentation du produit
**As a** Visiteur **I want** parcourir et rechercher la documentation **so that** je trouve comment utiliser le produit.

### Complexity
3

### Acceptance criteria
- [ ] Les pages de documentation sont écrites en MDX et organisées en sections avec une navigation latérale générée depuis l'arborescence
- [ ] La recherche plein texte retourne les pages correspondantes et fonctionne sans service externe
- [ ] Chaque page expose un sommaire de ses titres et un lien d'ancre par section
- [ ] Un lien interne pointant vers une page inexistante fait échouer le build
- [ ] La documentation est traduisible ; une page non traduite retombe sur la locale par défaut avec une mention explicite
- [ ] Les pages de documentation sont référencées dans `sitemap.xml`
- [ ] Module non activé : aucune route de documentation, et le lien disparaît de la navigation publique

### Dependencies
s26-blog-mdx (pipeline MDX)

### Agentic notes
Parité Supastarter (Fumadocs avec recherche plein texte) et MakerKit.
Distinction du PRD : il s'agit de la documentation **du SaaS généré**, pas de la documentation du boilerplate destinée à des acheteurs — cette dernière est au cimetière.

---

## Story s28-changelog — Annoncer les nouveautés
**As a** Visiteur **I want** consulter les nouveautés du produit **so that** je voie qu'il évolue.

### Complexity
2

### Acceptance criteria
- [ ] Une entrée de changelog est un fichier MDX avec version, date et catégorie ; un frontmatter invalide fait échouer le build
- [ ] Les entrées sont affichées par ordre chronologique inverse, groupées par version
- [ ] Un flux RSS des nouveautés est généré et valide
- [ ] Les entrées sont traduisibles et référencées dans `sitemap.xml`
- [ ] Module non activé : la page n'existe pas et le lien disparaît du pied de page

### Dependencies
s26-blog-mdx (pipeline MDX)

### Agentic notes
Parité MakerKit.
Réutiliser le pipeline MDX de s26 plutôt que d'en créer un troisième.

---

## Story s29-notifications-inapp — Être notifié dans l'application
**As a** User **I want** voir mes notifications dans l'application et choisir comment être prévenu **so that** je ne rate rien sans être submergé d'emails.

### Complexity
3

### Acceptance criteria
- [ ] Un centre de notifications liste les notifications de l'utilisateur, les plus récentes en premier, paginées
- [ ] Un badge indique le nombre de non-lues et se met à jour après lecture
- [ ] Une notification peut être marquée comme lue individuellement ou toutes à la fois
- [ ] Les préférences permettent d'activer ou désactiver chaque type de notification par canal (in-app, email) et sont respectées à l'émission
- [ ] Une notification émise pour un événement d'organisation n'est visible que par les membres concernés
- [ ] Tout email correspondant à un **type de notification déclaré dans le registre de préférences** passe par la fonction d'émission unique ; un test vérifie qu'aucun de ces types n'appelle le mailer directement
- [ ] Module non activé : aucune route ni entrée de navigation de notifications, et les émetteurs existants ne provoquent aucune erreur

### Dependencies
s14-roles-permissions, s05-transactional-emails

### Agentic notes
Le temps réel (websockets, `NEXT_PUBLIC_REALTIME_NOTIFICATIONS` chez MakerKit) est au **cimetière** du PRD : lecture au chargement et à la navigation uniquement.
**Portée du critère sur le mailer** (finding F19 de la revue) : la règle vise les emails **de notification**, pas tout appel au mailer. Les emails transactionnels d'authentification (vérification, magic link, réinitialisation), l'invitation de s13, le lien de définition de mot de passe de s21, la confirmation de suppression de s31 et le lien d'export de s32 restent des appels directs légitimes et ne doivent pas être refactorés ici.
Parité Supastarter (centre de notifications et préférences email) et MakerKit.

---

## Story s30-background-jobs — Exécuter des traitements en arrière-plan
**As a** Dev **I want** déclencher des jobs asynchrones et des tâches planifiées **so that** les traitements longs ou différés ne bloquent pas les requêtes.

### Complexity
4

### Acceptance criteria
- [ ] Une interface typée expose l'émission d'un événement et la déclaration d'un job, et est la seule surface appelée par le code métier
- [ ] En CI, une doublure d'enregistrement capture les événements émis et le test asserte leur nom et leur charge utile
- [ ] Hors CI, sur commande explicite, un test contre l'environnement de développement Inngest exécute réellement un job de démonstration
- [ ] Une tâche planifiée s'exécute selon son expression cron et son exécution est journalisée
- [ ] Un job en échec est réessayé selon une politique configurable, puis marqué en échec définitif et journalisé
- [ ] Un job est idempotent : la même exécution rejouée ne produit pas d'effet en double
- [ ] Une relance d'essai en fin de période est livrée comme job réel et couverte par un test
- [ ] Les jobs s'exécutent en local sans service externe (mode développement documenté)

### Dependencies
s18-trials-and-gating, s29-notifications-inapp

### Agentic notes
**Risque de complexité 4 : dépendance à une infrastructure externe, difficile à tester.** Le mode développement local doit être documenté et fonctionnel, sinon chaque projet dérivé sera bloqué.
Contrainte PRD : adapter avec **Inngest comme seule implémentation**. trigger.dev, QStash et BullMQ (documentés par Supastarter) restent hors périmètre. La doublure d'enregistrement de CI est un outil de test, pas un second provider.

---

## Story s31-account-deletion — Supprimer son compte ou son organisation
**As a** User **I want** supprimer définitivement mon compte ou mon organisation **so that** je puisse exercer mon droit à l'effacement.

### Complexity
3

### Acceptance criteria
- [ ] La suppression exige une confirmation explicite (saisie de l'email ou du nom de l'organisation)
- [ ] La suppression appelle la fonction de purge de **chaque module activé** ; un module dont la purge échoue interrompt l'opération et la laisse rejouable
- [ ] La suppression d'un compte efface ou anonymise ses données dans tous les modules activés, fichiers stockés et notifications compris
- [ ] La suppression d'une organisation efface ses données, retire ses membres et annule son abonnement chez le provider de paiement
- [ ] Un utilisateur dernier propriétaire d'une organisation doit d'abord la transférer ou la supprimer ; le message le précise
- [ ] Après suppression, les sessions sont révoquées et une reconnexion est impossible
- [ ] Un email de confirmation de suppression est envoyé
- [ ] Un module non activé n'est pas appelé et ne laisse pas de données orphelines

### Dependencies
s30-background-jobs, s15-file-storage-avatar, s16-subscribe-stripe (annulation de l'abonnement), s14-roles-permissions (règle du dernier propriétaire)

### Agentic notes
Parité partielle MakerKit (`NEXT_PUBLIC_ENABLE_PERSONAL_ACCOUNT_DELETION`, `..._TEAM_ACCOUNTS_DELETION`, désactivés par défaut).
Le contrat de module de s03 porte déjà `purge` : cette story l'orchestre, elle ne le crée pas. Si un module livré entre s03 et ici ne l'a pas implémentée, c'est un manquement à corriger dans ce module, pas ici.
La suppression effective passe par un job de fond (s30) pour rester fiable sur de gros volumes.

---

## Story s32-data-export — Exporter ses données
**As a** User **I want** télécharger l'ensemble de mes données **so that** j'exerce mon droit à la portabilité.

### Complexity
3

### Acceptance criteria
- [ ] Une demande d'export appelle la fonction d'export de chaque module activé et produit une archive
- [ ] L'archive est construite par un job de fond ; l'utilisateur est notifié à sa disponibilité
- [ ] L'archive est fournie via un lien de téléchargement à durée de validité limitée, envoyé par email
- [ ] Le lien expiré ne permet plus le téléchargement
- [ ] Une demande d'export d'organisation n'est accessible qu'à un owner
- [ ] Les données exportées sont dans un format lisible et documenté (JSON, plus les fichiers joints)
- [ ] Une demande d'export déjà en cours n'en déclenche pas une seconde

### Dependencies
s30-background-jobs, s15-file-storage-avatar

### Agentic notes
**Aucune des quatre cibles ne le fournit** — angle du PRD.
Complexité relevée de 2 à 3 (finding F26 de la revue) : export inter-modules, orchestration par job de fond, lien signé expirant, permission owner et garde anti-doublon.
Symétrique de s31 : même contrat de module (`export` posé en s03), même orchestration par job de fond.

---

## Story s33-cookie-consent — Choisir ses cookies
**As a** Visiteur **I want** accepter ou refuser les cookies non essentiels **so that** ma navigation respecte mon choix.

### Complexity
2

### Acceptance criteria
- [ ] Une bannière s'affiche à la première visite et permet d'accepter, de refuser et de personnaliser par catégorie
- [ ] Un script déclaré comme non essentiel n'est injecté dans la page qu'après consentement de sa catégorie ; vérifié avec un script factice dont la présence dans le DOM est assertée
- [ ] Le refus est respecté et persistant : à la visite suivante, ni bannière ni script non essentiel
- [ ] Le choix est modifiable à tout moment depuis un lien du pied de page, et le retrait du consentement empêche l'injection au chargement suivant
- [ ] La bannière n'apparaît pas si aucun script non essentiel n'est déclaré
- [ ] La bannière est traduite dans toutes les locales livrées

### Dependencies
s20-marketing-pages

### Agentic notes
**Aucune des quatre cibles ne le fournit** — angle du PRD. Obligatoire en Europe dès qu'un outil d'analyse est présent.
Les critères portent sur un **registre de scripts non essentiels** et un script factice, pas sur PostHog : l'outil d'analyse arrive en s36, qui dépend de cette story.
Piège : le consentement doit conditionner le **chargement** du script, pas seulement l'envoi des événements.

---

## Story s34-admin-users — Administrer les utilisateurs et les organisations
**As a** Admin **I want** rechercher un utilisateur, agir sur son compte et me connecter à sa place **so that** je puisse assister mes clients et modérer la plateforme.

### Complexity
3

### Acceptance criteria
- [ ] Un back-office réservé aux superadmins liste les utilisateurs avec recherche et pagination ; un non-superadmin reçoit 404
- [ ] Le détail d'un utilisateur affiche ses organisations, ses droits d'accès et ses sessions actives
- [ ] Un superadmin peut bannir et débannir un compte ; un compte banni ne peut plus se connecter et ses sessions sont révoquées
- [ ] Un superadmin peut révoquer une session et déclencher une réinitialisation de mot de passe
- [ ] L'impersonation ouvre une session au nom de l'utilisateur, affiche un bandeau permanent et permet d'y mettre fin pour revenir au compte superadmin
- [ ] Un superadmin ne peut pas impersonner un autre superadmin
- [ ] Le début et la fin d'une impersonation émettent une entrée dans les logs applicatifs, avec l'identifiant du superadmin et celui de la cible
- [ ] La liste des organisations est consultable avec ses membres et son abonnement

### Dependencies
s14-roles-permissions, s18-trials-and-gating

### Agentic notes
Le plugin `admin` de Better Auth fournit déjà liste, recherche, pagination, bannissement, réinitialisation, sessions et impersonation avec garde-fou sur les autres administrateurs. Le travail réel est l'interface et la vue organisations.
Parité Supastarter (superadmin et impersonation), MakerKit (super admin dashboard) et ShipSaaS (back-office).
**Précision par rapport au cimetière** : la traçabilité de l'impersonation est une écriture dans les **logs applicatifs**, pas une table d'audit alimentée par chaque module. Le « journal d'audit » reste au cimetière du PRD.

---

## Story s35-admin-revenue — Suivre le revenu de la plateforme
**As a** Admin **I want** voir mes indicateurs de revenu et d'abonnements **so that** je pilote mon activité sans ouvrir Stripe.

### Complexity
2

### Acceptance criteria
- [ ] Le back-office affiche le revenu récurrent mensuel, le nombre d'abonnements actifs, d'essais en cours et d'annulations sur la période
- [ ] Les achats uniques sont comptabilisés séparément du revenu récurrent et n'entrent pas dans le calcul du MRR
- [ ] Les indicateurs sont calculés depuis les données locales, sans appel à l'API du provider au chargement de la page
- [ ] Une période est sélectionnable et les indicateurs se recalculent en conséquence
- [ ] Sans aucune vente, la page affiche des valeurs nulles et non une erreur
- [ ] Module de facturation non activé : la page n'existe pas et son entrée disparaît du back-office

### Dependencies
s34-admin-users, s17-one-time-purchase

### Agentic notes
Parité ShipSaaS (« suivi du revenu en temps réel ») et MakerKit.
S'appuie sur le critère « module de facturation non activé » défini en s16.
Piège signalé en s17 : compter un achat unique comme un abonnement toujours actif fausse le MRR. Le second critère est là pour l'interdire.
Piège : ne pas interroger l'API Stripe au rendu. Les webhooks de s16 et s17 alimentent l'état local, qui fait référence.

---

## Story s36-monitoring-analytics — Observer les erreurs et les usages
**As a** Dev **I want** collecter les erreurs et les événements d'usage **so that** je détecte les incidents et comprenne le comportement de mes utilisateurs.

### Complexity
2

### Acceptance criteria
- [ ] Une erreur non gérée côté serveur et côté client est remontée à Sentry avec sa trace source lisible (source maps envoyées au build)
- [ ] Les données sensibles (mot de passe, jeton, cookie de session) sont filtrées avant envoi ; un test soumet une charge utile contenant ces champs et asserte leur absence dans la requête capturée
- [ ] Une interface `Analytics` typée expose le suivi d'événement et d'affichage de page, et est la seule surface appelée par le code métier
- [ ] En CI, les requêtes d'analyse sont capturées et assertées ; hors CI, sur commande explicite, un test contre un projet PostHog de test vérifie l'envoi réel
- [ ] Sans clé configurée, l'application fonctionne normalement et aucun appel réseau d'analyse n'est émis
- [ ] Le script d'analyse est déclaré comme non essentiel auprès du registre de s33 : aucun chargement ni événement sans consentement
- [ ] Un événement de démonstration (inscription réussie) est suivi de bout en bout et couvert par un test

### Dependencies
s33-cookie-consent

### Agentic notes
Parité 3/4 : Supastarter et MakerKit livrent Sentry ; ShipFast documente une page analytics.
Contrainte PRD : une seule implémentation par interface (Sentry pour les erreurs, PostHog pour l'analyse).
Piège : le filtrage des données sensibles doit être testé, pas seulement configuré.

---

## Story s37-onboarding — Être guidé à la première connexion
**As a** User **I want** être guidé après mon inscription **so that** j'arrive à un espace de travail utilisable sans tâtonner.

### Complexity
3

### Acceptance criteria
- [ ] Après une première inscription, l'utilisateur est dirigé vers un parcours en étapes au lieu du tableau de bord
- [ ] Une étape de profil recueille le nom et l'avatar ; les valeurs saisies sont persistées sur le compte
- [ ] Les étapes affichées dépendent des modules activés : sans le module organisations, l'étape de création d'organisation n'existe pas ; sans le module de facturation, l'étape de choix d'offre n'existe pas
- [ ] La progression est persistée : une interruption reprend à l'étape en cours à la reconnexion
- [ ] Le parcours terminé n'est plus proposé et l'utilisateur atteint directement le tableau de bord
- [ ] Une étape facultative peut être passée ; une étape obligatoire ne peut pas l'être
- [ ] Un utilisateur arrivé par invitation rejoint directement l'organisation et saute l'étape de création
- [ ] Module non activé : l'utilisateur atteint directement le tableau de bord après inscription

### Dependencies
s12-organizations, s18-trials-and-gating, s15-file-storage-avatar (avatar de l'étape profil), s13-invite-members (parcours par invitation)

### Agentic notes
Annoncé par Supastarter (parcours d'intégration en plusieurs étapes). Positionné tard par le PRD : c'est un bonus, pas le socle.
Les quatre étapes du PRD sont couvertes : profil, organisation, offre, progression persistée.
S'appuie sur les critères « module non activé » définis en s12 et s16.
Piège : le parcours est piloté par les modules actifs. Une liste d'étapes écrite en dur casserait l'angle du PRD.

---

## Story s38-mcp-server — Piloter le boilerplate depuis un agent
**As a** Dev **I want** interroger et modifier les modules depuis un agent via MCP **so that** je configure mon projet en langage naturel.

### Complexity
3

### Acceptance criteria
- [ ] Un serveur MCP expose un outil listant les modules et leur état
- [ ] Un outil active ou désactive un module et renvoie les migrations à jouer
- [ ] Un outil génère le squelette d'un nouveau module conforme au contrat de s03 (schéma, routes, navigation, traductions, purge, export)
- [ ] Toute opération modifiant le dépôt renvoie la liste exacte des fichiers modifiés
- [ ] Une opération refusée (module inconnu, dépôt aux modifications non commitées) renvoie une erreur explicite sans modifier le dépôt
- [ ] Le serveur démarre depuis une commande documentée et sa configuration client est fournie

### Dependencies
s04-cli-toggle-module

### Agentic notes
Exclusivité MakerKit parmi les quatre (serveur MCP livré avec le kit).
Réutiliser la logique du CLI de s04 : le serveur MCP est une seconde surface d'appel, jamais une seconde implémentation.
Piège : refuser toute opération sur un dépôt aux modifications non commitées, pour que le développeur puisse toujours annuler.

---

## Story s39-waitlist — Recueillir des inscriptions avant le lancement
**As a** Visiteur **I want** m'inscrire sur une liste d'attente **so that** je sois prévenu au lancement du produit.

### Complexity
2

### Acceptance criteria
- [ ] Une page de liste d'attente capture l'email et confirme l'inscription
- [ ] Un email déjà inscrit affiche la même confirmation sans créer de doublon
- [ ] Un email de confirmation est envoyé à l'inscription
- [ ] Les inscrits sont consultables et exportables en CSV depuis le back-office
- [ ] Le formulaire est soumis aux limites de débit définies en s25
- [ ] Le module peut remplacer la page d'accueil par la liste d'attente via la configuration, sans modifier le code des pages marketing
- [ ] Module non activé : aucune route de liste d'attente et la page d'accueil reste inchangée

### Dependencies
s34-admin-users, s25-rate-limiting, s20-marketing-pages

### Agentic notes
Exclusivité MakerKit (vendu comme plugin). Positionné en fin de parcours par le PRD : module d'upsell, jamais avant que le socle tourne.
**Réutilise le stockage d'inscriptions publiques de s20** (newsletter), distingué par une colonne de source. Ne pas créer un second modèle d'inscription concurrent.

---

## Story s40-feedback-widget — Envoyer un retour depuis l'application
**As a** User **I want** envoyer un retour depuis l'application **so that** je signale un problème sans changer d'outil.

### Complexity
2

### Acceptance criteria
- [ ] Un widget accessible depuis le tableau de bord permet d'envoyer un message avec une catégorie (bug, idée, autre)
- [ ] Le retour est persisté avec son auteur, son organisation et l'URL de la page depuis laquelle il a été envoyé
- [ ] Une notification est envoyée aux superadmins à chaque nouveau retour, via le centre de notifications
- [ ] Les retours sont consultables et filtrables par catégorie et par statut dans le back-office
- [ ] Un retour peut être marqué comme traité
- [ ] Module non activé : le widget disparaît et aucune route de retour n'existe

### Dependencies
s29-notifications-inapp, s34-admin-users

### Agentic notes
Exclusivité MakerKit (plugin feedback). Module d'upsell.
Réutiliser le centre de notifications de s29 pour prévenir les superadmins, plutôt qu'un email direct.

---

## Story s41-public-roadmap — Voter pour les prochaines fonctionnalités
**As a** User **I want** proposer une fonctionnalité et voter pour celles des autres **so that** le produit évolue selon les besoins réels.

### Complexity
3

### Acceptance criteria
- [ ] Une page publique liste les propositions par statut (proposé, prévu, en cours, livré)
- [ ] Un utilisateur connecté peut proposer une fonctionnalité et voter ; un vote par utilisateur et par proposition
- [ ] Un vote peut être retiré et le compteur se met à jour
- [ ] Un visiteur non connecté voit les propositions et les compteurs mais ne peut ni proposer ni voter
- [ ] Un superadmin peut changer le statut d'une proposition, la fusionner avec une autre ou la masquer
- [ ] La fusion reporte les votes sans créer de doublon de votant
- [ ] Les propositions sont soumises aux limites de débit définies en s25
- [ ] Module non activé : la page n'existe pas et le lien disparaît du pied de page

### Dependencies
s34-admin-users, s25-rate-limiting, s20-marketing-pages

### Agentic notes
Exclusivité MakerKit (plugin roadmap). Dernier module du parcours : bonus assumé.
