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

/**
 * **Le dossier du parcours doré** (s25), exclu de cette suite et servi par
 * `playwright.golden-path.config.ts`.
 *
 * Déclaré ici, et importé là-bas : deux écritures du même chemin
 * divergeraient, et la divergence rendrait le parcours doré **collecté deux
 * fois** — ou plus grave, collecté par `pnpm test:e2e`, qui n'a ni sa base
 * vierge ni son régime de paiement. Le coût de ce parcours est l'amorçage
 * complet d'un clone : chaque story le paierait.
 */
export const GOLDEN_PATH_DIRECTORY = './e2e/golden-path'

/**
 * **Le dossier de la recette du profil minimal** (s26), exclu de cette suite et
 * servi par `playwright.minimal-profile.config.ts`.
 *
 * Même raison que ci-dessus, plus une propre à s26 : ces parcours attendent des
 * modules **absents**, ce qui n'est vrai que dans le clone où le profil a été
 * appliqué. Collectés par `pnpm test:e2e`, ils échoueraient sur la
 * configuration livrée — ce qui est un rouge juste, mais sur la mauvaise
 * question.
 */
export const MINIMAL_PROFILE_DIRECTORY = './e2e/minimal-profile'

/**
 * **Où Playwright écrit les traces des parcours en échec** — son `outputDir`,
 * déclaré ici plutôt que laissé implicite.
 *
 * Il l'était, et le job de CI téléversait `playwright-report/` : un dossier que
 * cette suite ne produit pas (`reporter: 'list'`). L'étape ne trouvait donc
 * jamais rien, et `upload-artifact` qui ne trouve rien **ne rougit pas** — son
 * `if-no-files-found` vaut `warn` par défaut. Chaque échec de parcours en CI
 * depuis l'origine a produit un artefact vide et une étape verte.
 *
 * Déclaré une seule fois, et `tests/failure-traces.test.ts` vérifie que le
 * workflow téléverse **ce** chemin : recopier `test-results/` dans le job
 * corrigerait le symptôme et rouvrirait la dérive à la première story qui
 * changerait l'`outputDir`.
 *
 * Rien à voir avec `FAILURE_TRACES_DIRECTORY` du parcours doré
 * (`scripts/golden-path-regime.ts`), qui travaille dans un clone qu'il détruit
 * et doit donc **recopier** ses traces hors de ce dossier avant la suppression.
 * Le job principal tourne dans l'arbre : il n'a rien à recopier.
 */
export const TRACES_OUTPUT_DIRECTORY = 'test-results'

/**
 * **L'environnement du serveur des parcours**, partagé avec la configuration du
 * parcours doré.
 *
 * Partagé plutôt que recopié : une seconde copie divergerait au premier drapeau
 * ajouté, et le parcours doré mesurerait alors une application que personne
 * d'autre n'exécute — ce qui est exactement le contraire de ce qu'il promet de
 * mesurer.
 */
