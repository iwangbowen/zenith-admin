import { authHandlers } from './auth';
import { usersHandlers } from './users';
import { rolesHandlers } from './roles';
import { menusHandlers } from './menus';
import { departmentsHandlers } from './departments';
import { positionsHandlers } from './positions';
import { userGroupsHandlers } from './user-groups';
import { dictsHandlers } from './dicts';
import { systemConfigsHandlers } from './system-configs';
import { announcementsHandlers } from './announcements';
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
import { workflowHandlers } from './workflow';
import { workflowAutomationsHandlers } from './workflow-automations';
import { chatHandlers } from './chat';
import { tagsHandlers } from './tags';
import { rateLimitHandlers } from './rate-limit';
import { emailTemplatesHandlers } from './email-templates';
import { emailSendLogsHandlers } from './email-send-logs';
import { smsConfigsHandlers } from './sms-configs';
import { smsTemplatesHandlers } from './sms-templates';
import { smsSendLogsHandlers } from './sms-send-logs';
import { aiProvidersHandlers } from './ai-providers';
import { aiConversationsHandlers } from './ai-conversations';
import { userAiConfigHandlers } from './user-ai-config';
import { oauth2AppsHandlers } from './oauth2-apps';
import { oauth2AuthHandlers } from './oauth2-auth';
import { inAppTemplatesHandlers } from './in-app-templates';
import { inAppMessagesHandlers } from './in-app-messages';
import { ipAccessLogsHandlers } from './ip-access-logs';
import { dataMaskHandlers } from './data-mask';
import { dbQueryFavoritesHandlers } from './db-query-favorites';
import { userPermissionsHandlers } from './user-permissions';
import { maintenanceHandlers } from './maintenance';

export const handlers = [
  ...authHandlers,
  ...usersHandlers,
  ...rolesHandlers,
  ...menusHandlers,
  ...departmentsHandlers,
  ...positionsHandlers,
  ...userGroupsHandlers,
  ...dictsHandlers,
  ...systemConfigsHandlers,
  ...announcementsHandlers,
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
  ...workflowHandlers,
  ...workflowAutomationsHandlers,
  ...chatHandlers,
  ...tagsHandlers,
  ...rateLimitHandlers,
  ...emailTemplatesHandlers,
  ...emailSendLogsHandlers,
  ...smsConfigsHandlers,
  ...smsTemplatesHandlers,
  ...smsSendLogsHandlers,
  ...inAppTemplatesHandlers,
  ...inAppMessagesHandlers,
  ...ipAccessLogsHandlers,
  ...dataMaskHandlers,
  ...dbQueryFavoritesHandlers,
  ...aiProvidersHandlers,
  ...aiConversationsHandlers,
  ...userAiConfigHandlers,
  ...oauth2AppsHandlers,
  ...oauth2AuthHandlers,
  ...userPermissionsHandlers,
  ...maintenanceHandlers,
];
