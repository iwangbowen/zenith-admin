import { authHandlers } from './auth';
import { usersHandlers } from './users';
import { rolesHandlers } from './roles';
import { menusHandlers } from './menus';
import { departmentsHandlers } from './departments';
import { positionsHandlers } from './positions';
import { dictsHandlers } from './dicts';
import { systemConfigsHandlers } from './system-configs';
import { noticesHandlers } from './notices';
import { filesHandlers } from './files';
import { cronJobsHandlers } from './cron-jobs';
import { monitorHandlers } from './monitor';
import { loginLogsHandlers } from './login-logs';
import { operationLogsHandlers } from './operation-logs';
import { sessionsHandlers } from './sessions';
import { regionsHandlers } from './regions';
import { emailConfigHandlers } from './email-config';
import { dashboardHandlers } from './dashboard';
import { oauthHandlers } from './oauth';
import { oauthConfigHandlers } from './oauth-config';
import { dbBackupsHandlers } from './db-backups';
import { apiTokensHandlers } from './api-tokens';
import { tenantsHandlers } from './tenants';
import { cacheHandlers } from './cache';

export const handlers = [
  ...authHandlers,
  ...usersHandlers,
  ...rolesHandlers,
  ...menusHandlers,
  ...departmentsHandlers,
  ...positionsHandlers,
  ...dictsHandlers,
  ...systemConfigsHandlers,
  ...noticesHandlers,
  ...filesHandlers,
  ...cronJobsHandlers,
  ...monitorHandlers,
  ...loginLogsHandlers,
  ...operationLogsHandlers,
  ...sessionsHandlers,
  ...regionsHandlers,
  ...emailConfigHandlers,
  ...dashboardHandlers,
  ...oauthHandlers,
  ...oauthConfigHandlers,
  ...dbBackupsHandlers,
  ...apiTokensHandlers,
  ...tenantsHandlers,
  ...cacheHandlers,
];
