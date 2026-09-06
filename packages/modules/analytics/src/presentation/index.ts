/** Routes, contrats et navigation de « analytics ». Ne connaît pas `infrastructure`. */
export {
  clientErrorSchema,
  createAnalyticsRoutes,
  CLIENT_ERROR_PATH,
  type ClientErrorReport,
} from './client-error-routes'
export { ANALYTICS_SCRIPT_PATH, createBrowserScriptRoutes } from './browser-script-route'
