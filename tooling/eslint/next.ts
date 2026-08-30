import nextPlugin from '@next/eslint-plugin-next'
import type { Linter } from 'eslint'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * Preset de l'application Next (`apps/web`).
 *
 * **Pourquoi pas `eslint-config-next`.** Le paquet agrégateur de Next 16 tire
 * `eslint-plugin-react@7.37.5`, qui appelle une API supprimée par ESLint 10 :
 * le lint s'interrompt sur `TypeError: contextOrFilename.getFilename is not a
 * function` dès le premier fichier de `apps/web`. Ses trois dépendances
 * fautives (`eslint-plugin-react`, `eslint-plugin-jsx-a11y`,
 * `eslint-plugin-import`) plafonnent leur `peerDependency` à ESLint 9. Restent
 * ici les deux plugins qui portent les règles propres au framework et qui
 * déclarent ESLint 10 : celles de Next et celles des hooks React.
 *
 * Les blocs sont **restreints** au périmètre passé en argument : les configs
 * publiées n'ont pas de `files`, et s'appliqueraient donc à `packages/db`
 * comme au reste du monorepo.
 */
export function nextConfig(files: string[]): Linter.Config[] {
  return [
    { ...nextPlugin.configs['core-web-vitals'], files } as Linter.Config,
    {
      files,
      rules: {
        // Règle du Pages Router : elle cherche un dossier `pages/` à la racine
        // du processus, n'en trouve pas dans un monorepo en App Router, et
        // écrit un avertissement à chaque exécution du lint.
        '@next/next/no-html-link-for-pages': 'off',
      },
    },
    { ...reactHooks.configs.flat['recommended-latest'], files } as Linter.Config,
  ]
}
