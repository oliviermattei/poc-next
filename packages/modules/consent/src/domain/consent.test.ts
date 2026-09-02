import { describe, expect, it } from 'vitest'

import {
  decideFrom,
  resolveConsentState,
  statusOf,
  type NonEssentialScript,
} from './consent-category'
import {
  CONSENT_COOKIE,
  consentSetCookie,
  decodeConsentCookie,
  encodeConsentCookie,
} from './consent-cookie'
import { isSameSiteSubmission, safeReturnPath } from './request-guard'

/**
 * Les règles du consentement, éprouvées **là où elles vivent**.
 *
 * Tout ce fichier est pur : aucune requête, aucun rendu, aucune base. Ce qui
 * traverse les packages — la route, le point de composition, les deux points
 * d'accès — est éprouvé dans `tests/consent.test.ts`, et une seule fois.
 */

const ANALYTICS: NonEssentialScript = {
  id: 'demo-analytics',
  category: 'analytics',
  src: '/api/consent-probe/demo-analytics',
}

const ADVERTISING: NonEssentialScript = {
  id: 'demo-advertising',
  category: 'advertising',
  src: '/api/consent-probe/demo-advertising',
}

const BOTH = [ANALYTICS, ADVERTISING] as const

describe('ce qu’un script non essentiel obtient', () => {
  it('n’est chargé que si **sa** catégorie est accordée', () => {
    const state = resolveConsentState(BOTH, { analytics: true, advertising: false })

    expect(state.allowedScripts).toEqual([ANALYTICS])
  })

  it('n’est pas chargé tant que rien n’a été décidé', () => {
    // Le piège nommé par la story : le consentement conditionne le
    // **chargement**, pas seulement l'envoi d'événements. Rien avant le choix.
    const state = resolveConsentState(BOTH, {})

    expect(state.allowedScripts).toEqual([])
    expect(state.undecided).toEqual(['analytics', 'advertising'])
  })

  it('n’est pas chargé après un refus, et la bannière ne revient pas', () => {
    const state = resolveConsentState(BOTH, { analytics: false, advertising: false })

    expect(state.allowedScripts).toEqual([])
    expect(state.bannerRequired).toBe(false)
  })
})

describe('la bannière', () => {
  it('n’existe pas quand aucun script non essentiel n’est déclaré', () => {
    // Critère 7 : le module est **inerte par construction**, pas éteint par un
    // booléen. C'est l'état livré du boilerplate.
    const state = resolveConsentState([], {})

    expect(state.declared).toEqual([])
    expect(state.bannerRequired).toBe(false)
    expect(state.allowedScripts).toEqual([])
  })

  it('réapparaît pour une catégorie déclarée après coup, sans redemander les autres', () => {
    const state = resolveConsentState(BOTH, { analytics: true })

    expect(state.bannerRequired).toBe(true)
    expect(state.undecided).toEqual(['advertising'])
    expect(state.allowedScripts).toEqual([ANALYTICS])
  })

  it('ignore la décision portant sur une catégorie qu’aucun script ne déclare', () => {
    const state = resolveConsentState([ANALYTICS], { analytics: true, advertising: true })

    expect(state.declared).toEqual(['analytics'])
    expect(state.granted).toEqual(['analytics'])
  })
})

describe('l’état lisible d’une catégorie', () => {
  it('distingue accordé, refusé et en attente', () => {
    const state = resolveConsentState(BOTH, { analytics: true, advertising: false })

    expect(statusOf(state, 'analytics')).toBe('granted')
    expect(statusOf(state, 'advertising')).toBe('denied')
    expect(statusOf(resolveConsentState(BOTH, {}), 'analytics')).toBe('undecided')
  })
})

