# État de reprise — killer-boilerplate

> Fichier de passation. À lire **en premier** après un `/clear`. La vérité reste dans les fichiers du dépôt ; ceci dit seulement où on en est et comment on travaille.

## Où on en est

| Story | État |
|---|---|
| s01 → s19, s45 | **closes**, revues, correctifs appliqués |
| s20 → s44, s46 | à faire — 26 stories (s36 en correction) |

Tests : **1420 + 6 ignorés**, 73 parcours end-to-end, déterministes (`retries: 0`).
ADR : **35** (jusqu'à 034 et 037 fusionnés ; 035-036 appartiennent à s36, non fusionnée). Branche : `dev`. Commits : un par story, plus `docs:` pour recherche, plan, revue.

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

## Ce qui ne se négocie à aucun niveau

- Toute story passe par un **relecteur en contexte frais** et par la porte mécanique
  `Ship allowed`. On ne relit jamais dans le contexte qui a écrit.
- Chaque invariant revendiqué est **neutralisé à l'endroit du défaut**, et le rouge est montré.
  C'est ce qui a rattrapé les treize tests faux.
- **Les deux configurations de modules**, dès qu'une story touche un module.
- **La vérification navigateur**, dès qu'il y a un écran : elle a mordu six fois, chaque fois sur
  un défaut qu'aucune des six commandes ne voyait.

**Deux voies en parallèle, pas trois.** Les trois coupures de limite d'usage sont toutes arrivées
à trois voies simultanées, et chaque coupure fait perdre le travail en cours d'un agent.

## Voies en cours (vague parallèle, ouverte le 31/08/2026)

| Voie | Story | Worktree | Base / port |
|---|---|---|---|
| A | s14-passkeys | **fusionnée dans `dev`** (`0c85639`), revue `minor`/ship oui | close |
| B | s18-file-storage-avatar | **fusionnée dans `dev`** (`caaa77c`), deux revues, `minor`/ship oui | close |
| C | s19-subscribe-stripe | **fusionnée dans `dev`** (`448351d`), trois revues, `minor`/ship oui | close |
| D | s36-cookie-consent | commit `8448788`, **en revue** | `s36`, port 3136 |
| D | s17-roles-permissions | **fusionnée dans `dev`** (`2b997df`), revue `major`/ship oui | close |
| B | s16-invite-members | **fusionnée dans `dev`** (`6f14cc4`), revue `none`/ship oui | close |
| C | s11-public-forms | **fusionnée dans `dev`** (`9cf45c2`), revue `none`/ship oui | close |

**Les numéros d'ADR se réservent à l'ouverture d'une vague — et un tour de correction peut en
consommer un de plus.** C'est arrivé deux fois : s16 puis s18 ont ouvert un ADR imprévu pendant
leur correction, sur un numéro déjà réservé à une autre voie. Réserver deux numéros par voie
coûte moins qu'une renumérotation. Deux voies parallèles qui
prennent « le prochain numéro libre » prennent le même, et la fusion écrase une décision sans
conflit visible — les fichiers portent le même nom. Vague en cours : 026 et **029** = s16, 027 = s11, 028 = s13, **030 = s17**, **031 = s14**, **032 = s18**, **033 = s18** (pris au tour de correction), **034 = s19**, **035-036 = s36** (deux numéros par voie désormais). s16 avait pris 027 à sa reprise
après coupure : deux ADR de même numéro ne produisent **aucun** conflit de fusion, les fichiers
portant des noms différents — la numérotation ment en silence. Renumérotation avant fusion.

**Le worktree d'un agent arrive sur une branche `worktree-agent-<id>`, pas sur `feature/<id>`** :
la première consigne d'une voie est de la renommer (`git branch -m feature/<id>`). Sans ça la
story se fait sur un nom hors convention, et la fusion ne retrouve rien.

**Une mutation posée ailleurs qu'à l'endroit exact du défaut ne prouve rien.** Mesuré en s19 :
deux constats annoncés fermés « à 1 rouge » l'étaient par une mutation posée dans le module,
alors que la neutralisation au **point de composition** — là où vivait le bug — laissait
1320 tests sur 1320 verts. Quand un tableau de mutations est relu, vérifier **où** la mutation
est posée, pas seulement qu'elle rougit.

**Une mutation se restaure juste après avoir été mesurée, jamais en fin de campagne.** Le
31/08/2026, une limite d'usage a tué trois agents d'un coup ; le relecteur de s45 est mort avec
`headers.set(NONCE_HEADER, 'TEHMUTANT')` encore en place dans `apps/web/proxy.ts`. Une mutation
oubliée dans un arbre est indiscernable d'un défaut réel pour qui passe après. Après toute
interruption d'agent : `git status` du worktree **avant** de conclure quoi que ce soit.

Chaque voie fait recherche → design → plan → exécution TDD → **un commit** sur sa branche, puis
un `reviewer` en contexte frais écrit `docs/reviews/<id>.md` dans le worktree. Fusion dans `dev`
**une voie à la fois**, en régénérant après coup ce qui dépend de `config/features.ts`.

Fichiers chauds, à ne jamais laisser à deux voies en même temps : `config/features.ts`,
`generated/`, `turbo.json`, `eslint.config.ts`, `pnpm-lock.yaml`, `AGENTS.md`, `docs/STATE.md`
(celui-ci appartient à l'orchestrateur). Chaque voie a **sa propre base** : deux suites qui
migrent dans `app` en même temps rougissent pour rien.

**Un outil qui part de la racine du dépôt voit les autres worktrees.** Trois fois maintenant :
le balayage Tailwind de s10, `pnpm lint` à la fusion de s14, et le serveur Playwright partagé.
Les worktrees vivent dans `.claude/worktrees/` : tout balayage doit s'en exclure ou passer par
`git ls-files`, qui ne voit que l'arbre courant.

**Le port des parcours est réglé (`df3bb2f`).** `reuseExistingServer` est passé à `false` :
Playwright démarre son propre serveur et échoue bruyamment si le port est pris, au lieu de
mesurer l'arbre d'une autre branche. Chaque voie choisit le sien par `E2E_PORT` — voir la
colonne de la table ci-dessus. Vérifié dans les deux sens : vert port libre, refus explicite
port occupé.

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
