export const environment = {
  production: true,
  appName: 'SaaS Template',
  apiUrl: '/api',
  authUrl: '/api/auth',
  /**
   * Where "Accedi" goes. A different application on a different host, so it is
   * absolute in development and set per deployment in production — it used to be
   * `http://localhost:4300` hard-coded in the landing page's markup.
   */
  dashboardUrl: '/app',
};
