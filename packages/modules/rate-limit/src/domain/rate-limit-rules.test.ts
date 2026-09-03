import { describe, expect, it } from 'vitest'

import {
  callerBucketKey,
  clientIdentifierOf,
  exceedsRateLimit,
  retryAfterSecondsOf,
  subjectBucketKey,
  subjectOfBody,
  subjectOfCookies,
  UNKNOWN_CLIENT,
  windowStartOf,
} from './rate-limit-rules'
import {
  assertCaptchaIsServable,
  assertPoliciesCoverRoutes,
  parseRateLimitPolicies,
} from './rate-limit-config'

describe('la fenêtre fixe', () => {
  it('est alignée sur sa durée, pas sur le premier appel', () => {
    // Deux instances démarrées à une seconde d'écart compteraient sinon dans
    // deux fenêtres décalées : le compteur « partagé » ne le serait plus.
    const first = windowStartOf(new Date('2026-09-03T10:00:07.000Z'), 60)
    const second = windowStartOf(new Date('2026-09-03T10:00:59.999Z'), 60)

    expect(first.toISOString()).toBe('2026-09-03T10:00:00.000Z')
    expect(second.toISOString()).toBe(first.toISOString())
  })

  it('change de fenêtre à la seconde exacte où la précédente se ferme', () => {
    expect(windowStartOf(new Date('2026-09-03T10:01:00.000Z'), 60).toISOString()).toBe(
      '2026-09-03T10:01:00.000Z',
    )
  })
})

describe('le Retry-After', () => {
  it('est le temps qui reste de la fenêtre réelle, pas une constante', () => {
    // Un `Retry-After` figé ment : le client honnête réessaie trop tôt, se fait
    // refuser une seconde fois, et paie d'avoir cru la réponse.
    const now = new Date('2026-09-03T10:00:45.000Z')

    expect(retryAfterSecondsOf(now, windowStartOf(now, 60), 60)).toBe(15)
  })

  it('ne descend jamais à zéro : « réessayez maintenant » relance le refus', () => {
    const now = new Date('2026-09-03T10:00:59.500Z')

    expect(retryAfterSecondsOf(now, windowStartOf(now, 60), 60)).toBe(1)
  })
})

describe('le verdict', () => {
  it('compte le passage en cours : le seuil atteint est encore permis', () => {
    expect(exceedsRateLimit(5, 5)).toBe(false)
    expect(exceedsRateLimit(6, 5)).toBe(true)
  })
})

describe('l’identifiant d’appelant', () => {
  it('retient le premier maillon de la chaîne, jamais le dernier relais', () => {
    // Prendre le dernier ferait tomber tous les visiteurs d'un même hébergeur
    // dans un seul seau.
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' })

    expect(clientIdentifierOf(headers)).toBe('203.0.113.7')
  })

  it('met tout le monde dans le même seau quand aucun en-tête ne dit rien', () => {
    // Le choix le plus strict, délibérément : un identifiant unique par requête
    // rendrait la limite inopérante là où on ne sait rien de l'appelant.
    expect(clientIdentifierOf(new Headers())).toBe(UNKNOWN_CLIENT)
  })
})

