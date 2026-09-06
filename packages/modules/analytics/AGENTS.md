# packages/modules/analytics — règles locales

Le module qui apporte l'**observabilité** (s39) : la déclaration du script
d'analyse au registre de consentement de s36, **le script lui-même**, et la
route par laquelle une erreur du navigateur atteint le fournisseur.

**Deux routes, toutes deux publiques** : `/analytics/client-error` (POST) et
`/analytics/script.js` (GET).

**Il ne contient aucun fournisseur.** PostHog et Sentry vivent dans
`packages/adapters/*`, derrière les ports `Analytics` et `Monitoring`
(`@repo/ports`). Ce module ne sait pas qui les implémente, et c'est ce qui rend
le critère 5 vrai sans qu'il ait à le savoir : sans clé, le point de composition
lui donne un port inerte.

## Ce qu'il déclare, et ce que sa coupure emporte

`requires: ['consent']` — c'est le couplage que s36 avait annoncé, et il va dans
ce sens-là : le module `consent` ne connaît aucun fournisseur, c'est celui qui
*apporte* un tiers qui déclare avoir besoin du registre. Sans ce requis, on
pourrait charger un tiers sur une installation sans consentement.

Module coupé (critère 8), **trois** garanties, et la troisième est dérivée :

1. aucun script déclaré — la liste de `apps/web/lib/consent.ts` est vide ;
2. aucune remontée — les deux routes répondent **404**, et les deux ports sont
   inertes ;
3. **la bannière de consentement ne s'affiche plus**, faute de script non
   essentiel à déclarer. Rien ne l'écrit : `resolveConsentState` (s36) le dérive.
   `config/profiles.ts` coupe ce module pour que `pnpm test:minimal-profile`
   rejoue la suite dans cette configuration-là.

Il **ne persiste rien** : `schema`, `migrations`, `dataCategories` et
`retention` sont vides. Ce qu'il envoie part chez un tiers, dont la rétention se
règle chez ce tiers ; en garder une copie ici créerait la donnée personnelle que
la story ne demande pas.

## Le script servi, et pourquoi il est servi ici

Le `src` déclaré au registre est **notre propre route**, jamais le chargeur du
fournisseur. La première écriture de la story déclarait le chargeur : il pose
`window.posthog` et **n'initialise rien** sans un `posthog.init(clé, …)`, qui
n'existait nulle part dans le bundle. L'exploitant qui posait `POSTHOG_KEY`
obtenait une bannière, un téléchargement chez un tiers, et **zéro mesure**
(constat 6 de la revue).

La clé de projet doit donc atteindre le navigateur. Un script **en ligne** est
refusé par la politique livrée, et `ConsentScripts` (s36) ne rend qu'un
`<script src>` noncé : la route est le seul chemin qui reste. Le chargeur du
fournisseur est ensuite injecté par ce script-là, ce que `'strict-dynamic'`
autorise (ADR 036) — un navigateur qui ne le comprend pas (CSP 2) ne mesurera
pas, faute d'origine dans `script-src`, et le produit fonctionne sans.

**Trois états, trois réponses**, et les confondre est ce que
`e2e/modules.spec.ts` attrape :

| État | Réponse |
|---|---|
| module **coupé** | **404**, par le répartiteur |
| module activé, **aucune clé** | **503** `analytics_provider_not_configured` |
| module activé, **clé configurée** | **200**, le script |

La deuxième ligne répondait 404 à la première écriture, et ce balayage l'a
trouvée en intégration — la **troisième** fois pour cette classe après le rappel
de s33 et le téléchargement de s35. Le raisonnement complet, et l'option « script
inerte en 200 » écartée, vivent sur la route elle-même.

`analyticsBootstrap` est **exécuté** par `tests/analytics.test.ts` dans un DOM
minimal : la balise insérée et l'initialisation émise sont observées, pas
relues. Ce qu'aucune commande ne prouve : que le fournisseur **accepte** ensuite
ce qu'il reçoit — cela demande un compte, et la recette humaine est dans
`packages/adapters/posthog/AGENTS.md`.

## L'arbitrage de la route publique de remontée

Un appelant anonyme peut y pousser, par fenêtre et par appelant, autant
d'événements que la politique `default` en tolère (`config/security.ts` : 120 par
minute au moment où ceci est écrit), chacun borné par le schéma Zod à environ
21 Ko — soit le quota Sentry de l'exploitant, consommé par un tiers.

C'est **borné et assumé**, et l'alternative est pire : authentifier la route
perdrait les erreurs qui surviennent **avant** qu'une session existe, c'est-à-dire
le cas le plus intéressant du critère 1. Le seuil se remonte ou se baisse dans
`config/security.ts`, en nommant une politique sur la route ; il n'existe aucun
moyen de l'éteindre (ADR 050).

## Imports autorisés

- `@repo/core` pour le contrat de module et `MODULE_ROUTE_PREFIX` ;
- `@repo/ports` pour le port `Monitoring` ;
- `zod` à la frontière de la route (`docs/security.md` §4) ;
- `@repo/typescript-config` pour la configuration du compilateur.

## Ne doit jamais contenir

- d'import de `@repo/module-consent`, ni d'aucun autre module : la forme
  déclarée est **structurellement** celle de `NonEssentialScript`, et c'est le
  point de composition qui les réunit. La seule dépendance inter-modules
  déclarée est `requires` ;
- d'import d'un adaptateur : le fournisseur est choisi par
  `apps/web/lib/analytics.ts`, et `tests/analytics.test.ts` refuse tout autre
  importeur ;
- de règle métier hors de `domain/` ;
- de lecture de l'environnement.

## Tests

`src/**/*.test.ts` pour ce qui appartient au module. Aujourd'hui, tout ce qui le
concerne traverse des packages — le registre de consentement, le point de
composition, la coupure — et vit donc dans `tests/analytics.test.ts`.
