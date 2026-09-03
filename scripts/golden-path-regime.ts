import { RECORDED_EVENT_ID_PREFIX, SIMULATED_EVENT_ID_PREFIX } from '@repo/payments-testing'

import { humanDuration } from '../e2e/support/steps'

/**
 * **Les règles du parcours doré**, isolées de la commande qui les exécute
 * (s25) — même forme que `scripts/audit-exceptions.ts` face à
 * `scripts/audit.ts`, et pour la même raison : une règle enfermée dans un
 * script n'est éprouvable qu'en lançant le script, donc en pratique jamais.
 *
 * Trois règles vivent ici :
 *
 * 1. **le choix du régime de paiement**, qui porte l'interdit central de la
 *    story (ADR 048) ;
 * 2. **la préparation de l'amorçage** — le `.env` dérivé de l'exemple, et la
 *    base vierge ;
 * 3. **le journal des durées**, avec ce que la mesure exclut ;
 * 4. **la marque que le serveur doit avoir laissée** — le signal positif du
 *    constat F1 de la revue, sans lequel une exécution annoncée « enregistrée »
 *    pouvait être verte en ayant tourné sur le simulateur.
 */

/**
 * Les trois régimes, **explicites et exclusifs**.
 *
 * | Régime | Ce qu'il fait | Où |
 * |---|---|---|
 * | `recorded` | rejoue des formes **enregistrées** chez le fournisseur, aucun appel sortant | CI, et poste |
 * | `simulated` | rejoue les formes **écrites à la main** du simulateur | poste **seulement** |
 * | `live` | appelle les **clés de test** réelles, et **capture** les formes | poste, sur commande, jamais en CI |
 *
 * **`simulated` n'est pas un repli** : c'est un choix, et il faut l'écrire. Ce
 * qu'ADR 048 interdit est la substitution *silencieuse* d'un enregistrement
 * absent — ici, un enregistrement absent fait échouer le régime `recorded` en
 * le nommant, et personne ne bascule à sa place. Ce que ce fichier ajoute, pour
 * fermer la tentation là où elle coûterait le plus cher : **`simulated` est
 * refusé en CI**. Une CI verte sur des formes que nous avons écrites nous-mêmes
 * ne vérifie pas ce qu'elle prétend vérifier.
 */
export type GoldenPathRegime =
  | { readonly kind: 'recorded' }
  | { readonly kind: 'simulated' }
  /**
   * **Les variables du régime réel sont celles que la recette lit**, et pas
   * d'autres (constat F3 de la revue) : `packages/adapters/stripe/src/stripe-live.test.ts`
   * lit `STRIPE_SECRET_KEY` et `STRIPE_LIVE_PRICE_ID`. Le secret de webhook
   * était exigé et jamais lu, et l'offre était lue sans jamais être exigée :
   * poser exactement les deux variables réclamées échouait plus loin sur une
   * troisième — le mode de défaillance que le refus prétend éviter.
   */
  | { readonly kind: 'live'; readonly apiKey: string; readonly priceId: string }

/**
 * Ce que la règle lit de l'environnement — **cinq variables, nommées**.
 *
 * Un index libre (`Record<string, string | undefined>`) est admis pour que
 * `process.env` passe tel quel : la règle ne lit rien d'autre que ces
 * cinq-là, et l'énumération ci-dessus est ce qui le dit.
 */
export interface RegimeEnvironment {
  readonly GOLDEN_PATH_PAYMENTS?: string | undefined
  readonly CI?: string | undefined
  readonly STRIPE_SECRET_KEY?: string | undefined
  readonly STRIPE_LIVE_PRICE_ID?: string | undefined
  readonly PAYMENTS_RECORDED_EVENTS?: string | undefined
  readonly [other: string]: string | undefined
}

const KINDS = ['recorded', 'simulated', 'live'] as const

const declared = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()

  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/** Le régime demandé, ou un refus qui dit lequel poser et pourquoi. */
