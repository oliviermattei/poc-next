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
} from '@repo/ui'
import { Building2Icon } from 'lucide-react'

import type { OrganizationsView } from '../application/organization-use-cases'
import { ORGANIZATIONS_KEYS as K, roleLabelKey } from '../domain/message-keys'
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
  /** URL des trois routes du module, résolues par l'application. */
  readonly actions: {
    readonly create: string
    readonly switch: string
    readonly update: string
  }
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
}: OrganizationsScreenProps) {
  const { current, memberships } = view

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
