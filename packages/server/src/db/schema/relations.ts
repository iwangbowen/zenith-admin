import { relations } from 'drizzle-orm';
import { departments, menus, positions, roleDeptScopes, roleMenus, roles, tenantPackageMenus, tenantPackages, tenants, userDeptScopes, userGroupMembers, userGroupRoles, userGroups, userMenus, userPositions, userRoles, users } from './core';
import { businessFiles, fileStorageConfigs, managedFiles, uploadChunks, uploadSessions } from './files';
import { asyncTaskItems, asyncTasks, exportJobDownloads, exportJobs } from './tasks';
import { cronJobLogs, cronJobs, systemConfigs, userFeedbacks } from './system';
import { loginRiskEvents, passwordResetTokens, userApiTokens, userMfaFactors, userOauthAccounts, userTrustedDevices } from './auth';
import { identityProviderSyncLogs, tenantIdentityProviders, userIdentityAccounts } from './identity-providers';
import { dictItems, dicts } from './dicts';
import { analyticsEventMeta, analyticsEventOverrides, analyticsExperiments, analyticsSegmentCampaigns, analyticsSites, analyticsSegmentMembers, analyticsUserProfiles, analyticsUserSegments, errorEvents, errorGroups } from './analytics';
import { announcementReads, announcementRecipients, announcements } from './announcements';
import { workflowAutomations, workflowCategories, workflowComments, workflowDefinitions, workflowDefinitionVersions, workflowDelegations, workflowForms, workflowInstances, workflowJobExecutions, workflowJobs, workflowQuickPhrases, workflowTaskConsults, workflowTasks, workflowTaskUrges, workflowTokens } from './workflow';
import { emailSendLogs, emailTemplates, inAppMessages, inAppTemplates, smsConfigs, smsSendLogs, smsTemplates } from './messaging';
import { dbBackups } from './db-admin';
import { ruleDecisionTables, ruleDecisionTableVersions, ruleTestCases } from './rules';
import { chatConversationMembers, chatConversations, chatMessageReactions, chatMessages, chatWebhooks, chatQuickReplies, chatScheduledMessages, chatCustomEmojis, chatGroupInvites, chatGroupJoinRequests } from './chat';
import { channelAutoReplies, channelConversations, channelMenus, channelMessages, channelMessageTargets, channelQuickReplies, channels, channelSubscriptions } from './channels';
import { paymentApps, paymentChannelConfigs, paymentOrders, paymentReconBatches, paymentReconItems, paymentRefunds, paymentSharingOrders, paymentSharingReceivers, paymentTransfers, paymentWebhookDeliveries, paymentWebhookEndpoints } from './payment';
import { aiConversations, aiMessages, aiPromptTemplates, aiProviderConfigs, userAiConfigs } from './ai';
import { appWebhookDeliveries, appWebhookSubscriptions, oauth2AuthorizationCodes, oauth2Clients, oauth2Tokens, oauth2UserGrants, ratePlans } from './open-platform';
import { checkinMilestones, coupons, memberCheckinMilestoneAwards, memberCheckins, memberCoupons, memberLevels, memberNotifications, memberPointAccounts, memberPointTransactions, members, memberTagBindings, memberTags, memberWallets, memberWalletTransactions } from './member';
import { monitorAlertEvents, monitorAlertRules } from './monitor';
import { mpAccounts, mpAutoReplies, mpBroadcasts, mpConditionalMenus, mpDrafts, mpFans, mpKfAccounts, mpKfRoutingConfigs, mpKfSessionEvents, mpKfSessions, mpMaterials, mpMenus, mpMessages, mpMessageTemplates, mpQrcodes, mpTags, mpTemplateSendLogs, mpUnmatchedKeywords } from './mp';
import { reportAlertRules, reportDashboardCategories, reportDashboardComments, reportDashboardEmbedTokens, reportDashboards, reportDashboardShares, reportDashboardSubscriptions, reportDashboardVersions, reportDatasetExecutionLogs, reportDatasets, reportDatasources, reportDeliveryAttempts, reportDeliveryRuns, reportFolders, reportPrintTemplates, reportShareAccessLogs } from './report';
import {
  reportAssetTemplates,
  reportAssetUsageLogs,
  reportChatbiMessages,
  reportChatbiSessions,
  reportDeprecationNotices,
  reportDqAnomalies,
  reportDqRules,
  reportDqRuns,
  reportDqScores,
  reportEnvironmentPromotions,
  reportEnvironments,
  reportFillRecords,
  reportFillTemplates,
  reportMaterializationSnapshots,
  reportMetrics,
  reportPublishApprovals,
  reportQueryCostLogs,
  reportQueryQuotas,
  reportResourceAcls,
  reportResourceTransfers,
  reportSlaRules,
  reportSlaViolations,
} from './report-platform';

// ─── 关联关系 ────────────────────────────────────────────────────────────────
export const errorGroupsRelations = relations(errorGroups, ({ many, one }) => ({
  events: many(errorEvents),
  assignee: one(users, { fields: [errorGroups.assigneeId], references: [users.id] }),
}));

export const errorEventsRelations = relations(errorEvents, ({ one }) => ({
  group: one(errorGroups, { fields: [errorEvents.groupId], references: [errorGroups.id] }),
}));


// 行为中心阶段 2：站点 → 租户
export const analyticsSitesRelations = relations(analyticsSites, ({ one }) => ({
  tenant: one(tenants, { fields: [analyticsSites.tenantId], references: [tenants.id] }),
}));

export const analyticsExperimentsRelations = relations(analyticsExperiments, ({ one }) => ({
  tenant: one(tenants, { fields: [analyticsExperiments.tenantId], references: [tenants.id] }),
}));

// 行为中心阶段 1：Tracking Plan 负责人
export const analyticsEventMetaRelations = relations(analyticsEventMeta, ({ one }) => ({
  owner: one(users, { fields: [analyticsEventMeta.ownerId], references: [users.id] }),
}));

// 行为中心阶段 1：租户级事件启停覆盖
export const analyticsEventOverridesRelations = relations(analyticsEventOverrides, ({ one }) => ({
  tenant: one(tenants, { fields: [analyticsEventOverrides.tenantId], references: [tenants.id] }),
}));

