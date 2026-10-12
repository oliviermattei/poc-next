import { i18n } from '@/lib/i18n'
import { guideLlms } from '@/lib/source'

/** Le Guide entier en un fichier, dans une langue : `/fr/llms-full.txt`, `/en/llms-full.txt`. */
export const revalidate = false

export const dynamicParams = false

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }))
}

export async function GET(_request: Request, { params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params

  return new Response(await guideLlms.full(lang))
}
