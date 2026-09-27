# ADR 070 — La surface de navigation du back-office s'appelle `console`

- Status: accepted
- Date: 2026-09-27
- Scope: story s60-console

Ne réécrit ni l'ADR 066 (une entrée déclare sa surface) ni l'ADR 067 (la surface reste une propriété de l'entrée) : elle renomme une **valeur** du type qu'ils ont posé.

## Context
`NavigationSurface` vaut `'app' | 'footer' | 'admin'` (`packages/core/src/module.ts:251`). Le mot « admin » désigne deux choses dans le produit : la plateforme (module `admin`, superadmin) et l'organisation d'un client (ses membres, sa facturation, `/organizations`). Le porteur a demandé (27/09) que la zone du superadmin soit **reconnaissable** et dissociée de l'administration côté client. Les écrans vivent sous `/admin/*`, sans page d'accueil.

## Decision
La valeur `'admin'` est remplacée par `'console'`, et les écrans passent de `/admin/*` à `/console/*`. Les anciens chemins répondent 404, sans redirection. Le module garde son identifiant `admin` et le préfixe de montage de ses routes d'API (`/api/modules/admin/…`) : ce qui change, c'est le nom de la **zone** vue par un humain, pas celui du module.

## Considered options
- **Garder `admin`, ajouter une page d'accueil** — rejetée : la confusion avec l'administration d'organisation reste entière, et c'est elle que le porteur pointe.
- **`superadmin`** — rejetée : c'est le nom d'un **rôle** (`admin_platform_role.role`), et une surface nommée d'après un rôle suggère une garde par la surface, que le registre ne fait pas. La garde reste `asSuperadmin` et les lectures du module.
- **Renommer aussi le module `admin` en `console`** — rejetée : l'identifiant d'un module est dans les migrations, `config/features.ts`, `config/profiles.ts`, le préfixe de montage et la CI. Le renommer n'apporterait rien au superadmin et rouvrirait toutes ces surfaces.
- **Rediriger `/admin/*` vers `/console/*`** — rejetée : une redirection confirme qu'une zone existe à qui ne doit pas la connaître (ADR 068, `docs/security.md` §3).

## Consequences
- `pnpm typecheck` refuse toute entrée qui déclare encore `surface: 'admin'`.
- Quatre modules déclarent des entrées `console` (admin, organizations, billing, marketing) ; leurs constantes `ADMIN_*_SCREEN_PATH` changent de valeur, pas de nom — renommer quatre exports publics aurait élargi le diff sans rien protéger.
- Un lien, un favori ou une documentation qui visait `/admin/users` tombe sur un 404 : c'est voulu.