export const resolveGoldenPathRegime = (env: RegimeEnvironment): GoldenPathRegime => {
  const requested = declared(env.GOLDEN_PATH_PAYMENTS)
  const inCi = declared(env.CI) !== undefined
  const apiKey = declared(env.STRIPE_SECRET_KEY)
  const priceId = declared(env.STRIPE_LIVE_PRICE_ID)

  if (requested === undefined) {
    throw new Error(
      'GOLDEN_PATH_PAYMENTS n’est pas posé : le parcours doré ne devine pas son régime de ' +
        `paiement. Choisissez-en un — ${KINDS.join(' | ')}. ` +
        '`recorded` rejoue les formes enregistrées (c’est le régime de la CI), `simulated` ' +
        'joue le simulateur sur un poste, `live` appelle les clés de test réelles et capture ' +
        'les enregistrements.',
    )
  }

  if (!KINDS.includes(requested as (typeof KINDS)[number])) {
    throw new Error(
      `GOLDEN_PATH_PAYMENTS=${requested} n’est pas un régime connu (${KINDS.join(' | ')}).`,
    )
  }

  if (requested === 'simulated') {
    if (inCi) {
      throw new Error(
        'GOLDEN_PATH_PAYMENTS=simulated est refusé en CI : le simulateur produit des formes que ' +
          '**nous** avons écrites, il ne peut donc pas détecter sa propre dérive. Une CI verte ' +
          'sur ces formes-là aurait cessé de vérifier ce qu’elle prétend vérifier (ADR 048). ' +
          'La CI joue `recorded` ; capturez les enregistrements avec ' +
          'GOLDEN_PATH_PAYMENTS=live.',
      )
    }

    return { kind: 'simulated' }
  }

  if (requested === 'recorded') {
    // **Les deux régimes ne se mélangent jamais** — la story le nomme comme
    // « la source d'échecs intermittents la plus classique sur ce type de
    // harnais ». Une clé posée à côté du rejeu ne serait pas utilisée, et
    // personne ne saurait laquelle des deux a répondu.
    if (apiKey !== undefined) {
      throw new Error(
        'STRIPE_SECRET_KEY est posée avec GOLDEN_PATH_PAYMENTS=recorded : le rejeu enregistré ' +
          'n’appelle aucun service, et les deux régimes ne se mélangent jamais. Retirez la clé, ' +
          'ou demandez GOLDEN_PATH_PAYMENTS=live.',
      )
    }

    return { kind: 'recorded' }
  }

  if (inCi) {
    throw new Error(
      'GOLDEN_PATH_PAYMENTS=live est refusé en CI : le régime réel dépend d’un tiers et d’un ' +
        'secret, et il ferait échouer la CI pour des raisons étrangères au code. C’est une ' +
        'recette de poste, à jouer avant chaque ship.',
    )
  }

  if (apiKey === undefined || priceId === undefined) {
    throw new Error(
      'GOLDEN_PATH_PAYMENTS=live exige STRIPE_SECRET_KEY et STRIPE_LIVE_PRICE_ID — les deux ' +
        'variables que la recette lit réellement (`packages/adapters/stripe/src/stripe-live.test.ts`). ' +
        'Sans elles, l’échec viendrait du fournisseur et on croirait à une panne de Stripe. Le ' +
        'secret de webhook n’est pas demandé ici : c’est `stripe listen` qui l’imprime, pour le ' +
        'processus qui reçoit les événements, et cette commande n’en reçoit aucun.',
    )
  }

  if (!apiKey.startsWith('sk_test_')) {
    throw new Error(
      'STRIPE_SECRET_KEY n’est pas une clé de test : cette recette ne touche que le mode test ' +
        '(sk_test_…). Aucun paiement réel ne doit pouvoir être encaissé par un harnais.',
    )
  }

  return { kind: 'live', apiKey, priceId }
}

/**
 * **Le dossier d'enregistrements que le serveur doit recevoir**, selon le
 * régime **demandé** — et la chaîne vide sous tout autre régime.
 *
 * Playwright ne remplace pas l'environnement du serveur, il le **fusionne** :
 * `{ ...process.env, ...webServer.env }` (mesuré,
 * `playwright/lib/runner/index.js`). Lire `PAYMENTS_RECORDED_EVENTS` sans
 * regarder le régime revenait donc à laisser **l'ambiance** décider : un
 * dossier resté dans un shell faisait rejouer des enregistrements sous un
 * régime annoncé `simulated`, et les deux régimes se mélangeaient par héritage.
 * Mesuré : cinq événements `evt_rec_…` traités par une exécution qui annonçait
 * `simulated`.
 *
 * La chaîne vide vaut absence pour `resolveBillingConfig`, qui repart alors sur
 * les formes simulées. Ce qui a **réellement** été joué reste vérifié après
 * coup, par `verifyEventIdMark` : ce fichier décide, il ne prouve pas.
 */
