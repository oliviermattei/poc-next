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
import { useTranslations } from 'next-intl'

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
 * jour où l'on est connecté avec le mauvais. Il est donc traduit **avec** son
 * paramètre, jamais concaténé : « Compte — {email} » et « Account — {email} »
 * ne se composent pas dans le même ordre d'une langue à l'autre.
 */
export interface AccountMenuProps {
  readonly email: string
  readonly name: string
  /** L'URL de l'écran de compte, déjà mise dans la forme publique de la locale. */
  readonly accountHref: string
  readonly signOutAction: string
}

export function AccountMenu({ email, name, accountHref, signOutAction }: AccountMenuProps) {
  const t = useTranslations()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('app.shell.account.menu', { email })}>
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
          <a href={accountHref}>
            <SettingsIcon aria-hidden />
            {t('app.shell.account.settings')}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut(signOutAction)}>
          <LogOutIcon aria-hidden />
          {t('app.shell.account.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
