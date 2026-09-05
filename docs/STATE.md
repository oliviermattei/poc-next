# État de reprise — killer-boilerplate

> Fichier de passation. À lire **en premier** après un `/clear`. La vérité reste dans les fichiers du dépôt ; ceci dit seulement où on en est et comment on travaille.

## REPRENDRE ICI

**s53-blog-syndication est fusionnée** (demande de fusion 11, squash `0e7e313`).
Le blog est désormais **trouvable** : `robots.txt` l'autorise, `sitemap.xml` porte
ses articles, un flux RSS est servi, et une image Open Graph par défaut existe.

**Le dépôt a une quinzième clé de contrat : `publicUrls`.** Un module déclare les
URL qu'il publie ; le socle les agrège. Conséquence vérifiable d'un `grep` :
`apps/web/app/robots.ts` et `apps/web/app/sitemap.ts` ne connaissent **plus aucun
module par son nom**. ADR 054.

**Ce que la navigation publique du registre n'alimente pas, et pourquoi.** Le plan
voulait dériver la liste d'autorisation des entrées de navigation publiques.
Mesuré : il y en a **cinq**, dont `auth /sign-in`, `billing /pricing` et une route
d'API. Dériver de là publiait l'écran de connexion dans le plan de site. Seule la
clé alimente la dérivation, et rebrancher la navigation fait rougir **8 cas** plus
2 parcours navigateur.

**Un critère est livré non tenu, et déclaré comme tel.** Le critère 2 de s53
demandait un flux « valide **au sens d'un validateur** ». Le dépôt n'embarque
aucun validateur : il embarque un **analyseur**, dont la revue a mesuré la
complaisance (il accepte un canal sans titre ni lien ni description). Un cas fixe
désormais les deux bords de l'outil pour que la phrase ne se regonfle pas. Le
tenir demanderait une dépendance de validation ou un appel au W3C — **décision
non prise**.

**Cinq intermittents connus, tous dans `s52-derniers-intermittents`** :
`tests/audit-exceptions.test.ts`, `e2e/rate-limiting.spec.ts:38`, la **paire**
`e2e/oauth.spec.ts:30`/`:97` (identité partagée du fournisseur local, cause
connue), `e2e/blog.spec.ts:134` (`ECONNRESET`), et `e2e/two-factor.spec.ts:162`
— ce dernier d'un **mode d'échec distinct** de celui que s50 a réparé : une
région `status` qui n'apparaît pas, pas un budget de 30 s dépassé.

**Six recherches d'avance sont sur `dev`**, prêtes à planifier : `s30` (**4**, et
elle dépendait de s53 sans le déclarer — c'est levé), `s32` (4), `s37` (**5,
découpe requise**), `s47` (2), `s49` (2).

**La forme symétrique du contrat reste ouverte pour s32** : un chemin du socle qui
consulte un module optionnel avec une absence définie. s37 en héritera.

Premier numéro d'ADR libre : **055**.

## Où on en est

