# Revue — s03-module-registry

Contexte : `dev`, commit `bcb4a03` (60 fichiers), plus `b38c375` (correction documentaire). Revue en contexte frais. Toutes les commandes ont été exécutées par le relecteur.

## Ce qui a été exécuté

| Commande | Résultat |
|---|---|
| `pnpm test` | 160 tests / 10 fichiers, verts |
| `pnpm typecheck` | vert (racine + 6 packages) |
| `pnpm lint` | vert, `--max-warnings=0` |
| `pnpm test:e2e` | 2 tests Playwright verts |
| `pnpm build` | manifeste : `┌ ○ / ├ ○ /_not-found ├ ƒ /api/health └ ƒ /api/modules/[...path]` |
| `pnpm run audit` | vert |
| Suite « module activé » | 160/160 |
| Suite `enabledModules = []` | 160/160, typecheck + lint + build verts |

Vérification HTTP sur le **build de production** servi par `next start` :

```
GET /api/modules/demo-enabled/items        200  {"items":[]}
GET /api/modules/demo-disabled/notes       404  {"error":"not_found"}
POST /api/modules/demo-enabled/items       401  {"error":"unauthorized"}
GET /api/modules/demo-enabled/admin/report 401  {"error":"unauthorized"}
GET /   <nav aria-label="Modules"><ul><li><a href="/demo-enabled/items">…</a></li></ul></nav>
```

En état `enabledModules = []`, après reconstruction forcée : `<nav aria-label="Modules"><ul></ul></nav>`.

## Preuves par neutralisation

| Mutation | Fichier | Tests rouges |
|---|---|---|
| `checkAllOrigins: true` → `false` | `tooling/eslint/boundaries.ts` | **2** |
| `AvailableModuleId` élargi à `string` | `config/features.ts` | **2** + `typecheck` rouge |
| Garde de protection de route neutralisée | `packages/core/src/registry.ts` | **2** |
| `resolveEnabledModules` renvoie tout l'annuaire | `packages/core/src/validate.ts` | **7** |
| `retention` indexée par `string` | `packages/core/src/module.ts` | **2** |
| `assertDeclarationsAreComplete` court-circuitée | `packages/core/src/registry.ts` | **3** |
| Retrait de `NoInfer` | `packages/core/src/module.ts` | **0** — conforme au commentaire |
| Identifiant inconnu dans `enabledModules` | `config/features.ts` | `TS2322: Type '"billng"' is not assignable to type '"demo-disabled" \| "demo-enabled"'` |

Pureté du `domain` **sur le chemin de module réel** : `drizzle-orm/pg-core`, `node:fs`, `stripe`, `@sentry/node`, `react` refusés ; `zod` passe. Les paquets non installés sont refusés aussi : la règle ne dépend pas de la résolution effective.

## Vérification des API contre les paquets installés

- **`checkAllOrigins` confirmé** dans `dist/Rules/Dependencies.js` : la garde est littéralement `(checkAllOrigins || isLocalDependency)`, défaut `false`. **La claim est exacte** — sans cette option, aucune dépendance `external` ni `core` n'était examinée : la règle de s02 ne voyait que les imports locaux.
- `to: { module: { origin, source, internalPath } }` confirmé (`ModuleSingleSelector`).
- **Nuance sur la seconde claim** : un sélecteur `dependency` **existe** (`DependencyInfoSingleSelector`, champ `source`). Il porte sur le spécificateur brut plutôt que sur la base du module. Le choix retenu est le bon ; la formulation « il n'existe pas » est fausse. `docs/architecture.md` corrigé par `b38c375` ne dit pas cela et reste exact.
- `defineModule`, `buildRegistry`, `dispatchModuleRequest`, `purgeModules`, `exportModules`, `ModuleIdOf` : tous exportés, signatures conformes. **Aucun import ni appel inventé dans le diff.**

## 1. Le contrat est-il complet ?

Les treize clés de l'ADR 007 sont présentes, **toutes obligatoires, aucune optionnelle** : `id`, `requires`, `schema`, `migrations`, `routes` + protection, `navigation` + protection, `messages`, `emails` + locales, `webhooks`, `purge`, `export`, `retention`, `dataCategories`. Les deux modules de démonstration les remplissent toutes, y compris vides. **Aucune clé ne manque.**

