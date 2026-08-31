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
// Le port par défaut, et le moyen d'en changer. `E2E_PORT` est la seule lecture
// d'environnement de ce fichier, et elle ne décrit pas l'application : c'est
// l'adresse du serveur éphémère que Playwright démarre pour lui-même. Elle
// existe parce que plusieurs worktrees travaillent en parallèle sur cette
// machine, et que deux suites ne peuvent pas écouter le même port.
const PORT = Number(process.env.E2E_PORT ?? 3100)
// `localhost` et non `127.0.0.1` : le serveur de développement de Next bloque
// les requêtes de ressources internes venant d'une origine qu'il ne reconnaît
// pas, et noie la sortie d'avertissements.
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  // **Aucune reprise.** Un parcours qui ne passe qu'au second essai est un
  // parcours instable, et la reprise ne le disait pas : elle le peignait en
  // jaune. Mesuré en revue de s08 — le parcours qui envoyait un mot de passe
  // dans l'URL était rapporté « flaky » deux exécutions sur trois, et la story
  // a lu une instabilité de test là où il y avait une fuite de secret. Une
  // politique de reprise qui transforme un défaut reproductible en badge jaune
  // coûte plus qu'elle ne rend.
  //
  // Ce qui remplace la reprise : une attente d'actionnabilité côté application
  // (`apps/web/app/use-hydrated.ts` — le bouton d'envoi n'est actif qu'une fois
  // React aux commandes), une lecture de la boîte email ancrée dans le temps
  // (`e2e/support/account.ts`), et un `expect(...).toPass()` **écrit dans le
  // parcours** là où le geste est réellement rejouable, avec la raison à côté.
  retries: 0,
  use: {
    baseURL: BASE_URL,
    // **La langue du navigateur est fixée**, et ce n'est pas cosmétique : depuis
    // s09, l'application négocie la locale sur `Accept-Language`, et le défaut
    // de Chromium est l'anglais. Sans cette ligne, les parcours écrits en
    // français passeraient ou non selon la machine — exactement le genre
    // d'instabilité que `retries: 0` refuse de peindre en jaune. Le parcours qui
    // exerce l'anglais le demande explicitement, par son propre contexte.
    locale: 'fr-FR',
    // Sans reprise, « à la première reprise » ne se déclenche jamais : la trace
    // est gardée quand le parcours échoue, ce qui est le seul moment où elle
    // sert.
    trace: 'retain-on-failure',
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
      // Monte `GET /api/i18n-probe` : une clé absente doit faire échouer la
      // requête, dans le vrai serveur. C'est la seule preuve que la
      // configuration qui refuse est encore branchée par `i18n/request.ts` —
      // un test de nœud ne voit que la configuration, pas son câblage.
      I18N_MISSING_KEY_PROBE: '1',
    },
    url: BASE_URL,
    // **Jamais de réutilisation.** Un serveur déjà lancé sur ce port peut être
    // celui d'un autre worktree, donc d'une autre branche : la suite passait
    // alors au vert en interrogeant du code qui n'est pas le sien, sans que
    // rien ne le signale. Mesuré pendant la vague s10/s12 — 20 rouges parasites
    // dans un sens, et un faux vert possible dans l'autre. Playwright démarre
    // désormais son propre serveur, et échoue bruyamment si le port est pris ;
    // `E2E_PORT` sert alors à en choisir un autre. Un harnais qui ne distingue
    // pas « mon arbre est vert » de « j'ai mesuré autre chose » ne mesure rien.
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
