# User Stories — killer-boilerplate

> Une story = une tranche livrable, écrite pour être exécutée par un agent.
> Id : `s<numéro>-<slug>` — repris dans chaque fichier du pipeline et dans le nom de branche.

**Personas.** `Dev` = le développeur qui démarre un projet depuis le boilerplate (l'utilisateur principal du PRD). `User` = l'utilisateur final du SaaS généré. `Admin` = le superadmin du SaaS généré. `Visiteur` = visiteur non authentifié du site marketing.

**Ordre.** Les stories sont classées par dépendance. Le champ `Dependencies` liste les dépendances **réelles**, pas l'ordre de lecture : deux stories sans dépendance commune peuvent être menées en parallèle.

## Socle non désactivable

Tout n'est pas un module optionnel. Le socle suivant est **toujours actif** et n'a pas de critère « module non activé », parce qu'il s'agit soit d'une dépendance d'infrastructure dont l'absence rend d'autres parcours indéfinis, soit d'une obligation légale :

| Socle | Stories | Pourquoi non désactivable |
|---|---|---|
| Fondations et qualité | s01, s02 | Il n'y a pas d'application sans elles |
| Registre de modules, migrations par module, CLI | s03, s04, s05 | C'est le mécanisme qui rend les autres désactivables |
| Mailer transactionnel | s06 | L'auth (socle) envoie vérification, magic link et réinitialisation. Un mailer optionnel rendrait cinq parcours indéfinis |
| Authentification | s07 | Sans compte, il n'y a pas de SaaS |
| App shell | s08 | Porte la navigation construite depuis les modules actifs |
| Rate limiting | s28 | Protège des points d'entrée du socle (connexion, inscription, réinitialisation). Optionnel, il laisserait toute installation par défaut exposée |
| Suppression de compte et export de données | s34, s35 | Droits RGPD : un droit à l'effacement optionnel n'est pas un droit |
| Consentement aux cookies | s36 | Couper le consentement en gardant l'analytique serait une non-conformité, pas une option. Le module est inerte par construction quand aucun script non essentiel n'est déclaré |

Tout le reste est un **module applicatif optionnel** et **porte son critère « module non activé »** : ce que deviennent ses routes, sa navigation, ses tables sur base vierge, et le comportement de repli des fonctionnalités qui l'interrogeaient.

La règle vise les modules applicatifs, c'est-à-dire ceux qui exposent des routes ou des tables au SaaS généré. **L'outillage du template n'est pas un module** et n'a donc pas d'état off : harnais de qualité (s02), harnais de parcours (s25), recette de modularité (s26) et chaîne de déploiement (s27) font partie du dépôt, pas de l'application livrée.

**Modules requis.** Un module peut déclarer dépendre d'un autre (par exemple la roadmap publique requiert le back-office). La configuration est validée : activer un module sans ses requis échoue. C'est ce qui rend la question « et si tel module est coupé ? » vérifiable mécaniquement plutôt que répétée dans chaque story.

**Sémantique des tables d'un module désactivé.** Un module **jamais activé** n'a jamais joué ses migrations : ses tables n'existent pas. Un module **activé puis désactivé** conserve ses tables et ses données : les supprimer serait une migration destructive, c'est-à-dire `eject`, explicitement au cimetière du PRD. Le toggle est réversible sans perte de données. Aucune commande de nettoyage n'existe et aucune story ne doit en introduire.

**Vérification des intégrations tierces.** Deux régimes, jamais mélangés :
- **En CI** : doublure d'enregistrement (requêtes capturées et assertées) pour les appels sortants, **rejeu d'événements webhook enregistrés** pour les entrants (Stripe, Inngest). Ces tests sont bloquants.
- **Hors CI**, sur commande explicite et clés de test du service (Resend, Stripe, Inngest, PostHog) : tests d'intégration réelle, activés par variable d'environnement, exécutés avant chaque ship.

**Critères non automatisables.** Un critère qui porte sur de la documentation ou sur une opération humaine est soit converti en test de présence ou de schéma, soit marqué **recette manuelle** et tracé dans la revue de la story. Il n'existe pas de troisième régime.

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
Squelette : Next.js App Router, TypeScript strict, Drizzle ORM, PostgreSQL, Docker Compose. Le harnais de qualité et la CI sont livrés en s02.
Contrainte PRD : aucune donnée ni convention personnelle en dur, toute configuration par `.env` ou `config/`.
Référence : ShipSaaS revendique une architecture en trois couches (présentation / services / persistance) — poser cette séparation dès maintenant, elle conditionne s03.
Piège : les migrations Drizzle doivent être versionnées en fichiers SQL (`drizzle-kit generate`), jamais appliquées par `push` en production.

---

## Story s02-quality-harness — Vérifier la qualité du code en une commande
**As a** Dev **I want** un harnais de qualité et une CI qui tourne dès le premier commit **so that** aucune régression ne passe et mes agents de code connaissent les règles du dépôt.

### Complexity
2

### Acceptance criteria
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` et `pnpm test:e2e` s'exécutent et passent sur le dépôt vide
- [ ] `pnpm typecheck` couvre la racine, `tests/` et chaque package ; une erreur de type introduite volontairement dans un test le fait échouer
- [ ] `pnpm lint` échoue sur une violation introduite volontairement et la commande de correction automatique la répare
- [ ] Le lint fait respecter la règle de dépendance des couches (ADR 006) : un import de `domain` vers `infrastructure` échoue
- [ ] `pnpm audit` bloque la CI au seuil « élevé » ; un scan de secrets sur le diff bloque également
- [ ] Chaque package possède un `AGENTS.md` nommant ce qu'il peut importer et ce qu'il ne doit pas contenir ; un test échoue si un package en est dépourvu
- [ ] Un test unitaire et un test end-to-end de démonstration existent et échouent si l'application ne démarre pas
- [ ] Un fichier de conventions pour agents de code (`AGENTS.md` du template généré) décrit l'architecture en couches, les règles de module et les commandes ; un test vérifie sa présence et ses sections obligatoires
- [ ] Le workflow GitHub Actions exécute typecheck, lint, tests unitaires, end-to-end, audit de dépendances et scan de secrets sur chaque push, et échoue si l'un d'eux échoue
- [ ] Le workflow installe en `--frozen-lockfile` et échoue si le lockfile diverge
- [ ] Le workflow démarre une base Postgres de test et joue les migrations avant les tests
- [ ] Un fichier généré par un outil ne salit pas l'arbre : après `pnpm build`, `git status` reste propre

### Dependencies
s01-boot-blank-app

### Agentic notes
Référence : ShipSaaS met en avant ses « 50+ conventions » pour cadrer les agents de code, MakerKit ses « règles LLM pré-configurées pour Cursor, Claude Code et Windsurf ». Parité, pas un angle.
Conditionne s03 : la preuve de modularité s'exprime par « la suite de tests passe module activé, puis non activé ».

---

## Story s03-module-registry — Déclarer et activer un module
**As a** Dev **I want** déclarer les modules de mon projet dans une configuration typée **so that** un module non activé n'expose ni route ni entrée de navigation.

### Complexity
4

### Acceptance criteria
- [ ] Un module se déclare via un contrat typé exposant : identifiant, **modules requis**, schéma Drizzle, routes, entrées de navigation, traductions, **templates d'emails**, handlers de webhooks, **fonction de purge** (données d'un utilisateur ou d'une organisation), **fonction d'export** (mêmes périmètres) et **politique de rétention** déclarant, par catégorie de données, si la suppression efface ou anonymise
- [ ] Un module déclarant une catégorie de données sans politique de rétention fait échouer la compilation
- [ ] Un template d'email déclaré sans version dans chacune des locales livrées fait échouer un test
- [ ] `config/features.ts` liste les modules activés ; la configuration est typée et un identifiant inconnu provoque une erreur de compilation
- [ ] Activer un module sans l'un de ses modules requis fait échouer la validation de configuration, avec un message nommant le module manquant
- [ ] Un module non activé n'expose aucune route : l'accès à une de ses URL renvoie 404
- [ ] Un module non activé n'apparaît dans aucune entrée de navigation
- [ ] Les fonctions de purge et d'export d'un module non activé ne sont pas appelées et leur absence ne provoque aucune erreur
- [ ] Deux modules de démonstration, l'un activé et l'autre non, prouvent chacun des comportements ci-dessus
- [ ] La suite de tests passe intégralement avec le module de démonstration activé, puis non activé

### Dependencies
s02-quality-harness

### Agentic notes
**Story la plus structurante du projet — risque maximal.** C'est l'angle n°1 du PRD. Si le contrat est mal posé ici, chaque story suivante devra être reprise. La composition des migrations par module, l'autre moitié du problème, est isolée en s04 pour réduire la surface de cette story.
Le contrat inclut `purge`, `export`, la **politique de rétention** et les **templates d'emails** **dès maintenant**, avec une déclaration vide pour les modules sans données ni email : les ajouter en s34, s35 ou s09 obligerait à rouvrir la vingtaine de modules écrits entre-temps. C'est la leçon appliquée trois fois plutôt qu'une.
La déclaration de **modules requis** est ce qui remplace la répétition d'un « et si X est coupé ? » dans chaque story : une combinaison incohérente est refusée au lieu d'être découverte à l'exécution.
Référence : MakerKit se contente de 13 booléens d'environnement (`NEXT_PUBLIC_ENABLE_TEAM_ACCOUNTS`…) qui masquent l'UI mais laissent les tables en base. Supastarter utilise des fichiers `config.ts` par application. **Aucun des deux ne retire quoi que ce soit.**

---

## Story s04-module-migrations — Ne pas créer les tables d'un module absent
**As a** Dev **I want** que chaque module possède ses migrations **so that** un projet sans le module n'ait aucune trace de lui en base.

### Complexity
3

### Acceptance criteria
- [ ] Chaque module déclare son schéma Drizzle et ses migrations dans son propre dossier ; aucun schéma monolithique ne subsiste
- [ ] `pnpm db:migrate` sur une base vierge n'applique que les migrations des modules activés
- [ ] Après migration sur base vierge, aucune table appartenant à un module non activé n'existe ; la vérification lit le schéma réel de la base, pas les fichiers de migration
- [ ] Une clé étrangère d'un module vers un module non activé est refusée à la génération, avec un message nommant les deux modules
- [ ] Activer un module génère ses migrations sans toucher à celles des autres modules
- [ ] Un module activé puis désactivé conserve ses tables et ses données ; aucune migration destructive n'est produite
- [ ] Les deux modules de démonstration de s03 prouvent ces comportements dans les tests

### Dependencies
s03-module-registry

### Agentic notes
Découpée de s03 : la composition des migrations est la moitié la plus risquée du registre, et la mélanger au contrat produisait une story dont dépendaient les quarante suivantes.
C'est cette story qui rend vraie la promesse « aucune table inutilisée » du critère de succès n°4 du PRD, vérifiée globalement en s26.
Piège : lire `information_schema` et non les fichiers de migration — c'est la seule vérification qui attrape une table créée par un import transitif.
Piège : une clé étrangère vers un module optionnel est le moyen le plus courant de rendre un module non désactivable sans s'en apercevoir.

---

## Story s05-cli-toggle-module — Activer un module en une commande
**As a** Dev **I want** activer ou désactiver un module par une commande **so that** je n'aie ni à éditer la configuration à la main ni à me souvenir des migrations à jouer.

### Complexity
3

### Acceptance criteria
- [ ] `npx ks list` affiche les modules disponibles, leur état et leurs modules requis
- [ ] `npx ks toggle <module>` inverse l'état du module dans `config/features.ts` en préservant le formatage et les commentaires
- [ ] Activer un module dont un requis est absent propose d'activer aussi le requis, ou refuse et nomme le manquant
- [ ] Désactiver un module dont un autre module actif dépend est refusé, avec le nom du dépendant
- [ ] L'activation génère et propose d'appliquer les migrations du module
- [ ] La désactivation informe que les tables et les données sont conservées et qu'une réactivation les retrouvera ; elle ne supprime ni table ni donnée
- [ ] Un module activé, désactivé, puis réactivé retrouve ses données intactes
- [ ] Un toggle suivi du toggle inverse laisse `config/features.ts` identique à son état initial, dès lors que la liste est dans l'ordre canonique de l'annuaire — état que le CLI établit lui-même, en l'annonçant, à la première bascule (ADR 019)
- [ ] Les commandes sont couvertes par des tests exécutés sur un dépôt temporaire

### Dependencies
s04-module-migrations

### Agentic notes
Angle n°2 du PRD : la réversibilité à tout moment, contrairement aux générateurs de scaffolding à la create-t3-app.
**La réversibilité impose la conservation des données.** Supprimer les tables d'un module désactivé est une migration destructive, c'est-à-dire `eject` — explicitement au **cimetière** du PRD. Ne pas l'implémenter, ne pas l'amorcer, ne mentionner aucune « commande de nettoyage ».
Piège : éditer `config/features.ts` sans casser le formatage. Préférer une manipulation d'AST (ts-morph) à une expression régulière.

---

## Story s06-transactional-emails — Envoyer un email transactionnel
**As a** Dev **I want** envoyer un email transactionnel depuis une interface unique **so that** je puisse brancher n'importe quel provider sans toucher au code métier.

### Complexity
3

### Acceptance criteria
- [ ] Une interface `Mailer` typée expose l'envoi d'un email (destinataire, sujet, template, données) et est la seule surface appelée par le code métier
- [ ] En CI, une doublure d'enregistrement capture les envois et le test asserte destinataire, template et données
- [ ] Hors CI, sur commande explicite, un test contre la clé de test Resend vérifie l'envoi réel
- [ ] En développement, sur drapeau explicite (`EMAIL_LOCAL_CAPTURE=1`), l'email est capturé et consultable localement au lieu d'être envoyé ; sans clé **et** sans drapeau, le démarrage échoue en nommant la variable, et clé et drapeau ensemble sont refusés
- [ ] Un template React Email de démonstration est rendu avec ses données et couvert par un test de rendu
- [ ] Un échec du provider est journalisé et remonté à l'appelant sans faire tomber la requête
- [ ] La documentation de délivrabilité existe et décrit SPF, DKIM et DMARC ; un test vérifie la présence de la section et de ces trois enregistrements

### Dependencies
s03-module-registry

### Agentic notes
**Socle non désactivable** : l'authentification (s07) envoie vérification, magic link et réinitialisation ; les invitations (s16), le guest checkout (s24), la suppression de compte (s34) et l'export (s35) en dépendent aussi. Un mailer optionnel rendrait cinq parcours indéfinis.
Placée avant l'authentification, elle ne livre pas d'email reçu par un utilisateur réel — le premier arrive en s07. C'est la story la plus proche d'une couche technique du lot, assumée pour éviter que s07 porte à la fois l'authentification et l'adapter mail.
**Une seule implémentation de provider : Resend.** La doublure d'enregistrement et la capture locale sont des outils de test, pas des providers : elles ne rendent pas légitime un adapter SMTP ou SendGrid, qui reste au cimetière.
Référence : MakerKit expose `@kit/mailers` (Resend, Nodemailer, SendGrid) ; Supastarter documente Resend, Postmark et Nodemailer ; ShipFast appelle Resend directement.
Piège : le mailer de test doit être injecté, jamais conditionné par `NODE_ENV`.

---

## Story s07-signup-signin — Créer un compte et se connecter
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
- [ ] L'identifiant de session est régénéré à chaque élévation de privilège (connexion, second facteur validé, fin d'impersonation)
- [ ] Le cookie de session est `HttpOnly`, `Secure` et `SameSite` ; il n'est jamais lisible par le JavaScript client
- [ ] Un changement de mot de passe ou d'email révoque les autres sessions actives, vérifié côté serveur et non par retrait d'une liste
- [ ] Les événements de sécurité (connexion, échec, réinitialisation, vérification) sont journalisés avec leur acteur, sans jamais journaliser de secret
- [ ] Le temps de réponse ne distingue pas un compte inconnu d'un mot de passe invalide

### Dependencies
s06-transactional-emails

### Agentic notes
**Socle non désactivable.**
Better Auth est la solution pressentie par le PRD (à confirmer en phase Research) : password, magic link, vérification, réinitialisation et sessions nativement.
Premier module réel : il respecte le contrat de s03 (schéma, routes, nav, traductions, purge, export).
Piège : longueur minimale de mot de passe et durées de validité des liens sont de la configuration, pas des constantes en dur.
Piège de sécurité : ne jamais différencier « email inconnu » et « mot de passe faux » (énumération de comptes).

---

## Story s08-app-shell — Naviguer dans l'application connectée
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
s07-signup-signin

### Agentic notes
**Socle non désactivable** : porte la navigation construite depuis les modules actifs, donc la démonstration vivante de l'angle n°1.
**Écart assumé avec l'ordre du PRD** (« auth → multi-tenant → billing → app shell ») : le shell précède le multi-tenant parce que c'est lui qui prouve la construction de la navigation depuis le registre. L'inverse reviendrait à écrire une navigation en dur puis à la réécrire.
Point d'accroche de s12 (fournisseurs OAuth liés), s13 (2FA) et s14 (passkeys).
L'avatar est traité en s18 : ici, initiales ou placeholder.

---

## Story s09-i18n — Utiliser l'application dans sa langue
**As a** User **I want** afficher l'application et recevoir mes emails dans ma langue **so that** je l'utilise sans barrière linguistique.

### Complexity
4

### Acceptance criteria
- [ ] Deux locales sont livrées (français, anglais) ; module activé, les routes sont préfixées par la locale
- [ ] Un sélecteur de langue change la locale et persiste le choix entre deux sessions
- [ ] Aucune chaîne visible n'est écrite en dur : un test échoue si un texte affiché ne provient pas des fichiers de traduction
- [ ] Chaque module apporte ses propres traductions ; désactiver un module retire ses clés sans casser le chargement des autres
- [ ] Les emails transactionnels sont envoyés dans la langue de l'utilisateur destinataire
- [ ] Un email destiné à un destinataire sans compte (invitation, guest checkout, liste d'attente) est envoyé dans la locale par défaut du site ; la règle est unique et vaut pour tout email présent ou futur
- [ ] Un template d'email déclaré par un module et dépourvu de version dans une locale livrée fait échouer un test, quel que soit le module et sa date d'ajout
- [ ] Une clé manquante dans une locale est détectée par un test, et non silencieusement remplacée en production
- [ ] Les écrans déjà livrés (authentification, tableau de bord, paramètres) sont entièrement traduits
- [ ] **Module non activé** : les routes sont servies sans préfixe de locale, l'application et les emails utilisent la langue par défaut configurée, aucun sélecteur n'apparaît, et aucune redirection de locale n'a lieu
- [ ] Un composant écrit sans connaissance de l'i18n rend le texte attendu dans les deux configurations : le même scénario de test passe module activé et module non activé, sans variante

### Dependencies
s08-app-shell, s06-transactional-emails

### Agentic notes
**Risque de complexité 4 : dette permanente.** Le PRD impose de poser l'i18n tôt pour éviter une reprise intégrale. À partir d'ici, toute story ajoute ses traductions — règle du contrat de module, à faire respecter en revue.
**Les deux derniers critères sont la partie critique** : le critère de succès n°4 du PRD nomme l'i18n parmi les trois modules désactivés de la preuve de modularité (recette en s26). Décider après coup si les routes sont préfixées réécrirait chaque route livrée entre ici et s44.
Référence : Supastarter découpe ses messages en `marketing`, `saas`, `mail` et `shared` ; MakerKit expose `NEXT_PUBLIC_LANGUAGE_PRIORITY`.

---

## Story s10-marketing-site — Découvrir le produit
**As a** Visiteur **I want** consulter la page d'accueil et les mentions légales **so that** je comprenne ce que fait le produit.

### Complexity
2

### Acceptance criteria
- [ ] La page d'accueil est composée de sections réutilisables (héros, fonctionnalités, témoignages, appel à l'action, FAQ) dont le contenu et l'ordre proviennent d'un fichier de configuration typé (`config/marketing.ts`) ; réordonner ou retirer une section ne demande aucune modification de composant
- [ ] Les pages légales (confidentialité, conditions d'utilisation) existent et sont accessibles depuis le pied de page
- [ ] Chaque page expose un titre, une méta description et des balises Open Graph ; `sitemap.xml` et `robots.txt` sont générés et listent les pages publiques
- [ ] Les pages marketing s'affichent sans session et n'émettent aucune requête base de données au rendu
- [ ] Les pages sont traduites dans les locales livrées lorsque l'i18n est activée
- [ ] **Module non activé** : la racine du site redirige vers la connexion, aucune page publique n'est servie, et `sitemap.xml` ne référence rien

### Dependencies
s09-i18n

### Agentic notes
Découpée du bloc marketing initial : les pages publiques ne dépendent pas de la facturation. Les livrer ici, avant la pile billing, évite de sérialiser un quart du fichier (blog, docs, consentement, déploiement, rate limiting) derrière Stripe.
La page de tarifs est une story distincte (s22), parce qu'elle seule dépend de la configuration des offres.
Parité 4/4. ShipFast en fait son argument principal.
Piège : les pages marketing doivent rester statiques et rapides.

---

## Story s11-public-forms — Contacter l'éditeur et s'inscrire à la newsletter
**As a** Visiteur **I want** envoyer un message et m'inscrire à la newsletter **so that** j'entre en relation avec le produit avant d'acheter.

### Complexity
2

### Acceptance criteria
- [ ] Le formulaire de contact envoie un email à l'adresse configurée et affiche une confirmation ; un champ invalide affiche une erreur sans envoyer
- [ ] L'inscription à la newsletter enregistre l'email dans une table d'inscriptions publiques portant une colonne de source, et refuse les doublons sans erreur visible
- [ ] Un email de confirmation d'inscription est envoyé
- [ ] **Module non activé** : aucune route de formulaire public, les liens correspondants disparaissent du site, et la table d'inscriptions est absente d'une base vierge

### Dependencies
s10-marketing-site, s06-transactional-emails

### Agentic notes
La table d'inscriptions publiques livrée ici est **réutilisée par s42-waitlist**, distinguée par sa colonne de source. Ne pas créer un second modèle d'inscription concurrent.
Deux tranches voisines n'appartiennent volontairement pas à cette story : la limitation de débit de ces formulaires est livrée et testée en s28 (qui énumère ses points d'entrée), et la consultation ou l'export CSV des inscrits en s37 avec le back-office. Les revendiquer ici produirait des critères invérifiables au ship de s11.
Piège : l'adresse de destination du contact est de la configuration, jamais une constante.

---

## Story s12-oauth-signin — Se connecter avec Google ou GitHub
**As a** User **I want** me connecter avec mon compte Google ou GitHub **so that** je n'aie pas de mot de passe supplémentaire à gérer.

### Complexity
2

### Acceptance criteria
- [ ] Les boutons Google et GitHub apparaissent sur les écrans d'inscription et de connexion lorsque leurs identifiants sont configurés, et sont masqués sinon
- [ ] Une première connexion OAuth crée le compte avec l'email vérifié par le fournisseur
- [ ] Une connexion OAuth avec un email déjà rattaché à un compte mot de passe lie le fournisseur au compte existant au lieu d'en créer un second
- [ ] Un refus d'autorisation côté fournisseur ramène à la connexion avec un message explicite, sans session ouverte
- [ ] Les fournisseurs liés sont visibles dans les paramètres du compte et peuvent être déliés, sauf s'il s'agit du dernier moyen de connexion
- [ ] **Module non activé** : aucun bouton de fournisseur, aucune route de rappel OAuth, et la table de liaison est absente d'une base vierge

### Dependencies
s07-signup-signin, s08-app-shell

### Agentic notes
Parité 4/4 : les quatre cibles proposent au minimum Google.
Piège : la liaison de comptes par email est la faille classique. Ne lier automatiquement que si le fournisseur atteste l'email comme vérifié.
Piège : ne jamais laisser un compte sans moyen de connexion après un déliement.

---

## Story s13-two-factor — Protéger son compte par double authentification
**As a** User **I want** activer une double authentification **so that** mon compte reste protégé si mon mot de passe fuite.

### Complexity
3

### Acceptance criteria
- [ ] L'activation affiche un QR code TOTP et exige un code valide pour être confirmée
- [ ] Une fois activée, la connexion exige le code TOTP après le mot de passe
- [ ] Dix codes de secours à usage unique sont générés à l'activation, affichés une seule fois, et chacun n'est utilisable qu'une fois
- [ ] Un code TOTP erroné ou rejoué est refusé
- [ ] La désactivation exige le mot de passe courant — **amendé en s13** : `disableTwoFactor` de Better Auth 1.7.2 appelle `validatePassword` avant tout et n'offre aucun crochet pour y substituer un code, si bien que la moitié « ou un code valide » demanderait de réécrire la rotation de session hors de la bibliothèque sans rien ajouter à la sécurité — le mot de passe est la preuve la plus forte des deux
- [ ] **Module non activé** : aucune option de double authentification dans les paramètres, la connexion se termine après le mot de passe, et les tables correspondantes sont absentes d'une base vierge

### Dependencies
s08-app-shell

### Agentic notes
Better Auth fournit le plugin `two-factor`. Le coût est dans l'interface : activation, QR code, codes de secours, écran de vérification.
Parité Supastarter et MakerKit.
**Articulation avec s28-rate-limiting** : aucun compteur local n'est écrit ici, et aucun critère de limitation non plus — il serait invérifiable au ship de cette story. La limitation de l'endpoint de vérification 2FA est livrée et testée en s28, qui l'énumère parmi ses points d'entrée. Une seule logique de limitation dans le code, un seul endroit où elle est prouvée.
Piège : les codes de secours doivent être stockés hachés, jamais en clair.

---

## Story s14-passkeys — Se connecter sans mot de passe
**As a** User **I want** enregistrer une passkey **so that** je me connecte sans mot de passe depuis mes appareils.

### Complexity
3

### Acceptance criteria
- [ ] Depuis les paramètres, l'utilisateur enregistre une passkey ; elle apparaît dans une liste avec son nom et sa date de création
- [ ] Une passkey enregistrée permet de se connecter sans mot de passe
- [ ] Une passkey peut être renommée et révoquée ; une passkey révoquée ne permet plus la connexion
- [ ] Sur un navigateur ou un appareil incompatible WebAuthn, l'option est masquée et les autres moyens de connexion restent accessibles
- [ ] Un échec ou une annulation de l'enregistrement affiche un message clair sans créer d'entrée orpheline
- [ ] **Module non activé** : aucune option de passkey dans les paramètres, aucune route WebAuthn, et la table `passkey` est absente d'une base vierge

### Dependencies
s08-app-shell

### Agentic notes
Dépend du shell, pas de la double authentification : WebAuthn n'a aucun lien avec TOTP, les deux stories peuvent être menées en parallèle.
Better Auth fournit le plugin officiel `@better-auth/passkey` (SimpleWebAuthn) : `plugins: [passkey()]` côté serveur, `passkeyClient()` côté client, plus une migration ajoutant une table `passkey`.
Piège documenté par Better Auth : les erreurs d'enregistrement renvoient toujours un objet de données, l'option `throw: true` est sans effet. L'UI conditionnelle exige `autocomplete="webauthn"` sur le champ.

---

## Story s15-organizations — Travailler dans une organisation
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
s08-app-shell

### Agentic notes
**Risque de complexité 4 : le scoping traverse chaque requête et chaque écran.** C'est aussi la story qui prouve l'angle du PRD — un projet solo ne doit garder aucune trace du multi-tenant.
Better Auth fournit le plugin `organization`.
Référence : MakerKit conserve `organizations`, `members` et `invitations` en base même avec `NEXT_PUBLIC_ENABLE_TEAM_ACCOUNTS=false`. C'est le comportement à ne pas reproduire.
Piège : renvoyer 404 et non 403 sur une ressource d'une autre organisation.
Piège : le rattachement des données (utilisateur ou organisation) doit passer par une seule fonction de résolution du propriétaire, sinon le mode mono-utilisateur duplique chaque requête.

---

## Story s16-invite-members — Inviter quelqu'un dans son organisation
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
s15-organizations, s06-transactional-emails

### Agentic notes
Fait partie du module organisations (requis déclaré : `organizations`) : son état off est celui de s15, elle n'en porte pas un second.
Piège : le lien d'invitation est un jeton à usage unique et à durée limitée, distinct de la session.
Piège : le retrait d'un membre doit invalider ses sessions actives sur cette organisation.

---

## Story s17-roles-permissions — Limiter les actions selon le rôle
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
- [ ] Module organisations non activé : la vérification accorde l'accès au propriétaire des données ; le même scénario de test de permission passe module activé et module non activé, sans variante
- [ ] Chaque combinaison rôle × action sensible est couverte par un test

### Dependencies
s16-invite-members

### Agentic notes
Parité MakerKit (RBAC) et ShipSaaS (CASL). Better Auth fournit un contrôle d'accès dans le plugin `organization`.
Piège : masquer un bouton n'est pas une permission. Chaque critère doit être testé au niveau de l'API.

---

## Story s18-file-storage-avatar — Envoyer un fichier et changer son avatar
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
s08-app-shell, s17-roles-permissions

### Agentic notes
**Écart assumé avec l'ordre du PRD** : le storage précède la facturation parce que l'avatar complète le shell déjà livré, et parce qu'il est la première story à implémenter réellement `purge` et `export` — répétition utile avant que le pack RGPD (s34, s35) en dépende.
Contrainte PRD : une seule implémentation livrée (S3 / Cloudflare R2, API compatible S3).
Référence : Supastarter documente S3, R2, DigitalOcean Spaces, MinIO et Supabase Storage ; MakerKit se limite à Supabase Storage.
Piège : valider le type MIME côté serveur, jamais sur la seule extension fournie par le client.

---

## Story s19-subscribe-stripe — Souscrire un abonnement
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
s08-app-shell, s17-roles-permissions

### Agentic notes
**Risque de complexité 4 : l'idempotence des webhooks est le point de rupture classique.** Journaliser chaque événement reçu avec son identifiant Stripe et refuser les doublons.
Le critère « module non activé » est requis par s22 (page de tarifs), s38 (page de revenus) et s40 (étape de choix d'offre).
Cette story porte la **configuration des offres**, pas la page de tarifs (s22).
Contrainte PRD : abstraction provider avec **Stripe comme seule implémentation**. LemonSqueezy, Polar, Creem et Dodo sont au cimetière.
Piège : l'abonnement se rattache soit à l'utilisateur, soit à l'organisation, selon les modules actifs (Supastarter le nomme `billingAttachedTo`).

---

## Story s20-one-time-purchase — Acheter une fois pour toutes
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
s19-subscribe-stripe, s13-two-factor

### Agentic notes
Nommé dans la ligne Billing du périmètre PRD (« one-time »). Fait partie du module de facturation : son état off est celui de s19.
Différences réelles avec l'abonnement : `mode: payment` au checkout, événements webhook distincts (`checkout.session.completed` sans `subscription`, `charge.refunded`), et un modèle de droit d'accès qui ne peut pas s'appuyer sur l'état d'un abonnement.
Référence : ShipFast vend lui-même en licence unique ; les quatre cibles supportent le paiement unique.
Piège : un droit permanent stocké comme « abonnement toujours actif » casse dès le premier calcul de revenu récurrent (s38).

---

## Story s21-trials-and-gating — Réserver des fonctionnalités aux offres payantes
**As a** Dev **I want** conditionner une fonctionnalité à une offre et proposer un essai **so that** je monétise mon produit sans écrire de logique d'accès à chaque écran.

### Complexity
3

### Acceptance criteria
- [ ] Une fonctionnalité est déclarée comme requérant une offre ou un niveau donné ; la vérification est une fonction unique appelée côté serveur
- [ ] Un accès à une fonctionnalité réservée sans droit suffisant renvoie 403 côté API et affiche une invitation à souscrire côté interface
- [ ] Le droit est accordé aussi bien par un abonnement actif que par un achat unique (s20)
- [ ] Une période d'essai configurée sur une offre donne accès aux fonctionnalités payantes jusqu'à son terme, puis les retire
- [ ] Un essai expiré, un abonnement en retard de paiement et un abonnement annulé après période payée retirent tous l'accès
- [ ] **Module de facturation non activé** : la fonction de vérification accorde l'accès à toutes les fonctionnalités et aucune invitation à souscrire n'apparaît
- [ ] Chaque combinaison état de facturation × fonctionnalité réservée est couverte par un test

### Dependencies
s20-one-time-purchase

### Agentic notes
Le gating interroge un **droit d'accès** consolidé (abonnement OU achat unique OU essai), jamais directement l'état d'un abonnement — sinon s20 est inutilisable.
**Hors périmètre : les quotas quantitatifs génériques** (nombre d'objets, de fichiers). Ils ne sont nommés nulle part dans le périmètre du PRD, et un compteur de consommation est précisément la brique dont la facturation à l'usage — au cimetière — a besoin. Le gating porte sur l'appartenance à une offre, jamais sur un volume consommé. Seule exception, assumée et bornée : la limite de sièges de s23, qui appartient à la facturation au siège du périmètre.
Piège : une vérification côté client seule est une faille. Le critère porte sur l'API.

---

## Story s22-pricing-page — Comparer les offres et choisir
**As a** Visiteur **I want** consulter les tarifs et lancer un achat **so that** je choisisse l'offre qui me convient.

### Complexity
2

### Acceptance criteria
- [ ] La page de tarifs est dérivée de `config/billing.ts` (s19) : ajouter une offre la fait apparaître sans modifier la page
- [ ] Les prix affichés sont ceux envoyés au checkout ; un test compare les deux sources et échoue en cas de divergence
- [ ] Les offres en mode `subscription` et `one_time` sont toutes deux présentables, avec la mention de périodicité adéquate
- [ ] Un visiteur connecté est mené au checkout ; un visiteur non connecté est mené à la connexion, puis au checkout
- [ ] La page est traduite dans les locales livrées lorsque l'i18n est activée
- [ ] **Module de facturation non activé** : la page de tarifs n'existe pas et son lien disparaît de la navigation publique

### Dependencies
s10-marketing-site, s20-one-time-purchase

### Agentic notes
Isolée du site marketing (s10) : c'est la seule page publique qui dépend de la pile de facturation. Les regrouper mettait tout le site derrière Stripe et sérialisait sept stories.
Le critère de non-divergence entre prix affiché et prix facturé est ce qui distingue ce socle d'un template statique.
Le parcours sans compte préalable est traité en s24-guest-checkout.

---

## Story s23-seat-billing — Facturer au nombre de membres
**As a** User **I want** que ma facture suive le nombre de membres de mon organisation **so that** je paie ce que j'utilise réellement.

### Complexity
4

### Acceptance criteria
- [ ] Une offre peut être marquée comme facturée au siège dans la configuration des offres
- [ ] L'ajout d'un membre incrémente la quantité de l'abonnement Stripe ; son retrait la décrémente
- [ ] La quantité facturée est toujours égale au nombre de membres actifs après toute opération d'ajout ou de retrait
- [ ] Une invitation en attente n'est pas facturée ; elle le devient à son acceptation
- [ ] Un échec de synchronisation Stripe n'ajoute pas le membre : l'opération est atomique et rejouable
- [ ] Une commande de réconciliation compare la quantité Stripe au nombre réel de membres et corrige l'écart
- [ ] **Module non activé** : la facturation reste au forfait, aucune synchronisation de quantité n'a lieu, et aucune limite de sièges n'est appliquée

### Dependencies
s21-trials-and-gating, s17-roles-permissions

### Agentic notes
**Découpée après recherche (complexité mesurée 5, pas 4).** La limite de sièges est sortie en `s47-seat-limit` : c'est une règle de refus locale, sans état distribué, et la garder ici mettait quatre choses dures distinctes dans une seule revue. Ce qui reste tient sur un seul thème — garder deux systèmes cohérents.
**Prémisse corrigée par la recherche** : le port `Payments` n'a aujourd'hui aucune méthode d'écriture après création (`packages/ports/src/payments.ts:380`). La quantité n'est transmise qu'au checkout. Cette story doit donc étendre le contrat de port avant toute logique métier.
**Risque de complexité 4 : la cohérence entre le nombre de membres et la quantité Stripe.** État distribué entre deux systèmes ; toute opération doit être rejouable et réconciliable.
Référence : Supastarter expose `seatBased` par offre ; MakerKit annonce siège, usage et forfait. L'usage reste au **cimetière**.
Piège : sans commande de réconciliation, la dérive est silencieuse et ne se découvre qu'à la facture du client.

---

## Story s24-guest-checkout — Payer sans créer de compte d'abord
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
- [ ] **Module non activé** : la page de tarifs mène à la connexion avant tout checkout, et aucune route de checkout anonyme n'existe

### Dependencies
s22-pricing-page, s21-trials-and-gating

### Agentic notes
Exclusivité ShipSaaS parmi les quatre cibles.
Piège principal : la création de compte doit se faire depuis le **webhook**, pas depuis la page de retour — le visiteur peut fermer son navigateur avant la redirection.
Piège de sécurité : ne jamais ouvrir de session automatiquement depuis la page de retour. Toujours passer par un lien envoyé à l'email vérifié par le paiement.

---

## Story s25-golden-path-e2e — Vérifier le parcours clone → premier paiement
**As a** Dev **I want** un test de bout en bout qui rejoue le parcours complet **so that** le critère de succès n°1 du PRD soit vérifié à chaque story et non une seule fois.

### Complexity
3

### Acceptance criteria
- [ ] Un scénario Playwright unique enchaîne : inscription, vérification d'email, création d'organisation, souscription d'une offre, et accès à une fonctionnalité réservée
- [ ] Le scénario part d'une base vierge et d'un jeu de données de seed, sans état résiduel d'une exécution précédente
- [ ] Une variante du scénario couvre l'achat unique, une autre le guest checkout
- [ ] Une phase d'amorçage mesurée précède le scénario : installation des dépendances, configuration de `.env` depuis l'exemple, migration et seed sur une base vierge
- [ ] La durée de l'amorçage, celle du parcours applicatif et leur total sont journalisées à chaque exécution ; c'est ce total qui correspond au « clone → premier paiement » du PRD
- [ ] **En CI**, le scénario s'exécute avec rejeu d'événements webhook Stripe enregistrés, sans appel réseau sortant, et son échec bloque la CI
- [ ] **Hors CI**, sur commande explicite, le même scénario s'exécute contre les clés de test Stripe et un tunnel de webhooks ; il est exécuté avant chaque ship et sa trace consignée dans la revue de la story
- [ ] Le scénario s'exécute sur une commande unique (`pnpm test:golden-path`) et échoue explicitement si une étape dépasse un temps configuré

### Dependencies
s24-guest-checkout

### Agentic notes
Porte le critère de succès n°1 du PRD (« clone → premier paiement en moins de 30 minutes »).
**La phase d'amorçage est dans la mesure** : sans elle, le chrono journalisé exclurait précisément la partie que le boilerplate promet de raccourcir (install, `.env`, première migration).
**Les deux régimes CI / hors CI sont explicites** : la CI est déterministe et bloquante par rejeu d'événements enregistrés ; l'intégration réelle est une commande manuelle avant ship. Les mélanger est la source d'échecs intermittents la plus classique sur ce type de harnais.
Le seuil de 30 minutes reste une recette humaine ; le harnais en fournit la mesure.

---

## Story s26-minimal-profile-check — Prouver qu'un projet minimal ne traîne rien
**As a** Dev **I want** une recette automatisée sur un projet aux modules optionnels coupés **so that** la promesse de modularité soit vérifiée en continu et non affirmée.

### Complexity
3

### Acceptance criteria
- [ ] Un profil de configuration « minimal » désactive simultanément multi-tenant, seat billing et i18n, et sert de base à la recette
- [ ] Sous ce profil, l'application démarre et la suite de tests complète passe
- [ ] Aucune route des modules désactivés n'est joignable : chaque URL connue de ces modules renvoie 404
- [ ] Aucune entrée de navigation orpheline n'est rendue : la navigation est comparée à la liste des modules activés
- [ ] Après migration sur base vierge, aucune table appartenant à un module désactivé n'existe ; la comparaison lit le schéma réel de la base
- [ ] Le parcours d'inscription et de connexion fonctionne de bout en bout sous ce profil
- [ ] La recette s'exécute sur une commande unique et en CI, et son échec bloque la CI
- [ ] Ajouter un module désactivé au profil ne demande aucune modification du harnais

### Dependencies
s23-seat-billing, s09-i18n, s15-organizations, s02-quality-harness

### Agentic notes
Porte le **critère de succès n°4 du PRD** — « aucune route morte, aucune entrée de nav orpheline, aucune table inutilisée ». Chaque story de module teste son propre off ; personne ne testait les trois coupés simultanément, c'est-à-dire précisément l'angle n°1 face à MakerKit.
Symétrique de s25 : s25 prouve que le socle complet mène à un paiement, s26 que le socle réduit ne traîne rien.
Piège : ce harnais doit rester générique. Un profil codé en dur avec trois noms de modules deviendrait faux dès le module suivant.

---

## Story s27-deployment — Déployer l'application en production
**As a** Dev **I want** déployer l'application sur Vercel ou sur mon serveur Coolify **so that** je mette mon SaaS en ligne sans réinventer la chaîne de déploiement.

### Complexity
3

### Acceptance criteria
- [ ] Un `Dockerfile` multi-étapes produit une image de production qui démarre avec les seules variables d'environnement
- [ ] Un `docker-compose.prod.yml` démarre l'application et sa base de données et sert l'application sur un port configurable
- [ ] Les migrations sont jouées au déploiement, avant le basculement du trafic, et un échec de migration interrompt le déploiement
- [ ] Une checklist exhaustive des variables d'environnement de production est documentée ; un test la compare au schéma de validation et échoue en cas d'écart
- [ ] **Recette manuelle** : le guide Coolify permet un déploiement de bout en bout depuis un dépôt neuf ; la trace (URL déployée, date, version) est consignée dans la revue de la story
- [ ] **Recette manuelle** : le guide Vercel permet un déploiement de bout en bout depuis un dépôt neuf ; trace consignée de même
- [ ] Le pipeline CI construit l'image et échoue si le build de production échoue

### Dependencies
s10-marketing-site

### Agentic notes
Parité 4/4. Supastarter documente Vercel, Render, Fly.io, Netlify, Docker, Coolify et Railway.
Contrainte PRD : Vercel est la cible de référence, Docker et Coolify sont documentés (l'utilisateur opère déjà un Coolify).
Piège : les migrations doivent être rétrocompatibles avec la version encore en ligne pendant le basculement.

---

## Story s28-rate-limiting — Résister au spam et aux attaques par force brute
**As a** Dev **I want** que les points d'entrée publics soient limités en débit **so that** mon application ne soit pas spammée ni forcée dès sa mise en ligne.

### Complexity
3

### Acceptance criteria
- [ ] Les tentatives de connexion sont limitées par IP et par compte ; au-delà du seuil, la réponse est 429 avec un en-tête `Retry-After`
- [ ] L'inscription, la réinitialisation de mot de passe, le magic link, la vérification de double authentification, l'invitation, les formulaires publics, le téléversement et l'ouverture d'un checkout anonyme sont limités avec des seuils configurables
- [ ] Un point d'entrée appartenant à un module non activé n'est simplement pas enregistré, sans erreur au démarrage
- [ ] Les seuils sont définis dans la configuration, jamais en dur dans le code
- [ ] Un captcha optionnel peut être activé sur les formulaires publics ; désactivé, les formulaires restent pleinement fonctionnels
- [ ] Le dépassement de seuil est journalisé avec l'IP et la route concernées
- [ ] Le compteur est partagé entre instances ; un test le prouve en simulant deux instances contre le même magasin
- [ ] Les limites sont neutralisables dans les tests par injection, sans variable d'environnement exploitable en production

### Dependencies
s11-public-forms, s07-signup-signin, s13-two-factor, s16-invite-members, s18-file-storage-avatar, s24-guest-checkout

### Agentic notes
**Socle non désactivable** : optionnel, il laisserait toute installation par défaut exposée sur les points d'entrée du socle (connexion, inscription, réinitialisation). **Aucune des quatre cibles ne le fournit** — angle n°4 du PRD.
Les dépendances listent les points d'entrée à protéger : chacun doit exister avant d'être limité. Le troisième critère règle le cas d'un module coupé : l'enregistrement des limites suit les modules actifs.
Absorbe toute limitation locale : aucune autre story n'écrit son propre compteur.
Piège : un compteur en mémoire est contournable en scalant horizontalement. Documenter la dégradation en mono-instance.
Piège : limiter par IP seule est insuffisant contre le bourrage d'identifiants ; limiter aussi par compte visé.

---

## Story s29-blog-mdx — Publier un article de blog
**As a** Dev **I want** publier des articles en MDX **so that** mon SaaS ait un canal d'acquisition organique.

### Complexity
3

### Acceptance criteria
- [ ] Un fichier MDX déposé dans le dossier des articles apparaît dans la liste du blog après build, sans autre intervention
- [ ] Un article expose titre, description, date, auteur et tags depuis son frontmatter ; un frontmatter invalide fait échouer le build avec le nom du fichier fautif
- [ ] La liste est paginée et filtrable par tag
- [ ] Chaque article génère ses balises méta et Open Graph à partir de son frontmatter
- [ ] i18n activée, un article sans traduction dans la locale courante n'apparaît pas dans cette locale ; i18n non activée, tous les articles sont servis dans la langue par défaut
- [ ] **Module non activé** : aucune route de blog, et le lien disparaît de la navigation publique

### Dependencies
s10-marketing-site, s09-i18n

### Agentic notes
Parité Supastarter (MDX multilingue), MakerKit (Markdoc) et ShipFast.
Pose le pipeline MDX réutilisé par s30 et s31.
**Découpée le 04/09** : la syndication — flux RSS, image Open Graph par défaut, et la contribution au plan de site avec la quinzième clé du contrat — part en `s53-blog-syndication`. Le plan de cette story dépassait treize tâches, et la décision structurelle méritait son propre cycle de revue. Ce qui reste ici close seul : on publie un fichier, on le lit.
**Manque du design system à trancher au plan** : `docs/designs/s29-blog-mdx.md` signale que le corps rendu du MDX n'a aucune échelle typographique déclarée — huit rôles d'interface, aucun pour de la prose longue. C'est le seul manque qui bloque le rendu de l'article, et il sert aussi s30 et s31.
Piège : le rendu MDX ne doit pas exécuter de composant applicatif nécessitant une session.

---

## Story s30-docs-site — Consulter la documentation du produit
**As a** Visiteur **I want** parcourir et rechercher la documentation **so that** je trouve comment utiliser le produit.

### Complexity
3

### Acceptance criteria
- [ ] Les pages de documentation sont écrites en MDX et organisées en sections avec une navigation latérale générée depuis l'arborescence
- [ ] Chaque page expose un sommaire de ses titres et un lien d'ancre par section
- [ ] La documentation est traduisible ; une page non traduite retombe sur la locale par défaut avec une mention explicite
- [ ] Les pages de documentation sont référencées dans `sitemap.xml`
- [ ] **Module non activé** : aucune route de documentation, et le lien disparaît de la navigation publique

### Dependencies
s29-blog-mdx

### Agentic notes
Parité Supastarter (Fumadocs avec recherche plein texte) et MakerKit.
**Découpée le 05/09, avant d'écrire le plan.** La recherche a rendu une complexité de 4 avec une ligne de coupe ; le plan aurait dépassé onze tâches. La **recherche plein texte** et la **validation des liens internes au build** partent en `s54-docs-recherche` : les deux demandent la même machinerie — une passe croisée sur l'ensemble du contenu au build — que le reste de la story n'a pas besoin de construire. Ce qui reste ici close seul : on écrit une page, on la parcourt, on la lit.
**Ce que s29 laisse et qui sert directement** : `PROSE_CLASSNAME` et `proseComponents`, c'est-à-dire l'échelle de prose posée dans `docs/design-system.md`. Mais les importer depuis `@repo/module-blog` exigerait `requires: ['blog']` sur la documentation (ADR 018), ce qui est absurde en produit — **où vit l'échelle de prose est la décision structurelle de cette story**, et elle mérite son ADR.
**Le critère du plan de site est devenu bon marché** : s53 a posé la quinzième clé du contrat (`publicUrls`, ADR 054). La documentation la déclare, et rien d'autre.
Distinction du PRD : documentation **du SaaS généré**, pas documentation du boilerplate destinée à des acheteurs — cette dernière est au cimetière.
Piège : l'index de recherche doit être construit au build et servi statiquement, sinon la promesse « sans service externe » se paie en temps de réponse.

---

## Story s31-changelog — Annoncer les nouveautés
**As a** Visiteur **I want** consulter les nouveautés du produit **so that** je voie qu'il évolue.

### Complexity
2

### Acceptance criteria
- [ ] Une entrée de changelog est un fichier MDX avec version, date et catégorie ; un frontmatter invalide fait échouer le build
- [ ] Les entrées sont affichées par ordre chronologique inverse, groupées par version
- [ ] Un flux RSS des nouveautés est généré et valide
- [ ] Les entrées sont traduisibles et référencées dans `sitemap.xml`
- [ ] **Module non activé** : la page n'existe pas, le flux RSS non plus, et le lien disparaît du pied de page

### Dependencies
s29-blog-mdx

### Agentic notes
Parité MakerKit.
Réutiliser le pipeline MDX de s29 plutôt que d'en créer un troisième : trois pipelines MDX divergents sont le principal risque de cette famille de stories.
Piège : le tri par version doit suivre un ordre sémantique (10.0 après 9.0), pas l'ordre lexicographique.

---

## Story s32-notifications-inapp — Être notifié dans l'application
**As a** User **I want** voir mes notifications dans l'application et choisir comment être prévenu **so that** je ne rate rien sans être submergé d'emails.

### Complexity
3

### Acceptance criteria
- [ ] Un centre de notifications liste les notifications de l'utilisateur, les plus récentes en premier, paginées
- [ ] Un badge indique le nombre de non-lues et se met à jour après lecture
- [ ] Une notification peut être marquée comme lue individuellement ou toutes à la fois
- [ ] Les préférences permettent d'activer ou désactiver chaque type de notification par canal (in-app, email) et sont respectées à l'émission
- [ ] Une notification émise pour un événement d'organisation n'est visible que par les membres concernés
- [ ] Tout email correspondant à un **type déclaré dans le registre de préférences** passe par la fonction d'émission unique ; un test vérifie qu'aucun de ces types n'appelle le mailer directement
- [ ] **Module non activé** : aucune route ni entrée de navigation de notifications, les émetteurs existants ne provoquent aucune erreur, et les types déclarés retombent sur un envoi email direct. **Le repli suit le défaut déclaré du canal email** : un type qui déclare `email: false` n'envoie rien module coupé — couper un module ne doit pas ajouter du trafic sortant que la configuration complète n'aurait pas émis, ce qui inverserait « un module désactivé ne laisse aucune trace ». Restriction décidée et argumentée dans l'ADR 057.

### Dependencies
s17-roles-permissions, s06-transactional-emails

### Agentic notes
Le temps réel (websockets, `NEXT_PUBLIC_REALTIME_NOTIFICATIONS` chez MakerKit) est au **cimetière** du PRD : lecture au chargement et à la navigation uniquement.
**Décision de cadrage laissée ouverte pour cette story (04/09)** : le critère 7 — « module non activé, les types déclarés retombent sur un envoi email direct » — exige un point d'émission qui **survit à la coupure du module**, donc un chemin du socle qui consulte un module optionnel avec une absence définie. s37 a le même besoin (la connexion doit refuser un compte banni par un module optionnel). s53 tranche la forme **contributive** (un module alimente le plan de site) sans trancher celle-ci, délibérément : concevoir un mécanisme de capacité sur deux besoins non implémentés serait la généralisation que le cimetière du PRD refuse. C'est donc **cette story** qui la tranche, avec un ADR, en sachant que s37 en héritera.
**Portée du critère sur le mailer** : la règle vise les emails **de notification**, pas tout appel au mailer. Les emails transactionnels d'authentification (vérification, magic link, réinitialisation), l'invitation de s16, le lien de mot de passe de s24, la confirmation de suppression de s34 et le lien d'export de s35 restent des appels directs légitimes et ne doivent pas être refactorés ici.

---

## Story s33-background-jobs — Exécuter des traitements en arrière-plan
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
- [ ] **Module non activé** : l'émission d'un job l'exécute de façon synchrone dans la requête appelante ; les tâches planifiées ne s'exécutent pas et le démarrage le journalise
- [ ] Le mode développement local est documenté et couvert par un test de démarrage sans service externe

### Dependencies
s21-trials-and-gating, s32-notifications-inapp

### Agentic notes
**Risque de complexité 4 : dépendance à une infrastructure externe, difficile à tester.**
**Le repli synchrone du critère « module non activé » n'est pas un confort** : la suppression de compte (s34) et l'export (s35) sont des obligations RGPD du socle et orchestrent leurs traitements par job. Sans repli, couper les jobs supprimerait un droit légal.
Contrainte PRD : adapter avec **Inngest comme seule implémentation**. trigger.dev, QStash et BullMQ restent hors périmètre. La doublure d'enregistrement de CI est un outil de test, pas un second provider.

---

## Story s34-account-deletion — Supprimer son compte ou son organisation

> **Périmètre restreint au serveur le 05/09.** Les écrans sont dans `s34b-suppression-ecrans`. Le critère 1 décrit une saisie de confirmation : elle est **vérifiée côté serveur et mesurée ici**, mais l'écran qui la présente est livré par la tranche suivante.
**As a** User **I want** supprimer définitivement mon compte ou mon organisation **so that** je puisse exercer mon droit à l'effacement.

### Complexity
3

### Acceptance criteria
- [ ] La suppression exige une confirmation explicite (saisie de l'email ou du nom de l'organisation)
- [ ] La suppression appelle la fonction de purge de **chaque module activé** ; un module dont la purge échoue interrompt l'opération et la laisse rejouable
- [ ] La suppression d'un compte efface ses données personnelles dans tous les modules activés, fichiers stockés et notifications compris
- [ ] La suppression applique la politique de rétention **déclarée par chaque module activé**, dérivée du registre et jamais recopiée : une catégorie `erase` disparaît, une catégorie `anonymize` voit le lien vers l'utilisateur rompu sans qu'aucune donnée identifiante ne subsiste. **Le mécanisme d'anonymisation est éprouvé même si aucun module du socle ne le déclare** — un test qui balaierait zéro catégorie serait vert sans rien vérifier
- [ ] La suppression d'une organisation efface ses données, retire ses membres et annule son abonnement chez le provider de paiement
- [ ] Un utilisateur dernier propriétaire d'une organisation doit d'abord la transférer ou la supprimer ; le message le précise
- [ ] Après suppression, les sessions sont révoquées et une reconnexion est impossible
- [ ] Un email de confirmation de suppression est envoyé
- [ ] La suppression aboutit que le module de jobs soit activé ou non : sans lui, elle s'exécute de façon synchrone
- [ ] Un module non activé n'est pas appelé et ne laisse pas de données orphelines

### Dependencies
s33-background-jobs, s18-file-storage-avatar, s19-subscribe-stripe, s17-roles-permissions

### Agentic notes
**Le critère 4 a été corrigé le 05/09, sur mesure.** Il citait « typiquement les
factures et journaux de paiement, dont la conservation est légalement requise ».
Mesuré : `billing` ne stocke **aucune facture** — trois tables, et les deux qui
portent de l'argent ou un événement n'ont **aucun lien vers un utilisateur**
(`billing_webhook_event` : `eventId, type, receivedAt` ; `billing_refunded_payment` :
`providerPaymentId, refundedAt, lastEventId`). Les factures vivent chez Stripe, et
l'obligation légale de conservation est satisfaite là où le document existe.

Ses quatre catégories sont donc déclarées `erase` **à raison** : il n'y a presque
rien de personnel à rompre. Le critère supposait une conception que le dépôt a
délibérément évitée — ce n'est pas un défaut, c'est une bonne propriété, et
changer la rétention de `billing` sur une théorie juridique que personne n'a
vérifiée aurait conservé des lignes dont le produit n'a pas besoin.

**Ce qui reste vrai et devient l'exigence** : sur seize catégories déclarées, une
seule vaut `anonymize` — `demo-notes`, dans `demo-disabled`, un module jamais
activé. Un test du critère balaierait donc **zéro catégorie réelle** dans la
configuration livrée. Le critère demande maintenant explicitement que le
mécanisme soit éprouvé quand même, faute de quoi la story livrerait un
balayage vide sur une exigence RGPD.

### Agentic notes
**Socle non désactivable** : droit à l'effacement. Un droit optionnel n'est pas un droit.
Parité partielle MakerKit (`NEXT_PUBLIC_ENABLE_PERSONAL_ACCOUNT_DELETION`, `..._TEAM_ACCOUNTS_DELETION`, désactivés par défaut).
Le contrat de module de s03 porte déjà `purge` **et la politique de rétention** : cette story les orchestre, elle ne les crée pas. Introduire ici la déclaration de rétention aurait obligé à rouvrir chaque module écrit depuis s03 — l'erreur que s03 évite justement pour `purge` et `export`. Si un module livré entre s03 et ici ne l'a pas implémentée, c'est un manquement à corriger dans ce module.

---

## Story s34b-ecrans-rgpd — Exercer ses droits depuis l'application
**As a** User **I want** supprimer mon compte et exporter mes données depuis l'application **so that** je n'aie pas à appeler une API pour exercer mes droits.

> **Découpée de `s34` le 05/09.** `s34` a livré tout le côté serveur — confirmation vérifiée côté serveur, purge de chaque module activé, rétention, sessions révoquées, email, annulation d'abonnement, repli sans le module de tâches. **Elle n'a livré aucun écran** : le plan n'en portait pas de tâche, ce qui était une omission de plan et non un abandon. La revue l'a relevée. Cette tranche porte la partie visible, et elle seule.

### Complexity
2

### Acceptance criteria
- [ ] L'écran de compte porte une affordance de suppression, séparée des autres cartes et visuellement distincte d'une action réversible
- [ ] La confirmation par saisie de l'email est présentée à l'écran ; la vérification reste **côté serveur**, l'écran ne décide de rien
- [ ] L'écran d'organisation porte la même affordance pour un propriétaire, et rien pour un membre
- [ ] Le refus du dernier propriétaire s'affiche avec son message, sans que l'écran ait à le deviner
- [ ] **Le même écran porte la demande d'export**, et affiche l'état d'une demande en cours plutôt que d'en permettre une seconde
- [ ] **Les refus de l'export sont rendus lisibles** : demande déjà en cours, débit dépassé, et l'échec de mise en file qui répond 503 — aucun ne doit apparaître comme une erreur générique
- [ ] Un parcours navigateur couvre la suppression **et** l'export de bout en bout — c'est aujourd'hui la garantie qui manque : ni `s34` ni `s35` n'ont **aucun** parcours
- [ ] Composé exclusivement des composants du design system

### Dependencies
s34-account-deletion, s35-data-export

### Agentic notes
Le serveur est fait et éprouvé des deux côtés : `POST /api/modules/auth/delete-account`, `POST /organizations/delete` et `POST /auth/data-export` existent, avec leurs refus mesurés. Les commentaires de route disent déjà que la méthode `POST` est choisie « parce que la route est appelée par un `<form>` d'écran » — **ce formulaire est ce que cette story livre**.

**Regroupée le 06/09**, sur constat : `s34` et `s35` livrent deux droits RGPD — effacement et portabilité — **sans aucun point d'entrée utilisateur**, et les deux se posent au même endroit. Même écran, même confirmation par saisie, même famille de refus à rendre lisibles. Les traiter séparément coûterait deux cycles pour une seule surface, et laisserait le second droit inatteignable plus longtemps que le premier.

**Le lien d'export est envoyé par email et sa route est publique** : l'écran ne le rend jamais, il montre l'état de la demande. Ne pas afficher le jeton, ne pas le mettre dans une URL de page.

## Story s35-data-export — Exporter ses données
**As a** User **I want** télécharger l'ensemble de mes données **so that** j'exerce mon droit à la portabilité.

### Complexity
3

### Acceptance criteria
- [ ] Une demande d'export appelle la fonction d'export de chaque module activé et produit une archive
- [ ] L'archive est construite en tâche de fond quand le module de jobs est activé, de façon synchrone sinon
- [ ] L'archive est fournie via un lien de téléchargement à durée de validité limitée, envoyé par email
- [ ] Le lien expiré ne permet plus le téléchargement
- [ ] Une demande d'export d'organisation n'est accessible qu'à un owner
- [ ] Un schéma JSON documenté décrit le contenu de l'archive ; un test valide l'archive produite contre ce schéma
- [ ] Une demande d'export déjà en cours n'en déclenche pas une seconde

### Dependencies
s33-background-jobs, s18-file-storage-avatar, s06-transactional-emails

### Agentic notes
**Socle non désactivable** : droit à la portabilité, pendant obligatoire de s34.
**Aucune des quatre cibles ne le fournit** — angle du PRD.
Symétrique de s34 : même contrat de module (`export` posé en s03), même repli synchrone sans jobs.

---

## Story s36-cookie-consent — Choisir ses cookies
**As a** Visiteur **I want** accepter ou refuser les cookies non essentiels **so that** ma navigation respecte mon choix.

### Complexity
2

### Acceptance criteria
- [ ] Une bannière s'affiche à la première visite et permet d'accepter, de refuser et de personnaliser par catégorie
- [ ] Un script déclaré comme non essentiel n'est injecté qu'après consentement de sa catégorie ; vérifié avec un script factice dont la présence dans le DOM est assertée
- [ ] Le refus est respecté et persistant : à la visite suivante, ni bannière ni script non essentiel
- [ ] Le choix est modifiable à tout moment, et le retrait du consentement empêche l'injection au chargement suivant
- [ ] La gestion du consentement est atteignable **quel que soit l'état du module marketing** : par un lien du pied de page quand il est activé, par une entrée des paramètres de compte du shell quand il ne l'est pas
- [ ] Sur une installation module marketing non activé et analytique activée, un utilisateur connecté peut retirer son consentement et le script cesse d'être injecté
- [ ] Aucun script non essentiel déclaré : aucune bannière n'apparaît et aucun cookie non essentiel n'est posé
- [ ] La bannière est traduite dans toutes les locales livrées

### Dependencies
s08-app-shell, s10-marketing-site

### Agentic notes
**Aucune des quatre cibles ne le fournit** — angle du PRD. Obligatoire en Europe dès qu'un outil d'analyse est présent.
**Deux points d'accès, pas un** (finding F57 de la revue) : le pied de page appartient à s10-marketing-site, qui est un module optionnel. Sur une installation marketing coupé + analytique activée — combinaison légale au regard de s10 et s39 — un point d'accès unique dans le pied de page priverait l'utilisateur de tout moyen de retirer son consentement, c'est-à-dire exactement la non-conformité que ce module existe pour empêcher. s36 étant socle, elle ne peut pas déclarer s10 en module requis : elle doit fonctionner sans lui.
Ce module n'a pas d'état off propre : il est **inerte par construction** quand aucun script non essentiel n'est déclaré (avant-dernier critère). Couper le consentement tout en gardant l'analytics serait une non-conformité, pas une option — d'où le couplage plutôt qu'un booléen.
Les critères portent sur un **registre de scripts non essentiels** et un script factice, pas sur PostHog : l'outil d'analyse arrive en s39, qui dépend de cette story.
Piège : le consentement conditionne le **chargement** du script, pas seulement l'envoi des événements.

---

## Story s55-harnais-sans-env — Rejouer la suite dans la forme de la CI
**As a** Dev **I want** rejouer la suite sans le `.env` du poste **so that** un test qui dépend de mon environnement rougisse chez moi et non en intégration continue.

> **Ajoutée le 06/09**, sur la proposition P29 du retour d'expérience — la mieux étayée du document, parce que son coût d'inaction est mesuré : **trois rouges de CI en trois stories consécutives** (`s32`, `s34` évitée de justesse, `s35`), toujours la même cause.

### Complexity
1

### Acceptance criteria
- [ ] Une commande rejoue la suite **sans le fichier `.env` du dépôt**, avec les seules variables que le job de CI fournit — désarmer les variables du shell ne suffit pas, `loadRootEnv()` les relit sur le disque
- [ ] La commande échoue si un fichier de test lit une variable qu'il n'a pas déclarée, et **nomme le fichier et la variable**
- [ ] Elle est jouée par la CI, ou son absence de la CI est écrite avec sa raison
- [ ] Un test qui déclare l'intégralité de ce qu'il lit passe dans les deux régimes ; la commande ne demande pas de désarmer ce que le harnais fournit légitimement
- [ ] Le plancher : la commande refuse un balayage qui ne trouverait aucun fichier de test

### Dependencies
s02-quality-harness

### Agentic notes
**La règle est déjà écrite deux fois et a été enfreinte trois fois.** `AGENTS.md` la porte depuis `s18`/`s19` (P9), P25bis l'a reprécisée après `s32`, et un précédent exécutable existe dans `tests/admin.test.ts`. Ce qui manque n'est pas une quatrième écriture : c'est la commande. *Une règle qu'aucune commande ne vérifie est de la documentation.*

**Deux formes ont été identifiées, et la seconde est retenue** : un garde dérivé sur la fermeture transitive des imports devinerait ce qui sera lu ; une exécution réelle sans `.env` le **mesure**. Coût : une exécution de suite de plus.

**Piège** : la CI ne fournit pas *rien*, elle fournit un ensemble précis (`DATABASE_URL` et les drapeaux de mode local). La commande doit reproduire **cet** ensemble, pas l'absence totale — sinon elle rougit sur des fichiers corrects et finira désarmée, ce que P8 documente.

## Story s37-admin-users — Administrer les utilisateurs et les organisations

> **DÉCOUPÉE le 05/09** en `s37a-superadmin-et-bannissement`, `s37b-back-office` et `s37c-inscriptions-publiques`, sur verdict de complexité **5** de sa recherche (notée 3 ici avant que quiconque ait ouvert un fichier). Cette entrée reste pour l'historique et ses dépendances ; **ne pas l'implémenter telle quelle**.
**As a** Admin **I want** rechercher un utilisateur, agir sur son compte et me connecter à sa place **so that** je puisse assister mes clients et modérer la plateforme.

### Complexity
3

### Acceptance criteria
- [ ] Le premier superadmin est désigné par une variable d'environnement ou par le seed ; la procédure est documentée et couverte par un test partant d'une base vierge
- [ ] Un superadmin peut promouvoir un autre compte superadmin et révoquer ce rôle ; le dernier superadmin ne peut pas se révoquer lui-même
- [ ] Aucun superadmin configuré : les routes du back-office renvoient 404 et le démarrage journalise un avertissement nommant la variable à définir
- [ ] Un back-office réservé aux superadmins liste les utilisateurs avec recherche et pagination ; un non-superadmin reçoit 404
- [ ] Le détail d'un utilisateur affiche ses organisations, ses droits d'accès et ses sessions actives
- [ ] Un superadmin peut bannir et débannir un compte ; un compte banni ne peut plus se connecter et ses sessions sont révoquées
- [ ] Un superadmin peut révoquer une session et déclencher une réinitialisation de mot de passe
- [ ] L'impersonation ouvre une session au nom de l'utilisateur, affiche un bandeau permanent et permet d'y mettre fin pour revenir au compte superadmin
- [ ] Un superadmin ne peut pas impersonner un autre superadmin
- [ ] Le début et la fin d'une impersonation émettent une entrée dans les logs applicatifs, avec l'identifiant du superadmin et celui de la cible
- [ ] Une liste des organisations, avec recherche et pagination, est accessible aux superadmins lorsque le module organisations est activé ; module coupé, l'entrée disparaît du back-office
- [ ] Le détail d'une organisation affiche ses membres et leurs rôles, son offre et l'état de son abonnement
- [ ] Les inscriptions publiques sont consultables, filtrables par source et exportables en CSV lorsque le module de formulaires publics est activé ; la vue est générique et n'énumère aucune source en dur
- [ ] **Module non activé** : aucune route de back-office, aucun rôle de superadmin, et les modules qui le requièrent ne peuvent pas être activés (validation de configuration de s03)

### Dependencies
s17-roles-permissions, s21-trials-and-gating, s11-public-forms

### Agentic notes
Le plugin `admin` de Better Auth fournit liste, recherche, pagination, bannissement, réinitialisation, sessions et impersonation avec garde-fou. Le travail réel est l'interface, la vue organisations et la consultation des inscriptions publiques — trois tranches qui ont chacune leur critère ici, faute de quoi elles ne seraient ni construites ni testées.
Module requis par s42-waitlist, s43-feedback-widget et s44-public-roadmap : la validation de configuration refuse une combinaison incohérente au lieu de la laisser échouer à l'exécution.
**Précision par rapport au cimetière** : la traçabilité de l'impersonation est une écriture dans les **logs applicatifs**, pas une table d'audit alimentée par chaque module. Le « journal d'audit » reste au cimetière du PRD.

---

## Story s37a-superadmin-et-bannissement — Désigner un superadmin et exclure un compte
**As a** Admin **I want** désigner des superadmins et bannir un compte **so that** la plateforme ait des administrateurs et puisse exclure un utilisateur.

> Tranche 1 de 3 de `s37-admin-users`, découpée sur verdict de complexité **5** de sa recherche. La ligne de coupe suit le risque, pas la taille : cette tranche porte **toute** la décision d'architecture et toute la sécurité. `s42`, `s43` et `s44` ne dépendent que d'elle.

### Complexity
3

### Acceptance criteria
- [ ] Le premier superadmin est désigné par une variable d'environnement ou par le seed ; la procédure est documentée et couverte par un test partant d'une base vierge
- [ ] Un superadmin peut promouvoir un autre compte superadmin et révoquer ce rôle ; le dernier superadmin ne peut pas se révoquer lui-même
- [ ] Aucun superadmin configuré : les routes du back-office renvoient 404 et le démarrage journalise un avertissement nommant la variable à définir
- [ ] Un superadmin peut bannir et débannir un compte ; un compte banni ne peut plus se connecter et ses sessions sont révoquées
- [ ] **Module non activé** : aucun rôle de superadmin, aucune route, et les modules qui le requièrent ne peuvent pas être activés (validation de configuration de s03)

### Dependencies
s17-roles-permissions

### Agentic notes
Le point dur est le critère 4 : le bannissement est une action d'administration, mais **le refus vit sur le chemin de connexion, qui est du socle**. Ne pas faire consulter un module optionnel par `auth`.

## Story s37b-back-office — Consulter et assister un utilisateur

> **DÉCOUPÉE le 06/09** en `s37b1-decompte-et-impersonation` et `s37b2-back-office-lecture`, sur verdict de complexité **4** de sa recherche. Entrée conservée pour l'historique ; **ne pas l'implémenter telle quelle**.
**As a** Admin **I want** parcourir les comptes et me connecter à leur place **so that** je puisse assister mes clients.

> Tranche 2 de 3 de `s37-admin-users`. Aucune autre story n'en dépend.

### Complexity
3

### Acceptance criteria
- [ ] Un back-office réservé aux superadmins liste les utilisateurs avec recherche et pagination ; un non-superadmin reçoit 404
- [ ] Le détail d'un utilisateur affiche ses organisations, ses droits d'accès et ses sessions actives
- [ ] Un superadmin peut révoquer une session et déclencher une réinitialisation de mot de passe
- [ ] L'impersonation ouvre une session au nom de l'utilisateur, affiche un bandeau permanent et permet d'y mettre fin pour revenir au compte superadmin
- [ ] Un superadmin ne peut pas impersonner un autre superadmin
- [ ] Le début et la fin d'une impersonation émettent une entrée dans les logs applicatifs, avec l'identifiant du superadmin et celui de la cible
- [ ] Une liste des organisations, avec recherche et pagination, est accessible aux superadmins lorsque le module organisations est activé ; module coupé, l'entrée disparaît du back-office
- [ ] Le détail d'une organisation affiche ses membres et leurs rôles, son offre et l'état de son abonnement

- [ ] **Tout** décompte de superadmins compte ceux **capables de se connecter**, et non les lignes de rôle — la révocation, le garde-fou de bannissement et la promotion : aucune séquence de gestes permis ne peut laisser la plateforme sans administrateur, ni deux bannissements successifs, ni un bannissement suivi d'une révocation

### Dependencies
s37a-superadmin-et-bannissement, s21-trials-and-gating

### Agentic notes
L'impersonation est une élévation de privilège : rotation de session obligatoire, et journalisation aux deux bouts.

**Le critère de décompte ci-dessus n'est pas cosmétique, et il a déjà été écrit trop étroitement une fois.** s37a a fermé les gestes *uniques* qui laissent la plateforme sans superadmin capable de se connecter, mais **le décompte compte des lignes de rôle et ignore l'état « banni »**. Deux séquences de gestes tous permis restent donc ouvertes, mesurées en revue de ronde 2 :

- bannir un pair, puis **se bannir soi-même** — les deux rendent 200, le décompte voit 2 lignes, la plateforme n'a plus personne ;
- bannir un pair, puis **révoquer l'autre** — la révocation voit 1 ligne et autorise.

Aucune ne se répare seule : la ligne du banni subsiste, donc `SUPERADMIN_EMAIL` ne se redéclenche jamais et il faut un `UPDATE` à la main en production.

**La cause est unique** : `readFacts` compte `admin_platform_role`, et l'état `banned` vit dans le socle, hors de portée d'`AdminAccountsPort` (ADR 058). Corriger le seul prédicat du `delete` **ne fermerait pas** la première séquence — c'est l'erreur exacte que la première rédaction de ce critère induisait. Élargir le port, puis faire consulter le nouveau décompte par `revocationRefusal`, `banRefusal` **et** `grantSuperadmin` (promouvoir un compte banni gonfle le décompte d'un administrateur inutilisable).

Le tableau des chemins balayés est dans `packages/modules/admin/AGENTS.md` ; il est lui aussi trop étroit et se corrige avec ce critère.

## Story s37b1-decompte-et-impersonation — Compter les administrateurs capables d'entrer, et assister un client
**As a** Admin **I want** que tout décompte de superadmins compte ceux qui peuvent se connecter, et pouvoir me connecter à la place d'un utilisateur **so that** la plateforme ne puisse jamais se retrouver sans administrateur et que je puisse assister mes clients.

> **Découpée de `s37b` le 06/09**, sur verdict de complexité **4** de sa recherche — la ligne suit le risque, comme pour `s37`. Cette tranche porte **toute la sécurité** : la dette reportée de `s37a` et l'élévation de privilège. `s37b2` porte le back-office en lecture, et aucune story n'en dépend.

### Complexity
3

### Acceptance criteria
- [ ] **Tout** décompte de superadmins compte ceux **capables de se connecter**, et non les lignes de rôle — la révocation, le garde-fou de bannissement **et la promotion** : aucune séquence de gestes permis ne peut laisser la plateforme sans administrateur, ni deux bannissements successifs, ni un bannissement suivi d'une révocation
- [ ] `grantSuperadmin` prend le même verrou consultatif que les deux autres écritures du rôle : promouvoir ne se fait plus hors sérialisation
- [ ] L'impersonation ouvre une session au nom de l'utilisateur, avec **rotation de session**, et permet d'y mettre fin pour revenir au compte superadmin
- [ ] Un superadmin ne peut pas impersonner un autre superadmin, ni **enchaîner** une impersonation depuis une session empruntée
- [ ] Le début et la fin d'une impersonation émettent une entrée dans les logs applicatifs, avec l'identifiant du superadmin et celui de la cible ; **une session d'impersonation qui expire sans sortie explicite compte comme une fin**
- [ ] **Module non activé** : aucune impersonation possible, et le décompte n'existe pas

### Dependencies
s37a-superadmin-et-bannissement

### Agentic notes
**La dette est mesurée, pas supposée.** Deux séquences de gestes *tous permis* laissent la plateforme sans superadmin capable de se connecter, et **aucune commande ne la répare** — il faut un `UPDATE` à la main en production. Les deux ont été mesurées contre PostgreSQL en revue de `s37a` : bannir un pair puis se bannir soi-même ; bannir un pair puis révoquer l'autre.

**Le correctif n'est pas une jointure.** `admin/src/schema.ts` pose une borne délibérée et motivée : ce fichier est le seul du module à importer `@repo/module-auth`, et c'est ce qui garde les lectures de comptes **derrière le port injecté, donc derrière un identifiant plutôt qu'une adresse** (`docs/security.md` §7). Élargir `AdminAccountsPort` — c'est ce que la revue de `s37a` avait conclu.

**Un décompte corrigé à deux endroits sur trois ne corrige rien.** La première rédaction de ce critère n'imputait l'aveuglement qu'à la révocation, et aurait laissé le chemin ouvert.

**L'impersonation s'écrit à la main.** Tranché le 06/09 par la mesure : le greffon `admin` de Better Auth déclare `banned`, `banReason`, `banExpires` et `impersonatedBy`, or `s37a` a déjà livré `banned`, `bannedAt` et `bannedReason`. L'adopter signifierait un modèle de bannissement en double pour une capacité dont **une seule colonne** est nécessaire. ADR requis, consignant la mesure et non le seul précédent de l'ADR 058.

## Story s37b2-back-office-lecture — Consulter les comptes et les organisations
**As a** Admin **I want** parcourir les comptes et les organisations **so that** je voie ce que j'administre.

> Tranche 2 de 2 de `s37b`. Aucune story n'en dépend, et elle ne close seule que si `s37b1` a livré les gardes.

### Complexity
3

### Acceptance criteria
- [ ] Un back-office réservé aux superadmins liste les utilisateurs avec recherche et pagination ; un non-superadmin reçoit **404**
- [ ] Le détail d'un utilisateur affiche ses organisations, ses droits d'accès et ses sessions actives
- [ ] Un superadmin peut révoquer une session et déclencher une réinitialisation de mot de passe
- [ ] Une liste des organisations, avec recherche et pagination, est accessible aux superadmins lorsque le module organisations est activé ; module coupé, l'entrée disparaît du back-office
- [ ] Le détail d'une organisation affiche ses membres et leurs rôles, son offre et l'état de son abonnement
- [ ] Le bandeau d'impersonation est **permanent** et survit à une navigation complète
- [ ] Composé exclusivement des composants du design system

### Dependencies
s37b1-decompte-et-impersonation, s21-trials-and-gating

### Agentic notes
**404 et non 403** pour un non-superadmin. *(Corrigé le 06/09 : le répartiteur répondait 403 à une protection `role` non satisfaite, ce qui confirmait l'existence du back-office ; **ADR 068** le fait répondre 404 à tout le monde, anonyme compris. La garde reste dans le module pour une autre raison, qui elle survit : elle refuse une session empruntée **avant** de juger le rôle, ce qu'un niveau déclaré ne sait pas exprimer.)*

Le module n'a **aucun écran** aujourd'hui : `adminNavigation` est vide. Tout est neuf, et c'est ce qui fait le poids de cette tranche.

## Story s37c-inscriptions-publiques — Consulter et exporter les inscriptions
**As a** Admin **I want** consulter et exporter les inscriptions publiques **so that** je puisse exploiter les demandes entrantes.

> Tranche 3 de 3 de `s37-admin-users`, la plus détachable : elle ne partage avec les deux autres que la garde de superadmin. **Optionnelle** — reportée après le socle fonctionnel.

### Complexity
2

### Acceptance criteria
- [ ] Les inscriptions publiques sont consultables, filtrables par source et exportables en CSV lorsque le module de formulaires publics est activé ; la vue est générique et n'énumère aucune source en dur

### Dependencies
s37a-superadmin-et-bannissement, s11-public-forms

### Agentic notes
L'export CSV doit être assaini : une cellule commençant par `=`, `+`, `-` ou `@` est une injection de formule.

## Story s38-admin-revenue — Suivre le revenu de la plateforme
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
s37-admin-users, s20-one-time-purchase

### Agentic notes
Parité ShipSaaS (« suivi du revenu en temps réel ») et MakerKit.
S'appuie sur le critère « module de facturation non activé » défini en s19.
Piège signalé en s20 : compter un achat unique comme un abonnement toujours actif fausse le MRR.
Piège : ne pas interroger l'API Stripe au rendu. Les webhooks de s19 et s20 alimentent l'état local, qui fait référence.

---

## Story s39-monitoring-analytics — Observer les erreurs et les usages
**As a** Dev **I want** collecter les erreurs et les événements d'usage **so that** je détecte les incidents et comprenne le comportement de mes utilisateurs.

### Complexity
2

### Acceptance criteria
- [ ] Une erreur non gérée côté serveur et côté client est remontée à Sentry avec sa trace source lisible (source maps envoyées au build)
- [ ] Les données sensibles (mot de passe, jeton, cookie de session) sont filtrées avant envoi ; un test soumet une charge utile contenant ces champs et asserte leur absence dans la requête capturée
- [ ] Une interface `Analytics` typée expose le suivi d'événement et d'affichage de page, et est la seule surface appelée par le code métier
- [ ] En CI, les requêtes d'analyse sont capturées et assertées ; hors CI, sur commande explicite, un test contre un projet PostHog de test vérifie l'envoi réel
- [ ] Sans clé configurée, l'application fonctionne normalement et aucun appel réseau d'analyse n'est émis
- [ ] Le script d'analyse est déclaré comme non essentiel auprès du registre de s36 : aucun chargement ni événement sans consentement
- [ ] Un événement de démonstration (inscription réussie) est suivi de bout en bout et couvert par un test
- [ ] **Module non activé** : aucun script d'analyse déclaré, aucune remontée d'erreur, et la bannière de consentement ne s'affiche plus faute de script non essentiel

### Dependencies
s36-cookie-consent

### Agentic notes
Parité 3/4 : Supastarter et MakerKit livrent Sentry ; ShipFast documente une page analytics.
Contrainte PRD : une seule implémentation par interface (Sentry pour les erreurs, PostHog pour l'analyse).
Le dernier critère referme la boucle avec s36 : couper l'analytics rend le consentement inerte, ce qui est le comportement conforme.
Piège : le filtrage des données sensibles doit être testé, pas seulement configuré.

---

## Story s40-onboarding — Être guidé à la première connexion
**As a** User **I want** être guidé après mon inscription **so that** j'arrive à un espace de travail utilisable sans tâtonner.

### Complexity
3

### Acceptance criteria
- [ ] Après une première inscription, l'utilisateur est dirigé vers un parcours en étapes au lieu du tableau de bord
- [ ] Une étape de profil recueille le nom et, si le module storage est activé, l'avatar ; sans storage, l'étape ne propose que le nom
- [ ] Les étapes affichées dépendent des modules activés : sans le module organisations, l'étape de création d'organisation n'existe pas ; sans le module de facturation, l'étape de choix d'offre n'existe pas
- [ ] La progression est persistée : une interruption reprend à l'étape en cours à la reconnexion
- [ ] Le parcours terminé n'est plus proposé et l'utilisateur atteint directement le tableau de bord
- [ ] Une étape facultative peut être passée ; une étape obligatoire ne peut pas l'être
- [ ] Un utilisateur arrivé par invitation rejoint directement l'organisation et saute l'étape de création
- [ ] **Module non activé** : l'utilisateur atteint directement le tableau de bord après inscription

### Dependencies
s15-organizations, s21-trials-and-gating, s18-file-storage-avatar, s16-invite-members

### Agentic notes
Annoncé par Supastarter. Positionné tard par le PRD : bonus, pas socle.
Les quatre étapes du PRD sont couvertes : profil, organisation, offre, progression persistée.
Piège : le parcours est piloté par les modules actifs. Une liste d'étapes écrite en dur casserait l'angle du PRD — y compris pour le storage, dont dépend l'avatar de l'étape profil.

---

## Story s41-mcp-server — Piloter le boilerplate depuis un agent
**As a** Dev **I want** interroger et modifier les modules depuis un agent via MCP **so that** je configure mon projet en langage naturel.

### Complexity
3

### Acceptance criteria
- [ ] Un serveur MCP expose un outil listant les modules, leur état et leurs modules requis
- [ ] Un outil active ou désactive un module et renvoie les migrations à jouer ; une combinaison incohérente est refusée avec le nom du module manquant
- [ ] Un outil génère le squelette d'un nouveau module conforme au contrat de s03 (schéma, routes, navigation, traductions, purge, export)
- [ ] Toute opération modifiant le dépôt renvoie la liste exacte des fichiers modifiés
- [ ] Une opération refusée (module inconnu, dépôt aux modifications non commitées) renvoie une erreur explicite sans modifier le dépôt
- [ ] Un fichier d'exemple de configuration client est fourni ; un test le valide contre le schéma MCP
- [ ] **Module non activé** : le serveur n'est pas démarrable et sa commande n'est pas exposée

### Dependencies
s05-cli-toggle-module

### Agentic notes
Exclusivité MakerKit parmi les quatre (serveur MCP livré avec le kit).
Réutiliser la logique du CLI de s05 : le serveur MCP est une seconde surface d'appel, jamais une seconde implémentation.
Piège : refuser toute opération sur un dépôt aux modifications non commitées, pour que le développeur puisse toujours annuler.

---

## Story s42-waitlist — Recueillir des inscriptions avant le lancement

> **OPTIONNELLE — reportée le 05/09.** Décision du porteur du projet : le produit est livrable sans elle. À reprendre après le socle fonctionnel.
**As a** Visiteur **I want** m'inscrire sur une liste d'attente **so that** je sois prévenu au lancement du produit.

### Complexity
2

### Acceptance criteria
- [ ] Une page de liste d'attente capture l'email et confirme l'inscription
- [ ] Un email déjà inscrit affiche la même confirmation sans créer de doublon
- [ ] Un email de confirmation est envoyé à l'inscription
- [ ] Les inscriptions créées par ce module portent la source « waitlist » et apparaissent dans la vue générique du back-office filtrée sur cette source
- [ ] Le formulaire est soumis aux limites de débit du socle
- [ ] **Module non activé** : aucune route de liste d'attente et la page d'accueil reste inchangée

### Dependencies
s37-admin-users, s28-rate-limiting, s11-public-forms

### Agentic notes
Exclusivité MakerKit (vendu comme plugin). Module d'upsell : jamais avant que le socle tourne.
**Hors périmètre, retiré** : le remplacement de la page d'accueil par la liste d'attente, que MakerKit propose. Le PRD dit « page waitlist avec capture email » — la story livre une page, pas une bascule du site.
**Réutilise la table d'inscriptions publiques de s11**, distinguée par sa colonne de source. Ne pas créer un second modèle concurrent.
Modules requis déclarés : back-office et formulaires publics.

---

## Story s43-feedback-widget — Envoyer un retour depuis l'application

> **OPTIONNELLE — reportée le 05/09.** Décision du porteur du projet : le produit est livrable sans elle. À reprendre après le socle fonctionnel.
**As a** User **I want** envoyer un retour depuis l'application **so that** je signale un problème sans changer d'outil.

### Complexity
2

### Acceptance criteria
- [ ] Un widget accessible depuis le tableau de bord permet d'envoyer un message avec une catégorie (bug, idée, autre)
- [ ] Le retour est persisté avec son auteur, son organisation et l'URL de la page depuis laquelle il a été envoyé
- [ ] Une notification est envoyée aux superadmins à chaque nouveau retour, via le centre de notifications s'il est activé, par email sinon
- [ ] Les retours sont consultables et filtrables par catégorie et par statut dans le back-office
- [ ] Un retour peut être marqué comme traité
- [ ] **Module non activé** : le widget disparaît et aucune route de retour n'existe

### Dependencies
s32-notifications-inapp, s37-admin-users

### Agentic notes
Exclusivité MakerKit (plugin feedback). Module d'upsell.
Module requis déclaré : back-office. Le centre de notifications n'est pas requis — le repli email est explicite au troisième critère.

---

## Story s44-public-roadmap — Voter pour les prochaines fonctionnalités

> **OPTIONNELLE — reportée le 05/09.** Décision du porteur du projet : le produit est livrable sans elle. À reprendre après le socle fonctionnel.
**As a** User **I want** proposer une fonctionnalité et voter pour celles des autres **so that** le produit évolue selon les besoins réels.

### Complexity
3

### Acceptance criteria
- [ ] Une page publique liste les propositions par statut (proposé, prévu, en cours, livré)
- [ ] Un utilisateur connecté peut proposer une fonctionnalité et voter ; un vote par utilisateur et par proposition
- [ ] Un vote peut être retiré et le compteur se met à jour
- [ ] Un visiteur non connecté voit les propositions et les compteurs mais ne peut ni proposer ni voter
- [ ] Un superadmin peut changer le statut d'une proposition et la masquer ; une proposition masquée disparaît de la page publique sans que ses votes soient supprimés
- [ ] Les propositions sont soumises aux limites de débit du socle
- [ ] **Module non activé** : la page n'existe pas et le lien disparaît du pied de page

### Dependencies
s37-admin-users, s28-rate-limiting, s10-marketing-site

### Agentic notes
Exclusivité MakerKit (plugin roadmap). Dernier module du parcours : bonus assumé.
Module requis déclaré : back-office (changement de statut, masquage).
**Hors périmètre, retirée** : la fusion de propositions. Le PRD dit « roadmap publique avec votes » ; la fusion est un outil de gestion de backlog, et son report de votes sans doublon de votant est un piège coûteux pour un module d'upsell.
**Le masquage est conservé** : une page publique ouverte aux soumissions sans modération est ingérable. C'est une condition d'exploitation, pas un élargissement de périmètre.
Piège : une page publique ouverte au vote est un vecteur de spam au-delà du débit. Exiger un compte vérifié pour proposer.

---

# Stories ajoutées après le cadrage initial

> Ajoutées en cours de route au titre du socle de sécurité (ADR 012) et du dépôt orienté agents (ADR 013). **Leur numéro n'indique pas leur rang d'exécution** : l'ordre reste dérivé des dépendances déclarées, et les ids des stories déjà implémentées ne sont jamais renumérotés.

## Story s45-security-headers — Servir l'application derrière une politique de sécurité stricte
**As a** Dev **I want** que toute réponse porte des en-têtes de sécurité et une politique de sécurité du contenu stricte **so that** mon SaaS résiste aux injections de script et au détournement d'interface dès sa mise en ligne.

### Complexity
3

### Acceptance criteria
- [ ] Toute réponse HTML porte `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` et une politique d'encadrement (`frame-ancestors`)
- [ ] La politique de sécurité du contenu est `default-src 'self'` sans `unsafe-inline` ni `unsafe-eval` en production ; les scripts portent un **nonce par requête**
- [ ] Un script en ligne sans nonce est bloqué par le navigateur ; vérifié par un test end-to-end qui constate l'absence d'exécution
- [ ] Les sources tierces autorisées sont déclarées dans une configuration unique, jamais dispersées ; ajouter une source hors de cette configuration fait échouer un test
- [ ] Les en-têtes sont présents aussi bien sur les pages publiques que sur les routes de l'API
- [ ] Un rapport de violation est collecté en développement, sans dépendre d'un service tiers
- [ ] Un test échoue si `unsafe-inline` ou `unsafe-eval` réapparaît dans la politique de production

### Dependencies
s08-app-shell, s10-marketing-site

### Agentic notes
**Aucune des quatre cibles ne documente de politique de sécurité du contenu** — angle du PRD, section 1 de `docs/security.md`.
Piège principal : Next injecte des scripts en ligne pour l'hydratation. Le nonce doit être généré par requête dans le middleware et propagé, ce qui interdit la mise en cache statique des pages concernées — c'est le compromis à documenter, pas à contourner en autorisant `unsafe-inline`.
Piège : les scripts d'analyse de s39 et le captcha de s28 sont des sources tierces. Elles se déclarent dans la configuration unique, et leur chargement reste soumis au consentement de s36.

---

## Story s46-auth-screens-design — Habiller les écrans d'authentification
**As a** Visiteur **I want** des écrans d'inscription et de connexion cohérents avec le reste du produit **so that** ma première impression ne soit pas celle d'un prototype.

### Complexity
2

### Acceptance criteria
- [ ] Les cinq écrans (`/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, `/verify-email`) utilisent les composants de `packages/ui`, sans balise de formulaire nue
- [ ] Ils respectent `docs/design-system.md` : tokens, typographie, rayon, densité — aucun composant ni token inventé
- [ ] Les deux affordances d'hydratation s'appliquent : `method="post"` littéral, bouton désactivé jusqu'à l'hydratation
- [ ] Aucune chaîne en dur : tout passe par les catalogues (le test de s09 doit mordre)
- [ ] Rendus corrects en clair et en sombre, dans les deux locales, jusqu'à 380 px sans débordement horizontal
- [ ] Les parcours end-to-end de s07 restent verts sans réécriture de leurs assertions

