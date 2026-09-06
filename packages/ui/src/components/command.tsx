'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Command as CommandPrimitive } from 'cmdk'
import { SearchIcon } from 'lucide-react'
import type { ComponentProps } from 'react'

import { cn } from '../lib/cn'

/**
 * La palette de recherche — « palette de recherche (back-office,
 * documentation) », dit `docs/design-system.md`.
 *
 * **Copiée depuis shadcn/ui**, comme s29 l'a fait pour `Pagination` et s30 pour
 * `Breadcrumb` : le document la déclarait et ce baril ne la portait pas. Copier
 * n'est pas inventer.
 *
 * Elle repose sur `cmdk`, qui est le socle de la version amont, et non sur une
 * liste écrite à la main : la navigation au clavier, `role="listbox"`,
 * `aria-activedescendant` et l'association de l'entrée de saisie à sa liste
 * viennent de la bibliothèque. `packages/ui/AGENTS.md` en fait une règle — « un
 * composant maison qui réimplémenterait un de ces comportements est un défaut
 * d'accessibilité en attente ». Radix ne publie pas de primitive de palette.
 *
 * Trois écarts avec la copie amont, et chacun a sa raison :
 *
 * 1. **`CommandDialog` est bâti directement sur `@radix-ui/react-dialog`.** La
 *    version amont compose `Dialog`, que ce baril ne porte pas — et cette story
 *    ne livre qu'un composant. La primitive, elle, est déjà une dépendance
 *    (`Sheet`) ;
 * 2. **`title`, `description`, `closeLabel` et le `label` de `CommandList` sont
 *    obligatoires.** La version amont écrit « Command Palette » et « Search for
 *    a command to run… » en dur ; ce package ne connaît ni catalogue ni locale,
 *    et `tests/i18n.test.ts` balaie ses `.tsx` — **un mot suffit**. Le
 *    quatrième a été oublié en s54 et rattrapé à la revue : `cmdk` donne à sa
 *    liste l'`aria-label` par défaut « Suggestions », et cette chaîne-là n'est
 *    dans **aucune source du dépôt** — ni le balayage i18n ni
 *    `tests/rendered-text.test.ts` ne peuvent la voir, la palette ne se rendant
 *    jamais côté serveur. Un type obligatoire est la seule garde qui reste :
 *    `pnpm typecheck` refuse une liste anonyme, et `e2e/docs.spec.ts` mesure le
 *    nom rendu ;
 * 3. **`CommandShortcut` n'est pas copié** : aucun appelant n'affiche de
 *    raccourci dans une entrée, et ce package ne livre pas de code que personne
 *    n'exerce.
 *
 * **Ce composant ne doit pas être rendu par le serveur, et c'est mesurable.**
 * `cmdk` pose sur son étiquette masquée un attribut `style` en ligne, gouverné
 * par `style-src-attr` — la seule directive CSP qui ne connaît pas les nonces
 * (`packages/ui/AGENTS.md`, s45). Monté dans un dialogue, il n'existe qu'après
 * l'ouverture, donc dans le DOM du navigateur, où React écrit par le CSSOM :
 * aucun attribut n'est analysé dans le HTML servi. `CommandDialog` est la
 * forme qui tient cette contrainte ; rendre `Command` dans le flux d'une page
 * servie la casserait. Mutation rejouée à la correction de la revue de s54 :
 * **2 rouges sur 2 723 cas** — `tests/docs.test.ts`, qui refuse l'attribut
 * `style`, et `tests/rendered-text.test.ts`, qui voit alors passer un texte
 * composé par la palette. Le premier est le seul des deux qui juge *cet*
 * invariant. Ni un parcours navigateur (le serveur de développement autorise
 * `'unsafe-inline'` sur les styles) ni un rendu serveur du dialogue ouvert
 * (React ne rend pas les portails hors navigateur — mutation `useState(true)`,
 * **0 rouge**) ne voient ce défaut. Le compte détaillé est dans
 * `packages/ui/AGENTS.md`.
 */
