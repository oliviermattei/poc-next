import { DEMO_PREMIUM_FEATURE, DEMO_PREMIUM_SCREEN_PATH } from '@repo/module-demo-enabled'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from '@repo/ui'
import { SparklesIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { currentViewer } from '../../lib/auth'
import { BILLING_SCREEN_PATH } from '../../lib/billing'
import { entitlements } from '../../lib/entitlements'
import { featureGates } from '../../lib/feature-gates'
import { appIntl } from '../../lib/i18n'

/**
 * L'écran d'une fonctionnalité **réservée à une offre payante** (s21).
 *
 * Trois refus, dans cet ordre, et aucun ne nomme un module :
 *
 * | Qui | Ce qu'il obtient |
 * |---|---|
 * | le produit ne réserve pas cette fonctionnalité | **404** — l'écran n'existe pas |
 * | un visiteur anonyme | redirection vers la connexion, avec son retour |
 * | un compte sans le droit | l'écran, et une **invitation à souscrire** |
 * | un compte avec le droit | la fonctionnalité |
 *
 * **Le refus n'est pas un masquage.** Le second critère de la story demande une
 * invitation, pas une disparition : une fonctionnalité qu'on ne voit pas ne
 * s'achète pas, et un écran qui masque n'est de toute façon pas une permission
 * (`docs/security.md` §3). La garde qui compte est celle du serveur —
 * `entitlements.allows`, ici, et le 403 du répartiteur sur la route du module.
 *
 * **Module de facturation coupé, la fonctionnalité est ouverte et aucune
 * invitation n'apparaît** (critère 6) : `entitlements` accorde alors toutes les
 * fonctionnalités déclarées, et cet écran ne pose aucune question de plus.
 * C'est ce qui lui évite un `if (module activé)`.
 */
export default async function PremiumPage() {
  // La question est « cette fonctionnalité est-elle réservée par ce projet ? »,
  // et elle se pose sur une **donnée** — les déclarations validées —, jamais sur
  // l'identifiant d'un module. Un projet qui retire la ligne de
  // `config/gating.ts` n'a plus cet écran, et le démarrage aurait déjà refusé la
  // route du module qui la nomme.
  if (!featureGates().some((gate) => gate.id === DEMO_PREMIUM_FEATURE)) {
    notFound()
  }

  const { session } = await currentViewer()
  const { t, path } = await appIntl()

  if (session === null) {
    // Le chemin **interne** part dans `next` : c'est l'écran de connexion qui le
    // met dans la forme publique de sa locale, une seule fois.
    redirect(`${path('/sign-in')}?next=${encodeURIComponent(DEMO_PREMIUM_SCREEN_PATH)}`)
  }

  const allowed = await entitlements.allows(session, DEMO_PREMIUM_FEATURE)

  return (
    <div className="space-y-8">
      {/*
        **L'en-tête décrit la fonctionnalité, jamais son prix.** Il est rendu
        dans les deux configurations : une description qui annonçait « réservée
        aux offres payantes » mentait au-dessus d'une carte « Accès ouvert »,
        dans un produit qui ne vend rien (constat m2 de la revue). Ce qui
        dépend de l'offre est dit par l'**état verrouillé**, lequel n'est
        atteignable que lorsqu'il est vrai.
      */}
      <PageHeader title={t('app.premium.title')} description={t('app.premium.description')} />

      {allowed ? (
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {t('app.premium.granted.title')}
              {/*
                Le badge porte le **nom** de l'état, pas une couleur seule : une
                distinction faite uniquement par la teinte n'existe pas pour qui
                ne la perçoit pas.
              */}
              <Badge variant="success">{t('app.premium.granted.badge')}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>{t('app.premium.granted.description')}</p>
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          // `aria-hidden` en booléen, pas en chaîne : le filet de texte rendu
          // refuse toute prop de type chaîne qui n'est pas un marqueur de
          // catalogue, et il a raison — c'est ainsi qu'un libellé se cache.
          icon={<SparklesIcon aria-hidden className="size-4" />}
          title={t('app.premium.locked.title')}
          description={t('app.premium.locked.description')}
          // **Ce qui sort de cet état vide est l'écran de facturation**, et le
          // design system exige que l'action y mène : un état vide sans action
          // est un écran cassé.
          action={
            <Button asChild>
              <Link href={path(BILLING_SCREEN_PATH)}>{t('app.premium.locked.action')}</Link>
            </Button>
          }
        />
      )}
    </div>
  )
}