### Dependencies
s08-app-shell, s09-i18n

### Agentic notes
Constaté en revue de s09 : les cinq écrans rendent des `<form>`, `<input>` et `<button>` bruts, `<h1>` à 14 px, en build de production, dans les deux langues et les deux thèmes. Antérieur à s09, hors de son périmètre, jamais couvert par une story — s08 n'a habillé que le shell et le compte.
Ce sont **les premiers écrans qu'un acheteur voit**. Le PRD vend un boilerplate prêt à l'emploi ; un tunnel d'authentification non stylé contredit la promesse avant toute autre considération.
Piège : ne pas modifier le comportement. Les parcours de s07 asservissent des rôles ARIA et des textes ; les traduire en composants du design system doit préserver les rôles, sinon les assertions rougissent et on croira à une régression fonctionnelle.

---

## Story s47-seat-limit — Refuser un membre au-delà de la limite de sièges
**As a** Propriétaire d'organisation **I want** qu'une limite de sièges soit respectée **so that** je ne dépasse pas l'offre que j'ai souscrite.

### Complexity
2

### Acceptance criteria
- [ ] Une limite de sièges peut être configurée sur une offre, et une offre sans limite reste illimitée
- [ ] L'ajout d'un membre au-delà de la limite est refusé **côté serveur**, avec un message nommant la limite atteinte
- [ ] Le refus porte sur l'acceptation d'une invitation, pas sur son envoi — cohérent avec s23, où une invitation en attente n'est pas facturée
- [ ] Une limite abaissée sous le nombre de membres déjà présents n'expulse personne : elle refuse les ajouts suivants
- [ ] **Module de facturation non activé** : aucune limite n'est appliquée

