import { defineConfig, devices } from '@playwright/test'

/**
 * Parcours navigateur. Deux exécuteurs, deux périmètres, aucun recouvrement :
 * Vitest pour les unités et le câblage (`pnpm test`), Playwright pour ce qui
 * exige une application réellement démarrée (`pnpm test:e2e`).
 *
 * `webServer` est ce qui donne sa valeur au test de démonstration : Playwright
 * démarre l'application et attend qu'elle réponde. Si `next.config.ts` refuse
 * une variable d'environnement malformée — c'est son rôle — le serveur meurt et
 * la suite échoue en le disant, au lieu de tester une application qui n'existe
 * pas.
 *
 * Aucune lecture de `process.env` ici : le point d'accès unique à
 * l'environnement est `@repo/config`, et rien de ce fichier n'a besoin de
 * distinguer la CI du poste de développement.
 */
const PORT = 3100
// `localhost` et non `127.0.0.1` : le serveur de développement de Next bloque
// les requêtes de ressources internes venant d'une origine qu'il ne reconnaît
// pas, et noie la sortie d'avertissements.
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  // Un parcours qui ne passe qu'au second essai est un parcours instable : une
  // seule reprise, pour absorber le démarrage, pas pour masquer un défaut.
  retries: 1,
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm --filter @repo/web exec next dev --port ${PORT}`,
    // L'authentification exige un secret de signature et l'URL publique de
    // l'application. Elles sont posées **ici**, et pas laissées au `.env` du
    // poste : les liens envoyés par email doivent pointer sur le serveur que
    // Playwright démarre, dont le port n'est pas celui du développement. Ce ne
    // sont pas des secrets — ce serveur est éphémère et local.
    env: {
      AUTH_SECRET: 'playwright-e2e-non-secret-0123456789abcdef',
      APP_URL: BASE_URL,
      EMAIL_LOCAL_CAPTURE: '1',
    },
    url: BASE_URL,
    // En local, un serveur déjà lancé est réutilisé ; en CI rien n'écoute, donc
    // Playwright le démarre.
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
