import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { BASE_URL } from '../../playwright.config'

/**
 * Compile l'application **avant** que le premier parcours n'assertionne quoi
 * que ce soit.
 *
 * Le défaut que ce fichier ferme, mesuré et non supposé : `next dev` compile à
 * la demande, et la **première** requête d'une route paie la compilation. Le
 * geste n'est pas lent ; la compilation l'est. Mesuré dans un conteneur Linux
 * borné à deux cœurs, contre la même base et le même arbre, six inscriptions
 * d'affilée :
 *
 * | geste        | cache vide | cache chaud |
 * |--------------|------------|-------------|
 * | inscription  | 7 630 ms   | 350–480 ms  |
 * | vérification | 1 852 ms   | 210–260 ms  |
 * | connexion    |   631 ms   | 500–590 ms  |
 *
 * Un facteur vingt sur l'inscription, contre un délai d'assertion de 5 000 ms.
 * Sur huit cœurs la compilation tient dans ce délai et la suite est verte ; sur
 * deux, elle ne tient pas, et c'est l'assertion qui s'est trouvée toucher la
 * route en premier qui échoue. D'où le symptôme : vert sur le poste, rouge sur
 * le runner, et sur un ensemble de parcours qui changeait d'une exécution à
 * l'autre — mesuré à un travailleur, c'était trois fois de suite le premier
 * `signUp` de la suite (`app-shell.spec.ts:81`) ; poussé à quatre travailleurs
 * sur les deux mêmes cœurs, douze parcours, dont ceux que la CI a rapportés.
 *
 * La réparation n'allonge donc aucun délai et n'assouplit aucune assertion :
 * elle sort la compilation de la fenêtre d'assertion. Playwright démarre
 * `webServer` **avant** ce préambule, donc le serveur répond déjà — ce qui
 * manquait n'était pas qu'il écoute, c'est qu'il soit compilé. Le harnais
 * attendait la mauvaise chose.
 *
 * Les points d'entrée sont **dérivés de l'arborescence**, jamais recopiés :
 * une route ajoutée demain est réchauffée sans que personne y pense, et une
 * liste écrite à la main aurait gardé le défaut pour la route oubliée.
 */

const APP_DIRECTORY = fileURLToPath(new URL('../../apps/web/app', import.meta.url))

/** Ce qu'un segment dynamique vaut pendant le réchauffage : la valeur importe peu, la compilation non. */
const PLACEHOLDER = 'warm-up'

const ENTRY_FILES = ['page.tsx', 'route.ts']

/**
 * Le nom d'un dossier de l'`app` router, traduit en segment d'URL demandable.
 *
 * Un segment dynamique devient une valeur quelconque — ce qui compte est que la
 * route soit atteinte, pas ce qu'elle répond. Les formes que cette traduction
 * ne sait pas rendre (groupe de routes, route parallèle, interception) **font
 * échouer le préambule** au lieu de produire une URL que le routeur n'atteindra
 * pas : une entrée silencieusement non réchauffée est exactement le défaut que
 * ce fichier ferme, et elle reviendrait sans que rien ne le dise. Le dépôt n'en
 * porte aucune à ce jour, sur les 21 dossiers d'entrée balayés.
 */
export const urlSegment = (name: string): string => {
  if (/^\[.+\]$/.test(name)) {
    return PLACEHOLDER
  }

  if (/^[(@]/.test(name)) {
    throw new Error(
      `Le préambule des parcours ne sait pas traduire le segment « ${name} » en URL : ` +
        'groupe de routes, route parallèle ou interception. Traduisez-le ici, ' +
        'sans quoi cette entrée ne serait jamais compilée avant les assertions.',
    )
  }

  return name
}

const collect = async (directory: string, segments: readonly string[]): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const found: string[] = []

  if (entries.some((entry) => entry.isFile() && ENTRY_FILES.includes(entry.name))) {
    found.push(`/${segments.join('/')}`)
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    found.push(
      ...(await collect(`${directory}/${entry.name}`, [...segments, urlSegment(entry.name)])),
    )
  }

  return found
}

/**
 * Toutes les entrées de l'`app` router, plus une URL inconnue — l'écran 404 est
 * un point d'entrée que `security-headers.spec.ts` exerce, et il se compile
 * comme les autres.
 */
export const warmUpTargets = async (): Promise<readonly string[]> => [
  ...new Set([...(await collect(APP_DIRECTORY, [])), `/${PLACEHOLDER}-url-inconnue`]),
]

const request = async (path: string): Promise<void> => {
  // Le statut ne dit rien d'utile ici : 404, 401 ou 500 signifient tous
  // « compilée ». Seule une requête qui n'aboutit pas est un vrai constat, et
  // elle doit faire échouer la suite plutôt que la laisser mesurer un serveur
  // à moitié levé.
  await fetch(`${BASE_URL}${path}`, { redirect: 'follow' })
}

const globalSetup = async (): Promise<void> => {
  const targets = await warmUpTargets()
  const started = Date.now()

  // Quatre à la fois : le runner a deux cœurs, et une file strictement
  // séquentielle laisserait le compilateur attendre le réseau.
  const queue = [...targets]
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
        await request(path)
      }
    }),
  )

  console.log(
    `Application compilée avant les parcours : ${targets.length} points d’entrée en ${Date.now() - started} ms.`,
  )
}

export default globalSetup
