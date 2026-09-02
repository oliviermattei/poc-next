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
export const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // **Le serveur répond avant d'être compilé.** `webServer.url` ci-dessous
  // n'atteste que d'un port qui écoute ; `next dev` compile chaque route à sa
  // première requête, et sur deux cœurs cette compilation dépasse les 5 000 ms
  // du délai par défaut de `expect`. Le préambule paie cette facture une fois,
  // hors de toute assertion — le détail mesuré est dans le fichier.
  globalSetup: './e2e/support/warm-up.ts',
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
      // Le stockage sur disque, posé **ici** et pas laissé au `.env` du poste :
      // le module `storage` activé sans stockage refuse de démarrer, et le
      // harnais ne doit pas dépendre de ce qu'un développeur a dans son
      // fichier. Mesuré à la fusion de s18 — la suite passait sur le poste de
      // la voie, dont le `.env` portait la variable, et échouait sur un arbre
      // qui ne l'avait pas.
      STORAGE_LOCAL_DIRECTORY: '.storage-e2e',
      // Monte `GET /api/i18n-probe` : une clé absente doit faire échouer la
      // requête, dans le vrai serveur. C'est la seule preuve que la
      // configuration qui refuse est encore branchée par `i18n/request.ts` —
      // un test de nœud ne voit que la configuration, pas son câblage.
      I18N_MISSING_KEY_PROBE: '1',
      // Monte le **fournisseur OAuth de développement** (s12) : c'est ce qui
      // rend le parcours de connexion externe exerçable sans aucune clé de
      // fournisseur, et c'est aussi la démonstration du mode local — un opt-in
      // explicite, jamais déduit de `NODE_ENV`. Aucun identifiant Google ou
      // GitHub n'est posé ici : les deux ensemble seraient refusés au
      // démarrage.
      OAUTH_LOCAL_PROVIDER: '1',
      // Monte le **mode de paiement local** (s19), et c'est ce qui rend
      // `e2e/billing.spec.ts` exerçable : le checkout se termine sur une route
      // servie par l'application, qui fabrique et signe les événements que le
      // fournisseur enverrait. Sans ce drapeau, le serveur meurt après
      // `✓ Ready` — le module `billing` est activé, et l'application refuse de
      // démarrer sans avoir dit ce qu'elle fait de ses paiements.
      //
      // Posé **ici**, donc l'emportant sur le `.env` du poste : un poste muni
      // d'une vraie clé Stripe verra le démarrage refuser les deux ensemble en
      // le disant, plutôt que d'encaisser pendant un parcours. Ces parcours-là
      // ne sauraient de toute façon pas se dérouler contre un vrai
      // fournisseur.
      PAYMENTS_LOCAL_MODE: '1',
      // Déclare les **deux scripts non essentiels de démonstration** (s36), un
      // par catégorie de consentement. Le dépôt n'en livre aucun — c'est s39
      // qui apportera PostHog —, et un mécanisme de consentement sans rien à
      // consentir n'est éprouvable dans aucun navigateur : sans ce drapeau, il
      // n'y aurait ni bannière à refuser, ni script dont on puisse mesurer
      // qu'il n'est **pas** chargé.
      //
      // Posé **ici** et pas laissé au `.env` du poste, pour la raison mesurée à
      // la fusion de s18 : une suite qui passe grâce au fichier d'une machine
      // ne prouve rien. Conséquence assumée : la bannière est visible dans
      // **tous** les parcours tant que le consentement n'est pas donné — c'est
      // la condition réelle d'un déploiement muni d'un outil d'analyse.
      CONSENT_SCRIPT_PROBE: '1',
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
