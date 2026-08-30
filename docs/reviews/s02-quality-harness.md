# Review — Story s02-quality-harness

> Revue anti-hallucination en contexte neuf. Diff jugé : `git show e268e58` (l'unique commit d'implémentation, 37 fichiers hors lockfile). `4af464f` (ADR 015 + points de vigilance) n'est jugé que pour sa cohérence avec le code.

## 1. Commandes exécutées, pas rapportées

| Commande | Résultat |
|---|---|
| `pnpm install --frozen-lockfile` | 0 — « Lockfile is up to date » |
| `pnpm typecheck` | 0 — racine + 3 packages |
| `pnpm lint` | 0 |
| `pnpm test` | 0 — **93 passed (93)**, 8 fichiers, 0 skip |
| `pnpm build` | 0 |
| `pnpm test:e2e` | 0 — 2 passed (chromium) |
| `pnpm run audit` | 0 — « 1 avis remonté, aucun au seuil « élevé » qui ne soit couvert » |

Les cinq fichiers hérités de s01 totalisent **36** : le socle est intact au test près.

**Critère 12, mesuré sur l'arbre committé** : `rm -rf .turbo apps/web/.next` → build → `test:e2e` → `git status --porcelain` **vide**. N5/N18 fermés.

**Clone vierge** à `e268e58`, sans `.next/`, sans `next-env.d.ts`, sans `.env` : `pnpm typecheck` **0** (cache miss, donc réellement exécuté), `pnpm lint` 0, `pnpm test` 90 passed / 3 skipped (base absente). L'arbitrage de la tâche 7 tient.

## 2. Le point qui décide de la story — la règle de frontières

**a) Elle rejette les sept arêtes interdites.** `tests/lint-rules.test.ts` exécute le **même objet** `boundariesConfig` que celui monté dans `eslint.config.ts`, constate 7 refus, 4 passages, et que les 11 fichiers ont bien été analysés (`report.size === 11`, garde anti-inertie).

**b) Elle mord, prouvé par mutation.**

| Mutation dans `tooling/eslint/boundaries.ts` | Rouges |
|---|---|
| Suppression de `settings['import/resolver']` | **7** |
| Motif `**/packages/modules/*/src/` → `.../lib/` | **7** |
| `infrastructure` autorisé vers `presentation` | **1**, la bonne |

La première confirme l'affirmation centrale : **sans `import/resolver`, le résolveur ignore `.ts`, aucune dépendance n'est classée, les sept arêtes passent en silence.** La règle aurait été livrée inerte.

**c) Elle mord sur le chemin réel.** Dans un clone jetable, `packages/modules/probe/src/{domain,application,infrastructure}` — le chemin exact de `docs/architecture.md:57` — avec deux imports interdits, puis `pnpm lint` avec la configuration du dépôt :

```
packages/modules/probe/src/application/use-case.ts
  1:22  error  Frontière de couches (ADR 006) : application ne peut pas importer infrastructure
packages/modules/probe/src/domain/rule.ts
  1:22  error  Frontière de couches (ADR 006) : domain ne peut pas importer infrastructure
```

Les motifs collent au chemin que s03 va créer. C'est le contraire d'une règle décorative.

## 3. Les affirmations à contre-courant de la recherche : toutes vraies

- **`typescript-eslint` refuse TypeScript 7** — `parser/dist/index.js:49` : `throw new Error('typescript-eslint does not support TS 7.0.')`. ADR 015 fondé.
- **Le cloisonnement tient** — racine, `packages/config`, `packages/db`, `apps/web` en `7.0.2` ; `tooling/eslint` en **`6.0.3`**. Aucune ligne applicative compilée par TypeScript 6.
- **`boundaries/element-types` est déprécié** — `meta.deprecated.message = 'Use "boundaries/dependencies" instead.'`. Idem `entry-point`, `external`, `no-private`, `no-ignored`, `no-unknown`. La recherche disait le contraire ; le code a raison.
- **`pnpm audit` est un builtin qui masque le script.**
- **`eslint-config-next` réellement absent** — zéro occurrence de `eslint-config-next`, `eslint-plugin-react` (hors `-hooks`) et `jsx-a11y` dans le lockfile. La perte a11y est **réelle** et **bornée** : `apps/web` n'a aujourd'hui aucune règle a11y applicable.
- **Les cinq actions GitHub existent**, vérifiées sur l'API. Aucune version inventée.
- **Les APIs de plugins existent**, ouvertes dans les paquets installés.