### Dependencies
s23-seat-billing, s17-roles-permissions

### Agentic notes
Sortie de s23 après recherche : c'est une règle d'autorisation locale, sans état distribué entre deux systèmes, et elle n'a pas besoin de la réconciliation qui protège s23.
Le refus n'est pas un 404 : `docs/security.md` §3 réserve le 404 à la ressource d'autrui. Ici l'organisation est bien la sienne, seule l'opération est refusée — même raisonnement que s21 pour une fonctionnalité réservée.
Piège : une limite abaissée en dessous de l'effectif existant. Expulser serait destructeur ; refuser les ajouts suivants est le seul comportement non destructeur.

---

## Story s48-ci-verte — Rendre la CI verte sur la branche par défaut
**As a** Agent ou humain qui reprend le dépôt **I want** que la CI de la branche par défaut soit verte **so that** un rouge signifie enfin quelque chose.

### Complexity
2

### Acceptance criteria
- [ ] `pnpm test` passe sous **les deux** configurations de la matrice, et la configuration socle est jouable par une commande locale documentée — aujourd'hui elle n'existe qu'en CI
- [ ] L'assertion de généricité du critère 8 (`tests/minimal-profile.test.ts`) soit tient sous la configuration socle, soit déclare **pourquoi** elle ne peut pas y tenir — et cette déclaration est elle-même vérifiée : un saut silencieux est refusé
- [ ] `pnpm run audit` distingue **un échec réseau d'un avis de sécurité** : reprise avec attente croissante sur le premier, échec nommé sur le second. Une indisponibilité du registre ne doit ni rougir la porte, ni la rendre verte par défaut
- [ ] La CI de la branche par défaut est verte, vérifiée sur un run réel, et l'état est lu **par événement** (`push` et `pull_request`), jamais au rollup
- [ ] Aucun contrôle n'est retiré, désactivé ni rendu non bloquant pour atteindre le vert

