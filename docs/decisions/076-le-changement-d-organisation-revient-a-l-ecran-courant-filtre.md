# ADR 076 — Le changement d'organisation revient à l'écran courant, par un `next` filtré

- Status: accepted
- Date: 2026-09-28
- Scope: story s62c-barre-du-haut

## Context
s62c place le sélecteur d'organisation dans la barre du haut, présente sur tout écran de `/app`. Critère 2 : changer d'organisation **ramène sur l'écran courant**. La route `switch` (`organization-routes.ts:285-289`) répond aujourd'hui 303 vers une **constante** (`ORGANIZATIONS_SCREEN_PATH`), et le code l'assume au nom de `docs/security.md` §4 (« une constante, jamais un paramètre »). Le serveur ne connaît pas l'écran d'où vient le formulaire autrement que par ce que le navigateur envoie.

## Decision
La route `switch`, **et elle seule**, lit un champ `next` du corps et le passe par `safeRedirectPath` (`@repo/module-auth`, durci en s61 et s67 : caractères de contrôle, `//`, barre inverse, segments point, origine recontrôlée). Refusé ou absent → la constante actuelle.

**Le filtre est injecté, pas importé.** `eslint.config.ts:500-536` interdit tout import de `@repo/module-auth` dans `packages/modules/organizations/src` hors `schema.ts` et `infrastructure/scoped-reads.ts` (frontière anti-énumération, `docs/security.md` §7, revue s16 F9), et `tests/lint-rules.test.ts:960-1014` le prouve. Le point de composition (`apps/web/lib/organizations.ts`) passe donc `safeRedirectPath` à `configureOrganizations` par une option **obligatoire** `safeReturnPath: (candidate, fallback) => string`, que `OrganizationsService` expose à la route — le patron de `seatSync` : obligatoire pour que le compilateur la réclame, sans repli permissif. Le champ est posé par un composant client de la barre du haut, qui lit le chemin **courant** (`usePathname`) — le chemin public, sans la requête.

## Considered options
- **Garder la constante** — rejetée : contredit le critère 2 ; changer d'organisation depuis un écran produit renverrait dans les réglages.
- **L'en-tête `Referer`** — rejeté : absent selon la politique `Referrer-Policy` et les navigateurs, donc un comportement qui dépend du client sans que le formulaire le dise ; il reste une valeur reçue à filtrer pareillement.
- **Une liste blanche d'écrans de retour** — rejetée : tout écran de `/app` est légitime, et la liste vieillirait à chaque écran produit ajouté.
- **Importer `safeRedirectPath` dans `organization-routes.ts`** — rejeté : franchit la frontière lint §7 ; l'assouplir par `allowImportNames` affaiblirait une barrière de sécurité pour un besoin que l'injection satisfait.
- **Recopier le filtre dans `organizations`** — rejeté : deux filtres divergeraient, et le contournement suivant ne serait corrigé qu'à un endroit.
- **Ouvrir `next` à toutes les routes du module** — rejeté : aucune autre n'en a besoin ; chaque route qui accepte une destination reçue est une surface de redirection ouverte de plus.

## Consequences
- La règle « une constante, jamais un paramètre » a désormais **une** exception écrite, bornée à `switch` et au filtre partagé ; les commentaires de `organization-routes.ts` le disent.
- Un nouveau contournement de `safeRedirectPath` touche aussi ce retour ; ses tests restent la seule source de vérité du filtre, la route ne le rejoue pas.
- Le retour ne conserve pas la chaîne de requête de l'écran (filtres, pagination) : choix délibéré, `useSearchParams` forcerait un rendu client de la barre.