export const webServerEnv = (): Record<string, string> => ({
  // L'authentification exige un secret de signature et l'URL publique de
  // l'application. Elles sont posées **ici**, et pas laissées au `.env` du
  // poste : les liens envoyés par email doivent pointer sur le serveur que
  // Playwright démarre, dont le port n'est pas celui du développement. Ce ne
  // sont pas des secrets — ce serveur est éphémère et local.
  AUTH_SECRET: 'playwright-e2e-non-secret-0123456789abcdef',
  APP_URL: BASE_URL,
  EMAIL_LOCAL_CAPTURE: '1',
  // Le stockage sur disque, posé **ici** et pas laissé au `.env` du poste :
  // le module `storage` activé sans stockage refuse de démarrer, et le
  // harnais ne doit pas dépendre de ce qu'un développeur a dans son fichier.
  // Mesuré à la fusion de s18 — la suite passait sur le poste de la voie, dont
  // le `.env` portait la variable, et échouait sur un arbre qui ne l'avait pas.
  STORAGE_LOCAL_DIRECTORY: '.storage-e2e',
  // Monte `GET /api/i18n-probe` : une clé absente doit faire échouer la
  // requête, dans le vrai serveur. C'est la seule preuve que la configuration
  // qui refuse est encore branchée par `i18n/request.ts` — un test de nœud ne
  // voit que la configuration, pas son câblage.
  I18N_MISSING_KEY_PROBE: '1',
  // Monte le **fournisseur OAuth de développement** (s12) : c'est ce qui rend
  // le parcours de connexion externe exerçable sans aucune clé de fournisseur,
  // et c'est aussi la démonstration du mode local — un opt-in explicite, jamais
  // déduit de `NODE_ENV`. Aucun identifiant Google ou GitHub n'est posé ici :
  // les deux ensemble seraient refusés au démarrage.
  OAUTH_LOCAL_PROVIDER: '1',
  // Monte le **mode de paiement local** (s19), et c'est ce qui rend
  // `e2e/billing.spec.ts` exerçable : le checkout se termine sur une route
  // servie par l'application, qui fabrique et signe les événements que le
  // fournisseur enverrait. Sans ce drapeau, le serveur meurt après `✓ Ready` —
  // le module `billing` est activé, et l'application refuse de démarrer sans
  // avoir dit ce qu'elle fait de ses paiements.
  //
  // Posé **ici**, donc l'emportant sur le `.env` du poste : un poste muni d'une
  // vraie clé Stripe verra le démarrage refuser les deux ensemble en le disant,
  // plutôt que d'encaisser pendant un parcours.
  //
  // **Ce drapeau ne dit pas d'où viennent les formes d'événement** (s25,
  // ADR 048) : simulées par défaut, enregistrées quand
  // `playwright.golden-path.config.ts` ajoute `PAYMENTS_RECORDED_EVENTS`. Un
  // enregistrement absent fait alors échouer en le nommant, jamais de repli.
  PAYMENTS_LOCAL_MODE: '1',
  // **Et cette suite-ci n'en joue aucune d'enregistrée**, ce qui se pose plutôt
  // que se supposer : Playwright **fusionne** `process.env` dans
  // l'environnement du serveur, donc une variable simplement omise ici est
  // celle du shell ou du `.env` du poste. Mesuré en revue de s25 —
  // `PAYMENTS_RECORDED_EVENTS=<dossier> pnpm exec playwright test
  // e2e/billing.spec.ts` rendait treize parcours verts en ayant rejoué des
  // enregistrements, et onze événements `evt_rec_…` apparaissaient dans le
  // journal d'idempotence de la base du poste. La suite avait changé de source
  // sans le dire, c'est-à-dire mélangé les deux régimes (ADR 048).
  //
  // Vide vaut absente pour `resolveBillingConfig` : les formes simulées.
  // `playwright.golden-path.config.ts` écrase cette valeur par le dossier que
  // **son** régime demande.
  PAYMENTS_RECORDED_EVENTS: '',
  // Déclare les **deux scripts non essentiels de démonstration** (s36), un par
  // catégorie de consentement. Le dépôt n'en livre aucun — c'est s39 qui
  // apportera PostHog —, et un mécanisme de consentement sans rien à consentir
  // n'est éprouvable dans aucun navigateur : sans ce drapeau, il n'y aurait ni
  // bannière à refuser, ni script dont on puisse mesurer qu'il n'est **pas**
  // chargé.
  //
  // Conséquence assumée : la bannière est visible dans **tous** les parcours
  // tant que le consentement n'est pas donné — c'est la condition réelle d'un
  // déploiement muni d'un outil d'analyse.
  CONSENT_SCRIPT_PROBE: '1',
})

export default defineConfig({
  testDir: './e2e',
  // Le parcours doré et la recette du profil minimal vivent sous `e2e/`, mais
  // ils n'appartiennent pas à cette suite : chacun a sa propre configuration et
  // sa propre commande.
  testIgnore: ['**/golden-path/**', '**/minimal-profile/**'],
  outputDir: TRACES_OUTPUT_DIRECTORY,
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
    env: webServerEnv(),
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
