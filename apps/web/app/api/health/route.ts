import { checkDatabaseConnection } from '@repo/db'

/** Sonde de santé : elle interroge réellement la base, à chaque appel. */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  const status = await checkDatabaseConnection()

  if (!status.connected) {
    // La cause part dans les journaux, jamais dans la réponse : elle contient
    // la chaîne de connexion.
    console.error('Health check: database unreachable —', status.reason ?? 'unknown error')

    return Response.json({ status: 'error', database: 'unreachable' }, { status: 503 })
  }

  return Response.json({ status: 'ok', database: 'connected' }, { status: 200 })
}