describe('les seaux', () => {
  it('sépare deux appelants sur la même route, et deux routes du même appelant', () => {
    expect(callerBucketKey('/auth/sign-in', '1.2.3.4')).not.toBe(
      callerBucketKey('/auth/sign-in', '5.6.7.8'),
    )
    expect(callerBucketKey('/auth/sign-in', '1.2.3.4')).not.toBe(
      callerBucketKey('/auth/sign-up', '1.2.3.4'),
    )
  })

  it('donne au même compte visé le même seau, quel que soit l’appelant', () => {
    // C'est **la** propriété qui arrête le bourrage distribué : dix mille
    // adresses, un essai chacune, tombent toutes dans ce seau-là.
    expect(
      subjectBucketKey('/auth/sign-in', subjectOfBody({ email: 'Victime@Example.test ' }, 'email') ?? ''),
    ).toBe(subjectBucketKey('/auth/sign-in', 'victime@example.test'))
  })

  it('ne normalise rien lui-même : il porte la valeur que le serveur lira', () => {
    /**
     * **Constat M1 de la troisième revue.** Deux normalisations coexistaient :
     * le lecteur rendait la sous-chaîne brute du cookie, et cette clé la mettait
     * en minuscules. Aucune des deux n'était celle de la bibliothèque, si bien
     * que le limiteur comptait une valeur que le serveur ne voyait jamais.
     *
     * La normalisation appartient désormais au **lecteur**, qui imite celui du
     * serveur ; cette fonction ne fait plus que composer. Le lui rendre
     * rouvrirait une troisième normalisation qui ne correspond à personne.
     */
    expect(subjectBucketKey('/r', 'AbC')).not.toBe(subjectBucketKey('/r', 'abc'))
  })

  it('ne confond jamais un seau d’appelant et un seau de compte', () => {
    expect(callerBucketKey('/auth/sign-in', 'x')).not.toBe(subjectBucketKey('/auth/sign-in', 'x'))
  })
})

describe('le compte visé, lu dans le corps', () => {
  it('le trouve en JSON comme en formulaire', () => {
    expect(subjectOfBody({ email: 'a@b.test' }, 'email')).toBe('a@b.test')
  })

  it('rend null quand le champ manque, est vide ou n’est pas une chaîne', () => {
    // `null` ne veut pas dire « pas de limite » : c'est l'appelant qui décide,
    // et le seau d'appelant reste. Une valeur inventée créerait un seau que
    // personne ne partage.
    expect(subjectOfBody({ email: '   ' }, 'email')).toBeNull()
    expect(subjectOfBody({ email: 42 }, 'email')).toBeNull()
    expect(subjectOfBody(null, 'email')).toBeNull()
  })

  it('compte une adresse inconnue comme une autre', () => {
    // Ne pas compter une adresse sans compte apprendrait à l'attaquant
    // lesquelles existent — l'énumération que `docs/security.md` §3 refuse.
    expect(subjectOfBody({ email: 'personne@nulle-part.test' }, 'email')).toBe(
      'personne@nulle-part.test',
    )
  })

  it('normalise l’adresse : ni la casse ni les espaces ne scindent le seau', () => {
    // La normalisation vit chez le **lecteur**, à côté de ce qu'il lit : sans
    // cela, `Victime@Example.test` et `victime@example.test` tomberaient dans
    // deux seaux, et la variation de casse suffirait à les multiplier.
    expect(subjectOfBody({ email: ' Victime@Example.test ' }, 'email')).toBe(
      'victime@example.test',
    )
  })
})

