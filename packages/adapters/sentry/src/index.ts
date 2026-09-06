/**
 * L'unique implémentation du port `Monitoring` (ADR 008) : Sentry.
 *
 * Le code métier ne connaît que `@repo/ports` ; ce package est monté par le
 * point de composition de l'application (`apps/web/lib/analytics.ts`, dont la
 * règle vit dans `lib/analytics-config.ts`), qui décide entre le fournisseur et
 * le port inerte sur la **configuration**, jamais sur `NODE_ENV`.
 */
export {
  createSentryMonitoring,
  InvalidSentryDsnError,
  isTransientMonitoringError,
  parseSentryDsn,
  parseStackFrames,
  type SentryDsn,
  type SentryMonitoringOptions,
  type StackFrame,
} from './sentry-monitoring'
