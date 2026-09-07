import {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  AvatarFallback,
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Pagination,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  initialsOf,
} from '@repo/ui'
import { MailIcon, MessageSquareIcon, UsersIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import type {
  AdminAccountsView,
  AdminAccountView,
  AdminFeedbackView,
  AdminOrganizationsView,
  AdminOrganizationView,
  AdminRevenueView,
  AdminSubscriptionsView,
} from '../application/admin-use-cases'
import type { AdminIntl } from './admin-intl'

/**
 * Les écrans du back-office — **composés, jamais inventés**.
 *
 * Tout vient de `@repo/ui` (`docs/design-system.md`) : `PageHeader`, `Table`,
 * `Pagination`, `Input`, `EmptyState`, `Card`, `Badge`, `Avatar`, `Alert`,
 * `Breadcrumb`, `Button`. Aucune primitive maison, aucune couleur Tailwind
 * brute, aucun texte en dur.
 *
 * **Aucun composant client.** La recherche est un `<form method="get">` — une
 * recherche *est* une adresse : elle se copie, se met en signet et fonctionne
 * avant l'hydratation. La pagination est faite de liens, pour la même raison.
 * Les deux actions du détail postent nativement vers les routes du module.
 *
 * **Aucune décision d'autorisation ici** : quand ces composants sont rendus,
 * la garde du module a déjà répondu. Un écran ne cache pas ce qu'un serveur
 * servirait (`docs/security.md` §3).
 */

/** Les clés du catalogue, écrites une fois. Un littéral recopié divergerait. */
const K = {
  usersTitle: 'admin.users.title',
  usersDescription: 'admin.users.description',
  usersCaption: 'admin.users.caption',
  searchLabel: 'admin.search.label',
  searchSubmit: 'admin.search.submit',
  columnAccount: 'admin.users.column.account',
  columnRights: 'admin.users.column.rights',
  columnStatus: 'admin.users.column.status',
  columnSignedUp: 'admin.users.column.signedUp',
  statusActive: 'admin.status.active',
  statusBanned: 'admin.status.banned',
  statusUnverified: 'admin.status.unverified',
  rightsSuperadmin: 'admin.rights.superadmin',
  rightsNone: 'admin.rights.none',
  emptyTitle: 'admin.users.empty.title',
  emptyDescription: 'admin.users.empty.description',
  emptyAction: 'admin.users.empty.action',
  errorTitle: 'admin.error.title',
  errorDescription: 'admin.error.description',
  paginationLabel: 'admin.pagination.label',
  paginationPrevious: 'admin.pagination.previous',
  paginationNext: 'admin.pagination.next',
  paginationPage: 'admin.pagination.page',
  breadcrumbRoot: 'admin.breadcrumb.root',
  breadcrumbLabel: 'admin.breadcrumb.label',
  accountTitle: 'admin.account.title',
  accountOrganizations: 'admin.account.organizations',
  accountOrganizationsDescription: 'admin.account.organizationsDescription',
  accountOrganizationsEmpty: 'admin.account.organizationsEmpty',
  accountRights: 'admin.account.rights',
  accountRightsDescription: 'admin.account.rightsDescription',
  accountSessions: 'admin.account.sessions',
  accountSessionsDescription: 'admin.account.sessionsDescription',
  accountSessionsEmpty: 'admin.account.sessionsEmpty',
  sessionUnknownDevice: 'admin.account.sessionUnknownDevice',
  sessionSince: 'admin.account.sessionSince',
  revokeSession: 'admin.account.revokeSession',
  revokeSessionFor: 'admin.account.revokeSessionFor',
  passwordReset: 'admin.account.passwordReset',
  organizationsTitle: 'admin.organizations.title',
  organizationsDescription: 'admin.organizations.description',
  organizationsCaption: 'admin.organizations.caption',
  organizationsEmptyTitle: 'admin.organizations.empty.title',
  organizationsEmptyDescription: 'admin.organizations.empty.description',
  columnOrganization: 'admin.organizations.column.organization',
  columnMembers: 'admin.organizations.column.members',
  columnOffer: 'admin.organizations.column.offer',
  columnSubscription: 'admin.organizations.column.subscription',
  organizationMembers: 'admin.organization.members',
  organizationMembersDescription: 'admin.organization.membersDescription',
  organizationBilling: 'admin.organization.billing',
  organizationBillingDescription: 'admin.organization.billingDescription',
  organizationMembersCaption: 'admin.organization.membersCaption',
  columnMember: 'admin.organization.column.member',
  revenueTitle: 'admin.revenue.title',
  revenueDescription: 'admin.revenue.description',
  periodLabel: 'admin.revenue.periodLabel',
  recurringTitle: 'admin.revenue.recurring.title',
  recurringNote: 'admin.revenue.recurring.note',
  recurringPeriodNote: 'admin.revenue.recurring.periodNote',
  recurringEmpty: 'admin.revenue.recurring.empty',
  recurringCaption: 'admin.revenue.recurring.caption',
  oneTimeTitle: 'admin.revenue.oneTime.title',
  oneTimeNote: 'admin.revenue.oneTime.note',
  oneTimeEmpty: 'admin.revenue.oneTime.empty',
  oneTimeCaption: 'admin.revenue.oneTime.caption',
  statesTitle: 'admin.revenue.states.title',
  statesDescription: 'admin.revenue.states.description',
  statesCaption: 'admin.revenue.states.caption',
  columnCurrency: 'admin.revenue.column.currency',
  columnAmount: 'admin.revenue.column.amount',
  columnSubscriptions: 'admin.revenue.column.subscriptions',
  columnPurchases: 'admin.revenue.column.purchases',
  columnState: 'admin.revenue.column.state',
  columnCounted: 'admin.revenue.column.counted',
  countedYes: 'admin.revenue.counted.yes',
  countedNo: 'admin.revenue.counted.no',
  revenueEmptyTitle: 'admin.revenue.empty.title',
  revenueEmptyDescription: 'admin.revenue.empty.description',
  columnRole: 'admin.organization.column.role',
  subscriptionsTitle: 'admin.subscriptions.title',
  subscriptionsDescription: 'admin.subscriptions.description',
  subscriptionsCaption: 'admin.subscriptions.caption',
  subscriptionsEmptyTitle: 'admin.subscriptions.empty.title',
  subscriptionsEmptyDescription: 'admin.subscriptions.empty.description',
  columnEmail: 'admin.subscriptions.column.email',
  columnSource: 'admin.subscriptions.column.source',
  columnLocale: 'admin.subscriptions.column.locale',
  columnSubscribedAt: 'admin.subscriptions.column.subscribedAt',
  sourceFilterLabel: 'admin.subscriptions.sourceFilter',
  allSources: 'admin.subscriptions.allSources',
  exportSubscriptions: 'admin.subscriptions.export',
  feedbackTitle: 'admin.feedback.title',
  feedbackDescription: 'admin.feedback.description',
  feedbackCaption: 'admin.feedback.caption',
  feedbackEmptyTitle: 'admin.feedback.empty.title',
  feedbackEmptyDescription: 'admin.feedback.empty.description',
  columnFeedback: 'admin.feedback.column.message',
  columnAuthor: 'admin.feedback.column.author',
  columnCategory: 'admin.feedback.column.category',
  columnOrigin: 'admin.feedback.column.origin',
  columnReceivedAt: 'admin.feedback.column.receivedAt',
  categoryFilterLabel: 'admin.feedback.categoryFilter',
  statusFilterLabel: 'admin.feedback.statusFilter',
  allCategories: 'admin.feedback.allCategories',
  allStatuses: 'admin.feedback.allStatuses',
  markHandled: 'admin.feedback.markHandled',
  markHandledFor: 'admin.feedback.markHandledFor',
  originNone: 'admin.feedback.originNone',
  authorDeleted: 'admin.feedback.authorDeleted',
  none: 'admin.none',
} as const

/** L'état d'abonnement, traduit par une clé — jamais par la valeur brute. */
const subscriptionKey = (state: string): string => `admin.subscription.${state}`

/**
 * La période, traduite par une clé — la même discipline que l'état.
 *
 * Le vocabulaire appartient à la facturation ; ce module n'en connaît que
 * l'identifiant, et `intl.t` **lève** sur une clé absente. `tests/admin.test.ts`
 * exige donc un libellé par période déclarée, dans chaque locale : une période
 * ajoutée là-bas force une décision ici plutôt que de rendre un écran en 500.
 */
const periodKey = (period: string): string => `admin.revenue.period.${period}`

/** Le rôle d'un membre, traduit par une clé — la même discipline. */
const roleKey = (role: string): string => `admin.role.${role}`

/**
 * La catégorie et le statut d'un retour, traduits par une clé — la même
 * discipline que l'état d'abonnement et la période.
 *
 * Le vocabulaire appartient au module qui possède les retours ; ce module n'en
 * connaît que la valeur, et `intl.t` **lève** sur une clé absente.
 * `tests/feedback.test.ts` exige donc un libellé par valeur déclarée, dans
 * chaque locale : une catégorie ajoutée là-bas force une décision ici plutôt que
 * de rendre un écran en 500.
 *
 * C'est la différence avec la **source** d'une inscription, rendue telle quelle :
 * celle-ci est un vocabulaire ouvert, lu en base, qu'aucune liste ne borne.
 */
const feedbackCategoryKey = (category: string): string => `admin.feedback.category.${category}`

const feedbackStatusKey = (status: string): string => `admin.feedback.status.${status}`

/**
 * Le statut qui retire le bouton d'action — écrit une fois, **hors du JSX**.
 *
 * Un littéral d'un seul mot entre accolades dans des enfants est lu comme du
 * texte affiché par `tests/i18n.test.ts`, et il a raison de le lire ainsi : la
 * comparaison vit donc dans une constante nommée.
 */
const HANDLED_STATUS = 'handled'

/** Ce dont chaque liste a besoin pour construire ses adresses. */
export interface BackOfficeListLinks {
  /** L'adresse de cette liste, sans paramètre : la cible du formulaire de recherche. */
  readonly listPath: string
  /** L'adresse d'une ligne. L'appelant sait seul comment son chemin s'écrit. */
  readonly detailPath: (id: string) => string
}

/**
 * **Ce qu'une liste doit emporter d'un geste à l'autre**, en plus de sa
 * recherche et de sa page.
 *
 * Une liste peut porter d'autres critères que sa recherche — le filtre par
 * source des inscriptions (s37c) est le premier. Chacun d'eux **borne le
 * nombre de pages** : le perdre en paginant ou en cherchant sert une liste
 * plausible et fausse, pas une panne. Les deux gestes le reportent donc, l'un
 * dans son lien, l'autre dans un champ caché — un `GET` de formulaire
 * **remplace** la chaîne de requête.
 *
 * Un enregistrement, et non un paramètre nommé : ce composant est partagé par
 * les listes du back-office, et il n'a pas à connaître le vocabulaire de
 * l'une d'elles.
 */
type ListFilters = Readonly<Record<string, string>>

const NO_FILTERS: ListFilters = {}

/**
 * Le formulaire de recherche : **`method="get"`, écrit en toutes lettres**.
 *
 * `pnpm lint` le refuse autrement, et sans lui un `<form>` non hydraté retombe
 * sur le `GET` du navigateur en mettant ses champs dans l'URL — ce qui est ici
 * exactement ce qu'on veut, mais qui ne doit jamais être un accident
 * (`docs/security.md` §5).
 *
 * La page, elle, n'est **pas** reportée : chercher autre chose remet à la
 * première page, sans quoi on atterrirait sur une page qui n'existe plus.
 */
function SearchForm({
  action,
  search,
  filters = NO_FILTERS,
  intl,
}: {
  readonly action: string
  readonly search: string | null
  readonly filters?: ListFilters
  readonly intl: AdminIntl
}) {
  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-2">
      {Object.entries(filters).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="min-w-0 flex-1 space-y-1.5">
        <Label htmlFor="admin-search">{intl.t(K.searchLabel)}</Label>
        <Input id="admin-search" name="q" type="search" defaultValue={search ?? ''} />
      </div>
      <Button type="submit" variant="secondary">
        {intl.t(K.searchSubmit)}
      </Button>
    </form>
  )
}

/**
 * La pagination d'une liste, **avec sa recherche et ses filtres conservés**.
 *
 * Sans le paramètre de recherche dans le lien, passer à la page 2 rendrait la
 * page 2 de *tous* les comptes : la liste changerait sous les pieds de qui
 * cherche. Un filtre déclaré (`filters`) suit la même règle, et pour la même
 * raison : le nombre de pages a été calculé sur le total qu'il restreint.
 */
function ListPagination({
  page,
  pageCount,
  search,
  filters = NO_FILTERS,
  listPath,
  intl,
}: {
  readonly page: number
  readonly pageCount: number
  readonly search: string | null
  readonly filters?: ListFilters
  readonly listPath: string
  readonly intl: AdminIntl
}) {
  if (pageCount < 2) {
    return null
  }

  return (
    <Pagination
      page={page}
      pageCount={pageCount}
      hrefFor={(target) => {
        const parameters = new URLSearchParams()

        for (const [name, value] of Object.entries(filters)) {
          parameters.set(name, value)
        }

        if (search !== null) {
          parameters.set('q', search)
        }

        parameters.set('page', String(target))

        return `${intl.path(listPath)}?${parameters.toString()}`
      }}
      label={intl.t(K.paginationLabel)}
      previousLabel={intl.t(K.paginationPrevious)}
      nextLabel={intl.t(K.paginationNext)}
      pageLabel={(target) => intl.t(K.paginationPage, { page: String(target) })}
    />
  )
}

/**
 * L'alerte d'une lecture en échec — **et pas une liste vide**.
 *
 * C'est la distinction que la story tient : « aucun compte » est une réponse,
 * une panne de lecture n'en est pas une, et les confondre ferait mentir le
 * back-office à celui qui administre.
 */
export function BackOfficeError({ intl }: { readonly intl: AdminIntl }) {
  return (
    <Alert variant="destructive" role="alert">
      <AlertTitle>{intl.t(K.errorTitle)}</AlertTitle>
      <AlertDescription>{intl.t(K.errorDescription)}</AlertDescription>
    </Alert>
  )
}

/**
 * La navigation du back-office, **dérivée du registre** (ADR 066).
 *
 * L'appelant lui passe `visibleNavigation(registry, session, 'admin')`, déjà
 * traduit : ce composant ne sait pas qu'un module s'appelle `organizations`, et
 * l'entrée disparaît avec lui sans qu'aucune condition ne soit écrite ici.
 */
export interface BackOfficeNavigationItem {
  readonly key: string
  readonly href: string
  readonly label: string
  readonly current: boolean
}

function BackOfficeNavigation({
  items,
  label,
}: {
  readonly items: readonly BackOfficeNavigationItem[]
  readonly label: string
}) {
  if (items.length === 0) {
    return null
  }

  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Button
          key={item.key}
          asChild
          variant={item.current ? 'secondary' : 'ghost'}
        >
          <a href={item.href} aria-current={item.current ? 'page' : undefined}>
            {item.label}
          </a>
        </Button>
      ))}
    </nav>
  )
}

