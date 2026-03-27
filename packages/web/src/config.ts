export const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '',
  wsBaseUrl: import.meta.env.VITE_WS_BASE_URL || '',
  appTitle: import.meta.env.VITE_APP_TITLE || 'Zenith Admin',
  multiTenantMode: import.meta.env.VITE_MULTI_TENANT_MODE === 'true',
};
