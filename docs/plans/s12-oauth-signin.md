---
validated: yes
---
# Plan — Story s12-oauth-signin

Branche : `feature/s12-oauth-signin`. Recherche :
`docs/research/s12-oauth-signin.md`. Design : `docs/designs/s12-oauth-signin.md`
(+ maquette `.html`). Validation déléguée.

## Target story

Se connecter avec Google ou GitHub. Six critères repris de `docs/stories.md` :
boutons affichés quand les identifiants sont configurés, première connexion
créant le compte avec l'email vérifié par le fournisseur, liaison au compte mot
de passe existant au lieu d'un second compte, refus d'autorisation ramenant à la
connexion avec un message explicite et sans session, fournisseurs liés visibles
et déliables sauf le dernier moyen de connexion, et l'état « module non
activé ».

**Socles couverts** : `docs/security.md` **§1** (attributs de cookie : `Lax`
pour l'état OAuth, `Strict` conservé pour la session), **§2** (rotation de
l'identifiant de session à l'élévation de privilège, jetons d'état à usage
unique et à durée de vie courte), **§3** (autorisation côté serveur, 404 et
jamais 403 sur le compte lié d'autrui), **§4** (Zod à la frontière des routes,
liste blanche de redirection, aucun paramètre non validé pilotant une
redirection), **§5** (aucun identifiant de fournisseur dans le dépôt ni dans un
journal ; environnement validé au démarrage en nommant la variable), **§7**
(aucune énumération de comptes par message, par code de statut ni par URL) ;
`docs/reliability.md` **§1** (un rappel rejoué n'a pas d'effet supplémentaire)
et **§2** (aucun fournisseur configuré : l'application fonctionne, sans bouton).

## Interprétations tranchées (avant la première ligne)

1. **Pas de nouveau module, pas de migration.** `auth` est socle (ADR 021) et
   `auth_account` existe depuis s07. Le critère « module non activé » devient :
   **aucun fournisseur configuré** ⇒ aucun bouton, et un chemin de rappel qui
   répond exactement ce que répond un chemin non déclaré. La table de liaison
   reste celle de s07 ; c'est écrit dans le plan parce que ça ne peut pas être
   prouvé autrement.
2. **La règle de liaison est la double preuve** : le fournisseur atteste
   l'adresse **et** le compte local est déjà vérifié. Elle fait l'objet d'un ADR
   (tâche 8), parce que s13, s14 et s16 en hériteront.
3. **Le fournisseur local a une identité fixe** (question ouverte n°1 de la
   recherche) : le drapeau monte un fournisseur de développement qui ouvre
   toujours la même adresse. Une adresse choisie par le visiteur ferait du
   drapeau un « se connecter en tant que n'importe qui ».
4. **Lier un fournisseur depuis les paramètres n'est pas dans s12** (question
   ouverte n°2) : les critères demandent de voir et de délier. `/link-social`
   reste non déclarée, donc 404.

## Tasks (ordered)

1. [x] **Règles pures du `domain`** — les fournisseurs connus (énumération
   fermée), la **décision de provisionnement** (refus si le fournisseur
   n'atteste pas l'adresse), la **classe d'un refus de retour** (« autorisation
   refusée » contre « échec », rien d'autre — §7), et la **règle du dernier
   moyen de connexion**. Éprouvées là où elles vivent, dans le fichier de règles
   existant du module.
