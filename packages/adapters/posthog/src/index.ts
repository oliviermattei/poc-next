/**
 * L'unique implémentation du port `Analytics` (ADR 008) : PostHog.
 *
 * Le code métier ne connaît que `@repo/ports` ; ce package est monté par le
 * point de composition de l'application (`apps/web/lib/analytics.ts`), qui
 * décide entre le fournisseur et le port inerte sur la **configuration**, jamais
 * sur `NODE_ENV`.
 */
export {
  createPostHogAnalytics,
  isTransientAnalyticsError,
  POSTHOG_CAPTURE_PATH,
  POSTHOG_PAGEVIEW_EVENT,
  type PostHogAnalyticsOptions,
} from './posthog-analytics'
