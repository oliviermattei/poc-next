/**
 * Tailwind v4 s'installe comme **plugin PostCSS**, et rien d'autre : pas de
 * `tailwind.config.js`, pas d'`autoprefixer` (le moteur v4 s'en charge). Ce
 * fichier est la seule pièce de configuration côté application ; les tokens
 * vivent dans `@repo/ui/styles.css`.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config