## 4. Mutations

Huit neutralisations, toutes restaurées, `git diff --exit-code` propre.

| Neutralisation | Rouges | Lecture |
|---|---|---|
| `import/resolver` supprimé | 7 | la règle serait inerte |
| Motif `src/` → `lib/` | 7 | le motif classe bien |
| `infrastructure → presentation` autorisé | 1 | discrimination arête par arête |
| `resolve(from)` retiré | 2 | dont la nouvelle assertion N11 |
| `NODE_BUILTINS` réduit aux `node:` préfixés | 1 | exactement le bug N13 de s01 |
| Dépendance non documentée dans `packages/db` | 1 | contrat documentaire réel |
| `## Commands` renommé | 2 | |
| Erreur de type dans 5 emplacements | typecheck rouge ×5 | N4 fermé |

La couverture du typage est plus large que le plan ne l'exigeait : le test co-localisé échappe au `tsc` racine mais est rattrapé par celui du package via turbo.

Harnais d'audit éprouvé avec un `pnpm` stubbé : avis élevé non couvert → **1** ; exception expirée → **1** ; exception valide → **0**. Format `advisories` conforme à la sortie réelle. Cas « zéro vulnérabilité » reproduit dans un projet vide.

Scan de secrets exercé au binaire Go : faux jeton committé → `leaks found: 1`, sortie 1. Détail utile : une clé AWS d'exemple canonique n'est **pas** détectée (liste blanche gitleaks) — pas un défaut, mais le genre de faux négatif qui fait croire qu'un scan ne marche pas.

## 5. Findings

### Major — `pnpm run audit` passe au vert quand l'audit lui-même échoue

`scripts/audit.ts:30-49` n'inspecte que `result.error` (échec de spawn), jamais `result.status` ni la forme du JSON. Or `pnpm audit --json` répond sur erreur par `{"error":{...}}` avec un code 1. `readAuditReport` ne trouve pas `advisories`, retourne `[]`, et `main()` conclut « aucun au seuil élevé ».

Reproduit, pas déduit :

```
$ tsx scripts/audit.ts          # répertoire sans lockfile
Audit : 0 avis remonté(s), aucun au seuil « élevé » qui ne soit couvert.
SCRIPT_EXIT=0
```

En CI, une indisponibilité du registre ou une limitation de débit rendra l'étape verte sans qu'aucun audit ait eu lieu. **Un contrôle bloquant qui se désactive tout seul, silencieusement** — précisément ce que l'interdit « ne pas relâcher un contrôle pour faire passer la CI » cherche à empêcher. Correctif : refuser un rapport portant `error`, traiter un `status` non nul sans `advisories` comme un échec.

Classé major et non critical parce que le contrôle *existe* et *bloque* sur son chemin nominal (les trois chemins sont prouvés) : le défaut est une branche d'erreur non gérée, pas un contrôle absent. Le propriétaire peut légitimement escalader.

### Minor — l'exception du harnais de test est plus étroite que son commentaire

`eslint.config.ts:86-92` dit « bornée aux deux emplacements déclarés par `vitest.config.ts` ». `vitest.config.ts:28` déclare `packages/**/src/**/*.test.ts`, l'exception écrit `packages/*/src/**/*.test.ts`. **Un astérisque de moins**, et les tests des futurs modules tombent hors de l'exception. Vérifié : un test de `packages/config` est exempté, un test de `packages/modules/probe/src/domain` est jugé. L'écart échoue fermé et bruyamment, mais il coûtera une demi-heure à s03.

### Minor — `pnpm lint` ne bloque pas sur les avertissements

`eslint .` sans `--max-warnings=0`. Le preset `core-web-vitals` est majoritairement en `warn` : un `<img>` produit un warning et **`pnpm lint` sort 0**. Les règles Next livrées sont donc aujourd'hui de la documentation — ce que `tooling/eslint/AGENTS.md` s'interdit lui-même deux paragraphes plus bas.

### Minor — `docs/architecture.md` renvoie à une règle dépréciée

La note ajoutée par `4af464f` annonce `boundaries/external` pour la pureté du `domain`. Cette règle est dépréciée au même titre qu'`element-types` ; le mécanisme réel est `boundaries/dependencies` avec un sélecteur `dependency`. Le reste de la note est juste : un `domain` important `zod` passe aujourd'hui sans erreur.