### Dependencies
s02-quality-harness, s26-minimal-profile-check

### Agentic notes
Mesuré le 04/09 : les cinq derniers runs de `dev` échouent. Deux causes distinctes, aucune imputable à la story en vol au moment du constat.
La première est réelle : `extra` (`tests/minimal-profile.test.ts:307`) cherche le premier module **activé, hors socle, hors profil**, non requis par un autre, déclarant à la fois des routes, de la navigation et des tables. La configuration socle coupe `marketing`, `organizations` et `i18n` par `pnpm ks toggle` : le candidat que le test trouve sous « tous » disparaît, et l'assertion `toBeDefined()` tombe. Le test n'a donc **jamais** été jouable dans cette moitié de la matrice. Établir lequel des cinq critères élimine chaque module restant est le travail de la recherche.
La seconde est une fragilité : `pnpm run audit` tombe en `ERR_SOCKET_TIMEOUT` vers `registry.npmjs.org` sans aucune reprise — observé trois fois le 04/09, deux en local, une en CI.
Piège nommé par `docs/killer-saas-feedback.md` (P8) : la sortie facile est de rendre le contrôle non bloquant. C'est exactement le mode d'échec que le dépôt a déjà subi — un scan de secrets rouge sur chaque demande de fusion pendant trois stories, parce qu'un job homonyme vert le rendait invisible.