## 2. Erreur de compilation, pas de démarrage

Prouvé par mutation. La garde ne peut pas pourrir : `tests/fixtures/typing/valid-module.ts` porte `IsExactlyString<AvailableModuleId> = false`. Élargir le type fait rougir **deux** tests, dont le témoin — la disparition de la contrainte est détectée, pas seulement sa présence. C'est le point le plus difficile de la story, il est tenu.

## 3. Aucune route exposée

Le manifeste ne contient qu'un point dynamique, `/api/modules/[...path]` — aucun fichier de route par module. L'URL de `demo-disabled` renvoie 404 sans que son gestionnaire s'exécute. Plus fort qu'un `notFound()`, comme exigé.

## 4. Jugement des déviations

- **`dataCategories`** — approuvé sans réserve : sans liste déclarée, « une catégorie sans politique » n'a pas de référent.
- **`protection` sur la navigation** — approuvé dans le contrat, mais l'exécution manque (F2).
- **Code du module désactivé dans le bundle serveur** — acceptable. Vérifié : présent dans `.next/server/chunks/`, **absent de `.next/static/`** (aucune fuite côté client). Les critères de la story portent sur routes, navigation, traductions, purge/export ; ceux de s26 sur routes joignables, navigation orpheline, tables réelles. Aucun n'est menacé. Et l'annuaire est ce qui rend possible la garantie compilateur. **À consigner en ADR.**
- **`/api/modules/[...path]`** — correct, `app/api/[[...route]]` est réservé à Hono (ADR 005).
- **`NoInfer` conservé** — mesure confirmée. Une ceinture non prouvée mais **déclarée comme telle** vaut mieux qu'une ceinture présentée comme une garantie.
- **401/403 au niveau route** — **d'accord avec l'implémenteur.** Le §3 vise la fuite d'existence d'une **ressource** d'un autre locataire. Une route de module activé existe pour tout le déploiement. Réserve pour s37 : sur une surface superadmin, un 403 divulguera l'existence du back-office ; le contrat devra alors exprimer « refuser en 404 ».
- **Pas de Zod sur `config/features.ts`** — d'accord. Un littéral compilé n'est pas une entrée externe, Zod ne peut valider ni `purge`, ni `export`, ni les gestionnaires ; le compilateur est strictement plus fort, je l'ai vu échouer.

## Findings

### F1 — major — `pnpm build` peut servir un bundle avec le mauvais jeu de modules

`config/features.ts` vit à la racine et est importé par `apps/web`. La tâche `build` de `turbo.json` ne déclare aucun `inputs`, et `globalDependencies` ne liste que `.env`. Les entrées par défaut de Turbo sont les fichiers **du package** : `config/features.ts` n'en fait pas partie.

Reproduit : avec `enabledModules = []`, `pnpm build` renvoie `>>> FULL TURBO`, et la page pré-rendue restituée du cache contient encore `Éléments de démonstration`. Après `--force`, elle rend `<ul></ul>`.

Le code est correct ; **la clé de cache est fausse.** Le geste central du produit — éditer la configuration, rebuild, déployer — peut expédier l'état précédent, silencieusement. Aucun test ne l'attrape, et s05 va industrialiser ce geste.

### F2 — major — `NavigationEntry.protection` est déclarée, justifiée par le §3, et lue par personne

Le champ n'est lu qu'en `registry.ts:182` et `:187`, sur `route.protection` uniquement. Aucun consommateur pour la navigation, aucun test, aucune fonction de filtrage ; `app/navigation.tsx` rend tout.

La justification écrite dans le contrat est pourtant explicite : afficher l'entrée d'un écran auquel on n'a pas accès divulgue son existence. Aucune entrée non publique n'existe aujourd'hui, donc rien n'est cassé — mais le champ part dans le contrat que quarante-deux stories rempliront en croyant qu'il fait quelque chose. C'est le mode d'échec que l'ADR 013 nomme : « quelle commande échoue si on la viole ? ». Ici, aucune.

### F3 — major — la documentation destinée aux agents diverge du contrat livré (ADR 013)

