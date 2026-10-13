# ADR 085 — Les routes de module sont des descripteurs `ModuleRoute` répartis par le cœur, sans Hono ni oRPC

- Status: accepted
- Date: 2026-10-13

Le cadrage avait choisi Hono monté dans Next et des contrats oRPC, et tenait `ModuleRoute[]` pour une forme de transition en attendant ; ni l'un ni l'autre n'a jamais été livré, et les deux ADR qui le disaient ont été supprimées (ADR 084). Les modules déclarent des `ModuleRoute` (corps validés par Zod), et `dispatchModuleRequest` (`@repo/core`), monté par `apps/web/app/api/modules/[...path]`, les apparie par méthode et chemin exacts. C'est la forme définitive : un seul répartiteur, celui du cœur, qui monte ou non les routes d'un module selon `config/features.ts` — rendre un module désactivable ne demande pas plus.

Ce qui reste écarté, et pourquoi : les server actions, parce que faire disparaître un module reviendrait à jouer sur la présence de fichiers dans `app/`, et parce que les webhooks exigent de toute façon des route handlers ; une API dans une application séparée, qui imposerait deux déploiements, du CORS et une session partagée entre deux origines.

N'introduire ni Hono, ni oRPC, ni un second routeur. Une méthode non appariée répond 404 et non 405, pour ne pas divulguer les méthodes acceptées (`docs/security.md`). Un besoin de segment dynamique (`/items/:id`) se tranche par une ADR le jour où un ticket l'exige.