| | |
|---|---|
| Stories closes | **35 sur 53** (s01 → s29, s36, s41, s45, s48, s50, s53) |
| En vol | aucune — six recherches prêtes à planifier |
| Restantes | 18 — dont s49, s51 et s52, nées de constats de revue |
| Tests | **2064 + 8 sautés**, 107 parcours navigateur |
| ADR | **50** (jusqu'à 050 ; 051 libre) |

Stratégie de ship : **auto**. `/ks-ship` fusionne en squash dès que le portail
passe. Les PR fusionnées portent l'historique (#1 à #6).

## Environnement (à refaire après un redémarrage de session)

```bash
export PATH="/Users/olivier/.nvm/versions/node/v22.17.0/bin:$PATH"   # pnpm sinon absent
open -a Docker && docker compose up -d                                # Postgres, base `app`
```

## La boucle, par story

1. **Recherche** → `docs/research/<id>.md`. Vérifier les API dans les **paquets installés**, jamais dans la doc en ligne.
2. **Plan** → `docs/plans/<id>.md`, `validated: yes` (le propriétaire a délégué la validation).
3. **Implémenteur** (subagent `implementer`) → un commit sur `dev`.
4. **Reviewer** (subagent `reviewer`, contexte frais) → **écrit lui-même** son rapport dans `docs/reviews/<id>.md`, ne me renvoie que verdict, findings bloquants, décisions à prendre, non-vérifié.
5. Si `Ship allowed: no` → tour de correction, puis nouvelle revue.

**Protocole de contexte** : les agents écrivent les rapports dans les fichiers ; je ne fais pas transiter les corps de rapport par ma conversation. Mes messages restent courts.

## Effort et modèle, par niveau de risque

Le protocole coûte souvent plus cher que le modèle qui l'exécute. Trois niveaux, choisis par ce
que la story peut casser — pas par sa taille.

**Niveau 1 — ce qui peut fuir, facturer ou verrouiller un compte.** s20, s21, s23, s28, s34, s35.
Implémenteur **Opus**, relecteur **Opus**. Mutation sur chaque invariant revendiqué, **posée à
l'endroit du défaut** ; les six commandes dans les **deux** configurations de modules ;
vérification navigateur sous le build de production ; revue indépendante, tour de correction,
seconde revue. Une revue de correction se **cible sur le delta**, elle ne refait pas la première.

**Niveau 2 — une fonctionnalité avec de l'interface, sans surface de sécurité.** s32, s39, s40,
s41, s46. Implémenteur **Sonnet**, relecteur **Opus** au briefing court (les trois pièges de la
story, pas l'historique complet). Mutations sur les invariants **propres à la story**, pas sur le
socle qu'elle réutilise. Six commandes une fois, plus un aller-retour de bascule de module.
Vérification navigateur.

**Niveau 3 — contenu, documentation.** s29, s30, s31, s44. Implémenteur **Sonnet**, relecteur
**Sonnet** au briefing court. Pas de campagne de mutations sur du texte — mais **jamais zéro
relecteur** : s10 passait pour « juste un site marketing », et sa revue y a trouvé un
`robots.txt` qui offrait `/reset-password?token=…` à l'indexation. On ne sait pas à l'avance
quelle story n'en a pas besoin.

L'orchestrateur ne vérifie lui-même qu'un cas : un **tour de correction** qui ne touche que des
textes ou des comptes, **à l'intérieur d'une story déjà relue**. Ça ne franchit aucune porte.

## Fusionner une story — la liste, dans l'ordre

1. Commiter le rapport de revue **sur la branche de la story**.
2. `git merge --squash feature/<id>` depuis `dev`.
3. Conflits : **`git merge-file` fichier par fichier**, jamais de concaténation
   — elle coupe au milieu d'un bloc, et c'est le typecheck qui le dit ensuite.
4. `pnpm install`, puis les six commandes, migration comprise.
5. Commit de fusion, `docs/STATE.md` à jour, **push**.
6. **Supprimer le worktree** : `git worktree remove --force .claude/worktrees/agent-<id>`
   puis `git worktree prune`. Chacun pèse 1,5 à 2,4 Go de `node_modules` ; douze
   oubliés ont rempli le disque le 01/09 et bloqué tout outil, y compris ceux qui
   auraient libéré la place.

## Cadence

**Commit et push à intervalle régulier**, pas seulement à la fusion d'une story :
`dev` est poussée sur `origin`, la CI tourne sur chaque poussée, et un correctif
de processus poussé tôt profite à la voie suivante. Un travail non poussé est un
travail qu'une coupure de session peut perdre.

**Boucle d'auto-optimisation.** Ce qu'une revue trouve et qui se répète ne doit
pas être redécouvert par la story suivante : il remonte dans le skill
(`.claude/skills/review-antihallu`, `.claude/skills/tdd-skill`) ou dans
`AGENTS.md`, et le journal de `docs/process-review.md` le date. La règle qui
décide : *ce constat serait-il apparu si l'agent avait su ?* Si oui, c'est un
défaut de briefing, pas un défaut d'agent.

## Ce qui ne se négocie à aucun niveau

- Toute story passe par un **relecteur en contexte frais** et par la porte mécanique
  `Ship allowed`. On ne relit jamais dans le contexte qui a écrit.
- Chaque invariant revendiqué est **neutralisé à l'endroit du défaut**, et le rouge est montré.
  C'est ce qui a rattrapé les treize tests faux.
- **Les deux configurations de modules**, dès qu'une story touche un module.
- **La vérification navigateur**, dès qu'il y a un écran : elle a mordu six fois, chaque fois sur
  un défaut qu'aucune des six commandes ne voyait.

**En série, une story à la fois** (décidé le 01/09, après s20 et s41).

La contrainte qui borne le débit est le **budget de tokens**, pas le temps : il a été atteint
quatre fois. Paralléliser ne crée pas de budget, ça le dépense plus vite — le nombre de stories
livrables sur une fenêtre donnée est le même. Et le parallélisme coûte, lui :

- **les fusions** : une voie part d'un `dev` qui a vieilli. Dernière fusion, dix fichiers en
  conflit, reprise en trois points fichier par fichier, quatre blocs tronqués à réparer. En série,
  chaque branche part d'un `dev` à jour et les conflits disparaissent presque tous ;
- **les coupures** : les trois épuisements de limite sont arrivés à trois voies simultanées, et
  chacune a tué du travail en vol ;
- **six défauts créés par le parallélisme lui-même** : `oauth` absent des segments réservés, un
  bloc de lint qui éteignait la règle voisine, des cas d'environnement nés après leur garde.

**Une seule exception, qui n'est pas du parallélisme mais du pipeline** : la revue d'une story
peut chevaucher l'implémentation de la suivante, puisqu'elle ne touche pas au code et que la
suivante part d'un `dev` déjà fusionné.


## À savoir avant s14 (passkeys)

La garde du second facteur énumère désormais ses **exemptions** et vaut partout ailleurs. Une
route qui ouvre une session sans être ni couverte ni exemptée fait rougir une commande. Les
passkeys ouvrent une session : c'est exactement le cas que ce renversement attendait. Les cinq
exemptions actuelles sont ce qui a été **balayé** — les points d'entrée du greffon `two-factor`
et deux appels `auth.api.*` du module —, pas un inventaire de ce que la bibliothèque expose.

## Dette que s34 doit reprendre avant d'écrire la suppression de compte

La cascade `auth_user` → `organization_member` peut produire une organisation **sans
propriétaire** : ingouvernable à vie, et sans commande de réconciliation, ce que
`docs/reliability.md` interdit. Inatteignable par l'API aujourd'hui. Le mécanisme exact et la
ligne de schéma sont écrits dans `packages/modules/organizations/AGENTS.md` et l'ADR 030.

## Pièges de mesure connus

- **Un postgres orphelin peut détourner `localhost:5432` sous un conteneur « healthy ».** Un
  `embedded-postgres` lancé depuis un scratchpad écoute sur `127.0.0.1:5432`, **plus spécifique**
  que le proxy Docker en `*:5432` : toutes les connexions `localhost` partent chez lui pendant que
  `docker ps` affiche un conteneur en bonne santé. Trouvé en s41, après une saturation disque qui
  avait tué Docker. Diagnostic : `lsof -nP -iTCP:5432 -sTCP:LISTEN` — s'il y a une ligne
  `127.0.0.1` en plus de `*:5432`, c'est un orphelin ; `ps -o ppid -p <pid>` rendant `1` le
  confirme.

- **Un `.env` de poste peut faire passer une suite qui échouerait ailleurs.** Mesuré à la fusion
  de s18 : les parcours passaient chez la voie parce que son fichier portait `STORAGE_LOCAL_DIRECTORY`.
  Ce dont le harnais a besoin se déclare **dans `playwright.config.ts`**, jamais laissé au `.env`.

- **Next 16.3.3 charge sa configuration *après* la ligne `✓ Ready`.** Une mesure de démarrage qui
  s'arrête à cette ligne conclut à tort que les gardes d'environnement sont mortes. Mesuré en s19.

- **`turbo` sert le `.next` de l'autre configuration de modules.** Après un `pnpm ks toggle`, un
  `pnpm build` peut rendre « FULL TURBO » et servir le build précédent : la vérification
  navigateur regarde alors un arbre qui n'est pas le sien. `pnpm build --force` avant toute
  mesure au navigateur. Deux agents s'y sont fait prendre.
- **Un outil qui part de la racine voit les autres worktrees** (trois occurrences : balayage
  Tailwind de s10, `pnpm lint` à la fusion de s14, serveur Playwright partagé).

## Dettes à surveiller

- **Ce que s28 doit reprendre, et pourquoi c'est là.** La limitation de débit vit dans
  `marketing` (s11) alors que `docs/stories.md`, `docs/architecture.md` et `docs/security.md` §7
  l'attribuent au socle : ces trois textes sont **faux** aujourd'hui, à corriger avec s28.
  L'identifiant d'appelant (`x-forwarded-for`) est falsifiable, et la pile n'offre aucune adresse
  de pair : un identifiant sûr demande un nombre de sauts de proxy de confiance, qui appartient
  à s28. Conséquence assumée en attendant, écrite dans `packages/modules/marketing/AGENTS.md` :
  le seau dégrade au lieu de refuser, donc il ne borne plus le **nombre de lignes** écrites sous
  un en-tête qui tourne. L'ancienne forme convertissait ce risque en certitude d'indisponibilité
  pour les visiteurs légitimes — c'est l'échange que la revue a imposé.

- **Une exécution e2e rouge sur sept** pendant la revue de s45 : 22 parcours sur 42 en échec,
  tous fichiers confondus, jamais reproduite (six exécutions vertes ensuite, dont une à cache
  `.next` vide). Non attribuée à s45. `retries: 0` est délibéré : cette instabilité doit être
  regardée aux premières exécutions de CI, pas peinte en jaune.
- **La CI n'a jamais tourné.** `.github/workflows/ci.yml` existe, le dépôt a un `origin`, aucun
  push n'a été fait.
- `tests/module-migrations.test.ts` remet à zéro le journal de `demo-enabled` sur la base
  partagée : un `pnpm db:migrate` juste après la suite rejoue cette migration.

## Prochaine étape

Le chemin critique s'arrête à s09. Ensuite **cinq voies parallèles** : s10 marketing, s12 OAuth, s13 2FA, s14 passkeys, s15 organisations. Jusqu'à trois worktrees de front (`isolation: "worktree"` sur l'outil Agent), en sérialisant ce qui touche les fichiers chauds : `config/features.ts`, `generated/`, `turbo.json`, `eslint.config.ts`, `pnpm-lock.yaml`, `AGENTS.md`.

## Ce qu'un agent doit savoir avant d'écrire une ligne

Lire `AGENTS.md` (racine + package), `docs/architecture.md`, `docs/security.md`, `docs/reliability.md`, `docs/design-system.md`, et les ADR concernés.

Décisions structurantes déjà prises : contrat de module à 13 clés (ADR 007) · annuaire statique, code d'un module désactivé présent dans le bundle serveur (016) · `ModuleRoute[]` transitoire jusqu'à Hono (017) · clé étrangère inter-modules seulement vers un requis déclaré (018) · ordre canonique de `enabledModules` (019) · connexion injectée aux modules, un module n'importe jamais `@repo/db` (020) · socle non désactivable, exécutable (021) · **Radix, pas Base UI** — jamais de version stable publiée (022).

## Modes d'échec silencieux déjà rencontrés — les chercher systématiquement

1. Test vert par accident (suppression no-op + ajout no-op) — s05
2. Garde `catch` trop large transformant une restauration en suppression — s05
3. Postcondition traversée par la récupération d'erreur de TypeScript — s05
4. Garde textuelle contournée par un guillemet, un accent grave, une extension, un paquet unifié — s07, s08, **s09** (le détecteur de texte en dur ne lisait pas les littéraux gabarit ; corrigé, il a trouvé un « Fermer » écrit en dur dans `packages/ui`)
5. Configuration plate ESLint qui **remplace** les options : ajouter une garde en efface une autre — s08
6. `retries: 1` transformant une fuite de secret reproductible en badge jaune — s08
7. Assertion qui ne peut pas échouer (URL pré-redirection satisfaisant déjà le motif) — s08
8. Test qui **inventorie** au lieu de **vérifier** (`.env.example` comparé par noms de clés) — s06
9. Paramètre facultatif à **repli silencieux** : l'oublier au point de composition ne fait rougir aucune commande, et la règle redevient vraie par construction (`buildRegistry({locales})`) — s09
10. Garde qui lit le **texte** du fichier au lieu d'exécuter le comportement : `/onError:[\s\S]*?throw/` était satisfaite par le `throw` du gestionnaire suivant — s09
11. Invariant déplacé là où un test l'atteint, mais **plus branché** : la configuration qui refuse une clé manquante était éprouvée, et ramener `apps/web/i18n/request.ts` au repli silencieux laissait six commandes vertes. Un comportement se prouve **et** son câblage — ici par une sonde exercée au navigateur — s09
12. Scanner qui **abandonne en silence** au milieu d'un fichier : sur un délimiteur jamais refermé, `blankDelimited` blanchissait jusqu'à la fin, donc ne voyait plus rien après. Pire qu'une forme ratée, puisque c'est tout le reste qui l'est — s09
13. **Élargir un balayage syntaxique** au lieu d'inverser le levier : deux élargissements successifs laissaient encore passer `const BADGE = 'Beta'` puis `options={{ light: 'Light' }}`. La question « cette chaîne s'affiche-t-elle ? » ne se pose pas sur une ligne de source ; elle se pose sur un rendu (`tests/rendered-text.test.ts`, catalogue pseudo-locale) — s09

**Règle** : une mutation qui reste verte signifie que le test est faux, pas que le code est juste.

## Dettes ouvertes, nommées

- `e2e/modules.spec.ts:55` rouge quand **tous** les modules sont activés — trou s03, à traiter **avant s26**.
- `jsx-a11y` sans version compatible ESLint 10 (6.10.2, pair `^9`) — accessibilité portée par Radix, les rôles ARIA et la vérification visuelle en revue.
- Composants `Form`/`FormField` nommés par le design system, non construits — décision reportée (react-hook-form + Zod partagé côté client).
- La CI n'a **jamais** tourné : aucun run GitHub Actions. Toutes les étapes ont été jouées localement.
- Aucun déploiement réel, aucun envoi d'email réel (pas de clé Resend), aucune politique de sécurité du contenu (c'est s45).

---

# Session du 3 septembre 2026 — ce qu'elle a appris

## Dettes ouvertes, par ordre d'urgence

**1. `/pricing` est interdite d'indexation.** `seo.ts:92` construit la politique
en `disallow: ['/']` avec un `allow` ancré par chemin, et `publicPaths` ne dérive
que du module `marketing`. La page à plus forte intention commerciale d'un SaaS
est invisible des moteurs. **Réponse structurelle** : dériver `publicPaths` de
l'union des entrées de navigation `public` de **tous** les modules actifs —
`billing` en déclare désormais une. Mérite une story.

**2. Deux tables de compteur abandonnées, à supprimer plus tard.**
`public_form_throttle` et `billing_checkout_throttle` sont vides et inertes
depuis s28. Les supprimer **maintenant** casserait la version encore en ligne
(socle fiabilité : « cesser d'écrire avant de supprimer »). Une story ultérieure,
une fois qu'aucune version en service ne les écrit.

**3. Aucun appel réel à Stripe n'a jamais été fait** sur s19, s22, s23, s24.
Une clé de test a été fournie en session : trois prix réels existent dans le
compte, et **deux charges utiles authentiques** ont été capturées hors dépôt
(`customer.subscription.created`, `checkout.session.completed` en abonnement).
Il manque le `checkout.session.completed` en **achat unique**, qui exige un
paiement complété au navigateur. `tests/fixtures/stripe-events/` ne porte donc
que son README, le job CI `parcours-dore` reste dormant, et
`GOLDEN_PATH_PAYMENTS=recorded` échoue en nommant les trois natures manquantes —
comportement voulu par l'ADR 048.

**4. Le déploiement Coolify a été tenté pour de vrai et a échoué.**
Créés sur `coolify.olm.re` : projet `killer-saas` (`3mfuy7xrnrlzlztprpajwfwl`),
base PostgreSQL 16 `killer-saas-db` (`cqzsz7a1yorkth1xoyaogytc`, déployée),
application `killer-saas-web` (`fhe4qxfivor4aawgwo3r4b2b`). Bon commit cloné,
build pack Dockerfile, port 3000, quatre variables posées. **Échec après
~150 s** ; l'API n'expose pas le journal, il faut le lire dans l'interface.
Hypothèse principale : saturation mémoire pendant `next build`.
**Le MCP Coolify ne sait pas créer** — lecture et cycle de vie seulement ;
la création est passée par l'API REST.

**5. Vercel n'a jamais été exercé** — aucun accès dans l'environnement.

**6. `config/billing.ts` ne déclare aucune offre au siège**, donc tout le chemin
d'écriture de s23 ne s'exécute jamais dans la configuration livrée. Et le
**proratage** que l'ADR 046 déclare explicitement ne pas trancher n'a été vu par
personne.

## Modes d'échec silencieux rencontrés cette session

Les chercher systématiquement — chacun a été trouvé par mutation, jamais par
lecture.

- **Un câblage de point de composition que rien ne tient.** Couper le fil entre
  `organizations` et `billing` laissait **1708 tests verts** (s23). Un `grep` ne
  suffit pas : il passe au vert sur un câblage qui épelle le bon nom en remettant
  un objet inerte. Mesurer le **comportement**.
- **Une ligne d'`auth` sans filet.** Supprimer le marquage de vérification
  d'adresse laissait **1745 tests verts** (s24).
- **Une moitié de critère sans test.** Le paiement unique invité fonctionnait et
  n'était couvert par rien — sur le seul chemin qui encaisse 490 € d'un anonyme
  (s24).
- **`output: 'standalone'` supprime les gardes de démarrage.** Next sérialise la
  configuration et n'exécute plus `next.config.ts` au lancement. Serveur démarré
  sans aucune variable : `✓ Ready`, puis 503 pour toujours (s27). La garde vit
  désormais dans `instrumentation.ts`, et le refus **sort du processus** — parce
  qu'une exception y laisse Next vivant, répondant 500.
- **`hashFiles` dans un `if:` de niveau job invalide tout le workflow.** GitHub
  rejette le fichier entier ; ce dépôt n'en a qu'un, donc typecheck, lint, tests
  **et le scan de secrets** tombent. Invisible à toute commande locale. Deux
  gardes existent maintenant : `actionlint` en conteneur, et un test qui balaie
  les `if:` de niveau job.
- **Un baril généré vide injecte `default` comme une table.** Deux barils vides
  se cognent bruyamment ; **un seul passe sans un mot** — défaut latent sur `dev`
  jusqu'à s28. Corrigé dans `composeSchema`.
- **Un seuil de débit trop serré est un déni de service.** Tous les visiteurs
  derrière une même adresse partagent un seau : un NAT, un opérateur mobile, ou
  un déploiement sans proxy de confiance, et le sixième visiteur de l'heure ne
  peut plus s'inscrire (s28). Mesuré par les parcours navigateur, 26 échecs
  sur 92.
- **Une affirmation « mesurée » qui ne l'est pas.** « Une migration en échec
  laisse la version précédente servir » était faux : la mesure d'origine avait
  été faite sur un volume neuf, où aucune version précédente n'existait (s27).
  Répétée dans cinq textes.

## Deux erreurs de méthode à ne pas refaire

**Mesurer dans un état mixte.** Un implémenteur a diagnostiqué un build cassé en
restaurant un fichier de `dev` dans un arbre qui portait déjà son module — ni
l'un ni l'autre. Il a conclu « préexistant sur `dev` » ; le build était **vert
sur `dev`, rouge sur sa branche**. Toujours mesurer les deux séparément.

**Écrire dans un worktree pendant que son gestionnaire l'installe.** Fait quatre
fois dans cette session. La règle « un agent, un répertoire » vaut aussi pour le
contexte principal : attendre la reddition avant d'écrire.

## Ce que le régime de revue a produit

Sept stories livrées, **deux ships bloqués sur `critical`**, et à chaque fois le
défaut était invisible en lecture. Les revues qui ont trouvé le plus ont toutes
fait la même chose : **prouver que leur propre suite tournait vraiment** (pointer
`DATABASE_URL` sur un port mort et mesurer l'effondrement du nombre de cas),
**vérifier les bibliothèques sur le paquet installé** plutôt que de mémoire, et
**poser les mutations au site du défaut** — pas dans la garde qu'on veut voir
rougir.