---

## Story s49-contraste-des-alertes — Rendre les quatre variantes d'alerte lisibles
**As a** Utilisateur **I want** pouvoir lire un message d'alerte **so that** je comprenne pourquoi l'application me refuse quelque chose.

### Complexity
2

### Acceptance criteria
- [ ] Les quatre variantes d'`Alert` (`destructive`, `warning`, `info`, `success`) atteignent au moins **4,5 : 1** de contraste texte sur fond, en clair **et** en sombre
- [ ] Une commande calcule ces contrastes **depuis les jetons** et rougit si l'un d'eux repasse sous le seuil — un jeton retouché plus tard doit faire échouer la porte, pas se voir à l'œil
- [ ] Aucun jeton ni composant inventé hors `docs/design-system.md` ; les valeurs retenues y sont consignées avec leur contraste mesuré
- [ ] Les écrans qui emploient déjà ces variantes sont rendus dans les deux thèmes et vérifiés, sans changement de leur code

### Dependencies
s09-i18n

### Agentic notes
Mesuré en revue de s28 (cinquième ronde), en mode clair, texte sur fond de la variante au-dessus du fond de carte : `destructive` 3,99 : 1 · `info` 3,24 : 1 · `success` 3,03 : 1 · **`warning` 1,83 : 1**. Les quatre sont sous le seuil AA ; `warning` est même sous 3 : 1. En sombre, `warning` donne 7,23 : 1 — le défaut est **le mode clair seul**.
Le calcul de la revue est OKLCH→sRGB→WCAG, fait à la main : le confirmer avec un outil d'audit fait partie du travail, pas de la reprise du chiffre.
Ça compte parce que s28 a déplacé un refus d'authentification de `destructive` vers `warning` : le message est désormais la seule explication qu'un utilisateur bloqué reçoit, dans la variante la moins lisible des quatre.

