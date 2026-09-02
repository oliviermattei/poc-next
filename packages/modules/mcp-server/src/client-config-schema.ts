import { z } from 'zod'

/**
 * La forme d'un fichier de configuration client MCP (s41, critère 6).
 *
 * Il n'existe pas de schéma officiel unique — chaque client (Claude Desktop,
 * un agent…) lit sa propre forme, mais tous partagent ce squelette : une
 * commande locale, ses arguments, éventuellement des variables
 * d'environnement. C'est ce sous-ensemble commun que ce schéma valide, et
 * c'est ce que dit `mcp-client.example.json` — pas *le* schéma MCP, qui
 * n'existe pas comme artefact unique.
 */
export const mcpServerEntrySchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
})

export const mcpClientConfigSchema = z.object({
  mcpServers: z.record(z.string(), mcpServerEntrySchema),
})

export type McpClientConfig = z.infer<typeof mcpClientConfigSchema>