export const recordedEventsDirectoryFor = (env: RegimeEnvironment): string =>
  declared(env.GOLDEN_PATH_PAYMENTS) === 'recorded'
    ? (declared(env.PAYMENTS_RECORDED_EVENTS) ?? '')
    : ''

/**
 * **La marque que les événements traités doivent porter**, selon le régime
 * demandé (constat F1 de la revue de s25).
 *
 * Le régime réel n'en a pas, et le refus le dit plutôt que de l'inventer :
 * **`live` n'exécute pas le scénario** — il éprouve les clés et capture des
 * formes, il ne clone rien, ne crée aucune base et n'ouvre aucun navigateur.
 */
export const expectedEventIdPrefix = (regime: GoldenPathRegime): string => {
  if (regime.kind === 'recorded') {
    return RECORDED_EVENT_ID_PREFIX
  }

  if (regime.kind === 'simulated') {
    return SIMULATED_EVENT_ID_PREFIX
  }

  throw new Error(
    'Le régime live n’exécute pas le scénario du parcours doré : il éprouve les clés de test et ' +
      'capture les formes d’événement. Il n’y a donc aucun événement de parcours à marquer.',
  )
}

/**
 * **Le filet du constat F1** : ce que la commande a demandé doit se lire dans ce
 * que le serveur a réellement traité.
 *
 * La chaîne « régime → variable transmise au serveur → source d'événements »
 * n'était gardée à aucune extrémité. Mesuré par la revue : la transmission
 * retirée de `playwright.golden-path.config.ts`, une exécution annonçant
 * « recorded » tournait sur le simulateur — trois parcours verts, sortie 0,
 * 1 790 tests verts. C'est la règle que le socle applique aux ports : « un port
 * qui retombe silencieusement sur un remplaçant local ne peut plus distinguer
 * un envoi réel d'un envoi capturé ».
 *
 * Les identifiants viennent du journal d'idempotence du module de facturation
 * (`billing_webhook_event`), c'est-à-dire de ce que la **vraie** route de
 * webhook a écrit. Une liste vide est un refus, et pas un succès : « aucun
 * événement » ne prouve pas le rejeu, il prouve qu'aucun paiement n'a abouti.
 */
export const verifyEventIdMark = (
  regime: GoldenPathRegime,
  eventIds: readonly string[],
): void => {
  const expected = expectedEventIdPrefix(regime)

  if (eventIds.length === 0) {
    throw new Error(
      `Régime ${regime.kind} : aucun événement de paiement n’a été traité par la route de ` +
        'webhook. Le parcours doré exige un signal **positif** — un paiement qui n’écrit rien ne ' +
        'prouve pas qu’il a été rejoué, il prouve qu’il n’a pas eu lieu.',
    )
  }

  const foreign = eventIds.filter((id) => !id.startsWith(expected))

  if (foreign.length > 0) {
    throw new Error(
      `Régime ${regime.kind} demandé, mais ${foreign.length} événement(s) traité(s) ne portent ` +
        `pas la marque « ${expected} » : ${foreign.join(', ')}. Le serveur n’a donc pas joué la ` +
        'source demandée — vérifiez que le régime lui est bien transmis ' +
        '(`PAYMENTS_RECORDED_EVENTS` dans `playwright.golden-path.config.ts`). Une exécution qui ' +
        'annonce un régime et en joue un autre est exactement le repli silencieux qu’ADR 048 ' +
        'interdit.',
    )
  }
}

/**
 * Le `.env` de l'amorçage : **celui de l'exemple**, sa seule base de données
 * remplacée.
 *
 * C'est le geste du critère 4 — « configuration de `.env` depuis l'exemple » —
 * et la promesse qu'il éprouve : un clone doit démarrer sur ce fichier, sans
 * qu'on y touche. La seule chose que la mesure impose est l'**isolation** de la
 * base, sans laquelle deux exécutions se marcheraient dessus (critère 2).
 *
 * Un exemple sans `DATABASE_URL` **fait échouer** : l'amorçage n'invente pas
 * une variable que le fichier livré ne porte pas, il constate que la promesse a
 * cessé d'être vraie.
 */