export function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground',
        className,
      )}
      {...props}
    />
  )
}

export interface CommandDialogProps extends ComponentProps<typeof DialogPrimitive.Root> {
  /** Le nom accessible du dialogue, **traduit par l'appelant**. */
  readonly title: string
  /** Ce que la palette fait, pour une aide technique. Traduit par l'appelant. */
  readonly description: string
  /** Le nom accessible du bouton de fermeture. Traduit par l'appelant. */
  readonly closeLabel: string
  /**
   * Laisser `cmdk` filtrer la liste, ou non.
   *
   * Forwardé à `Command` : un appelant qui a déjà classé ses résultats — c'est
   * le cas d'un index de recherche — doit pouvoir couper le filtre par défaut,
   * qui ne voit que le texte rendu et ignorerait le classement.
   */
  readonly shouldFilter?: boolean
  readonly className?: string
}

export function CommandDialog({
  title,
  description,
  closeLabel,
  shouldFilter,
  className,
  children,
  ...props
}: CommandDialogProps) {
  return (
    <DialogPrimitive.Root {...props}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-slot="command-dialog-overlay"
          className="fixed inset-0 z-50 bg-foreground/50"
        />
        <DialogPrimitive.Content
          data-slot="command-dialog-content"
          className={cn(
            'fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2',
            'overflow-hidden rounded-lg border border-border bg-popover p-0 shadow-lg',
            className,
          )}
        >
          {/* Le nom et la description existent pour l'arbre d'accessibilité, pas
              à l'écran : Radix avertit sur un dialogue sans titre, et un
              dialogue anonyme n'est annoncé par rien. */}
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {description}
          </DialogPrimitive.Description>
          {/* `Command` est **ici**, et non chez l'appelant : `CommandInput` et
              `CommandList` lisent son contexte, et les composer hors de lui
              lève à l'exécution. C'est aussi la copie amont.

              `label` remplit l'étiquette masquée que `cmdk` rend et vers
              laquelle l'`aria-labelledby` du champ pointe. Sans elle, cet
              `aria-labelledby` résout un élément **vide** : le champ n'a de nom
              que par le repli des navigateurs sur `aria-label`. */}
          <Command label={title} shouldFilter={shouldFilter}>
            {children}
          </Command>
          <DialogPrimitive.Close className="sr-only">{closeLabel}</DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export function CommandInput({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex h-11 items-center gap-2 border-b border-border px-3"
    >
      <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          'flex h-10 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </div>
  )
}

export interface CommandListProps
  extends Omit<ComponentProps<typeof CommandPrimitive.List>, 'label'> {
  /**
   * Le nom accessible de la liste de résultats, **traduit par l'appelant**.
   *
   * Obligatoire pour la même raison que `title`, `description` et `closeLabel`,
   * et avec une aggravation : omise, `cmdk` ne laisse pas la liste anonyme, il
   * l'annonce « Suggestions » — une chaîne anglaise en dur, dans toutes les
   * locales, qui n'apparaît dans aucun fichier du dépôt et qu'aucun balayage ne
   * peut donc trouver.
   */
  readonly label: string
}

export function CommandList({ className, ...props }: CommandListProps) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn('max-h-80 scroll-py-1 overflow-x-hidden overflow-y-auto', className)}
      {...props}
    />
  )
}

export function CommandEmpty(props: ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className="py-6 text-center text-sm text-muted-foreground"
      {...props}
    />
  )
}

export function CommandGroup({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        'overflow-hidden p-1 text-foreground',
        '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        'relative flex cursor-default flex-col items-start gap-0.5 rounded-sm px-2 py-2 text-sm outline-none select-none',
        'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
        'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export function CommandSeparator({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn('-mx-1 h-px bg-border', className)}
      {...props}
    />
  )
}
