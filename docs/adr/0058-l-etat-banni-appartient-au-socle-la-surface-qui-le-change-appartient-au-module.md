# ADR 058 — L'état « banni » appartient au socle ; la surface qui le change appartient au module

- Status: accepted
- Date: 2026-09-05
- Scope: story s37a-superadmin-et-bannissement

## Context

La story demande deux choses qui, prises telles quelles, se contredisent :

- **critère** : « un compte banni ne peut plus se connecter et ses sessions sont
  révoquées » ;
- **critère 14** : « module `admin` non activé : aucune route de back-office,
  aucun rôle de superadmin ».

`docs/research/s37-admin-users.md` (fait 4) en tire le point dur : « le
bannissement appartiendrait au module `admin` ; la connexion appartient à
`auth`, qui est du **socle** ». Il faudrait alors que le chemin de connexion
consulte quelque chose qui **peut ne pas être là** — un module optionnel greffé
sur un chemin du socle. La recherche note que c'est la **troisième** story
d'affilée à buter sur cette absence (le plan de site en s29, le point d'émission
unique en s32), et suggère qu'une quinzième clé de contrat pourrait être la
réponse.

Deux faits du dépôt bornent la décision :

1. **le précédent de s15.** Le plugin `organization` de Better Auth a été écarté
   (ADR 025) parce qu'il ajoute une colonne à `auth_session`, donc à une table
   d'un autre module. Le plugin `admin` de la même bibliothèque fait pire : il
   ajoute `banned`, `banReason` et `banExpires` à `auth_user`, **plus** un champ
   `role`, et il répond « You have been banned from this application » à la
   connexion (`dist/plugins/admin/admin.mjs`, mesuré en 1.7.2) ;
2. **s53 vient d'ajouter la quinzième clé** (`publicUrls`, ADR 054), ce qui a
   demandé de rouvrir les douze modules. En ajouter une seizième pour une
   « garde de connexion » n'est pas gratuit.

## Decision

**Le découpage supposé par la recherche est faux, et c'est ce qui dissout le
point dur.** « Banni » n'est pas une fonctionnalité d'administration : c'est un
**état du compte**. `auth` possède déjà les comptes et la décision de laisser
entrer ; ce qui appartient au module d'administration est la **surface** qui
change cet état, pas l'état lui-même.

D'où, littéralement :

- **`auth` (socle)** porte les colonnes `banned`, `banned_at`, `banned_reason`
  sur `auth_user`, refuse la création de session d'un compte banni — au seul
  point que **tous** les parcours traversent, le crochet
  `databaseHooks.session.create.before` — et révoque les sessions en cours à la
  pose de la marque. Aucune dépendance vers un module optionnel, aucune
  condition écrite en dur, aucun motif de valeur vide à inventer ;
- **le module `admin`** porte le rôle de plateforme, sa désignation, la
  promotion, la révocation, le bannissement et le débannissement. Il déclare
  `requires: ['auth']`, ce qui rend permise la clé étrangère de
  `admin_platform_role` vers `auth_user` (ADR 018), et il écrit l'état banni par
  un **port injecté** (`AdminAccountsPort`), jamais en touchant les tables du
  socle ;
- **module coupé** : plus aucune route, plus aucun rôle de superadmin, plus
  personne ne peut bannir — mais un compte **déjà banni reste banni**. C'est la
  règle du dépôt (« un module activé puis désactivé garde ses tables et ses
  données ») ; le débannir en masse serait un nettoyage, et le nettoyage est au
  cimetière du PRD.

Deux décisions de forme en découlent, écrites ici plutôt que découvertes :

- **le refus de connexion est celui d'un identifiant invalide.** Répondre « vous
  êtes banni » donnerait un oracle d'énumération de comptes, ce que
  `docs/security.md` §7 refuse « ni par message, ni par code de statut ». Le
  motif est lisible d'un superadmin, jamais de l'anonyme ;
- **les routes du back-office sont déclarées `authenticated`, pas `role`.** Le
  répartiteur répond **403** à une session qui ne porte pas le rôle
  (`packages/core/src/registry.ts`), et un 403 confirme que le back-office
  existe — ce que les critères 3 et 4 refusent. La garde de superadmin vit donc
  dans le module, où elle peut répondre 404 ;
- **`publicUrls` rend `[]`**, et c'est une décision consignée, pas un oubli : un
  back-office n'est pas indexable, et l'y mettre serait la divulgation gratuite
  de surface que `docs/security.md` §7 refuse.

## Considered options

- **Adopter le plugin `admin` de Better Auth** — rejeté. Le dépôt a déjà tranché
  contre pour la feature voisine (s15/ADR 025 n'a pas adopté le plugin
  `organization` ; `packages/modules/organizations/src/schema.ts:16` cite son
  fichier **en référence de forme**, pas en dépendance). L'adopter ici céderait
  la maîtrise du schéma sur la seule story qui touche l'élévation de privilège,
  et son refus de connexion nomme la sanction — l'oracle d'énumération que le
  socle de sécurité interdit. Sa branche `if (!ctx) return` laisse en outre
  passer une création de session sans contexte d'endpoint : une garde qui échoue
  **ouvert**.
