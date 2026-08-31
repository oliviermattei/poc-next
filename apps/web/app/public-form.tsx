'use client'

import {
  CONTACT_FORM_KEYS,
  FORM_NOSCRIPT_KEY,
  NEWSLETTER_FORM_KEYS,
  TRAP_FIELD,
  marketingRoutePath,
} from '@repo/module-marketing'
import { Alert, Button, Card, CardContent, Input, Label, Textarea } from '@repo/ui'
import { useTranslations } from 'next-intl'
import { useState, type FormEvent } from 'react'

import { useHydrated } from './use-hydrated'

/**
 * Les formulaires publics — **dans l'application, pas dans le module**, et pour
 * une raison exécutable.
 *
 * Un module n'a pas le droit d'appeler `fetch` : `eslint.config.ts` refuse tout
 * appel réseau sortant hors d'une porte bornée, parce que `docs/reliability.md`
 * §3 exige un délai d'attente et des reprises maîtrisées. La règle vise des
 * appels **serveur vers un tiers** ; celui-ci est un appel **du navigateur vers
 * notre propre route**, dont le navigateur porte déjà le cycle de vie. Plutôt
 * que d'élargir une garde de sécurité pour un cas qu'elle ne visait pas, le
 * composant vit ici — exactement comme `auth-form.tsx`, qui poste vers les
 * routes du module `auth` depuis s07.
 *
 * Ce qui reste dans le module : la règle (`application/public-forms.ts`), les
 * routes, les clés de traduction et la place de la section dans la page. Ce
 * fichier ne décide de rien ; il affiche et il poste.
 *
 * **`method="post"` en toutes lettres et bouton désactivé jusqu'à
 * l'hydratation.** Un `<form>` sans `method` est un `GET` vers l'URL courante
 * tant que le gestionnaire React n'est pas attaché : la saisie part alors dans
 * la chaîne de requête, donc dans le journal d'accès et dans le `Referer`
 * (`docs/security.md` §5, mesuré en s08).
 */

/** Le type de champ qui se rend en zone de texte plutôt qu'en ligne unique. */
const MULTILINE = 'textarea'

interface PublicFormField {
  readonly name: string
  readonly labelKey: string
  readonly autoComplete: string
  readonly type: 'text' | 'email' | typeof MULTILINE
}

interface PublicFormMessageKeys {
  readonly submit: string
  readonly success: string
  readonly throttled: string
  readonly failed: string
  /**
   * Le refus d'un champ, quand la route en rend un.
   *
   * Absent pour la newsletter, qui n'en rend jamais : sa réponse est la même
   * pour une adresse nouvelle, déjà inscrite ou malformée (`docs/security.md`
   * §7). Livrer ce texte préparerait l'affichage d'un cas que le serveur ne
   * produit pas.
   */
  readonly invalid?: string
}

interface PublicFormProps {
  /** La route montée du module. Une constante de l'écran, jamais une saisie. */
  readonly action: string
  /** La langue servie : c'est celle dans laquelle l'email partira. */
  readonly locale: string
  readonly fields: readonly PublicFormField[]
  readonly messageKeys: PublicFormMessageKeys
  /** Champ et bouton sur une ligne au-delà de `sm`. Pour un formulaire à un champ. */
  readonly inline?: boolean
}

type Refusal = 'throttled' | 'failed' | 'invalid'

interface Refused {
  readonly reason: Refusal
  /** Le champ que le serveur a nommé, s'il en a nommé un. */
  readonly field: string | null
}

const refusalOf = (status: number): Refusal => {
  if (status === 429) {
    return 'throttled'
  }

  return status === 400 ? 'invalid' : 'failed'
}

