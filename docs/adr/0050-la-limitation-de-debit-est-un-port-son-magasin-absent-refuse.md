# ADR 050 — La limitation de débit est un port ; son magasin absent refuse, et les deux compteurs remplacés sont abandonnés sans être supprimés

- Status: accepted
- Date: 2026-09-03
- Scope: story s28-rate-limiting

## Context

Trois faits se rencontrent dans cette story, et ils tirent dans des directions
opposées.

**1. Deux compteurs existaient déjà, écrits deux fois.** s11 a livré
`public_form_throttle` parce que les formulaires publics étaient les premiers
points d'entrée anonymes du dépôt ; s24 a livré `billing_checkout_throttle` pour
le tunnel de paiement invité. Les deux portent la même fenêtre fixe, la même
instruction atomique, le même condensat de clé — et chacun annonce sa dette dans
son propre en-tête. Deux implémentations d'une règle de sécurité divergent au
premier seuil ajusté ; `AGENTS.md` déclare d'ailleurs « rate limiting
PostgreSQL » dans la liste « une implémentation par port », alors qu'aucun port
n'existait.

**2. Le commentaire de s24 dit « s28 devra la supprimer ».** Mais
`docs/reliability.md` impose que les migrations soient rétrocompatibles avec la
version encore en ligne : « ajouter avant de lire, cesser d'écrire avant de
supprimer ». s27 vient précisément de mesurer qu'un déploiement compose détruit
le conteneur en service **avant** de migrer : pendant la bascule, la version
encore servie écrit toujours dans l'ancienne table.

**3. Le socle de fiabilité dit qu'un tiers absent dégrade et ne casse pas.** Mais
le magasin de ce compteur n'est pas un tiers : c'est la base de l'application.
Appliquer la règle par réflexe donnerait « magasin muet ⇒ on laisse passer »,
c'est-à-dire la disparition de la protection exactement au moment où
l'application est fragile.

Le critère 8 de la story ajoute une contrainte qui commande la forme :
« neutralisables dans les tests par injection, **sans variable d'environnement
exploitable en production** ». Ce dépôt a payé deux fois cette leçon dans la même
session — `SKIP_ENV_VALIDATION` traversant un clone (s26), puis manquant de
traverser une image (s27).

## Decision

**La limitation de débit devient le quatrième port du dépôt**
(`packages/ports/src/rate-limit.ts`), avec une seule implémentation, PostgreSQL,
et trois conséquences opposables.

**a. Le refus vit au répartiteur, dérivé du registre.**
`dispatchModuleRequest` appelle un garde **injecté** (`DispatchOptions.rateLimit`)
sur toute route dont `routeIsRateLimited` est vrai : toute route **publique**,
qu'elle le déclare ou non, plus toute route qui déclare un `rateLimit`. La
couverture n'est donc pas une liste à tenir à jour — une route publique ajoutée
demain est limitée sans que personne y pense. Le répartiteur est **fail-closed** :
sans garde branché, toute route limitée répond 429. La neutralisation n'existe
que par injection, dans un test, et aucune variable d'environnement ne l'éteint.

**b. Un magasin indisponible refuse.** Exception assumée au socle de fiabilité :
si la base est absente, la connexion ne fonctionne pas davantage — les sessions y
vivent. Refuser ne coûte aucune disponibilité réelle ; laisser passer ferait
disparaître la protection au pire moment.

**c. `public_form_throttle` et `billing_checkout_throttle` cessent d'être
écrites, et ne sont pas supprimées.** Les deux modules gardent leur **règle** —
chacune porte une dégradation que le répartiteur ne sait pas exprimer — mais
comptent désormais à travers le port. Les deux tables restent déclarées, vides et
inertes. Leur suppression est une story ultérieure, quand aucune version en ligne
ne les écrira plus.

Une quatrième décision, mineure mais structurante : **la table du compteur
appartient à un module** (`packages/modules/rate-limit`, du socle non
désactivable). Le dépôt n'a qu'un mécanisme pour qu'une table ait un
propriétaire, une migration et un journal de migration — le contrat de module.

