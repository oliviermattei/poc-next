/**
 * **Le délai par étape du parcours doré** (s25, critère 8) — et la mesure qui
 * va avec.
 *
 * Ce n'est pas le délai global de `playwright.config.ts`. La distinction est le
 * point : un parcours bloqué qui expire au bout de deux minutes apprend
 * seulement qu'il est bloqué. Le même parcours, borné étape par étape, dit
 * *où*. Sur un enchaînement de sept gestes — inscription, vérification,
 * organisation, souscription, droit d'accès — c'est la différence entre un
 * rapport exploitable et un rapport à rejouer à la main.
 *
 * **Aucun seuil commercial ici.** Le budget d'une étape borne un blocage ; il
 * ne juge pas la promesse des trente minutes du PRD, qui reste une recette
 * humaine. Un harnais qui rougirait à la trente-et-unième minute
 * transformerait une promesse de vente en régression de CI, sur une machine
 * dont personne ne contrôle la charge.
 *
 * Le fichier est **pur** — ni Playwright, ni réseau, ni horloge injectée
 * ailleurs qu'en paramètre — pour que `tests/golden-path.test.ts` l'éprouve
 * sans démarrer quoi que ce soit.
 */

export interface StepMeasurement {
  readonly name: string
  readonly durationMs: number
}

/**
 * Exécute une étape sous son propre budget, et enregistre sa durée.
 *
 * Le dépassement **nomme l'étape** : c'est la seule chose que le message doit
 * apporter par rapport à un délai global.
 *
 * La promesse de l'étape n'est pas annulée — rien ici ne sait comment
 * interrompre une navigation en cours. Ce que le budget garantit est que
 * l'échec est rendu, nommé, au bout du temps imparti ; Playwright ferme le
 * contexte derrière lui.
 */
export const measuredStep = async <T>(
  name: string,
  budgetMs: number,
  run: () => Promise<T>,
  measured: StepMeasurement[],
): Promise<T> => {
  const started = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const value = await Promise.race([
      run(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `Étape « ${name} » dépassée : plus de ${budgetMs} ms. ` +
                'Le parcours doré borne chaque étape séparément, pour dire où il bloque.',
            ),
          )
        }, budgetMs)
      }),
    ])

    measured.push({ name, durationMs: Date.now() - started })

    return value
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

/** La somme des étapes mesurées, en millisecondes. */
export const totalOf = (measured: readonly StepMeasurement[]): number =>
  measured.reduce((total, entry) => total + entry.durationMs, 0)

/** Une durée en millisecondes, écrite pour un journal humain. */
export const humanDuration = (milliseconds: number): string => {
  const seconds = Math.round(milliseconds / 1000)

  return seconds < 60
    ? `${seconds} s`
    : `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`
}
