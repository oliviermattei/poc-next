# ADR 083 — Le Guide est un site Fumadocs séparé, jamais dans l'image de production

- Status: accepted
- Date: 2026-10-13

Le propriétaire du projet (`GLOSSARY.md`) n'avait pas de documentation à lui : `docs/` parle aux développeurs, et `/docs` est la documentation produit, qu'il écrit pour ses clients. Le Guide — ce que fait le boilerplate, comment activer chaque fonctionnalité, brancher chaque service et déployer, en français et en anglais, avec une recherche et un `llms.txt` — est une application à part, `apps/guide`, construite avec Fumadocs (versions figées exactement : `fumadocs-ui` exige le `fumadocs-core` du même numéro) et exportée en site statique. Il ne dépend d'aucun paquet du dépôt hormis le `tsconfig` partagé, rien ne l'importe, et `.dockerignore` l'exclut du contexte de build : il n'entre dans aucune image, pas même celle de migration (`tests/deployment.test.ts` le garde). Le français fait foi, chaque page a sa traduction au même slug, et `tests/guide.test.ts` tient le Guide au code ; `CODING_STANDARDS.md` exige sa mise à jour dans le commit qui change ce qu'il décrit.

L'ADR 053, qui écarte `fumadocs-mdx`, juge la documentation produit, servie par `apps/web` sous le design system, où une seconde couche de présentation contredirait `packages/ui`. Le Guide ne s'affiche à aucun client et n'a pas à ressembler au produit : le routeur, la recherche et la mise en page de Fumadocs sont exactement ce qui est demandé. Les contraintes de sécurité de l'ADR 053 tiennent — le MDX est compilé au build. L'ADR 022 ne s'applique pas non plus : sa frontière protège l'interface du produit, et le Guide n'importe Radix nulle part ; la règle de lint qui interdit `@radix-ui/*` en import direct le couvre comme le reste du dépôt.

## Considered options

- **Écrire le Guide dans la documentation produit `/docs`** — rejeté : il parlerait aux clients du propriétaire du projet et partirait dans l'image de son SaaS.
- **Une section de la console** — rejeté : il faudrait une base, un compte et une application en marche pour lire comment l'installer.
- **Un site maison sur `@next/mdx`** — rejeté : recherche, navigation, changement de langue et `llms.txt` seraient à écrire et maintenir.
- **Un site Fumadocs servi par un serveur Next** — rejeté : un serveur de plus pour un contenu qui ne change qu'au build.

## Consequences

Un site statique ne pose aucun en-tête : la CSP à nonce de `docs/security.md` ne couvre pas le Guide, et l'export de Next écrit des scripts en ligne. Le socle de sécurité porte sur le produit ; le Guide n'a ni compte, ni formulaire, ni donnée. Publié, sa CSP est celle de l'hébergeur, avec `script-src 'self' 'unsafe-inline'` pour plancher. Turbo prend chaque application : `pnpm dev` et `pnpm build` lancent aussi le Guide, voulu pour que la CI le construise à chaque envoi (`docs/commands.md`).