## Considered options

- **Un seuil par IP seule** — rejeté : `x-forwarded-for` est un en-tête que
  l'appelant écrit lui-même, et dix mille adresses qui essaient un mot de passe
  chacune sur le même compte restent toutes sous leur seuil. La double
  limitation — par appelant **et** par compte visé — est le cœur de la story, et
  le seau par compte est le seul des deux qui ne dépende de rien que l'attaquant
  contrôle.
- **Ne compter que les adresses qui correspondent à un compte** — rejeté : un
  attaquant apprendrait lesquelles existent. C'est l'énumération inversée que
  `docs/security.md` §3 refuse, la même règle qui rend « compte inconnu » et
  « mot de passe erroné » indiscernables.
- **Supprimer les deux tables dans cette livraison**, comme le commentaire de s24
  le demandait — rejeté : cela casserait la version encore en ligne pendant la
  bascule (`docs/reliability.md`, mesure de s27). La consigne écrite en s24
  ignorait cette contrainte ; elle n'est pas suivie, et ce refus est écrit ici
  pour qu'il ne soit pas relu comme un oubli.
- **Laisser passer quand le magasin est muet**, par application du socle de
  fiabilité — rejeté : le « tiers » est notre propre base. Sa panne coupe déjà la
  connexion ; la seule chose que ce choix ajouterait est une fenêtre sans
  protection au moment le plus propice à l'attaque.
- **Une variable d'environnement de désactivation** (`DISABLE_RATE_LIMIT`) pour
  le développement local — rejeté : une variable qui éteint une protection
  **est** une porte, et ce dépôt l'a vérifié deux fois. La neutralisation se fait
  par injection ; `tests/rate-limiting.test.ts` balaie le chemin de limitation
  — **dérivé du disque**, avec un plancher assertionné — et refuse toute lecture
  d'environnement, jusque dans un commentaire.
- **Un seuil nul interprété comme « aucune limite »** — rejeté pour la même
  raison : ce serait la variable d'environnement, déguisée en fichier de
  configuration. Un seuil nul ou négatif fait échouer le démarrage, en nommant la
  politique.
- **Le compteur appelé directement depuis le répartiteur**, sans port — rejeté :
  il n'aurait plus été neutralisable que par variable, c'est-à-dire par la porte
  qu'on ferme.
- **La table `rate_limit_window` hébergée par `@repo/db`**, hors module —
  rejeté : elle aurait exigé un second chemin de migration, non éprouvé, à côté
  de celui qui l'est (génération, barils, journal par module, recette de profil
  minimal). Le coût est un module sans route ni navigation, et il est écrit comme
  tel dans son `AGENTS.md`.
- **Un compteur en mémoire de processus** — rejeté : il se contourne en scalant
  horizontalement, et `docs/security.md` §7 exige un compteur partagé. La
  propriété est mesurée contre un vrai PostgreSQL, avec **deux connexions
  distinctes**.

## Consequences

**Ce qui devient plus facile.** Ajouter une route publique la limite d'office.
Ajuster un seuil est une ligne de `config/security.ts`, et une seule. Un oubli de
câblage au point de composition est immédiatement visible — toutes les routes
publiques répondent 429 — au lieu d'être une absence silencieuse de protection.

**Ce qui devient plus difficile.** Toute suite de tests qui sert une route
publique doit dire qu'elle ne mesure pas la limitation, en injectant un garde
permissif (`tests/fixtures/rate-limit.ts`). C'est le prix du fail-closed, et il
est payé une fois par fichier.

**Corrigé après la revue bloquante, et à ne pas défaire.**

- **`sweep` prend l'instant présent, pas une borne.** Le magasin est partagé et
  les seaux n'ont pas la même durée : une borne « efface tout ce qui précède »
  ne peut pas dire si une ligne est close, et effaçait les seaux **horaires
  encore ouverts** des autres routes — déclenchable à distance, toutes les dix
  minutes, par un POST vide sur un formulaire public. Chaque ligne porte
  désormais son `expires_at`. Rétablir une borne choisie par l'appelant
  ré-ouvrirait la faille.
