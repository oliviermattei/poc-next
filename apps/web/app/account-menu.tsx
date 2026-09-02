'use client'

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  initialsOf,
} from '@repo/ui'
import { LogOutIcon, SettingsIcon } from 'lucide-react'
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
  /**
   * L'avatar du compte, ou `null`.
   *
   * `null` quand il n'y en a pas **et** quand le module de stockage est coupé :
   * ce composant ne connaît pas la différence, et c'est voulu. Le repli sur les
   * initiales est le comportement d'`Avatar`, pas une condition écrite ici.
   */
  readonly avatarUrl: string | null
}

export function AccountMenu({
  email,
  name,
  accountHref,
  signOutAction,
  avatarUrl,
}: AccountMenuProps) {
  const t = useTranslations()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('app.shell.account.menu', { email })}>
          {/*
            L'image est **décorative ici** (`alt=""`) : le nom accessible du
            bouton porte déjà l'adresse du compte, et un second texte ne ferait
            que répéter. Elle est informative dans la carte des paramètres, où
            rien d'autre ne la nomme.
          */}
          <Avatar size="sm" className="border-0">
            {avatarUrl === null ? null : <AvatarImage src={avatarUrl} alt="" />}
            <AvatarFallback>{initialsOf(name)}</AvatarFallback>
          </Avatar>
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
