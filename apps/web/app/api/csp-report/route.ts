import { getNodeEnv } from '@repo/config'
import { z } from 'zod'

import { policyMode } from '../../../lib/security-headers'

/**
 * Le collecteur de violations de la politique de sécurité du contenu, **en
 * développement**.
 *
 * Critère de s45 : « un rapport de violation est collecté en développement, sans
 * dépendre d'un service tiers ». Le socle de fiabilité §2 dit la même chose
 * autrement — aucun port ne dépend d'une clé de fournisseur pour fonctionner
 * localement. Il n'y a donc ni Sentry, ni `report-to` vers un domaine externe :
 * la politique du mode développement porte `report-uri /api/csp-report`, et
 * c'est cette route qui reçoit.
 *
 * **Elle n'existe pas en production**, et c'est cohérent avec la politique elle-
 * même, qui n'y déclare aucun `report-uri` : une route d'écriture anonyme ne
 * doit pas rester ouverte à qui la devinerait.
 *
 * Le mode se lit sur `NODE_ENV`, et **ce n'est pas la forme d'opt-in de la sonde
 * de s09** — celle-là est un drapeau explicite (`I18N_MISSING_KEY_PROBE=1`),
 * celle-ci une dérivation de l'environnement. La revue de s45 a corrigé la
 * comparaison : elles ne se ressemblent que par le 404. La dérivation se
 * justifie autrement, et elle repose sur deux choses :
 *
 * - le collecteur doit suivre **exactement** la politique servie — un collecteur
 *   allumé sans `report-uri` ne recevrait rien, un `report-uri` sans collecteur
 *   ferait 404 à chaque violation. Une seule décision, `policyMode`, pour les
 *   deux ;
 * - un `NODE_ENV` mal renseigné **ne peut pas** ouvrir cette route en
 *   production, non parce que le repli de `getNodeEnv` serait prudent — il rend
 *   `development`, le plus permissif des deux —, mais parce que
 *   `assertStartupEnv` refuse le démarrage en nommant la variable
 *   (`packages/config/src/env.test.ts`).
 */

/** Les 50 derniers rapports, et rien de plus. */
const CAPACITY = 50

interface CollectedReport {
  readonly at: string
  readonly directive: string
  readonly blockedUri: string
  readonly documentUri: string
  readonly sample: string
}

/**
 * En mémoire du processus, volontairement.
 *
 * Écrire sur disque aurait ajouté un chemin, un nettoyage et une entrée de
 * `.gitignore` pour une donnée qui n'a de sens que pendant la session de
 * développement en cours ; et n'importe quelle page peut déclencher un rapport,
 * donc une liste non bornée serait une fuite mémoire à la demande
 * (`docs/reliability.md` §5). Le tampon perd les plus vieux.
 */
const collected: CollectedReport[] = []

/**
 * Zod à la frontière (`docs/security.md` §4). Ce corps arrive d'un navigateur,
 * sans authentification : rien n'y est recopié sans avoir été jugé, ni dans le
 * tampon ni dans le journal.
 *
 * Deux formes existent — l'objet `csp-report` que produit `report-uri`, et le
 * tableau d'événements de l'API Reporting. Seule la première est acceptée : la
 * seconde exige un en-tête `Reporting-Endpoints` que la politique ne pose pas,
 * donc la recevoir signifierait que quelqu'un poste à la main.
 */
const reportSchema = z.object({
  'csp-report': z.object({
    'document-uri': z.string().max(2048).optional(),
    'effective-directive': z.string().max(128).optional(),
    'violated-directive': z.string().max(128).optional(),
    'blocked-uri': z.string().max(2048).optional(),
    'script-sample': z.string().max(512).optional(),
  }),
})

/**
 * Ce qui sort d'un rapport et entre dans une ligne lue par quelqu'un.
 *
 * Zod borne la **longueur** de ces champs, pas leur forme : un `blocked-uri`
 * portant un retour à la ligne fabrique une seconde ligne dans le terminal du
 * développeur, que rien ne distingue d'un message du serveur — le rapport
 * choisit alors ce que le journal raconte. Le corps arrive d'un POST anonyme,
 * donc de n'importe qui.
 *
 * Tous les caractères de contrôle sont remplacés, pas seulement `\n` et `\r` :
 * un retour chariot seul réécrit la ligne courante, et une séquence
 * d'échappement ANSI colore ou efface la sortie. Un espace conserve la
 * lisibilité de la valeur, qui reste bornée par le schéma.
 */
// eslint-disable-next-line no-control-regex -- c'est précisément ce qu'on retire
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g

const singleLine = (value: string): string => value.replace(CONTROL_CHARACTERS, ' ')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const enabled = (): boolean => policyMode(getNodeEnv()) === 'development'

export async function POST(request: Request): Promise<Response> {
  if (!enabled()) {
    return new Response(null, { status: 404 })
  }

  const parsed = reportSchema.safeParse(await request.json().catch(() => null))

  if (!parsed.success) {
    // 400 sans effet de bord : un corps non conforme n'entre pas dans le tampon.
    return new Response(null, { status: 400 })
  }

  const report = parsed.data['csp-report']
  // Normalisé **à l'entrée**, une seule fois : le tampon et le journal lisent la
  // même valeur, et la prochaine sortie — un futur endroit qui relirait ces
  // rapports — hérite de la garde sans avoir à la redemander.
  const entry: CollectedReport = {
    at: new Date().toISOString(),
    directive: singleLine(
      report['effective-directive'] ?? report['violated-directive'] ?? 'unknown',
    ),
    blockedUri: singleLine(report['blocked-uri'] ?? 'unknown'),
    documentUri: singleLine(report['document-uri'] ?? 'unknown'),
    sample: singleLine(report['script-sample'] ?? ''),
  }

  collected.push(entry)
  collected.splice(0, Math.max(0, collected.length - CAPACITY))

  // Visible sans aller lire une route : c'est le développeur qui vient de casser
  // sa page, et il regarde son terminal.
  console.warn(
    `CSP: ${entry.directive} a refusé ${entry.blockedUri} sur ${entry.documentUri}` +
      (entry.sample === '' ? '' : ` — ${entry.sample}`),
  )

  // 204 : le navigateur n'attend rien, et un corps de réponse serait du bruit.
  return new Response(null, { status: 204 })
}

/**
 * Ce qui a été collecté depuis le démarrage du serveur de développement.
 *
 * C'est ce qui rend le critère observable de bout en bout : un parcours peut
 * injecter un script en ligne sans nonce, constater qu'il ne s'exécute pas,
 * **puis** vérifier ici que la violation a bien été rapportée. Sans cette
 * lecture, « collecté » resterait une affirmation.
 */
export function GET(): Response {
  if (!enabled()) {
    return new Response(null, { status: 404 })
  }

  return Response.json({ reports: collected })
}