2. [x] **Configuration de la bibliothèque** — `socialProviders` construits
   depuis des identifiants **injectés** (jamais lus de l'environnement par le
   module), `account.accountLinking` épinglé (`trustedProviders: []`,
   `requireLocalEmailVerified`, pas d'adresses différentes),
   `user.validateUserInfo` branché sur la règle de la tâche 1,
   `advanced.cookies.state` en `SameSite=Lax` (§1 — sans quoi le retour du
   fournisseur ne porte pas l'état et **rien** ne fonctionne),
   `onAPIError.errorURL` vers la route de normalisation, et le fournisseur local
   par `genericOAuth` quand le point de composition le fournit.
3. [x] **Comptes liés : dépôt et cas d'usage** — lister les moyens de connexion
   d'un compte **sans aucun jeton ni empreinte de mot de passe**, et délier de
   façon **atomique et verrouillée** : la bibliothèque compte puis supprime sans
   verrou, donc deux déliements simultanés laissent un compte sans moyen de
   connexion (mesuré dans le paquet installé). Le propriétaire est dans la
   condition, pas vérifié avant (§3).
4. [x] **Routes du module** — `sign-in/social` (corps **revalidé et
   réinjecté**, destination filtrée par la liste blanche, réponse convertie en
   302 pour qu'un formulaire sans JavaScript fonctionne), **un rappel par
   fournisseur** (404 identique à un chemin non déclaré quand il n'est pas
   configuré), normalisation du refus, déliement, et l'autorisation du
   fournisseur local. Aucune route attrape-tout (ADR 017).

   > **Amendement, mesuré à l'exécution.** Le « 404 identique à un chemin non
   > déclaré » vaut pour **`/sign-in/social`** — un fournisseur non configuré ne
   > démarre aucun parcours — et **pas** pour les rappels : `e2e/modules.spec.ts`
   > exige qu'une route publique d'un module activé soit servie, et un 404
   > conditionné par la configuration faisait rougir cette garde. Assouplir la
   > garde pour tenir une propriété que la story ne demande pas — `auth` est
   > socle, il n'a pas d'état « non activé » — aurait été le mauvais arbitrage.
   > Le rappel d'un fournisseur non configuré refuse donc par la route de
   > normalisation, sans session ; un identifiant inventé, lui, n'a toujours
   > aucun chemin.
5. [x] **Configuration d'environnement** — variables par fournisseur,
   **paire incomplète refusée au démarrage en nommant la variable** (§5),
   drapeau de mode local explicite refusé en présence d'une clé (précédent
   `EMAIL_LOCAL_CAPTURE`), règle isolée de ce qui la construit
   (`apps/web/lib/oauth-config.ts`), appliquée par `next.config.ts`, et
   `.env.example` aligné.
6. [x] **Écrans** — boutons de fournisseur sur `/sign-in` et `/sign-up`, refus
   affiché en deux messages et pas plus, carte « Connexions externes » sur
   `/account` avec déliement, page de **rebond same-site** du retour, et les
   clés i18n dans les deux locales. Aucun texte en dur.
7. [x] **Parcours navigateur** — le parcours complet avec le fournisseur local,
   les attributs des deux cookies lus dans le bocal du navigateur, et le
   **retour inter-sites mesuré** : c'est le seul contexte où le rebond de la
   tâche 6 se justifie ou s'infirme.
8. [x] **Documentation qui voyage avec le code** — `AGENTS.md` du module et de
   l'application, et l'ADR de la règle de liaison avec les options rejetées.

## Run interdicts

- **Ne pas toucher** `docs/STATE.md`, `config/features.ts`, `generated/`, le
  site marketing, ni aucune story autre que s12.
- **Ne pas créer de module** ni de migration : `auth_account` existe.
- **Ne pas relâcher `SameSite=Strict` sur la session** pour faire marcher le
  retour : c'est le cookie d'**état** qui passe en `Lax`, et la session garde
  son attribut (§1).
- **Ne pas laisser un code d'erreur de la bibliothèque atteindre l'URL ou le
  message** : `account_not_linked` dit qu'un compte existe.
- **Ne pas ajouter de fournisseur à `trustedProviders`** : c'est précisément ce
  qui rendrait la double preuve inopérante.
- **Ne pas lire `process.env` dans le module** ni importer `@repo/db` (ADR 020).
- **Ne pas déclarer les autres endpoints de la bibliothèque**
  (`/list-accounts`, `/link-social`, `/get-access-token`…) : hors périmètre,
  donc 404.
- **Deux fichiers de test au plus** en plus de l'existant, et de préférence
  aucun : les cas vont dans `tests/auth.test.ts` et dans le fichier de règles du
  module.

## The point everything turns on

**Le retour du fournisseur est une navigation inter-sites, et tout le socle de
s07 a été réglé pour n'en accepter aucune.**

Trois conséquences, et elles ne se voient pas dans le même test :

- **l'état** ne revient pas si son cookie est `Strict` : la connexion échoue
  toujours, et l'erreur ressemble à une attaque (`state_security_mismatch`) ;
- **la session** posée par le rappel ne repart pas sur la redirection finale :
  l'utilisateur atterrit déconnecté alors que le compte est bien créé. C'est le
  défaut le plus coûteux de cette story, parce qu'il **passe tous les tests de
  nœud** — il n'existe que dans un navigateur, sur une chaîne inter-sites ;
- **la liaison** décide dans le même aller-retour, à partir de ce que le
  fournisseur affirme : si l'affirmation n'est pas exigée, le retour d'un
  fournisseur complaisant vaut prise de contrôle.

## Test strategy

- **Règles pures** (`packages/modules/auth/src/domain/auth-rules.test.ts`) : la
  décision de provisionnement, la classe de refus, la règle du dernier moyen.
  Chacune éprouvée **une fois**, à la règle ; les appelants ne rejouent pas la
  matrice.
- **Traversant** (`tests/auth.test.ts`, base réelle + répartiteur) : la boucle
  complète par **GitHub**, dont les trois appels sortants sont servis par une
  doublure de **réseau** — le SDK, le rappel et la décision de liaison sont les
  vrais. Cas : création avec adresse attestée ; retour du même compte ;
  liaison à un compte mot de passe **vérifié** ; refus face à un compte
  **non vérifié** (pré-enregistrement) ; refus quand le fournisseur n'atteste
  pas l'adresse, **et aucune ligne `auth_user` créée** ; refus d'autorisation
  (`error=access_denied`) sans session ; état absent, état d'un autre
  navigateur, état rejoué ; destination hors liste blanche ; corps portant un
  `idToken` qui ne doit pas atteindre la bibliothèque ; rotation de
  l'identifiant de session ; déliement, déliement du dernier moyen, déliement du
  compte d'autrui (404), deux déliements simultanés.
- **Configuration** (`tests/env-wiring.test.ts` ou son voisin) : paire
  incomplète refusée en nommant la variable, drapeau et clé ensemble refusés,
  aucun fournisseur configuré ⇒ l'application démarre.
- **Navigateur** (`e2e/`) : parcours complet par le fournisseur local, attributs
  des cookies `state` et `session` lus dans le bocal, et le **retour
  inter-sites** conduit depuis une origine tierce.
- **Mutations obligatoires**, chacune restaurée : cookie d'état repassé en
  `strict` ; `trustedProviders` élargi à `github` ;
  `requireLocalEmailVerified: false` ; règle de provisionnement rendue
  permissive ; verrou du déliement retiré ; normalisation du refus rendue
  transparente ; liste blanche de destination retirée.

## Definition of Done

Les six critères satisfaits, chacun couvert par un test ou une mesure tracée.
§1, §2, §3, §4, §5 et §7 de `docs/security.md` couvertes sur leur part OAuth.
`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm build` et
`pnpm run audit` verts. `git status` propre après le build.