// 行为中心阶段 1：用户画像（userId / memberId 无物理外键，此处仅提供逻辑关联，供 RQB with 查询使用）
export const analyticsUserProfilesRelations = relations(analyticsUserProfiles, ({ one }) => ({
  tenant: one(tenants, { fields: [analyticsUserProfiles.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [analyticsUserProfiles.userId], references: [users.id] }),
  member: one(members, { fields: [analyticsUserProfiles.memberId], references: [members.id] }),
}));

// 行为中心阶段 1：分群定义 ↔ 分群成员物化快照
export const analyticsUserSegmentsRelations = relations(analyticsUserSegments, ({ one, many }) => ({
  tenant: one(tenants, { fields: [analyticsUserSegments.tenantId], references: [tenants.id] }),
  members: many(analyticsSegmentMembers),
  campaigns: many(analyticsSegmentCampaigns),
}));

export const analyticsSegmentMembersRelations = relations(analyticsSegmentMembers, ({ one }) => ({
  segment: one(analyticsUserSegments, { fields: [analyticsSegmentMembers.segmentId], references: [analyticsUserSegments.id] }),
  tenant: one(tenants, { fields: [analyticsSegmentMembers.tenantId], references: [tenants.id] }),
  member: one(members, { fields: [analyticsSegmentMembers.memberId], references: [members.id] }),
}));

export const analyticsSegmentCampaignsRelations = relations(analyticsSegmentCampaigns, ({ one }) => ({
  segment: one(analyticsUserSegments, { fields: [analyticsSegmentCampaigns.segmentId], references: [analyticsUserSegments.id] }),
  tenant: one(tenants, { fields: [analyticsSegmentCampaigns.tenantId], references: [tenants.id] }),
}));

export const channelsRelations = relations(channels, ({ many }) => ({
  messages: many(channelMessages),
  subscriptions: many(channelSubscriptions),
}));

export const channelMessagesRelations = relations(channelMessages, ({ one, many }) => ({
  channel: one(channels, { fields: [channelMessages.channelId], references: [channels.id] }),
  publishedBy: one(users, { fields: [channelMessages.publishedById], references: [users.id] }),
  targets: many(channelMessageTargets),
}));

export const channelSubscriptionsRelations = relations(channelSubscriptions, ({ one }) => ({
  channel: one(channels, { fields: [channelSubscriptions.channelId], references: [channels.id] }),
  user: one(users, { fields: [channelSubscriptions.userId], references: [users.id] }),
}));

export const channelMessageTargetsRelations = relations(channelMessageTargets, ({ one }) => ({
  message: one(channelMessages, { fields: [channelMessageTargets.messageId], references: [channelMessages.id] }),
  user: one(users, { fields: [channelMessageTargets.userId], references: [users.id] }),
}));

export const channelMenusRelations = relations(channelMenus, ({ one }) => ({
  channel: one(channels, { fields: [channelMenus.channelId], references: [channels.id] }),
}));

export const channelAutoRepliesRelations = relations(channelAutoReplies, ({ one }) => ({
  channel: one(channels, { fields: [channelAutoReplies.channelId], references: [channels.id] }),
}));

export const channelQuickRepliesRelations = relations(channelQuickReplies, ({ one }) => ({
  channel: one(channels, { fields: [channelQuickReplies.channelId], references: [channels.id] }),
}));

export const channelConversationsRelations = relations(channelConversations, ({ one }) => ({
  channel: one(channels, { fields: [channelConversations.channelId], references: [channels.id] }),
  user: one(users, { fields: [channelConversations.userId], references: [users.id] }),
  assignee: one(users, { fields: [channelConversations.assigneeId], references: [users.id] }),
}));

// ─── 支付中心关系声明 ─────────────────────────────────────────────────────────
export const paymentChannelConfigsRelations = relations(paymentChannelConfigs, ({ many }) => ({
  orders: many(paymentOrders),
}));

export const paymentOrdersRelations = relations(paymentOrders, ({ one, many }) => ({
  channelConfig: one(paymentChannelConfigs, { fields: [paymentOrders.channelConfigId], references: [paymentChannelConfigs.id] }),
  user: one(users, { fields: [paymentOrders.userId], references: [users.id] }),
  refunds: many(paymentRefunds),
}));

export const paymentRefundsRelations = relations(paymentRefunds, ({ one }) => ({
  order: one(paymentOrders, { fields: [paymentRefunds.orderId], references: [paymentOrders.id] }),
}));

// ═══════════════════════════════════════════════════════════════════════════
// 支付中心扩展 · A 档（对账 / Webhook / 资金台账）
// ═══════════════════════════════════════════════════════════════════════════

export const paymentReconBatchesRelations = relations(paymentReconBatches, ({ many }) => ({
  items: many(paymentReconItems),
}));

export const paymentReconItemsRelations = relations(paymentReconItems, ({ one }) => ({
  batch: one(paymentReconBatches, { fields: [paymentReconItems.batchId], references: [paymentReconBatches.id] }),
}));

export const paymentWebhookEndpointsRelations = relations(paymentWebhookEndpoints, ({ many }) => ({
  deliveries: many(paymentWebhookDeliveries),
}));

export const paymentWebhookDeliveriesRelations = relations(paymentWebhookDeliveries, ({ one }) => ({
  endpoint: one(paymentWebhookEndpoints, { fields: [paymentWebhookDeliveries.endpointId], references: [paymentWebhookEndpoints.id] }),
}));

// ═══════════════════════════════════════════════════════════════════════════
// 支付中心扩展 · B 档（费率 / 结算 / 分账 / 支付链接 / 风控 / 支付方式 / 报表）
// ═══════════════════════════════════════════════════════════════════════════

export const paymentSharingReceiversRelations = relations(paymentSharingReceivers, ({ many }) => ({
  sharingOrders: many(paymentSharingOrders),
}));

export const paymentSharingOrdersRelations = relations(paymentSharingOrders, ({ one }) => ({
  receiver: one(paymentSharingReceivers, { fields: [paymentSharingOrders.receiverId], references: [paymentSharingReceivers.id] }),
}));

export const paymentTransfersRelations = relations(paymentTransfers, ({ one }) => ({
  channelConfig: one(paymentChannelConfigs, { fields: [paymentTransfers.channelConfigId], references: [paymentChannelConfigs.id] }),
  operator: one(users, { fields: [paymentTransfers.operatorId], references: [users.id] }),
}));

export const paymentAppsRelations = relations(paymentApps, ({ one }) => ({
  wechatConfig: one(paymentChannelConfigs, { fields: [paymentApps.wechatConfigId], references: [paymentChannelConfigs.id], relationName: 'appWechatConfig' }),
  alipayConfig: one(paymentChannelConfigs, { fields: [paymentApps.alipayConfigId], references: [paymentChannelConfigs.id], relationName: 'appAlipayConfig' }),
  unionpayConfig: one(paymentChannelConfigs, { fields: [paymentApps.unionpayConfigId], references: [paymentChannelConfigs.id], relationName: 'appUnionpayConfig' }),
}));

export const tenantsRelations = relations(tenants, ({ one, many }) => ({
  package: one(tenantPackages, { fields: [tenants.packageId], references: [tenantPackages.id] }),
  departments: many(departments),
  positions: many(positions),
  users: many(users),
  roles: many(roles),
  dicts: many(dicts),
  userGroups: many(userGroups),
  managedFiles: many(managedFiles),
  exportJobs: many(exportJobs),
  exportJobDownloads: many(exportJobDownloads),
  announcements: many(announcements),
  systemConfigs: many(systemConfigs),
  loginRiskEvents: many(loginRiskEvents),
  identityProviders: many(tenantIdentityProviders),
  workflowDefinitions: many(workflowDefinitions),
  workflowInstances: many(workflowInstances),
  analyticsExperiments: many(analyticsExperiments),
}));

export const tenantPackagesRelations = relations(tenantPackages, ({ many }) => ({
  packageMenus: many(tenantPackageMenus),
  tenants: many(tenants),
}));

export const tenantPackageMenusRelations = relations(tenantPackageMenus, ({ one }) => ({
  package: one(tenantPackages, { fields: [tenantPackageMenus.packageId], references: [tenantPackages.id] }),
  menu: one(menus, { fields: [tenantPackageMenus.menuId], references: [menus.id] }),
}));

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  tenant: one(tenants, { fields: [departments.tenantId], references: [tenants.id] }),
  users: many(users),
  leader: one(users, { fields: [departments.leaderId], references: [users.id], relationName: 'departmentLeader' }),
  userGroups: many(userGroups),
}));

export const positionsRelations = relations(positions, ({ one, many }) => ({
  tenant: one(tenants, { fields: [positions.tenantId], references: [tenants.id] }),
  userPositions: many(userPositions),
}));

export const userGroupsRelations = relations(userGroups, ({ one, many }) => ({
  tenant: one(tenants, { fields: [userGroups.tenantId], references: [tenants.id] }),
  owner: one(users, { fields: [userGroups.ownerId], references: [users.id], relationName: 'userGroupOwner' }),
  department: one(departments, { fields: [userGroups.departmentId], references: [departments.id] }),
  members: many(userGroupMembers),
  groupRoles: many(userGroupRoles),
}));

export const userGroupMembersRelations = relations(userGroupMembers, ({ one }) => ({
  group: one(userGroups, { fields: [userGroupMembers.groupId], references: [userGroups.id] }),
  user: one(users, { fields: [userGroupMembers.userId], references: [users.id] }),
}));

