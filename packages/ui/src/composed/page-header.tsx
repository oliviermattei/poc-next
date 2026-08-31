import type { ReactNode } from 'react'

/**
 * Le tête de chaque page applicative : titre, description, actions.
 *
 * `h1` du design system — 1,875rem / 600. Un seul par page : c'est ce qui donne
 * son titre au document pour un lecteur d'écran.
 */
export interface PageHeaderProps {
  readonly title: string
  readonly description?: string
  readonly actions?: ReactNode
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {description === undefined ? null : (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions === undefined ? null : <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
