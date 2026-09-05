import { authHandlers } from './auth';
import { usersHandlers } from './users';
import { rolesHandlers } from './roles';
import { menusHandlers } from './menus';
import { departmentsHandlers } from './departments';
import { positionsHandlers } from './positions';
import { userGroupsHandlers } from './user-groups';
import { scopeMembersHandlers } from './scope-members';
import { dictsHandlers } from './dicts';
import { settingsHandlers } from './settings';
import { identitySecurityHandlers } from './identity-security';
import { identityProvidersHandlers } from './identity-providers';
import { directorySyncHandlers } from './directory-sync';
import { announcementsHandlers } from './announcements';
import { filesHandlers } from './files';
import { exportJobsHandlers } from './export-jobs';
import { asyncTasksHandlers } from './async-tasks';
import { systemSchedulerHandlers } from './system-scheduler';
import { cronJobsHandlers } from './cron-jobs';
import { monitorHandlers } from './monitor';
import { monitorAlertsHandlers } from './monitor-alerts';
import { sslCertificatesHandlers } from './ssl-certificates';
import { loginLogsHandlers } from './login-logs';
import { operationLogsHandlers } from './operation-logs';
import { sessionsHandlers } from './sessions';
import { regionsHandlers } from './regions';
import { emailConfigHandlers } from './email-config';
import { dashboardHandlers } from './dashboard';
import { oauthHandlers } from './oauth';
import { oauthConfigHandlers } from './oauth-config';
import { dbBackupsHandlers } from './db-backups';
import { dbAdminHandlers } from './db-admin';
import { opsOverviewHandlers } from './ops-overview';
import { opsHostHandlers } from './ops-hosts';
import { hostFileHandlers } from './host-files';
import { apiTokensHandlers } from './api-tokens';
import { tenantsHandlers } from './tenants';
import { tenantPackagesHandlers } from './tenant-packages';
import { licensingHandlers } from './licensing';
import { cacheHandlers } from './cache';
import { workflowHandlers } from './workflow';
import { workflowExtraHandlers } from './workflow-extra';
import { workflowFormsHandlers } from './workflow-forms';
import { workflowCategoriesHandlers } from './workflow-categories';
import { decisionTablesHandlers } from './decision-tables';
import { rulesP2Handlers } from './rules-p2';
import { userFeedbacksHandlers } from './user-feedbacks';
import { cmsHandlers, cmsP2Handlers, cmsP3Handlers, cmsP6Handlers } from './cms';
import { cmsStage3Handlers } from './cms-stage3';
import { cmsStage4Handlers } from './cms-stage4';
import { cmsStage5Handlers } from './cms-stage5';
import { cmsWidgetsHandlers } from './cms-widgets';
import { wikiHandlers } from './wiki';
import { driveHandlers } from './drive';
import { appReleasesHandlers } from './app-releases';
import { pushHandlers } from './push';
import { broadcastHandlers } from './broadcasts';
import { shortLinksHandlers } from './short-links';
import { marketingHandlers } from './marketing';
import { iotHandlers } from './iot';
import { traceHandlers } from './trace';
import { importJobsHandlers } from './import-jobs';
import { workflowAutomationsHandlers } from './workflow-automations';
import { workflowEventSubscriptionsHandlers } from './workflow-event-subscriptions';
import { workflowTriggerExecutionsHandlers } from './workflow-trigger-executions';
import { workflowHealthHandlers } from './workflow-health';
import { workflowDataSourcesHandlers } from './workflow-data-sources';
import { workflowConnectorsHandlers } from './workflow-connectors';
import { bizLeaveHandlers } from './biz-leave';
import { bizPayDemoHandlers } from './biz-pay-demo';
import { chatHandlers } from './chat';
import { chatBotsHandlers } from './chat-bots';
import { channelsHandlers } from './channels';
import { tagsHandlers } from './tags';
import { rateLimitHandlers } from './rate-limit';
import { retentionHandlers } from './retention';
import { emailTemplatesHandlers } from './email-templates';
import { emailSendLogsHandlers } from './email-send-logs';
import { smsConfigsHandlers } from './sms-configs';
import { mpAccountsHandlers } from './mp-accounts';
import { mpTagsHandlers } from './mp-tags';
import { mpFansHandlers } from './mp-fans';
import { mpMessagesHandlers } from './mp-messages';
import { mpAutoRepliesHandlers } from './mp-auto-replies';
import { mpMenuHandlers } from './mp-menu';
import { mpMaterialsHandlers } from './mp-materials';
import { mpDraftsHandlers } from './mp-drafts';
import { mpTemplatesHandlers } from './mp-templates';
import { mpStatsHandlers } from './mp-stats';
import { mpBroadcastsHandlers } from './mp-broadcasts';
import { mpQrcodesHandlers } from './mp-qrcodes';
import { mpKfAccountsHandlers } from './mp-kf-accounts';
import { mpKfSessionsHandlers } from './mp-kf-sessions';
import { mpConditionalMenusHandlers } from './mp-conditional-menus';
import { mpSecurityHandlers } from './mp-security';
import { mpJsSdkHandlers } from './mp-jssdk';
import { smsTemplatesHandlers } from './sms-templates';
import { smsSendLogsHandlers } from './sms-send-logs';
import { aiProvidersHandlers } from './ai-providers';
import { aiConversationsHandlers } from './ai-conversations';
import { aiPromptTemplatesHandlers } from './ai-prompt-templates';
import { aiUsageHandlers } from './ai-usage';
import { aiExtrasHandlers } from './ai-extras';
import { aiP3Handlers } from './ai-p3';
import { userAiConfigHandlers } from './user-ai-config';
import { oauth2AppsHandlers } from './oauth2-apps';
import { apiScopesHandlers } from './api-scopes';
import { ratePlansHandlers } from './rate-plans';
import { openPlatformHandlers } from './open-platform';
import { appWebhooksHandlers } from './app-webhooks';
import { developerAppsHandlers } from './developer-apps';
import { oauth2AuthHandlers } from './oauth2-auth';
import { inAppTemplatesHandlers } from './in-app-templates';
import { inAppMessagesHandlers } from './in-app-messages';
import { ipAccessLogsHandlers } from './ip-access-logs';
import { dataMaskHandlers } from './data-mask';
import { dbQueryFavoritesHandlers } from './db-query-favorites';
import { userPermissionsHandlers } from './user-permissions';
import { maintenanceHandlers } from './maintenance';
import { analyticsHandlers } from './analytics';
import { frontendErrorsHandlers } from './frontend-errors';
import { sessionReplaysHandlers } from './session-replays';
import { paymentHandlers } from './payment';
import { paymentExtHandlers } from './payment-ext';
import { paymentJournalHandlers } from './payment-journals';
import { paymentBExtHandlers } from './payment-bext';
import { paymentContractHandlers } from './payment-contracts';
import { paymentDisputeHandlers } from './payment-disputes';
import { paymentRiskOpsHandlers } from './payment-risk-ops';
import { paymentPreauthHandlers } from './payment-preauths';
import { memberFrontHandlers } from './member-front';
import { memberAdminHandlers } from './member-admin';
import { checkinHandlers } from './checkin';
import { terminalSessionsHandlers } from './terminal-sessions';
import { terminalFilesHandlers } from './terminal-files';
import { portsHandlers } from './ports';
import { nginxSitesHandlers } from './nginx-sites';
import { firewallHandlers } from './firewall';
import { reportHandlers } from './report';
import { reportPlatformHandlers } from './report-platform';
import { reportQualityCapacityHandlers } from './report-quality-capacity';
import { reportChatbiHandlers } from './report-chatbi';
import { reportFillHandlers } from './report-fill';
import { fallbackHandlers } from './fallback';

