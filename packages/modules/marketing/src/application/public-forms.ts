import { MARKETING_MODULE_ID } from '../domain/marketing-config'
import type { ModuleExportPayload, ModuleScope } from '@repo/core'

import {
  CONTACT_FORM,
  NEWSLETTER_FORM,
  parseContactSubmission,
  parseNewsletterSubmission,
  type PublicFormId,
  type PublicFormParse,
} from '../domain/public-forms'
import {
  exceedsRateLimit,
  rateLimitBuckets,
  windowStartOf,
  type RateLimitVerdict,
} from '../domain/rate-limit'
import type { PublicFormsDependencies } from './ports'

/**
 * Les deux cas d'usage des formulaires publics, et **les deux règles de réponse
 * qui les séparent**.
 *
 * | | contact | newsletter |
 * |---|---|---|
 * | champ invalide | **400, champ nommé** (critère 1) | réponse d'acceptation |
 * | déjà connu | sans objet | réponse d'acceptation, aucun effet (critère 2) |
 * | piège armé | réponse d'acceptation, aucun effet | idem |
 * | seau du formulaire saturé | **accepté et enregistré**, aucun envoi | idem |
 * | email | **dans** le temps de réponse | **hors** du temps de réponse |
 *
 * L'asymétrie n'est pas une inconséquence : le contact n'a rien à énumérer — le
 * destinataire est fixe et connu —, tandis que la newsletter dirait, en
 * distinguant ses cas, si une adresse est déjà dans la liste
 * (`docs/security.md` §7). Un formulaire qui répond différemment à « adresse
 * inconnue » et « adresse connue » est une oracle d'inscription, exactement
 * comme un écran de connexion qui distingue « compte inconnu » de « mot de
 * passe invalide ».
 */

/** Les templates d'email du module, qualifiés comme le registre les nomme. */
export const MARKETING_EMAIL_TEMPLATES = {
  contactMessage: `${MARKETING_MODULE_ID}.contact-message`,
  newsletterConfirmation: `${MARKETING_MODULE_ID}.newsletter-confirmation`,
} as const

/**
 * Ce qu'une soumission produit, du point de vue de l'appelant.
 *
 * `accepted` couvre **trois** situations que la route ne doit pas distinguer :
 * l'effet a eu lieu, il n'avait pas lieu d'avoir lieu (doublon), ou la
 * soumission était automatisée. C'est le type qui empêche une route de les
 * séparer par inadvertance.
 */
export type PublicFormOutcome =
  | { readonly status: 'accepted' }
  | { readonly status: 'invalid'; readonly field: string }
  | { readonly status: 'rate-limited' }
  | { readonly status: 'mail-failed' }

export interface PublicFormSubmission {
  /** Le corps de la requête, **non validé** : la frontière est dans le domaine. */
  readonly body: unknown
  /** Ce que le serveur croit savoir de l'appelant (`clientIdentifierOf`). */
  readonly client: string
  /** La langue de la requête, ou `null` si elle n'est pas connue. */
  readonly locale: string | null
}

export interface PublicFormsUseCases {
  submitContact(submission: PublicFormSubmission): Promise<PublicFormOutcome>
  subscribeToNewsletter(submission: PublicFormSubmission): Promise<PublicFormOutcome>
  /**
   * Les deux catégories déclarées au contrat, ensemble : inscriptions **et**
   * messages de contact. Le nom dit « visitor data » et non « subscriptions »
   * depuis que la seconde existe — une purge qui en efface deux sous un nom qui
   * n'en annonce qu'une est exactement le genre de silence que le prochain agent
   * lit de travers.
   */
  purgeVisitorData(scope: ModuleScope): Promise<void>
  exportVisitorData(scope: ModuleScope): Promise<ModuleExportPayload>
}

const ACCEPTED: PublicFormOutcome = { status: 'accepted' }

export type {
  ContactMessageRecord,
  PublicFormsDependencies,
  PublicSubscriptionRecord,
} from './ports'