export const userGroupRolesRelations = relations(userGroupRoles, ({ one }) => ({
  group: one(userGroups, { fields: [userGroupRoles.groupId], references: [userGroups.id] }),
  role: one(roles, { fields: [userGroupRoles.roleId], references: [roles.id] }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  department: one(departments, { fields: [users.departmentId], references: [departments.id] }),
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
  userRoles: many(userRoles),
  userPositions: many(userPositions),
  userGroupMembers: many(userGroupMembers),
  ownedUserGroups: many(userGroups, { relationName: 'userGroupOwner' }),
  oauthAccounts: many(userOauthAccounts),
  apiTokens: many(userApiTokens),
  passwordResetTokens: many(passwordResetTokens),
  leadingDepartments: many(departments, { relationName: 'departmentLeader' }),
  userMenus: many(userMenus),
  userDeptScopes: many(userDeptScopes),
  exportJobs: many(exportJobs),
  exportJobDownloads: many(exportJobDownloads),
  mfaFactors: many(userMfaFactors),
  trustedDevices: many(userTrustedDevices),
  loginRiskEvents: many(loginRiskEvents),
  identityAccounts: many(userIdentityAccounts),
}));

export const rolesRelations = relations(roles, ({ one, many }) => ({
  tenant: one(tenants, { fields: [roles.tenantId], references: [tenants.id] }),
  roleMenus: many(roleMenus),
  userRoles: many(userRoles),
  deptScopes: many(roleDeptScopes),
  userGroupRoles: many(userGroupRoles),
}));

export const menusRelations = relations(menus, ({ many }) => ({
  roleMenus: many(roleMenus),
  userMenus: many(userMenus),
  tenantPackageMenus: many(tenantPackageMenus),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}));

export const userPositionsRelations = relations(userPositions, ({ one }) => ({
  user: one(users, { fields: [userPositions.userId], references: [users.id] }),
  position: one(positions, { fields: [userPositions.positionId], references: [positions.id] }),
}));

export const roleMenusRelations = relations(roleMenus, ({ one }) => ({
  role: one(roles, { fields: [roleMenus.roleId], references: [roles.id] }),
  menu: one(menus, { fields: [roleMenus.menuId], references: [menus.id] }),
}));

export const roleDeptScopesRelations = relations(roleDeptScopes, ({ one }) => ({
  role: one(roles, { fields: [roleDeptScopes.roleId], references: [roles.id] }),
  department: one(departments, { fields: [roleDeptScopes.deptId], references: [departments.id] }),
}));

export const userMenusRelations = relations(userMenus, ({ one }) => ({
  user: one(users, { fields: [userMenus.userId], references: [users.id] }),
  menu: one(menus, { fields: [userMenus.menuId], references: [menus.id] }),
}));

export const userDeptScopesRelations = relations(userDeptScopes, ({ one }) => ({
  user: one(users, { fields: [userDeptScopes.userId], references: [users.id] }),
  department: one(departments, { fields: [userDeptScopes.deptId], references: [departments.id] }),
}));

export const dictsRelations = relations(dicts, ({ one, many }) => ({
  tenant: one(tenants, { fields: [dicts.tenantId], references: [tenants.id] }),
  items: many(dictItems),
}));

export const dictItemsRelations = relations(dictItems, ({ one, many }) => ({
  dict: one(dicts, { fields: [dictItems.dictId], references: [dicts.id] }),
  parent: one(dictItems, { fields: [dictItems.parentId], references: [dictItems.id], relationName: 'parent_child' }),
  children: many(dictItems, { relationName: 'parent_child' }),
}));

export const fileStorageConfigsRelations = relations(fileStorageConfigs, ({ many }) => ({
  files: many(managedFiles),
}));

export const managedFilesRelations = relations(managedFiles, ({ one }) => ({
  storageConfig: one(fileStorageConfigs, { fields: [managedFiles.storageConfigId], references: [fileStorageConfigs.id] }),
  tenant: one(tenants, { fields: [managedFiles.tenantId], references: [tenants.id] }),
  createdByUser: one(users, { fields: [managedFiles.createdBy], references: [users.id] }),
}));

export const uploadSessionsRelations = relations(uploadSessions, ({ one, many }) => ({
  storageConfig: one(fileStorageConfigs, { fields: [uploadSessions.storageConfigId], references: [fileStorageConfigs.id] }),
  tenant: one(tenants, { fields: [uploadSessions.tenantId], references: [tenants.id] }),
  createdByUser: one(users, { fields: [uploadSessions.createdBy], references: [users.id] }),
  chunks: many(uploadChunks),
}));

export const uploadChunksRelations = relations(uploadChunks, ({ one }) => ({
  session: one(uploadSessions, { fields: [uploadChunks.uploadSessionId], references: [uploadSessions.id] }),
}));

export const exportJobsRelations = relations(exportJobs, ({ one, many }) => ({
  file: one(managedFiles, { fields: [exportJobs.fileId], references: [managedFiles.id] }),
  tenant: one(tenants, { fields: [exportJobs.tenantId], references: [tenants.id] }),
  createdByUser: one(users, { fields: [exportJobs.createdBy], references: [users.id] }),
  downloads: many(exportJobDownloads),
}));

export const exportJobDownloadsRelations = relations(exportJobDownloads, ({ one }) => ({
  job: one(exportJobs, { fields: [exportJobDownloads.jobId], references: [exportJobs.id] }),
  user: one(users, { fields: [exportJobDownloads.downloadedBy], references: [users.id] }),
  tenant: one(tenants, { fields: [exportJobDownloads.tenantId], references: [tenants.id] }),
}));

export const asyncTasksRelations = relations(asyncTasks, ({ one, many }) => ({
  tenant: one(tenants, { fields: [asyncTasks.tenantId], references: [tenants.id] }),
  createdByUser: one(users, { fields: [asyncTasks.createdBy], references: [users.id] }),
  items: many(asyncTaskItems),
}));

export const asyncTaskItemsRelations = relations(asyncTaskItems, ({ one }) => ({
  task: one(asyncTasks, { fields: [asyncTaskItems.taskId], references: [asyncTasks.id] }),
}));

export const cronJobsRelations = relations(cronJobs, ({ many }) => ({
  logs: many(cronJobLogs),
}));

export const cronJobLogsRelations = relations(cronJobLogs, ({ one }) => ({
  job: one(cronJobs, { fields: [cronJobLogs.jobId], references: [cronJobs.id] }),
}));

export const userFeedbacksRelations = relations(userFeedbacks, ({ one }) => ({
  user: one(users, { fields: [userFeedbacks.userId], references: [users.id], relationName: 'feedbackSubmitter' }),
  handler: one(users, { fields: [userFeedbacks.handledBy], references: [users.id], relationName: 'feedbackHandler' }),
}));

export const announcementsRelations = relations(announcements, ({ one, many }) => ({
  tenant: one(tenants, { fields: [announcements.tenantId], references: [tenants.id] }),
  reads: many(announcementReads),
  recipients: many(announcementRecipients),
  attachments: many(businessFiles),
}));

export const announcementReadsRelations = relations(announcementReads, ({ one }) => ({
  announcement: one(announcements, { fields: [announcementReads.announcementId], references: [announcements.id] }),
}));

export const announcementRecipientsRelations = relations(announcementRecipients, ({ one }) => ({
  announcement: one(announcements, { fields: [announcementRecipients.announcementId], references: [announcements.id] }),
}));

export const businessFilesRelations = relations(businessFiles, ({ one }) => ({
  file: one(managedFiles, { fields: [businessFiles.fileId], references: [managedFiles.id] }),
  tenant: one(tenants, { fields: [businessFiles.tenantId], references: [tenants.id] }),
}));

export const userOauthAccountsRelations = relations(userOauthAccounts, ({ one }) => ({
  user: one(users, { fields: [userOauthAccounts.userId], references: [users.id] }),
}));

export const tenantIdentityProvidersRelations = relations(tenantIdentityProviders, ({ one, many }) => ({
  tenant: one(tenants, { fields: [tenantIdentityProviders.tenantId], references: [tenants.id] }),
  accounts: many(userIdentityAccounts),
  syncLogs: many(identityProviderSyncLogs),
}));

export const userIdentityAccountsRelations = relations(userIdentityAccounts, ({ one }) => ({
  user: one(users, { fields: [userIdentityAccounts.userId], references: [users.id] }),
  provider: one(tenantIdentityProviders, { fields: [userIdentityAccounts.providerId], references: [tenantIdentityProviders.id] }),
}));

export const identityProviderSyncLogsRelations = relations(identityProviderSyncLogs, ({ one }) => ({
  provider: one(tenantIdentityProviders, { fields: [identityProviderSyncLogs.providerId], references: [tenantIdentityProviders.id] }),
}));

export const userApiTokensRelations = relations(userApiTokens, ({ one }) => ({
  user: one(users, { fields: [userApiTokens.userId], references: [users.id] }),
}));

export const passwordResetTokensRelations = relations(passwordResetTokens, ({ one }) => ({
  user: one(users, { fields: [passwordResetTokens.userId], references: [users.id] }),
}));

export const userMfaFactorsRelations = relations(userMfaFactors, ({ one }) => ({
  user: one(users, { fields: [userMfaFactors.userId], references: [users.id] }),
}));

export const userTrustedDevicesRelations = relations(userTrustedDevices, ({ one }) => ({
  user: one(users, { fields: [userTrustedDevices.userId], references: [users.id] }),
}));

export const loginRiskEventsRelations = relations(loginRiskEvents, ({ one }) => ({
  user: one(users, { fields: [loginRiskEvents.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [loginRiskEvents.tenantId], references: [tenants.id] }),
}));

export const dbBackupsRelations = relations(dbBackups, ({ one }) => ({
  file: one(managedFiles, { fields: [dbBackups.fileId], references: [managedFiles.id] }),
  createdByUser: one(users, { fields: [dbBackups.createdBy], references: [users.id] }),
}));

export const workflowCategoriesRelations = relations(workflowCategories, ({ one, many }) => ({
  tenant: one(tenants, { fields: [workflowCategories.tenantId], references: [tenants.id] }),
  definitions: many(workflowDefinitions),
  forms: many(workflowForms),
}));

export const workflowFormsRelations = relations(workflowForms, ({ one, many }) => ({
  tenant: one(tenants, { fields: [workflowForms.tenantId], references: [tenants.id] }),
  createdByUser: one(users, { fields: [workflowForms.createdBy], references: [users.id] }),
  category: one(workflowCategories, { fields: [workflowForms.categoryId], references: [workflowCategories.id] }),
  definitions: many(workflowDefinitions),
}));

export const workflowDefinitionsRelations = relations(workflowDefinitions, ({ one, many }) => ({
  tenant: one(tenants, { fields: [workflowDefinitions.tenantId], references: [tenants.id] }),
  createdByUser: one(users, { fields: [workflowDefinitions.createdBy], references: [users.id] }),
  category: one(workflowCategories, { fields: [workflowDefinitions.categoryId], references: [workflowCategories.id] }),
  form: one(workflowForms, { fields: [workflowDefinitions.formId], references: [workflowForms.id] }),
  instances: many(workflowInstances),
  versions: many(workflowDefinitionVersions),
  automations: many(workflowAutomations),
}));

export const ruleDecisionTablesRelations = relations(ruleDecisionTables, ({ one, many }) => ({
  tenant: one(tenants, { fields: [ruleDecisionTables.tenantId], references: [tenants.id] }),
  category: one(workflowCategories, { fields: [ruleDecisionTables.categoryId], references: [workflowCategories.id] }),
  createdByUser: one(users, { fields: [ruleDecisionTables.createdBy], references: [users.id] }),
  versions: many(ruleDecisionTableVersions),
  cases: many(ruleTestCases),
}));

export const ruleDecisionTableVersionsRelations = relations(ruleDecisionTableVersions, ({ one }) => ({
  table: one(ruleDecisionTables, { fields: [ruleDecisionTableVersions.tableId], references: [ruleDecisionTables.id] }),
  publishedByUser: one(users, { fields: [ruleDecisionTableVersions.publishedBy], references: [users.id] }),
  tenant: one(tenants, { fields: [ruleDecisionTableVersions.tenantId], references: [tenants.id] }),
}));

export const ruleTestCasesRelations = relations(ruleTestCases, ({ one }) => ({
  table: one(ruleDecisionTables, { fields: [ruleTestCases.tableId], references: [ruleDecisionTables.id] }),
  tenant: one(tenants, { fields: [ruleTestCases.tenantId], references: [tenants.id] }),
}));

export const workflowAutomationsRelations = relations(workflowAutomations, ({ one }) => ({
  definition: one(workflowDefinitions, { fields: [workflowAutomations.definitionId], references: [workflowDefinitions.id] }),
  tenant: one(tenants, { fields: [workflowAutomations.tenantId], references: [tenants.id] }),
}));

export const workflowDefinitionVersionsRelations = relations(workflowDefinitionVersions, ({ one }) => ({
  definition: one(workflowDefinitions, { fields: [workflowDefinitionVersions.definitionId], references: [workflowDefinitions.id] }),
  publishedByUser: one(users, { fields: [workflowDefinitionVersions.publishedBy], references: [users.id] }),
  tenant: one(tenants, { fields: [workflowDefinitionVersions.tenantId], references: [tenants.id] }),
}));

export const workflowCommentsRelations = relations(workflowComments, ({ one }) => ({
  instance: one(workflowInstances, { fields: [workflowComments.instanceId], references: [workflowInstances.id] }),
  task: one(workflowTasks, { fields: [workflowComments.taskId], references: [workflowTasks.id] }),
  user: one(users, { fields: [workflowComments.userId], references: [users.id] }),
}));

export const workflowQuickPhrasesRelations = relations(workflowQuickPhrases, ({ one }) => ({
  user: one(users, { fields: [workflowQuickPhrases.userId], references: [users.id] }),
}));

export const workflowDelegationsRelations = relations(workflowDelegations, ({ one }) => ({
  principal: one(users, { fields: [workflowDelegations.principalId], references: [users.id], relationName: 'delegationPrincipal' }),
  delegate: one(users, { fields: [workflowDelegations.delegateId], references: [users.id], relationName: 'delegationDelegate' }),
  definition: one(workflowDefinitions, { fields: [workflowDelegations.definitionId], references: [workflowDefinitions.id] }),
  tenant: one(tenants, { fields: [workflowDelegations.tenantId], references: [tenants.id] }),
}));

export const workflowTaskConsultsRelations = relations(workflowTaskConsults, ({ one }) => ({
  task: one(workflowTasks, { fields: [workflowTaskConsults.taskId], references: [workflowTasks.id] }),
  instance: one(workflowInstances, { fields: [workflowTaskConsults.instanceId], references: [workflowInstances.id] }),
  inviter: one(users, { fields: [workflowTaskConsults.inviterId], references: [users.id], relationName: 'consultInviter' }),
  consultee: one(users, { fields: [workflowTaskConsults.consulteeId], references: [users.id], relationName: 'consultConsultee' }),
}));

export const workflowInstancesRelations = relations(workflowInstances, ({ one, many }) => ({
  definition: one(workflowDefinitions, { fields: [workflowInstances.definitionId], references: [workflowDefinitions.id] }),
  initiator: one(users, { fields: [workflowInstances.initiatorId], references: [users.id] }),
  tenant: one(tenants, { fields: [workflowInstances.tenantId], references: [tenants.id] }),
  tasks: many(workflowTasks),
  tokens: many(workflowTokens),
}));

export const workflowTasksRelations = relations(workflowTasks, ({ one, many }) => ({
  instance: one(workflowInstances, { fields: [workflowTasks.instanceId], references: [workflowInstances.id] }),
  assignee: one(users, { fields: [workflowTasks.assigneeId], references: [users.id] }),
  urges: many(workflowTaskUrges),
}));

export const workflowTokensRelations = relations(workflowTokens, ({ one }) => ({
  instance: one(workflowInstances, { fields: [workflowTokens.instanceId], references: [workflowInstances.id] }),
  tenant: one(tenants, { fields: [workflowTokens.tenantId], references: [tenants.id] }),
}));

export const workflowTaskUrgesRelations = relations(workflowTaskUrges, ({ one }) => ({
  task: one(workflowTasks, { fields: [workflowTaskUrges.taskId], references: [workflowTasks.id] }),
  instance: one(workflowInstances, { fields: [workflowTaskUrges.instanceId], references: [workflowInstances.id] }),
  urger: one(users, { fields: [workflowTaskUrges.urgerId], references: [users.id] }),
}));

export const workflowJobsRelations = relations(workflowJobs, ({ one, many }) => ({
  instance: one(workflowInstances, { fields: [workflowJobs.instanceId], references: [workflowInstances.id] }),
  task: one(workflowTasks, { fields: [workflowJobs.taskId], references: [workflowTasks.id] }),
  tenant: one(tenants, { fields: [workflowJobs.tenantId], references: [tenants.id] }),
  executions: many(workflowJobExecutions),
}));

export const workflowJobExecutionsRelations = relations(workflowJobExecutions, ({ one }) => ({
  job: one(workflowJobs, { fields: [workflowJobExecutions.jobId], references: [workflowJobs.id] }),
}));

export const chatConversationsRelations = relations(chatConversations, ({ one, many }) => ({
  createdByUser: one(users, { fields: [chatConversations.createdBy], references: [users.id] }),
  tenant: one(tenants, { fields: [chatConversations.tenantId], references: [tenants.id] }),
  members: many(chatConversationMembers),
  messages: many(chatMessages),
}));

export const chatConversationMembersRelations = relations(chatConversationMembers, ({ one }) => ({
  conversation: one(chatConversations, { fields: [chatConversationMembers.conversationId], references: [chatConversations.id] }),
  user: one(users, { fields: [chatConversationMembers.userId], references: [users.id] }),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one, many }) => ({
  conversation: one(chatConversations, { fields: [chatMessages.conversationId], references: [chatConversations.id] }),
  sender: one(users, { fields: [chatMessages.senderId], references: [users.id] }),
  reactions: many(chatMessageReactions),
}));

export const chatMessageReactionsRelations = relations(chatMessageReactions, ({ one }) => ({
  message: one(chatMessages, { fields: [chatMessageReactions.messageId], references: [chatMessages.id] }),
  user: one(users, { fields: [chatMessageReactions.userId], references: [users.id] }),
}));

export const chatWebhooksRelations = relations(chatWebhooks, ({ one }) => ({
  conversation: one(chatConversations, { fields: [chatWebhooks.conversationId], references: [chatConversations.id] }),
  tenant: one(tenants, { fields: [chatWebhooks.tenantId], references: [tenants.id] }),
}));

export const chatQuickRepliesRelations = relations(chatQuickReplies, ({ one }) => ({
  user: one(users, { fields: [chatQuickReplies.userId], references: [users.id] }),
}));

export const chatScheduledMessagesRelations = relations(chatScheduledMessages, ({ one }) => ({
  conversation: one(chatConversations, { fields: [chatScheduledMessages.conversationId], references: [chatConversations.id] }),
  sender: one(users, { fields: [chatScheduledMessages.senderId], references: [users.id] }),
}));

export const chatCustomEmojisRelations = relations(chatCustomEmojis, ({ one }) => ({
  user: one(users, { fields: [chatCustomEmojis.userId], references: [users.id] }),
}));

export const chatGroupInvitesRelations = relations(chatGroupInvites, ({ one }) => ({
  conversation: one(chatConversations, { fields: [chatGroupInvites.conversationId], references: [chatConversations.id] }),
  creator: one(users, { fields: [chatGroupInvites.createdBy], references: [users.id] }),
}));

export const chatGroupJoinRequestsRelations = relations(chatGroupJoinRequests, ({ one }) => ({
  conversation: one(chatConversations, { fields: [chatGroupJoinRequests.conversationId], references: [chatConversations.id] }),
  user: one(users, { fields: [chatGroupJoinRequests.userId], references: [users.id] }),
  invite: one(chatGroupInvites, { fields: [chatGroupJoinRequests.inviteId], references: [chatGroupInvites.id] }),
}));

// ─── 通知模块 relations ─────────────────────────────────────────────────────
export const emailTemplatesRelations = relations(emailTemplates, ({ one, many }) => ({
  tenant: one(tenants, { fields: [emailTemplates.tenantId], references: [tenants.id] }),
  logs: many(emailSendLogs),
}));

export const emailSendLogsRelations = relations(emailSendLogs, ({ one }) => ({
  template: one(emailTemplates, { fields: [emailSendLogs.templateId], references: [emailTemplates.id] }),
  user: one(users, { fields: [emailSendLogs.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [emailSendLogs.tenantId], references: [tenants.id] }),
}));

export const smsConfigsRelations = relations(smsConfigs, ({ one, many }) => ({
  tenant: one(tenants, { fields: [smsConfigs.tenantId], references: [tenants.id] }),
  logs: many(smsSendLogs),
}));

export const smsTemplatesRelations = relations(smsTemplates, ({ one, many }) => ({
  tenant: one(tenants, { fields: [smsTemplates.tenantId], references: [tenants.id] }),
  logs: many(smsSendLogs),
}));

export const smsSendLogsRelations = relations(smsSendLogs, ({ one }) => ({
  config: one(smsConfigs, { fields: [smsSendLogs.configId], references: [smsConfigs.id] }),
  template: one(smsTemplates, { fields: [smsSendLogs.templateId], references: [smsTemplates.id] }),
  user: one(users, { fields: [smsSendLogs.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [smsSendLogs.tenantId], references: [tenants.id] }),
}));

export const inAppTemplatesRelations = relations(inAppTemplates, ({ one, many }) => ({
  tenant: one(tenants, { fields: [inAppTemplates.tenantId], references: [tenants.id] }),
  messages: many(inAppMessages),
}));

export const inAppMessagesRelations = relations(inAppMessages, ({ one }) => ({
  template: one(inAppTemplates, { fields: [inAppMessages.templateId], references: [inAppTemplates.id] }),
  user: one(users, { fields: [inAppMessages.userId], references: [users.id], relationName: 'inAppMessageUser' }),
  sender: one(users, { fields: [inAppMessages.senderId], references: [users.id], relationName: 'inAppMessageSender' }),
  tenant: one(tenants, { fields: [inAppMessages.tenantId], references: [tenants.id] }),
}));

// ─── AI 对话模块 ──────────────────────────────────────────────────────────────

export const aiProviderConfigsRelations = relations(aiProviderConfigs, ({ one }) => ({
  createdByUser: one(users, { fields: [aiProviderConfigs.createdBy], references: [users.id] }),
}));

export const aiConversationsRelations = relations(aiConversations, ({ one, many }) => ({
  user: one(users, { fields: [aiConversations.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [aiConversations.tenantId], references: [tenants.id] }),
  messages: many(aiMessages),
}));

export const aiMessagesRelations = relations(aiMessages, ({ one }) => ({
  conversation: one(aiConversations, { fields: [aiMessages.conversationId], references: [aiConversations.id] }),
}));

export const userAiConfigsRelations = relations(userAiConfigs, ({ one }) => ({
  user: one(users, { fields: [userAiConfigs.userId], references: [users.id] }),
}));

export const aiPromptTemplatesRelations = relations(aiPromptTemplates, ({ one }) => ({
  user: one(users, { fields: [aiPromptTemplates.userId], references: [users.id] }),
  createdByUser: one(users, { fields: [aiPromptTemplates.createdBy], references: [users.id] }),
}));

// ─── 数据脱敏配置 ─────────────────────────────────────────────────────────────

export const oauth2ClientsRelations = relations(oauth2Clients, ({ one }) => ({
  owner: one(users, { fields: [oauth2Clients.ownerId], references: [users.id] }),
  ratePlan: one(ratePlans, { fields: [oauth2Clients.ratePlanId], references: [ratePlans.id] }),
}));

export const oauth2AuthorizationCodesRelations = relations(oauth2AuthorizationCodes, ({ one }) => ({
  user: one(users, { fields: [oauth2AuthorizationCodes.userId], references: [users.id] }),
}));

export const oauth2TokensRelations = relations(oauth2Tokens, ({ one }) => ({
  user: one(users, { fields: [oauth2Tokens.userId], references: [users.id] }),
}));

export const oauth2UserGrantsRelations = relations(oauth2UserGrants, ({ one }) => ({
  user: one(users, { fields: [oauth2UserGrants.userId], references: [users.id] }),
}));

// ─── 开放平台 / 开发者门户 ────────────────────────────────────────────────────

export const ratePlansRelations = relations(ratePlans, ({ many }) => ({
  clients: many(oauth2Clients),
}));

// ─── 开放平台：应用级 Webhook 订阅 ────────────────────────────────────────────

export const appWebhookSubscriptionsRelations = relations(appWebhookSubscriptions, ({ many }) => ({
  deliveries: many(appWebhookDeliveries),
}));

export const appWebhookDeliveriesRelations = relations(appWebhookDeliveries, ({ one }) => ({
  subscription: one(appWebhookSubscriptions, { fields: [appWebhookDeliveries.subscriptionId], references: [appWebhookSubscriptions.id] }),
}));

// ─── 会员中心关系声明 ─────────────────────────────────────────────────────────
export const memberLevelsRelations = relations(memberLevels, ({ many }) => ({
  members: many(members),
}));

export const memberPointAccountsRelations = relations(memberPointAccounts, ({ one }) => ({
  member: one(members, { fields: [memberPointAccounts.memberId], references: [members.id] }),
}));

export const memberPointTransactionsRelations = relations(memberPointTransactions, ({ one }) => ({
  member: one(members, { fields: [memberPointTransactions.memberId], references: [members.id] }),
}));

export const memberWalletsRelations = relations(memberWallets, ({ one }) => ({
  member: one(members, { fields: [memberWallets.memberId], references: [members.id] }),
}));

export const memberWalletTransactionsRelations = relations(memberWalletTransactions, ({ one }) => ({
  member: one(members, { fields: [memberWalletTransactions.memberId], references: [members.id] }),
  paymentOrder: one(paymentOrders, { fields: [memberWalletTransactions.paymentOrderId], references: [paymentOrders.id] }),
}));

export const couponsRelations = relations(coupons, ({ many }) => ({
  memberCoupons: many(memberCoupons),
}));

export const memberCouponsRelations = relations(memberCoupons, ({ one }) => ({
  coupon: one(coupons, { fields: [memberCoupons.couponId], references: [coupons.id] }),
  member: one(members, { fields: [memberCoupons.memberId], references: [members.id] }),
}));

export const memberCheckinsRelations = relations(memberCheckins, ({ one }) => ({
  member: one(members, { fields: [memberCheckins.memberId], references: [members.id] }),
}));

export const checkinMilestonesRelations = relations(checkinMilestones, ({ one }) => ({
  coupon: one(coupons, { fields: [checkinMilestones.couponId], references: [coupons.id] }),
}));

export const memberCheckinMilestoneAwardsRelations = relations(memberCheckinMilestoneAwards, ({ one }) => ({
  member: one(members, { fields: [memberCheckinMilestoneAwards.memberId], references: [members.id] }),
  milestone: one(checkinMilestones, { fields: [memberCheckinMilestoneAwards.milestoneId], references: [checkinMilestones.id] }),
}));

export const membersRelations = relations(members, ({ one, many }) => ({
  level: one(memberLevels, { fields: [members.levelId], references: [memberLevels.id] }),
  tenant: one(tenants, { fields: [members.tenantId], references: [tenants.id] }),
  pointAccount: one(memberPointAccounts, { fields: [members.id], references: [memberPointAccounts.memberId] }),
  wallet: one(memberWallets, { fields: [members.id], references: [memberWallets.memberId] }),
  pointTransactions: many(memberPointTransactions),
  walletTransactions: many(memberWalletTransactions),
  memberCoupons: many(memberCoupons),
  checkins: many(memberCheckins),
  tagBindings: many(memberTagBindings),
}));

export const memberTagsRelations = relations(memberTags, ({ many }) => ({
  bindings: many(memberTagBindings),
}));

export const memberTagBindingsRelations = relations(memberTagBindings, ({ one }) => ({
  member: one(members, { fields: [memberTagBindings.memberId], references: [members.id] }),
  tag: one(memberTags, { fields: [memberTagBindings.tagId], references: [memberTags.id] }),
}));

export const memberNotificationsRelations = relations(memberNotifications, ({ one }) => ({
  member: one(members, { fields: [memberNotifications.memberId], references: [members.id] }),
}));

export const monitorAlertRulesRelations = relations(monitorAlertRules, ({ many }) => ({
  events: many(monitorAlertEvents),
}));

export const monitorAlertEventsRelations = relations(monitorAlertEvents, ({ one }) => ({
  rule: one(monitorAlertRules, { fields: [monitorAlertEvents.ruleId], references: [monitorAlertRules.id] }),
}));

export const mpAccountsRelations = relations(mpAccounts, ({ one, many }) => ({
  tenant: one(tenants, { fields: [mpAccounts.tenantId], references: [tenants.id] }),
  tags: many(mpTags),
  fans: many(mpFans),
}));

export const mpTagsRelations = relations(mpTags, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpTags.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpTags.tenantId], references: [tenants.id] }),
}));