---

## Story s50-tests-deterministes — Rendre déterministes les trois tests intermittents
**As a** Agent ou humain qui lit la CI **I want** qu'un rouge signifie une régression **so that** je n'apprenne pas à ignorer la porte.

### Complexity
2

### Acceptance criteria
- [ ] `tests/billing.test.ts` n'assère plus un delta **global** de `auth_session` : la propriété est mesurée sur le périmètre du cas, et le cas rougit toujours si une session est ouverte là où il n'en faut aucune
- [ ] `e2e/billing.spec.ts:406` ne dépend plus d'une course entre une redirection et une navigation : la navigation attend l'état qu'elle exige au lieu de le supposer
- [ ] `e2e/two-factor.spec.ts:126` ne dépasse plus son délai de 30 s : ce que le parcours attend est identifié et attendu explicitement, plutôt que supposé arrivé
- [ ] Les trois tests passent **dix fois de suite**, et le compte est journalisé — une stabilité se déclare avec son nombre de passages, jamais par impression
- [ ] Aucune assertion perdue : la mutation qui neutralise la propriété visée rougit toujours, et le nombre de cas exécutés ne baisse pas
- [ ] La cause retenue pour chacun est **écrite à l'endroit du test**, avec la mesure qui l'établit

### Dependencies
s19-subscribe-stripe, s13-two-factor

