import { type AvailableModuleId } from '../../../config/features'

/**
 * **Doit échouer** : « un identifiant inconnu provoque une erreur de
 * compilation ».
 *
 * Le type vient de l'annuaire réel de `config/features.ts`, pas d'une copie :
 * si quelqu'un remplaçait un jour la liste typée par un `string[]`, ce fichier
 * cesserait d'échouer et le test le dirait.
 */
export const enabled = [
  'demo-enabled',
  'demo-analytics',
] as const satisfies readonly AvailableModuleId[]
