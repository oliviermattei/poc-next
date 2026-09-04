# Research — Story s48-ci-verte

## Les cinq faits structurants

1. **`extra` n'a qu'un seul candidat dans tout le dépôt : `marketing`** — prédicat évalué à l'exécution sur l'annuaire réel (`tests/minimal-profile.test.ts:307-318`). Les dix autres modules échouent chacun sur un critère nommé. La branche `socle` de la CI coupe précisément `marketing` (`.github/workflows/ci.yml:101`), donc `extra` y est `undefined` et l'assertion tombe.
2. **Le test a été écrit pour ne pas nommer un module, et le nomme en fait.** Son commentaire (`:303-306`) dit « écrire son nom ici rendrait ce test faux au module suivant, ce qui est exactement le défaut qu'il existe pour attraper » — mais un prédicat satisfait par un seul module est un nom déguisé.
3. **Les deux « profils minimaux » du dépôt ne coupent pas les mêmes modules.** `minimalProfile.cut = ['organizations', 'billing', 'i18n']` (`config/profiles.ts:43`) ; la CI socle coupe `marketing`, `organizations`, `i18n`. `billing` et `marketing` sont échangés. Le test mêle les deux : il filtre sur `minimalProfile.cut` tout en tournant sous la configuration de la CI.
4. **La prémisse de la story sur l'audit est à moitié fausse.** `scripts/audit.ts:41-46` **distingue déjà** une panne de registre d'une absence de vulnérabilité, avec le raisonnement écrit sur place. Ce qui manque est **uniquement la reprise** : un `ERR_SOCKET_TIMEOUT` rougit la porte du premier coup.
5. **Aucune commande locale ne joue la configuration socle.** `pnpm test:minimal-profile` lance `scripts/minimal-profile.ts`, la recette de s26 sur un **clone** ; ce n'est pas ce que la CI socle exécute (`pnpm ks toggle` ×3 puis `pnpm typecheck`/`lint`/`test`/`build` **en place**). La moitié rouge de la matrice n'est donc reproductible qu'en CI.

## Target story

`s48-ci-verte` — rendre la CI verte sur la branche par défaut, sans retirer ni désarmer aucun contrôle.

Critères d'acceptation : `pnpm test` passe sous les deux configurations, avec une commande locale documentée pour le socle · l'assertion du critère 8 tient ou déclare pourquoi elle ne peut pas, la déclaration étant elle-même vérifiée (pas de saut silencieux) · `pnpm run audit` reprend sur un échec réseau et échoue nommément sur un avis · la CI de la branche par défaut est verte sur un run réel, lue **par événement** · aucun contrôle retiré, désactivé ou rendu non bloquant.

## État actuel du code

**`tests/minimal-profile.test.ts:307-318`** — `extra` est le premier module de l'annuaire qui satisfait cinq critères : activé, hors socle, hors `minimalProfile.cut`, requis par personne, et déclarant **à la fois** ≥1 route, ≥1 entrée de navigation et ≥1 table.

Prédicat évalué sur l'annuaire réel, les deux configurations :

| module | actif (tous / socle) | hors socle | hors profil | non requis | routes | nav | tables |
|---|---|---|---|---|---|---|---|
| auth | 1 / 1 | **0** | 1 | **0** | 32 | 2 | 6 |
| billing | 1 / 1 | 1 | **0** | 1 | 4 | 2 | 7 |
| consent | 1 / 1 | 1 | 1 | 1 | 1 | **0** | **0** |
| i18n | 1 / **0** | 1 | **0** | 1 | **0** | **0** | **0** |
| **marketing** | **1 / 0** | 1 | 1 | 1 | 2 | 1 | 3 |
| mcp-server | 1 / 1 | 1 | 1 | 1 | **0** | **0** | **0** |
| organizations | 1 / **0** | 1 | **0** | 1 | 9 | 1 | 4 |
| rate-limit | 1 / 1 | **0** | 1 | 1 | **0** | **0** | 1 |
| storage | 1 / 1 | 1 | 1 | 1 | 5 | **0** | 1 |
| demo-enabled | 1 / 1 | 1 | 1 | **0** | 4 | 3 | 1 |
| demo-disabled | **0 / 0** | 1 | 1 | 1 | 1 | 1 | 1 |

Sous « tous » : **un** candidat, `marketing`. Sous « socle » : **aucun**.

`storage` n'échoue que sur `nav = 0` : une entrée de navigation de plus et le dépôt aurait deux candidats. C'est le levier le moins coûteux si l'on veut que le prédicat cesse d'être mono-candidat — mais ajouter une entrée de navigation à `storage` pour faire passer un test serait écrire le produit pour la mesure, et doit être décidé comme une question de produit, pas de harnais.

**`scripts/audit.ts`** — 109 lignes. `runPnpmAudit` (`:31-46`) lance `pnpm audit --json` par `spawnSync`, sans reprise, sans délai d'attente explicite. `readAuditRun` lit le code de sortie **et** la forme du document ensemble, avec le commentaire qui dit pourquoi : « `pnpm audit` sort en échec aussi bien quand il trouve un avis (nominal) que quand il n'a pas pu auditer (`{"error":{…}}`). Les confondre revenait à traiter une panne de registre comme une absence de vulnérabilité. » La distinction demandée par la story **existe déjà**.

