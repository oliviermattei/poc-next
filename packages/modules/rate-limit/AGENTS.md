# packages/modules/rate-limit — règles locales

Le **compteur de limitation de débit** du dépôt (s28, ADR 050) : une table, la
règle qui la lit, et l'implémentation PostgreSQL du port `RateLimiter`
(`@repo/ports`).

C'est un module **sans route, sans navigation et sans message**, et ce n'est pas
un squelette inachevé. Ce qu'il apporte n'est pas une fonctionnalité du produit ;
il est un module parce que le dépôt n'a qu'un mécanisme pour qu'une table ait un
propriétaire, une migration et un journal de migration — le contrat de module.

Il est **du socle** (`requiredModules`) : optionnel, il laisserait toute
installation par défaut exposée sur la connexion, l'inscription et la
réinitialisation de mot de passe.

## Ce qui décide, et où

| Question | Où elle est tranchée | Ce qui échoue si on la viole |
|---|---|---|
| Quelle fenêtre, quel seau, quel `Retry-After` | `src/domain/rate-limit-rules.ts` | `pnpm vitest run packages/modules/rate-limit` |
| Comment on compte, et le partage entre instances | `src/infrastructure/drizzle-rate-limiter.ts` | `pnpm vitest run tests/rate-limiting.test.ts` |
| Quels seuils | `config/security.ts` — jamais ici | `pnpm test` (`tests/rate-limiting.test.ts`) |
| **Qui refuse** | `dispatchModuleRequest` (`@repo/core`) | `pnpm vitest run tests/rate-limiting.test.ts` |

Ce module **ne refuse rien**. Il compte et rend des comptes ; la traduction d'un
dépassement en 429 appartient au répartiteur, qui est le seul point par lequel
passent toutes les routes de modules. Deux endroits qui décideraient
divergeraient au premier seuil ajusté — c'est exactement ce qui s'est produit
entre s11 et s24, et que cette story répare.

## Le balayage : c'est la **ligne** qui dit si elle est close

`rate_limit_window` est partagée par toutes les routes, et les seaux n'ont pas la
même durée — 300 s pour la connexion, 600 s pour un formulaire, 3600 s pour un
seau par compte visé. Chaque ligne porte donc son `expires_at`, et `sweep(now)`
ne fait que comparer à l'instant présent.

**Ce n'était pas le cas à la première livraison**, et c'était le constat critique
de la revue : `sweep(before)` effaçait tout ce qui précédait une borne choisie
par l'appelant. `marketing` balayant sa fenêtre de dix minutes remettait à zéro
les seaux **horaires** encore ouverts de la réinitialisation de mot de passe, du
magic link et de l'invitation — déclenchable à distance par un POST vide toutes
les dix minutes, ce qui transformait « 5 par heure » en « 5 par dix minutes ».

Deux propriétés en découlent, et elles sont éprouvées :

- un instant **passé** ne peut que retarder la récupération, jamais effacer un
  seau ouvert. C'est ce qui rend l'appel sûr depuis un module qui ne connaît que
  sa propre fenêtre ;
- **la récupération ne dépend d'aucun module optionnel** : le garde balaie
  lui-même, au plus une fois par intervalle, et il est sur le chemin de toute
  route limitée. Le module déclare en plus une tâche planifiée pour
  l'ordonnanceur de s33 — une application au repos ne produit pas de trafic.

## Un compte visé lu dans un cookie se lit par **nom exact**, et à la **même valeur**

L'en-tête `Cookie` est écrit intégralement par l'appelant. La bibliothèque
d'authentification lit **un nom précis** ; si le limiteur lit autre chose — un
suffixe, par exemple — les deux ne regardent plus la même valeur, et il suffit de
poser un leurre en tête pour que le seau compte un compteur qui tourne pendant
que le serveur valide le vrai défi. C'est le contournement que la re-revue de s28
a mesuré : 401×20, aucun 429.

`subjectCookies` porte donc des **noms exacts**, au pluriel parce que le nom réel
dépend d'une configuration que la déclaration de route ignore. Plus d'un présent
dans la requête ⇒ **refus** : deviner rouvrirait le trou dans la moitié des
déploiements, et un navigateur légitime n'envoie jamais les deux.

**Le nom exact ne suffisait pas**, et c'est le constat M1 de la troisième revue :
le limiteur rendait la sous-chaîne **brute** qui suit le `=`, quand le serveur lit
`parsedCookies.get(nom)` — une valeur détrimée, ses guillemets encadrants
retirés, puis passée à `decodeURIComponent` dès qu'elle contient un `%`
(`better-call@1.4.0/dist/cookies.mjs:19-40`, `dist/utils.mjs`). Le même défi,
ré-encodé, ouvrait donc un seau neuf à chaque essai : 401×15 sous quinze
encodages, contre 401×10 puis 429×5 sur la valeur brute. `asTheServerReadsIt`
(dans `src/domain/rate-limit-rules.ts`) refait ces trois gestes, dans cet ordre,
et **ne lève jamais** — `decodeURIComponent('%zz')` lève, et l'en-tête vient de
l'attaquant. La normalisation appartient au **lecteur** ; `subjectBucketKey` ne
touche plus à rien, parce que deux normalisations concurrentes sont précisément
ce qui a produit ce défaut.

