import { defineConfig, devices } from '@playwright/test'

import { BASE_URL, GOLDEN_PATH_DIRECTORY, webServerEnv } from './playwright.config'
import { recordedEventsDirectoryFor } from './scripts/golden-path-regime'

/**
 * **Le parcours doré** (s25) — une configuration à part, et c'est une décision.
 *
 * `pnpm test:e2e` ne le collecte pas : `playwright.config.ts` l'exclut par
 * `testIgnore`, et il n'est atteignable que par `pnpm test:golden-path`. La
 * raison est le coût — chaque story paierait sinon un clone, une installation
 * complète et une base neuve —, et l'intention de la story reste tenue parce
 * que **la CI, elle, le lance**.
 *
 * Ce que cette configuration change par rapport à la principale :
 *
 * | | `test:e2e` | parcours doré |
 * |---|---|---|
 * | parallélisme | complet | **un seul travailleur**, en série |
 * | base de données | celle du poste | **vierge**, créée par la commande |
 * | événements de paiement | simulés | selon le régime demandé (ADR 048) |
 * | délai | 120 s par cas | 300 s par cas, **et un budget par étape** |
 *
 * **Un seul travailleur, et en série** : les identités du parcours sont fixes
 * — c'est ainsi qu'une base non vierge se voit —, donc deux parcours en
 * parallèle se disputeraient le même compte. Et une mesure de durée sur des
 * parcours concurrents ne mesure que la contention de la machine.
 *
 * **Aucun seuil de trente minutes ici.** Le délai par cas borne un blocage ; la
 * promesse du PRD est une recette humaine, que `scripts/golden-path.ts`
 * journalise sans en juger.
 */
/**
 * **Le régime de paiement, posé sur le serveur** (ADR 048) — et il est posé
 * **toujours**, y compris vide.
 *
 * Unique lecture d'environnement de ce fichier, et elle ne décrit pas
 * l'application : c'est `scripts/golden-path.ts` qui pose la valeur, après
 * avoir vérifié que **tous** les enregistrements attendus sont là.
 *
 * **Elle est dérivée du régime demandé, jamais de la variable brute.**
 * Playwright ne remplace pas l'environnement du serveur, il le **fusionne** :
 * le processus démarré reçoit `{ ...process.env, ...webServer.env }` (mesuré,
 * `playwright/lib/runner/index.js`). Une variable omise ici n'est donc pas
 * absente du serveur — elle est celle de l'ambiance, et un
 * `PAYMENTS_RECORDED_EVENTS` resté dans un shell faisait rejouer des formes
 * enregistrées sous un régime annoncé `simulated`, sans que rien ne le dise :
 * les deux régimes se mélangeaient par héritage. Mesuré, cinq événements
 * `evt_rec_…` traités par une exécution `simulated`.
 *
 * `recordedEventsDirectoryFor` rend donc la chaîne vide sous tout régime autre
 * que `recorded`, et elle est posée quand même : vide vaut absente pour
 * `resolveBillingConfig`, qui repart sur les formes simulées.
 *
 * Ce fichier ne prouve rien à lui seul, et c'est le constat F1 de la revue :
 * ce que le serveur a réellement joué est vérifié **après coup**, sur les
 * identifiants d'événement écrits par la route de webhook
 * (`e2e/golden-path/golden-path.spec.ts`, `verifyEventIdMark`).
 */
const recordedEventsEnv = (): Record<string, string> => ({
  PAYMENTS_RECORDED_EVENTS: recordedEventsDirectoryFor(process.env),
})

export default defineConfig({
  testDir: GOLDEN_PATH_DIRECTORY,
  fullyParallel: false,
  workers: 1,
  // Le préambule est le même que celui des autres parcours : `next dev`
  // compile à la demande, et une mesure de durée qui l'ignorerait mesurerait la
  // compilation plutôt que le parcours.
  globalSetup: './e2e/support/warm-up.ts',
  reporter: 'list',
  // Même politique que la suite principale, et pour la même raison : une
  // reprise peint un parcours instable en jaune au lieu de le montrer.
  retries: 0,
  // Cinq minutes : la somme des budgets d'étape du parcours le plus long, plus
  // de la marge. Ce n'est pas le budget par étape — celui-ci nomme l'étape
  // dépassée, ce qu'un délai global ne peut pas faire.
  timeout: 300_000,
  use: {
    baseURL: BASE_URL,
    locale: 'fr-FR',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm --filter @repo/web exec next dev --port ${new URL(BASE_URL).port}`,
    // **Exactement l'environnement des autres parcours**, plus le régime de
    // paiement demandé. Il est partagé avec `playwright.config.ts` plutôt que
    // recopié : deux copies divergeraient au premier drapeau ajouté, et le
    // parcours doré mesurerait alors une application que personne d'autre
    // n'exécute.
    env: { ...webServerEnv(), ...recordedEventsEnv() },
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
