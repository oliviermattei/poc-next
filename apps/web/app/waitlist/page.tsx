import { WAITLIST_DESCRIPTION_KEY, WAITLIST_TITLE_KEY } from '@repo/module-marketing'
import { WaitlistView } from '@repo/module-marketing/presentation'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { publicFooterLinks } from '../../lib/footer'
import { appIntl } from '../../lib/i18n'
import { marketingFormsAvailable, marketingSite } from '../../lib/marketing'
import { WaitlistForm } from '../public-form'

/**
 * L'écran de liste d'attente — la quatrième page publique du site (s42).
 *
 * **Site public coupé, elle répond 404**, comme l'écran de contact : la
 * décision se lit sur `marketingSite.forms`, c'est-à-dire sur une **donnée**,
 * jamais sur l'identifiant d'un module (`apps/web/AGENTS.md`). C'est le
 * critère 6 de la story, dont la seconde moitié — « la page d'accueil reste
 * inchangée » — tient à ce que ce fichier existe **à côté** de `app/page.tsx`
 * et non à sa place.
 *
 * `/waitlist` est déclaré dans `publicPaths` : il entre donc dans le
 * `sitemap.xml` et obtient son `Allow: /<langue>/waitlist$` ancré dans le
 * `robots.txt`, sans qu'aucune liste ne soit recopiée.
 *
 * **Aucune requête base de données au rendu** : cet écran n'affiche que du
 * texte de catalogue et un formulaire client. L'inscription, elle, passe par la
 * route montée du module.
 */
export async function generateMetadata(): Promise<Metadata> {
  if (!marketingFormsAvailable) {
    // Site public coupé : les clés du module ont disparu du catalogue avec lui,
    // et en demander une ferait tomber la page.
    return {}
  }

  const { locale, t } = await appIntl()
  const title = t(WAITLIST_TITLE_KEY)
  const description = t(WAITLIST_DESCRIPTION_KEY)

  return { title, description, openGraph: { title, description, type: 'website', locale } }
}

export default async function WaitlistPage() {
  if (!marketingFormsAvailable) {
    notFound()
  }

  const { locale, t, path } = await appIntl()

  return (
    <WaitlistView
      site={marketingSite}
      intl={{ t, path }}
      form={<WaitlistForm locale={locale} />}
      footerLinks={publicFooterLinks(t)}
    />
  )
}