**`.github/workflows/ci.yml:96-101`** — la configuration socle est produite en place par `pnpm ks toggle marketing && pnpm ks toggle organizations && pnpm ks toggle i18n`, puis l'arbre est photographié (`:107-108`) et comparé après coup, pour qu'aucune commande ne modifie un fichier versionné au-delà de la configuration demandée.

## Points d'ancrage

- `tests/minimal-profile.test.ts:307` — la définition d'`extra`, et `:356-357` l'assertion qui tombe.
- `config/profiles.ts:43` — `minimalProfile.cut`, le filtre que le test applique.
- `.github/workflows/ci.yml:99-101` — la seule définition de la configuration « socle », aujourd'hui inatteignable localement.
- `scripts/audit.ts:31-46` — le point où une reprise se pose.
- `package.json:14,17,21` — `test`, `test:minimal-profile`, `audit` : c'est là qu'une commande socle locale se déclarerait.

## APIs / fonctions vérifiées

- `availableModules`, `enabledModules`, `requiredModules` — `config/features.ts:34,68,79`. `enabledModules` porte dix identifiants ; `demo-disabled` est le seul de l'annuaire qui n'y figure pas.
- `minimalProfile` — `config/profiles.ts:41-44`, `{ id: 'minimal', cut: ['organizations','billing','i18n'] }`.
- `moduleTableNames` — utilisé par le test pour compter les tables ; rend le nom Drizzle de chaque table déclarée par le module.
- `readAuditRun`, `selectBlockingAdvisories`, `parseAuditExceptions` — `scripts/audit.ts` les importe ; la logique de tri des avis est déjà couverte.

## Pièges & contraintes

- **Le saut silencieux est explicitement refusé** par le critère d'acceptation, et c'est le bon réflexe : `it.skipIf(!extra)` rendrait la moitié socle verte sans rien vérifier — le mode d'échec que `AGENTS.md` nomme (« a green mutation means the test is wrong »).
- **Ne pas retirer le contrôle.** P8 du doc d'auto-optimisation documente que ce dépôt a déjà subi ça : un scan de secrets rouge sur chaque demande de fusion pendant trois stories, invisible parce qu'un job homonyme était vert.
- **L'arbre est photographié en CI** (`ci.yml:107-108`) : toute commande socle locale qu'on introduirait doit soit travailler dans une copie, soit restaurer, sinon elle fera échouer cette comparaison.
- **Une reprise sur l'audit ne doit pas masquer un avis.** La distinction existante est ce qui rend la reprise sûre : ne reprendre que sur `AuditRunError`/panne de registre, **jamais** sur un document d'avis valide.
- **`tests/billing.test.ts:5627`** est intermittent (1 rouge sur 15 passages, delta global sur `auth_session`) et vit dans la suite de s19. Il rougira parfois pendant cette story sans lui appartenir — ne pas se l'attribuer, ne pas le corriger ici sans décision explicite.
- **Le conteneur PostgreSQL de s28 tient encore le port 5438** avec son volume, alors que son worktree a été supprimé à la fusion. Sept volumes orphelins de stories fusionnées, ~398 Mo. Hors périmètre de cette story, mais c'est la même famille que P7.

## Questions ouvertes

- **Que doit affirmer le critère 8 sous une configuration sans candidat ?** Deux familles de réponses, à trancher au plan : (a) le test vérifie que **chaque** module échoue sur au moins un critère nommé, et dérive donc l'absence de candidat au lieu de la subir — l'absence devient une propriété vérifiée, pas un saut ; (b) le prédicat est relâché pour cesser d'être mono-candidat. (b) déplace le problème si le dépôt reste à un seul module qualifiant.
- **La configuration socle locale doit-elle travailler en place ou dans une copie ?** En place, c'est la fidélité à la CI mais un arbre modifié à restaurer ; dans une copie, c'est le motif déjà éprouvé de `scripts/minimal-profile.ts` mais ce n'est plus tout à fait ce que la CI joue.
- **Combien de reprises, et avec quelle attente ?** Non tranché : `docs/reliability.md` impose « exponentielle avec gigue et plafond », mais le budget d'un job de CI n'est pas écrit.
- **Le `pnpm audit` interne connaît-il un délai d'attente configurable ?** Non vérifié — `spawnSync` n'en pose aucun aujourd'hui, et un `ERR_SOCKET_TIMEOUT` a mis ~4 minutes à tomber en CI.

## Complexité réelle

La story est notée **2** dans `docs/stories.md` — note donnée avant d'avoir ouvert un fichier, et sur une prémisse à moitié fausse (l'audit distingue déjà, il ne reprend pas).

**Ma note : 3.** Trois raisons. Le correctif du critère 8 n'est pas mécanique : il demande de décider ce qu'une recette doit affirmer quand sa précondition est vide, et de le rendre vérifiable — c'est la partie qui peut produire un test plus vert que son nom. La commande socle locale n'existe pas et doit cohabiter avec la photographie d'arbre de la CI. La reprise de l'audit touche une porte de sécurité : elle doit reprendre sur la panne sans jamais reprendre sur un avis.

Pas de proposition de découpe : les trois volets partagent un seul critère de fin — un run de CI vert sur la branche par défaut — et les séparer ferait trois stories dont aucune ne le closerait.