export const bootstrapEnvFile = (example: string, databaseUrl: string): string => {
  const lines = example.split('\n')
  let replaced = false

  const written = lines.map((line) => {
    if (!/^\s*DATABASE_URL\s*=/.test(line)) {
      return line
    }

    replaced = true

    return `DATABASE_URL=${databaseUrl}`
  })

  if (!replaced) {
    throw new Error(
      '`.env.example` ne déclare aucune DATABASE_URL : l’amorçage du parcours doré ne peut pas ' +
        'poser une base vierge sur un fichier qui n’en parle pas. La promesse « copiez ' +
        '`.env.example` en `.env` » a cessé d’être vraie.',
    )
  }

  return written.join('\n')
}

/** La même adresse de serveur, une autre base : l'isolation ne déménage pas Postgres. */
export const freshDatabaseUrl = (databaseUrl: string, name: string): string => {
  const url = new URL(databaseUrl)

  url.pathname = `/${name}`

  return url.toString()
}

/**
 * **Où les traces d'un parcours en échec sont conservées**, et pourquoi pas
 * sous `test-results/`.
 *
 * Playwright écrit ses traces dans le clone temporaire, que la commande
 * détruit : elle les recopie donc ici avant de le supprimer (constat F8 de la
 * première revue). Mais `test-results/` est l'`outputDir` par défaut de
 * Playwright, **effacé au démarrage** de `pnpm test:e2e` : une trace conservée
 * là et balayée par la suite suivante ne se distingue pas d'une trace jamais
 * écrite.
 *
 * Déclaré ici plutôt que dans la commande : le job de CI téléverse ce chemin,
 * et `tests/golden-path.test.ts` vérifie qu'ils désignent le même dossier —
 * deux écritures divergentes redonneraient exactement le défaut F8, un
 * téléversement qui pointe sur un dossier inexistant.
 */
export const FAILURE_TRACES_DIRECTORY = 'test-results-parcours-dore'

export interface Durations {
  readonly bootstrapMs: number
  readonly journeyMs: number
}

/**
 * **Les trois durées, et ce que la mesure exclut** (critères 4 et 5).
 *
 * La ligne de conditions est aussi importante que les chiffres : un nombre sans
 * ses conditions est une publicité, pas une mesure. Elle est écrite **à côté**
 * du total, jamais dans un fichier séparé que personne ne lira.
 *
 * Le repère des trente minutes du PRD est **cité, pas appliqué** : le harnais
 * mesure, le seuil est une recette humaine. Un rouge à la trente-et-unième
 * minute transformerait une promesse de vente en régression de CI.
 *
 * Aucun secret n'entre ici, y compris sous le régime réel : les durées se
 * journalisent, les clés non.
 */
export const durationsReport = (durations: Durations): string =>
  [
    'Parcours doré — durées mesurées',
    `  amorçage (clone, .env, install, migrate, seed) : ${humanDuration(durations.bootstrapMs)}`,
    `  parcours applicatif (navigateur)               : ${humanDuration(durations.journeyMs)}`,
    `  total « clone → premier paiement »             : ${humanDuration(
      durations.bootstrapMs + durations.journeyMs,
    )}`,
    '  repère du PRD : 30 min — recette humaine, ce harnais mesure et ne juge pas.',
    '',
    'Ce que la mesure exclut, écrit à côté du chiffre :',
    '  — le cache pnpm chaud n’est pas rechargé : c’est la situation d’un acheteur qui a',
    '    déjà utilisé pnpm, et un cache pnpm froid mesurerait sa bande passante, pas ce dépôt ;',
    '  — le téléchargement du navigateur de Playwright (`playwright install`) n’est pas',
    '    compté : il est déjà en cache, et il ne se refait pas par projet ;',
    '  — le serveur PostgreSQL est déjà démarré ; seule la **base** est créée par la mesure ;',
    '  — la lecture de ce dépôt se fait par un `git clone` local, sans réseau.',
  ].join('\n')
