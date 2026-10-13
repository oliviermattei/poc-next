# ADR 085 — Les routes de module sont des descripteurs `ModuleRoute` répartis par le cœur, sans Hono ni oRPC

- Status: accepted
- Date: 2026-10-13
- Supersedes: ADR 005 et ADR 017.

L'ADR 005 avait choisi Hono monté dans Next et des contrats oRPC, et l'ADR 017 tenait `ModuleRoute[]` pour une forme de transition en attendant. Ni l'un ni l'autre n'a jamais été livré : tous les modules déclarent des `ModuleRoute`, et `dispatchModuleRequest` (`@repo/core`), monté par `apps/web/app/api/[[...route]]`, les apparie par méthode et chemin exacts. C'est la forme définitive : un seul répartiteur, celui du cœur, qui monte ou non les routes d'un module selon `config/features.ts` — ce que l'ADR 005 attendait de Hono. N'introduire ni Hono, ni oRPC, ni un second routeur ; un besoin de segment dynamique se tranche par une ADR le jour où un ticket l'exige, il ne déclenche plus l'introduction de Hono.