### Minor — `apps/web/AGENTS.md` versionne un bloc que `next dev` régénère

Le bloc `<!-- BEGIN:nextjs-agent-rules -->` est produit par `next dev`. Tant que le texte amont ne bouge pas, l'upsert est un no-op. Le jour d'une montée de Next, `pnpm test:e2e` salira l'arbre — et l'étape « arbre propre » du workflow tourne **avant** les parcours, donc ne couvre pas la commande qui écrit ce fichier.

### Minor — un script de post-installation autorisé sans justification écrite

`onlyBuiltDependencies` ajoute `unrs-resolver`. Bon mécanisme, dépendance légitime, mais `docs/security.md` §6 dit « autorisés au cas par cas » : un cas s'écrit.

### Minor — deux fragilités de test pour s03/s04

`PACKAGES.length >= 5` est un plancher, pas une égalité. Et le motif de lecture de `pnpm-workspace.yaml` ne matchera pas un futur `packages/modules/*`.

## 6. Les déviations déclarées, jugées

**Pas de tâche turbo `lint`** — accepté, meilleur que le plan : une configuration plate unique lint tout en un processus ; une tâche par package aurait laissé `tests/`, `e2e/`, `scripts/` hors de portée. **`env.test.ts` co-localisé** — accepté, c'est la démonstration du critère « deux emplacements », et il est bien typé (prouvé par mutation). **Section `## Commands`** — exigée par le critère 8, et opposable (test dérivé de `package.json`). **`docs/reliability.md`** — demandé nommément par l'item 18. **Trois fichiers de test** — conforme à la stratégie du plan. **`.audit-exceptions.json` vide** — **correct** : le seul avis est `moderate`, sous le seuil, il n'a pas à être excepté. Une exception écrite ici aurait été de complaisance.

Interdits vérifiés sur le lockfile : aucun tailwind, shadcn, hono, orpc, better-auth, aucun paquet npm `gitleaks`, aucun seuil de couverture. Un seul package créé.

## 7. Ce que je n'ai pas pu vérifier

- **Le workflow n'a jamais tourné.** Commandes exécutées localement une à une, actions vérifiées existantes — mais ni le conteneur de service Postgres, ni `playwright install --with-deps` sur `ubuntu-latest`, ni `gitleaks-action` sans licence sur un dépôt personnel. **Geste humain** : pousser une branche jetable, lire le run ; puis un commit portant une erreur de type, une violation de lint, une traversée de couche et un faux jeton, et vérifier que le workflow rougit sur chacun.
- **Le parcours end-to-end n'exerce jamais le build de production** : Playwright démarre `next dev`. L'artefact construit n'est jamais servi à un navigateur.
- **`reuseExistingServer: true` sans condition** — si un job laisse un serveur sur 3100, les parcours testeront celui-là.
- **La cause invoquée pour abandonner `eslint-config-next`** — le paquet n'étant plus dans le lockfile, la raison repose sur la parole de l'implémenteur. Le *résultat* est prouvé.
- **L'audit en panne réseau** — payload simulé, pas une indisponibilité réelle.
- **Aucun écran rendu** — la story n'a pas d'UI.

## 8. Les douze critères

| # | Critère | État |
|---|---|---|
| 1 | Les quatre commandes passent | **prouvé** |
| 2 | typecheck couvre racine, `tests/` et packages | **prouvé** — 5 mutations |
| 3 | lint échoue, `lint:fix` répare | **prouvé** |
| 4 | Le lint fait respecter la règle de couches | **prouvé deux fois** — fixtures et chemin réel |
| 5 | Audit et scan de secrets bloquants | **partiellement** — chemins nominaux mesurés, branche d'erreur verte (major) |
| 6 | `AGENTS.md` par package + test | **prouvé** |
| 7 | Test unitaire et end-to-end | **prouvé pour l'end-to-end** (serveur, HTTP et base réels) |
| 8 | `AGENTS.md` racine + test de sections | **prouvé** |
| 9 | La CI exécute tout et échoue si l'un échoue | **non prouvé ici** — recette CI due |
| 10 | `--frozen-lockfile` | **prouvé** — clone neuf |
| 11 | CI démarre Postgres et migre avant les tests | **non prouvé ici** |
| 12 | `git status` propre après build | **prouvé** |

