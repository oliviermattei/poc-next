# ADR 070 — La zone du superadmin s'appelle `console`

- Status: accepted
- Date: 2026-09-27

« admin » désignait deux choses dans le produit : la plateforme (module `admin`, superadmin) et l'organisation d'un client (ses membres, sa facturation). Pour que la zone du superadmin soit reconnaissable, la valeur de surface `'admin'` est devenue `'console'` (`NavigationSurface`, `packages/core/src/module.ts` ; la règle de surface est celle de l'ADR 066), et les écrans sont passés de `/admin/*` à `/console/*`. Les anciens chemins `/admin/*` répondent 404, sans redirection. Le module garde son identifiant `admin` et le préfixe de ses routes d'API (`/api/modules/admin/…`) : c'est le nom de la zone vue par un humain qui change, pas celui du module.

## Considered options

- **`superadmin`** — rejeté : c'est le nom d'un rôle (`admin_platform_role.role`), et une surface nommée d'après un rôle suggère une garde par la surface, que le registre ne fait pas. La garde reste `asSuperadmin`.
- **Renommer aussi le module `admin`** — rejeté : son identifiant vit dans les migrations, `config/features.ts`, `config/profiles.ts`, le préfixe de montage et la CI, pour aucun gain visible.
- **Rediriger `/admin/*` vers `/console/*`** — rejeté : une redirection confirme l'existence de la zone à qui ne doit pas la connaître (ADR 068, `docs/security.md`).

## Consequences

`pnpm typecheck` refuse une entrée qui déclare encore `surface: 'admin'`. Les constantes `ADMIN_*_SCREEN_PATH` des modules ont changé de valeur, pas de nom.
