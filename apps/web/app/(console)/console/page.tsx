import { visibleNavigation } from '@repo/core'
import { CONSOLE_SCREEN_PATH } from '@repo/module-admin'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
} from '@repo/ui'
import { ArrowRightIcon, LayoutDashboardIcon } from 'lucide-react'
import { notFound } from 'next/navigation'

import { admin } from '../../../lib/admin'
import { currentViewer } from '../../../lib/auth'
import { backOfficeIntl } from '../../../lib/back-office'
import {
  consoleTiles,
  consoleTileSlots,
  readConsoleTiles,
  type ConsoleTile,
} from '../../../lib/console'
import { appIntl, type AppIntl } from '../../../lib/i18n'
import { moduleRegistry } from '../../../lib/module-registry'

/**
 * `/console` — le tableau de bord de la console (s60).
 *
 * Une tuile par écran de la console, **dérivée des entrées visibles** de la
 * surface `console` (`lib/console.ts`) : aucune ne nomme de module, et une
 * tuile disparaît avec le module qui porte son écran.
 *
 * Les refus sont ceux des autres écrans de la console, et dans le même ordre :
 * module coupé **avant** la session, puis **404** à l'anonyme — jamais une
 * redirection vers la connexion, qui révélerait la zone —, puis 404 quand une
 * lecture répond « introuvable » (un compte qui n'administre pas). Le layout de
 * la console refuse déjà ces appelants ; cette page ne s'en remet pas à lui.
 */
export default async function ConsoleDashboardPage() {
  if (!admin.available) {
    notFound()
  }

  const { session } = await currentViewer()

  if (session === null) {
    notFound()
  }

  const intl = await appIntl()
  const slots = consoleTileSlots(visibleNavigation(moduleRegistry, session, 'console'))
  const tiles = consoleTiles(slots, await readConsoleTiles(slots, session.userId))

  if (tiles === null) {
    notFound()
  }

  return (
    <>
      <PageHeader
        title={intl.t('admin.dashboard.title')}
        description={intl.t('admin.dashboard.description')}
      />
      {tiles.length === 0 ? (
        <EmptyState
          icon={<LayoutDashboardIcon />}
          title={intl.t('admin.dashboard.empty.title')}
          description={intl.t('admin.dashboard.empty.description')}
          action={
            <Button asChild variant="outline">
              <a href={intl.path(CONSOLE_SCREEN_PATH)}>{intl.t('admin.dashboard.retry')}</a>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tiles.map((tile) => (
            <ConsoleTileCard key={tile.key} tile={tile} intl={intl} />
          ))}
        </div>
      )}
    </>
  )
}

function ConsoleTileCard({ tile, intl }: { readonly tile: ConsoleTile; readonly intl: AppIntl }) {
  const label = intl.t(tile.labelKey)

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        {tile.descriptionKey === null ? null : (
          <CardDescription>{intl.t(tile.descriptionKey)}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <TileFigure tile={tile} intl={intl} />
      </CardContent>
      <CardFooter>
        <Button asChild variant="ghost">
          <a href={intl.path(tile.href)}>
            {intl.t('admin.dashboard.open', { label })}
            <ArrowRightIcon aria-hidden />
          </a>
        </Button>
      </CardFooter>
    </Card>
  )
}

function TileFigure({ tile, intl }: { readonly tile: ConsoleTile; readonly intl: AppIntl }) {
  const { figure } = tile

  switch (figure.kind) {
    case 'count':
      return (
        <p className="text-3xl font-semibold tabular-nums">
          {new Intl.NumberFormat(intl.locale).format(figure.total)}
        </p>
      )
    case 'money': {
      const { money } = backOfficeIntl(intl)

      return (
        <div className="flex flex-col gap-1">
          {figure.lines.length === 0 ? (
            <p className="text-muted-foreground">{intl.t('admin.dashboard.revenue.none')}</p>
          ) : (
            // **Une ligne par devise, jamais une somme** (s38).
            <ul className="flex flex-col gap-1">
              {figure.lines.map((line) => (
                <li key={line.currency} className="text-3xl font-semibold tabular-nums">
                  {money(line.amount, line.currency)}
                </li>
              ))}
            </ul>
          )}
          {figure.unvalued > 0 ? (
            <p className="text-sm text-muted-foreground">
              {intl.t('admin.dashboard.revenue.unvalued', { count: figure.unvalued })}
            </p>
          ) : null}
        </div>
      )
    }
    case 'error':
      // La lecture a échoué : la tuile le dit, les autres gardent leur chiffre.
      return (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {intl.t('admin.dashboard.error')}{' '}
            <a href={intl.path(CONSOLE_SCREEN_PATH)} className="underline">
              {intl.t('admin.dashboard.retry')}
            </a>
          </AlertDescription>
        </Alert>
      )
    case 'link':
      return null
  }
}
