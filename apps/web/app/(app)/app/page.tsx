import { Button, EmptyState, PageHeader } from '@repo/ui'
import { LayoutDashboardIcon } from 'lucide-react'
import { redirect } from 'next/navigation'

import { currentViewer, DEFAULT_SIGNED_IN_PATH } from '../../../lib/auth'
import { appIntl } from '../../../lib/i18n'
import { onboarding, ONBOARDING_SCREEN_PATH } from '../../../lib/onboarding'

/**
 * **Le tableau de bord de l'application**, sur `/app` (s61, ADR 073).
 *
 * Il servait `/` à un visiteur connecté jusqu'à s61 ; `/` sert désormais le
 * site public, connecté ou non. Le contenu est **déplacé tel quel** : c'est la
 * page d'accueil du produit construit, que chaque projet remplira.
 *
 * | Qui | Ce qu'il obtient |
 * |---|---|
 * | un visiteur anonyme | la connexion, avec retour sur `/app` |
 * | un visiteur connecté, parcours d'intégration en cours | ce parcours (s40, critère 1) |
 * | un visiteur connecté, parcours terminé ou module coupé | le tableau de bord |
 *
 * Les destinations sont des **constantes du code**, jamais un paramètre d'URL
 * (`docs/security.md` §4).
 */
export default async function ApplicationHomePage() {
  const { account } = await currentViewer()
  const { t, path } = await appIntl()

  if (account === null) {
    redirect(`${path('/sign-in')}?next=${encodeURIComponent(DEFAULT_SIGNED_IN_PATH)}`)
  }

  /**
   * **Le parcours d'intégration passe avant le tableau de bord** (s40,
   * critère 1), et il cesse de passer une fois terminé (critère 5) : le
   * parcours se termine sur cet écran, donc les deux ne peuvent pas se renvoyer
   * la balle. Module coupé, `pending` rend `false` **sans toucher la base**, et
   * aucune ligne ici ne nomme un module.
   */
  if (await onboarding.pending(account.userId)) {
    redirect(path(ONBOARDING_SCREEN_PATH))
  }

  return (
    <>
      <PageHeader
        title={t('app.dashboard.title')}
        description={t('app.dashboard.description', { name: account.name })}
      />
      <EmptyState
        icon={<LayoutDashboardIcon />}
        title={t('app.dashboard.empty.title')}
        description={t('app.dashboard.empty.description')}
        action={
          <Button asChild>
            <a href={path('/account')}>{t('app.dashboard.empty.action')}</a>
          </Button>
        }
      />
    </>
  )
}
