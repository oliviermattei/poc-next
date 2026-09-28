import { HOME_DESCRIPTION_KEY, HOME_TITLE_KEY } from '@repo/module-marketing'
import { MarketingHome } from '@repo/module-marketing/presentation'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { currentViewer, DEFAULT_SIGNED_IN_PATH } from '../../lib/auth'
import { publicFooterLinks } from '../../lib/footer'
import { NewsletterForm } from '../public-form'
import { appIntl } from '../../lib/i18n'
import { marketingSite } from '../../lib/marketing'

/**
 * La racine du site — **le site public, connecté ou non** (s61, ADR 073).
 *
 * | Qui | Ce qu'il obtient |
 * |---|---|
 * | tout visiteur, site public activé | l'accueil marketing |
 * | un visiteur anonyme, site public coupé | une redirection vers la connexion |
 * | un visiteur connecté, site public coupé | une redirection vers le tableau de bord, `/app` |
 *
 * Le tableau de bord vivait ici pour un connecté jusqu'à s61 ; il est sur
 * `/app` (`app/(app)/app/page.tsx`), avec le renvoi vers le parcours
 * d'intégration. Aucune branche ne nomme un module : elles se départagent sur
 * `marketingSite.sections`, une **donnée**, et sur la session.
 *
 * **Aucune requête base de données pour un visiteur anonyme**, et ce n'est pas
 * une intention : `currentViewer()` résout la session par la signature du
 * cookie, sans cookie valide il n'y a rien à lire. `tests/marketing.test.ts`
 * **rend cette page** — et la page légale, et le gabarit du site — avec un
 * compteur posé sur les prototypes de `pg` : une requête émise ici, par quelque
 * chemin que ce soit, fait rougir la suite.
 *
 * La destination de la redirection est une **constante du code**, jamais un
 * paramètre d'URL : une redirection pilotée par l'extérieur est exactement ce
 * que `docs/security.md` §4 refuse.
 */
export async function generateMetadata(): Promise<Metadata> {
  if (marketingSite.sections.length === 0) {
    // Site public coupé : les clés du module ont disparu du catalogue avec lui,
    // et en demander une ferait tomber la page. Les métadonnées de
    // `app/layout.tsx` restent en place.
    return {}
  }

  const { locale, t } = await appIntl()
  const title = t(HOME_TITLE_KEY)
  const description = t(HOME_DESCRIPTION_KEY)

  return {
    title,
    description,
    openGraph: { title, description, type: 'website', locale },
  }
}

export default async function HomePage() {
  const { session } = await currentViewer()
  const { locale, t, path } = await appIntl()

  if (marketingSite.sections.length === 0) {
    // Site public coupé : chaque visiteur est envoyé là où il a quelque chose
    // à faire — la connexion pour un anonyme, le tableau de bord pour un
    // connecté (s61, critère 7). Deux constantes, jamais un paramètre.
    redirect(path(session === null ? '/sign-in' : DEFAULT_SIGNED_IN_PATH))
  }

  return (
    <MarketingHome
      site={marketingSite}
      intl={{ t, path }}
      newsletterForm={<NewsletterForm locale={locale} />}
      // Le point d'accès au consentement dans le pied de page (s36). Il est
      // **fourni** par l'application : le module `marketing` ne sait pas ce
      // qu'est le consentement, et le déclarer chez lui ferait disparaître ce
      // point d'accès avec le site public.
      footerLinks={publicFooterLinks(t)}
    />
  )
}
