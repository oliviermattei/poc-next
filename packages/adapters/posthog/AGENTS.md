# packages/adapters/posthog — règles locales

**L'unique implémentation livrée du port `Analytics`** (ADR 008, contrainte du
PRD : « PostHog comme seule implémentation »). Il n'y en aura pas de seconde ; une
doublure de test n'en rend aucune légitime.

Le gabarit est `packages/adapters/resend`, et ce qui s'en répète n'est pas
redémontré ici : collaborations injectées, `track` et `page` qui **ne lèvent
jamais**, délai d'attente explicite, reprises en recul exponentiel dispersé et
plafonné **sur erreurs transitoires uniquement**, journal de forme fermée et
message de fournisseur assaini.

## Ce que ce package fait autrement, et pourquoi

| Choix | Ce qui le motive |
|---|---|
| **Pas de SDK** : un seul POST vers l'API de capture documentée (`POST <host>/i/v0/e/`) | `posthog-node` porte sa propre file, ses propres reprises et son propre `flush` — trois décisions que `docs/reliability.md` §3 confie à l'application —, et n'expose pas de délai d'attente par appel. Réimplémenter **un POST documenté** n'est pas deviner un protocole : c'est refuser une file qu'on ne contrôle pas. Même arbitrage que la moitié « émission » de l'adaptateur d'Inngest |
| L'échec **dégrade**, il ne refuse jamais | `docs/reliability.md` §2 : « pas d'analytics → l'application tourne ». C'est la règle générale ; `rate-limit` en est la seule exception du dépôt |
| Le **filtrage** des champs sensibles est ici, au dernier point avant le réseau (`redact.ts`) | une règle posée plus haut — au point de composition, dans un module — est contournable par quiconque tient l'adaptateur. Elle est écrite **une fois par côté de la frontière** (ici et dans `@repo/adapter-sentry`), comme le classement transitoire/définitif d'Inngest, parce qu'un adaptateur ne dépend d'aucun package du dépôt hormis `@repo/ports` |
| `$pathname`, jamais `$current_url` | le port ne transporte qu'un **chemin**. Une URL complète emporterait la query, où vivent les jetons de vérification et de réinitialisation de ce dépôt |

## Les deux régimes, et ce que chacun prouve

`docs/architecture.md` en impose deux et interdit de les mélanger. Ici, chacun
dit **ce qu'il ne prouve pas** — c'est la moitié qui a manqué au régime
`recorded` du parcours doré, où une CI verte ne disait rien de la fidélité au
fournisseur :

- `posthog-analytics.test.ts` — **bloquant en CI**. Il double le réseau, jamais
  le SDK, et asserte les requêtes **capturées**. Il prouve la forme de ce que
  *nous* émettons, et **rien** de la fidélité du fournisseur. Il porte un
  **plancher** : toute lecture d'une requête capturée passe par `capturedBody`
  ou `capturedText`, qui **échouent** sur un ensemble vide, si bien qu'un
  adaptateur qui n'émettrait plus rend la recette rouge au lieu de verte. La
  seconde porte a été ajoutée par la revue de s39, qui avait mesuré un cas lisant
  `network.requests.at(-1)` **directement** — la phrase ci-dessus était alors
  fausse (balayé le 6 septembre 2026, sur les 8 cas du fichier) ;
- `posthog-live.test.ts` — **jamais en CI**, armé par `POSTHOG_LIVE_TEST=1`. Il
  parle au vrai fournisseur avec une vraie clé de test, et c'est le seul qui
  prouve qu'il **accepte** ce que nous émettons. Armé sans clé, il **échoue** en
  le disant plutôt que de se sauter lui-même.

## Imports autorisés

- `@repo/ports` pour le port `Analytics`, sa forme de résultat et celle du
  journal ;
- `@repo/typescript-config` pour la configuration du compilateur ;
- `vitest` dans les fichiers de test.

Aucun SDK, aucune dépendance de fournisseur : ce package n'en a pas, et c'est
délibéré.

## Ne doit jamais contenir

- de lecture de l'environnement : la clé et l'hôte arrivent en argument. Le
  point d'accès unique est `@repo/config`, et un adaptateur n'y touche pas ;
- de décision sur le **consentement** : elle est prise avant, au registre de
  s36, et elle porte sur le **chargement** du script, pas sur l'envoi ;
- de seconde implémentation d'un port (ADR 008) ;
- de règle métier : un adaptateur dit *comment* on parle au tiers, jamais
  *quand*.

## Tests

`src/**/*.test.ts`, à côté du code qu'ils couvrent — les deux régimes ci-dessus.
Ce qui traverse les packages (point de composition, registre de consentement,
balayage de la surface unique) vit dans `tests/analytics.test.ts`.