describe('le compte visé, lu dans un cookie', () => {
  /**
   * Le défi de double authentification n'a **pas** de session — c'est tout son
   * objet — et son corps ne porte qu'un code à six chiffres. Le seul identifiant
   * stable de la cible est le cookie de défi, que le serveur a signé et posé.
   *
   * **La lecture doit être par nom exact, et c'est tout l'enjeu** : l'en-tête
   * `Cookie` est écrit intégralement par l'appelant, et la bibliothèque
   * d'authentification lit **un** nom précis
   * (`ctx.getSignedCookie(createAuthCookie('two_factor').name)`). Une
   * correspondance par suffixe laissait poser un leurre en tête — la première
   * livraison de s28 comptait alors le leurre pendant que la bibliothèque
   * validait le vrai défi, et l'énumération des six chiffres redevenait
   * illimitée (constat C1 de la re-revue).
   */
  const NAMES = ['__Secure-better-auth.two_factor', 'better-auth.two_factor'] as const

  it('retient le cookie de défi quand un leurre est posé **en tête**', () => {
    // L'ordre exact que la re-revue a mesuré contre l'application démarrée.
    const found = subjectOfCookies(
      'two_factor=leurre-qui-tourne; __Secure-better-auth.two_factor=le-vrai-defi',
      NAMES,
    )

    expect(found).toEqual({ kind: 'found', value: 'le-vrai-defi' })
  })

  it('ignore tout nom qui n’est pas exactement l’un des noms déclarés', () => {
    expect(subjectOfCookies('two_factor=leurre', NAMES)).toEqual({ kind: 'absent' })
    expect(subjectOfCookies('x.two_factor=leurre', NAMES)).toEqual({ kind: 'absent' })
    expect(subjectOfCookies('better-auth.two_factor_autre=leurre', NAMES)).toEqual({
      kind: 'absent',
    })
  })

  it('refuse plutôt que de choisir quand deux noms déclarés sont présents', () => {
    /**
     * La bibliothèque n'en lit **qu'un**, et lequel dépend de la configuration
     * (`__Secure-` selon `useSecureCookies`). Deviner, c'est rouvrir le
     * contournement dans la moitié des déploiements ; un navigateur légitime
     * n'envoie jamais les deux.
     */
    expect(
      subjectOfCookies(
        'better-auth.two_factor=leurre; __Secure-better-auth.two_factor=le-vrai-defi',
        NAMES,
      ),
    ).toEqual({ kind: 'ambiguous' })
  })

  it('refuse aussi quand le même nom déclaré est envoyé deux fois', () => {
    // Deux occurrences du même nom : l'analyseur de la bibliothèque en retient
    // une, le nôtre pourrait retenir l'autre. La même faille, en plus discret.
    expect(
      subjectOfCookies(
        '__Secure-better-auth.two_factor=leurre; __Secure-better-auth.two_factor=le-vrai',
        NAMES,
      ),
    ).toEqual({ kind: 'ambiguous' })
  })

  /**
   * **Constat M1 de la troisième revue** : le nom lu était le bon, la valeur ne
   * l'était pas.
   *
   * Le chemin réel est `ctx.getSignedCookie(…)`
   * (`better-call@1.4.0/dist/context.mjs:38`) → `parsedCookies.get(nom)`, et
   * cette table vient de `better-call/dist/cookies.mjs:19-40` : la valeur est
   * **détrimée**, ses **guillemets encadrants retirés**, puis passée à
   * `tryDecode` (`dist/utils.mjs`), c'est-à-dire `decodeURIComponent` dès
   * qu'elle contient un `%`.
   *
   * Rendre la sous-chaîne brute laissait donc l'appelant — qui écrit l'en-tête
   * `Cookie` en entier — envoyer **le même défi** sous autant d'encodages qu'il
   * voulait, et scinder son propre seau à volonté. Mesuré par la revue contre
   * l'application démarrée : quinze encodages d'un même défi → 401×15, la même
   * valeur brute → 401×10 puis 429×5.
   */
  it('normalise la valeur exactement comme l’analyseur de la bibliothèque', () => {
    expect(subjectOfCookies('better-auth.two_factor=defi%2Davec%2Dtirets', NAMES)).toEqual({
      kind: 'found',
      value: 'defi-avec-tirets',
    })
    expect(subjectOfCookies('better-auth.two_factor="defi-entre-guillemets"', NAMES)).toEqual({
      kind: 'found',
      value: 'defi-entre-guillemets',
    })
  })

  it('met deux encodages du même défi dans le **même** seau', () => {
    // La propriété, dite au niveau où elle se lit : c'est la clé de seau qui
    // doit coïncider, pas seulement la valeur rendue.
    const bucketOf = (header: string): string => {
      const found = subjectOfCookies(header, NAMES)

      expect(found.kind).toBe('found')

      return subjectBucketKey(
        '/auth/two-factor/verify-totp',
        found.kind === 'found' ? found.value : '',
      )
    }

    expect(bucketOf('better-auth.two_factor=abc-def.sig')).toBe(
      bucketOf('better-auth.two_factor=abc%2Ddef.sig'),
    )
  })

  it('ne lève jamais sur une séquence percent malformée : elle vaut sa valeur brute', () => {
    /**
     * `decodeURIComponent('%zz')` lève, et l'en-tête est **choisi par
     * l'appelant** : lever ici transformerait une requête forgée en 500, sur le
     * chemin d'une route publique. La bibliothèque rattrape et garde la valeur
     * brute (`tryDecode`) ; compter la même chose qu'elle est le point.
     */
    expect(subjectOfCookies('better-auth.two_factor=defi%zz', NAMES)).toEqual({
      kind: 'found',
      value: 'defi%zz',
    })
  })

  it('rend « absent » quand l’en-tête est absent, vide, ou sans valeur', () => {
    expect(subjectOfCookies(null, NAMES)).toEqual({ kind: 'absent' })
    expect(subjectOfCookies('', NAMES)).toEqual({ kind: 'absent' })
    expect(subjectOfCookies('session=xyz', NAMES)).toEqual({ kind: 'absent' })
    expect(subjectOfCookies('better-auth.two_factor=', NAMES)).toEqual({ kind: 'absent' })
  })
})

