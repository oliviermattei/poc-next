import { describe, expect, it } from 'vitest'

import { resolveLocale, unflattenMessages } from './i18n'

/**
 * La **règle unique** de choix de langue, éprouvée là où elle est écrite.
 *
 * Ses appelants — la requête entrante, le sélecteur, l'envoi d'un email — ne
 * rejouent pas cette matrice : chacun prouve qu'il l'appelle, pas ce qu'elle
 * décide. Deux implémentations divergeraient au premier cas limite, et
 * l'utilisateur recevrait un écran dans une langue et un email dans l'autre.
 */

const catalog = { locales: ['fr', 'en'] as const, defaultLocale: 'fr' } as const

describe('la locale servie', () => {
  it('est celle demandée quand elle est livrée', () => {
    expect(resolveLocale({ ...catalog, candidate: 'en' })).toBe('en')
  })

  it('est la locale par défaut du site quand rien n’est demandé', () => {
    // Le cas du destinataire **sans compte** (invitation, guest checkout,
    // liste d'attente) : il n'a aucune langue connue, et le critère dit « la
    // locale par défaut du site ». C'est câblé, pas déduit.
    expect(resolveLocale({ ...catalog, candidate: null })).toBe('fr')
    expect(resolveLocale({ ...catalog, candidate: undefined })).toBe('fr')
  })

  it('refuse une locale que le projet ne livre pas, plutôt que de la servir', () => {
    // Sans ce refus, `/de/sign-in` ou un cookie forgé feraient chercher un
    // catalogue inexistant, donc une page d'erreur sur une URL publique.
    expect(resolveLocale({ ...catalog, candidate: 'de' })).toBe('fr')
    expect(resolveLocale({ ...catalog, candidate: '' })).toBe('fr')
    expect(resolveLocale({ ...catalog, candidate: '../../etc/passwd' })).toBe('fr')
  })

  it('ne sert qu’une seule locale quand le projet n’en livre qu’une', () => {
    // L'état « module i18n coupé » vu depuis la règle : la liste servie se
    // réduit à la locale par défaut, et une demande explicite ne la contourne
    // pas.
    expect(resolveLocale({ locales: ['fr'], defaultLocale: 'fr', candidate: 'en' })).toBe('fr')
  })
})

describe('le catalogue plat rendu consommable', () => {
  it('déplie les clés pointées en objets imbriqués', () => {
    expect(unflattenMessages({ 'auth.signIn.title': 'Se connecter', 'app.name': 'Application' })).toEqual({
      auth: { signIn: { title: 'Se connecter' } },
      app: { name: 'Application' },
    })
  })

  it('refuse deux clés dont l’une est le préfixe de l’autre, en les nommant', () => {
    // `a.b` et `a.b.c` ne peuvent pas coexister : l'une écraserait l'autre en
    // silence, et le texte disparu ne se verrait qu'à l'écran.
    expect(() => unflattenMessages({ 'a.b': 'x', 'a.b.c': 'y' })).toThrowError(/« a\.b\.c »/)
  })
})
