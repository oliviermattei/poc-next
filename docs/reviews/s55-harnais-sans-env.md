# Revue — s55-harnais-sans-env

Story née de P29, dont le coût d'inaction est **mesuré** : trois rouges de CI en trois stories consécutives, toujours la même cause. La question de la revue n'était donc pas « la commande fonctionne-t-elle » mais **« aurait-elle attrapé les trois cas, et survivra-t-elle au fait d'être agaçante »**.

## Suites exécutées par le relecteur

| Commande | Résultat |
|---|---|
| `pnpm lint` · `pnpm typecheck` | exit 0 · exit 0 |
| `pnpm test` | **2507 passés / 11 sautés**, 84 fichiers, 31,9 s |
| `pnpm test:sans-env` | **identique**, fichier pour fichier et cas pour cas, 87 fichiers balayés en 32 s |

## La mutation qui décide de la valeur de la story

Retirer les deux lignes de déclaration d'environnement de `tests/notifications.test.ts` :

- `pnpm exec vitest run tests/notifications.test.ts` → **34 passés, vert**
- `pnpm test:sans-env` → **exit 1**, un fichier rouge, et la ligne de rapport :

```
  tests/notifications.test.ts → AUTH_SECRET, APP_URL
```

L'asymétrie est exactement celle qu'il fallait : la commande mesure ce que la suite ne mesure pas.

## La dérivation, vérifiée comme telle

Aucun nom de variable n'est écrit dans le code — balayage sur les quatre fichiers non-test, tous les résultats sont dans des commentaires. Le job `quality` est le seul dont une étape `run:` corresponde à `pnpm test`, et son bloc `env:` porte exactement `DATABASE_URL`, `EMAIL_LOCAL_CAPTURE`, `PAYMENTS_LOCAL_MODE`.

**La mutation A mérite d'être détaillée** : élargir la reconnaissance à `/\bpnpm test/` — donc confondre `pnpm test:e2e` — rougit **2 cas**, dont celui qui lit le `ci.yml` réel du dépôt et y voit alors trois jobs. Le garde mord sur le fichier réel, pas seulement sur un jeu d'essai.

## Le piège P8, pris au sérieux

Une commande qui reproduirait l'absence **totale** rougirait sur des fichiers corrects et finirait désarmée. L'implémenteur a **mesuré trois mécanismes** avant d'en choisir un :

- répertoire courant déplacé dans une forêt de liens, racine Vitest sur la forêt → **26 cas rouges** sur des fichiers corrects ;
- même mécanisme, racine sur le dépôt → **2 rouges**, toujours sur des fichiers corrects ;
- lecture du `.env` rendue absente par un préambule → **mêmes 2507 / 11** que la suite ordinaire.

Le retenu ne produit aucun faux rouge, vérifié.

## Le constat majeur : deux planchers construits, le troisième oublié

**M1.** Le régime reposait entièrement sur une ligne — `setupFiles` — et rien ne vérifiait qu'elle était en vigueur. Le relecteur l'a neutralisée en laissant le défaut cible en place : `tests/notifications.test.ts` **passe** et n'apparaît pas au rapport. Le régime était désarmé pour le défaut exact que la story existe pour attraper.

La commande sortait tout de même en erreur — mais pour une raison **propre à ce poste** : le `.env` redevenu lisible, ses clés Stripe entrent en conflit avec `PAYMENTS_LOCAL_MODE=1` et rougissent quatre autres fichiers. **Sur une machine sans clés Stripe, la commande aurait annoncé « 87 fichiers balayés » en ne reproduisant rien.**

Le plan avait construit deux planchers contre exactement cette issue — ensemble vide, balayage vide — en citant `s26`, `s48` et `s51`. Le troisième, et le plus central, n'existait pas.

**Fermé par un canari à deux directions** :

| Direction | Résultat |
|---|---|
| préambule neutralisé (`test: {}`) | **15 rouges** — les 14 incidents du poste **plus le canari**, dont le rouge est indépendant de la machine |
| titre du canari modifié, suite entièrement verte | la commande sort **1** : « le cas canari n'a pas tourné : rien ne prouve alors que le préambule ait été en vigueur » |

Le plancher unitaire a été écrit d'abord et vu rouge (2 cas) avant l'implémentation.

## Deux affirmations fausses, corrigées

**Le compte a vieilli à l'intérieur du commit qui l'introduisait.** Les docstrings annonçaient « 2491 cas, exactement comme la suite ordinaire » ; mesuré : **2507**, soit 2491 plus les 16 cas du fichier de test de la story. Le nombre est **retiré**, pas réécrit — la propriété est énoncée, et la commande journalise son propre compte à chaque exécution.

**Et la phrase d'`AGENTS.md` restait fausse après correction.** « Chacune de ces commandes est exécutée par la CI » était faux pour sept ; réécrite en « sauf celles dont la ligne dit le contraire », elle restait fausse pour **cinq** — `pnpm clean`, `pnpm dev`, `pnpm lint:fix`, `pnpm billing:reconcile`, `pnpm db:seed`, dont aucune ligne ne le dit. Elle énonce désormais où se lit ce que la CI joue, sans affirmer de liste.

## Une seconde arête du mécanisme, nommée

Le masquage patche `module.exports` de `node:fs`, soit la vue **CommonJS** — le chemin de `dotenv`, celui de P25bis, et le seul lecteur de `.env` de la suite aujourd'hui. Un import ESM nommé lirait un espace de noms figé et ne verrait pas le retrait. Rien n'est faux ; le paragraphe « ce qu'elle ne mesure pas » ne nommait que les sous-processus. C'est aussi pourquoi le canari lit par `createRequire`.

## L'absence de la CI, jugée correcte

Le relecteur a lu `ci.yml` de bout en bout : **aucune étape ne pose de `.env`**. La CI *est* ce régime, et y ajouter la commande rejouerait une suite de 32 s deux fois par branche de matrice pour mesurer ce que l'étape voisine mesure déjà. `scripts/socle-rules.ts` n'est pas forcé à une décision de disposition, aucune étape `run:` n'ayant été ajoutée.

## Non vérifié

**La branche socle de la matrice** n'a pas été jouée — les deux régimes n'ont tourné que dans la configuration livrée. Le risque est jugé faible (le régime agit sur l'environnement remis à Vitest, identique dans les deux configurations), mais « un garde qui ne mord que dans une configuration » est un mode d'échec nommé ici.

**Les mesures des deux mécanismes rejetés** (26 puis 2 rouges) sont consignées en prose, historiques, non rejouables par une commande — une affirmation à l'air mesuré que personne ne peut vérifier, acceptable comme justification d'une option rejetée.

**La portabilité entre postes** : les valeurs viennent du `.env` local quand il existe, donc le régime n'est pas identique d'une machine à l'autre — M1 l'a montré. Un passage sur une machine dont le `.env` est une copie fraîche de `.env.example` reste à faire.

Max severity: major
Ship allowed: yes