describe('les seuils, lus de la configuration', () => {
  const sane = {
    default: { windowSeconds: 60, maxPerClient: 60, maxPerSubject: null },
    signIn: { windowSeconds: 300, maxPerClient: 10, maxPerSubject: 20 },
  }

  it('accepte une configuration saine et rend les politiques', () => {
    const parsed = parseRateLimitPolicies(sane)

    expect(parsed.signIn?.maxPerSubject).toBe(20)
  })

  it('refuse un seuil nul, et nomme la politique et le champ fautifs', () => {
    // Zéro ne veut **pas** dire « aucune limite » : c'est la lecture qui ferait
    // d'un fichier de configuration une porte de sortie (critère 8).
    expect(() =>
      parseRateLimitPolicies({ ...sane, signIn: { ...sane.signIn, maxPerClient: 0 } }),
    ).toThrow(/signIn.*maxPerClient/s)
  })

  it('refuse un seuil négatif et une fenêtre nulle', () => {
    expect(() =>
      parseRateLimitPolicies({ ...sane, signIn: { ...sane.signIn, maxPerSubject: -1 } }),
    ).toThrow(/signIn/)
    expect(() =>
      parseRateLimitPolicies({ ...sane, signIn: { ...sane.signIn, windowSeconds: 0 } }),
    ).toThrow(/signIn/)
  })

  it('exige la politique « default » : c’est le filet de toute route publique', () => {
    expect(() => parseRateLimitPolicies({ signIn: sane.signIn })).toThrow(/default/)
  })

  it('refuse une route qui nomme une politique inconnue, en nommant les deux', () => {
    // Symétrique d'`assertGatesCoverRoutes` (s21) : une route dont la politique
    // n'existe pas ne serait limitée par personne, et le démarrage doit le dire
    // plutôt que de la servir sans limite.
    expect(() =>
      assertPoliciesCoverRoutes({
        policies: parseRateLimitPolicies(sane),
        routes: [{ path: '/auth/sign-in/email', rateLimit: { policy: 'signInn' } }],
      }),
    ).toThrow(/\/auth\/sign-in\/email.*signInn|signInn.*\/auth\/sign-in\/email/s)
  })

  it('accepte une route dont la politique existe', () => {
    expect(() =>
      assertPoliciesCoverRoutes({
        policies: parseRateLimitPolicies(sane),
        routes: [{ path: '/auth/sign-in/email', rateLimit: { policy: 'signIn' } }],
      }),
    ).not.toThrow()
  })
})

describe('le captcha', () => {
  it('coupé, ne réclame aucune origine', () => {
    expect(() => assertCaptchaIsServable({ enabled: false, origin: null }, [])).not.toThrow()
  })

  it('activé sans origine déclarée dans la politique, refuse le démarrage', () => {
    // Un widget tiers bloqué par `default-src 'self'` fermerait le formulaire
    // sans un mot. Le refus est bruyant, et il nomme ce qui manque.
    expect(() =>
      assertCaptchaIsServable({ enabled: true, origin: 'https://captcha.test' }, []),
    ).toThrow(/captcha\.test/)
  })

  it('activé avec son origine déclarée, démarre', () => {
    expect(() =>
      assertCaptchaIsServable({ enabled: true, origin: 'https://captcha.test' }, [
        'https://captcha.test',
      ]),
    ).not.toThrow()
  })

  it('activé sans origine du tout, refuse aussi', () => {
    expect(() => assertCaptchaIsServable({ enabled: true, origin: null }, [])).toThrow(/origin/)
  })
})
