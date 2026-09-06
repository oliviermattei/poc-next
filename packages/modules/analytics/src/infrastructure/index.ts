/** Repositories et appels aux adapters de « analytics ». Ne connaît pas `presentation`. */
export {
  AnalyticsNotConfiguredError,
  provideAnalytics,
  requireBrowserSettings,
  requireMonitoring,
  resetAnalyticsService,
  type AnalyticsServices,
} from './analytics-runtime'
