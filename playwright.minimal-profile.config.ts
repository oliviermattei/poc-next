import { defineConfig, devices } from '@playwright/test'

import { BASE_URL, MINIMAL_PROFILE_DIRECTORY, webServerEnv } from './playwright.config'

/**
 * **La recette du profil minimal** (s26) — une configuration à part, comme le
 * parcours doré de s25, et pour la même raison.
 *
 * `pnpm test:e2e` ne la collecte pas (`testIgnore` de `playwright.config.ts`) :
 * ces parcours n'ont de sens que dans le **clone** où le profil a été appliqué,
 * et joués sur la configuration livrée ils échoueraient — les modules qu'ils
 * attendent absents y sont montés.
 *
 * Ce qui change par rapport à la configuration principale :
 *
 * | | `test:e2e` | profil minimal |
 * |---|---|---|
 * | configuration des modules | celle du dépôt | celle du **profil**, appliquée dans une copie |
 * | base de données | celle du poste | **vierge**, créée par la commande |
 * | parallélisme | complet | un seul travailleur, en série |
 *
 * **Un seul travailleur** : la recette journalise des comptes, et des parcours
 * concurrents sur la même base rendraient ces nombres dépendants de la
 * contention de la machine.
 *
 * L'environnement du serveur est **exactement celui des autres parcours** —
 * `webServerEnv()`, partagé plutôt que recopié : deux copies divergeraient au
 * premier drapeau ajouté, et la recette mesurerait alors une application que
 * personne d'autre n'exécute. Le profil ne change pas l'environnement, il
 * change la **configuration des modules**, qui est un fichier du dépôt.
 */
export default defineConfig({
  testDir: MINIMAL_PROFILE_DIRECTORY,
  fullyParallel: false,
  workers: 1,
  // Même préambule que les autres parcours : `next dev` compile à la demande,
  // et la première requête d'une route paierait sa compilation dans une
  // assertion.
  globalSetup: './e2e/support/warm-up.ts',
  reporter: 'list',
  // Aucune reprise, comme partout : une reprise peint un parcours instable en
  // jaune au lieu de le montrer.
  retries: 0,
  timeout: 120_000,
  use: {
    baseURL: BASE_URL,
    locale: 'fr-FR',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm --filter @repo/web exec next dev --port ${new URL(BASE_URL).port}`,
    env: webServerEnv(),
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
