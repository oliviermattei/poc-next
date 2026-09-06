# packages/adapters/sentry — règles locales

**L'unique implémentation livrée du port `Monitoring`** (ADR 008, contrainte du
PRD : « Sentry comme seule implémentation »). Le gabarit est
`packages/adapters/resend` ; ce qui s'en répète n'est pas redémontré.

## Ce que ce package fait autrement, et pourquoi

| Choix | Ce qui le motive |
|---|---|
| **Pas de SDK**, une enveloppe postée sur le point d'ingestion documenté (`POST <hôte>/api/<projet>/envelope/`) | `@sentry/nextjs` s'installe par **instrumentation globale** : il enveloppe la configuration de Next, remplace le chargeur de modules, pose des crochets sur `fetch` et `console`, et embarque son propre transport avec sa file et ses reprises. C'est-à-dire qu'il décide, à la place du dépôt, du délai d'attente (`docs/reliability.md` §3), de la politique de reprise et de **ce qui est filtré** (`docs/security.md` §5, critère 2 de s39). Une enveloppe est trois lignes JSON documentées : l'écrire est ici le contraire de deviner |
| **Ce qu'on perd, écrit plutôt que passé sous silence** | les instrumentations automatiques du SDK : traces de performance, fil d'Ariane des requêtes, capture des rejets de promesse au niveau du processus. s39 ne les demande pas — elle demande qu'une erreur non gérée *arrive*, avec une trace lisible |
| La trace est **découpée en cadres**, et **inversée** | le fournisseur ne symbolise que des cadres : une trace postée en texte libre arriverait minifiée quelles que soient les cartes source envoyées au build. Et il attend le cadre le plus **ancien** en premier, l'inverse d'une trace JavaScript — une liste dans le mauvais sens s'affiche à l'envers et ne rougit nulle part |
| L'échec **dégrade** | ce port est appelé depuis un gestionnaire d'erreur : lever y remplacerait l'erreur d'origine par la nôtre, et une remontée perdue ne doit jamais faire deux pannes |
| Le **filtrage** est ici, au dernier point avant le réseau (`redact.ts`) | même motif que chez `@repo/adapter-posthog`, et la règle est écrite **une fois par côté de la frontière** : un adaptateur ne dépend d'aucun package du dépôt hormis `@repo/ports`. Les deux charges utiles n'ont d'ailleurs pas la même forme — un contexte et une trace ici, des propriétés scalaires là-bas |
| Le message d'un DSN illisible donne sa **longueur**, jamais sa valeur | une configuration fautive se diagnostique sans que le DSN atterrisse dans un journal |

## Le coût d'une trace hostile, et où il est borné

La trace arrive d'un appelant **anonyme** : `POST /analytics/client-error` est
publique — la story l'a laissée sans session pour attraper les erreurs d'avant
la connexion — et son corps porte jusqu'à 20 000 caractères au choix de
l'appelant. La limitation de débit borne le **nombre** de requêtes, jamais le
coût de l'une d'elles.

CodeQL a signalé `js/polynomial-redos` sur le découpeur de cadres, et la mesure
était pire que l'étiquette : `'at ' + '  '.repeat(2000)` — 4 003 caractères —
coûtait **43,9 s** de processeur sur l'ancienne expression, qui faisait concourir
trois quantificateurs illimités sur les mêmes caractères. Deux gardes, et la
seconde est celle qui compte :

1. le découpage se fait par **balayage de chaînes** (préfixe ancré, puis
   `indexOf` depuis la droite) : aucun quantificateur illimité n'y concourt avec
   un autre ;
2. la trace est **bornée avant d'être lue** — `boundStack`, `MAX_STACK_LINES` et
   `MAX_STACK_LINE_LENGTH` —, et elle l'est **avant le filtrage des secrets**,
   qui la parcourt lui aussi. C'est la garde qui survit au prochain motif écrit
   ici, quelle qu'en soit l'écriture.

**La commande qui échoue quand ce n'est plus vrai** : `pnpm test` — le describe
« une trace hostile ne coûte pas plus qu'une trace normale » de
`sentry-monitoring.test.ts`, dont l'assertion porte sur le **temps** parce que le
défaut *est* le temps, et dont les cas de plafond **dérivent** des deux
constantes.

Ce qui a été balayé à cette occasion, et sur quoi : **sept motifs** appliqués à
du texte d'appelant — les quatre `SECRET_VALUE_PATTERNS` de `redact.ts`, les deux
de `sanitize` (`https?://\S+`, la clé du fournisseur) et le `normalize` des noms
de champs. Un seul fait concourir deux quantificateurs sur la même classe
(`[A-Za-z0-9_-]*(?:session|token|secret)[A-Za-z0-9_-]*=…`) ; son balayage est
borné par jeton — la classe exclut l'espace —, donc il n'est quadratique que sur
un **mot unique** très long, ce que les bornes des appelants interdisent
désormais : 1 000 caractères pour un message (Zod), 500 pour un chemin, 512 par
ligne de trace. Mesuré le 6 septembre 2026 à ces bornes : **0,31 ms** pour un
passage des sept motifs sur le pire mot de 1 000 caractères. Ce n'est pas la
liste de ce qui existe — c'est celle de ce qui a été regardé.

L'autre moitié du critère 1 — les cartes source **envoyées** et **jamais
servies** — n'est pas ici : elle est dans `scripts/source-maps.ts`, appelée par
`pnpm sourcemaps:release` et, pour le seul élagage, par le `Dockerfile`.

## Imports autorisés

- `@repo/ports` pour le port `Monitoring`, sa forme de résultat et celle du
  journal ;
- `@repo/typescript-config` pour la configuration du compilateur ;
- `vitest` dans les fichiers de test.

Aucun SDK, aucune dépendance de fournisseur.

## Ne doit jamais contenir

- de lecture de l'environnement : le DSN arrive en argument ;
- de seconde implémentation d'un port (ADR 008) ;
- de règle métier, ni de décision sur *quand* remonter : ce sont les deux points
  d'instrumentation de l'application qui la prennent.

## Tests

`src/**/*.test.ts`. Le régime doublé y capture l'enveloppe réellement émise et
l'asserte, **avec son plancher** : une assertion portée sur une capture vide
échoue en le disant, au lieu de passer au vert.
