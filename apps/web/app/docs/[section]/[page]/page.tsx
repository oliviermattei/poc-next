import { docsNavigationTree, docsPagePath, docsPageView } from '@repo/module-docs'
import { DocsPageView } from '@repo/module-docs/presentation'
import { MarketingFooter } from '@repo/module-marketing/presentation'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { publicFooterLinks } from '../../../../lib/footer'
import { docsCatalog } from '../../../../lib/docs'
import { docsBody } from '../../../../lib/docs-body'
import { appIntl } from '../../../../lib/i18n'
import { marketingFormsAvailable, marketingSite } from '../../../../lib/marketing'
import { DEFAULT_OG_IMAGE } from '../../../../lib/og-image'

/**
 * Une page de documentation.
 *
 * Les paramètres de route sont une **entrée**, donc validés par Zod avant d'être
 * regardés (`docs/security.md` §4) : leur forme acceptée est celle d'un slug, et
 * ce qui ne la respecte pas n'atteint jamais la recherche.
 *
 * **Un chemin absent de l'arbre répond 404 ; un chemin non traduit, non.**
 * C'est l'inverse du blog, et c'est le critère 3 de la story : `docsPageView`
 * rend la page de la langue par défaut, et l'écran porte la mention. Le repli
 * est linguistique, jamais inventif — `null` reste un 404.
 *
 * Module coupé, le catalogue est vide : toutes les URL de cette forme répondent
 * 404, sans qu'une seule ligne ne nomme un module.
 *
 * **Aucun `loading.tsx` sur ce segment, ni sur aucun autre.** Mesuré en s29 :
 * la coquille est vidée avant que la page ne décide, et le `notFound()`
 * ci-dessous arriverait en HTTP 200. `tests/docs.test.ts` refuse qu'un tel
 * fichier apparaisse.
 */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

const docsParams = z.object({ section: z.string().regex(SLUG), page: z.string().regex(SLUG) })

const requestedPage = async (
  params: Promise<Record<string, string | string[] | undefined>>,
): Promise<{ section: string; page: string } | null> => {
  const parsed = docsParams.safeParse(await params)

  return parsed.success ? parsed.data : null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Record<string, string | string[] | undefined>>
}): Promise<Metadata> {
  const { locale, path } = await appIntl()
  const requested = await requestedPage(params)
  const resolved =
    requested === null
      ? null
      : docsPageView(docsCatalog, { locale, section: requested.section, slug: requested.page })

  if (resolved === null) {
    return {}
  }

  return {
    title: resolved.page.title,
    description: resolved.page.description,
    openGraph: {
      title: resolved.page.title,
      description: resolved.page.description,
      type: 'article',
      locale,
      images: [DEFAULT_OG_IMAGE],
    },
    // La canonique est l'URL **servie dans cette langue** : une page non
    // traduite reste une page distincte, servie sous son propre chemin de
    // langue. La même valeur en `fr` et en `en` fusionnerait les deux versions
    // pour un moteur.
    alternates: { canonical: path(docsPagePath(resolved.page.section, resolved.page.slug)) },
  }
}

export default async function DocsPage({
  params,
}: {
  params: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale, t, path } = await appIntl()
  const requested = await requestedPage(params)
  const resolved =
    requested === null
      ? null
      : docsPageView(docsCatalog, { locale, section: requested.section, slug: requested.page })

  if (resolved === null) {
    notFound()
  }

  return (
    <>
      <DocsPageView
        tree={docsNavigationTree(docsCatalog, locale)}
        page={resolved.page}
        translated={resolved.translated}
        intl={{ t, path }}
      >
        {await docsBody({
          // La langue de la page **servie**, pas celle de la requête : un repli
          // charge le fichier de la langue par défaut.
          locale: resolved.page.locale,
          section: resolved.page.section,
          slug: resolved.page.slug,
        })}
      </DocsPageView>
      {marketingFormsAvailable ? (
        <MarketingFooter
          site={marketingSite}
          intl={{ t, path }}
          extraLinks={publicFooterLinks(t)}
        />
      ) : null}
    </>
  )
}