- **Le garde balaie lui-même.** Le balayage ne vivait que dans deux modules
  **optionnels** : les couper laissait la table grandir sans borne depuis une
  clé dérivée d'un en-tête que l'appelant écrit. Le module déclare aussi une
  tâche planifiée, pour une application au repos.
- **La double authentification a un seau par défi, lu par nom exact.** Le seuil
  par appelant ne protégeait rien contre qui fait tourner `x-forwarded-for` ; le
  cookie de défi, lui, est posé et signé par le serveur. Le contrat de route
  porte donc `subjectCookies` à côté du `subjectField` — **des noms exacts, au
  pluriel**, et non un suffixe. Une correspondance par suffixe s'est révélée
  contournable par un leurre posé en tête de l'en-tête `Cookie`, que l'appelant
  écrit intégralement : le limiteur comptait le leurre, la bibliothèque validait
  le vrai défi (401×20 sans un seul 429). Le pluriel existe parce que le nom réel
  dépend de `useSecureCookies`, que la déclaration de route ne connaît pas ; quand
  plus d'un est présent, la limitation **refuse** au lieu de choisir.

**Ce qu'il faut surveiller.**

- **Le seau par compte est aussi une arme** : saturer le compte de quelqu'un
  l'empêche de se connecter pendant la fenêtre. Le seuil livré (20 tentatives par
  tranche de 5 minutes, toutes origines confondues) est un compromis, pas une
  vérité ; il se remonte dans `config/security.ts`.
- **Le condensat n'est pas de la pseudonymisation forte** : un SHA-256 non salé
  d'une adresse IPv4 se retrouve par force brute. La propriété obtenue est
  bornée — la table ne **contient** pas d'adresse — et elle est la même que celle
  des deux tables remplacées.
- **Le journal, lui, ne condense pas** : le critère 6 demande l'IP et la route.
  Les deux règles diffèrent sciemment, et `packages/modules/rate-limit/AGENTS.md`
  le dit.
- **Un défaut latent de `@repo/db` a été ouvert par cette story, et corrigé
  ici.** `apps/web/lib/rate-limit.ts` importe `@repo/db`, et `lib/startup.ts`
  l'atteint : `composeSchema` s'exécute donc désormais sous le chargeur de
  `next.config.ts`, où le baril généré d'un module **sans table** se matérialise
  en `{ default: …, __esModule: true }` au lieu d'un espace de noms vide. Prises
  pour des tables, ces clés faisaient entrer `consent` et `i18n` en collision et
  cassaient `pnpm build` ; avec un seul baril vide, elles entraient
  silencieusement dans `appSchema`. Le correctif est dans `@repo/db`, où vit le
  défaut — pas dans le module ni dans son baril. Détail et mesure dans
  `packages/db/AGENTS.md`.
- **Les seuils par appelant sont larges, délibérément.** Le premier jeu livré
  (5 inscriptions par heure et par appelant) a fait échouer 26 parcours sur 92 :
  toutes les requêtes venaient de `::1`, comme elles viennent d'une seule adresse
  pour toute installation qu'aucun proxy ne précède. Une limite qui coupe le
  produit est un déni de service ; la sécurité vit dans `maxPerSubject`, qui ne
  dépend d'aucun en-tête.
- **La dette de suppression reste ouverte** : les deux tables abandonnées
  attendent une story. `tests/rate-limiting.test.ts` refuse qu'on les écrive de
  nouveau, et refuse aussi qu'on les supprime ici.
- **Le captcha n'est pas livré, seulement encadré** : `config/security.ts` le
  déclare coupé et le démarrage refuse de l'activer sans son origine dans la
  politique de sécurité du contenu. **Aucun fournisseur n'est branché** — c'est un
  manque nommé, pas une fonctionnalité.
