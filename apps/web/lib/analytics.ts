import { getEnv } from '@repo/config'
import { ANALYTICS_MODULE_ID, provideAnalytics } from '@repo/module-analytics'
import type {
  Analytics,
  AnalyticsLogRecord,
  Monitoring,
  MonitoringLogRecord,
} from '@repo/ports'

import { enabledModules } from '../../../config/features'
import {
  createAnalytics,
  createMonitoring,
  resolveAnalyticsConfig,
  resolveMonitoringConfig,
} from './analytics-config'

/**
 * **Le point de composition de l'observabilité** (s39) — le seul fichier de
 * l'application qui connaisse à la fois PostHog, Sentry, l'état du module et la
 * configuration.
 *
 * Le code métier ne connaît que les ports (`@repo/ports`). Il ne saura jamais
 * lequel des deux chemins l'exécute, et c'est exactement ce que les ports
 * existent pour garantir.
 *
 * **Deux chemins par port, choisis sur la configuration, jamais sur
 * `NODE_ENV`** :
 *
 * | | module activé + clé | module coupé, ou aucune clé |
 * |---|---|---|
 * | mesure d'événement | envoyée au fournisseur | **aucun appel réseau**, `not_configured` |
 * | remontée d'erreur | envoyée au fournisseur | **aucun appel réseau**, `not_configured` |
 * | script déclaré à s36 | oui, catégorie `analytics` | **aucun** — la bannière disparaît |
 * | route `/analytics/client-error` | montée, publique et limitée | **404** |
 *
 * Le tableau dit le critère 8 en entier, et il n'y a **aucun `if` de plus
 * ailleurs** : couper le module vide la liste des scripts (registre de
 * `lib/consent.ts`), démonte la route (registre des modules), et rend les deux
 * ports inertes (ici).
 */

/** Le module est-il activé ? La configuration décide, pas un `if` épars. */
const mounted = (enabledModules as readonly string[]).includes(ANALYTICS_MODULE_ID)

/**
 * Le journal, **de forme fermée** : `AnalyticsLogRecord` n'a aucun champ où
 * mettre une propriété d'événement ou une clé de projet (`docs/security.md` §5).
 */
const logAnalytics = (record: AnalyticsLogRecord): void => {
  if (record.event === 'analytics.failed') {
    console.warn(
      `[${record.event}] ${record.name} code=${record.code ?? 'n/a'} ${record.message ?? ''}`,
    )
  }
}

const logMonitoring = (record: MonitoringLogRecord): void => {
  if (record.event === 'monitoring.failed') {
    console.warn(
      `[${record.event}] ${record.origin} ${record.type} code=${record.code ?? 'n/a'} ` +
        `${record.message ?? ''}`,
    )
  }
}

let analytics: Analytics | null = null
let monitoring: Monitoring | null = null

/**
 * Les ports, construits **au premier appel et pas à l'import**.
 *
 * `getEnv()` valide tout le contrat d'environnement et lève si `DATABASE_URL`
 * manque : le lire à l'import ferait échouer le seul fait de charger ce fichier
 * dans un processus qui n'a pas de base — `pnpm build` en est un. Même
 * arbitrage que `lib/storage.ts` et `lib/jobs.ts`.
 */
export function appAnalytics(): Analytics {
  analytics ??= createAnalytics(mounted ? resolveAnalyticsConfig(getEnv()) : null, {
    log: logAnalytics,
  })

  return analytics
}

export function appMonitoring(): Monitoring {
  monitoring ??= createMonitoring(mounted ? resolveMonitoringConfig(getEnv()) : null, {
    log: logMonitoring,
  })

  return monitoring
}

/**
 * Donne au module ses services, **avant** qu'une de ses routes ne soit servie.
 *
 * Module coupé, il n'y a rien à préparer : sa route n'est pas montée, et le
 * registre répond 404.
 */
export function prepareAnalytics(): void {
  if (mounted) {
    // **La fabrique, pas les services.** `prepareModuleServices()` est appelée à
    // chaque requête, y compris celles qu'aucune route ne sert : construire ici
    // lirait l'environnement pour répondre 404 sur un chemin inconnu.
    //
    // Les deux routes du module sont câblées **ensemble** : un point de
    // composition qui en oublierait une servirait un 500 au navigateur, et la
    // revue a mesuré qu'un câblage oublié ne rougissait nulle part.
    provideAnalytics(() => ({
      monitoring: appMonitoring(),
      browser: mounted ? resolveAnalyticsConfig(getEnv()) : null,
    }))
  }
}
