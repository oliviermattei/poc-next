'use client'

import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useTheme } from 'next-themes'

import { Button } from '../components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/dropdown-menu'

/**
 * Le commutateur clair / sombre.
 *
 * Trois choix, pas deux : « Système » est un état distinct de « Clair » et de
 * « Sombre » — sans lui, le commutateur ne peut plus rendre la main à la
 * préférence du système une fois qu'on l'a contredite.
 *
 * Les deux icônes sont **superposées** et permutent par la variante `dark:`
 * plutôt que par un état React : rendues côté serveur, elles ne dépendent pas
 * du thème résolu, qui n'est connu qu'après l'hydratation. Le rendre
 * conditionnellement produirait soit un écart d'hydratation, soit un
 * clignotement au premier rendu.
 */
export interface ThemeToggleProps {
  readonly label: string
  readonly options: {
    readonly light: string
    readonly dark: string
    readonly system: string
  }
}

export function ThemeToggle({ label, options }: ThemeToggleProps) {
  const { setTheme } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label}>
          <SunIcon className="dark:hidden" aria-hidden />
          <MoonIcon className="hidden dark:block" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => setTheme('light')}>
          <SunIcon aria-hidden />
          {options.light}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('dark')}>
          <MoonIcon aria-hidden />
          {options.dark}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('system')}>
          <MonitorIcon aria-hidden />
          {options.system}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
