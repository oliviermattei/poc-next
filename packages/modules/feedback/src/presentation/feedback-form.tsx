import {
  Alert,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Label,
  Textarea,
} from '@repo/ui'

import { FEEDBACK_CATEGORIES, FEEDBACK_MESSAGE_MAX_LENGTH } from '../domain/feedback'
import { FEEDBACK_KEYS } from './feedback-routes'

/**
 * **Le formulaire de retour** (critère 1) — composé, jamais inventé.
 *
 * Tout vient de `@repo/ui` (`docs/design-system.md`) : `Card`, `Label`,
 * `Textarea`, `Button`, `Alert`. Aucune primitive maison, aucune couleur
 * Tailwind brute, aucun texte en dur.
 *
 * **Aucun composant client, aucun état à hydrater.** C'est un `<form
 * method="post">` natif qui poste vers la route du module et repart en 303 :
 * il fonctionne **avant** l'hydratation et **sans** JavaScript, comme la
 * bannière de consentement. C'est aussi ce qui rend impossible ici la faute la
 * plus chère du dépôt sur ce sujet — une surface flottante qui intercepte les
 * clics : il n'y a pas de surface flottante.
 *
 * **La catégorie est portée par le bouton qui soumet**, et non par un `Select`
 * ou un `RadioGroup` : ces deux-là sont **déclarés par le design system et
 * absents de `packages/ui`** (`docs/design-system.md`, ligne des 14 absents),
 * composer avec eux ne compile pas, et le plan de cette story s'interdit de
 * livrer un composant. Un `<button type="submit" name="category">` est du HTML
 * natif, il porte la valeur sans script, et il donne à chaque choix un nom
 * accessible distinct — ce qu'un `<select>` maison n'aurait pas fait mieux. Le
 * manque est **reporté**, il n'est pas comblé.
 *
 * `method="post"` est écrit en toutes lettres : `pnpm lint` le refuse
 * autrement, et sans lui un `<form>` retombe sur le `GET` du navigateur en
 * mettant ses champs dans l'URL (`docs/security.md` §5, mesuré en s08).
 */

/** Ce que la présentation du module a besoin de savoir de la langue. */
export interface FeedbackIntl {
  /** Traduit une clé qualifiée. Lève si elle manque — jamais de repli (s09). */
  readonly t: (key: string, values?: Readonly<Record<string, string | number>>) => string
}

/** Ce que l'écran a lu de son adresse. */
export type FeedbackOutcome = 'sent' | 'category' | 'message' | 'unavailable' | null

export interface FeedbackFormProps {
  /** La route montée du module. Une constante de l'écran, jamais une saisie. */
  readonly action: string
  /**
   * Le chemin de la page d'où l'on vient (critère 2), résolu par l'écran.
   *
   * Il repart en champ caché, donc il **revient de l'appelant** : le `domain`
   * le revalide à l'arrivée, et ce composant ne le rend jamais dans un `href`.
   */
  readonly originPath: string | null
  /** Ce que la soumission précédente a donné, lu de l'adresse par l'écran. */
  readonly outcome: FeedbackOutcome
  readonly intl: FeedbackIntl
}

const REFUSAL_KEYS = {
  category: FEEDBACK_KEYS.invalidCategory,
  message: FEEDBACK_KEYS.invalidMessage,
  unavailable: FEEDBACK_KEYS.unavailable,
} as const

export function FeedbackForm({ action, originPath, outcome, intl }: FeedbackFormProps) {
  const refusalKey = outcome === null || outcome === 'sent' ? null : REFUSAL_KEYS[outcome]

  return (
    <Card className="min-w-0 max-w-2xl">
      <CardHeader>
        <CardTitle>{intl.t(FEEDBACK_KEYS.title)}</CardTitle>
        <CardDescription>{intl.t(FEEDBACK_KEYS.description)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/*
          La confirmation **ne remplace pas** le formulaire : un retour envoyé
          est souvent suivi d'un second, et forcer une navigation pour le
          rouvrir serait une friction gratuite. Elle est annoncée par
          `role="status"`, donc lue par une aide technique sans voler le focus.
        */}
        {outcome === 'sent' ? (
          <Alert variant="success" role="status">
            {intl.t(FEEDBACK_KEYS.success)}
          </Alert>
        ) : null}

        {refusalKey === null ? null : (
          <Alert variant="destructive" role="alert">
            {intl.t(refusalKey)}
          </Alert>
        )}

        <form method="post" action={action} className="min-w-0 space-y-4">
          {/*
            Le chemin d'origine repart tel que l'écran l'a résolu. Il est
            **revalidé** par le `domain` à l'arrivée : ce champ est écrit par
            l'appelant, et un champ caché n'est jamais une garantie.
          */}
          <input type="hidden" name="origin" value={originPath ?? ''} />

          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="feedback-message">{intl.t(FEEDBACK_KEYS.messageLabel)}</Label>
            <Textarea
              id="feedback-message"
              name="message"
              rows={6}
              required
              maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
              aria-invalid={outcome === 'message'}
              aria-describedby="feedback-message-hint"
            />
            <p id="feedback-message-hint" className="text-sm text-muted-foreground">
              {intl.t(FEEDBACK_KEYS.messageHint)}
            </p>
          </div>

          <fieldset className="min-w-0 space-y-2">
            <legend className="text-sm font-medium">
              {intl.t(FEEDBACK_KEYS.categoryLabel)}
            </legend>
            <div className="flex min-w-0 flex-wrap gap-2">
              {FEEDBACK_CATEGORIES.map((category) => (
                <Button key={category} type="submit" name="category" value={category}>
                  {intl.t(FEEDBACK_KEYS.categoryOption(category))}
                </Button>
              ))}
            </div>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  )
}
