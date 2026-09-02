import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  Label,
  Separator,
} from '@repo/ui'
import { CookieIcon } from 'lucide-react'

import { statusOf, type ConsentState, type ConsentStatus } from '../domain/consent-category'
import {
  BANNER_ACCEPT_KEY,
  BANNER_REFUSE_KEY,
  categoryDescriptionKey,
  categoryTitleKey,
  EMPTY_DESCRIPTION_KEY,
  EMPTY_TITLE_KEY,
  PREFERENCES_DESCRIPTION_KEY,
  PREFERENCES_SAVE_KEY,
  PREFERENCES_TITLE_KEY,
  statusLabelKey,
} from '../domain/message-keys'
import { consentRoutePath } from './consent-routes'
import type { ConsentIntl } from './consent-intl'

/**
 * L'écran de préférences — **le seul endroit où le choix se règle catégorie par
 * catégorie**, et la destination des deux points d'accès (finding F57).
 *
 * C'est un `<form method="post">` natif : des cases natives, des boutons de
 * soumission natifs, aucun état React. Retirer son consentement ne peut pas
 * dépendre du script qu'on retire.
 *
 * **Le badge est le retour de succès.** Le design system demande « un changement
 * d'état visible pour une action locale », pas un `Toaster` en plus : après
 * enregistrement, la page est rendue à nouveau et le badge de chaque catégorie
 * porte la décision retenue. C'est un libellé de **statut**, donc un contrat —
 * il distingue accepté, refusé et en attente.
 */
export interface ConsentPreferencesProps {
  readonly state: ConsentState
  readonly intl: ConsentIntl
}

/** La sémantique d'un état. `warning` pour l'attente : c'est ce qui reste à faire. */
const BADGE_VARIANT: Record<ConsentStatus, 'success' | 'secondary' | 'warning'> = {
  granted: 'success',
  denied: 'secondary',
  undecided: 'warning',
}

export function ConsentPreferences({ state, intl }: ConsentPreferencesProps) {
  if (state.declared.length === 0) {
    // Aucun script non essentiel déclaré : il n'y a rien à régler, et le dire
    // vaut mieux qu'une page vide. C'est le critère 7 rendu visible.
    return (
      <EmptyState
        icon={<CookieIcon />}
        title={intl.t(EMPTY_TITLE_KEY)}
        description={intl.t(EMPTY_DESCRIPTION_KEY)}
        action={null}
      />
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.t(PREFERENCES_TITLE_KEY)}</CardTitle>
        <CardDescription>{intl.t(PREFERENCES_DESCRIPTION_KEY)}</CardDescription>
      </CardHeader>
      <CardContent>
        <form method="post" action={consentRoutePath('decide')} className="flex flex-col gap-6">
          <div className="flex min-w-0 flex-col gap-4">
            {state.declared.map((category, index) => {
              const status = statusOf(state, category)

              return (
                <div key={category} className="flex min-w-0 flex-col gap-4">
                  {index === 0 ? null : <Separator />}
                  <div className="flex min-w-0 items-start gap-3">
                    <Checkbox
                      id={`consent-${category}`}
                      name="category"
                      value={category}
                      defaultChecked={status === 'granted'}
                      className="mt-1"
                    />
                    <div className="flex min-w-0 flex-col gap-1">
                      <Label htmlFor={`consent-${category}`} className="flex-wrap">
                        {intl.t(categoryTitleKey(category))}
                        <Badge variant={BADGE_VARIANT[status]}>
                          {intl.t(statusLabelKey(status))}
                        </Badge>
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        {intl.t(categoryDescriptionKey(category))}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* « Enregistrer » porte la variante principale ; les deux raccourcis
              partagent la leur — accepter et refuser restent au même rang. */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" name="decision" value="save">
              {intl.t(PREFERENCES_SAVE_KEY)}
            </Button>
            <Button type="submit" name="decision" value="refuse-all" variant="secondary">
              {intl.t(BANNER_REFUSE_KEY)}
            </Button>
            <Button type="submit" name="decision" value="accept-all" variant="secondary">
              {intl.t(BANNER_ACCEPT_KEY)}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
