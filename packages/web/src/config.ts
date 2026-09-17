const deploymentId = (import.meta.env.VITE_DEPLOYMENT_ID || 'local').trim();

if (!/^[a-z][a-z0-9_-]*$/.test(deploymentId)) {
  throw new Error(`VITE_DEPLOYMENT_ID 格式无效：${deploymentId}`);
}

export const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '',
  wsBaseUrl: import.meta.env.VITE_WS_BASE_URL || '',
  appTitle: import.meta.env.VITE_APP_TITLE || 'Zenith Admin',
  deploymentId,
  multiTenantMode: import.meta.env.VITE_MULTI_TENANT_MODE === 'true',
};
