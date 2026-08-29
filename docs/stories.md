# User Stories — killer-boilerplate

> Une story = une tranche livrable, écrite pour être exécutée par un agent.
> Id : `s<numéro>-<slug>` — repris dans chaque fichier du pipeline et dans le nom de branche.

**Personas.** `Dev` = le développeur qui démarre un projet depuis le boilerplate (l'utilisateur principal du PRD). `User` = l'utilisateur final du SaaS généré. `Admin` = le superadmin du SaaS généré. `Visiteur` = visiteur non authentifié du site marketing.

**Ordre.** Les stories sont classées par dépendance. Aucune n'assume un travail non encore livré.

---

## Story s01-boot-blank-app — Démarrer une application vide qui tourne
**As a** Dev **I want** cloner le dépôt et obtenir une application qui démarre, connectée à Postgres **so that** je puisse construire dessus sans plomberie préalable.

### Complexity
3

### Acceptance criteria
- [ ] `pnpm install && pnpm dev` démarre l'application Next.js sans erreur, sur un dépôt fraîchement cloné
- [ ] Une variable d'environnement manquante ou malformée fait échouer le démarrage avec un message nommant la variable fautive (validation Zod du `.env`)
- [ ] `pnpm db:migrate` applique les migrations Drizzle sur une base Postgres vide et est idempotent au second lancement
- [ ] `docker compose up` fournit une base Postgres locale utilisable par l'application, sans installation Postgres sur la machine
- [ ] Une route `/api/health` répond 200 avec l'état de la connexion base de données
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` et `pnpm test:e2e` s'exécutent et passent sur le dépôt vide
- [ ] Le workflow GitHub Actions exécute typecheck, lint, tests unitaires et E2E sur chaque push et échoue si l'un d'eux échoue

### Dependencies
Aucune — première story.

### Agentic notes
Squelette du projet : Next.js App Router, TypeScript strict, Drizzle ORM, PostgreSQL, Vitest, Playwright, Docker Compose. Pas encore de module métier ni d'authentification.
Contrainte PRD : aucune donnée ni convention personnelle en dur, toute configuration par `.env` ou `config/`. Le `.env.example` doit être exhaustif et commenté.
Référence : ShipSaaS revendique une architecture en trois couches (présentation / services / persistance) — poser cette séparation dès maintenant, elle conditionne la modularité de s02.
Piège : les migrations Drizzle doivent être versionnées en fichiers SQL (`drizzle-kit generate`), jamais appliquées par `push` en production.

---

## Story s02-module-registry — Activer et désactiver un module par configuration
**As a** Dev **I want** déclarer les modules de mon projet dans une configuration typée **so that** un module désactivé ne laisse ni route, ni navigation, ni table dans mon application.

### Complexity
4

### Acceptance criteria
- [ ] Un module se déclare via un contrat typé exposant au minimum : identifiant, schéma Drizzle, routes, entrées de navigation, traductions, handlers de webhooks
- [ ] `config/features.ts` liste les modules activés ; la configuration est typée et un identifiant inconnu provoque une erreur de compilation
- [ ] Un module désactivé n'expose aucune route : l'accès à une de ses URL renvoie 404
- [ ] Un module désactivé n'apparaît dans aucune entrée de navigation
- [ ] Les migrations d'un module désactivé ne sont pas appliquées : ses tables sont absentes de la base après `pnpm db:migrate`
- [ ] Deux modules de démonstration (l'un activé, l'autre désactivé) prouvent les quatre critères précédents dans les tests
- [ ] La suite de tests passe intégralement avec le module de démonstration activé, puis désactivé

### Dependencies
s01-boot-blank-app

### Agentic notes
**Story la plus structurante du projet — risque maximal.** C'est l'angle n°1 du PRD. Si le contrat de module est mal posé ici, chaque story suivante devra être reprise.
Référence : MakerKit se contente de 13 booléens d'environnement (`NEXT_PUBLIC_ENABLE_TEAM_ACCOUNTS`, `NEXT_PUBLIC_ENABLE_TEAM_ACCOUNTS_BILLING`…) qui masquent l'UI mais laissent les tables `organizations`, `members` et `invitations` en base. Supastarter utilise des fichiers `config.ts` par application. **Aucun des deux ne retire quoi que ce soit** — c'est précisément ce que cette story doit faire.
Piège : la composition du schéma Drizzle. Les migrations doivent être générées par module et assemblées selon la configuration, pas dans un schéma monolithique.
Piège : le typage de `config/features.ts` doit rester utilisable après élagage — un module absent ne doit pas casser la compilation des autres.

---

## Story s03-cli-toggle-module — Activer un module en une commande
**As a** Dev **I want** activer ou désactiver un module par une commande **so that** je n'aie ni à éditer la configuration à la main ni à me souvenir des migrations à jouer.

### Complexity
3

### Acceptance criteria
- [ ] `npx ks list` affiche les modules disponibles et leur état (activé / désactivé)
- [ ] `npx ks toggle <module>` inverse l'état du module dans `config/features.ts` en préservant le formatage du fichier
- [ ] L'activation d'un module propose de générer et d'appliquer ses migrations ; la désactivation prévient que ses tables resteront en base et indique la commande de nettoyage
- [ ] Un identifiant de module inconnu affiche la liste des modules valides et sort en code d'erreur non nul
- [ ] Un toggle suivi du toggle inverse laisse `config/features.ts` identique à son état initial
- [ ] Les commandes sont couvertes par des tests exécutés sur un dépôt temporaire

### Dependencies
s02-module-registry

### Agentic notes
Angle n°2 du PRD : la réversibilité à tout moment, contrairement aux générateurs de scaffolding à la create-t3-app qui décident une fois pour toutes.
Le `eject` (suppression définitive du code, des dépendances et des tables) est explicitement au **cimetière** du PRD : ne pas l'implémenter, ne pas l'amorcer.
Piège : éditer `config/features.ts` sans casser le formatage ni les commentaires. Préférer une manipulation d'AST (ts-morph) à une réécriture par expression régulière.

---

## Story s04-transactional-emails — Envoyer un email transactionnel
**As a** Dev **I want** envoyer un email transactionnel depuis une interface unique **so that** je puisse brancher n'importe quel provider sans toucher au code métier.

### Complexity
3

### Acceptance criteria
- [ ] Une interface `Mailer` typée expose l'envoi d'un email (destinataire, sujet, template, données) et est la seule surface appelée par le code métier
- [ ] L'implémentation Resend envoie réellement l'email lorsque la clé d'API est configurée
- [ ] En développement, sans clé d'API, l'email est capturé et consultable localement au lieu d'être envoyé
- [ ] Un template React Email de démonstration est rendu avec ses données et couvert par un test de rendu
- [ ] Un échec du provider est journalisé et remonté à l'appelant sans faire tomber la requête
- [ ] La documentation décrit la configuration DNS de délivrabilité (SPF, DKIM, DMARC)

### Dependencies
s02-module-registry

### Agentic notes
Placée avant l'authentification : la vérification d'email, le magic link et la réinitialisation de mot de passe en dépendent tous.
Référence : MakerKit expose une abstraction `@kit/mailers` (Resend, Nodemailer, SendGrid) ; Supastarter documente Resend, Postmark et Nodemailer ; ShipFast appelle Resend directement.
Contrainte PRD : **une seule implémentation livrée et testée** (Resend). L'interface existe pour qu'ajouter un provider soit l'écriture d'une classe, pas une refonte.
Piège : ne pas envoyer d'email réel depuis les tests. Le mailer de test doit être injecté, pas conditionné par `NODE_ENV`.

---

## Story s05-signup-signin — Créer un compte et se connecter
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
s04-transactional-emails

### Agentic notes
Better Auth est la solution pressentie par le PRD (à confirmer en phase Research) : elle fournit nativement password, magic link, vérification, réinitialisation et sessions.
Le module `auth` est le premier module réel : il doit respecter le contrat de s02 (schéma, routes, nav, traductions, emails).
Piège : la longueur minimale de mot de passe et les durées de validité des liens sont de la configuration, pas des constantes en dur.
Piège de sécurité : ne jamais différencier les messages d'erreur entre « email inconnu » et « mot de passe faux » (énumération de comptes).

---

## Story s06-app-shell — Naviguer dans l'application connectée
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
s05-signup-signin

### Agentic notes
Première mise à l'épreuve réelle du registre de modules (s02) : la navigation doit se construire à partir des modules actifs, pas d'une liste écrite à la main.
Référence : layout de tableau de bord de MakerKit et de Supastarter — shadcn/ui, Tailwind, thème commutable.
L'avatar est traité en s14 (il dépend du module storage) : ici, initiales ou placeholder.

---

## Story s07-i18n — Utiliser l'application dans sa langue
**As a** User **I want** afficher l'application et recevoir mes emails dans ma langue **so that** je l'utilise sans barrière linguistique.

### Complexity
4

### Acceptance criteria
- [ ] Deux locales sont livrées (français, anglais) ; les routes sont préfixées par la locale
- [ ] Un sélecteur de langue change la locale et persiste le choix entre deux sessions
- [ ] Aucune chaîne visible n'est écrite en dur : un test échoue si un texte affiché ne provient pas des fichiers de traduction
- [ ] Chaque module apporte ses propres traductions ; désactiver un module retire ses clés sans casser le chargement des autres
- [ ] Les emails transactionnels existants sont envoyés dans la langue de l'utilisateur destinataire
- [ ] Une clé manquante dans une locale est détectée par un test, et non silencieusement remplacée en production
- [ ] Les écrans déjà livrés (authentification, tableau de bord, paramètres) sont entièrement traduits

### Dependencies
s06-app-shell, s04-transactional-emails

### Agentic notes
**Risque de complexité 4 : dette permanente.** Le PRD impose de poser l'i18n tôt, précisément pour éviter une reprise intégrale plus tard. À partir d'ici, toute story ajoute ses traductions — c'est une règle du contrat de module, à faire respecter en revue.
Référence : Supastarter découpe ses messages en `marketing`, `saas`, `mail` et `shared` avec quatre locales ; MakerKit expose un `NEXT_PUBLIC_LANGUAGE_PRIORITY`.
Piège : le rattrapage sur les écrans déjà livrés est borné aujourd'hui (authentification et shell) et ne le sera plus dans dix stories.

---

## Story s08-oauth-signin — Se connecter avec Google ou GitHub
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
s05-signup-signin

### Agentic notes
Parité 4/4 : les quatre cibles proposent au minimum Google.
Piège : la liaison de comptes par email est la faille classique. Ne lier automatiquement que si le fournisseur atteste l'email comme vérifié.
Piège : ne jamais laisser un compte sans moyen de connexion après un déliement.

---

## Story s09-two-factor — Protéger son compte par double authentification
**As a** User **I want** activer une double authentification **so that** mon compte reste protégé si mon mot de passe fuite.

### Complexity
3

### Acceptance criteria
- [ ] L'activation affiche un QR code TOTP et exige un code valide pour être confirmée
- [ ] Une fois activée, la connexion exige le code TOTP après le mot de passe
- [ ] Dix codes de secours à usage unique sont générés à l'activation, affichés une seule fois, et chacun n'est utilisable qu'une fois
- [ ] Un code TOTP erroné ou rejoué est refusé
- [ ] La désactivation exige un code valide ou le mot de passe courant
- [ ] Les tentatives de vérification échouées sont limitées en nombre par compte

### Dependencies
s06-app-shell

### Agentic notes
Better Auth fournit le plugin `two-factor`. Le coût est dans l'interface : activation, QR code, codes de secours, écran de vérification à la connexion.
Parité Supastarter et MakerKit.
Piège : les codes de secours doivent être stockés hachés, jamais en clair.

---

## Story s10-passkeys — Se connecter sans mot de passe
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
s09-two-factor

### Agentic notes
Better Auth fournit le plugin officiel `@better-auth/passkey` (SimpleWebAuthn) : `plugins: [passkey()]` côté serveur, `passkeyClient()` côté client, plus une migration ajoutant une table `passkey`. Le travail réel est l'interface de gestion et le repli.
Parité Supastarter et MakerKit.
Piège documenté par Better Auth : les erreurs d'enregistrement renvoient toujours un objet de données, l'option `throw: true` est sans effet. L'UI conditionnelle exige `autocomplete="webauthn"` sur le champ.

---

## Story s11-organizations — Travailler dans une organisation
**As a** User **I want** créer une organisation et basculer entre mes organisations **so that** mes données soient séparées par contexte de travail.

### Complexity
4

### Acceptance criteria
- [ ] Un utilisateur crée une organisation avec un nom et un slug ; le slug est unique et les slugs réservés (routes système) sont refusés
- [ ] Un sélecteur permet de basculer d'organisation ; l'organisation courante persiste entre deux sessions
- [ ] Toute donnée rattachée à une organisation n'est lisible que par ses membres : un accès depuis une autre organisation renvoie 404, pas 403
- [ ] Le créateur d'une organisation en est propriétaire
- [ ] Les paramètres d'organisation permettent d'en modifier le nom et le slug
- [ ] Module désactivé : l'application fonctionne en mode mono-utilisateur, aucune route ni entrée de navigation d'organisation n'existe, et les tables correspondantes sont absentes de la base
- [ ] La suite de tests passe avec le module activé, puis désactivé

### Dependencies
s06-app-shell

### Agentic notes
**Risque de complexité 4 : le scoping traverse chaque requête et chaque écran.** C'est aussi la story qui prouve l'angle du PRD — un projet solo ne doit garder aucune trace du multi-tenant.
Better Auth fournit le plugin `organization`.
Référence : MakerKit conserve `organizations`, `members` et `invitations` en base même avec `NEXT_PUBLIC_ENABLE_TEAM_ACCOUNTS=false`. C'est exactement le comportement à ne pas reproduire.
Piège : renvoyer 404 et non 403 sur une ressource d'une autre organisation, pour ne pas divulguer son existence.

---

## Story s12-invite-members — Inviter quelqu'un dans son organisation
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
s11-organizations, s04-transactional-emails

### Agentic notes
Parité Supastarter et MakerKit.
Piège : le lien d'invitation est un jeton à usage unique et à durée limitée, distinct de la session.
Piège : le retrait d'un membre doit invalider ses sessions actives sur cette organisation, pas seulement son appartenance.

---

## Story s13-roles-permissions — Limiter les actions selon le rôle
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
- [ ] Chaque combinaison rôle × action sensible est couverte par un test

### Dependencies
s12-invite-members

### Agentic notes
Parité MakerKit (RBAC) et ShipSaaS (CASL). Better Auth fournit un contrôle d'accès dans le plugin `organization`.
Piège : masquer un bouton n'est pas une permission. Chaque critère doit être testé au niveau de l'API, pas seulement de l'interface.

---

## Story s14-file-storage-avatar — Envoyer un fichier et changer son avatar
**As a** User **I want** téléverser une image de profil **so that** mon compte soit identifiable.

### Complexity
3

### Acceptance criteria
- [ ] Une interface `Storage` typée expose l'obtention d'une URL présignée, la lecture et la suppression, et est la seule surface appelée par le code métier
- [ ] Le téléversement se fait directement vers le stockage via URL présignée, sans transiter par le serveur applicatif
- [ ] Les types MIME et la taille maximale sont contrôlés côté serveur avant l'émission de l'URL présignée
- [ ] L'avatar téléversé s'affiche dans le menu de compte et dans les paramètres ; le remplacement supprime le fichier précédent
- [ ] Un fichier rattaché à une organisation n'est lisible que par ses membres
- [ ] Module désactivé : aucune route de téléversement, et l'avatar retombe sur les initiales sans erreur

### Dependencies
s06-app-shell (s11-organizations si activé, pour le contrôle d'accès par organisation)

### Agentic notes
Contrainte PRD : une seule implémentation livrée (S3 / Cloudflare R2, API compatible S3).
Référence : Supastarter documente S3, R2, DigitalOcean Spaces, MinIO et Supabase Storage ; MakerKit se limite à Supabase Storage.
Piège : valider le type MIME côté serveur, jamais sur la seule extension fournie par le client.

---

## Story s15-subscribe-stripe — Souscrire un abonnement
**As a** User **I want** souscrire un plan payant et gérer mon abonnement **so that** j'accède aux fonctionnalités payantes.

### Complexity
4

### Acceptance criteria
- [ ] Les plans sont définis dans une configuration unique, partagée par la page de tarifs et le checkout : la page de tarifs ne peut pas diverger des plans facturés
- [ ] Le choix d'un plan ouvre un checkout Stripe et le retour de paiement affiche l'abonnement actif
- [ ] Le webhook Stripe met à jour l'état de l'abonnement (actif, en essai, en retard de paiement, annulé) et est idempotent : un webhook rejoué ne produit aucun effet supplémentaire
- [ ] Un webhook à la signature invalide est rejeté avec un code 400 sans modifier l'état
- [ ] Le portail client Stripe est accessible depuis la facturation et permet de changer de plan, de mettre à jour le moyen de paiement et d'annuler
- [ ] Une fonctionnalité réservée à un plan supérieur est refusée côté serveur pour un abonnement inférieur ou expiré
- [ ] Une période d'essai configurée donne accès aux fonctionnalités payantes jusqu'à son terme, puis les retire
- [ ] Une interface `Payments` typée isole Stripe du code métier

### Dependencies
s06-app-shell (s11-organizations si le module est activé, pour rattacher l'abonnement à l'organisation)

### Agentic notes
**Risque de complexité 4 : l'idempotence des webhooks est le point de rupture classique.** Journaliser chaque événement reçu avec son identifiant Stripe et refuser les doublons.
Contrainte PRD : couche d'abstraction provider avec **Stripe comme seule implémentation**. LemonSqueezy, Polar, Creem et Dodo sont au cimetière.
Référence : les quatre cibles proposent Stripe Checkout et le portail client ; Supastarter porte cinq providers.
Piège : l'abonnement se rattache soit à l'utilisateur, soit à l'organisation, selon les modules actifs. Prévoir ce basculement dès maintenant (Supastarter le nomme `billingAttachedTo`).

---

## Story s16-seat-billing — Facturer au nombre de membres
**As a** User **I want** que ma facture suive le nombre de membres de mon organisation **so that** je paie ce que j'utilise réellement.

### Complexity
4

### Acceptance criteria
- [ ] Un plan peut être marqué comme facturé au siège dans la configuration des plans
- [ ] L'ajout d'un membre incrémente la quantité de l'abonnement Stripe ; son retrait la décrémente
- [ ] La quantité facturée est toujours égale au nombre de membres actifs après toute opération d'ajout ou de retrait
- [ ] Une invitation en attente n'est pas facturée ; elle le devient à son acceptation
- [ ] L'ajout d'un membre au-delà d'une limite de sièges configurée est refusé avec un message explicite
- [ ] Un échec de synchronisation Stripe n'ajoute pas le membre : l'opération est atomique et rejouable
- [ ] Module désactivé : la facturation reste au forfait et aucune synchronisation de quantité n'a lieu

### Dependencies
s15-subscribe-stripe, s13-roles-permissions

### Agentic notes
**Risque de complexité 4 : la cohérence entre le nombre de membres et la quantité Stripe.** C'est un état distribué entre deux systèmes ; toute opération doit être rejouable et réconciliable.
Référence : Supastarter expose `seatBased` par plan ; MakerKit annonce une facturation par siège, à l'usage et au forfait.
Piège : la réconciliation au démarrage (comparer la quantité Stripe au nombre réel de membres) évite la dérive silencieuse.

---

## Story s17-marketing-pages — Découvrir le produit et ses tarifs
**As a** Visiteur **I want** consulter la page d'accueil, les tarifs et les mentions légales **so that** je comprenne le produit et puisse le contacter.

### Complexity
2

### Acceptance criteria
- [ ] La page d'accueil est composée de sections réutilisables (héros, fonctionnalités, témoignages, appel à l'action, FAQ) configurables sans modifier leur code
- [ ] La page de tarifs est générée depuis la même configuration de plans que le checkout : ajouter un plan met à jour les deux
- [ ] Le formulaire de contact envoie un email et affiche une confirmation ; un champ invalide affiche une erreur sans envoyer
- [ ] L'inscription à la newsletter enregistre l'email et refuse les doublons sans erreur visible
- [ ] Les pages légales (confidentialité, conditions d'utilisation) existent et sont accessibles depuis le pied de page
- [ ] Chaque page expose un titre, une méta description et des balises Open Graph ; `sitemap.xml` et `robots.txt` sont générés et listent les pages publiques
- [ ] Les pages marketing s'affichent sans session et ne chargent aucun code réservé à l'application connectée

### Dependencies
s07-i18n, s15-subscribe-stripe (configuration des plans)

### Agentic notes
Parité 4/4. ShipFast en fait son argument principal ; Supastarter livre héros, fonctionnalités, tarifs, newsletter et contact.
Le lien avec la configuration des plans est le point qui distingue ce socle d'un template statique : les tarifs affichés et les tarifs facturés ne peuvent pas diverger.
Piège : les pages marketing doivent rester statiques et rapides. Pas de requête base de données au rendu.

---

## Story s18-guest-checkout — Payer sans créer de compte d'abord
**As a** Visiteur **I want** payer directement depuis la page de tarifs **so that** je n'aie pas à créer un compte avant de savoir si j'achète.

### Complexity
3

### Acceptance criteria
- [ ] Depuis la page de tarifs, un visiteur non connecté peut ouvrir un checkout sans compte préalable
- [ ] Après paiement, un compte est créé automatiquement avec l'email du paiement et l'abonnement lui est rattaché
- [ ] Le visiteur reçoit un email lui permettant de définir son mot de passe ou de se connecter par magic link
- [ ] Si l'email du paiement correspond à un compte existant, l'abonnement est rattaché à ce compte au lieu d'en créer un second
- [ ] Un paiement abandonné ne crée ni compte ni abonnement
- [ ] Un webhook de paiement rejoué ne crée pas de second compte

### Dependencies
s15-subscribe-stripe, s17-marketing-pages

### Agentic notes
Exclusivité ShipSaaS parmi les quatre cibles : « guest checkout qui crée automatiquement le compte ».
Piège principal : la réconciliation entre un paiement anonyme et un compte créé après coup. La création de compte doit se faire depuis le webhook, pas depuis la page de retour — le visiteur peut fermer son navigateur.
Piège de sécurité : ne jamais ouvrir de session automatiquement depuis la page de retour de paiement. Toujours passer par un lien envoyé à l'email vérifié par le paiement.

---

## Story s19-deployment — Déployer l'application en production
**As a** Dev **I want** déployer l'application sur Vercel ou sur mon serveur Coolify **so that** je mette mon SaaS en ligne sans réinventer la chaîne de déploiement.

### Complexity
3

### Acceptance criteria
- [ ] Un `Dockerfile` multi-étapes produit une image de production qui démarre avec les seules variables d'environnement
- [ ] Un `docker-compose.prod.yml` démarre l'application et sa base de données et sert l'application sur un port configurable
- [ ] Les migrations sont jouées au déploiement, avant le basculement du trafic, et un échec de migration interrompt le déploiement
- [ ] Une checklist exhaustive des variables d'environnement de production est documentée et vérifiée au démarrage
- [ ] Le guide Coolify permet un déploiement de bout en bout depuis un dépôt neuf
- [ ] Le guide Vercel permet un déploiement de bout en bout depuis un dépôt neuf
- [ ] Le pipeline CI construit l'image et échoue si le build de production échoue

### Dependencies
s17-marketing-pages

### Agentic notes
Parité 4/4. Supastarter documente Vercel, Render, Fly.io, Netlify, Docker, Coolify et Railway.
Contrainte PRD : Vercel est la cible de référence, Docker et Coolify sont documentés (l'utilisateur opère déjà un Coolify).
Piège : rejouer les migrations au déploiement sans casser une instance en cours de service. Les migrations doivent être rétrocompatibles avec la version encore en ligne.

---

## Story s20-rate-limiting — Résister au spam et aux attaques par force brute
**As a** Dev **I want** que les points d'entrée publics soient limités en débit **so that** mon application ne soit pas spammée ni forcée dès sa mise en ligne.

### Complexity
3

### Acceptance criteria
- [ ] Les tentatives de connexion sont limitées par IP et par compte ; au-delà du seuil, la réponse est 429 avec un en-tête `Retry-After`
- [ ] L'inscription, la réinitialisation de mot de passe, le magic link, l'invitation, le formulaire de contact et le téléversement sont limités avec des seuils configurables
- [ ] Les seuils sont définis dans la configuration, jamais en dur dans le code
- [ ] Un captcha optionnel peut être activé sur les formulaires publics ; désactivé, les formulaires restent pleinement fonctionnels
- [ ] Le dépassement de seuil est journalisé avec l'IP et la route concernées
- [ ] Les limites ne s'appliquent pas aux tests automatisés, sans que le mécanisme puisse être contourné en production

### Dependencies
s17-marketing-pages

### Agentic notes
**Aucune des quatre cibles ne le fournit** — angle n°4 du PRD (conformité et robustesse par défaut).
Piège : le compteur doit être partagé entre instances (Redis ou équivalent), sinon la limite est contournable en scalant horizontalement. Documenter la dégradation en mono-instance.
Piège : limiter par IP seule est insuffisant contre le bourrage d'identifiants ; limiter aussi par compte visé.

---

## Story s21-blog-mdx — Publier un article de blog
**As a** Dev **I want** publier des articles en MDX **so that** mon SaaS ait un canal d'acquisition organique.

### Complexity
3

### Acceptance criteria
- [ ] Un fichier MDX déposé dans le dossier des articles apparaît dans la liste du blog après build, sans autre intervention
- [ ] Un article expose titre, description, date, auteur et tags depuis son frontmatter ; un frontmatter invalide fait échouer le build avec le nom du fichier fautif
- [ ] La liste est paginée et filtrable par tag
- [ ] Chaque article génère ses balises méta et Open Graph, et une image Open Graph par défaut si aucune n'est fournie
- [ ] Un flux RSS est généré et valide
- [ ] Les articles sont traduisibles : un article sans traduction dans la locale courante n'apparaît pas dans cette locale
- [ ] Les articles sont référencés dans `sitemap.xml`

### Dependencies
s17-marketing-pages, s07-i18n

### Agentic notes
Parité Supastarter (MDX multilingue), MakerKit (Markdoc) et ShipFast.
Piège : le rendu MDX ne doit pas exécuter de composant applicatif nécessitant une session.

---

## Story s22-docs-site — Consulter la documentation du produit
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

### Dependencies
s21-blog-mdx

### Agentic notes
Parité Supastarter (Fumadocs avec recherche plein texte) et MakerKit.
Distinction du PRD : il s'agit de la documentation **du SaaS généré**, pas de la documentation du boilerplate destinée à des acheteurs — cette dernière est au cimetière.

---

## Story s23-changelog — Annoncer les nouveautés
**As a** Visiteur **I want** consulter les nouveautés du produit **so that** je voie qu'il évolue.

### Complexity
2

### Acceptance criteria
- [ ] Une entrée de changelog est un fichier MDX avec version, date et catégorie ; un frontmatter invalide fait échouer le build
- [ ] Les entrées sont affichées par ordre chronologique inverse, groupées par version
- [ ] Un flux RSS des nouveautés est généré et valide
- [ ] Les entrées sont traduisibles et référencées dans `sitemap.xml`
- [ ] Module désactivé : la page n'existe pas et le lien disparaît du pied de page

### Dependencies
s22-docs-site

### Agentic notes
Parité MakerKit.
Réutiliser le pipeline MDX de s21 et s22 plutôt que d'en créer un troisième.

---

## Story s24-notifications-inapp — Être notifié dans l'application
**As a** User **I want** voir mes notifications dans l'application et choisir comment être prévenu **so that** je ne rate rien sans être submergé d'emails.

### Complexity
3

### Acceptance criteria
- [ ] Un centre de notifications liste les notifications de l'utilisateur, les plus récentes en premier, paginées
- [ ] Un badge indique le nombre de non-lues et se met à jour après lecture
- [ ] Une notification peut être marquée comme lue individuellement ou toutes à la fois
- [ ] Les préférences permettent d'activer ou désactiver chaque type de notification par canal (in-app, email) et sont respectées à l'émission
- [ ] Une notification émise pour un événement d'organisation n'est visible que par les membres concernés
- [ ] Module désactivé : aucune route ni entrée de navigation de notifications, et les émetteurs existants ne provoquent aucune erreur

### Dependencies
s13-roles-permissions, s04-transactional-emails

### Agentic notes
Le temps réel (websockets, `NEXT_PUBLIC_REALTIME_NOTIFICATIONS` chez MakerKit) est au **cimetière** du PRD : lecture au chargement et à la navigation uniquement.
Parité Supastarter (centre de notifications et préférences email) et MakerKit.
Piège : l'émission d'une notification doit être une seule fonction consultant les préférences, jamais un appel direct au mailer depuis le code métier.

---

## Story s25-background-jobs — Exécuter des traitements en arrière-plan
**As a** Dev **I want** déclencher des jobs asynchrones et des tâches planifiées **so that** les traitements longs ou différés ne bloquent pas les requêtes.

### Complexity
4

### Acceptance criteria
- [ ] Une interface typée expose l'émission d'un événement et la déclaration d'un job, et est la seule surface appelée par le code métier
- [ ] L'implémentation Inngest exécute réellement un job de démonstration déclenché par un événement
- [ ] Une tâche planifiée s'exécute selon son expression cron et son exécution est journalisée
- [ ] Un job en échec est réessayé selon une politique configurable, puis marqué en échec définitif et journalisé
- [ ] Un job est idempotent : la même exécution rejouée ne produit pas d'effet en double
- [ ] Une relance d'essai en fin de période est livrée comme job de démonstration réel et couverte par un test
- [ ] Les jobs s'exécutent en local sans service externe (mode développement documenté)

### Dependencies
s15-subscribe-stripe, s24-notifications-inapp

### Agentic notes
**Risque de complexité 4 : dépendance à une infrastructure externe, difficile à tester.** Le mode développement local doit être documenté et fonctionnel, sinon chaque projet dérivé sera bloqué.
Contrainte PRD : adapter avec **Inngest comme seule implémentation**. trigger.dev, QStash et BullMQ (documentés par Supastarter) restent hors périmètre.
Piège : ne pas exécuter les jobs réels pendant les tests. Le déclencheur doit être injectable.

---

## Story s26-account-deletion — Supprimer son compte ou son organisation
**As a** User **I want** supprimer définitivement mon compte ou mon organisation **so that** je puisse exercer mon droit à l'effacement.

### Complexity
3

### Acceptance criteria
- [ ] La suppression exige une confirmation explicite (saisie de l'email ou du nom de l'organisation)
- [ ] La suppression d'un compte efface ou anonymise ses données dans tous les modules activés, y compris fichiers stockés et notifications
- [ ] La suppression d'une organisation efface ses données, retire ses membres et annule son abonnement chez le provider de paiement
- [ ] Un utilisateur qui est dernier propriétaire d'une organisation doit d'abord transférer ou supprimer celle-ci ; le message le précise
- [ ] Après suppression, les sessions sont révoquées et une reconnexion est impossible
- [ ] Un email de confirmation de suppression est envoyé
- [ ] Un module désactivé n'empêche pas la suppression et ne laisse pas de données orphelines

### Dependencies
s25-background-jobs, s14-file-storage-avatar

### Agentic notes
Parité partielle MakerKit (`NEXT_PUBLIC_ENABLE_PERSONAL_ACCOUNT_DELETION`, `..._TEAM_ACCOUNTS_DELETION`, désactivés par défaut).
Piège majeur : la purge doit traverser **tous les modules activés**. C'est le contrat de module de s02 qui doit porter la responsabilité de suppression, sinon chaque nouveau module créera une fuite de données.
La suppression effective passe par un job de fond (s25) pour rester fiable sur de gros volumes.

---

## Story s27-data-export — Exporter ses données
**As a** User **I want** télécharger l'ensemble de mes données **so that** j'exerce mon droit à la portabilité.

### Complexity
2

### Acceptance criteria
- [ ] Une demande d'export génère une archive contenant les données de l'utilisateur issues de tous les modules activés
- [ ] L'archive est fournie via un lien de téléchargement à durée de validité limitée, envoyé par email
- [ ] Le lien expiré ne permet plus le téléchargement
- [ ] Une demande d'export d'organisation n'est accessible qu'à un owner
- [ ] Les données exportées sont dans un format lisible et documenté (JSON, plus les fichiers joints)
- [ ] Une demande d'export déjà en cours n'en déclenche pas une seconde

### Dependencies
s26-account-deletion

### Agentic notes
**Aucune des quatre cibles ne le fournit** — angle du PRD.
Réutiliser le même contrat de module que la purge de s26 : chaque module déclare ce qu'il exporte et ce qu'il supprime au même endroit.

---

## Story s28-cookie-consent — Choisir ses cookies
**As a** Visiteur **I want** accepter ou refuser les cookies non essentiels **so that** ma navigation respecte mon choix.

### Complexity
2

### Acceptance criteria
- [ ] Une bannière s'affiche à la première visite et permet d'accepter, de refuser et de personnaliser par catégorie
- [ ] Aucun script d'analyse n'est chargé avant un consentement explicite
- [ ] Le refus est respecté et persistant : aucune bannière ni script d'analyse à la visite suivante
- [ ] Le choix est modifiable à tout moment depuis un lien du pied de page
- [ ] La bannière n'apparaît pas si aucun outil d'analyse n'est configuré
- [ ] La bannière est traduite dans toutes les locales livrées

### Dependencies
s17-marketing-pages

### Agentic notes
**Aucune des quatre cibles ne le fournit** — angle du PRD. Obligatoire en Europe dès qu'un outil d'analyse est présent.
Piège : le consentement doit conditionner le **chargement** du script, pas seulement l'envoi des événements.

---

## Story s29-admin-users — Administrer les utilisateurs et les organisations
**As a** Admin **I want** rechercher un utilisateur, agir sur son compte et me connecter à sa place **so that** je puisse assister mes clients et modérer la plateforme.

### Complexity
3

### Acceptance criteria
- [ ] Un back-office réservé aux superadmins liste les utilisateurs avec recherche et pagination ; un non-superadmin reçoit 404
- [ ] Le détail d'un utilisateur affiche ses organisations, son abonnement et ses sessions actives
- [ ] Un superadmin peut bannir et débannir un compte ; un compte banni ne peut plus se connecter et ses sessions sont révoquées
- [ ] Un superadmin peut révoquer une session et déclencher une réinitialisation de mot de passe
- [ ] L'impersonation ouvre une session au nom de l'utilisateur, affiche un bandeau permanent et permet d'y mettre fin pour revenir au compte superadmin
- [ ] Un superadmin ne peut pas impersonner un autre superadmin
- [ ] La liste des organisations est consultable avec ses membres et son abonnement

### Dependencies
s13-roles-permissions, s15-subscribe-stripe

### Agentic notes
Le plugin `admin` de Better Auth fournit déjà liste, recherche, pagination, bannissement, réinitialisation, sessions et impersonation avec garde-fou sur les autres administrateurs. Le travail réel est l'interface et la vue organisations.
Parité Supastarter (superadmin et impersonation), MakerKit (super admin dashboard) et ShipSaaS (back-office).
Piège : toute action d'impersonation doit être journalisée, y compris sa fin.

---

## Story s30-admin-revenue — Suivre le revenu de la plateforme
**As a** Admin **I want** voir mes indicateurs de revenu et d'abonnements **so that** je pilote mon activité sans ouvrir Stripe.

### Complexity
2

### Acceptance criteria
- [ ] Le back-office affiche le revenu récurrent mensuel, le nombre d'abonnements actifs, d'essais en cours et d'annulations sur la période
- [ ] Les indicateurs sont calculés depuis les données locales d'abonnement, sans appel à l'API du provider au chargement de la page
- [ ] Une période est sélectionnable et les indicateurs se recalculent en conséquence
- [ ] Sans aucun abonnement, la page affiche des valeurs nulles et non une erreur
- [ ] Module de facturation désactivé : la page n'existe pas et son entrée disparaît du back-office

### Dependencies
s29-admin-users

### Agentic notes
Parité ShipSaaS (« suivi du revenu en temps réel ») et MakerKit.
Piège : ne pas interroger l'API Stripe au rendu. Les webhooks de s15 alimentent déjà l'état local, qui fait référence.

---

## Story s31-monitoring-analytics — Observer les erreurs et les usages
**As a** Dev **I want** collecter les erreurs et les événements d'usage **so that** je détecte les incidents et comprenne le comportement de mes utilisateurs.

### Complexity
2

### Acceptance criteria
- [ ] Une erreur non gérée côté serveur et côté client est remontée à Sentry avec sa trace source lisible (source maps envoyées au build)
- [ ] Les données sensibles (mot de passe, jeton, cookie de session) sont filtrées avant envoi
- [ ] Une interface `Analytics` typée expose le suivi d'événement et d'affichage de page, et est la seule surface appelée par le code métier
- [ ] L'implémentation PostHog envoie réellement les événements lorsque la clé est configurée
- [ ] Sans clé configurée, l'application fonctionne normalement et aucun appel réseau d'analyse n'est émis
- [ ] Aucun événement d'analyse n'est émis sans le consentement obtenu en s28
- [ ] Un événement de démonstration (inscription réussie) est suivi de bout en bout et couvert par un test

### Dependencies
s28-cookie-consent

### Agentic notes
Parité 3/4 : Supastarter et MakerKit livrent Sentry ; ShipFast documente une page analytics.
Contrainte PRD : une seule implémentation par interface (Sentry pour les erreurs, PostHog pour l'analyse).
Piège : le filtrage des données sensibles doit être testé, pas seulement configuré.

---

## Story s32-onboarding — Être guidé à la première connexion
**As a** User **I want** être guidé après mon inscription **so that** j'arrive à un espace de travail utilisable sans tâtonner.

### Complexity
3

### Acceptance criteria
- [ ] Après une première inscription, l'utilisateur est dirigé vers un parcours en étapes au lieu du tableau de bord
- [ ] Les étapes affichées dépendent des modules activés : sans le module organisations, l'étape de création d'organisation n'existe pas ; sans facturation, l'étape de choix de plan n'existe pas
- [ ] La progression est persistée : une interruption reprend à l'étape en cours à la reconnexion
- [ ] Le parcours terminé n'est plus proposé et l'utilisateur atteint directement le tableau de bord
- [ ] Une étape facultative peut être passée ; une étape obligatoire ne peut pas l'être
- [ ] Un utilisateur arrivé par invitation rejoint directement l'organisation et saute l'étape de création

### Dependencies
s11-organizations, s15-subscribe-stripe

### Agentic notes
Annoncé par Supastarter (parcours d'intégration en plusieurs étapes). Positionné tard par le PRD : c'est un bonus, pas le socle.
Piège : le parcours est piloté par les modules actifs. Une liste d'étapes écrite en dur casserait l'angle du PRD.

---

## Story s33-mcp-server — Piloter le boilerplate depuis un agent
**As a** Dev **I want** interroger et modifier les modules depuis un agent via MCP **so that** je configure mon projet en langage naturel.

### Complexity
3

### Acceptance criteria
- [ ] Un serveur MCP expose un outil listant les modules et leur état
- [ ] Un outil active ou désactive un module et renvoie les migrations à jouer
- [ ] Un outil génère le squelette d'un nouveau module conforme au contrat de s02 (schéma, routes, navigation, traductions)
- [ ] Toute opération modifiant le dépôt renvoie la liste exacte des fichiers modifiés
- [ ] Une opération refusée (module inconnu, dépôt sale) renvoie une erreur explicite sans modifier le dépôt
- [ ] Le serveur démarre depuis une commande documentée et sa configuration client est fournie

### Dependencies
s03-cli-toggle-module

### Agentic notes
Exclusivité MakerKit parmi les quatre (serveur MCP livré avec le kit).
Réutiliser la logique du CLI de s03 : le serveur MCP est une seconde surface d'appel, jamais une seconde implémentation.
Piège : refuser toute opération sur un dépôt aux modifications non commitées, pour que le développeur puisse toujours annuler.

---

## Story s34-waitlist — Recueillir des inscriptions avant le lancement
**As a** Visiteur **I want** m'inscrire sur une liste d'attente **so that** je sois prévenu au lancement du produit.

### Complexity
2

### Acceptance criteria
- [ ] Une page de liste d'attente capture l'email et confirme l'inscription
- [ ] Un email déjà inscrit affiche la même confirmation sans créer de doublon
- [ ] Un email de confirmation est envoyé à l'inscription
- [ ] Les inscrits sont consultables et exportables en CSV depuis le back-office
- [ ] Le formulaire est soumis aux limites de débit définies en s20
- [ ] Module activé, il peut remplacer la page d'accueil par la liste d'attente sans modifier le code des pages marketing

### Dependencies
s29-admin-users, s20-rate-limiting

### Agentic notes
Exclusivité MakerKit (vendu comme plugin). Positionné en fin de parcours par le PRD : module d'upsell, jamais avant que le socle tourne.

---

## Story s35-feedback-widget — Envoyer un retour depuis l'application
**As a** User **I want** envoyer un retour depuis l'application **so that** je signale un problème sans changer d'outil.

### Complexity
2

### Acceptance criteria
- [ ] Un widget accessible depuis le tableau de bord permet d'envoyer un message avec une catégorie (bug, idée, autre)
- [ ] Le retour est persisté avec son auteur, son organisation et l'URL de la page depuis laquelle il a été envoyé
- [ ] Une notification est envoyée aux superadmins à chaque nouveau retour
- [ ] Les retours sont consultables et filtrables par catégorie et par statut dans le back-office
- [ ] Un retour peut être marqué comme traité
- [ ] Module désactivé : le widget disparaît et aucune route de retour n'existe

### Dependencies
s34-waitlist

### Agentic notes
Exclusivité MakerKit (plugin feedback). Module d'upsell.
Réutiliser le centre de notifications de s24 pour prévenir les superadmins, plutôt qu'un email direct.

---

## Story s36-public-roadmap — Voter pour les prochaines fonctionnalités
**As a** User **I want** proposer une fonctionnalité et voter pour celles des autres **so that** le produit évolue selon les besoins réels.

### Complexity
3

### Acceptance criteria
- [ ] Une page publique liste les propositions par statut (proposé, prévu, en cours, livré)
- [ ] Un utilisateur connecté peut proposer une fonctionnalité et voter ; un vote par utilisateur et par proposition
- [ ] Un vote peut être retiré et le compteur se met à jour
- [ ] Un visiteur non connecté voit les propositions et les compteurs mais ne peut ni proposer ni voter
- [ ] Un superadmin peut changer le statut d'une proposition, la fusionner avec une autre ou la masquer
- [ ] Les propositions sont soumises aux limites de débit définies en s20
- [ ] Module désactivé : la page n'existe pas et le lien disparaît du pied de page

### Dependencies
s35-feedback-widget

### Agentic notes
Exclusivité MakerKit (plugin roadmap). Dernier module du parcours : bonus assumé.
Piège : la fusion de propositions doit reporter les votes sans créer de doublon de votant.
