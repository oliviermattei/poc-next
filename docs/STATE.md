# État de reprise — killer-boilerplate

> Fichier de passation. À lire **en premier** après un `/clear`. La vérité reste dans les fichiers du dépôt ; ceci dit seulement où on en est et comment on travaille.

## REPRENDRE ICI

**Aucune voie en cours.** `dev` est à jour, poussée, aucun worktree ouvert.
Le travail reprend en **série** : une story à la fois, branchée sur `dev`.

Candidates dont les dépendances sont satisfaites : **s21** (essais et gating,
dépend de s20 — fusionnée), **s39** (monitoring, dépend de s36), **s46** (écrans
d'authentification), **s32** (notifications), **s37** (admin, dépend de s21).
Numéros d'ADR libres : **043 et suivants**.

Avant d'ouvrir une voie, vérifier le verdict de la CI :
`gh run list --limit 3 --json status,conclusion,displayTitle`. Si la matrice
`tous` / `socle` est verte, l'agent n'a plus à jouer les six commandes deux fois.

## Où on en est

| Story | État |
|---|---|
| s01 → s20, s36, s41, s45 | **closes**, revues, correctifs appliqués |
| s20 → s35, s37 → s44, s46 | à faire — 25 stories (s20 en cours) |

Tests : **1580 + 6 ignorés**, 80 parcours end-to-end, déterministes (`retries: 0`).
ADR : **42** (jusqu'à 042 fusionnés ; 043 et suivants libres).

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
