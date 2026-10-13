# ADR 020 — La connexion à la base est injectée aux modules, jamais importée par eux

- Status: accepted
- Date: 2026-08-31

Pour que `db.query.<table>` soit typé, `@repo/db` doit connaître statiquement les schémas des modules activés. Si les modules importaient aussi `@repo/db`, la dépendance fermerait un cycle. `@repo/db` importe donc l'agrégat généré (`generated/schema/index.ts`, écrit par `pnpm db:generate` depuis `config/features.ts`), et un module n'importe jamais `@repo/db` : il reçoit de son point de composition une connexion réduite aux opérations qu'il utilise. Le sens est unique : `@repo/db` → agrégat → modules. `tests/module-registry.test.ts` refuse tout import de `@repo/db` dans le code et le manifeste d'un module.

## Considered options

- Le module importe `@repo/db` et les schémas sont injectés à l'exécution — rejeté : le schéma perdrait son type, donc `db.query.<table>` resterait inutilisable ; s'y ajouterait un singleton mutable dont l'ordre d'initialisation ne se vérifie nulle part.
- Le module importe `@repo/db` et `@repo/db` importe l'agrégat — rejeté : le cycle ne se voit pas à la compilation mais à l'exécution, en `ReferenceError` intermittente selon l'ordre des imports.
- Chaque point de composition construit son client typé — rejeté : deux pools de connexions pour un même processus.

## Consequences

- Un module qui persiste déclare un port de persistance et le reçoit à sa composition.
- L'agrégat est versionné : comme les barils, il ment s'il n'est pas comparé à sa régénération, ce que fait `tests/module-migrations.test.ts`.
- Un besoin de `@repo/db` autre que la connexion (aide de migration, introspection) se sert par un port, jamais par un import.
