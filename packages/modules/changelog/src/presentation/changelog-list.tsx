import { Badge, Button, EmptyState, PageHeader, Separator } from '@repo/ui'
import type { ReactNode } from 'react'

import { type ChangelogListView } from '../application/changelog-catalog'
import { formatChangelogDate } from '../domain/changelog-entry'
import { CHANGELOG_KEYS, categoryLabelKey } from '../domain/message-keys'
import type { ChangelogIntl } from './changelog-intl'

/**
 * Les nouveautés : un en-tête, puis une section par version, de la plus récente
 * à la plus ancienne.
 *
 * **Aucune pagination, aucun filtre** : un changelog se lit d'un bout à l'autre,
 * et chaque entrée porte une ancre pour que le flux puisse pointer dessus —
 * `tests/changelog.test.ts` compare les ancres rendues aux `guid` du flux servi,
 * les deux n'étant sinon liés que par l'intention.
 *
 * **L'écran ne rejoue aucun ordre.** Les entrées sont rendues dans celui que
 * `changelogReleases` a décidé — chronologique inverse, à l'intérieur d'une
 * version comme entre les versions. Une seconde clé de tri ici (par catégorie,
 * par exemple) contredirait silencieusement le domaine : la revue de s31 l'a
 * mesuré sur la version 1.1, dont l'entrée du 18 février s'affichait au-dessus
 * de celle du 20.
 *
 * **La typographie vient du système** (`docs/design-system.md`) : le titre de
 * version prend le rôle `h2` (1,5 rem / 600), celui d'une entrée le rôle `h3`
 * (1,25 rem / 600) — la paire de `card-title` et de l'échelle de prose. Une
 * paire inventée sur place serait une seconde typographie.
 *
 * **La catégorie est un `Badge` neutre**, jamais une variante sémantique :
 * `s49-contraste-des-alertes` a mesuré que les quatre variantes sémantiques
 * passent sous le seuil WCAG AA en thème clair, et « Correction » n'est de toute
 * façon pas un état d'erreur. La nature du changement est donc portée par le
 * **texte** du badge, qui est traduit.
 */
export interface ChangelogListProps {
  readonly view: ChangelogListView
  readonly intl: ChangelogIntl
  /**
   * Le corps de chaque entrée, **compilé par le bundler** et indexé par son
   * identifiant (ADR 053). Absent, l'entrée n'affiche que son résumé — c'est ce
   * qui se passe dans un test qui ne compile pas de MDX.
   */
  readonly bodies?: Readonly<Record<string, ReactNode>>
}

export function ChangelogList({ view, intl, bodies = {} }: ChangelogListProps) {
  return (
    <div className="min-w-0 space-y-8">
      <PageHeader
        title={intl.t(CHANGELOG_KEYS.listTitle)}
        description={intl.t(CHANGELOG_KEYS.listDescription)}
      />

      {view.total === 0 ? (
        <EmptyState
          title={intl.t(CHANGELOG_KEYS.emptyTitle)}
          description={intl.t(CHANGELOG_KEYS.emptyDescription)}
          action={
            <Button variant="outline" asChild>
              <a href={intl.path('/')}>{intl.t(CHANGELOG_KEYS.listTitle)}</a>
            </Button>
          }
        />
      ) : (
        <div className="space-y-12">
          {view.releases.map((release) => (
            <section key={release.version} className="min-w-0 space-y-4">
              <div className="space-y-1">
                <h2 className="text-2xl font-semibold tracking-tight">
                  {intl.t(CHANGELOG_KEYS.release, { version: release.version })}
                </h2>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={release.date}>
                    {formatChangelogDate(release.entries[0]?.locale ?? '', release.date)}
                  </time>
                </p>
              </div>
              <Separator />
              <div className="space-y-8">
                {release.entries.map((entry) => (
                  <article key={entry.slug} id={entry.slug} className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{intl.t(categoryLabelKey(entry.category))}</Badge>
                      <h3 className="text-xl font-semibold tracking-tight">{entry.title}</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">{entry.description}</p>
                    {bodies[entry.slug] ?? null}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
