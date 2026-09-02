import { CookieBanner } from '@repo/ui'

import type { ConsentState } from '../domain/consent-category'
import {
  BANNER_ACCEPT_KEY,
  BANNER_CUSTOMIZE_KEY,
  BANNER_DESCRIPTION_KEY,
  BANNER_LABEL_KEY,
  BANNER_REFUSE_KEY,
  BANNER_TITLE_KEY,
} from '../domain/message-keys'
import { CONSENT_SCREEN_PATH } from './consent-paths'
import { consentRoutePath } from './consent-routes'
import type { ConsentIntl } from './consent-intl'

/**
 * La bannière, ou **rien**.
 *
 * Elle n'apparaît que s'il reste une catégorie déclarée sur laquelle le visiteur
 * ne s'est pas prononcé. Deux conséquences, et ce sont deux critères de la
 * story : aucun script non essentiel déclaré ⇒ aucune bannière ; un choix déjà
 * fait ⇒ aucune bannière, y compris après un refus.
 *
 * Elle rend `null` plutôt que d'être masquée : un élément masqué reste dans
 * l'arbre d'accessibilité, dans l'ordre de tabulation, et dans le HTML servi.
 */
export interface ConsentBannerProps {
  readonly state: ConsentState
  readonly intl: ConsentIntl
}

export function ConsentBanner({ state, intl }: ConsentBannerProps) {
  if (!state.bannerRequired) {
    return null
  }

  return (
    <CookieBanner
      label={intl.t(BANNER_LABEL_KEY)}
      title={intl.t(BANNER_TITLE_KEY)}
      description={intl.t(BANNER_DESCRIPTION_KEY)}
      // La route de module n'est pas préfixée par la locale — `path()` ne
      // s'applique qu'aux écrans (`apps/web/AGENTS.md`).
      action={consentRoutePath('decide')}
      acceptLabel={intl.t(BANNER_ACCEPT_KEY)}
      refuseLabel={intl.t(BANNER_REFUSE_KEY)}
      customizeLabel={intl.t(BANNER_CUSTOMIZE_KEY)}
      customizeHref={intl.path(CONSENT_SCREEN_PATH)}
    />
  )
}
