# ADR 027 — Un formulaire interactif d'un module vit dans `apps/web`, pas dans le module

- Status: accepted
- Date: 2026-08-31

Un formulaire interactif poste en JavaScript : il appelle `fetch` vers la route du module et affiche la réponse. Or `eslint.config.ts` refuse `fetch` dans `packages/modules/**` — un appel réseau sortant d'un module passe par une porte bornée, parce que `docs/reliability.md` exige délai d'attente et reprises sur tout appel externe — et `tests/module-registry.test.ts` passe cette configuration sur chaque fichier de chaque module.

**Un composant de module qui appelle le réseau vit dans `apps/web`.** Le module garde la règle, la route, les clés de traduction et la place du composant dans sa page ; il le reçoit en `ReactNode` par une propriété obligatoire (`newsletterForm`, `form`), si bien qu'un oubli est une erreur de compilation et non une section vide. Le module décide où le formulaire s'affiche (l'ordre des sections reste piloté par `config/marketing.ts`), l'application décide comment il parle au serveur (`apps/web/app/public-form.tsx`, sur le patron de `app/auth-form.tsx`). La règle de lint n'est pas élargie.

## Considered options

- **Autoriser `fetch` dans `presentation/`** — rejeté : ce qui compte est l'origine de l'appel, pas la couche ; un composant serveur vit aussi dans `presentation/` et appellerait un tiers sans délai d'attente.
- **Autoriser `fetch` quand l'URL est relative** — rejeté : une règle de lint ne lit pas la valeur de `fetch(action)`, et une garde qui accepte ce qu'elle ne peut pas vérifier n'en est pas une.
- **Passer une fonction de soumission au composant du module** — impossible : une fonction ne traverse pas la frontière serveur/client de React.
- **`<form action>` natif avec redirection de retour** — rejeté pour l'instant : il faudrait une destination de retour transmise par l'appelant, donc une liste blanche contre la redirection ouverte (`docs/security.md`). À rouvrir le jour où une redirection de retour vérifiée existe : ce serait un gain d'accessibilité réel.

## Consequences

Un module à formulaire n'est plus autonome : l'installer demande de fournir son composant côté application. Si un `Form` entre un jour dans `packages/ui`, la frontière ne change pas : il recevra un gestionnaire de soumission de son appelant, sans appeler le réseau lui-même.
