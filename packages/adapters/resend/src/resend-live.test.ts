import { describe, expect, it } from 'vitest'

import { createResendMailer } from './resend-mailer'

/**
 * **Le second régime : envoi réel, hors CI, sur commande explicite.**
 *
 * `docs/architecture.md` impose deux régimes d'intégration tierce et interdit de
 * les mélanger. `resend-mailer.test.ts` est le premier : bloquant en CI, il
 * double le réseau et n'envoie rien. Celui-ci est le second : il envoie un vrai
 * email avec une vraie clé de test, et il ne s'exécute **jamais** sans qu'on le
 * demande.
 *
 * La commande, à lancer avant un ship qui touche aux emails :
 *
 * ```sh
 * RESEND_LIVE_TEST=1 \
 * RESEND_API_KEY=re_… \
 * EMAIL_FROM='Killer SaaS <envoi@votre-domaine-verifie>' \
 * EMAIL_LIVE_TO=vous@votre-domaine \
 *   pnpm vitest run packages/adapters/resend/src/resend-live.test.ts
 * ```
 *
 * Les variables sont lues ici, et ici seulement, directement dans
 * `process.env` : ce fichier est du harnais de test, pas du code applicatif —
 * le point d'accès unique à l'environnement (`@repo/config`) vaut pour ce que
 * l'application exécute, et ces variables-là ne sont **pas** celles de
 * l'application (`EMAIL_LIVE_TO` n'existe que pour cette recette).
 *
 * Sans `RESEND_LIVE_TEST=1`, la suite est ignorée — c'est ce qui garantit
 * qu'aucun email réel ne part d'une exécution de CI, y compris si une clé
 * traînait dans l'environnement.
 */

const live = process.env.RESEND_LIVE_TEST === '1'
const apiKey = process.env.RESEND_API_KEY ?? ''
const from = process.env.EMAIL_FROM ?? ''
const to = process.env.EMAIL_LIVE_TO ?? ''

describe.runIf(live)('envoi réel contre la clé de test Resend', () => {
  it('exige les trois variables de la recette', () => {
    // Sans ce cas, une variable oubliée ferait échouer l'envoi sur un message
    // du fournisseur, et on croirait à une panne de Resend.
    expect(
      [apiKey, from, to].every((value) => value !== ''),
      'RESEND_API_KEY, EMAIL_FROM et EMAIL_LIVE_TO sont requises pour cette recette.',
    ).toBe(true)
  })

  it(
    'envoie réellement et rend l’identifiant du fournisseur',
    { timeout: 30_000 },
    async () => {
      const mailer = createResendMailer({
        apiKey,
        from,
        render: async () => ({
          subject: `[recette] killer-saas ${new Date().toISOString()}`,
          html: '<p>Recette d’envoi réel. Aucun contenu métier.</p>',
          text: 'Recette d’envoi réel. Aucun contenu métier.',
        }),
      })

      const result = await mailer.send({
        to,
        subject: 'recette',
        template: 'live-check',
        locale: 'fr',
        data: {},
      })

      expect(result).toEqual({ ok: true, id: expect.any(String) })
    },
  )
})
