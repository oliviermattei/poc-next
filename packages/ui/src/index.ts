/**
 * Le design system du dépôt.
 *
 * **Ce baril est la seule surface** : un module ou un écran compose avec ce
 * qu'il exporte, jamais avec Radix (ADR 022, `pnpm lint` le refuse). Ce qui
 * n'est pas ici n'existe pas encore — un besoin non couvert est un « design
 * system gap » à signaler, jamais à combler sur place.
 *
 * Les composants copiés **à ce jour**, story par story : ceux que s08 utilise
 * réellement. L'inventaire complet de `docs/design-system.md` est plus large ;
 * copier « pour plus tard » livrerait du code que personne n'a exercé.
 */
export { cn } from './lib/cn'

export { Alert, AlertDescription, AlertTitle, type AlertProps } from './components/alert'
export { Badge, type BadgeProps } from './components/badge'
export { Button, buttonVariants, type ButtonProps } from './components/button'
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/card'
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './components/dropdown-menu'
export { Input } from './components/input'
export { Label } from './components/label'
export { Separator } from './components/separator'
export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from './components/sheet'

export { EmptyState, type EmptyStateProps } from './composed/empty-state'
export {
  LocaleSwitcher,
  type LocaleOption,
  type LocaleSwitcherProps,
} from './composed/locale-switcher'
export { PageHeader, type PageHeaderProps } from './composed/page-header'
export {
  Sidebar,
  SidebarBrand,
  SidebarNav,
  type SidebarItem,
  type SidebarNavProps,
} from './composed/sidebar'
export { ThemeProvider } from './composed/theme-provider'
export { ThemeToggle, type ThemeToggleProps } from './composed/theme-toggle'