/** L'enveloppe commune : navigation dérivée, en-tête, contenu. */
function BackOfficeShell({
  navigation,
  navigationLabel,
  header,
  children,
}: {
  readonly navigation: readonly BackOfficeNavigationItem[]
  readonly navigationLabel: string
  readonly header: ReactNode
  readonly children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <BackOfficeNavigation items={navigation} label={navigationLabel} />
      {header}
      {children}
    </div>
  )
}

/** Le badge d'état d'un compte : actif, non vérifié, banni. */
function AccountStatus({
  account,
  intl,
}: {
  readonly account: { readonly banned: boolean; readonly emailVerified: boolean }
  readonly intl: AdminIntl
}) {
  if (account.banned) {
    return <Badge variant="destructive">{intl.t(K.statusBanned)}</Badge>
  }

  return account.emailVerified ? (
    <Badge variant="secondary">{intl.t(K.statusActive)}</Badge>
  ) : (
    <Badge variant="outline">{intl.t(K.statusUnverified)}</Badge>
  )
}

export interface AdminUsersScreenProps {
  readonly view: AdminAccountsView
  readonly intl: AdminIntl
  readonly links: BackOfficeListLinks
  readonly navigation: readonly BackOfficeNavigationItem[]
}

/** `/admin/users` — la liste des comptes : recherche, pagination, quatre états. */
export function AdminUsersScreen({ view, intl, links, navigation }: AdminUsersScreenProps) {
  return (
    <BackOfficeShell
      navigation={navigation}
      navigationLabel={intl.t(K.breadcrumbRoot)}
      header={
        <PageHeader title={intl.t(K.usersTitle)} description={intl.t(K.usersDescription)} />
      }
    >
      <SearchForm action={intl.path(links.listPath)} search={view.search} intl={intl} />

      {view.accounts.length === 0 ? (
        <EmptyState
          icon={<UsersIcon aria-hidden />}
          title={intl.t(K.emptyTitle)}
          description={intl.t(K.emptyDescription)}
          action={
            <Button asChild variant="secondary">
              <a href={intl.path(links.listPath)}>{intl.t(K.emptyAction)}</a>
            </Button>
          }
        />
      ) : (
        <Table>
          <TableCaption>{intl.t(K.usersCaption, { total: String(view.total) })}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{intl.t(K.columnAccount)}</TableHead>
              <TableHead>{intl.t(K.columnRights)}</TableHead>
              <TableHead>{intl.t(K.columnStatus)}</TableHead>
              <TableHead>{intl.t(K.columnSignedUp)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.accounts.map((account) => (
              <TableRow key={account.userId}>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar>
                      <AvatarFallback>{initialsOf(account.name)}</AvatarFallback>
                    </Avatar>
                    <a
                      href={intl.path(links.detailPath(account.userId))}
                      className="min-w-0 truncate font-medium underline-offset-4 hover:underline"
                    >
                      {account.email}
                    </a>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={account.superadmin ? 'default' : 'outline'}>
                    {intl.t(account.superadmin ? K.rightsSuperadmin : K.rightsNone)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <AccountStatus account={account} intl={intl} />
                </TableCell>
                <TableCell>{intl.date(account.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ListPagination
        page={view.page}
        pageCount={view.pageCount}
        search={view.search}
        listPath={links.listPath}
        intl={intl}
      />
    </BackOfficeShell>
  )
}

export interface AdminUserScreenProps {
  readonly view: AdminAccountView
  readonly intl: AdminIntl
  readonly links: BackOfficeListLinks
  readonly navigation: readonly BackOfficeNavigationItem[]
  /** URL des routes du module, résolues par l'application. */
  readonly actions: {
    readonly revokeSession: string
    readonly sendPasswordReset: string
  }
}

/** `/admin/users/<id>` — le détail : organisations, droits, sessions actives. */
export function AdminUserScreen({
  view,
  intl,
  links,
  navigation,
  actions,
}: AdminUserScreenProps) {
  return (
    <BackOfficeShell
      navigation={navigation}
      navigationLabel={intl.t(K.breadcrumbRoot)}
      header={
        <>
          <Breadcrumb label={intl.t(K.breadcrumbLabel)}>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href={intl.path(links.listPath)}>
                  {intl.t(K.usersTitle)}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{view.account.email}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <PageHeader
            title={view.account.email}
            description={intl.t(K.accountTitle, {
              date: intl.date(view.account.createdAt),
            })}
            actions={
              <form method="post" action={actions.sendPasswordReset}>
                <input type="hidden" name="userId" value={view.account.userId} />
                <Button type="submit" variant="secondary">
                  {intl.t(K.passwordReset)}
                </Button>
              </form>
            }
          />
        </>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>{intl.t(K.accountOrganizations)}</CardTitle>
          <CardDescription>{intl.t(K.accountOrganizationsDescription)}</CardDescription>
        </CardHeader>
        <CardContent>
          {view.memberships.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {intl.t(K.accountOrganizationsEmpty)}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {view.memberships.map((membership) => (
                <li
                  key={membership.organizationId}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-2"
                >
                  <span className="min-w-0 truncate">{membership.name}</span>
                  <Badge variant="secondary">{intl.t(roleKey(membership.role))}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.t(K.accountRights)}</CardTitle>
          <CardDescription>{intl.t(K.accountRightsDescription)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Badge variant={view.superadmin ? 'default' : 'outline'}>
            {intl.t(view.superadmin ? K.rightsSuperadmin : K.rightsNone)}
          </Badge>
          <AccountStatus account={view.account} intl={intl} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.t(K.accountSessions)}</CardTitle>
          <CardDescription>{intl.t(K.accountSessionsDescription)}</CardDescription>
        </CardHeader>
        <CardContent>
          {view.sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{intl.t(K.accountSessionsEmpty)}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {view.sessions.map((session) => {
                const device = session.userAgent ?? intl.t(K.sessionUnknownDevice)

                return (
                  <li
                    key={session.sessionId}
                    className="flex min-w-0 flex-wrap items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{device}</p>
                      <p className="text-sm text-muted-foreground">
                        {intl.t(K.sessionSince, { date: intl.date(session.createdAt) })}
                      </p>
                    </div>
                    {/*
                      **Une action irréversible sans confirmation composable.**
                      `ConfirmDialog` et `AlertDialog` ne sont pas livrés par le
                      design system : la lacune est reportée (s34b, s37b2), pas
                      comblée ici. Le libellé nomme donc l'effet, et le bouton
                      porte la variante destructrice.
                    */}
                    <form method="post" action={actions.revokeSession}>
                      <input type="hidden" name="userId" value={view.account.userId} />
                      <input type="hidden" name="sessionId" value={session.sessionId} />
                      <Button
                        type="submit"
                        variant="destructive"
                        aria-label={intl.t(K.revokeSessionFor, { device })}
                      >
                        {intl.t(K.revokeSession)}
                      </Button>
                    </form>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </BackOfficeShell>
  )
}

export interface AdminOrganizationsScreenProps {
  readonly view: AdminOrganizationsView
  readonly intl: AdminIntl
  readonly links: BackOfficeListLinks
  readonly navigation: readonly BackOfficeNavigationItem[]
}

/** `/admin/organizations` — même structure que la liste des comptes. */
export function AdminOrganizationsScreen({
  view,
  intl,
  links,
  navigation,
}: AdminOrganizationsScreenProps) {
  return (
    <BackOfficeShell
      navigation={navigation}
      navigationLabel={intl.t(K.breadcrumbRoot)}
      header={
        <PageHeader
          title={intl.t(K.organizationsTitle)}
          description={intl.t(K.organizationsDescription)}
        />
      }
    >
      <SearchForm action={intl.path(links.listPath)} search={view.search} intl={intl} />

      {view.organizations.length === 0 ? (
        <EmptyState
          title={intl.t(K.organizationsEmptyTitle)}
          description={intl.t(K.organizationsEmptyDescription)}
          action={
            <Button asChild variant="secondary">
              <a href={intl.path(links.listPath)}>{intl.t(K.emptyAction)}</a>
            </Button>
          }
        />
      ) : (
        <Table>
          <TableCaption>
            {intl.t(K.organizationsCaption, { total: String(view.total) })}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{intl.t(K.columnOrganization)}</TableHead>
              <TableHead>{intl.t(K.columnMembers)}</TableHead>
              <TableHead>{intl.t(K.columnOffer)}</TableHead>
              <TableHead>{intl.t(K.columnSubscription)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.organizations.map((organization) => (
              <TableRow key={organization.organizationId}>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar>
                      <AvatarFallback>{initialsOf(organization.name)}</AvatarFallback>
                    </Avatar>
                    <a
                      href={intl.path(links.detailPath(organization.organizationId))}
                      className="min-w-0 truncate font-medium underline-offset-4 hover:underline"
                    >
                      {organization.name}
                    </a>
                  </div>
                </TableCell>
                <TableCell>{String(organization.memberCount)}</TableCell>
                <TableCell>{organization.offerId ?? intl.t(K.none)}</TableCell>
                <TableCell>
                  {organization.subscriptionState === null ? (
                    <Badge variant="outline">{intl.t(K.none)}</Badge>
                  ) : (
                    <Badge variant="secondary">
                      {intl.t(subscriptionKey(organization.subscriptionState))}
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ListPagination
        page={view.page}
        pageCount={view.pageCount}
        search={view.search}
        listPath={links.listPath}
        intl={intl}
      />
    </BackOfficeShell>
  )
}

export interface AdminOrganizationScreenProps {
  readonly view: AdminOrganizationView
  readonly intl: AdminIntl
  readonly links: BackOfficeListLinks
  /**
   * L'adresse du détail d'un **compte** — celui d'un membre de cette
   * organisation (revue de s37b2, constat F6).
   *
   * Injectée comme `links.detailPath`, et pour la même raison : l'écran ne sait
   * pas comment ses chemins s'écrivent. Elle l'était en dur ici, alors que
   * `ADMIN_USERS_SCREEN_PATH` est déclaré « écrit une fois : deux copies
   * divergeraient » — la page la tire désormais de cette constante, comme les
   * deux redirections des routes du module.
   */
  readonly accountPath: (userId: string) => string
  readonly navigation: readonly BackOfficeNavigationItem[]
}

/** `/admin/organizations/<id>` — membres et rôles, offre et état d'abonnement. */
export function AdminOrganizationScreen({
  view,
  intl,
  links,
  accountPath,
  navigation,
}: AdminOrganizationScreenProps) {
  return (
    <BackOfficeShell
      navigation={navigation}
      navigationLabel={intl.t(K.breadcrumbRoot)}
      header={
        <>
          <Breadcrumb label={intl.t(K.breadcrumbLabel)}>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href={intl.path(links.listPath)}>
                  {intl.t(K.organizationsTitle)}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{view.organization.name}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <PageHeader
            title={view.organization.name}
            description={view.organization.slug}
          />
        </>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>{intl.t(K.organizationMembers)}</CardTitle>
          <CardDescription>{intl.t(K.organizationMembersDescription)}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableCaption>
              {intl.t(K.organizationMembersCaption, {
                total: String(view.organization.memberCount),
              })}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{intl.t(K.columnMember)}</TableHead>
                <TableHead>{intl.t(K.columnRole)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.members.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell>
                    <a
                      href={intl.path(accountPath(member.userId))}
                      className="min-w-0 truncate underline-offset-4 hover:underline"
                    >
                      {member.email}
                    </a>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{intl.t(roleKey(member.role))}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.t(K.organizationBilling)}</CardTitle>
          <CardDescription>{intl.t(K.organizationBillingDescription)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{view.organization.offerId ?? intl.t(K.none)}</Badge>
          {view.organization.subscriptionState === null ? (
            <Badge variant="outline">{intl.t(K.none)}</Badge>
          ) : (
            <Badge variant="secondary">
              {intl.t(subscriptionKey(view.organization.subscriptionState))}
            </Badge>
          )}
        </CardContent>
      </Card>
    </BackOfficeShell>
  )
}

export interface AdminRevenueScreenProps {
  readonly view: AdminRevenueView
  readonly intl: AdminIntl
  readonly navigation: readonly BackOfficeNavigationItem[]
  /**
   * Le chemin **interne** de cet écran, injecté comme `links.listPath` l'est
   * aux listes, et pour la même raison : il est déclaré par le module qui porte
   * les montants (`ADMIN_REVENUE_SCREEN_PATH`, dans `billing`), et ce module-ci
   * ne le connaît pas. Le préfixe de langue est reposé par `intl.path`.
   */
  readonly screenPath: string
}

/**
 * **Le choix de la période** (critère 4) — des **liens**, pas un formulaire.
 *
 * Une période *est* une adresse : elle se copie, se met en signet, se recharge,
 * et elle fonctionne avant l'hydratation. C'est la raison qui a fait de la
 * pagination des liens, et elle vaut deux fois ici : cet écran n'a aucun
 * composant client.
 *
 * La période retenue est celle que la **facturation** a validée, pas celle que
 * l'adresse portait : une valeur inconnue retombe sur le défaut, et c'est ce
 * défaut qui s'affiche comme courant. `aria-current` porte la distinction pour
 * qui n'a pas la couleur.
 */
function PeriodPicker({
  periods,
  screenPath,
  intl,
}: {
  readonly periods: readonly { readonly id: string; readonly current: boolean }[]
  readonly screenPath: string
  readonly intl: AdminIntl
}) {
  return (
    <nav aria-label={intl.t(K.periodLabel)} className="flex flex-wrap gap-2">
      {periods.map((period) => (
        <Button
          key={period.id}
          asChild
          variant={period.current ? 'default' : 'outline'}
        >
          <a
            href={`${intl.path(screenPath)}?period=${encodeURIComponent(period.id)}`}
            aria-current={period.current ? 'page' : undefined}
          >
            {intl.t(periodKey(period.id))}
          </a>
        </Button>
      ))}
    </nav>
  )
}

/**
 * **Un tableau de montants, dans une devise à la fois.**
 *
 * Aucune ligne de total : `config/billing.ts` déclare une devise par offre, et
 * un total qui additionnerait des euros et des dollars serait faux dans les
 * deux sans que rien ne le montre. La décision est prise dans le `domain` de la
 * facturation ; cet écran ne la rattrape pas en fin de tableau.
 */
function CurrencyTable({
  caption,
  countColumn,
  rows,
  intl,
}: {
  readonly caption: string
  readonly countColumn: string
  readonly rows: readonly {
    readonly currency: string
    readonly amount: number
    readonly count: number
  }[]
  readonly intl: AdminIntl
}) {
  return (
    <Table>
      <TableCaption>{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>{intl.t(K.columnCurrency)}</TableHead>
          <TableHead>{intl.t(K.columnAmount)}</TableHead>
          <TableHead>{countColumn}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.currency}>
            <TableCell>{row.currency.toUpperCase()}</TableCell>
            <TableCell>{intl.money(row.amount, row.currency)}</TableCell>
            <TableCell>{String(row.count)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/**
 * `/admin/revenue` — **les deux moitiés du revenu, et ce que chacune vaut**
 * (s38).
 *
 * L'écran dit lui-même le statut de ses chiffres, et ce n'est pas de la
 * prudence rédactionnelle : le récurrent est **estimé** — le dépôt ne stocke
 * aucun montant d'abonnement, ces euros viennent de `config/billing.ts`, dont
 * l'en-tête dit que ces champs « ne servent qu'à l'affichage » —, le ponctuel
 * est **constaté**, c'est ce qui a été prélevé. Sans ces deux phrases, une
 * déclaration locale devient de la comptabilité au premier lecteur pressé.
 *
 * Les deux ne sont jamais additionnées, et aucun total inter-devises n'existe.
 */
export function AdminRevenueScreen({
  view,
  intl,
  navigation,
  screenPath,
}: AdminRevenueScreenProps) {
  const subscriptions = view.revenue.states.reduce(
    (total, state) => total + state.subscriptions,
    0,
  )

  return (
    <BackOfficeShell
      navigation={navigation}
      navigationLabel={intl.t(K.breadcrumbRoot)}
      header={
        <>
          <PageHeader title={intl.t(K.revenueTitle)} description={intl.t(K.revenueDescription)} />
          <PeriodPicker periods={view.revenue.periods} screenPath={screenPath} intl={intl} />
        </>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>{intl.t(K.recurringTitle)}</CardTitle>
          {/*
            **Le statut du chiffre, à côté du chiffre.** Il porte aussi ce qui
            n'a pas pu être valorisé : un abonnement dont le prix a quitté le
            catalogue ferait sinon baisser le total sans que rien ne le dise.
          */}
          <CardDescription>
            {intl.t(K.recurringNote, { unvalued: String(view.revenue.recurringUnvalued) })}
          </CardDescription>
          {/*
            **La période ne s'applique pas à ce chiffre-ci**, et le taire serait
            pire que de ne pas offrir de période du tout : le lecteur vient de
            choisir « 30 derniers jours », et il lirait ce nombre comme le
            récurrent de ces trente jours. Le dépôt ne stocke aucun instantané
            daté du parc d'abonnements ; ce nombre est celui d'aujourd'hui, et il
            n'en existe aucun autre.
          */}
          <CardDescription>{intl.t(K.recurringPeriodNote)}</CardDescription>
        </CardHeader>
        <CardContent>
          {view.revenue.recurring.length === 0 ? (
            <p className="text-sm text-muted-foreground">{intl.t(K.recurringEmpty)}</p>
          ) : (
            <CurrencyTable
              // La légende **compte**, elle ne répète pas le titre de la carte :
              // combien d'abonnements ont rempli ces devises, ce qu'aucune autre
              // ligne de l'écran ne dit.
              caption={intl.t(K.recurringCaption, {
                subscriptions: String(
                  view.revenue.recurring.reduce((total, row) => total + row.subscriptions, 0),
                ),
                currencies: String(view.revenue.recurring.length),
              })}
              countColumn={intl.t(K.columnSubscriptions)}
              rows={view.revenue.recurring.map((row) => ({
                currency: row.currency,
                amount: row.amount,
                count: row.subscriptions,
              }))}
              intl={intl}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.t(K.oneTimeTitle)}</CardTitle>
          <CardDescription>
            {intl.t(K.oneTimeNote, { unvalued: String(view.revenue.oneTimeUnvalued) })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {view.revenue.oneTime.length === 0 ? (
            <p className="text-sm text-muted-foreground">{intl.t(K.oneTimeEmpty)}</p>
          ) : (
            <CurrencyTable
              caption={intl.t(K.oneTimeCaption, {
                purchases: String(
                  view.revenue.oneTime.reduce((total, row) => total + row.purchases, 0),
                ),
                currencies: String(view.revenue.oneTime.length),
              })}
              countColumn={intl.t(K.columnPurchases)}
              rows={view.revenue.oneTime.map((row) => ({
                currency: row.currency,
                amount: row.amount,
                count: row.purchases,
              }))}
              intl={intl}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.t(K.statesTitle)}</CardTitle>
          <CardDescription>{intl.t(K.statesDescription)}</CardDescription>
        </CardHeader>
        <CardContent>
          {subscriptions === 0 ? (
            /*
              **Zéro est une réponse, et elle a sa forme.** Pas de tiret : un
              tiret dit « on ne sait pas », ce qui n'est pas la même chose
              qu'« aucun abonnement ». L'action est absente parce qu'il n'y en a
              aucune à proposer — un back-office ne vend rien.

              La condition porte sur le **total**, pas sur la longueur de la
              liste : celle-ci porte désormais tous les états, ceux à zéro
              compris, si bien qu'elle n'est jamais vide. Un état absent de
              l'écran laisserait un lecteur incapable de distinguer « 0 » de
              « non suivi ».
            */
            <EmptyState
              title={intl.t(K.revenueEmptyTitle)}
              description={intl.t(K.revenueEmptyDescription)}
              action={null}
            />
          ) : (
            <Table>
              <TableCaption>
                {intl.t(K.statesCaption, { total: String(subscriptions) })}
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{intl.t(K.columnState)}</TableHead>
                  <TableHead>{intl.t(K.columnSubscriptions)}</TableHead>
                  <TableHead>{intl.t(K.columnCounted)}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.revenue.states.map((state) => (
                  <TableRow key={state.state}>
                    <TableCell>
                      <Badge variant="secondary">{intl.t(subscriptionKey(state.state))}</Badge>
                    </TableCell>
                    <TableCell>{String(state.subscriptions)}</TableCell>
                    <TableCell>
                      {/*
                        **Ce que la facturation a décidé, pas cet écran.** La
                        partition « compte / ne compte pas » vit dans son
                        `domain` : la recopier ici en ferait une seconde vérité,
                        et la première à diverger serait celle qu'on lit.
                      */}
                      <Badge variant={state.counted ? 'default' : 'outline'}>
                        {intl.t(state.counted ? K.countedYes : K.countedNo)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </BackOfficeShell>
  )
}

export interface ImpersonationBannerProps {
  /**
   * **Les textes, déjà traduits, et non une clé de catalogue** — c'est la seule
   * exception de ce fichier, et elle est mesurée.
   *
   * Le bandeau est rendu par la coquille applicative **dans toutes les
   * configurations**, y compris celle où le module `admin` est coupé. Or le
   * catalogue d'un module coupé n'est pas dans celui de l'application : une clé
   * `admin.*` y **lève**, et l'écran tombe alors en 500 — sur chaque page, pour
   * la personne dont la session est empruntée. Mesuré par
   * `pnpm test:minimal-profile`, qui coupe ce module.
   *
   * Les textes viennent donc du catalogue de l'**application**, comme ceux du
   * design system : le composant reçoit ce qu'il affiche.
   */
  readonly labels: {
    readonly title: string
    readonly description: string
    readonly stop: string
    /** Ce qui remplace le bouton quand il n'y a plus de route de sortie. */
    readonly noExit: string
  }
  /**
   * L'adresse de la route de sortie, ou `null` quand le module est coupé.
   *
   * `null` ne fait **pas** disparaître le bandeau : une impersonation en cours
   * qui ne peut plus être rendue à la main expire d'elle-même, mais la taire
   * laisserait la personne devant l'écran ignorer qu'elle regarde le compte
   * d'un autre.
   */
  readonly stopAction: string | null
}

/**
 * **Le bandeau d'impersonation** (critère 5) — rendu par la **coquille
 * applicative**, jamais par une page.
 *
 * C'est ce qui le fait survivre à une navigation complète : une page qui le
 * rendrait le perdrait au premier lien suivi, et l'emprunteur continuerait
 * d'agir au nom d'un client sans plus rien pour le lui rappeler.
 */
export function ImpersonationBanner({ labels, stopAction }: ImpersonationBannerProps) {
  return (
    <Alert variant="warning" role="alert">
      <AlertTitle>{labels.title}</AlertTitle>
      <AlertDescription>
        <span>{labels.description}</span>
        {stopAction === null ? (
          <span className="text-sm">{labels.noExit}</span>
        ) : (
          <form method="post" action={stopAction}>
            <Button type="submit" variant="secondary">
              {labels.stop}
            </Button>
          </form>
        )}
      </AlertDescription>
    </Alert>
  )
}


/**
 * **Le filtre par source, dérivé de ce que la base porte** (s37c).
 *
 * Des **liens**, pas un menu : une sélection *est* une adresse — elle se copie,
 * se met en signet et fonctionne avant l'hydratation. C'est la forme du
 * sélecteur de période (s38) et du sélecteur de langue, et elle évite d'inventer
 * un composant que `docs/design-system.md` ne livre pas.
 *
 * `values` vient du port : ce composant ne connaît aucun vocabulaire, et une
 * valeur ajoutée là-bas apparaît sans qu'une ligne change ici. La recherche en
 * cours **et les autres filtres** sont conservés dans chaque lien — sinon
 * changer de valeur effacerait la sélection sous les pieds de qui l'a posée,
 * exactement le défaut que la revue de s37c a relevé sur la pagination.
 *
 * **Généralisé par s43**, qui apporte la première liste à **deux** filtres : il
 * s'appelait `SourceFilter` et écrivait `source` en dur. Un second filtre
 * l'aurait dupliqué, puis les deux copies auraient divergé.
 */
function ListFilter({
  name,
  values,
  current,
  labelOf,
  search,
  filters = NO_FILTERS,
  navigationLabel,
  allLabel,
  screenPath,
  intl,
}: {
  /** Le nom du paramètre d'adresse que ce filtre écrit. */
  readonly name: string
  readonly values: readonly string[]
  readonly current: string | null
  /** Le libellé d'une valeur. Identité pour un vocabulaire ouvert, traduit sinon. */
  readonly labelOf: (value: string) => string
  readonly search: string | null
  /**
   * **Les autres filtres de la même liste**, reportés dans chaque lien.
   *
   * C'est l'enregistrement de `SearchForm` et de `ListPagination`, et pour la
   * même raison : changer de catégorie ne doit pas effacer le statut choisi
   * sous les pieds de qui l'a posé. Ce composant est partagé — il n'a pas à
   * connaître le vocabulaire d'une liste, ni combien de filtres elle porte.
   */
  readonly filters?: ListFilters
  readonly navigationLabel: string
  readonly allLabel: string
  readonly screenPath: string
  readonly intl: AdminIntl
}) {
  const hrefFor = (value: string | null): string => {
    const parameters = new URLSearchParams()

    for (const [other, otherValue] of Object.entries(filters)) {
      parameters.set(other, otherValue)
    }

    if (value !== null) {
      parameters.set(name, value)
    }

    if (search !== null) {
      parameters.set('q', search)
    }

    const query = parameters.toString()

    return query === '' ? intl.path(screenPath) : `${intl.path(screenPath)}?${query}`
  }

  const options: readonly { readonly key: string; readonly value: string | null; readonly label: string }[] = [
    { key: 'all', value: null, label: allLabel },
    ...values.map((value) => ({ key: value, value, label: labelOf(value) })),
  ]

  return (
    <nav aria-label={navigationLabel} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const selected = option.value === current

        /*
         * **Les mêmes variantes que le sélecteur de période** (s38), et pas
         * `ghost` au repos : `ghost` n'a ni bordure ni fond tant qu'on ne le
         * survole pas, si bien que les sources non retenues se rendaient en
         * texte nu — une rangée de mots, pas un jeu de filtres (revue de s37c,
         * constat 6). Deux sélecteurs voisins du même back-office ne peuvent
         * pas se lire différemment.
         */
        return (
          <Button key={option.key} asChild variant={selected ? 'default' : 'outline'}>
            <a href={hrefFor(option.value)} aria-current={selected ? 'page' : undefined}>
              {option.label}
            </a>
          </Button>
        )
      })}
    </nav>
  )
}

export interface AdminSubscriptionsScreenProps {
  readonly view: AdminSubscriptionsView
  readonly intl: AdminIntl
  readonly navigation: readonly BackOfficeNavigationItem[]
  /**
   * Le chemin de cet écran, **injecté** : il est déclaré par le module qui
   * possède les inscriptions (`marketing`), pas par celui-ci — le back-office
   * ne nomme aucun module (ADR 067).
   */
  readonly screenPath: string
  /**
   * L'adresse de la route de téléchargement, **résolue par l'application** :
   * l'écran ne sait pas comment les chemins de ce module s'écrivent.
   */
  readonly exportAction: string
}

/**
 * `/admin/subscriptions` — **les inscriptions publiques** (s37c).
 *
 * L'écran **consulte** : aucune suppression, aucune modification. La purge
 * d'une adresse existe déjà et appartient au visiteur (s34), pas à
 * l'administrateur.
 *
 * **Les messages de contact n'y sont pas**, et la description le dit à celui
 * qui les y cherche : `contact_message` est une table voisine et distincte,
 * elle porte un nom et un texte libre, elle n'a pas de source, et son point
 * d'entrée est l'email envoyé à l'éditeur. Mêler les deux mettrait deux
 * questions sous un seul filtre.
 *
 * Comme les trois autres écrans du back-office : aucune décision
 * d'autorisation ici — quand ce composant est rendu, la garde du module a déjà
 * répondu.
 */
export function AdminSubscriptionsScreen({
  view,
  intl,
  navigation,
  screenPath,
  exportAction,
}: AdminSubscriptionsScreenProps) {
  /**
   * **La source choisie, telle que les autres gestes doivent l'emporter.**
   *
   * Une seule source de vérité pour la pagination et pour la recherche : le
   * défaut relevé en revue tenait à ce que chacune décidait pour elle-même, et
   * deux d'entre elles avaient oublié.
   */
  const selection: ListFilters = view.source === null ? NO_FILTERS : { source: view.source }

  /**
   * **Le lien d'export porte la sélection affichée**, et rien de plus : un
   * export qui ignore le filtre à l'écran surprend celui qui l'a posé.
   *
   * La **page** n'y entre pas : le fichier n'est pas borné par la pagination —
   * un export tronqué à vingt lignes serait pire qu'aucun export.
   */
  const exportHref = (): string => {
    const parameters = new URLSearchParams()

    if (view.source !== null) {
      parameters.set('source', view.source)
    }

    if (view.search !== null) {
      parameters.set('q', view.search)
    }

    const query = parameters.toString()

    return query === '' ? exportAction : `${exportAction}?${query}`
  }

  return (
    <BackOfficeShell
      navigation={navigation}
      navigationLabel={intl.t(K.breadcrumbRoot)}
      header={
        <PageHeader
          title={intl.t(K.subscriptionsTitle)}
          description={intl.t(K.subscriptionsDescription)}
          actions={
            <Button asChild variant="secondary">
              {/*
                Un **lien**, pas un formulaire : le téléchargement ne change
                aucun état serveur, et une adresse se copie et se met en signet.
                `download` demande au navigateur d'enregistrer plutôt que de
                naviguer ; l'en-tête de la route le dit aussi, l'attribut ne fait
                que l'annoncer avant le premier octet.
              */}
              <a href={exportHref()} download>
                {intl.t(K.exportSubscriptions)}
              </a>
            </Button>
          }
        />
      }
    >
      <ListFilter
        name="source"
        values={view.sources}
        current={view.source}
        /* Une source est un vocabulaire **ouvert**, lu en base : elle se rend
           telle quelle, il n'y a pas de libellé à traduire pour une valeur que
           `config/marketing.ts` peut ajouter demain. */
        labelOf={(source) => source}
        search={view.search}
        navigationLabel={intl.t(K.sourceFilterLabel)}
        allLabel={intl.t(K.allSources)}
        screenPath={screenPath}
        intl={intl}
      />

      <SearchForm
        action={intl.path(screenPath)}
        search={view.search}
        filters={selection}
        intl={intl}
      />

      {view.subscriptions.length === 0 ? (
        <EmptyState
          icon={<MailIcon aria-hidden />}
          title={intl.t(K.subscriptionsEmptyTitle)}
          description={intl.t(K.subscriptionsEmptyDescription)}
          action={
            <Button asChild variant="secondary">
              <a href={intl.path(screenPath)}>{intl.t(K.emptyAction)}</a>
            </Button>
          }
        />
      ) : (
        <Table>
          <TableCaption>
            {intl.t(K.subscriptionsCaption, { total: String(view.total) })}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{intl.t(K.columnEmail)}</TableHead>
              <TableHead>{intl.t(K.columnSource)}</TableHead>
              <TableHead>{intl.t(K.columnLocale)}</TableHead>
              <TableHead>{intl.t(K.columnSubscribedAt)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.subscriptions.map((subscription) => (
              <TableRow key={subscription.id}>
                <TableCell className="min-w-0 truncate font-medium">
                  {subscription.email}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{subscription.source}</Badge>
                </TableCell>
                <TableCell>{subscription.locale}</TableCell>
                <TableCell>{intl.date(subscription.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ListPagination
        page={view.page}
        pageCount={view.pageCount}
        search={view.search}
        filters={selection}
        listPath={screenPath}
        intl={intl}
      />
    </BackOfficeShell>
  )
}

export interface AdminFeedbackScreenProps {
  readonly view: AdminFeedbackView
  readonly intl: AdminIntl
  readonly navigation: readonly BackOfficeNavigationItem[]
  /**
   * Le chemin de cet écran, **injecté** : il est déclaré par le module qui
   * possède les retours (`feedback`), pas par celui-ci — le back-office ne
   * nomme aucun module (ADR 067).
   */
  readonly screenPath: string
  /**
   * L'adresse de la route qui marque un retour comme traité, **résolue par
   * l'application** : l'écran ne sait pas comment les chemins de ce module
   * s'écrivent, et cette route-là vit chez lui — elle disparaît avec lui.
   */
  readonly handleAction: string
}

/**
 * `/admin/feedback` — **les retours envoyés depuis l'application** (s43,
 * critères 4 et 5).
 *
 * Deux filtres, et ils **portent la sélection** l'un de l'autre, comme la
 * recherche et la pagination : c'est la leçon que s37c a payée — un filtre perdu
 * en paginant sert une liste plausible et fausse, pas une panne. Une seule
 * source de vérité, `selection`, alimente les quatre gestes.
 *
 * **Le chemin d'origine est rendu en texte, jamais dans un `href`**, et c'est la
 * surface de sécurité de cette story : la valeur vient d'un champ caché du
 * formulaire, donc de l'appelant. Le module qui l'écrit la réduit à un chemin
 * interne, mais une ligne écrite avant cette règle — ou par un autre chemin que
 * la route — porterait `javascript:…`, qui s'exécuterait au clic d'un
 * superadmin. Le texte n'exécute rien, et React l'échappe.
 *
 * Comme les quatre autres écrans du back-office : aucune décision
 * d'autorisation ici — quand ce composant est rendu, la garde du module a déjà
 * répondu.
 */
export function AdminFeedbackScreen({
  view,
  intl,
  navigation,
  screenPath,
  handleAction,
}: AdminFeedbackScreenProps) {
  /**
   * **La sélection affichée, telle que les autres gestes doivent l'emporter.**
   *
   * Une seule source de vérité pour la pagination, la recherche et **chacun des
   * deux filtres** : le défaut relevé en revue de s37c tenait à ce que chaque
   * geste décidait pour lui-même, et deux d'entre eux avaient oublié.
   */
  const selection: ListFilters = {
    ...(view.category === null ? {} : { category: view.category }),
    ...(view.status === null ? {} : { status: view.status }),
  }

  /** Ce qu'un filtre doit reporter : la sélection, moins la sienne. */
  const others = (name: string): ListFilters =>
    Object.fromEntries(Object.entries(selection).filter(([key]) => key !== name))

  return (
    <BackOfficeShell
      navigation={navigation}
      navigationLabel={intl.t(K.breadcrumbRoot)}
      header={
        <PageHeader
          title={intl.t(K.feedbackTitle)}
          description={intl.t(K.feedbackDescription)}
        />
      }
    >
      <ListFilter
        name="category"
        values={view.categories}
        current={view.category}
        labelOf={(category) => intl.t(feedbackCategoryKey(category))}
        search={view.search}
        filters={others('category')}
        navigationLabel={intl.t(K.categoryFilterLabel)}
        allLabel={intl.t(K.allCategories)}
        screenPath={screenPath}
        intl={intl}
      />

      <ListFilter
        name="status"
        values={view.statuses}
        current={view.status}
        labelOf={(status) => intl.t(feedbackStatusKey(status))}
        search={view.search}
        filters={others('status')}
        navigationLabel={intl.t(K.statusFilterLabel)}
        allLabel={intl.t(K.allStatuses)}
        screenPath={screenPath}
        intl={intl}
      />

      <SearchForm
        action={intl.path(screenPath)}
        search={view.search}
        filters={selection}
        intl={intl}
      />

      {view.feedback.length === 0 ? (
        <EmptyState
          icon={<MessageSquareIcon aria-hidden />}
          title={intl.t(K.feedbackEmptyTitle)}
          description={intl.t(K.feedbackEmptyDescription)}
          action={
            <Button asChild variant="secondary">
              <a href={intl.path(screenPath)}>{intl.t(K.emptyAction)}</a>
            </Button>
          }
        />
      ) : (
        <Table>
          <TableCaption>
            {intl.t(K.feedbackCaption, { total: String(view.total) })}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{intl.t(K.columnFeedback)}</TableHead>
              <TableHead>{intl.t(K.columnAuthor)}</TableHead>
              <TableHead>{intl.t(K.columnCategory)}</TableHead>
              <TableHead>{intl.t(K.columnOrigin)}</TableHead>
              <TableHead>{intl.t(K.columnReceivedAt)}</TableHead>
              <TableHead>{intl.t(K.columnStatus)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.feedback.map((entry) => {
              // La comparaison vit **hors du JSX** : un littéral d'un seul mot
              // entre accolades dans des enfants est lu comme du texte affiché
              // par `tests/i18n.test.ts`, et il a raison de le lire ainsi.
              const handled = entry.status === HANDLED_STATUS

              return (
              <TableRow key={entry.id}>
                <TableCell className="min-w-0 max-w-md whitespace-pre-wrap break-words">
                  {entry.message}
                </TableCell>
                <TableCell className="min-w-0 truncate">
                  {entry.authorName ?? intl.t(K.authorDeleted)}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {intl.t(feedbackCategoryKey(entry.category))}
                  </Badge>
                </TableCell>
                {/*
                  **Du texte, jamais un lien.** La valeur vient de l'appelant :
                  un `href` la rendrait exécutable au clic d'un superadmin.
                */}
                <TableCell className="min-w-0 max-w-xs truncate font-mono text-xs">
                  {entry.originPath ?? intl.t(K.originNone)}
                </TableCell>
                <TableCell>{intl.date(entry.createdAt)}</TableCell>
                <TableCell>
                  {handled ? (
                    <Badge variant="secondary">
                      {intl.t(feedbackStatusKey(entry.status))}
                    </Badge>
                  ) : (
                    <form method="post" action={handleAction}>
                      <input type="hidden" name="id" value={entry.id} />
                      {/*
                        Le nom accessible porte la catégorie : vingt boutons
                        « Marquer comme traité » sont indiscernables au clavier
                        comme pour une aide technique.
                      */}
                      <Button
                        type="submit"
                        variant="secondary"
                        aria-label={intl.t(K.markHandledFor, {
                          category: intl.t(feedbackCategoryKey(entry.category)),
                        })}
                      >
                        {intl.t(K.markHandled)}
                      </Button>
                    </form>
                  )}
                </TableCell>
              </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      <ListPagination
        page={view.page}
        pageCount={view.pageCount}
        search={view.search}
        filters={selection}
        listPath={screenPath}
        intl={intl}
      />
    </BackOfficeShell>
  )
}
