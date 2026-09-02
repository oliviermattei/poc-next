#!/usr/bin/env node
/**
 * Point d'entrée exécutable du serveur MCP.
 *
 * Comme `packages/cli/bin/ks.mjs` : ce paquet n'a pas d'étape de build, donc
 * le chargeur `tsx` est enregistré avant d'importer l'entrée réelle.
 */
import { register } from 'tsx/esm/api'

const unregister = register()

try {
  const { runMcpServer } = await import('../src/bin.ts')

  process.exitCode = await runMcpServer()
} finally {
  await unregister()
}
