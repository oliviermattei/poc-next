import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui'

import {
  SETTINGS_ACTION_KEY,
  SETTINGS_DESCRIPTION_KEY,
  SETTINGS_TITLE_KEY,
} from '../domain/message-keys'
import { CONSENT_SCREEN_PATH } from './consent-paths'
import type { ConsentIntl } from './consent-intl'

/**
 * **Le second point d'accès** — celui qui ne dépend d'aucun module optionnel
 * (finding F57 de la revue des stories).
 *
 * Le pied de page appartient au module `marketing`. Sur une installation qui le
 * coupe tout en gardant un script d'analyse — combinaison légale au regard de
 * s10 et de s39 —, un point d'accès unique dans le pied de page priverait
 * l'utilisateur de tout moyen de retirer son consentement, c'est-à-dire
 * exactement la non-conformité que ce module existe pour empêcher. Cette carte
 * est donc rendue dans les paramètres de compte **quel que soit** l'état du
 * site public.
 *
 * C'est un lien, pas une action : le réglage vit sur un écran, pas dans deux
 * formulaires qui divergeraient.
 */
export interface ConsentSettingsCardProps {
  readonly intl: ConsentIntl
}

export function ConsentSettingsCard({ intl }: ConsentSettingsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.t(SETTINGS_TITLE_KEY)}</CardTitle>
        <CardDescription>{intl.t(SETTINGS_DESCRIPTION_KEY)}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <a href={intl.path(CONSENT_SCREEN_PATH)}>{intl.t(SETTINGS_ACTION_KEY)}</a>
        </Button>
      </CardContent>
    </Card>
  )
}
