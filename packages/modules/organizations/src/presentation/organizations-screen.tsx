import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  OrgSwitcher,
  PageHeader,
  Separator,
} from '@repo/ui'
import { Building2Icon, MailPlusIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import type {
  OrganizationInvitationView,
  OrganizationMemberView,
  OrganizationsView,
} from '../application/organization-use-cases'
import {
  invitationStatusKey,
  ORGANIZATIONS_KEYS as K,
  roleActionForKey,
  roleActionKey,
  roleLabelKey,
} from '../domain/message-keys'
import { grantsOwnership, ORGANIZATION_ACTION } from '../domain/permissions'
import type { OrganizationsIntl } from './organizations-intl'

/**
 * L'écran des organisations — **composé, jamais inventé**.
 *
 * Tout vient de `@repo/ui` (`docs/design-system.md`) : `PageHeader`, `Card`,
 * `OrgSwitcher`, `EmptyState`, `Input`, `Label`, `Button`, `Alert`, `Badge`.
 * Aucune primitive maison, aucune couleur Tailwind brute, aucun texte en dur.
 *
 * **Aucun composant client, et c'est le point.** Les deux formulaires postent
 * nativement vers les routes du module, qui répondent 303 vers cet écran. Il
 * n'y a donc pas de fenêtre entre le premier octet et l'hydratation pendant
 * laquelle une soumission serait perdue — la soumission native *est* le chemin.
 * Le `method="post"` reste écrit en toutes lettres : `pnpm lint` le refuse
 * autrement, et sans lui le repli du navigateur mettrait les champs dans l'URL
 * (`docs/security.md` §5).
 */

export interface OrganizationsScreenProps {
  readonly view: OrganizationsView
  readonly intl: OrganizationsIntl
  /** URL des routes du module, résolues par l'application. */
  readonly actions: {
    readonly create: string
    readonly switch: string
    readonly update: string
    readonly invite: string
    readonly resendInvitation: string
    readonly revokeInvitation: string
    readonly removeMember: string
    readonly setMemberRole: string
  }
  /** Le compte de l'appelant : c'est lui qui « quitte » au lieu de « retirer ». */
  readonly viewerId: string
  /**
   * La **clé de catalogue** du refus rapporté par la redirection, ou `null`.
   *
   * Une clé, pas un code : c’est l’écran appelant qui valide le paramètre d’URL
   * (Zod) et le traduit en clé. Le module n’a alors qu’à l’afficher, et le
   * garde-fou de `tests/rendered-text.test.ts` reconnaît une clé du catalogue.
   */
  readonly refusalKey: string | null
}

/**
 * Le couple nom + identifiant, partagé par les deux formulaires.
 *
 * Les **clés** de libellé arrivent en propriété plutôt que d'être composées
 * ici : une clé construite dans un `.tsx` est invisible au balayage de
 * `tests/i18n.test.ts` et se lit comme un fragment de phrase concaténé.
 */
function DraftFields({
  intl,
  prefix,
  labels,
  name,
  slug,
}: {
  readonly intl: OrganizationsIntl
  readonly prefix: string
  readonly labels: {
    readonly name: string
    readonly slug: string
    readonly slugHint: string
  }
  readonly name?: string
  readonly slug?: string
}) {
  const nameId = `${prefix}-name`
  const slugId = `${prefix}-slug`

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={nameId}>{intl.t(labels.name)}</Label>
        <Input id={nameId} name="name" type="text" defaultValue={name} required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={slugId}>{intl.t(labels.slug)}</Label>
        <Input id={slugId} name="slug" type="text" defaultValue={slug} required />
        <p className="text-xs text-muted-foreground">{intl.t(labels.slugHint)}</p>
      </div>
    </>
  )
}

