/**
 * Le baril du module : le **contrat**, et rien d'autre.
 *
 * `createMcpServer` n'y est pas, et c'est mesuré : `config/features.ts` importe
 * ce baril, `apps/web` importe `config/features.ts`, donc tout ce qui sort
 * d'ici entre dans le bundle serveur de l'application — le SDK MCP y était,
 * module activé comme désactivé, pour une fonction qu'aucun consommateur du
 * baril n'appelle. Le serveur se construit depuis `src/bin.ts`, en relatif ;
 * il n'est pas une dépendance de l'application web.
 */
export { mcpServerModule } from './module'
