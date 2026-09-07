# Review — s58-donnees-de-demonstration

> Contexte neuf. Diff jugé : 1 commit `3fa0cd0`, 23 fichiers.

## Ce que la revue a joué elle-même

`pnpm test` **2934 verts** · `typecheck` · `lint` · **`test:minimal-profile`** exit 0 — `pnpm db:seed` **réussit** en configuration coupée, seul `auth.comptes` restant · **`test:socle`** exit 0, 11 étapes rejouées, 108 parcours · `test:sans-env` 103 fichiers · `E2E_PORT=3158 pnpm test:e2e` 124 verts **sur une base portant les lignes semées** · `db:seed` deux fois : **147 → 153, puis 153 → 153**.

`tests/seed.test.ts` vérifié comme **réellement exécuté** (5/5, non sauté).

## Les trois murs — ils existent, et la réponse les respecte

Le lint interdit bien à `organizations` d'importer l'authentification hors de deux fichiers nommés ; le règlement de `notifications` dit bien qu'il ne connaît ni l'un ni l'autre ; `billing` déclare bien `requires: []`. Recevoir des **portées** au point de composition est la forme que `purge` et `export` emploient déjà. **Aucun module n'en importe un autre, aucun identifiant de module n'est écrit dans le chemin du seed.**

## Preuves navigateur

Connexion réelle avec les identifiants du README : cookie de session `HttpOnly; Secure; SameSite=Strict`, `emailVerified: true`. `/fr/notifications` rend les trois notifications avec l'acteur résolu en nom d'affichage et « 2 non lues ». `/fr/billing` : « Abonnement actif — Pro mensuel ». `/fr/organizations` : Propriétaire et Membre, organisation présélectionnée. **`/fr/premium` : « Accès ouvert »** — l'abonnement semé ouvre réellement la fonctionnalité réservée.

**Les écrans ne sont plus vides. C'est le but de la story, et il est atteint.**

## Constats

**1. major — la transaction unique n'est pas testée, et quatre documents affirment qu'elle porte la garantie.** La retirer entièrement laisse **toute la suite verte (2934)**. Or le règlement racine, celui de `packages/db`, le commentaire de `runSeeders` et le message de commit affirment tous qu'« un refus n'écrit rien, **quel que soit l'ordre du graphe** ». Le seul cas qui pourrait mordre ne passe **que parce que `auth` est en tête** — précisément l'accident que la transaction devait supprimer. Le cas qui fuirait est `billing`, sans clé étrangère vers l'authentification, et rien ne le couvre. *Une mutation verte veut dire que le test est faux.*

**2. major — la convention a changé et trois énoncés de l'ancienne règle sont restés, dont un livré aux utilisateurs.** `content/docs/{fr,en}/reference/modules.mdx` porte encore « **Quinze clés, obligatoires dès le premier module** » et « pourquoi aucune n'est facultative ». Ce MDX est **servi par le module de documentation** : le produit documente désormais à ses propres utilisateurs le contraire de ce qu'il fait. `packages/core/AGENTS.md` répète que le contrat est complet dès le premier module. Le diff a corrigé le règlement racine et l'architecture, et s'est arrêté là.

**3. major — aucun ADR pour la première clé optionnelle du contrat.** L'ADR 007 décide « le contrat est complet dès le premier module » et **rejette explicitement** l'option « contrat minimal étendu au fil des besoins ». Ce diff amende cette décision **en prose**, ce qui est la seule chose que le dépôt interdit : un ADR est immuable, on le supersède. Tous les changements comparables en ont eu un — 054 pour `publicUrls`, 059 pour `jobs`, 066/067 pour la surface de navigation, **le précédent que cette story cite**. Circonstance atténuante : la direction est sanctionnée par les notes de la story et par le plan validé ; c'est la trace qui manque.

**4. major — le plancher n'attrape pas ce que son commentaire annonce.** Les deux fichiers écrivent : « sans ce plancher, le prochain module qui oublie son seed ne le saura pas davantage ». Le plancher compte les lignes de **tout le schéma** : les lignes d'un autre seed le satisfont. Même sur une base neuve, les 4 lignes de l'authentification suffisent — un module qui déclare un seed et n'écrit rien sort **0**. Ce que la tâche 2 demandait est livré et la mutation le prouve ; **la phrase écrite à côté promet davantage**, et c'est exactement la classe de défaut que cette story ferme.

**5. minor — la correction que l'implémenteur apporte à la recherche est elle-même fausse.** Il annonce 28 tables plus une fixture. Mesuré deux fois : **29 tables**, et **aucune** fixture — le test de migrations la supprime dans ses deux crochets. Le 29 de la recherche était juste, et aucune base partagée n'est polluée.

**6. minor** — le type de la base dans le contrat est `never`, donc assignable à tout : un module peut déclarer n'importe quelle forme et l'échec atterrit à l'exécution. Documenté et confiné, mais aucune commande ne le tient.

**7. minor** — rien ne refuse deux seeds partageant un identifiant dans un même module, là où `jobs` refuse au démarrage.

**8. minor** — le test d'idempotence préexistant, celui qui « n'éprouve qu'un seeder qu'il s'injecte à lui-même » et qui est la moitié de la raison d'être de cette story, survit intact et sans justification.

## Chasse P30 — une seconde commande verte qui ne fait rien

Cherchée. Trouvée : c'est le constat 4. Les autres candidats tiennent — le comptage échoue fermé, l'assertion sur l'ensemble vide est appariée à une assertion positive, le balayage porte un vrai plancher, le comptage des comptes étrangers traite le cas vide explicitement, et `turbo.json` désactive le cache de `db:seed`, donc un second passage ne peut pas être un succès rejoué.

## Conformité au plan

Les sept tâches atterrissent. Le « seize modules » du plan était inexact : mesuré, **19 répertoires, 4 touchés, 15 intacts**, et aucun module sans seed n'est modifié. La garde ne se contourne pas en coupant un module : `auth` est dans les modules requis, donc elle est présente dans **toute** configuration livrable.

## Non vérifié

- **Aucun build de production n'a jamais été rendu avec des données semées.** Geste : `pnpm build && pnpm start` sur une base semée, puis ouvrir les écrans — le chemin du nonce CSP et les écrans semés ne se sont jamais rencontrés.
- **La seconde recette du README n'a jamais été exécutée** : poser `SUPERADMIN_EMAIL`, redémarrer, et confirmer que l'entrée d'administration paraît.
- **Personne n'a vu le premier écran d'un compte semé depuis zéro** : la base portait des progressions d'intégration résiduelles.
- **La limite « offre inconnue » est énoncée, jamais rendue.**
- **`pnpm test:golden-path` non joué** — l'autre consommateur de `db:seed` en CI.
- **Stripe jamais contacté** : le chemin de réconciliation a été lu, pas exécuté. Il n'efface pas sur une lecture en échec, donc les identifiants fictifs sont inoffensifs — mais personne ne l'a joué avec de vraies clés de test.
- **Rendu mobile des listes semées** non vérifié.

Max severity: major
Ship allowed: yes
