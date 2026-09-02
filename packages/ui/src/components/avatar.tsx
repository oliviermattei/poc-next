'use client'

import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from '../lib/cn'

/**
 * L'avatar d'un utilisateur ou d'une organisation, **avec son repli sur les
 * initiales** (`docs/design-system.md`).
 *
 * Le repli est le comportement de Radix, pas une condition d'écran : sans `src`,
 * ou si l'image ne se charge pas, `AvatarFallback` est rendu. C'est ce qui fait
 * qu'un module de stockage coupé n'oblige aucun écran à porter un
 * `if (avatar ?)` — l'URL vaut `null`, et les initiales s'affichent.
 *
 * Deux tailles, et deux seulement : `sm` pour le menu de compte du shell, `lg`
 * pour la carte de paramètres. Une troisième s'ajoutera le jour où un écran la
 * demandera.
 */
const avatarVariants = cva(
  'relative flex shrink-0 overflow-hidden rounded-full border border-border',
  {
    variants: {
      size: {
        sm: 'size-8 text-xs',
        lg: 'size-16 text-base',
      },
    },
    defaultVariants: { size: 'sm' },
  },
)

export type AvatarProps = ComponentProps<typeof AvatarPrimitive.Root> &
  VariantProps<typeof avatarVariants>

export function Avatar({ className, size, ...props }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(avatarVariants({ size }), className)}
      {...props}
    />
  )
}

export function AvatarImage({
  className,
  ...props
}: ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      // `object-cover` : une image qui n'est pas carrée est recadrée, jamais
      // déformée. Un visage étiré est plus laid qu'un visage rogné.
      className={cn('aspect-square size-full object-cover', className)}
      {...props}
    />
  )
}

export function AvatarFallback({
  className,
  ...props
}: ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        'flex size-full items-center justify-center bg-muted font-medium text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}
