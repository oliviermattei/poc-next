import { LEGACY_SCREEN_PATHS } from './legacy-paths'

/**
 * **La zone d'un chemin interne** (s64b1, ADR 079) : ce que le proxy lit pour
 * savoir, quand `APP_HOST` est posée, quel hôte sert quoi.
 *
 * Le classement porte sur le **premier segment** du chemin **interne** —
 * préfixe de langue retiré —, et reprend les dossiers de routes de l'ADR 071 :
 * `(site)`, `(auth)` (la zone *Hors zone*, servie par l'application), `(app)`,
 * `(console)`, plus l'API et les fichiers de métadonnées de la racine.
 * `tests/zones.test.ts` compare cette table au disque : une page ajoutée sous
 * un dossier de zone sans ligne ici le fait rougir.
 *
 * Un segment inconnu rend `null` : rien n'est aiguillé, et Next répond 404 sur
 * l'hôte où la requête est arrivée.
 */
export type Zone = 'site' | 'outside' | 'app' | 'console' | 'api'

const SITE_SEGMENTS = [
  '',
  'blog',
  'changelog',
  'contact',
  'cookies',
  'docs',
  'legal',
  'pricing',
  'waitlist',
  'robots.txt',
  'sitemap.xml',
] as const

const OUTSIDE_SEGMENTS = [
  'forgot-password',
  'invitations',
  'oauth',
  'reset-password',
  'sign-in',
  'sign-up',
  'two-factor',
  'verify-email',
] as const

/** Le premier segment d'un chemin interne : `''` pour la racine. */
export const firstSegment = (internalPath: string): string => internalPath.split('/')[1] ?? ''

/**
 * Les anciens chemins d'écran sont de la zone Application : **dérivés** de la
 * table de `legacy-paths.ts`, jamais recopiés — une ligne ajoutée là est
 * aiguillée ici sans autre geste.
 */
const APP_SEGMENTS = new Set<string>([
  'app',
  ...Object.keys(LEGACY_SCREEN_PATHS).map(firstSegment),
])

const ZONE_OF_SEGMENT: ReadonlyMap<string, Zone> = new Map<string, Zone>([
  ...SITE_SEGMENTS.map((segment): [string, Zone] => [segment, 'site']),
  ...OUTSIDE_SEGMENTS.map((segment): [string, Zone] => [segment, 'outside']),
  ...[...APP_SEGMENTS].map((segment): [string, Zone] => [segment, 'app']),
  ['console', 'console'],
  ['api', 'api'],
])

export function zoneOf(internalPath: string): Zone | null {
  return ZONE_OF_SEGMENT.get(firstSegment(internalPath)) ?? null
}