export const mpFansRelations = relations(mpFans, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpFans.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpFans.tenantId], references: [tenants.id] }),
}));

export const mpMessagesRelations = relations(mpMessages, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpMessages.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpMessages.tenantId], references: [tenants.id] }),
}));

export const mpAutoRepliesRelations = relations(mpAutoReplies, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpAutoReplies.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpAutoReplies.tenantId], references: [tenants.id] }),
}));

export const mpUnmatchedKeywordsRelations = relations(mpUnmatchedKeywords, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpUnmatchedKeywords.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpUnmatchedKeywords.tenantId], references: [tenants.id] }),
}));

export const mpMenusRelations = relations(mpMenus, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpMenus.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpMenus.tenantId], references: [tenants.id] }),
}));

export const mpConditionalMenusRelations = relations(mpConditionalMenus, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpConditionalMenus.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpConditionalMenus.tenantId], references: [tenants.id] }),
}));

export const mpMaterialsRelations = relations(mpMaterials, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpMaterials.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpMaterials.tenantId], references: [tenants.id] }),
}));

export const mpDraftsRelations = relations(mpDrafts, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpDrafts.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpDrafts.tenantId], references: [tenants.id] }),
}));

export const mpMessageTemplatesRelations = relations(mpMessageTemplates, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpMessageTemplates.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpMessageTemplates.tenantId], references: [tenants.id] }),
}));

