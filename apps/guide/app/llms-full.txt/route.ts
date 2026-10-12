import { guideLlms } from '@/lib/source'

/**
 * Le Guide entier en un fichier, en français — la langue qui fait foi. La
 * version anglaise est servie sous `/en/llms-full.txt`.
 */
export const revalidate = false

export async function GET() {
  return new Response(await guideLlms.full('fr'))
}
