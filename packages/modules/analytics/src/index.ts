export {
  analyticsBootstrap,
  analyticsScript,
  ANALYTICS_LOADER_FILE,
  ANALYTICS_MODULE_ID,
  ANALYTICS_SCRIPT_CATEGORY,
  ANALYTICS_SCRIPT_ID,
  type AnalyticsBrowserSettings,
  type DeclaredAnalyticsScript,
} from './domain/analytics-script'
export {
  clientErrorSchema,
  createAnalyticsRoutes,
  CLIENT_ERROR_PATH,
  type ClientErrorReport,
} from './presentation/client-error-routes'
export { ANALYTICS_SCRIPT_PATH, createBrowserScriptRoutes } from './presentation/browser-script-route'
export {
  AnalyticsNotConfiguredError,
  provideAnalytics,
  requireBrowserSettings,
  requireMonitoring,
  resetAnalyticsService,
  type AnalyticsServices,
} from './infrastructure/analytics-runtime'
export { analyticsModule } from './module'