### Agentic notes
Mesuré pendant s48. `tests/billing.test.ts:5627` (« n'ouvre aucune session, ni sur un identifiant forgé ni sur un authentique ») compare `(await countRows('auth_session')) - before` — un delta **global**, sur une base partagée, pendant que les autres fichiers tournent en parallèle. Cumul de trois relectures indépendantes : **3 rouges sur 23 exécutions complètes**, soit ~13 %.
`e2e/billing.spec.ts:406` échoue en `net::ERR_ABORTED` sur `page.goto` juste après `signIn`, à la même URL à chaque fois. Il a rougi sur les demandes de fusion 7 et 8, **jamais sur `dev`** (0 sur 3). L'écart de conditions vaut d'être vérifié avant d'être corrigé : une PR déclenche **deux runs complets simultanés** (`push` **et** `pull_request`) là où `dev` n'en lance qu'un — la charge doublée est une hypothèse, pas une conclusion. Vérifié pendant s48 : la limitation de débit n'est **pas** en cause (le seul `rate_limit.exceeded` du journal tombe quatre minutes après l'échec, sur une adresse forgée par le parcours de limitation lui-même).
Piège : la sortie facile est d'ajouter une reprise Playwright ou d'élargir un délai. Les deux rendraient le rouge plus rare sans le rendre faux — c'est le mode d'échec que `docs/killer-saas-feedback.md` (P8) documente déjà.
Si l'enquête confirme que la duplication des runs de CI est la cause de l'intermittence navigateur, la réduire est une décision d'infrastructure à prendre pour elle-même : elle double aussi le coût de chaque demande de fusion.
**Troisième cas, ajouté après la fusion de s48** : `e2e/two-factor.spec.ts:126` (« activation, connexion par code, puis connexion par code de secours ») dépasse son délai de 30 s. Observé sur la demande de fusion 7 puis sur le run de `dev` du 04/09, sous la configuration socle. Même famille que les deux autres, autre surface (s13).
**Ces trois tests sont ce qui sépare aujourd'hui `dev` d'une CI verte** : au run `33894919551`, les deux suites unitaires passent (1970/8 sous « tous », 1965/13 sous socle) et les deux jobs de matrice n'échouent que sur un parcours navigateur chacun. C'est donc cette story, et elle seule, qui referme le dernier critère d'acceptation de s48.

---

## Story s51-traces-des-echecs — Archiver les traces des parcours en échec
**As a** Agent ou humain qui diagnostique un rouge de CI **I want** que la trace du parcours échoué soit récupérable **so that** je ne recommence pas chaque diagnostic par une reproduction locale.

### Complexity
1

### Acceptance criteria
- [ ] Un parcours en échec laisse une trace **téléchargeable** depuis le run de CI, vérifié sur un échec réel ou provoqué
- [ ] Le chemin archivé est **dérivé** de la configuration Playwright, jamais recopié — un changement d'`outputDir` ne doit pas rendre l'étape muette
- [ ] L'étape **échoue** si elle ne trouve rien alors qu'un parcours a rougi : un archivage vide ne doit plus être vert
- [ ] La même garantie vaut pour les deux configurations de la matrice

### Dependencies
s02-quality-harness

### Agentic notes
Constaté en s50, en allant chercher la trace d'un parcours rouge : `.github/workflows/ci.yml:176` téléverse `playwright-report/` alors que les traces de ce dépôt vivent dans `test-results/`. Le journal du job dit `No files were found with the provided path` et l'étape reste **verte** — un `upload-artifact` qui ne trouve rien ne rougit pas. Depuis que la CI existe, aucun échec de parcours n'a donc laissé de trace exploitable.
Le même fichier porte déjà le correctif à la ligne 303 pour le parcours doré, avec le commentaire qui l'explique : le défaut est connu et isolé, il n'a simplement jamais été reporté ici.
Même famille que le scan de secrets de s28 : **une étape de CI dont le succès ne prouve pas l'exécution**. C'est la deuxième occurrence en deux stories ; le troisième critère ci-dessus est ce qui empêche la troisième.

---

## Story s52-derniers-intermittents — Fermer les intermittents restants
**As a** Agent ou humain qui lit la CI **I want** qu'aucun test ne rougisse au hasard **so that** un rouge signifie toujours une régression.

### Complexity
2

### Acceptance criteria
- [ ] **La liste des cas vit à un seul endroit et son compte se dérive** : `tests/fixtures/intermittents.ts`, dont `tests/intermittents.test.ts` refuse le vide. Trois documents avaient écrit ce compte et les trois avaient vieilli (voir les notes) ; aucune commande ne peut interdire à un quatrième de le réécrire — seule la dérivation le rend inutile, et cette story retire les trois derniers de sa propre section
- [ ] `tests/intermittents.test.ts` refuse une liste vide, une entrée qui désigne un fichier ou un témoin disparu, une entrée sans cause écrite, et **un cas déclaré corrigé sans cause établie**
- [ ] La cause de **chaque** cas de la liste est écrite à l'endroit du test, avec la mesure qui l'établit — ou la mention explicite « non établie », qui laisse le cas ouvert et nommé plutôt que de poser un correctif sur une hypothèse
- [ ] Chaque cas **corrigé** passe dix fois de suite sous le régime qui le faisait rougir, et le compte est journalisé
- [ ] Aucune reprise, aucun délai élargi à l'aveugle, aucun saut : `tests/intermittents.test.ts` refuse `test.slow`, `test.fixme`, `test.setTimeout` et un `test.skip` inconditionnel dans les parcours de la liste, ainsi qu'une reprise dans `playwright.config.ts`
- [ ] Aucune assertion perdue : la mutation qui neutralise la propriété visée rougit toujours

### Dependencies
s48-ci-verte, s28-rate-limiting, s12-oauth-signin

### Agentic notes
Les cas d’origine ont été rencontrés pendant s50 et **délibérément non corrigés** : l'interdit de cette story disait de nommer sans élargir.
`tests/audit-exceptions.test.ts` rend `expected 2 to be 3` — deux tentatives au lieu de `AUDIT_ATTEMPTS` avant que le `timeout: 20_000` du `spawnSync` extérieur ne coupe. 1 rouge sur 4 exécutions complètes sous charge, **6/6 vert en isolation**. C'est du code de s48.
`e2e/rate-limiting.spec.ts:38` : 1 rouge sur 11 suites, 24 vertes en isolation. `e2e/oauth.spec.ts` : 1 rouge sur 11, 5 vertes en isolation.
**Corrigé le 05/09, revue de s30** : la liste ne nommait que `e2e/rate-limiting.spec.ts:38` pour ce fichier ; `:163` et `:205` rougissent aussi sous quatre travailleurs et passent seuls comme sous `test:socle`. **Deuxième fois que cette liste nomme un cas sur plusieurs** — après la paire OAuth. Une liste d'intermittents lue comme exhaustive fait attribuer les suivants à la prochaine story qui les rencontre : écrire ce qui a été balayé et sur combien d'exécutions, jamais « les N connus ».
**Deux cas de plus, rencontrés les 04 et 05/09** : `e2e/blog.spec.ts:134` rend `ECONNRESET` sur `GET /fr/blog/aucun-article-de-ce-nom` — vu une fois en revue de s53, vert au rejeu isolé et au second passage complet. Et `e2e/two-factor.spec.ts:162` échoue sur `expect(getByRole('status')).toContainText('Notez ces dix codes')`, élément introuvable après 5 s — vu une fois sur la demande de fusion 11, **jamais sur `dev`**, avec le jumeau du même commit vert en 18,6 s. **Mode d'échec distinct de celui que s50 a réparé** : ce n'est pas le budget de 30 s qui saute, c'est une région qui n'apparaît pas. Ne pas confondre les deux.
**Corrigé le 05/09, revue de s29** : la liste ne nommait que `:97`, or **la paire est `:30`/`:97`** — les deux cas pilotent le fournisseur OAuth local, qui rend toujours la même identité, et celui qui perd la course d'insertion échoue sur `duplicate key value violates unique constraint "auth_user_email_key"`. Une liste qui nomme un cas sur deux se lit comme vérifiée, et le second n'aurait été corrigé par personne. La cause est donc **connue** pour cette paire : ce n'est pas une course de charge, c'est une identité partagée.
**Mesuré à l'exécution de s52 — « quatre travailleurs contre un » est établi pour un cas, et réfuté comme explication d'ensemble.** L'hypothèse était répétée sans mesure. Établie sur `e2e/rate-limiting.spec.ts` : les deux cas de vérification 2FA tiraient leur défi de `Date.now()` seul, et l'écart entre les deux, à quatre travailleurs, vaut 3, 2, 44, 1, 42, 12, 13, 12, 53, 26, 31, 2, 52, **0**, 22 ms sur quinze passages — le passage à 0 ms est celui qui a rougi, les deux cas ensemble ; à un travailleur, les mêmes écarts valent 456, 364, 348, 292 et 107 ms, hors d'atteinte. Réfutée comme explication d'ensemble : les cas de `tests/deployment.test.ts` et `tests/env-wiring.test.ts` n'impliquent aucun travailleur Playwright et se reproduisent **à la demande** en saturant le processeur, contre le délai par défaut de Vitest. Le compte de travailleurs explique un cas, pas la famille — et `docs/killer-saas-feedback.md` (P12) l'avait déjà écarté pour le sien.
**Le compte des cas ne s'écrit plus.** Trois documents l'avaient écrit et les trois ont vieilli : ce critère disait « les trois », la recherche « sept cas sur quatre fichiers » (il y en avait huit, sur cinq fichiers), le plan « onze ». La liste est désormais `tests/fixtures/intermittents.ts`, et un test en refuse le vide.
Piège, le même que s50 : rendre le rouge plus rare n'est pas le rendre juste. Et si l’un d’eux se révèle être une course réelle du produit et non du test, c'est un défaut à traiter comme tel, pas à stabiliser.

---

## Story s53-blog-syndication — Faire trouver les articles
**As a** Dev **I want** que mes articles soient syndiqués et indexés **so that** le canal d'acquisition organique fonctionne réellement.

### Complexity
3

### Acceptance criteria
- [ ] **`robots.txt` autorise `/blog`** — aujourd'hui il l'interdit, et le blog livré par s29 est donc servi sans pouvoir être indexé
- [ ] Un flux RSS est généré et **valide** au sens d'un validateur, pas d'une assertion maison
- [ ] Une image Open Graph par défaut est servie quand l'article n'en fournit pas
- [ ] Les articles sont référencés dans `sitemap.xml`, **et le mécanisme est dérivé** : ni `sitemap.ts` ni `robots.ts` ne connaissent un module de plus par son nom
- [ ] Chaque module de l'annuaire déclare la nouvelle clé, vide s'il n'y contribue pas — un module qui l'omettrait ne compile pas
- [ ] **Module non activé** : aucun flux, aucune URL d'article dans le plan de site, et la clé vide ne casse rien
- [ ] i18n activée, le plan de site porte les alternates par locale comme le fait déjà le site marketing

### Dependencies
s29-blog-mdx, s10-marketing-site

### Agentic notes
**Décision de cadrage tranchée le 04/09, à porter par un ADR de cette story.** `apps/web/app/sitemap.ts` **et** `apps/web/app/robots.ts` importent `@repo/module-marketing` par son nom, et les quatorze clés du contrat n'en prévoient aucune pour qu'un module contribue des URL. Un second import nommé ici en appellerait un troisième en s30. La story ajoute donc **une quinzième clé** — la contribution d'URL au plan de site, dérivée comme `navigation` l'est déjà, mais **calculée** puisque les URL d'articles sont du contenu découvert au build, pas des déclarations statiques.
Coût mesuré le 04/09 : le type, l'agrégation au registre, **onze éditions d'une ligne** (les quatorze clés sont toutes obligatoires, aucune optionnelle — un module minimal comme `mcp-server` les déclare toutes, vides), et les tests. La phrase d'`AGENTS.md` « adding one later means reopening every module already written » décrit une **discipline**, pas une semaine de travail.
La forme symétrique — un chemin du **socle** qui consulte un module optionnel avec une absence définie — n'est **pas** tranchée ici : elle reste ouverte pour s32, qui sera la première à l'exiger, et s37 en héritera.
Piège : `apps/web/app/sitemap.ts` porte `export const dynamic = 'force-dynamic'` pour une raison mesurée — un plan de site figé au build porterait `undefined` dans chaque URL, faute d'`APP_URL` validée à ce moment. Toute contribution hérite de cette contrainte.
**Le trou que la découpe a laissé, relevé en revue de s29 (04/09)** : `marketingRobotsPolicy` rend `disallow: ['/']` plus un `allow` dérivé des seuls `marketingSite.publicPaths`. `/blog` n'y est pas, donc le blog **livré et activé** est interdit d'indexation. Ni s29 ni la première rédaction de s53 ne portaient ce critère — il est ajouté ci-dessus. Tant que cette story n'est pas livrée, le canal d'acquisition que s29 construit ne fonctionne pas : **elle est la suite immédiate de s29, pas une story parmi d'autres.**
L'image Open Graph par défaut est un **manque du design system** signalé par `docs/designs/s29-blog-mdx.md` : ni gabarit, ni dimensions, ni jetons applicables. À trancher : image statique unique, ou gabarit dérivé des jetons.

---

## Story s54-docs-recherche — Chercher dans la documentation
**As a** Visiteur **I want** trouver la bonne page sans la parcourir **so that** la documentation serve quand je sais déjà ce que je cherche.

### Complexity
3

### Acceptance criteria
- [ ] La recherche plein texte retourne les pages correspondantes et **fonctionne sans service externe**
- [ ] L'index est construit **au build** et servi statiquement — servi à la requête, la promesse « sans service externe » se paie en temps de réponse
- [ ] Un lien interne pointant vers une page inexistante **fait échouer le build**, en nommant le fichier fautif et la cible manquante
- [ ] La recherche respecte la locale servie : une page qui n'existe pas dans cette langue n'est pas proposée comme si elle y était
- [ ] **Module de documentation non activé** : aucun index, aucun écran de recherche, et rien ne casse

### Dependencies
s30-docs-site

### Agentic notes
Sortie de s30 le 05/09, avant d'écrire son plan : les deux critères partagent une **passe croisée sur l'ensemble du contenu au build** que le reste de s30 n'a pas besoin de construire. s29 valide chaque fichier isolément (frontmatter Zod, refus nommant le fichier). **Précision du 06/09** : `s30` croisait déjà deux fichiers en deux endroits (une section sans `section.json` dans la langue par défaut, une page écrite seulement en traduction) — la rédaction initiale disait le contraire. Ce qui est neuf est la **référence écrite par l'auteur**, arbitraire, résolue contre le catalogue entier.
**Piège de sécurité** : si la recherche passe par une route, `docs/security.md` impose la limitation de débit sur tout point d'entrée public servi par le répartiteur (ADR 050), et `routeIsRateLimited` la pose sans qu'elle le déclare. Un index statique interrogé côté client l'évite entièrement — argument de plus pour le build, en plus du temps de réponse.
**Piège de taille** : un index servi au client est téléchargé par chaque visiteur. Le critère ne fixe pas de plafond ; le plan devrait en poser un et le mesurer, sinon la promesse « sans service externe » se paie ailleurs.

---

## Story s56-roles-de-session — Servir une route réservée à un rôle
**As a** Dev **I want** que le niveau de protection `role` soit satisfaisable **so that** une route ou une entrée réservée à un rôle serve réellement celui qui le porte.

> **Ajoutée le 06/09, sur une mesure faite pendant `s37b2`.** `ModuleSession.roles` vaut `[]`, **écrit en dur** (`packages/modules/auth/src/infrastructure/better-auth-service.ts:1155`), sous un commentaire annonçant que « les rôles arriveront avec s17 » — `s17` est livrée depuis longtemps. Or `packages/core/src/protection.ts:44` décide l'accès d'une protection `role` en interrogeant ce tableau : **le niveau refuse donc tout le monde, partout**. Ce n'est pas une faille — le produit refuse trop, jamais trop peu — mais c'est un mécanisme déclaré que rien ne peut satisfaire, et deux modules l'utilisent déjà.

### Complexity
2

### Acceptance criteria
- [ ] `ModuleSession.roles` est **peuplé à partir de l'état réel du compte**, et le point qui le peuple est unique ; un test le mesure sur la session servie, pas sur la fonction qui la construit
- [ ] Une route déclarant `protection: { level: 'role', role: … }` est **servie** au porteur du rôle et répond **404** à qui ne le porte pas — jamais 403, qui confirmerait son existence
- [ ] Une entrée de navigation déclarant le même niveau est rendue pour le porteur et absente pour les autres, mesurée sur le rendu et non sur le registre
- [ ] Les routes `role` du module de démonstration sont exercées **de bout en bout**, avec un compte qui porte le rôle et un compte qui ne le porte pas
- [ ] Un rôle retiré cesse d'ouvrir la route **sans nouvelle connexion** — la révocation s'applique côté serveur (`docs/security.md`)
- [ ] **Module `admin` coupé** : aucune route `role` ne devient accessible par défaut ; l'absence de rôle refuse, elle n'ouvre pas

### Dependencies
s17-roles-permissions, s37b1-decompte-et-impersonation

### Agentic notes
**Le piège est le sens du défaut** : un tableau vide qui refuse tout est confortable, et c'est pourquoi personne ne l'a vu pendant huit stories. Le correctif inverse la charge — à partir de là, une erreur de peuplement **ouvre** au lieu de fermer. Chaque critère doit donc porter son cas négatif, et la revue mutera dans ce sens-là.
`packages/modules/organizations/src/domain/permissions.ts:14` prend soin de dire que les permissions d'organisation ne sont **pas** ce niveau-là : ne pas les confondre. Ce qui peuple `roles`, ce sont les rôles de **plateforme** (`admin_platform_role`), pas l'appartenance à une organisation.
`s37b2` a mesuré la conséquence côté produit : le back-office n'est atteignable que par URL, faute d'entrée de navigation qui puisse être rendue.

---

## Story s57-contraste-des-jetons — Rendre visibles le focus et le bouton destructif
**As a** Visiteur **I want** voir où se trouve le focus et lire un bouton destructif **so that** je puisse utiliser le produit au clavier et en thème sombre.

> **Ajoutée le 06/09, sur deux mesures faites pendant `s46`**, indépendamment confirmées par sa revue avec `scripts/contrast-rules.ts` :
> - **`--ring` sur `--background`, thème clair : 2,59 : 1**, contre les **3 : 1** que la WCAG demande à un indicateur de focus non textuel. Cela concerne **tous** les contrôles focusables du dépôt.
> - **`Button variant="destructive"`, thème sombre : 2,77 : 1**, contre 4,5 : 1 pour du texte normal (4,56 en clair, tout juste).
>
> Les deux sont **préexistants** — `s46` les a trouvés en habillant les écrans d'authentification, ne les a pas introduits, et a délibérément refusé de les plier dans `pnpm test:contrast` : étendre une commande verte à un défaut de jeton l'aurait rendue rouge sans que personne l'ait décidé. C'est cette décision-là qui appartient à une story.

### Complexity
2

### Acceptance criteria
- [ ] `--ring` atteint **au moins 3 : 1** sur les fonds sur lesquels il est réellement peint, dans les deux thèmes, et le jeton reste unique — pas une exception par composant
- [ ] `Button variant="destructive"` atteint **4,5 : 1** dans les deux thèmes, texte sur fond
- [ ] `pnpm test:contrast` **cesse de ne mesurer que l'`Alert`** : elle couvre les jetons livrés qui portent du texte ou un indicateur non textuel, **avec le seuil qui correspond à chacun** — 4,5 : 1 pour du texte normal, 3 : 1 pour un indicateur non textuel
- [ ] Ce que la commande **ne** mesure **pas** est écrit dans sa propre sortie, pas seulement dans un document
- [ ] Les variantes et les jetons sont **dérivés** des fichiers livrés, jamais recopiés : un jeton ajouté demain entre dans la mesure sans qu'on y pense
- [ ] Aucun écran ne change d'apparence au-delà de ce que le changement de jeton implique — les captures des cinq écrans d'authentification restent reconnaissables

### Dependencies
s49-contraste-des-alertes, s46-auth-screens-design

### Agentic notes
**Le piège est le sens de la commande.** `pnpm test:contrast` est verte aujourd'hui parce qu'elle regarde peu. L'élargir la rendra rouge sur des défauts réels — c'est le but, et c'est pourquoi la correction des jetons et l'élargissement de la mesure doivent atterrir **ensemble**, dans cette story et pas dans deux.
**Le focus ne se voit pas sur une capture** : la revue de `s46` l'a écrit noir sur blanc. La mesure doit porter sur le jeton, pas sur un rendu.
`docs/decisions/056` a fixé la portée des jetons sémantiques ; si la correction la déborde, elle demande un ADR qui le supersède.