export const mpTemplateSendLogsRelations = relations(mpTemplateSendLogs, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpTemplateSendLogs.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpTemplateSendLogs.tenantId], references: [tenants.id] }),
}));

export const mpBroadcastsRelations = relations(mpBroadcasts, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpBroadcasts.accountId], references: [mpAccounts.id] }),
  tag: one(mpTags, { fields: [mpBroadcasts.tagId], references: [mpTags.id] }),
  tenant: one(tenants, { fields: [mpBroadcasts.tenantId], references: [tenants.id] }),
}));

export const mpQrcodesRelations = relations(mpQrcodes, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpQrcodes.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpQrcodes.tenantId], references: [tenants.id] }),
}));

export const mpKfAccountsRelations = relations(mpKfAccounts, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpKfAccounts.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpKfAccounts.tenantId], references: [tenants.id] }),
}));

export const mpKfSessionsRelations = relations(mpKfSessions, ({ one, many }) => ({
  account: one(mpAccounts, { fields: [mpKfSessions.accountId], references: [mpAccounts.id] }),
  kf: one(mpKfAccounts, { fields: [mpKfSessions.kfId], references: [mpKfAccounts.id] }),
  events: many(mpKfSessionEvents),
  tenant: one(tenants, { fields: [mpKfSessions.tenantId], references: [tenants.id] }),
}));