describe('ce que produit une soumission', () => {
  const declared = ['analytics', 'advertising'] as const

  it('accepte tout, ou refuse tout, sur les seules catégories déclarées', () => {
    expect(decideFrom({ intent: 'accept-all', categories: [] }, declared)).toEqual({
      analytics: true,
      advertising: true,
    })

    expect(decideFrom({ intent: 'refuse-all', categories: [] }, declared)).toEqual({
      analytics: false,
      advertising: false,
    })
  })

  it('enregistre un refus pour la catégorie que la soumission ne coche pas', () => {
    // Une case non cochée n'est pas envoyée par le navigateur : c'est la liste
    // **déclarée** qui décide de ce qui est enregistré, jamais le corps reçu.
    expect(decideFrom({ intent: 'save', categories: ['analytics'] }, declared)).toEqual({
      analytics: true,
      advertising: false,
    })
  })

  it('n’accorde rien qu’on n’ait pas déclaré, même si le corps le demande', () => {
    expect(
      decideFrom({ intent: 'save', categories: ['analytics', 'advertising'] }, ['analytics']),
    ).toEqual({ analytics: true })
  })
})

describe('le cookie de consentement', () => {
  it('relit ce qu’il a écrit', () => {
    const decisions = { analytics: true, advertising: false } as const

    expect(decodeConsentCookie(encodeConsentCookie(decisions))).toEqual(decisions)
  })

  it('vaut « rien de décidé » quand il est absent, vide ou illisible', () => {
    // Un cookie est une **entrée** : il est validé, pas cru. Un cookie que
    // personne ne comprend ne doit pas faire tomber une page publique.
    for (const value of [null, undefined, '', 'n’importe quoi', 'v=9&analytics=1']) {
      expect(decodeConsentCookie(value)).toEqual({})
    }
  })

  it('ignore une catégorie que le produit ne connaît pas', () => {
    expect(decodeConsentCookie('v=1&analytics=1&pistage=1')).toEqual({ analytics: true })
  })

  it('relit un cookie qui ne se prononce que sur une catégorie', () => {
    // C'est l'état normal juste après l'ajout d'une catégorie au produit. Le
    // premier jet le lisait « rien de décidé » — donc réaffichait la bannière à
    // chaque page à quelqu'un qui avait déjà choisi.
    expect(decodeConsentCookie('v=1&advertising=0')).toEqual({ advertising: false })
  })

  it('part avec les trois attributs du socle et une durée bornée', () => {
    // `docs/security.md` §1 ne fait pas d'exception pour un cookie sans
    // privilège : rien côté client ne lit celui-ci, c'est le serveur qui écrit.
    const header = consentSetCookie({ analytics: true })

    expect(header.startsWith(`${CONSENT_COOKIE}=`)).toBe(true)
    expect(header).toMatch(/;\s*HttpOnly/i)
    expect(header).toMatch(/;\s*Secure/i)
    expect(header).toMatch(/;\s*SameSite=Lax/i)
    expect(header).toMatch(/;\s*Path=\//i)
    expect(header).toMatch(/;\s*Max-Age=\d+/i)
  })
})

describe('la garde d’une soumission', () => {
  const url = 'https://app.example.test/api/modules/consent/decide'

  it('accepte une soumission de notre propre origine', () => {
    expect(
      isSameSiteSubmission({ origin: 'https://app.example.test', referer: null, requestUrl: url }),
    ).toBe(true)
  })

  it('refuse une soumission venue d’ailleurs : un consentement forgé n’en est pas un', () => {
    expect(
      isSameSiteSubmission({ origin: 'https://evil.test', referer: null, requestUrl: url }),
    ).toBe(false)
  })

  it('ignore le schéma, que la terminaison TLS change', () => {
    // Derrière un proxy qui termine TLS, `request.url` peut être en `http:`
    // alors que le navigateur a vu `https:`. Comparer les schémas refuserait
    // toutes les soumissions en production.
    expect(
      isSameSiteSubmission({
        origin: 'https://app.example.test',
        referer: null,
        requestUrl: 'http://app.example.test/api/modules/consent/decide',
      }),
    ).toBe(true)
  })

  it('retombe sur le référent quand l’origine manque', () => {
    expect(
      isSameSiteSubmission({
        origin: null,
        referer: 'https://evil.test/piege',
        requestUrl: url,
      }),
    ).toBe(false)

    expect(
      isSameSiteSubmission({
        origin: null,
        referer: 'https://app.example.test/fr/cookies',
        requestUrl: url,
      }),
    ).toBe(true)
  })

  it('accepte une requête sans aucun des deux en-têtes, et c’est un choix', () => {
    // Un attaquant ne peut pas faire **retirer** `Origin` au navigateur d'une
    // victime : refuser cette absence ne fermerait aucune attaque, et casserait
    // le retrait de consentement chez ceux dont un outil de confidentialité
    // supprime ces en-têtes — c'est-à-dire exactement ceux que cet écran sert.
    // Ce cas est celui de l'**absence**, et lui seul : voir juste en dessous.
    expect(isSameSiteSubmission({ origin: null, referer: null, requestUrl: url })).toBe(true)
  })

  it('refuse une origine opaque : `Origin: null` est présent, pas absent', () => {
    // La différence que le code confondait. Un attaquant ne peut pas retirer
    // l'en-tête, mais il peut le rendre **opaque** sans effort :
    // `<iframe sandbox="allow-forms">`, un document `data:`, ou une chaîne de
    // redirections inter-origines font tous émettre `Origin: null` par le
    // navigateur de la victime. Le traiter comme une absence laisse forger un
    // consentement complet, ce que ce module existe pour empêcher.
    expect(isSameSiteSubmission({ origin: 'null', referer: null, requestUrl: url })).toBe(false)

    // Et le repli sur le référent ne rattrape pas une origine opaque : ce que
    // le navigateur a rendu opaque ne redevient pas digne de confiance parce
    // qu'un second en-tête, lui aussi contrôlé par l'appelant, dit autre chose.
    expect(
      isSameSiteSubmission({
        origin: 'null',
        referer: 'https://app.example.test/fr/cookies',
        requestUrl: url,
      }),
    ).toBe(false)

    // Toute autre valeur présente qui n'est pas une URL est refusée pour la
    // même raison : elle ne prouve pas l'origine.
    expect(
      isSameSiteSubmission({ origin: 'app.example.test', referer: null, requestUrl: url }),
    ).toBe(false)

    // Et un en-tête **répété**, que `Headers` joint en « a, a », n'est pas une
    // URL non plus — donc refusé, y compris quand les deux valeurs sont la
    // bonne. Le sens est sûr : on refuse un cas légitime plutôt que d'accepter
    // une valeur qu'on ne sait pas lire. Écrit ici parce que le refus surprend
    // quand on le rencontre, et qu'aucun navigateur n'émet cette forme.
    expect(
      isSameSiteSubmission({
        origin: 'https://app.example.test, https://app.example.test',
        referer: null,
        requestUrl: url,
      }),
    ).toBe(false)
    expect(
      isSameSiteSubmission({ origin: null, referer: 'null', requestUrl: url }),
    ).toBe(false)
  })
})

describe('le retour après soumission', () => {
  it('rend le chemin de la page d’où l’on vient', () => {
    expect(safeReturnPath('https://app.example.test/fr/cookies?a=1', '/')).toBe('/fr/cookies?a=1')
  })

  it('ne sort jamais du site, quelle que soit l’écriture', () => {
    // Les trois formes qui sortent du site sans en avoir l'air, comme dans
    // `safeRedirectPath` du module `auth` : l'URL absolue reconstruite, l'URL
    // protocole-relative, et la barre oblique inversée que les navigateurs
    // normalisent.
    for (const hostile of [
      'https://evil.test//evil.test/x',
      '//evil.test/x',
      '\\\\evil.test/x',
      'javascript:alert(1)',
      '',
    ]) {
      expect(safeReturnPath(hostile, '/')).toBe('/')
    }
  })

  it('retombe sur le repli quand il n’y a pas de référent', () => {
    expect(safeReturnPath(null, '/cookies')).toBe('/cookies')
  })
})
