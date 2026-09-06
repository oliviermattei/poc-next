import { createRequire } from 'node:module'

import { hiddenFilePath, hideFileFromReads, type FileReader } from './sans-env-rules'

/**
 * **Le préambule du régime sans `.env`** (s55), chargé par
 * `vitest.sans-env.config.ts` avant chaque fichier de test.
 *
 * Il retire un seul fichier de ce que le processus peut lire : le `.env` de la
 * racine, celui que `loadRootEnv()` va chercher sur le disque quoi que dise
 * l'environnement (P25bis). Tout le reste — répertoire courant, résolution de
 * modules, chemins — est celui de `pnpm test`, et c'est ce qui fait qu'un
 * fichier correct ne rougit pas ici : les deux régimes rendent les mêmes comptes
 * de cas passés et sautés, que chaque exécution journalise plutôt qu'un nombre
 * écrit ici (cf. `scripts/sans-env-rules.ts`).
 *
 * Qu'il soit **en vigueur** n'est pas supposé : `tests/sans-env.test.ts` porte un
 * cas canari qui vérifie que le fichier est bien illisible, et la commande refuse
 * un rapport où ce cas n'a pas tourné (`assertCanaryRan`).
 *
 * `createRequire` plutôt qu'un `import` : c'est l'objet `module.exports` du
 * module natif qu'il faut modifier — celui que `dotenv`, chargé en CommonJS,
 * appelle — et non l'espace de noms figé qu'un `import` en rendrait.
 */
const require = createRequire(import.meta.url)

hideFileFromReads(require('node:fs') as FileReader, hiddenFilePath(process.env))
