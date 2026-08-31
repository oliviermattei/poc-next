'use client'

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@repo/ui'
import { LogOutIcon, SettingsIcon, UserIcon } from 'lucide-react'

import { signOut } from './sign-out-button'

/**
 * Le menu de compte du shell.
 *
 * Il n'apparaît **que** pour une session : le rendre grisé pour un visiteur
 * anonyme afficherait une adresse email qu'on n'a pas. C'est le composant
 * serveur qui décide, en ne le rendant pas.
 *
 * Le nom accessible du déclencheur porte l'adresse du compte : « menu de
 * compte » seul ne dit pas *quel* compte, et c'est l'information qui compte le
 * jour où l'on est connecté avec le mauvais.
 */
export interface AccountMenuProps {
  readonly email: string
  readonly name: string
  readonly signOutAction: string
}

export function AccountMenu({ email, name, signOutAction }: AccountMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Compte — ${email}`}>
          <UserIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>
          <span className="block truncate font-medium text-foreground">{name}</span>
          <span className="block truncate">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/account">
            <SettingsIcon aria-hidden />
            Paramètres du compte
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut(signOutAction)}>
          <LogOutIcon aria-hidden />
          Se déconnecter
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
