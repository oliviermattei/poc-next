import type { ReactNode } from 'react'

/**
 * L'état vide, **avec l'action qui en sort**.
 *
 * Le design system est explicite : un tableau vide sans action est un écran
 * cassé. L'action est donc dans la signature, pas dans la bonne volonté de
 * l'appelant.
 */
export interface EmptyStateProps {
  readonly icon?: ReactNode
  readonly title: string
  readonly description: string
  readonly action: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-12 text-center">
      {icon === undefined ? null : (
        <div className="text-muted-foreground [&_svg]:size-6" aria-hidden>
          {icon}
        </div>
      )}
      <p className="text-xl font-semibold">{title}</p>
      <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
      {action}
    </div>
  )
}
