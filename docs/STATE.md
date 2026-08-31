# État de reprise — killer-boilerplate

> Fichier de passation. À lire **en premier** après un `/clear`. La vérité reste dans les fichiers du dépôt ; ceci dit seulement où on en est et comment on travaille.

## Où on en est

| Story | État |
|---|---|
| s01 → s12, s15, s16, s45 | **closes**, revues, correctifs appliqués |
| s13, s14, s17 → s44, s46 | à faire — 31 stories (s13 en correction) |

Tests : **1050 + 2 ignorés**, 57 parcours end-to-end, déterministes (`retries: 0`).
ADR : **28** (026 puis 029 ; 027 appartient à s11, 028 à s13, tous deux non fusionnés). Branche : `dev`. Commits : un par story, plus `docs:` pour recherche, plan, revue.

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

## Voies en cours (vague parallèle, ouverte le 31/08/2026)

| Voie | Story | Worktree | Base / port |
|---|---|---|---|
| A | s13-two-factor | commit `bc02ef8`, revue **critical**, **tour de correction** | `s13`, port 3113 |
| D | s17-roles-permissions | `feature/s17-roles-permissions` | `s17`, port 3117 |
| B | s16-invite-members | **fusionnée dans `dev`** (`6f14cc4`), revue `none`/ship oui | close |
| C | s11-public-forms | **fusionnée dans `dev`** (`9cf45c2`), revue `none`/ship oui | close |

**Les numéros d'ADR se réservent à l'ouverture d'une vague.** Deux voies parallèles qui
prennent « le prochain numéro libre » prennent le même, et la fusion écrase une décision sans
conflit visible — les fichiers portent le même nom. Vague en cours : 026 et **029** = s16, 027 = s11, 028 = s13, **030 = s17**. s16 avait pris 027 à sa reprise
après coupure : deux ADR de même numéro ne produisent **aucun** conflit de fusion, les fichiers
portant des noms différents — la numérotation ment en silence. Renumérotation avant fusion.

**Le worktree d'un agent arrive sur une branche `worktree-agent-<id>`, pas sur `feature/<id>`** :
la première consigne d'une voie est de la renommer (`git branch -m feature/<id>`). Sans ça la
story se fait sur un nom hors convention, et la fusion ne retrouve rien.

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

**Le port des parcours est réglé (`df3bb2f`).** `reuseExistingServer` est passé à `false` :
Playwright démarre son propre serveur et échoue bruyamment si le port est pris, au lieu de
mesurer l'arbre d'une autre branche. Chaque voie choisit le sien par `E2E_PORT` — voir la
colonne de la table ci-dessus. Vérifié dans les deux sens : vert port libre, refus explicite
port occupé.

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