export const mpKfSessionEventsRelations = relations(mpKfSessionEvents, ({ one }) => ({
  session: one(mpKfSessions, { fields: [mpKfSessionEvents.sessionId], references: [mpKfSessions.id] }),
  fromKf: one(mpKfAccounts, { fields: [mpKfSessionEvents.fromKfId], references: [mpKfAccounts.id] }),
  toKf: one(mpKfAccounts, { fields: [mpKfSessionEvents.toKfId], references: [mpKfAccounts.id] }),
}));

export const mpKfRoutingConfigsRelations = relations(mpKfRoutingConfigs, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpKfRoutingConfigs.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpKfRoutingConfigs.tenantId], references: [tenants.id] }),
}));

export const reportPrintTemplatesRelations = relations(reportPrintTemplates, ({ one }) => ({
  dataset: one(reportDatasets, { fields: [reportPrintTemplates.datasetId], references: [reportDatasets.id] }),
  tenant: one(tenants, { fields: [reportPrintTemplates.tenantId], references: [tenants.id] }),
  folder: one(reportFolders, { fields: [reportPrintTemplates.folderId], references: [reportFolders.id] }),
  owner: one(users, { fields: [reportPrintTemplates.ownerId], references: [users.id], relationName: 'reportPrintTemplateOwner' }),
}));

export const reportAlertRulesRelations = relations(reportAlertRules, ({ one, many }) => ({
  dataset: one(reportDatasets, { fields: [reportAlertRules.datasetId], references: [reportDatasets.id] }),
  metric: one(reportMetrics, { fields: [reportAlertRules.metricId], references: [reportMetrics.id] }),
  deliveryRuns: many(reportDeliveryRuns),
}));

export const reportDashboardCommentsRelations = relations(reportDashboardComments, ({ one, many }) => ({
  dashboard: one(reportDashboards, { fields: [reportDashboardComments.dashboardId], references: [reportDashboards.id] }),
  user: one(users, { fields: [reportDashboardComments.userId], references: [users.id] }),
  parent: one(reportDashboardComments, { fields: [reportDashboardComments.parentId], references: [reportDashboardComments.id], relationName: 'reportDashboardCommentReplies' }),
  replies: many(reportDashboardComments, { relationName: 'reportDashboardCommentReplies' }),
  resolvedByUser: one(users, { fields: [reportDashboardComments.resolvedBy], references: [users.id], relationName: 'reportDashboardCommentResolvedBy' }),
  deletedByUser: one(users, { fields: [reportDashboardComments.deletedBy], references: [users.id], relationName: 'reportDashboardCommentDeletedBy' }),
}));

export const reportFoldersRelations = relations(reportFolders, ({ one, many }) => ({
  tenant: one(tenants, { fields: [reportFolders.tenantId], references: [tenants.id] }),
  owner: one(users, { fields: [reportFolders.ownerId], references: [users.id], relationName: 'reportFolderOwner' }),
  parent: one(reportFolders, { fields: [reportFolders.parentId], references: [reportFolders.id], relationName: 'reportFolderChildren' }),
  children: many(reportFolders, { relationName: 'reportFolderChildren' }),
  datasources: many(reportDatasources),
  datasets: many(reportDatasets),
  dashboards: many(reportDashboards),
  printTemplates: many(reportPrintTemplates),
  metrics: many(reportMetrics),
  assetTemplates: many(reportAssetTemplates),
  fillTemplates: many(reportFillTemplates),
}));

export const reportDatasourcesRelations = relations(reportDatasources, ({ one, many }) => ({
  tenant: one(tenants, { fields: [reportDatasources.tenantId], references: [tenants.id] }),
  folder: one(reportFolders, { fields: [reportDatasources.folderId], references: [reportFolders.id] }),
  owner: one(users, { fields: [reportDatasources.ownerId], references: [users.id], relationName: 'reportDatasourceOwner' }),
  datasets: many(reportDatasets),
  executionLogs: many(reportDatasetExecutionLogs),
  queryCostLogs: many(reportQueryCostLogs),
  chatbiSessions: many(reportChatbiSessions),
}));

export const reportDatasetsRelations = relations(reportDatasets, ({ one, many }) => ({
  tenant: one(tenants, { fields: [reportDatasets.tenantId], references: [tenants.id] }),
  folder: one(reportFolders, { fields: [reportDatasets.folderId], references: [reportFolders.id] }),
  owner: one(users, { fields: [reportDatasets.ownerId], references: [users.id], relationName: 'reportDatasetOwner' }),
  datasource: one(reportDatasources, { fields: [reportDatasets.datasourceId], references: [reportDatasources.id] }),
  executionLogs: many(reportDatasetExecutionLogs),
  deliveryRuns: many(reportDeliveryRuns),
  metrics: many(reportMetrics),
  dqRules: many(reportDqRules),
  dqRuns: many(reportDqRuns),
  dqScores: many(reportDqScores),
  dqAnomalies: many(reportDqAnomalies),
  materializationSnapshots: many(reportMaterializationSnapshots),
  queryCostLogs: many(reportQueryCostLogs),
  slaRules: many(reportSlaRules),
  slaViolations: many(reportSlaViolations),
  chatbiSessions: many(reportChatbiSessions),
  generatedFillRecords: many(reportFillRecords),
}));