/**
 * Une ligne de liste : le libellé, puis ses affordances.
 *
 * `min-w-0` et `truncate` évitent le débordement horizontal
 * (`docs/design-system.md`, § Responsive) : sans eux, une adresse longue pousse
 * la carte et fait défiler la page en largeur.
 *
 * **Mais éviter le débordement ne suffit pas** (revue de s16, F5). Avec
 * `flex-1` seul — donc `flex-basis: 0` —, le libellé « tient » toujours et ne
 * provoque jamais le retour à la ligne que `flex-wrap` promettait : il absorbe
 * seul toute la compression, et rendait l'adresse tronquée à **neuf pixels** à
 * 390 px, mesuré au navigateur. Deux invitations devenaient indiscernables,
 * alors que la ligne porte une action destructive.
 *
 * `basis-full` sous `sm` donne donc au libellé sa propre ligne, et renvoie les
 * affordances à la suivante ; `sm:flex-1 sm:basis-auto` rend le comportement
 * d'origine dès qu'il y a la place. `e2e/organizations.spec.ts` mesure la
 * largeur réellement rendue à 390 px : c'est la seule preuve possible, une
 * assertion sur la classe utilitaire ne prouverait que sa présence.
 */
function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-3 border-t border-border py-3 first:border-t-0 first:pt-0">
      <span className="min-w-0 basis-full truncate sm:flex-1 sm:basis-auto">{label}</span>
      {children}
    </li>
  )
}

/**
 * Une action de ligne : un formulaire natif, un champ caché, un bouton.
 *
 * Un formulaire **par action**, et c'est ce qui permet à l'écran de n'avoir
 * aucun composant client : la soumission native est le chemin nominal, et le
 * `method` reste écrit en toutes lettres — `pnpm lint` le refuse autrement.
 *
 * **Deux libellés, et la raison est mesurée.** Le texte visible est court
 * (« Retirer »), le nom accessible nomme sa cible (« Retirer marie@… ») : quatre
 * boutons « Retirer » sont indiscernables au clavier comme pour une aide
 * technique, mais mettre l'adresse **dans** le bouton la rend indéformable
 * (`whitespace-nowrap`) et fait déborder l'écran — mesuré, 1033 px de contenu
 * dans une fenêtre de 390 px, avec une adresse longue. L'`aria-label` remplace le
 * contenu pour une aide technique : le nom reste complet, la largeur non.
 */
function RowAction({
  action,
  organizationId,
  fields,
  label,
  accessibleName,
  variant = 'ghost',
}: {
  readonly action: string
  readonly organizationId: string
  /** Les champs cachés de cette action, en plus du périmètre. */
  readonly fields: Readonly<Record<string, string>>
  readonly label: string
  readonly accessibleName: string
  readonly variant?: 'ghost' | 'outline'
}) {
  return (
    <form method="post" action={action} aria-label={accessibleName}>
      {/* Le périmètre est celui que l'écran **affiche**, posé par le serveur.
          Le champ est caché mais il n'est pas une autorisation : la route relit
          l'appartenance, et une valeur falsifiée répond 404 (ADR 025). */}
      <input type="hidden" name="organizationId" value={organizationId} />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {/* `variant="ghost"` et la hauteur par défaut : le design system ne nomme
          aucune échelle de tailles, et `packages/ui` n'en expose pas. Une taille
          inventée ici serait un design system gap comblé sur place.
          `outline` est réservé au transfert de propriété : il change qui
          gouverne l'organisation, et il mérite d'être distinct sans être
          `destructive`, que le design system garde pour la suppression. */}
      <Button type="submit" variant={variant} aria-label={accessibleName}>
        {label}
      </Button>
    </form>
  )
}