**Trois plafonds relevés sur l'énumération 2FA, et l'ordre compte.** Trois est
ce qui a été **balayé**, pas ce qui existe : le balayage porte sur
`config/security.ts` et sur les trois fichiers de `better-auth@1.7.2` cités
ci-dessous, et il en a trouvé un dans le premier et deux dans les seconds. Les
voici, du premier qui mord au dernier.

1. **Le seau de ce module**, `twoFactor.maxPerSubject` dans
   `config/security.ts`, compté **par défi**. Le seuil livré était au-dessus du
   suivant : il ne pouvait jamais mordre le premier sur un défi authentique, et
   la garantie écrite reposait en silence sur une dépendance. Il est désormais
   **sous** ce plafond, et `tests/rate-limiting.test.ts` dérive ce dernier de la
   bibliothèque installée — une version qui le déplace fait rougir `pnpm test`
   au lieu de laisser la phrase vieillir.
2. **Le budget d'essais par défi de la bibliothèque** : cinq sur le chemin de la
   connexion (`beginAttempt(5)` dans `dist/plugins/two-factor/totp/index.mjs` et
   `dist/plugins/two-factor/backup-codes/index.mjs`), puis le défi est
   **détruit** (`dist/plugins/two-factor/verify-two-factor.mjs`). Il n'est pas
   décoratif pour autant : un défi **fabriqué**, que la bibliothèque refuse en
   401 sans jamais le compter, n'est borné que par le seau du point 1.
3. **Le verrouillage de compte de la bibliothèque**, sur un **autre axe** : il
   compte les vérifications fausses **consécutives par compte**, en travers des
   défis et des deux facteurs, et c'est donc le plus serré pour une attaque
   suivie sur un compte. `assertTwoFactorNotLocked` / `recordTwoFactorFailure`
   (`dist/plugins/two-factor/verify-two-factor.mjs`), appelés **à la connexion
   seulement** (`if (isSignIn)`) par les deux facteurs. Ce dépôt ne configure pas
   `accountLockout` (`better-auth-service.ts`), donc les défauts de la
   bibliothèque s'appliquent : actif, **10 vérifications** fausses, verrouillage
   de **900 s**. Les colonnes qui le portent existent bien ici
   (`packages/modules/auth/src/schema.ts`, `failed_verification_count` et
   `locked_until`).

Les trois valeurs des points 2 et 3, et le fait que ce dépôt ne les remplace pas,
sont **dérivés de la bibliothèque installée** par `tests/rate-limiting.test.ts` :
une montée de version qui les déplace, une configuration qui les écrase ou un
paragraphe qui les oublie fait rougir `pnpm test`.

**Ce que rien ici n'a exercé**, et il faut le lire comme tel : le point 3 est
**lu**, jamais joué. Personne n'a brûlé dix vérifications fausses sur un compte
authentique — c'est un geste humain, pas une commande.

## Deux règles qui diffèrent, sciemment

- Le **magasin condense** : `bucket` est un SHA-256 de la clé. Ni adresse IP, ni
  adresse email n'entre en clair dans `rate_limit_window`.
- Le **journal ne condense pas** : le critère 6 de la story demande l'IP et la
  route. Une ligne de compteur survit à l'incident et n'a aucune raison de porter
  une adresse ; une ligne de journal existe pour l'expliquer.

## Ce que ce module ne supprime pas

`public_form_throttle` (module `marketing`, s11) et `billing_checkout_throttle`
(module `billing`, s24) **restent en place, vides et inertes**. s28 a fait
converger les points d'entrée ici et a cessé de les écrire ; les supprimer dans
la même livraison casserait la version encore en ligne, qui y écrit toujours
pendant le basculement (`docs/reliability.md` : « cesser d'écrire avant de
supprimer », et s27 a mesuré que le basculement n'est pas instantané). Leur
suppression est une story ultérieure. Ne la faites pas ici.

## Imports autorisés

- `@repo/core` pour le contrat de module ;
- `@repo/ports` pour le port `RateLimiter` qu'implémente `infrastructure/` ;
- `drizzle-orm` dans `schema.ts` et `infrastructure/` ;
- `zod` dans `domain/rate-limit-config.ts`, pour valider `config/security.ts` à la
  frontière (`docs/security.md` §4) ;
- `node:crypto` pour le condensat ;
- `@repo/typescript-config` pour la configuration du compilateur.

## Ne doit jamais contenir

- de **seuil en dur** : ils vivent dans `config/security.ts` (critère 4) ;
- de **variable d'environnement** : aucune ne doit pouvoir désactiver la
  limitation (critère 8). La neutralisation se fait par injection, dans les
  tests. `tests/rate-limiting.test.ts` le vérifie en deux temps — il **dérive du
  disque** le chemin de la limitation (tout ce paquet, plus quatre fichiers
  nommés) et y refuse toute lecture d'environnement, puis il cherche dans
  **toutes** les sources de production le nom d'un interrupteur
  (`DISABLE_*`, `SKIP_*`, `BYPASS_*`). La première version énumérait onze
  chemins, et la revue l'a mise en défaut avec un fichier neuf ;
- de décision de refus : voir plus haut ;
- d'import de `@repo/db` : le module reçoit sa connexion de son point de
  composition (ADR 020) ;
- de **second compteur** : le port est le seul.

## Tests

`src/domain/rate-limit-rules.test.ts` pour la règle pure. Tout ce qui traverse
les packages — le partage entre instances contre une vraie base, la double
limitation au répartiteur, la couverture des points d'entrée — vit dans
`tests/rate-limiting.test.ts`.