export const reportDatasetExecutionLogsRelations = relations(reportDatasetExecutionLogs, ({ one }) => ({
  dataset: one(reportDatasets, { fields: [reportDatasetExecutionLogs.datasetId], references: [reportDatasets.id] }),
  datasource: one(reportDatasources, { fields: [reportDatasetExecutionLogs.datasourceId], references: [reportDatasources.id] }),
  user: one(users, { fields: [reportDatasetExecutionLogs.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [reportDatasetExecutionLogs.tenantId], references: [tenants.id] }),
}));

export const reportDashboardsRelations = relations(reportDashboards, ({ one, many }) => ({
  tenant: one(tenants, { fields: [reportDashboards.tenantId], references: [tenants.id] }),
  folder: one(reportFolders, { fields: [reportDashboards.folderId], references: [reportFolders.id] }),
  owner: one(users, { fields: [reportDashboards.ownerId], references: [users.id], relationName: 'reportDashboardOwner' }),
  category: one(reportDashboardCategories, { fields: [reportDashboards.categoryId], references: [reportDashboardCategories.id] }),
  publishedByUser: one(users, { fields: [reportDashboards.publishedBy], references: [users.id] }),
  versions: many(reportDashboardVersions),
  shares: many(reportDashboardShares),
  embedTokens: many(reportDashboardEmbedTokens),
  subscriptions: many(reportDashboardSubscriptions),
  deliveryRuns: many(reportDeliveryRuns),
}));

export const reportDashboardVersionsRelations = relations(reportDashboardVersions, ({ one }) => ({
  dashboard: one(reportDashboards, { fields: [reportDashboardVersions.dashboardId], references: [reportDashboards.id] }),
}));

export const reportDashboardSharesRelations = relations(reportDashboardShares, ({ one, many }) => ({
  dashboard: one(reportDashboards, { fields: [reportDashboardShares.dashboardId], references: [reportDashboards.id] }),
  accessLogs: many(reportShareAccessLogs),
}));

export const reportDashboardEmbedTokensRelations = relations(reportDashboardEmbedTokens, ({ one }) => ({
  dashboard: one(reportDashboards, { fields: [reportDashboardEmbedTokens.dashboardId], references: [reportDashboards.id] }),
}));

export const reportShareAccessLogsRelations = relations(reportShareAccessLogs, ({ one }) => ({
  share: one(reportDashboardShares, { fields: [reportShareAccessLogs.shareId], references: [reportDashboardShares.id] }),
}));

export const reportDashboardSubscriptionsRelations = relations(reportDashboardSubscriptions, ({ one, many }) => ({
  dashboard: one(reportDashboards, { fields: [reportDashboardSubscriptions.dashboardId], references: [reportDashboards.id] }),
  deliveryRuns: many(reportDeliveryRuns),
}));

export const reportDeliveryRunsRelations = relations(reportDeliveryRuns, ({ one, many }) => ({
  tenant: one(tenants, { fields: [reportDeliveryRuns.tenantId], references: [tenants.id] }),
  subscription: one(reportDashboardSubscriptions, { fields: [reportDeliveryRuns.subscriptionId], references: [reportDashboardSubscriptions.id] }),
  alertRule: one(reportAlertRules, { fields: [reportDeliveryRuns.alertRuleId], references: [reportAlertRules.id] }),
  dashboard: one(reportDashboards, { fields: [reportDeliveryRuns.dashboardId], references: [reportDashboards.id] }),
  dataset: one(reportDatasets, { fields: [reportDeliveryRuns.datasetId], references: [reportDatasets.id] }),
  acknowledgedUser: one(users, { fields: [reportDeliveryRuns.acknowledgedBy], references: [users.id], relationName: 'reportDeliveryAcknowledgedBy' }),
  requestedUser: one(users, { fields: [reportDeliveryRuns.requestedBy], references: [users.id], relationName: 'reportDeliveryRequestedBy' }),
  attempts: many(reportDeliveryAttempts),
}));

export const reportDeliveryAttemptsRelations = relations(reportDeliveryAttempts, ({ one }) => ({
  tenant: one(tenants, { fields: [reportDeliveryAttempts.tenantId], references: [tenants.id] }),
  run: one(reportDeliveryRuns, { fields: [reportDeliveryAttempts.runId], references: [reportDeliveryRuns.id] }),
}));

export const reportMetricsRelations = relations(reportMetrics, ({ one, many }) => ({
  tenant: one(tenants, { fields: [reportMetrics.tenantId], references: [tenants.id] }),
  folder: one(reportFolders, { fields: [reportMetrics.folderId], references: [reportFolders.id] }),
  owner: one(users, { fields: [reportMetrics.ownerId], references: [users.id], relationName: 'reportMetricOwner' }),
  dataset: one(reportDatasets, { fields: [reportMetrics.datasetId], references: [reportDatasets.id] }),
  publishedByUser: one(users, { fields: [reportMetrics.publishedBy], references: [users.id], relationName: 'reportMetricPublishedBy' }),
  deprecatedByUser: one(users, { fields: [reportMetrics.deprecatedBy], references: [users.id], relationName: 'reportMetricDeprecatedBy' }),
  alertRules: many(reportAlertRules),
}));

export const reportResourceAclsRelations = relations(reportResourceAcls, ({ one }) => ({
  tenant: one(tenants, { fields: [reportResourceAcls.tenantId], references: [tenants.id] }),
  grantedByUser: one(users, { fields: [reportResourceAcls.grantedBy], references: [users.id], relationName: 'reportAclGrantedBy' }),
}));

export const reportPublishApprovalsRelations = relations(reportPublishApprovals, ({ one }) => ({
  tenant: one(tenants, { fields: [reportPublishApprovals.tenantId], references: [tenants.id] }),
  requestedByUser: one(users, { fields: [reportPublishApprovals.requestedBy], references: [users.id], relationName: 'reportApprovalRequestedBy' }),
  decidedByUser: one(users, { fields: [reportPublishApprovals.decidedBy], references: [users.id], relationName: 'reportApprovalDecidedBy' }),
}));

export const reportResourceTransfersRelations = relations(reportResourceTransfers, ({ one }) => ({
  tenant: one(tenants, { fields: [reportResourceTransfers.tenantId], references: [tenants.id] }),
  fromOwner: one(users, { fields: [reportResourceTransfers.fromOwnerId], references: [users.id], relationName: 'reportTransferFromOwner' }),
  toOwner: one(users, { fields: [reportResourceTransfers.toOwnerId], references: [users.id], relationName: 'reportTransferToOwner' }),
  requestedByUser: one(users, { fields: [reportResourceTransfers.requestedBy], references: [users.id], relationName: 'reportTransferRequestedBy' }),
  decidedByUser: one(users, { fields: [reportResourceTransfers.decidedBy], references: [users.id], relationName: 'reportTransferDecidedBy' }),
}));

export const reportEnvironmentsRelations = relations(reportEnvironments, ({ one, many }) => ({
  tenant: one(tenants, { fields: [reportEnvironments.tenantId], references: [tenants.id] }),
  sourcePromotions: many(reportEnvironmentPromotions, { relationName: 'reportPromotionSourceEnvironment' }),
  targetPromotions: many(reportEnvironmentPromotions, { relationName: 'reportPromotionTargetEnvironment' }),
}));

export const reportEnvironmentPromotionsRelations = relations(reportEnvironmentPromotions, ({ one }) => ({
  tenant: one(tenants, { fields: [reportEnvironmentPromotions.tenantId], references: [tenants.id] }),
  sourceEnvironment: one(reportEnvironments, {
    fields: [reportEnvironmentPromotions.sourceEnvironmentId],
    references: [reportEnvironments.id],
    relationName: 'reportPromotionSourceEnvironment',
  }),
  targetEnvironment: one(reportEnvironments, {
    fields: [reportEnvironmentPromotions.targetEnvironmentId],
    references: [reportEnvironments.id],
    relationName: 'reportPromotionTargetEnvironment',
  }),
  requestedByUser: one(users, { fields: [reportEnvironmentPromotions.requestedBy], references: [users.id], relationName: 'reportPromotionRequestedBy' }),
  approvedByUser: one(users, { fields: [reportEnvironmentPromotions.approvedBy], references: [users.id], relationName: 'reportPromotionApprovedBy' }),
  deployedByUser: one(users, { fields: [reportEnvironmentPromotions.deployedBy], references: [users.id], relationName: 'reportPromotionDeployedBy' }),
}));

export const reportDqRulesRelations = relations(reportDqRules, ({ one, many }) => ({
  tenant: one(tenants, { fields: [reportDqRules.tenantId], references: [tenants.id] }),
  dataset: one(reportDatasets, { fields: [reportDqRules.datasetId], references: [reportDatasets.id] }),
  runs: many(reportDqRuns),
  anomalies: many(reportDqAnomalies),
}));

export const reportDqRunsRelations = relations(reportDqRuns, ({ one, many }) => ({
  tenant: one(tenants, { fields: [reportDqRuns.tenantId], references: [tenants.id] }),
  rule: one(reportDqRules, { fields: [reportDqRuns.ruleId], references: [reportDqRules.id] }),
  dataset: one(reportDatasets, { fields: [reportDqRuns.datasetId], references: [reportDatasets.id] }),
  requestedByUser: one(users, { fields: [reportDqRuns.requestedBy], references: [users.id], relationName: 'reportDqRunRequestedBy' }),
  anomalies: many(reportDqAnomalies),
}));

export const reportDqScoresRelations = relations(reportDqScores, ({ one }) => ({
  tenant: one(tenants, { fields: [reportDqScores.tenantId], references: [tenants.id] }),
  dataset: one(reportDatasets, { fields: [reportDqScores.datasetId], references: [reportDatasets.id] }),
}));

export const reportDqAnomaliesRelations = relations(reportDqAnomalies, ({ one }) => ({
  tenant: one(tenants, { fields: [reportDqAnomalies.tenantId], references: [tenants.id] }),
  dataset: one(reportDatasets, { fields: [reportDqAnomalies.datasetId], references: [reportDatasets.id] }),
  rule: one(reportDqRules, { fields: [reportDqAnomalies.ruleId], references: [reportDqRules.id] }),
  run: one(reportDqRuns, { fields: [reportDqAnomalies.runId], references: [reportDqRuns.id] }),
  acknowledgedByUser: one(users, { fields: [reportDqAnomalies.acknowledgedBy], references: [users.id], relationName: 'reportDqAnomalyAcknowledgedBy' }),
  resolvedByUser: one(users, { fields: [reportDqAnomalies.resolvedBy], references: [users.id], relationName: 'reportDqAnomalyResolvedBy' }),
}));

export const reportMaterializationSnapshotsRelations = relations(reportMaterializationSnapshots, ({ one }) => ({
  tenant: one(tenants, { fields: [reportMaterializationSnapshots.tenantId], references: [tenants.id] }),
  dataset: one(reportDatasets, { fields: [reportMaterializationSnapshots.datasetId], references: [reportDatasets.id] }),
  file: one(managedFiles, { fields: [reportMaterializationSnapshots.fileId], references: [managedFiles.id] }),
}));

export const reportQueryQuotasRelations = relations(reportQueryQuotas, ({ one }) => ({
  tenant: one(tenants, { fields: [reportQueryQuotas.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [reportQueryQuotas.userId], references: [users.id], relationName: 'reportQueryQuotaUser' }),
}));

export const reportQueryCostLogsRelations = relations(reportQueryCostLogs, ({ one }) => ({
  tenant: one(tenants, { fields: [reportQueryCostLogs.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [reportQueryCostLogs.userId], references: [users.id], relationName: 'reportQueryCostUser' }),
  dataset: one(reportDatasets, { fields: [reportQueryCostLogs.datasetId], references: [reportDatasets.id] }),
  datasource: one(reportDatasources, { fields: [reportQueryCostLogs.datasourceId], references: [reportDatasources.id] }),
}));

export const reportSlaRulesRelations = relations(reportSlaRules, ({ one, many }) => ({
  tenant: one(tenants, { fields: [reportSlaRules.tenantId], references: [tenants.id] }),
  dataset: one(reportDatasets, { fields: [reportSlaRules.datasetId], references: [reportDatasets.id] }),
  violations: many(reportSlaViolations),
}));

export const reportSlaViolationsRelations = relations(reportSlaViolations, ({ one }) => ({
  tenant: one(tenants, { fields: [reportSlaViolations.tenantId], references: [tenants.id] }),
  rule: one(reportSlaRules, { fields: [reportSlaViolations.ruleId], references: [reportSlaRules.id] }),
  dataset: one(reportDatasets, { fields: [reportSlaViolations.datasetId], references: [reportDatasets.id] }),
  acknowledgedByUser: one(users, { fields: [reportSlaViolations.acknowledgedBy], references: [users.id], relationName: 'reportSlaViolationAcknowledgedBy' }),
  resolvedByUser: one(users, { fields: [reportSlaViolations.resolvedBy], references: [users.id], relationName: 'reportSlaViolationResolvedBy' }),
}));

export const reportAssetUsageLogsRelations = relations(reportAssetUsageLogs, ({ one }) => ({
  tenant: one(tenants, { fields: [reportAssetUsageLogs.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [reportAssetUsageLogs.userId], references: [users.id], relationName: 'reportAssetUsageUser' }),
}));

export const reportDeprecationNoticesRelations = relations(reportDeprecationNotices, ({ one }) => ({
  tenant: one(tenants, { fields: [reportDeprecationNotices.tenantId], references: [tenants.id] }),
  publishedByUser: one(users, { fields: [reportDeprecationNotices.publishedBy], references: [users.id], relationName: 'reportDeprecationPublishedBy' }),
}));

export const reportAssetTemplatesRelations = relations(reportAssetTemplates, ({ one }) => ({
  tenant: one(tenants, { fields: [reportAssetTemplates.tenantId], references: [tenants.id] }),
  folder: one(reportFolders, { fields: [reportAssetTemplates.folderId], references: [reportFolders.id] }),
  owner: one(users, { fields: [reportAssetTemplates.ownerId], references: [users.id], relationName: 'reportAssetTemplateOwner' }),
  previewFile: one(managedFiles, { fields: [reportAssetTemplates.previewFileId], references: [managedFiles.id] }),
}));

export const reportChatbiSessionsRelations = relations(reportChatbiSessions, ({ one, many }) => ({
  tenant: one(tenants, { fields: [reportChatbiSessions.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [reportChatbiSessions.userId], references: [users.id], relationName: 'reportChatbiSessionUser' }),
  datasource: one(reportDatasources, { fields: [reportChatbiSessions.datasourceId], references: [reportDatasources.id] }),
  dataset: one(reportDatasets, { fields: [reportChatbiSessions.datasetId], references: [reportDatasets.id] }),
  messages: many(reportChatbiMessages),
}));

export const reportChatbiMessagesRelations = relations(reportChatbiMessages, ({ one }) => ({
  tenant: one(tenants, { fields: [reportChatbiMessages.tenantId], references: [tenants.id] }),
  session: one(reportChatbiSessions, { fields: [reportChatbiMessages.sessionId], references: [reportChatbiSessions.id] }),
  user: one(users, { fields: [reportChatbiMessages.userId], references: [users.id], relationName: 'reportChatbiMessageUser' }),
}));

export const reportFillTemplatesRelations = relations(reportFillTemplates, ({ one, many }) => ({
  tenant: one(tenants, { fields: [reportFillTemplates.tenantId], references: [tenants.id] }),
  folder: one(reportFolders, { fields: [reportFillTemplates.folderId], references: [reportFolders.id] }),
  owner: one(users, { fields: [reportFillTemplates.ownerId], references: [users.id], relationName: 'reportFillTemplateOwner' }),
  workflowDefinition: one(workflowDefinitions, { fields: [reportFillTemplates.workflowDefinitionId], references: [workflowDefinitions.id] }),
  publishedByUser: one(users, { fields: [reportFillTemplates.publishedBy], references: [users.id], relationName: 'reportFillTemplatePublishedBy' }),
  generatedDataset: one(reportDatasets, { fields: [reportFillTemplates.generatedDatasetId], references: [reportDatasets.id] }),
  records: many(reportFillRecords),
}));

export const reportFillRecordsRelations = relations(reportFillRecords, ({ one }) => ({
  tenant: one(tenants, { fields: [reportFillRecords.tenantId], references: [tenants.id] }),
  template: one(reportFillTemplates, { fields: [reportFillRecords.templateId], references: [reportFillTemplates.id] }),
  submitter: one(users, { fields: [reportFillRecords.submitterId], references: [users.id], relationName: 'reportFillRecordSubmitter' }),
  reviewedByUser: one(users, { fields: [reportFillRecords.reviewedBy], references: [users.id], relationName: 'reportFillRecordReviewedBy' }),
  workflowInstance: one(workflowInstances, { fields: [reportFillRecords.workflowInstanceId], references: [workflowInstances.id] }),
  generatedDataset: one(reportDatasets, { fields: [reportFillRecords.generatedDatasetId], references: [reportDatasets.id] }),
}));
