import { z } from 'zod'

import { CONSENT_CATEGORIES, type ConsentDecisions } from './consent-category'

/**
 * Le cookie de consentement — **le seul endroit où le choix est conservé**
 * (ADR 035).
 *
 * Il est strictement nécessaire : sans lui, le produit redemanderait son choix
 * au visiteur à chaque page, ce qui est exactement ce que la loi cherche à
 * éviter. Il ne demande donc aucun consentement à lui-même.
 *
 * `HttpOnly` comme le cookie de langue : rien côté client ne le lit, c'est le
 * serveur qui décide de charger un script ou non. Un cookie de consentement
 * lisible par le JavaScript de page serait modifiable par n'importe quel script
 * de page — y compris celui qu'on cherche à contenir.
 */
export const CONSENT_COOKIE = 'app_consent'

/**
 * Six mois — la durée que recommande l'autorité française pour un choix de
 * cookies, et la plus longue qui reste défendable : au-delà, on oppose au
 * visiteur une décision qu'il ne se rappelle pas avoir prise.
 */
export const CONSENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 182

/**
 * La version du format.
 *
 * Elle n'est pas décorative : un cookie écrit par une version antérieure du
 * produit doit valoir « rien de décidé » — donc faire réapparaître la bannière —
 * plutôt qu'être réinterprété de travers.
 */
const CONSENT_COOKIE_VERSION = '1'

/**
 * Le schéma d'un cookie lu — Zod à la frontière (`docs/security.md` §4).
 *
 * Un cookie est une entrée contrôlée par le client, au même titre qu'un corps
 * de requête. Ce qui n'a pas la forme attendue vaut « rien de décidé » ; il ne
 * lève pas, parce qu'un cookie abîmé ne doit pas faire tomber une page publique.
 *
 * `partialRecord` et non `record` : en Zod 4, un `record` dont la clé est une
 * énumération est **exhaustif** — il refuse un cookie qui ne se prononce que sur
 * une catégorie, ce qui est l'état normal après l'ajout d'une catégorie. Mesuré :
 * le premier jet rendait « rien de décidé » sur `v=1&analytics=1`, donc
 * réaffichait la bannière à chaque page à qui avait déjà choisi.
 */
const decisionSchema = z.partialRecord(z.enum(CONSENT_CATEGORIES), z.enum(['0', '1']))

export function encodeConsentCookie(decisions: ConsentDecisions): string {
  const parameters = new URLSearchParams({ v: CONSENT_COOKIE_VERSION })

  for (const category of CONSENT_CATEGORIES) {
    const decision = decisions[category]

    if (decision !== undefined) {
      parameters.set(category, decision ? '1' : '0')
    }
  }

  return parameters.toString()
}

export function decodeConsentCookie(value: string | null | undefined): ConsentDecisions {
  if (typeof value !== 'string' || value === '') {
    return {}
  }

  const parameters = new URLSearchParams(value)

  if (parameters.get('v') !== CONSENT_COOKIE_VERSION) {
    return {}
  }

  // Les clés inconnues sont **retirées** avant validation plutôt que refusées :
  // une catégorie ajoutée puis retirée par une version ultérieure du produit ne
  // doit pas annuler les décisions qui l'accompagnaient.
  const known = Object.fromEntries(
    [...parameters.entries()].filter(([key]) =>
      (CONSENT_CATEGORIES as readonly string[]).includes(key),
    ),
  )

  const parsed = decisionSchema.safeParse(known)

  if (!parsed.success) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(parsed.data).map(([category, flag]) => [category, flag === '1']),
  )
}

/**
 * L'en-tête `Set-Cookie` du choix, construit ici et nulle part ailleurs.
 *
 * `Path=/` parce que le choix vaut pour tout le site, `SameSite=Lax` parce que
 * le cookie doit accompagner une navigation venue d'un lien externe — sinon un
 * visiteur qui arrive par un moteur de recherche revoit la bannière qu'il a
 * déjà refusée.
 */
export function consentSetCookie(decisions: ConsentDecisions): string {
  return [
    `${CONSENT_COOKIE}=${encodeConsentCookie(decisions)}`,
    'Path=/',
    `Max-Age=${CONSENT_COOKIE_MAX_AGE}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ')
}