function MembersCard({
  intl,
  members,
  organizationId,
  viewerId,
  removeAction,
  setRoleAction,
}: {
  readonly intl: OrganizationsIntl
  readonly members: readonly OrganizationMemberView[]
  readonly organizationId: string
  readonly viewerId: string
  readonly removeAction: string
  readonly setRoleAction: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.t(K.membersTitle)}</CardTitle>
        <CardDescription>{intl.t(K.membersDescription)}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col">
          {members.map((member) => (
            <Row key={member.userId} label={member.email}>
              <Badge variant="secondary">{intl.t(roleLabelKey(member.role))}</Badge>
              {member.userId === viewerId ? <Badge variant="outline">{intl.t(K.membersYou)}</Badge> : null}
              {/* **Les rôles que cette ligne peut recevoir, tels que le serveur
                  les a calculés** (s17). L'écran ne compare aucun rôle : la
                  liste est vide, ou elle ne l'est pas. Une comparaison écrite
                  ici ferait exister la matrice à deux endroits. */}
              {member.assignableRoles.map((role) => (
                <RowAction
                  key={role}
                  action={setRoleAction}
                  organizationId={organizationId}
                  fields={{ userId: member.userId, role }}
                  label={intl.t(roleActionKey(role))}
                  accessibleName={intl.t(roleActionForKey(role), { email: member.email })}
                  variant={grantsOwnership(role) ? 'outline' : 'ghost'}
                />
              ))}
              {/* **Le dernier propriétaire n'a pas de bouton** : l'action
                  n'existe pas plutôt que d'échouer. Ce n'est pas la permission —
                  le serveur refuse de toute façon (`docs/security.md` §3) —,
                  c'est ne pas promettre ce qu'on refusera. */}
              {member.removable ? (
                <RowAction
                  action={removeAction}
                  organizationId={organizationId}
                  fields={{ userId: member.userId }}
                  label={
                    member.userId === viewerId
                      ? intl.t(K.membersLeave)
                      : intl.t(K.membersRemove)
                  }
                  accessibleName={
                    member.userId === viewerId
                      ? intl.t(K.membersLeave)
                      : intl.t(K.membersRemoveFor, { email: member.email })
                  }
                />
              ) : null}
            </Row>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function InvitationsCard({
  intl,
  invitations,
  organizationId,
  actions,
}: {
  readonly intl: OrganizationsIntl
  readonly invitations: readonly OrganizationInvitationView[]
  readonly organizationId: string
  readonly actions: {
    readonly invite: string
    readonly resendInvitation: string
    readonly revokeInvitation: string
  }
}) {
  return (
    <Card id="invite-member">
      <CardHeader>
        <CardTitle>{intl.t(K.invitationsTitle)}</CardTitle>
        <CardDescription>{intl.t(K.invitationsDescription)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          method="post"
          action={actions.invite}
          aria-label={intl.t(K.invitationsTitle)}
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
        >
          <input type="hidden" name="organizationId" value={organizationId} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Label htmlFor="invite-email">{intl.t(K.invitationsEmailLabel)}</Label>
            <Input id="invite-email" name="email" type="email" autoComplete="email" required />
          </div>
          <div>
            <Button type="submit">{intl.t(K.invitationsSubmit)}</Button>
          </div>
        </form>
        <p className="text-xs text-muted-foreground">{intl.t(K.invitationsHint)}</p>

        <Separator />

        {invitations.length === 0 ? (
          <EmptyState
            icon={<MailPlusIcon />}
            title={intl.t(K.invitationsEmptyTitle)}
            description={intl.t(K.invitationsEmptyDescription)}
            action={
              <Button asChild>
                <a href="#invite-member">{intl.t(K.invitationsSubmit)}</a>
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col">
            {invitations.map((invitation) => (
              <Row key={invitation.id} label={invitation.email}>
                <Badge variant={invitation.status === 'pending' ? 'secondary' : 'outline'}>
                  {intl.t(invitationStatusKey(invitation.status))}
                </Badge>
                <RowAction
                  action={actions.resendInvitation}
                  organizationId={organizationId}
                  fields={{ invitationId: invitation.id }}
                  label={intl.t(K.invitationsResend)}
                  accessibleName={intl.t(K.invitationsResendFor, { email: invitation.email })}
                />
                <RowAction
                  action={actions.revokeInvitation}
                  organizationId={organizationId}
                  fields={{ invitationId: invitation.id }}
                  label={intl.t(K.invitationsRevoke)}
                  accessibleName={intl.t(K.invitationsRevokeFor, { email: invitation.email })}
                />
              </Row>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

const CREATE_LABELS = {
  name: K.createName,
  slug: K.createSlug,
  slugHint: K.createSlugHint,
}

const SETTINGS_LABELS = {
  name: K.settingsName,
  slug: K.settingsSlug,
  slugHint: K.settingsSlugHint,
}

export function OrganizationsScreen({
  view,
  intl,
  actions,
  refusalKey,
  viewerId,
}: OrganizationsScreenProps) {
  const { current, memberships, members, invitations, permissions } = view

  return (
    <>
      <PageHeader
        title={intl.t(K.screenTitle)}
        description={intl.t(K.screenDescription)}
      />

      {refusalKey === null ? null : (
        <Alert variant="destructive" role="alert">
          {intl.t(refusalKey)}
        </Alert>
      )}

      {memberships.length === 0 ? (
        <EmptyState
          icon={<Building2Icon />}
          title={intl.t(K.emptyTitle)}
          description={intl.t(K.emptyDescription)}
          action={
            <Button asChild>
              <a href="#create-organization">{intl.t(K.createSubmit)}</a>
            </Button>
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{intl.t(K.currentTitle)}</CardTitle>
            <CardDescription>{intl.t(K.currentDescription)}</CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-wrap items-center gap-3">
            <OrgSwitcher
              label={intl.t(K.switcherLabel)}
              // Aucune sélection courante n'est pas « aucune organisation » :
              // le compte en a, il n'en a simplement pas choisi. Le
              // déclencheur invite, il ne constate pas un vide (F7).
              current={current === null ? intl.t(K.switcherNone) : current.name}
              currentValue={current === null ? null : current.id}
              action={actions.switch}
              fieldName="organizationId"
              options={memberships.map((membership) => ({
                value: membership.id,
                label: membership.name,
              }))}
            />
            {current === null ? null : (
              <Badge variant="secondary">{intl.t(roleLabelKey(current.role))}</Badge>
            )}
          </CardContent>
        </Card>
      )}

      {current === null ? null : (
        <MembersCard
          intl={intl}
          members={members}
          organizationId={current.id}
          viewerId={viewerId}
          removeAction={actions.removeMember}
          setRoleAction={actions.setMemberRole}
        />
      )}

      {/* **Les cartes disparaissent, elles ne sont pas grisées** (s17). Le
          design system réserve « l'action reste visible mais mène à une
          invitation à souscrire » au gating d'offre (s21) : un simple membre ne
          peut rien acheter pour devenir administrateur. La carte des membres,
          elle, reste — savoir avec qui l'on partage ses données n'est pas un
          privilège. */}
      {current === null || !permissions[ORGANIZATION_ACTION.invite] ? null : (
        <InvitationsCard
          intl={intl}
          invitations={invitations}
          organizationId={current.id}
          actions={actions}
        />
      )}

      {current === null || !permissions[ORGANIZATION_ACTION.rename] ? null : (
        <Card>
          <CardHeader>
            <CardTitle>{intl.t(K.settingsTitle)}</CardTitle>
            <CardDescription>{intl.t(K.settingsDescription)}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              method="post"
              action={actions.update}
              aria-label={intl.t(K.settingsTitle)}
              className="flex flex-col gap-4"
            >
              {/* L'organisation modifiée est **l'organisation courante**, posée
                  par le serveur. Le champ est caché mais il n'est pas une
                  autorisation : la route relit l'appartenance, et une valeur
                  falsifiée répond 404. */}
              <input type="hidden" name="organizationId" value={current.id} />
              <DraftFields
                intl={intl}
                prefix="settings"
                labels={SETTINGS_LABELS}
                name={current.name}
                slug={current.slug}
              />
              <div>
                <Button type="submit">{intl.t(K.settingsSubmit)}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card id="create-organization">
        <CardHeader>
          <CardTitle>{intl.t(K.createTitle)}</CardTitle>
          <CardDescription>{intl.t(K.createDescription)}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            method="post"
            action={actions.create}
            aria-label={intl.t(K.createTitle)}
            className="flex flex-col gap-4"
          >
            <DraftFields intl={intl} prefix="create" labels={CREATE_LABELS} />
            <div>
              <Button type="submit">{intl.t(K.createSubmit)}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  )
}
