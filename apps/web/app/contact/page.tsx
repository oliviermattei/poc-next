import { CONTACT_DESCRIPTION_KEY, CONTACT_TITLE_KEY } from '@repo/module-marketing'
import { ContactView } from '@repo/module-marketing/presentation'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { publicFooterLinks } from '../../lib/footer'
import { appIntl } from '../../lib/i18n'
import { marketingFormsAvailable, marketingSite } from '../../lib/marketing'
import { ContactForm } from '../public-form'

/**
 * L'écran de contact — la troisième page publique du site (s11).
 *
 * **Site public coupé, elle répond 404**, comme une page légale dont le slug
 * n'est pas déclaré : la décision se lit sur `marketingSite.forms`, c'est-à-dire
 * sur une **donnée**, et non sur l'identifiant d'un module. C'est le critère 4
 * de la story, obtenu par la même discipline que le reste de `apps/web`
 * (`apps/web/AGENTS.md`).
 *
 * `/contact` est déclaré dans `publicPaths` : il entre donc dans le
 * `sitemap.xml` et obtient son `Allow: /<langue>/contact$` **ancré** dans le
 * `robots.txt`, sans qu'aucune liste ne soit recopiée. `tests/marketing.test.ts`
 * confronte la politique des robots à chaque `page.tsx` du disque : un écran
 * public non déclaré serait du mauvais côté, et un écran applicatif déclaré
 * aussi.
 *
 * **Aucune requête base de données au rendu** : cet écran n'affiche que du
 * texte de catalogue et un formulaire client. La soumission, elle, passe par la
 * route montée du module.
 */
export async function generateMetadata(): Promise<Metadata> {
  if (!marketingFormsAvailable) {
    // Site public coupé : les clés du module ont disparu du catalogue avec lui,
    // et en demander une ferait tomber la page.
    return {}
  }

  const { locale, t } = await appIntl()
  const title = t(CONTACT_TITLE_KEY)
  const description = t(CONTACT_DESCRIPTION_KEY)

  return { title, description, openGraph: { title, description, type: 'website', locale } }
}

export default async function ContactPage() {
  if (!marketingFormsAvailable) {
    notFound()
  }

  const { locale, t, path } = await appIntl()

  return (
    <ContactView
      site={marketingSite}
      intl={{ t, path }}
      form={<ContactForm locale={locale} />}
      footerLinks={publicFooterLinks(t)}
    />
  )
}
