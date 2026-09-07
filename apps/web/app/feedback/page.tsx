import { parseOriginPath } from '@repo/module-feedback'
import { FeedbackForm, type FeedbackOutcome } from '@repo/module-feedback/presentation'
import { notFound, redirect } from 'next/navigation'

import { currentViewer, incomingRequest } from '../../lib/auth'
import { feedback, feedbackRoutePath, FEEDBACK_SCREEN_PATH } from '../../lib/feedback'
import { appIntl } from '../../lib/i18n'

/**
 * **L'écran d'envoi d'un retour** (s43, critère 1).
 *
 * Trois refus, dans cet ordre, et aucun ne nomme un module :
 *
 * | Qui | Ce qu'il obtient |
 * |---|---|
 * | le produit n'a pas de retours | **404** — l'écran n'existe pas |
 * | un visiteur anonyme | redirection vers la connexion, avec son retour |
 * | un compte | le formulaire |
 *
 * Le premier se départage sur `feedback.available`, c'est-à-dire sur une
 * **donnée** rendue par le point de composition — la discipline de
 * `/notifications` et de `/organizations`.
 *
 * **Ce n'est pas un panneau flottant, et c'est la décision de la story.** Le
 * déclencheur est l'entrée de navigation que le module déclare à son contrat ;
 * elle disparaît avec lui sans qu'aucun fichier de `apps/web` ne le nomme
 * (ADR 066). Les trois raisons sont dans `packages/modules/feedback/AGENTS.md`,
 * et la plus chère est mesurée : la bannière de consentement, posée en surface
 * fixe sans réserver sa place, a intercepté les clics de dix parcours.
 */

/** Ce que l'écran lit de son adresse, réduit à un vocabulaire **fermé**. */
const outcomeOf = (parameters: Record<string, string | string[] | undefined>): FeedbackOutcome => {
  const first = (value: string | string[] | undefined): string | null =>
    Array.isArray(value) ? (value[0] ?? null) : (value ?? null)

  if (first(parameters['sent']) !== null) {
    return 'sent'
  }

  const refused = first(parameters['refused'])

  // Une valeur inconnue n'affiche **rien** : ce paramètre vient de l'appelant,
  // et il ne choisit qu'entre trois messages écrits ici.
  return refused === 'category' || refused === 'message' || refused === 'unavailable'
    ? refused
    : null
}

export default async function FeedbackPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!feedback.available) {
    notFound()
  }

  const { session } = await currentViewer()
  const { t, path } = await appIntl()

  if (session === null) {
    // Le chemin **interne** part dans `next` : c'est l'écran de connexion qui
    // le met dans la forme publique de sa locale, une seule fois.
    redirect(`${path('/sign-in')}?next=${encodeURIComponent(FEEDBACK_SCREEN_PATH)}`)
  }

  /**
   * **La page d'origine** (critère 2), lue de l'en-tête `Referer`.
   *
   * C'est la seule source qui réponde sans JavaScript à « d'où venez-vous ? »,
   * et c'est une donnée **fournie par le client** : elle est validée et bornée
   * par le `domain` du module ici, puis **revalidée** à l'arrivée de la
   * soumission, parce qu'entre les deux elle traverse un champ caché que
   * l'appelant réécrit. Ce qui n'est pas un chemin interne devient `null`.
   *
   * Elle n'est **jamais rendue dans un `href`** : ni ici, ni dans l'écran
   * d'administration qui la relit.
   *
   * Elle passe par `incomingRequest()`, la **même** reconstruction de requête
   * que la garde du back-office : une seconde lecture des en-têtes, ailleurs,
   * serait une seconde vérité.
   */
  const referer = (await incomingRequest()).headers.get('referer')
  const originPath =
    referer === null ? null : parseOriginPath(pathOfSameOrigin(referer))

  return (
    <FeedbackForm
      action={feedbackRoutePath('submit')}
      originPath={originPath}
      outcome={outcomeOf((await searchParams) ?? {})}
      intl={{ t }}
    />
  )
}

/**
 * Le chemin d'une adresse absolue, **sans jamais décider qu'elle est nôtre**.
 *
 * `Referer` porte une URL absolue ; ce qui nous intéresse est son chemin. La
 * question « est-ce mon origine ? » n'est pas posée : ne garder que le chemin la
 * rend sans objet, et le `domain` refuse ensuite tout ce qui n'est pas un chemin
 * interne. Une valeur illisible rend une chaîne vide, que le `domain` refuse.
 */
const pathOfSameOrigin = (referer: string): string => {
  try {
    const url = new URL(referer)

    return `${url.pathname}${url.search}`
  } catch {
    return ''
  }
}
