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
import { UsersIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import type {
  AdminAccountsView,
  AdminAccountView,
  AdminOrganizationsView,
  AdminOrganizationView,
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
  columnRole: 'admin.organization.column.role',
  none: 'admin.none',
} as const

/** L'état d'abonnement, traduit par une clé — jamais par la valeur brute. */
const subscriptionKey = (state: string): string => `admin.subscription.${state}`

/** Le rôle d'un membre, traduit par une clé — la même discipline. */
const roleKey = (role: string): string => `admin.role.${role}`

/** Ce dont chaque liste a besoin pour construire ses adresses. */
export interface BackOfficeListLinks {
  /** L'adresse de cette liste, sans paramètre : la cible du formulaire de recherche. */
  readonly listPath: string
  /** L'adresse d'une ligne. L'appelant sait seul comment son chemin s'écrit. */
  readonly detailPath: (id: string) => string
}

/**
 * Le formulaire de recherche : **`method="get"`, écrit en toutes lettres**.
 *
 * `pnpm lint` le refuse autrement, et sans lui un `<form>` non hydraté retombe
 * sur le `GET` du navigateur en mettant ses champs dans l'URL — ce qui est ici
 * exactement ce qu'on veut, mais qui ne doit jamais être un accident
 * (`docs/security.md` §5).
 */
function SearchForm({
  action,
  search,
  intl,
}: {
  readonly action: string
  readonly search: string | null
  readonly intl: AdminIntl
}) {
  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-2">
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
 * La pagination d'une liste, **avec sa recherche conservée**.
 *
 * Sans le paramètre de recherche dans le lien, passer à la page 2 rendrait la
 * page 2 de *tous* les comptes : la liste changerait sous les pieds de qui
 * cherche.
 */
function ListPagination({
  page,
  pageCount,
  search,
  listPath,
  intl,
}: {
  readonly page: number
  readonly pageCount: number
  readonly search: string | null
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
