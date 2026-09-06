# Research — Story s58-donnees-de-demonstration

> Vérifiée contre la branche par défaut au commit `e91b75c`, en lecture seule, plus **une exécution mesurée** de `pnpm db:seed` sur une base vierge dédiée.

## Les six faits structurants

1. **La commande est un non-opérant qui fonctionne.** Sur une base fraîchement migrée, `pnpm db:seed` imprime « Aucun seed à exécuter : aucun module ne déclare de données de départ » et **sort 0**. Mesuré ensuite : les **29 tables** du schéma `public` sont **toutes à zéro ligne**. La story ne part donc pas d'une commande cassée mais d'une commande vide — ce qui est pire, parce que rien ne le signale.

2. **Le contrat de seed est minuscule, et sa promesse n'est pas tenue par le compilateur.** `Seeder` a **deux champs** : `id` et `run`. Pas de module, pas d'ordre, pas de dépendance, pas d'aide à l'idempotence. La rejouabilité est une **obligation de commentaire** — « identifiants déterministes et écritures tolérantes au conflit » — que ni le type ni l'exécution ne vérifient.

3. **Le registre est un littéral vide, écrit à la main.** `export const seeders: readonly Seeder[] = []`, avec le commentaire « vide tant qu'aucun module n'est livré ». **Rien n'y ajoute quoi que ce soit, nulle part** : ce n'est pas une dérivation du registre des modules, c'est une liste que personne n'a remplie.

4. **Trois appelants seulement.** Le point d'entrée `pnpm db:seed`, qui appelle sans argument et retombe donc sur le tableau vide ; et deux lignes de `tests/migrations.test.ts`, qui **injectent leur propre seeder** par l'option `seeders` pour éprouver l'idempotence. Le test de rejouabilité existe donc **et ne teste rien de livré**.

5. **Aucun module ne déclare de données de départ, et le contrat n'a pas de clé pour ça.** Balayage des 19 répertoires de `packages/modules/*` : **zéro occurrence** de `seed` ou `Seeder`. `ModuleDefinition` porte quinze clés, aucune n'est un seed. Et le commentaire de `publicUrls` — la quinzième, ajoutée par `s53` — rappelle qu'ajouter une clé **rouvre tous les modules déjà écrits**.

6. **Ce sur quoi un seed peut être bâti existe déjà.** Chaque module exporte ses tables Drizzle et sa couche applicative depuis son baril : `demoItems`, `onboardingProgress`, `notification`, `adminPlatformRole`, `contactMessage`, les dépôts d'organisations et de facturation. Rien n'est exporté **en tant que** données de départ, et rien ne permet à `runSeeders` de les découvrir.

## Points d'ancrage

- `packages/db/src/seed.ts` — 35 lignes, tout le contrat.
- `packages/db/src/scripts/seed.ts:11` — le point d'entrée, et son repli sur le tableau vide.
- `tests/migrations.test.ts:256-257` — l'épreuve d'idempotence, sur un seeder injecté.
- `packages/core/src/module.ts:447-510` — les quinze clés, et l'avertissement sur la seizième.
- `docs/decisions/066` et `067` — le précédent d'une clé **optionnelle** ajoutée sans rouvrir les modules existants.

## Pièges & contraintes

- **La seizième clé obligatoire est le piège évident.** `NavigationEntry.surface` a établi le contre-exemple : une clé **optionnelle** n'oblige personne, et les modules qui n'en veulent pas ne bougent pas. C'est la forme à reprendre.
- **Le critère « refuse sur une base en service » ne peut pas s'appuyer sur `NODE_ENV`** : le socle refuse explicitement d'en déduire un comportement (« un mode local explicite, jamais déduit de `NODE_ENV` »). La garde doit se dériver d'un **fait de la base**.
- **La rejouabilité doit être mesurée, pas promise.** Le commentaire actuel demande des identifiants déterministes ; c'est exactement le genre d'obligation que le dépôt a appris à ne pas croire. Deux exécutions, un comptage.
- **Un module coupé ne doit pas semer.** Par la valeur, dérivé du registre — jamais par un nom écrit.
- **Le plancher manquant est la cause du défaut.** Une commande qui ne crée rien sort 0 aujourd'hui. Tant qu'un plancher n'existe pas, le prochain module qui oublie son seed ne le saura pas non plus.

## Questions ouvertes

- **Quel fait rend une base « en service » ?** Un compte que le seed n'a pas créé est le candidat évident ; reste à décider si l'on compare des identifiants, une marque, ou l'absence totale de comptes.
- **Combien de données ?** Assez pour que chaque écran montre quelque chose, pas assez pour cacher un défaut de pagination. Le back-office et la facturation sont les deux écrans qui souffrent le plus du vide.
- **Les seeds sont-ils dans les modules ou à côté ?** Dans le module, ils vieillissent avec son schéma ; à côté, ils cassent en silence.

## Complexité réelle

Notée **2** dans `docs/stories.md`. **Ma note : 3.** Écrire des lignes plausibles est trivial ; ce qui coûte, c'est la **clé optionnelle** dans un contrat que le dépôt protège, la **garde de non-écrasement** qui doit se dériver d'un fait, et le **plancher** qui rend la commande capable d'échouer — trois mécanismes, chacun avec sa mutation.