export function createPublicFormsUseCases(
  dependencies: PublicFormsDependencies,
): PublicFormsUseCases {
  const { contactMessages, subscriptions, throttle, mailer, forms, now, generateId } = dependencies

  /**
   * Le débit, mesuré **avant** toute autre chose, et **séquentiellement**.
   *
   * Avant la validation, et c'est délibéré : la limite existe pour refuser sans
   * travailler. Une soumission mal formée compte donc dans le seau — c'est
   * précisément ce qu'un robot produit en masse.
   *
   * L'ordre n'est pas cosmétique. Le seau de l'appelant est consulté d'abord ;
   * s'il refuse, **plus rien n'est écrit** — ni le seau du formulaire, ni quoi
   * que ce soit d'autre. Les deux seaux étaient auparavant incrémentés
   * ensemble, si bien qu'une requête déjà refusée écrivait quand même sa ligne :
   * avec un identifiant falsifiable, c'était une croissance de table offerte à
   * quiconque sait boucler (constat F1 de la revue de s11).
   *
   * Le seau du formulaire, lui, ne refuse jamais : il rend `degraded`, et
   * l'appelant suspend l'envoi sortant sans fermer la porte (constat F2).
   */
  const rateLimitVerdict = async (
    form: PublicFormId,
    client: string,
  ): Promise<RateLimitVerdict> => {
    const windowStart = windowStartOf(now(), forms.rateLimit.windowSeconds)
    const buckets = rateLimitBuckets({ form, client, policy: forms.rateLimit })

    const clientHits = await throttle.hit({ bucket: buckets.client, windowStart })

    if (exceedsRateLimit(clientHits, buckets.client.max)) {
      return 'refused'
    }

    const formHits = await throttle.hit({ bucket: buckets.form, windowStart })

    if (formHits === 1) {
      // Première soumission de ce formulaire dans cette fenêtre : les seaux des
      // fenêtres closes n'ont plus de lecteur, on les efface. Une fois par
      // fenêtre et par formulaire — le balayer à chaque requête coûterait une
      // instruction de plus pour ne rien trouver.
      await throttle.sweep(windowStart)
    }

    return exceedsRateLimit(formHits, buckets.form.max) ? 'degraded' : 'allowed'
  }

  /** L'adresse d'un périmètre, ou `null`. Une organisation n'en a jamais. */
  const emailOf = async (scope: ModuleScope): Promise<string | null> =>
    scope.kind === 'organization' ? null : await dependencies.emailOfScope(scope)

  return {
    submitContact: async ({ body, client, locale }) => {
      const verdict = await rateLimitVerdict(CONTACT_FORM, client)

      if (verdict === 'refused') {
        return { status: 'rate-limited' }
      }

      const parsed: PublicFormParse<{ name: string; email: string; message: string }> =
        parseContactSubmission(body)

      if (!parsed.ok) {
        // Le piège est **silencieux** : même réponse qu'une soumission acceptée,
        // aucun envoi. Dire « champ website interdit » apprendrait au robot
        // lequel laisser vide.
        return parsed.refusal.kind === 'automated'
          ? ACCEPTED
          : { status: 'invalid', field: parsed.refusal.field }
      }

      /**
       * **Le message est enregistré avant d'être envoyé.**
       *
       * L'ordre est la propriété : un envoi qui échoue laisse alors une ligne
       * sans date de remise, au lieu du néant que la revue de s11 a constaté
       * (F8). C'est aussi ce qui rend la dégradation ci-dessous acceptable —
       * suspendre l'envoi ne perd rien.
       */
      const recorded = await contactMessages.record({
        id: generateId(),
        name: parsed.value.name,
        email: parsed.value.email,
        message: parsed.value.message,
        locale: dependencies.emailLocaleFor(locale),
      })

      if (verdict === 'degraded') {
        // Le formulaire est saturé : l'envoi est suspendu, pas la réception. Le
        // message est déjà en base, avec sa date de remise vide.
        return ACCEPTED
      }

      const result = await mailer.send({
        // Le destinataire vient de la **configuration** : c'est le piège nommé
        // par la story, et c'est aussi ce qui rend l'injection d'en-tête
        // impossible — l'adresse du visiteur ne va jamais dans `to`.
        to: forms.contactRecipient,
        template: MARKETING_EMAIL_TEMPLATES.contactMessage,
        locale: dependencies.emailLocaleFor(locale),
        // `subject` n'est **pas** fourni : celui du template s'applique, donc
        // aucune donnée de visiteur n'entre dans un champ d'en-tête.
        data: { name: parsed.value.name, email: parsed.value.email, message: parsed.value.message },
      })

      if (!result.ok) {
        // 502 pour l'appelant, mais **le message est gardé** : l'éditeur peut le
        // reprendre depuis la table, sa date de remise étant restée vide.
        return { status: 'mail-failed' }
      }

      await contactMessages.markDelivered({ id: recorded.id, at: now() })

      return ACCEPTED
    },

    subscribeToNewsletter: async ({ body, client, locale }) => {
      const verdict = await rateLimitVerdict(NEWSLETTER_FORM, client)

      if (verdict === 'refused') {
        return { status: 'rate-limited' }
      }

      const parsed = parseNewsletterSubmission(body)

      if (!parsed.ok) {
        // Adresse malformée **et** soumission piégée rendent la réponse d'une
        // inscription réussie : distinguer les cas rouvrirait l'énumération.
        return ACCEPTED
      }

      const emailLocale = dependencies.emailLocaleFor(locale)

      const created = await subscriptions.subscribe({
        id: generateId(),
        email: parsed.value.email,
        source: forms.newsletterSource,
        locale: emailLocale,
      })

      // Saturé, le formulaire n'envoie plus la confirmation : l'inscription est
      // enregistrée, et c'est elle qui porte le service rendu au visiteur.
      if (created !== null && verdict !== 'degraded') {
        dependencies.runInBackground(
          mailer.send({
            to: created.email,
            template: MARKETING_EMAIL_TEMPLATES.newsletterConfirmation,
            locale: created.locale,
            data: { email: created.email },
          }),
        )
      }

      return ACCEPTED
    },

    purgeVisitorData: async (scope) => {
      const email = await emailOf(scope)

      if (email === null) {
        return
      }

      await subscriptions.deleteByEmail(email)
      await contactMessages.deleteByEmail(email)
    },

    exportVisitorData: async (scope) => {
      const email = await emailOf(scope)

      if (email === null) {
        return {}
      }

      const [records, messages] = await Promise.all([
        subscriptions.listByEmail(email),
        contactMessages.listByEmail(email),
      ])

      // L'adresse n'est **pas** reprise dans la charge : elle est la clé du
      // périmètre, celui qui exporte la connaît déjà, et la répéter la
      // dupliquerait dans un fichier remis à un tiers. La date de remise non
      // plus : c'est un état d'exploitation, pas une donnée du visiteur.
      return {
        subscriptions: records.map((record) => ({
          source: record.source,
          locale: record.locale,
          createdAt: record.createdAt,
        })),
        messages: messages.map((record) => ({
          name: record.name,
          message: record.message,
          locale: record.locale,
          createdAt: record.createdAt,
        })),
      }
    },
  }
}