1. `packages/core/AGENTS.md:15` attribue la validation à **`validateModuleConfiguration`** — cette fonction n'existe nulle part (une seule occurrence : celle-ci). Les fonctions réelles sont `resolveEnabledModules` et `assertDeclarationsAreComplete`.
2. `AGENTS.md` racine énumère le contrat **sans `dataCategories` ni la protection des routes**.
3. `docs/architecture.md` ne mentionne pas `dataCategories` et marque encore `routes?`, `navigation?`, `emails?`, `webhooks?` optionnels — contredit par l'implémentation.

L'ADR 013 exige que la documentation des agents soit maintenue au même commit que le code. La story qui **pose** le contrat est précisément celle où ces fichiers ne doivent pas mentir.

### F4 — minor — `routes: readonly ModuleRoute[]` est une forme provisoire non consignée

`docs/architecture.md` déclare `routes?: HonoRouter`. Le livrable est un tableau de descripteurs maison, avec un commentaire honnête. L'interdit du plan justifie le choix. Mais le type changera quand Hono arrivera, et `ModuleRoute` ne sait pas exprimer de segment dynamique — ce que le premier module réel exigera.

### F5 — minor — clés candidates absentes pour des besoins déjà écrits

- **s33** : « module non activé, les tâches planifiées ne s'exécutent pas ». Une tâche planifiée pose le même problème d'agrégation que `webhooks` ; sans clé `jobs`, l'enregistrement se fera à l'import — ce que le registre évite pour les routes. s33 arrive après une trentaine de modules.
- **s17** : `RouteProtection` porte un `role: string` libre, sans registre de rôles.
- `requires` est typée `readonly string[]` alors que l'architecture annonce `ModuleId[]` : une faute de frappe n'est attrapée qu'à la construction, pas à la compilation. Asymétrie avec `enabledModules` à assumer par écrit.

### F6 — minor — la complétude des locales se mesure sur le module, pas sur l'application

Un module qui ne livre que `fr` passe les deux contrôles même si l'application sert `fr` et `en`. Le critère dit « chacune des locales livrées » : l'interprétation retenue est la plus faible. s09 devra introduire l'ensemble de locales de l'application.

### F7 — minor — le test d'égalité des identifiants confond ensemble et ordre

`moduleIds` vient du **graphe**, pas de l'ordre de déclaration. Le jour où la configuration listera un module avant son requis — parfaitement légitime — ce test rougira sans régression.

### F8 — minor — l'entrée de navigation de démonstration pointe sur une page inexistante

`GET /demo-enabled/items` → 404 de Next, et le lien est rendu dans le `layout.tsx`, donc sur **toutes** les pages. Sur un module qui sert de gabarit au générateur (s41) et à tout agent écrivant son premier module, cela enseigne qu'un `href` n'a besoin de correspondre à rien.

### F9 — minor — `vitest` déclaré sans usage dans `packages/core`.

### F10 — minor — 404 sur méthode non appariée, là où 405 serait juste. Défendable (ne pas divulguer les méthodes acceptées), mais écrit nulle part, et chaque module en héritera.

## État des critères

Les dix critères sont **prouvés**, dont la lecture faible pour les locales (F6). Tâche 12 satisfaite et prouvée au-delà du plan — sur le chemin de module réel, pas seulement sur les fixtures. Tous les interdits respectés : aucune anticipation de s04, aucune écriture dans `config/features.ts`, aucune commande de nettoyage, ni Hono ni oRPC, aucun module applicatif réel.

## Ce que je n'ai pas pu vérifier

- **L'ordre TDD** — commit unique, rien ne distingue un test écrit avant d'un test écrit après.
- **Le rendu en navigateur** — HTML asserté par `curl`, aucune page ouverte. Le `<nav>` n'a jamais été vu, ni au clavier ni au lecteur d'écran, et `jsx-a11y` reste absent depuis s02. **Geste humain** : ouvrir `/`, tabuler jusqu'au lien, constater F8.
- **La CI** — jamais exécutée.
- **Le comportement en base** — repositories en mémoire, tables déclarées dans aucune base. C'est s04.
- **La locale `en`** — `DEFAULT_LOCALE = 'fr'` figé, le catalogue `en` n'est exercé par aucun chemin.
- **Les parcours e2e des modules** — ma preuve HTTP est manuelle et **ne vit pas dans la CI**. **Geste humain** : ajouter `e2e/modules.spec.ts`, sinon la preuve la plus forte de la story n'existe que dans cette revue.
- **Le geste de bascule complet** — **geste humain** : éditer `config/features.ts`, `pnpm build` sans `--force`, constater F1 avant qu'il ne se manifeste en déploiement.