export const handlers = [
  ...authHandlers,
  ...usersHandlers,
  ...rolesHandlers,
  ...menusHandlers,
  ...departmentsHandlers,
  ...positionsHandlers,
  ...scopeMembersHandlers,
  ...userGroupsHandlers,
  ...dictsHandlers,
  ...settingsHandlers,
  ...identitySecurityHandlers,
  ...identityProvidersHandlers,
  ...directorySyncHandlers,
  ...announcementsHandlers,
  ...filesHandlers,
  ...exportJobsHandlers,
  ...asyncTasksHandlers,
  ...systemSchedulerHandlers,
  ...cronJobsHandlers,
  ...monitorHandlers,
  ...monitorAlertsHandlers,
  ...sslCertificatesHandlers,
  ...loginLogsHandlers,
  ...operationLogsHandlers,
  ...sessionsHandlers,
  ...regionsHandlers,
  ...emailConfigHandlers,
  ...dashboardHandlers,
  ...oauthHandlers,
  ...oauthConfigHandlers,
  ...dbBackupsHandlers,
  ...dbAdminHandlers,
  ...opsOverviewHandlers,
  ...opsHostHandlers,
  ...hostFileHandlers,
  ...apiTokensHandlers,
  ...tenantsHandlers,
  ...tenantPackagesHandlers,
  ...licensingHandlers,
  ...cacheHandlers,
  ...workflowExtraHandlers,
  ...workflowCategoriesHandlers,
  ...workflowDataSourcesHandlers,
  ...workflowConnectorsHandlers,
  ...workflowHandlers,
  ...workflowFormsHandlers,
  ...workflowAutomationsHandlers,
  ...workflowEventSubscriptionsHandlers,
  ...workflowTriggerExecutionsHandlers,
  ...workflowHealthHandlers,
  ...bizLeaveHandlers,
  ...bizPayDemoHandlers,
  ...chatHandlers,
  ...chatBotsHandlers,
  ...channelsHandlers,
  ...tagsHandlers,
  ...rateLimitHandlers,
  ...retentionHandlers,
  ...emailTemplatesHandlers,
  ...emailSendLogsHandlers,
  ...smsConfigsHandlers,
  ...mpAccountsHandlers,
  ...mpTagsHandlers,
  ...mpFansHandlers,
  ...mpMessagesHandlers,
  ...mpAutoRepliesHandlers,
  ...mpMenuHandlers,
  ...mpMaterialsHandlers,
  ...mpDraftsHandlers,
  ...mpTemplatesHandlers,
  ...mpStatsHandlers,
  ...mpBroadcastsHandlers,
  ...mpQrcodesHandlers,
  ...mpKfAccountsHandlers,
  ...mpKfSessionsHandlers,
  ...mpConditionalMenusHandlers,
  ...mpSecurityHandlers,
  ...mpJsSdkHandlers,
  ...smsTemplatesHandlers,
  ...smsSendLogsHandlers,
  ...inAppTemplatesHandlers,
  ...inAppMessagesHandlers,
  ...ipAccessLogsHandlers,
  ...dataMaskHandlers,
  ...dbQueryFavoritesHandlers,
  ...aiProvidersHandlers,
  ...aiConversationsHandlers,
  ...aiPromptTemplatesHandlers,
  ...aiUsageHandlers,
  ...aiExtrasHandlers,
  ...aiP3Handlers,
  ...userAiConfigHandlers,
  ...oauth2AppsHandlers,
  ...apiScopesHandlers,
  ...ratePlansHandlers,
  ...openPlatformHandlers,
  ...appWebhooksHandlers,
  ...developerAppsHandlers,
  ...oauth2AuthHandlers,
  ...userPermissionsHandlers,
  ...maintenanceHandlers,
  ...analyticsHandlers,
  ...frontendErrorsHandlers,
  ...sessionReplaysHandlers,
  ...paymentHandlers,
  ...paymentExtHandlers,
  ...paymentJournalHandlers,
  ...paymentBExtHandlers,
  ...paymentContractHandlers,
  ...paymentDisputeHandlers,
  ...paymentRiskOpsHandlers,
  ...paymentPreauthHandlers,
  ...memberFrontHandlers,
  ...memberAdminHandlers,
  ...checkinHandlers,
  ...terminalSessionsHandlers,
  ...terminalFilesHandlers,
  ...portsHandlers,
  ...nginxSitesHandlers,
  ...firewallHandlers,
  ...reportPlatformHandlers,
  ...reportQualityCapacityHandlers,
  ...reportChatbiHandlers,
  ...reportFillHandlers,
  ...reportHandlers,
  ...decisionTablesHandlers,
  ...rulesP2Handlers,
  ...userFeedbacksHandlers,
  ...cmsStage5Handlers,
  ...cmsStage4Handlers,
  ...cmsP6Handlers,
  ...cmsP3Handlers,
  ...cmsP2Handlers,
  ...cmsStage3Handlers,
  ...cmsHandlers,
  ...cmsWidgetsHandlers,
  ...wikiHandlers,
  ...driveHandlers,
  ...appReleasesHandlers,
  ...pushHandlers,
  ...broadcastHandlers,
  ...shortLinksHandlers,
  ...marketingHandlers,
  ...iotHandlers,
  ...traceHandlers,
  ...importJobsHandlers,
  // 兜底 handler 必须放在最后：拦截所有未实现的 /api/* 请求，避免 dev:demo 下被代理到后端返回 401 跳转登录页
  ...fallbackHandlers,
];