Aucun critère non tenu. Deux hors de portée de ce poste, un tenu à une branche d'erreur près.

## Verdict

C'est la story où l'on pouvait le plus facilement livrer du décor, et elle ne l'a pas fait. La règle qui donne son sens à toute l'architecture a été écrite alors qu'aucune couche n'existe, et elle **mord** : sept violations refusées sur les fixtures, et — la vérification qui compte — refusées aussi sur le chemin exact que s03 va créer. L'implémenteur a trouvé, nommé et corrigé le piège qui l'aurait rendue muette. Une règle qu'on n'a jamais vue échouer n'existe pas ; celle-ci, on l'a vue échouer de quatre façons.

Les affirmations qui contredisaient la recherche sont toutes vraies, vérifiées dans les paquets installés. Aucune API inventée. Les sept findings reportés de s01 sont fermés, six **sous mutation**.

Ce qui reste est ironique pour une story qui installe des garde-fous : le garde-fou de l'audit se désarme tout seul quand l'outil qu'il pilote tombe en panne, en écrivant « aucun avis au seuil élevé ». Même famille que les deux leçons de s01 — un contrôle dont le message promet plus qu'il n'a vérifié. Trois lignes le referment. Deux autres écarts méritent d'être repris avant s03 : l'exception de test à un astérisque près, et le renvoi vers une règle dépréciée.

---

## Addendum — tour de correctifs `89d2ade`

> Ajouté par l'orchestrateur après la revue. Le major et les cinq mineurs retenus ont été fermés ; suite passée de 93 à **110 tests**, tous verts, `typecheck`/`lint`/`build`/`e2e`/`audit` à zéro.

- **Major fermé.** `readAuditRun` lit désormais le code de sortie **et** la forme du document ensemble. Le discriminant n'est pas le code — `pnpm audit` sort en non-zéro dès qu'il trouve un avis, c'est aussi le cas nominal — mais la présence d'un rapport : clé `error` refusée, statut non nul sans `advisories` refusé, stdout vide et JSON illisible refusés. Prouvé dans les deux formes d'échec, dont « Un audit qui n'a pas eu lieu n'est pas un audit sans vulnérabilité ». Six mutations rouges, dont une qui recâble le script sur l'ancienne lecture et ne rougit qu'au niveau du script — exactement là où le défaut vivait.
- **L'astérisque : exception maintenue étroite**, et le commentaire dit désormais ce que le code fait. Raison inscrite dans `eslint.config.ts` : l'exception sert au harnais à observer le câblage qu'il vérifie, elle n'a pas de raison de s'étendre *à l'intérieur* d'un module, là où la règle de couches vaut le plus. Un test `domain` qui a besoin d'`infrastructure` ne signale pas une règle trop stricte, il signale un `domain` qui n'est plus pur. Portée épinglée par des assertions via `calculateConfigForFile` : la dérive n'est plus silencieuse.
- **`--max-warnings=0`** sur `lint` et `lint:fix`. Les règles Next cessent d'être de la documentation.
- **Bloc généré d'`apps/web/AGENTS.md` : maintenu versionné**, faute de pouvoir ignorer une portion de fichier — ne pas le versionner salirait l'arbre après chaque `next dev`, donc après chaque `test:e2e`, et ferait échouer le critère 12 en permanence. La vérification d'arbre propre de la CI est **déplacée après `test:e2e`**, seule position couvrant la commande qui écrit ce fichier.
- **`unrs-resolver` supprimé plutôt que justifié** : dépendance fantôme, absente du lockfile, seuls subsistaient des dossiers orphelins. Le cas écrit concerne `esbuild`, la seule entrée réelle.
- **Fragilités de test corrigées** : le plancher `>= 5` devient deux gardes auto-actualisées (tout dépôt de workspace produit au moins un package ; toute dépendance en `workspace:` résout vers un package découvert). Prouvé : supprimer `packages/config` du disque rougit, alors que l'ancien plancher restait vert.

**Correction au rapport de revue** : `unrs-resolver` y est qualifié de « dépendance légitime ». C'est faux — c'est un fantôme. La conclusion du finding tenait, pour une raison plus forte que celle avancée.

**Reste ouvert** : la recette CI (le workflow n'a toujours jamais tourné), le trou a11y (s08), la pureté du `domain` (s03).

Max severity: major
Ship allowed: yes
