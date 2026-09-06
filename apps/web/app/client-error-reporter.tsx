'use client'

import { useEffect } from 'react'

import { reportClientError } from '../lib/report-client-error'

/**
 * **Le signalement d'une erreur non gérée du navigateur** (s39, critère 1),
 * isolé dans son propre composant.
 *
 * Il ne rend rien. Il existe pour que `app/global-error.tsx` reste une fonction
 * **sans crochet** : `tests/rendered-text.test.ts` appelle chaque écran comme une
 * fonction ordinaire, hors de tout rendu React, et un `useEffect` posé dans
 * l'écran y échoue — mesuré. Le rendre ici rend l'écran testable comme avant, et
 * laisse le signalement à un composant dont c'est le seul rôle.
 *
 * La **règle** — ce qui est envoyé, et le fait que rien ne lève — vit dans
 * `lib/report-client-error.ts`, où elle est éprouvée. Ce fichier n'en est que
 * le déclencheur.
 */
export function ClientErrorReporter({ error }: { readonly error?: unknown }) {
  // Une fois par erreur affichée, jamais à chaque rendu : un re-rendu de l'écran
  // ne renvoie rien.
  useEffect(() => {
    void reportClientError(error, {
      path: typeof window === 'undefined' ? undefined : window.location.pathname,
    })
  }, [error])

  return null
}