- **Le champ `banned` dans le module `admin`, consulté depuis `auth`** —
  rejeté : cela inverse la dépendance et fait consulter au socle un module qui
  peut être absent. Mesure du coût : `auth` devrait recevoir un prédicat
  optionnel, dont l'absence signifierait « personne n'est banni » — un défaut
  ouvert, et un point de composition qui l'oublie ne fait rougir aucune commande
  (le défaut mesuré en revue de s09 sur les locales du registre).
- **Une seizième clé de contrat « garde de connexion »** — rejeté : s53 vient
  d'ajouter la quinzième (ADR 054) en rouvrant les douze modules. Rouvrir les
  treize pour un besoin qu'un champ du socle couvre entièrement est
  disproportionné, et la clé n'aurait qu'un seul implémenteur.
- **Désigner le premier superadmin par un identifiant de compte plutôt que par
  une adresse** — rejeté : sur une base vierge, **aucun compte n'existe encore**.
  Un identifiant y serait inconnaissable au moment où on remplit le `.env`, et
  illisible ensuite. La contrepartie est écrite : l'adresse **désigne**, elle
  n'authentifie pas, et elle ne prend effet que tant qu'aucun superadmin
  n'existe.
- **Refuser le démarrage quand `SUPERADMIN_EMAIL` est absente**, comme le fait
  le reste du dépôt pour le mailer, l'authentification, le stockage et le
  paiement — rejeté, et c'est le critère 3 qui le demande : une plateforme sans
  superadmin doit pouvoir **démarrer**, sans quoi on ne pourrait jamais en
  désigner un. Le démarrage avertit en nommant la variable ; le back-office
  répond 404 à tout le monde.

## Consequences

**Ce qui devient plus facile.** Le bannissement fonctionne dans les deux
configurations de modules sans une seule condition : la connexion refuse un
compte banni que le back-office existe ou non. Les stories s42, s43 et s44, qui
requièrent `admin`, héritent d'un rôle de plateforme dont la forme est déjà
posée. Un futur parcours de connexion — un fournisseur de plus, une invitation —
hérite du refus sans y penser : la garde est au point de création de session,
pas à la porte d'un parcours.

**Ce qui devient plus difficile.** Le module `admin` ne peut pas lire les
comptes : tout ce qu'il sait d'eux passe par `AdminAccountsPort`, que le point de
composition sert. s37b, qui liste et détaille les utilisateurs, devra élargir ce
port plutôt que d'ouvrir une lecture directe — c'est délibéré, c'est la borne qui
garde les lectures derrière un identifiant plutôt qu'une adresse.

**Ce qu'il faut surveiller.**

- **Une réponse de connexion qui distinguerait le compte banni.** Le refus est
  réécrit par la route (`genericSignInRefusal`), et `tests/auth.test.ts` compare
  le refus d'un banni à celui d'un compte inconnu, corps et statut. Le crochet
  lève `UNAUTHORIZED` pour tomber dans cette réécriture ; un parcours qui ne
  passerait pas par cette route rendrait le statut brut de la bibliothèque.
- **Ce que cette forme ne cache pas** : un appelant **anonyme** reçoit 401 du
  répartiteur sur une route d'administration, comme sur toute route authentifiée
  du dépôt. L'existence d'un chemin sous `/admin/` se lit donc sans compte. Ce
  qui est fermé — et que la story demande — est la distinction entre « ce
  compte-ci administre » et « ce compte-là n'administre pas ».
- **Le timing.** Le refus d'un compte banni coûte une lecture indexée de plus
  qu'un refus ordinaire, après le hachage du mot de passe. Aucun cas ne mesure
  cet écart aujourd'hui ; les deux cas de temps de `tests/auth.test.ts` couvrent
  le compte inconnu contre le mot de passe faux, pas le compte banni.
- **Le garde-fou vaut pour les deux gestes qui font perdre le dernier
  superadmin** — lui retirer le rôle, et bannir le compte qui le porte. Le
  second a été ajouté après la revue de la story (F2) : sans lui, le superadmin
  unique qui se bannit gardait sa ligne dans `admin_platform_role`, le décompte
  rendait 1, la désignation par `SUPERADMIN_EMAIL` ne se redéclenchait jamais, et
  la plateforme devenait définitivement inadministrable en un clic. La règle est
  la même fonction pure pour les deux, et les deux dépôts la consultent sous le
  **même** verrou consultatif : une révocation ne peut pas se glisser entre la
  décision de bannir et l'écriture du socle, qui s'exécute verrou tenu.
- **Bannir un superadmin qui n'est pas le dernier reste permis**, et c'est une
  décision : c'est de la modération entre pairs, et le garde-fou ne protège que
  l'administrabilité de la plateforme. Elle laisse un chemin ouvert — bannir un
  pair, puis révoquer l'autre — que ce module ne peut pas fermer seul, puisque
  la révocation compte des lignes et ne sait pas laquelle appartient à un compte
  banni : l'état « banni » est dans le socle et n'est atteignable que par
  `AdminAccountsPort`. Le tableau des chemins balayés vit dans
  `packages/modules/admin/AGENTS.md` ; s37b, qui ouvre le back-office sur des
  listes de comptes et élargira ce port, est la story qui devra trancher.
