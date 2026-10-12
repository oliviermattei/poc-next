import { Card, Cards } from 'fumadocs-ui/components/card'

import type { GridItem, Lang } from '@/lib/feature-grid'
import { BADGES, cardHref, FEATURE_GRID, ISSUES_URL } from '@/lib/feature-grid'

/** Ce que la carte dit d'elle-même : son badge, l'issue qui la suit, sa réserve. */
function describe(item: GridItem, lang: Lang): string {
  const parts = [BADGES[item.badge].label[lang]]

  if (item.badge === 'soon') {
    parts.push(`issue #${item.issue}`)
  }

  if (item.note) {
    parts.push(item.note[lang])
  }

  return parts.join(' · ')
}

/**
 * **La grille des fonctionnalités et des services**, rendue depuis
 * `lib/feature-grid.ts` — la seule déclaration de la grille, pour les deux
 * langues. Uniquement des composants intégrés de Fumadocs (`Cards`, `Card`).
 */
export function FeatureGrid({ lang }: { lang: Lang }) {
  return (
    <>
      <ul>
        {(Object.keys(BADGES) as (keyof typeof BADGES)[]).map((badge) => (
          <li key={badge}>
            <strong>{BADGES[badge].label[lang]}</strong>
            {lang === 'fr' ? ' : ' : ': '}
            {BADGES[badge].meaning[lang]}.
          </li>
        ))}
      </ul>
      <p>
        {lang === 'fr' ? 'Les issues se lisent sur ' : 'Issues are tracked on '}
        <a href={ISSUES_URL}>GitHub</a>.
      </p>
      {FEATURE_GRID.map((domain) => (
        <section key={domain.title.fr}>
          <h3>{domain.title[lang]}</h3>
          <Cards>
            {domain.items.map((item) => (
              <Card
                key={item.label.fr}
                title={item.label[lang]}
                description={describe(item, lang)}
                href={cardHref(item, lang)}
              />
            ))}
          </Cards>
        </section>
      ))}
    </>
  )
}
