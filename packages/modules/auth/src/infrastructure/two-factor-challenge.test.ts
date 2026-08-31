import { twoFactor } from 'better-auth/plugins/two-factor'
import { describe, expect, it } from 'vitest'

import {
  TWO_FACTOR_CHALLENGE_EXEMPT_PATHS,
  withTwoFactorOnEverySignIn,
} from './two-factor-challenge'

/**
 * **La garde qui décide, et pas la liste qui l'alimentait.**
 *
 * La propriété « aucune session sur un compte protégé tant que le second
 * facteur n'a pas été présenté » a tenu, un temps, sur une liste de chemins à
 * *ajouter* au `matcher` du greffon. Une liste d'inclusions échoue **ouvert** :
 * rien ne rougissait quand une quatrième voie de connexion apparaissait, et
 * s14 en livre une (`/passkey/verify-authentication`). Ce fichier mesure la
 * forme inverse — le crochet vaut partout, sauf sur les chemins **exemptés**.
 *
 * Ce qui rougit ici, et c'est tout ce qu'on lui demande : quelqu'un qui rend
 * au `matcher` une liste d'inclusions, ou qui exempte une voie de connexion.
 */
const hooks = (() => {
  const wrapped = withTwoFactorOnEverySignIn(twoFactor({}), { onChallenge: () => {} })

  return wrapped.hooks?.after ?? []
})()

type HookContext = Parameters<(typeof hooks)[number]['matcher']>[0]

/** Le crochet du greffon s'appliquerait-il à ce chemin ? */
const isChallenged = (path: string): boolean =>
  hooks.some((hook) => hook.matcher({ path } as unknown as HookContext))

describe('le défi de second facteur couvre toute voie qui ouvre une session', () => {
  it('vaut sur une route de connexion que personne n’a encore écrite', () => {
    expect(hooks).toHaveLength(1)

    // La route fictive : elle n'est citée nulle part dans le module, et c'est
    // exactement son intérêt. Une garde qui ne la couvre pas est une garde
    // qu'il faut penser à mettre à jour — donc une garde qui sera oubliée.
    expect(isChallenged('/canari/sign-in')).toBe(true)

    // Les voies d'aujourd'hui, et celle que s14 monte.
    expect(isChallenged('/sign-in/email')).toBe(true)
    expect(isChallenged('/magic-link/verify')).toBe(true)
    expect(isChallenged('/callback/:id')).toBe(true)
    expect(isChallenged('/passkey/verify-authentication')).toBe(true)
  })

  it('laisse passer les seuls chemins exemptés, chacun nommé', () => {
    for (const path of Object.keys(TWO_FACTOR_CHALLENGE_EXEMPT_PATHS)) {
      expect(isChallenged(path)).toBe(false)
    }

    // Une exemption est une **décision écrite**, pas un effet de bord : chacune
    // porte la raison pour laquelle ce chemin a le droit de poser une session
    // sans défi.
    for (const reason of Object.values(TWO_FACTOR_CHALLENGE_EXEMPT_PATHS)) {
      expect(reason.length).toBeGreaterThan(0)
    }
  })
})
