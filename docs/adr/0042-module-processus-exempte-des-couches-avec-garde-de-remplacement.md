# ADR 042 — Un module-processus est exempté des quatre couches, et le paie par une garde de remplacement

- Status: accepted
- Date: 2026-09-02

`packages/modules/mcp-server` a un `src/` plat : c'est un processus lancé en `stdio` par un client, sans route, sans schéma ni règle métier, qui traduit un appel d'outil en appel du moteur de `@repo/cli`. Or la règle de frontières de l'ADR 006 est câblée sur `src/{domain,application,infrastructure,presentation}` : un fichier hors de ces dossiers n'est classé par aucun motif, donc rien ne peut lui être refusé — dans le module même qui mêle SDK, transport `stdio`, `child_process` et système de fichiers.

Un module dont des fichiers vivent hors des quatre couches est un **module-processus**. Il en est dispensé et paie la dispense par une frontière de remplacement : son unique point de composition est `src/bin.ts`, et aucun autre fichier de `src/` n'importe `node:child_process` ni un transport du SDK (`…/server/stdio.js`), ni n'utilise d'`import()` dynamique — la seule façon de charger `config/features.ts` à un chemin calculé. `tests/lint-rules.test.ts` vérifie les deux points, en dérivant la liste des modules sans couches plutôt qu'en la recopiant.

## Considered options

- **Ranger `mcp-server` dans les quatre couches** — rejeté : sans domaine ni cas d'usage, tout serait réparti arbitrairement entre `infrastructure` et `presentation`, et le premier import entre les deux violerait la règle qu'on prétendait respecter. Des couches décoratives apprennent qu'elles sont décoratives.
- **Écrire l'exemption en prose dans `AGENTS.md`** — rejeté : non opposable ; la sortie des sous-processus est déjà partie dans le canal du protocole sans qu'aucun test rougisse.
- **Interdire tout module sans les quatre couches** — rejeté : un module peut légitimement n'en avoir que certaines (`i18n` n'a que `domain` et `application`) ; ce qui compte est qu'aucun fichier ne vive hors de portée d'une règle.

## Consequences

`pnpm ks scaffold` continue de créer les quatre couches : l'exemption est un cas nommé, pas une facilité. La garde nomme les trois mécanismes que ce module utilise aujourd'hui ; un module-processus qui atteindrait le monde autrement (socket brut, `node:worker_threads`) passerait entre les mailles, et la liste s'étend au premier cas rencontré.
