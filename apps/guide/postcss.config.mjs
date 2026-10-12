/**
 * Tailwind v4 s'installe comme **plugin PostCSS**, et rien d'autre : pas de
 * `tailwind.config.js`. Les couleurs du Guide sont celles du thème de
 * Fumadocs, importé dans `app/global.css` — jamais les jetons de `@repo/ui`,
 * que le Guide n'importe pas (ADR 083).
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config