function PublicForm({ action, locale, fields, messageKeys, inline = false }: PublicFormProps) {
  const t = useTranslations()
  const hydrated = useHydrated()
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  const [refused, setRefused] = useState<Refused | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setPending(true)
    setRefused(null)

    const entries = Object.fromEntries(new FormData(event.currentTarget).entries())

    const response = await fetch(action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...entries, locale }),
    }).catch(() => null)

    setPending(false)

    if (response === null) {
      setRefused({ reason: 'failed', field: null })

      return
    }

    if (response.ok) {
      setDone(true)

      return
    }

    const reason = refusalOf(response.status)
    const body = (await response.json().catch(() => null)) as { field?: unknown } | null

    setRefused({ reason, field: typeof body?.field === 'string' ? body.field : null })
  }

  if (done) {
    // La confirmation **remplace** le formulaire : critère 1 de la story, et le
    // seul état qui ne laisse pas croire qu'il faut renvoyer.
    return (
      <Alert variant="success" role="status">
        {t(messageKeys.success)}
      </Alert>
    )
  }

  const refusalKey =
    refused === null
      ? null
      : refused.reason === 'throttled'
        ? messageKeys.throttled
        : ((refused.reason === 'invalid' ? messageKeys.invalid : undefined) ?? messageKeys.failed)

  const throttled = refused?.reason === 'throttled'

  return (
    <form method="post" onSubmit={submit} className="min-w-0 space-y-4" noValidate>
      {refusalKey === null ? null : (
        <Alert variant={throttled ? 'warning' : 'destructive'} role="alert">
          {t(refusalKey)}
        </Alert>
      )}

      <div
        className={inline ? 'flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end' : 'space-y-4'}
      >
        {fields.map((field) => {
          // La comparaison vit **hors du JSX** : un littéral d'un seul mot entre
          // accolades dans des enfants est lu comme du texte affiché par
          // `tests/i18n.test.ts`, et il a raison de le lire ainsi.
          const multiline = field.type === MULTILINE
          const invalid = refused?.field === field.name

          return (
            <div key={field.name} className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor={field.name}>{t(field.labelKey)}</Label>
              {multiline ? (
                <Textarea
                  id={field.name}
                  name={field.name}
                  autoComplete={field.autoComplete}
                  rows={6}
                  required
                  aria-invalid={invalid}
                />
              ) : (
                <Input
                  id={field.name}
                  name={field.name}
                  type={field.type}
                  autoComplete={field.autoComplete}
                  required
                  aria-invalid={invalid}
                />
              )}
            </div>
          )
        })}

        {/*
          Le piège à robots : masqué par une **classe de la feuille de style**,
          jamais par un attribut `style` — `style-src-attr` est la seule
          directive de la politique de sécurité du contenu qui ignore les
          nonces (`packages/ui/AGENTS.md`), et un style en ligne serait donc
          refusé en production. Sans texte, sans étiquette, hors du parcours du
          clavier et invisible aux aides techniques : seul un automate le
          remplit.
        */}
        <input
          type="text"
          name={TRAP_FIELD}
          className="hidden"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
        />

        {/*
          Sans JavaScript, le bouton reste éteint : la soumission passe par
          `fetch`, et l'ADR 027 assume cette exigence. Ce qui n'était décidé
          nulle part, c'est le **silence** — un bouton mort sans un mot, mesuré
          sous le build de production (constat F5 de la revue de s11). Le
          `<noscript>` le dit, et il ne coûte ni script en ligne ni source de
          politique de sécurité du contenu.
        */}
        <noscript>
          <Alert variant="warning">{t(FORM_NOSCRIPT_KEY)}</Alert>
        </noscript>

        <Button type="submit" disabled={pending || !hydrated} className={inline ? '' : 'w-full sm:w-auto'}>
          {t(messageKeys.submit)}
        </Button>
      </div>
    </form>
  )
}

export interface PublicFormBlockProps {
  readonly locale: string
}

/** L'inscription à la newsletter : un champ, un bouton, sur une ligne au-delà de `sm`. */
export function NewsletterForm({ locale }: PublicFormBlockProps) {
  return (
    <Card className="min-w-0">
      <CardContent>
        <PublicForm
          action={marketingRoutePath('newsletter')}
          locale={locale}
          inline
          fields={[
            {
              name: 'email',
              labelKey: NEWSLETTER_FORM_KEYS.email,
              autoComplete: 'email',
              type: 'email',
            },
          ]}
          messageKeys={{
            submit: NEWSLETTER_FORM_KEYS.submit,
            success: NEWSLETTER_FORM_KEYS.success,
            throttled: NEWSLETTER_FORM_KEYS.throttled,
            failed: NEWSLETTER_FORM_KEYS.failed,
          }}
        />
      </CardContent>
    </Card>
  )
}

/** Le formulaire de contact : nom, adresse, message. */
export function ContactForm({ locale }: PublicFormBlockProps) {
  return (
    <Card className="min-w-0 max-w-2xl">
      <CardContent>
        <PublicForm
          action={marketingRoutePath('contact')}
          locale={locale}
          fields={[
            {
              name: 'name',
              labelKey: CONTACT_FORM_KEYS.name,
              autoComplete: 'name',
              type: 'text',
            },
            {
              name: 'email',
              labelKey: CONTACT_FORM_KEYS.email,
              autoComplete: 'email',
              type: 'email',
            },
            {
              name: 'message',
              labelKey: CONTACT_FORM_KEYS.message,
              autoComplete: 'off',
              type: MULTILINE,
            },
          ]}
          messageKeys={{
            submit: CONTACT_FORM_KEYS.submit,
            success: CONTACT_FORM_KEYS.success,
            throttled: CONTACT_FORM_KEYS.throttled,
            failed: CONTACT_FORM_KEYS.failed,
            invalid: CONTACT_FORM_KEYS.invalid,
          }}
        />
      </CardContent>
    </Card>
  )
}
