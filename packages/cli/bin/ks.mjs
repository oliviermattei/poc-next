#!/usr/bin/env node
/**
 * Point d'entrée exécutable de `ks`.
 *
 * Le CLI est écrit en TypeScript et n'est pas compilé : `packages/cli` n'a pas
 * d'étape de build, comme les autres packages du dépôt qui exportent leurs
 * sources. Ce fichier enregistre donc le chargeur `tsx` avant d'importer
 * l'entrée réelle — c'est aussi lui qui rend `npx ks` utilisable depuis la
 * racine, sans installation globale.
 */
import { register } from 'tsx/esm/api'

const unregister = register()

try {
  const { runCli } = await import('../src/bin.ts')

  process.exitCode = await runCli(process.argv.slice(2))
} finally {
  await unregister()
}
