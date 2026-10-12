import { guideLlms } from '@/lib/source'

/** L'index du Guide pour un assistant IA : chaque page, en français puis en anglais. */
export const revalidate = false

export async function GET() {
  const [french, english] = await Promise.all([guideLlms.index('fr'), guideLlms.index('en')])

  return new Response(`${french}\n\n${english}`)
}
