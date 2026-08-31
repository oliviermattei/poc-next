import * as LabelPrimitive from '@radix-ui/react-label'
import type { ComponentProps } from 'react'

import { cn } from '../lib/cn'

/**
 * L'étiquette d'un champ. La primitive Radix relie l'étiquette au champ et
 * transmet le clic : c'est ce qu'on écrirait mal à la main, et c'est ce que
 * `getByLabel` exerce dans les parcours.
 */
export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-sm leading-none font-medium select-none',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
