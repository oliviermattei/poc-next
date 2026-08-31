import {
  legalDescriptionKey,
  legalDocumentOf,
  legalPath,
  legalTitleKey,
} from '@repo/module-marketing'
import { LegalDocumentView } from '@repo/module-marketing/presentation'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { appIntl } from '../../../lib/i18n'
import { marketingSite } from '../../../lib/marketing'

/**
 * Une page légale — confidentialité, conditions d'utilisation.
 *
 * Le paramètre de route est une **entrée**, donc validé par Zod avant d'être
 * regardé (`docs/security.md` §4). Sa forme acceptée est celle d'un slug, et
 * rien d'autre : ce qui ne la respecte pas n'atteint jamais la recherche dans
 * la configuration. Un slug bien formé mais non déclaré n'existe pas davantage —
 * `legalDocumentOf` rend `null`, et la page répond **404**.
 *
 * Site public coupé, la liste des documents est vide : toutes les URL de cette
 * forme répondent donc 404, sans qu'une seule ligne ne nomme un module. C'est
 * le critère « aucune page publique n'est servie », obtenu par la donnée et non
 * par une branche.
 */
const documentParam = z.object({ document: z.string().regex(/^[a-z][a-z0-9-]*$/) })

const requestedDocument = async (
  params: Promise<Record<string, string | string[] | undefined>>,
): Promise<string | null> => {
  const parsed = documentParam.safeParse(await params)

  return parsed.success ? parsed.data.document : null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Record<string, string | string[] | undefined>>
}): Promise<Metadata> {
  const slug = await requestedDocument(params)
  const document = slug === null ? null : legalDocumentOf(marketingSite, slug)

  if (document === null) {
    return {}
  }

  const { locale, t, path } = await appIntl()
  const title = t(legalTitleKey(document.slug))
  const description = t(legalDescriptionKey(document.slug))

  return {
    title,
    description,
    openGraph: { title, description, type: 'article', locale },
    // La canonique est l'URL **servie dans cette langue**, pas le chemin
    // interne : `/legal/privacy` répond 307 vers la langue négociée, et la même
    // valeur en `fr` et en `en` fusionnerait les deux versions pour un moteur —
    // ce que les `hreflang` du plan de site contredisent. `path()` est la seule
    // mise en forme d'URL de ce fichier, ici comme dans les liens.
    alternates: { canonical: path(legalPath(document.slug)) },
  }
}

export default async function LegalPage({
  params,
}: {
  params: Promise<Record<string, string | string[] | undefined>>
}) {
  const slug = await requestedDocument(params)
  const document = slug === null ? null : legalDocumentOf(marketingSite, slug)

  if (document === null) {
    notFound()
  }

  const { t, path } = await appIntl()

  return <LegalDocumentView site={marketingSite} document={document} intl={{ t, path }} />
}
