# ADR 076 — Le changement d'organisation revient à l'écran courant, par un `next` filtré

- Status: accepted
- Date: 2026-09-28

Le sélecteur d'organisation vit dans la barre du haut, sur tout écran de `/app`, et changer d'organisation doit ramener à l'écran courant. Or `docs/security.md` veut qu'une redirection vise une constante, jamais un paramètre. La route `switch` du module `organizations`, **et elle seule**, lit donc un champ `next` du corps et le passe par `safeRedirectPath` (`@repo/module-auth`) ; refusé ou absent, elle revient à `ORGANIZATIONS_SCREEN_PATH`. Le champ est posé par un composant client de la barre du haut à partir de `usePathname` — le chemin public, sans la requête.

Le filtre est injecté, pas importé : `eslint.config.ts` interdit à `packages/modules/organizations/src` d'importer `@repo/module-auth` hors de `schema.ts` et `infrastructure/scoped-reads.ts` (frontière anti-énumération, `docs/security.md`). Le point de composition `apps/web/lib/organizations.ts` passe `safeRedirectPath` à `configureOrganizations` par une option **obligatoire** `safeReturnPath`, pour que le compilateur la réclame sans repli permissif.

## Considered options

- **L'en-tête `Referer`** — rejeté : absent selon la `Referrer-Policy` et le navigateur, et il resterait une valeur reçue à filtrer pareillement.
- **Une liste blanche d'écrans de retour** — rejeté : tout écran de `/app` est légitime, et la liste vieillirait à chaque écran ajouté.
- **Assouplir la frontière de lint, ou recopier le filtre dans `organizations`** — rejeté : affaiblir une barrière de sécurité pour un besoin que l'injection satisfait ; deux filtres divergeraient au contournement suivant.
- **Ouvrir `next` à toutes les routes du module** — rejeté : chaque route qui accepte une destination reçue est une surface de redirection ouverte de plus.

## Consequences

La règle « une constante, jamais un paramètre » a une exception écrite, bornée à `switch` et au filtre partagé ; les tests de `safeRedirectPath` restent la seule source de vérité du filtre. Le retour ne conserve pas la chaîne de requête de l'écran : `useSearchParams` forcerait un rendu client de la barre.