## Verdict

La story tient son point dur. La contrainte est portée par le compilateur et je l'ai vue échouer ; la garde qui la protège de l'érosion mord ; le module non activé n'expose réellement rien, vérifié sur le manifeste **et** en HTTP ; la pureté du `domain` était inerte après s02 et ne l'est plus, pour la raison exacte identifiée dans le code du plugin installé. Les déviations sont défendables, et celles qui ne rapportent rien sont déclarées comme telles au lieu d'être vendues.

Restent trois majors, tous cernés et corrigeables sans toucher au contrat : un cache de build qui peut expédier le mauvais jeu de modules, un champ de sécurité que personne ne lit, et trois fichiers de règles pour agents qui ne décrivent plus le code livré — dans la story dont ces fichiers sont le produit principal.

---

## Addendum — tour de correctifs `a3b2db2`

> Ajouté par l'orchestrateur. Les trois majors sont fermés ; suite portée de 160 à **168 tests**, verts dans les deux états, plus 6 parcours end-to-end.

- **F1 fermé.** `globalDependencies: ['.env', 'config/**']` — global plutôt qu'un `inputs` par tâche, parce que `typecheck` et `build` dépendent tous deux de la configuration des modules. Prouvé par le geste exact du reviewer, sans `--force` : `FULL TURBO`, puis édition de `config/features.ts`, puis **cache miss** et artefact rendant `<ul></ul>`, puis restauration et `FULL TURBO` de nouveau. Le test interroge Turborepo lui-même (`turbo run build --dry=json`) pour savoir si `config/features.ts` fait partie des entrées hachées : une déclaration présente mais qui raterait le fichier échoue quand même.
- **F2 fermé par l'implémentation, pas par l'épinglage.** `satisfiesProtection` est écrite une fois et sert à la fois `visibleNavigation` et `dispatchModuleRequest` — la seule différence est le transport (401 appelant inconnu, 403 connu mais insuffisant). `demo-enabled` porte désormais une entrée `role: 'admin'`, donc le champ mord dans le dépôt livré. Le témoin côté appelant vit dans le fichier end-to-end, parce que le `<nav>` n'est rendu que par Playwright.
- **F3.1 fermé, et deux dérives supplémentaires trouvées en relisant** : « les deux contraintes portées par le compilateur » alors qu'il y en a trois, et une référence à `composeSchema` depuis `packages/core` — fonction qui appartient à `@repo/db`.
- **F5 : la clé `jobs` entre au contrat**, avec un gestionnaire `run` en plus de `id` et `schedule` — l'argument du finding vaut aussi pour `run` : une tâche planifiée sans appelable est indécidable pour le runner de s33. Les deux modules de démonstration la déclarent vide. `requires` reste `readonly string[]` : la typer depuis l'annuaire fermerait un cycle module → `config/features.ts` → module, et l'asymétrie est désormais écrite à trois endroits.
- **F7, F8, F9, F10 fermés.** Le lien de navigation pointe sur la route montée ; **aucune page Next n'a été ajoutée** — une page sous `apps/web` pour un module survivrait à sa désactivation, ce que la story nie.
- **`e2e/modules.spec.ts` livré** : les quatre vérifications HTTP que la revue avait faites à la main vivent désormais dans la CI. Elles dérivent leurs attentes du registre, donc passent dans les deux états.

Sept mutations, toutes rouges, dont une qui prouve que le test end-to-end du 404 n'est pas vacant (activer tous les modules le fait rougir).

**Reste ouvert, par renvoi de la revue** : F4 (Hono), F6 (ensemble de locales de l'application, s09), le `role: string` libre de s17. Et un point déclaré : `packages/core/AGENTS.md` est corrigé mais **non épinglé** par un test — tout mécanisme envisagé revenait à de la couverture par sous-chaîne de documentation, que la discipline de test du dépôt interdit.

Max severity: major
Ship allowed: yes
