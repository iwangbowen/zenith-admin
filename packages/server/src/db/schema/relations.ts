import { relations } from 'drizzle-orm';
import { departments, menus, positions, roleDeptScopes, roleMenus, roles, tenantPackageFeatures, tenantPackages, tenants, userDeptScopes, userGroupMembers, userGroupRoles, userGroups, userMenus, userPositions, userRoles, users } from './core';
import { businessFiles, fileStorageConfigs, managedFiles, uploadChunks, uploadSessions } from './files';
import { asyncTaskItems, asyncTasks, exportJobDownloads, exportJobs } from './tasks';
import { cronJobLogs, cronJobs, userFeedbacks } from './system';
import { loginRiskEvents, passwordResetTokens, userApiTokens, userMfaFactors, userOauthAccounts, userTrustedDevices } from './auth';
import { identityProviderSyncLogs, tenantIdentityProviders, userIdentityAccounts } from './identity-providers';
import { directorySyncConflicts, directorySyncDeptLinks, directorySyncRunItems, directorySyncRuns, directorySyncSources, directorySyncUserLinks } from './directory-sync';
import { dictItems, dicts } from './dicts';
import { analyticsEventMeta, analyticsEventOverrides, analyticsExperiments, analyticsSegmentCampaigns, analyticsSites, analyticsSegmentMembers, analyticsUserProfiles, analyticsUserSegments, errorEvents, errorGroups } from './analytics';
import { announcementReads, announcementRecipients, announcements } from './announcements';
import { workflowAutomations, workflowCategories, workflowComments, workflowDefinitions, workflowDefinitionVersions, workflowDelegations, workflowForms, workflowInstances, workflowJobExecutions, workflowJobs, workflowQuickPhrases, workflowTaskConsults, workflowTasks, workflowTaskUrges, workflowTokens } from './workflow';
import { broadcastCampaigns, emailSendLogs, emailTemplates, inAppMessages, inAppTemplates, pushConfigs, pushSendLogs, smsConfigs, smsSendLogs, smsTemplates } from './messaging';
import { dbBackups } from './db-admin';
import { ruleDecisionTables, ruleDecisionTableVersions, ruleTestCases } from './rules';
import { chatConversationMembers, chatConversations, chatMessageReactions, chatMessages, chatWebhooks, chatQuickReplies, chatScheduledMessages, chatCustomEmojis, chatGroupInvites, chatGroupJoinRequests } from './chat';
import { channelAutoReplies, channelConversations, channelMenus, channelMessages, channelMessageTargets, channelQuickReplies, channels, channelSubscriptions } from './channels';
import { paymentApps, paymentCashierSessions, paymentChannelConfigs, paymentContracts, paymentDeductPlans, paymentDisputeReplies, paymentDisputes, paymentFundReservations, paymentJournalLines, paymentJournals, paymentLedgerAccounts, paymentLinkRedemptions, paymentLinks, paymentOrders, paymentPreauths, paymentReconBatches, paymentReconItems, paymentRefunds, paymentRiskHits, paymentRiskReviews, paymentRiskRules, paymentSettlementBatches, paymentSettlementItems, paymentSharingOrders, paymentSharingReceivers, paymentSharingReversals, paymentTransfers } from './payment';
import { aiConversations, aiMessages, aiPromptTemplates, aiProviderConfigs, userAiConfigs, aiKnowledgeBases, aiKbDocuments, aiKbChunks } from './ai';
import { appWebhookDeliveries, appWebhookSubscriptions, oauth2AuthorizationCodes, oauth2Clients, oauth2TokenFamilies, oauth2Tokens, oauth2UserGrants, ratePlans } from './open-platform';
import { checkinMilestones, coupons, memberCheckinMilestoneAwards, memberCheckins, memberCoupons, memberLevels, memberNotifications, memberPointAccounts, memberPointTransactions, members, memberTagBindings, memberTags, memberVipRenewals, memberWallets, memberWalletTransactions } from './member';
import { monitorAlertEvents, monitorAlertRules } from './monitor';
import { appArtifacts, appReleases, clientApps, clientDevices } from './app-releases';
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
import {
  cmsAdEvents, cmsAds, cmsAdSlots, cmsChannelUsers, cmsChannels, cmsComments,
  cmsContentChannels, cmsContentFavorites, cmsContentLikes, cmsContentOpLogs,
  cmsContentRelations, cmsContents, cmsContentTags, cmsContentVersions, cmsDistributionRules, cmsForms,
  cmsFormSubmissions, cmsFriendLinks, cmsHotwordGroups, cmsHotwords,
  cmsInteractionAnswers, cmsInteractionQuestions, cmsInteractionResponses, cmsInteractions,
  cmsLinkWords, cmsMemberSubscriptions, cmsMemberViewHistory, cmsModelFields, cmsModels,
  cmsPageBlockAcls, cmsPages, cmsPublishArtifacts, cmsPushLogs,
  cmsRedirects, cmsResourceFolders, cmsResourceRefs, cmsResources, cmsSearchWords, cmsSiteInheritances, cmsSites, cmsSiteUsers,
  cmsOpenAppGrants, cmsContentTombstones, cmsWidgets, cmsWidgetRefs, cmsWidgetSourceRefs,
  cmsTags,
} from './cms';
import { wikiComments, wikiDocFavorites, wikiDocReadReceipts, wikiDocSubscriptions, wikiDocTags, wikiDocVersions, wikiDocViews, wikiDocs, wikiReviewRecords, wikiSpaceMembers, wikiSpaces, wikiTags } from './wiki';
import {
  iotAlarmRules, iotAlarms, iotCommands, iotDeviceEvents, iotDeviceGroupMembers, iotDeviceGroups,
  iotDevices, iotDeviceState, iotProductEvents, iotProductProperties, iotProducts, iotProductServices, iotTelemetry,
  iotFirmwares, iotOtaTaskDevices, iotOtaTasks, iotTelemetryHourly, iotAutomationRuns, iotAutomations,
  iotForwardRules, iotForwardLogs, iotDeviceLogs,
  iotMaintenanceWindows, iotSchedules, iotScheduleRuns, iotDeviceWhitelist,
} from './iot';
import {
  driveActivities, driveFileVersions, driveNodeComments, driveNodePermissions, driveNodes, driveNodeStars, driveNodeTags,
  driveNodeTexts, driveRecentAccess, driveShareAccessLogs, driveShareLinks, driveSpaceMembers, driveSpaces, driveTags, driveUploadBindings,
} from './drive';

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
  ledgerAccounts: many(paymentLedgerAccounts),
  journals: many(paymentJournals),
  fundReservations: many(paymentFundReservations),
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
// 支付中心扩展 · 对账
// ═══════════════════════════════════════════════════════════════════════════

export const paymentReconBatchesRelations = relations(paymentReconBatches, ({ one, many }) => ({
  app: one(paymentApps, { fields: [paymentReconBatches.appId], references: [paymentApps.id] }),
  channelConfig: one(paymentChannelConfigs, { fields: [paymentReconBatches.channelConfigId], references: [paymentChannelConfigs.id] }),
  items: many(paymentReconItems),
}));

export const paymentReconItemsRelations = relations(paymentReconItems, ({ one }) => ({
  batch: one(paymentReconBatches, { fields: [paymentReconItems.batchId], references: [paymentReconBatches.id] }),
}));

// ═══════════════════════════════════════════════════════════════════════════
// 支付中心扩展 · B 档（费率 / 结算 / 分账 / 支付链接 / 风控 / 支付方式 / 报表）
// ═══════════════════════════════════════════════════════════════════════════

export const paymentSharingReceiversRelations = relations(paymentSharingReceivers, ({ many }) => ({
  sharingOrders: many(paymentSharingOrders),
}));

export const paymentSharingOrdersRelations = relations(paymentSharingOrders, ({ one, many }) => ({
  receiver: one(paymentSharingReceivers, { fields: [paymentSharingOrders.receiverId], references: [paymentSharingReceivers.id] }),
  reversals: many(paymentSharingReversals),
}));

export const paymentSharingReversalsRelations = relations(paymentSharingReversals, ({ one }) => ({
  sharingOrder: one(paymentSharingOrders, { fields: [paymentSharingReversals.sharingOrderId], references: [paymentSharingOrders.id] }),
}));

export const paymentTransfersRelations = relations(paymentTransfers, ({ one }) => ({
  app: one(paymentApps, { fields: [paymentTransfers.appId], references: [paymentApps.id] }),
  channelConfig: one(paymentChannelConfigs, { fields: [paymentTransfers.channelConfigId], references: [paymentChannelConfigs.id] }),
  fundReservation: one(paymentFundReservations, { fields: [paymentTransfers.fundReservationId], references: [paymentFundReservations.id] }),
  operator: one(users, { fields: [paymentTransfers.operatorId], references: [users.id] }),
}));

export const paymentAppsRelations = relations(paymentApps, ({ one, many }) => ({
  openClient: one(oauth2Clients, { fields: [paymentApps.openClientId], references: [oauth2Clients.id], relationName: 'paymentAppOpenClient' }),
  wechatConfig: one(paymentChannelConfigs, { fields: [paymentApps.wechatConfigId], references: [paymentChannelConfigs.id], relationName: 'appWechatConfig' }),
  alipayConfig: one(paymentChannelConfigs, { fields: [paymentApps.alipayConfigId], references: [paymentChannelConfigs.id], relationName: 'appAlipayConfig' }),
  unionpayConfig: one(paymentChannelConfigs, { fields: [paymentApps.unionpayConfigId], references: [paymentChannelConfigs.id], relationName: 'appUnionpayConfig' }),
  ledgerAccounts: many(paymentLedgerAccounts),
  journals: many(paymentJournals),
  fundReservations: many(paymentFundReservations),
  riskReviews: many(paymentRiskReviews),
  cashierSessions: many(paymentCashierSessions),
  contracts: many(paymentContracts),
  preauths: many(paymentPreauths),
}));

export const paymentLedgerAccountsRelations = relations(paymentLedgerAccounts, ({ one, many }) => ({
  app: one(paymentApps, { fields: [paymentLedgerAccounts.appId], references: [paymentApps.id] }),
  channelConfig: one(paymentChannelConfigs, { fields: [paymentLedgerAccounts.channelConfigId], references: [paymentChannelConfigs.id] }),
  lines: many(paymentJournalLines),
  reservations: many(paymentFundReservations),
}));

export const paymentJournalsRelations = relations(paymentJournals, ({ one, many }) => ({
  app: one(paymentApps, { fields: [paymentJournals.appId], references: [paymentApps.id] }),
  channelConfig: one(paymentChannelConfigs, { fields: [paymentJournals.channelConfigId], references: [paymentChannelConfigs.id] }),
  reversalOf: one(paymentJournals, {
    fields: [paymentJournals.reversalOfJournalId],
    references: [paymentJournals.id],
    relationName: 'paymentJournalReversal',
  }),
  reversals: many(paymentJournals, { relationName: 'paymentJournalReversal' }),
  lines: many(paymentJournalLines),
}));

export const paymentJournalLinesRelations = relations(paymentJournalLines, ({ one, many }) => ({
  journal: one(paymentJournals, { fields: [paymentJournalLines.journalId], references: [paymentJournals.id] }),
  account: one(paymentLedgerAccounts, { fields: [paymentJournalLines.accountId], references: [paymentLedgerAccounts.id] }),
  settlementItems: many(paymentSettlementItems),
}));

export const paymentFundReservationsRelations = relations(paymentFundReservations, ({ one }) => ({
  account: one(paymentLedgerAccounts, { fields: [paymentFundReservations.accountId], references: [paymentLedgerAccounts.id] }),
  app: one(paymentApps, { fields: [paymentFundReservations.appId], references: [paymentApps.id] }),
  channelConfig: one(paymentChannelConfigs, { fields: [paymentFundReservations.channelConfigId], references: [paymentChannelConfigs.id] }),
}));

export const paymentSettlementBatchesRelations = relations(paymentSettlementBatches, ({ one, many }) => ({
  app: one(paymentApps, { fields: [paymentSettlementBatches.appId], references: [paymentApps.id] }),
  channelConfig: one(paymentChannelConfigs, { fields: [paymentSettlementBatches.channelConfigId], references: [paymentChannelConfigs.id] }),
  items: many(paymentSettlementItems),
}));

export const paymentSettlementItemsRelations = relations(paymentSettlementItems, ({ one }) => ({
  batch: one(paymentSettlementBatches, { fields: [paymentSettlementItems.batchId], references: [paymentSettlementBatches.id] }),
  journalLine: one(paymentJournalLines, { fields: [paymentSettlementItems.journalLineId], references: [paymentJournalLines.id] }),
  app: one(paymentApps, { fields: [paymentSettlementItems.appId], references: [paymentApps.id] }),
  channelConfig: one(paymentChannelConfigs, { fields: [paymentSettlementItems.channelConfigId], references: [paymentChannelConfigs.id] }),
}));

export const paymentLinksRelations = relations(paymentLinks, ({ one, many }) => ({
  app: one(paymentApps, { fields: [paymentLinks.appId], references: [paymentApps.id] }),
  redemptions: many(paymentLinkRedemptions),
  cashierSessions: many(paymentCashierSessions),
}));

export const paymentLinkRedemptionsRelations = relations(paymentLinkRedemptions, ({ one }) => ({
  link: one(paymentLinks, { fields: [paymentLinkRedemptions.linkId], references: [paymentLinks.id] }),
}));

export const paymentCashierSessionsRelations = relations(paymentCashierSessions, ({ one }) => ({
  link: one(paymentLinks, { fields: [paymentCashierSessions.linkId], references: [paymentLinks.id] }),
  app: one(paymentApps, { fields: [paymentCashierSessions.appId], references: [paymentApps.id] }),
  order: one(paymentOrders, { fields: [paymentCashierSessions.orderNo], references: [paymentOrders.orderNo] }),
}));

export const paymentDeductPlansRelations = relations(paymentDeductPlans, ({ many }) => ({
  contracts: many(paymentContracts),
}));

export const paymentContractsRelations = relations(paymentContracts, ({ one }) => ({
  plan: one(paymentDeductPlans, { fields: [paymentContracts.planId], references: [paymentDeductPlans.id] }),
  channelConfig: one(paymentChannelConfigs, { fields: [paymentContracts.channelConfigId], references: [paymentChannelConfigs.id] }),
  app: one(paymentApps, { fields: [paymentContracts.appId], references: [paymentApps.id] }),
}));

export const memberVipRenewalsRelations = relations(memberVipRenewals, ({ one }) => ({
  member: one(members, { fields: [memberVipRenewals.memberId], references: [members.id] }),
}));

export const paymentPreauthsRelations = relations(paymentPreauths, ({ one }) => ({
  channelConfig: one(paymentChannelConfigs, { fields: [paymentPreauths.channelConfigId], references: [paymentChannelConfigs.id] }),
  app: one(paymentApps, { fields: [paymentPreauths.appId], references: [paymentApps.id] }),
  operator: one(users, { fields: [paymentPreauths.operatorId], references: [users.id] }),
}));

export const paymentDisputesRelations = relations(paymentDisputes, ({ many }) => ({
  replies: many(paymentDisputeReplies),
}));

export const paymentDisputeRepliesRelations = relations(paymentDisputeReplies, ({ one }) => ({
  dispute: one(paymentDisputes, { fields: [paymentDisputeReplies.disputeId], references: [paymentDisputes.id] }),
  operator: one(users, { fields: [paymentDisputeReplies.operatorId], references: [users.id] }),
}));

export const paymentRiskHitsRelations = relations(paymentRiskHits, ({ one }) => ({
  rule: one(paymentRiskRules, { fields: [paymentRiskHits.ruleId], references: [paymentRiskRules.id] }),
  user: one(users, { fields: [paymentRiskHits.userId], references: [users.id] }),
}));

export const paymentRiskReviewsRelations = relations(paymentRiskReviews, ({ one }) => ({
  hit: one(paymentRiskHits, { fields: [paymentRiskReviews.hitId], references: [paymentRiskHits.id] }),
  app: one(paymentApps, { fields: [paymentRiskReviews.appId], references: [paymentApps.id] }),
  reviewer: one(users, { fields: [paymentRiskReviews.reviewerId], references: [users.id] }),
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
  loginRiskEvents: many(loginRiskEvents),
  identityProviders: many(tenantIdentityProviders),
  workflowDefinitions: many(workflowDefinitions),
  workflowInstances: many(workflowInstances),
  analyticsExperiments: many(analyticsExperiments),
}));

export const tenantPackagesRelations = relations(tenantPackages, ({ many }) => ({
  packageFeatures: many(tenantPackageFeatures),
  tenants: many(tenants),
}));

export const tenantPackageFeaturesRelations = relations(tenantPackageFeatures, ({ one }) => ({
  package: one(tenantPackages, { fields: [tenantPackageFeatures.packageId], references: [tenantPackages.id] }),
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
  ownedOauth2Clients: many(oauth2Clients, { relationName: 'oauth2ClientOwner' }),
  reviewedOauth2Clients: many(oauth2Clients, { relationName: 'oauth2ClientReviewer' }),
  oauth2TokenFamilies: many(oauth2TokenFamilies),
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
  cmsPublishArtifacts: many(cmsPublishArtifacts),
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

export const aiKnowledgeBasesRelations = relations(aiKnowledgeBases, ({ one, many }) => ({
  user: one(users, { fields: [aiKnowledgeBases.userId], references: [users.id] }),
  documents: many(aiKbDocuments),
}));

export const aiKbDocumentsRelations = relations(aiKbDocuments, ({ one, many }) => ({
  knowledgeBase: one(aiKnowledgeBases, { fields: [aiKbDocuments.kbId], references: [aiKnowledgeBases.id] }),
  chunks: many(aiKbChunks),
}));

export const aiKbChunksRelations = relations(aiKbChunks, ({ one }) => ({
  knowledgeBase: one(aiKnowledgeBases, { fields: [aiKbChunks.kbId], references: [aiKnowledgeBases.id] }),
  document: one(aiKbDocuments, { fields: [aiKbChunks.docId], references: [aiKbDocuments.id] }),
}));

// ─── 数据脱敏配置 ─────────────────────────────────────────────────────────────

export const oauth2ClientsRelations = relations(oauth2Clients, ({ one, many }) => ({
  tenant: one(tenants, { fields: [oauth2Clients.tenantId], references: [tenants.id] }),
  paymentApp: one(paymentApps, { fields: [oauth2Clients.id], references: [paymentApps.openClientId], relationName: 'paymentAppOpenClient' }),
  owner: one(users, { fields: [oauth2Clients.ownerId], references: [users.id], relationName: 'oauth2ClientOwner' }),
  reviewer: one(users, { fields: [oauth2Clients.reviewedBy], references: [users.id], relationName: 'oauth2ClientReviewer' }),
  ratePlan: one(ratePlans, { fields: [oauth2Clients.ratePlanId], references: [ratePlans.id] }),
  webhookSubscriptions: many(appWebhookSubscriptions),
}));

export const oauth2AuthorizationCodesRelations = relations(oauth2AuthorizationCodes, ({ one }) => ({
  user: one(users, { fields: [oauth2AuthorizationCodes.userId], references: [users.id] }),
}));

export const oauth2TokensRelations = relations(oauth2Tokens, ({ one }) => ({
  user: one(users, { fields: [oauth2Tokens.userId], references: [users.id] }),
  family: one(oauth2TokenFamilies, { fields: [oauth2Tokens.familyId], references: [oauth2TokenFamilies.id] }),
}));

export const oauth2TokenFamiliesRelations = relations(oauth2TokenFamilies, ({ one, many }) => ({
  user: one(users, { fields: [oauth2TokenFamilies.userId], references: [users.id] }),
  tokens: many(oauth2Tokens),
}));

export const oauth2UserGrantsRelations = relations(oauth2UserGrants, ({ one }) => ({
  user: one(users, { fields: [oauth2UserGrants.userId], references: [users.id] }),
}));

// ─── 开放平台 / 开发者门户 ────────────────────────────────────────────────────

export const ratePlansRelations = relations(ratePlans, ({ many }) => ({
  clients: many(oauth2Clients),
}));

// ─── 开放平台：应用级 Webhook 订阅 ────────────────────────────────────────────

export const appWebhookSubscriptionsRelations = relations(appWebhookSubscriptions, ({ one, many }) => ({
  client: one(oauth2Clients, { fields: [appWebhookSubscriptions.clientId], references: [oauth2Clients.clientId] }),
  tenant: one(tenants, { fields: [appWebhookSubscriptions.tenantId], references: [tenants.id] }),
  deliveries: many(appWebhookDeliveries),
}));

export const appWebhookDeliveriesRelations = relations(appWebhookDeliveries, ({ one }) => ({
  subscription: one(appWebhookSubscriptions, { fields: [appWebhookDeliveries.subscriptionId], references: [appWebhookSubscriptions.id] }),
  tenant: one(tenants, { fields: [appWebhookDeliveries.tenantId], references: [tenants.id] }),
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

// ─── CMS 内容管理 ─────────────────────────────────────────────────────────────
export const cmsSitesRelations = relations(cmsSites, ({ one, many }) => ({
  parent: one(cmsSites, { fields: [cmsSites.parentId], references: [cmsSites.id], relationName: 'cmsSiteHierarchy' }),
  children: many(cmsSites, { relationName: 'cmsSiteHierarchy' }),
  inheritance: one(cmsSiteInheritances, { fields: [cmsSites.id], references: [cmsSiteInheritances.siteId] }),
  channels: many(cmsChannels),
  contents: many(cmsContents),
  tags: many(cmsTags),
  friendLinks: many(cmsFriendLinks),
  resourceFolders: many(cmsResourceFolders),
  resources: many(cmsResources),
  searchWords: many(cmsSearchWords),
  hotwordGroups: many(cmsHotwordGroups),
  hotwords: many(cmsHotwords),
  publishArtifacts: many(cmsPublishArtifacts),
  interactions: many(cmsInteractions),
  subscriptions: many(cmsMemberSubscriptions),
  adEvents: many(cmsAdEvents),
  pages: many(cmsPages),
  widgets: many(cmsWidgets),
  sourceDistributionRules: many(cmsDistributionRules, { relationName: 'cmsDistributionSourceSite' }),
  targetDistributionRules: many(cmsDistributionRules, { relationName: 'cmsDistributionTargetSite' }),
}));

export const cmsSiteInheritancesRelations = relations(cmsSiteInheritances, ({ one }) => ({
  site: one(cmsSites, { fields: [cmsSiteInheritances.siteId], references: [cmsSites.id] }),
}));

export const cmsPublishArtifactsRelations = relations(cmsPublishArtifacts, ({ one }) => ({
  task: one(asyncTasks, { fields: [cmsPublishArtifacts.taskId], references: [asyncTasks.id] }),
  site: one(cmsSites, { fields: [cmsPublishArtifacts.siteId], references: [cmsSites.id] }),
  content: one(cmsContents, { fields: [cmsPublishArtifacts.contentId], references: [cmsContents.id] }),
  channel: one(cmsChannels, { fields: [cmsPublishArtifacts.channelId], references: [cmsChannels.id] }),
  page: one(cmsPages, { fields: [cmsPublishArtifacts.pageId], references: [cmsPages.id] }),
}));

export const cmsModelsRelations = relations(cmsModels, ({ many }) => ({
  fields: many(cmsModelFields),
  channels: many(cmsChannels),
  contents: many(cmsContents),
}));

export const cmsModelFieldsRelations = relations(cmsModelFields, ({ one }) => ({
  model: one(cmsModels, { fields: [cmsModelFields.modelId], references: [cmsModels.id] }),
}));

export const cmsChannelsRelations = relations(cmsChannels, ({ one, many }) => ({
  site: one(cmsSites, { fields: [cmsChannels.siteId], references: [cmsSites.id] }),
  model: one(cmsModels, { fields: [cmsChannels.modelId], references: [cmsModels.id] }),
  contents: many(cmsContents),
  sourceDistributionRules: many(cmsDistributionRules, { relationName: 'cmsDistributionSourceChannel' }),
  targetDistributionRules: many(cmsDistributionRules, { relationName: 'cmsDistributionTargetChannel' }),
}));

export const cmsDistributionRulesRelations = relations(cmsDistributionRules, ({ one, many }) => ({
  sourceSite: one(cmsSites, {
    fields: [cmsDistributionRules.sourceSiteId],
    references: [cmsSites.id],
    relationName: 'cmsDistributionSourceSite',
  }),
  sourceChannel: one(cmsChannels, {
    fields: [cmsDistributionRules.sourceChannelId],
    references: [cmsChannels.id],
    relationName: 'cmsDistributionSourceChannel',
  }),
  targetSite: one(cmsSites, {
    fields: [cmsDistributionRules.targetSiteId],
    references: [cmsSites.id],
    relationName: 'cmsDistributionTargetSite',
  }),
  targetChannel: one(cmsChannels, {
    fields: [cmsDistributionRules.targetChannelId],
    references: [cmsChannels.id],
    relationName: 'cmsDistributionTargetChannel',
  }),
  materializedContents: many(cmsContents),
}));

export const cmsContentsRelations = relations(cmsContents, ({ one, many }) => ({
  site: one(cmsSites, { fields: [cmsContents.siteId], references: [cmsSites.id] }),
  channel: one(cmsChannels, { fields: [cmsContents.channelId], references: [cmsChannels.id] }),
  model: one(cmsModels, { fields: [cmsContents.modelId], references: [cmsModels.id] }),
  contentTags: many(cmsContentTags),
  extraChannels: many(cmsContentChannels),
  relatedContents: many(cmsContentRelations, { relationName: 'cmsContentRelationsSource' }),
  createdByUser: one(users, { fields: [cmsContents.createdBy], references: [users.id], relationName: 'cmsContentCreatedBy' }),
  lockedByUser: one(users, { fields: [cmsContents.lockedBy], references: [users.id], relationName: 'cmsContentLockedBy' }),
  mappingSource: one(cmsContents, { fields: [cmsContents.mappingSourceId], references: [cmsContents.id], relationName: 'cmsContentMapping' }),
  mappedCopies: many(cmsContents, { relationName: 'cmsContentMapping' }),
  distributionRule: one(cmsDistributionRules, { fields: [cmsContents.distributionRuleId], references: [cmsDistributionRules.id] }),
  distributionSource: one(cmsContents, {
    fields: [cmsContents.distributionSourceId],
    references: [cmsContents.id],
    relationName: 'cmsContentDistribution',
  }),
  distributedCopies: many(cmsContents, { relationName: 'cmsContentDistribution' }),
  opLogs: many(cmsContentOpLogs),
}));

export const cmsContentOpLogsRelations = relations(cmsContentOpLogs, ({ one }) => ({
  content: one(cmsContents, { fields: [cmsContentOpLogs.contentId], references: [cmsContents.id] }),
  operator: one(users, { fields: [cmsContentOpLogs.operatorId], references: [users.id] }),
}));

// ─── P3/Stage4 会员互动、订阅与统一互动问卷 ──────────────────────────────────
export const cmsContentLikesRelations = relations(cmsContentLikes, ({ one }) => ({
  member: one(members, { fields: [cmsContentLikes.memberId], references: [members.id] }),
  content: one(cmsContents, { fields: [cmsContentLikes.contentId], references: [cmsContents.id] }),
}));

export const cmsContentFavoritesRelations = relations(cmsContentFavorites, ({ one }) => ({
  member: one(members, { fields: [cmsContentFavorites.memberId], references: [members.id] }),
  content: one(cmsContents, { fields: [cmsContentFavorites.contentId], references: [cmsContents.id] }),
}));

export const cmsMemberViewHistoryRelations = relations(cmsMemberViewHistory, ({ one }) => ({
  member: one(members, { fields: [cmsMemberViewHistory.memberId], references: [members.id] }),
  content: one(cmsContents, { fields: [cmsMemberViewHistory.contentId], references: [cmsContents.id] }),
  site: one(cmsSites, { fields: [cmsMemberViewHistory.siteId], references: [cmsSites.id] }),
}));

export const cmsMemberSubscriptionsRelations = relations(cmsMemberSubscriptions, ({ one }) => ({
  member: one(members, { fields: [cmsMemberSubscriptions.memberId], references: [members.id] }),
  site: one(cmsSites, { fields: [cmsMemberSubscriptions.siteId], references: [cmsSites.id] }),
}));

export const cmsInteractionsRelations = relations(cmsInteractions, ({ one, many }) => ({
  site: one(cmsSites, { fields: [cmsInteractions.siteId], references: [cmsSites.id] }),
  questions: many(cmsInteractionQuestions),
  responses: many(cmsInteractionResponses),
}));

export const cmsInteractionQuestionsRelations = relations(cmsInteractionQuestions, ({ one, many }) => ({
  interaction: one(cmsInteractions, { fields: [cmsInteractionQuestions.interactionId], references: [cmsInteractions.id] }),
  answers: many(cmsInteractionAnswers),
}));

export const cmsInteractionResponsesRelations = relations(cmsInteractionResponses, ({ one, many }) => ({
  interaction: one(cmsInteractions, { fields: [cmsInteractionResponses.interactionId], references: [cmsInteractions.id] }),
  member: one(members, { fields: [cmsInteractionResponses.memberId], references: [members.id] }),
  answers: many(cmsInteractionAnswers),
}));

export const cmsInteractionAnswersRelations = relations(cmsInteractionAnswers, ({ one }) => ({
  response: one(cmsInteractionResponses, { fields: [cmsInteractionAnswers.responseId], references: [cmsInteractionResponses.id] }),
  question: one(cmsInteractionQuestions, { fields: [cmsInteractionAnswers.questionId], references: [cmsInteractionQuestions.id] }),
}));

export const cmsContentChannelsRelations = relations(cmsContentChannels, ({ one }) => ({
  content: one(cmsContents, { fields: [cmsContentChannels.contentId], references: [cmsContents.id] }),
  channel: one(cmsChannels, { fields: [cmsContentChannels.channelId], references: [cmsChannels.id] }),
}));

export const cmsContentRelationsRelations = relations(cmsContentRelations, ({ one }) => ({
  content: one(cmsContents, { fields: [cmsContentRelations.contentId], references: [cmsContents.id], relationName: 'cmsContentRelationsSource' }),
  related: one(cmsContents, { fields: [cmsContentRelations.relatedId], references: [cmsContents.id], relationName: 'cmsContentRelationsTarget' }),
}));

export const cmsContentTagsRelations = relations(cmsContentTags, ({ one }) => ({
  content: one(cmsContents, { fields: [cmsContentTags.contentId], references: [cmsContents.id] }),
  tag: one(cmsTags, { fields: [cmsContentTags.tagId], references: [cmsTags.id] }),
}));

export const cmsTagsRelations = relations(cmsTags, ({ one, many }) => ({
  site: one(cmsSites, { fields: [cmsTags.siteId], references: [cmsSites.id] }),
  contentTags: many(cmsContentTags),
}));

export const cmsFriendLinksRelations = relations(cmsFriendLinks, ({ one }) => ({
  site: one(cmsSites, { fields: [cmsFriendLinks.siteId], references: [cmsSites.id] }),
}));

// ─── CMS P2 ──────────────────────────────────────────────────────────────────
export const cmsContentVersionsRelations = relations(cmsContentVersions, ({ one }) => ({
  content: one(cmsContents, { fields: [cmsContentVersions.contentId], references: [cmsContents.id] }),
  createdByUser: one(users, { fields: [cmsContentVersions.createdBy], references: [users.id], relationName: 'cmsContentVersionCreatedBy' }),
}));

export const cmsRedirectsRelations = relations(cmsRedirects, ({ one }) => ({
  site: one(cmsSites, { fields: [cmsRedirects.siteId], references: [cmsSites.id] }),
}));

export const cmsLinkWordsRelations = relations(cmsLinkWords, ({ one }) => ({
  site: one(cmsSites, { fields: [cmsLinkWords.siteId], references: [cmsSites.id] }),
}));

export const cmsCommentsRelations = relations(cmsComments, ({ one }) => ({
  site: one(cmsSites, { fields: [cmsComments.siteId], references: [cmsSites.id] }),
  // 关系名不能叫 content：会与评论正文列 content 同名，RQB with 时覆盖正文字段
  targetContent: one(cmsContents, { fields: [cmsComments.contentId], references: [cmsContents.id] }),
}));

export const cmsAdSlotsRelations = relations(cmsAdSlots, ({ one, many }) => ({
  site: one(cmsSites, { fields: [cmsAdSlots.siteId], references: [cmsSites.id] }),
  ads: many(cmsAds),
}));

export const cmsAdsRelations = relations(cmsAds, ({ one }) => ({
  slot: one(cmsAdSlots, { fields: [cmsAds.slotId], references: [cmsAdSlots.id] }),
}));

export const cmsAdEventsRelations = relations(cmsAdEvents, ({ one }) => ({
  site: one(cmsSites, { fields: [cmsAdEvents.siteId], references: [cmsSites.id] }),
  ad: one(cmsAds, { fields: [cmsAdEvents.adId], references: [cmsAds.id] }),
  slot: one(cmsAdSlots, { fields: [cmsAdEvents.slotId], references: [cmsAdSlots.id] }),
  member: one(members, { fields: [cmsAdEvents.memberId], references: [members.id] }),
}));

export const cmsPagesRelations = relations(cmsPages, ({ one, many }) => ({
  site: one(cmsSites, { fields: [cmsPages.siteId], references: [cmsSites.id] }),
  blockAcls: many(cmsPageBlockAcls),
}));

export const cmsWidgetsRelations = relations(cmsWidgets, ({ one, many }) => ({
  site: one(cmsSites, { fields: [cmsWidgets.siteId], references: [cmsSites.id] }),
  refs: many(cmsWidgetRefs),
  sourceRefs: many(cmsWidgetSourceRefs),
}));

export const cmsWidgetRefsRelations = relations(cmsWidgetRefs, ({ one }) => ({
  site: one(cmsSites, { fields: [cmsWidgetRefs.siteId], references: [cmsSites.id] }),
  widget: one(cmsWidgets, { fields: [cmsWidgetRefs.widgetId], references: [cmsWidgets.id] }),
}));

export const cmsWidgetSourceRefsRelations = relations(cmsWidgetSourceRefs, ({ one }) => ({
  site: one(cmsSites, { fields: [cmsWidgetSourceRefs.siteId], references: [cmsSites.id] }),
  widget: one(cmsWidgets, { fields: [cmsWidgetSourceRefs.widgetId], references: [cmsWidgets.id] }),
}));

export const cmsPageBlockAclsRelations = relations(cmsPageBlockAcls, ({ one }) => ({
  page: one(cmsPages, { fields: [cmsPageBlockAcls.pageId], references: [cmsPages.id] }),
}));

export const cmsFormsRelations = relations(cmsForms, ({ one, many }) => ({
  site: one(cmsSites, { fields: [cmsForms.siteId], references: [cmsSites.id] }),
  submissions: many(cmsFormSubmissions),
}));

export const cmsFormSubmissionsRelations = relations(cmsFormSubmissions, ({ one }) => ({
  form: one(cmsForms, { fields: [cmsFormSubmissions.formId], references: [cmsForms.id] }),
}));

export const cmsPushLogsRelations = relations(cmsPushLogs, ({ one }) => ({
  site: one(cmsSites, { fields: [cmsPushLogs.siteId], references: [cmsSites.id] }),
}));

export const cmsSiteUsersRelations = relations(cmsSiteUsers, ({ one }) => ({
  site: one(cmsSites, { fields: [cmsSiteUsers.siteId], references: [cmsSites.id] }),
  user: one(users, { fields: [cmsSiteUsers.userId], references: [users.id], relationName: 'cmsSiteUserUser' }),
}));

export const cmsChannelUsersRelations = relations(cmsChannelUsers, ({ one }) => ({
  channel: one(cmsChannels, { fields: [cmsChannelUsers.channelId], references: [cmsChannels.id] }),
  user: one(users, { fields: [cmsChannelUsers.userId], references: [users.id], relationName: 'cmsChannelUserUser' }),
}));

export const cmsResourceFoldersRelations = relations(cmsResourceFolders, ({ one, many }) => ({
  site: one(cmsSites, { fields: [cmsResourceFolders.siteId], references: [cmsSites.id] }),
  parent: one(cmsResourceFolders, { fields: [cmsResourceFolders.parentId], references: [cmsResourceFolders.id], relationName: 'cmsResourceFolderTree' }),
  children: many(cmsResourceFolders, { relationName: 'cmsResourceFolderTree' }),
  resources: many(cmsResources),
}));

export const cmsResourcesRelations = relations(cmsResources, ({ one, many }) => ({
  site: one(cmsSites, { fields: [cmsResources.siteId], references: [cmsSites.id] }),
  folder: one(cmsResourceFolders, { fields: [cmsResources.folderId], references: [cmsResourceFolders.id] }),
  refs: many(cmsResourceRefs),
}));

export const cmsResourceRefsRelations = relations(cmsResourceRefs, ({ one }) => ({
  site: one(cmsSites, { fields: [cmsResourceRefs.siteId], references: [cmsSites.id] }),
  resource: one(cmsResources, { fields: [cmsResourceRefs.resourceId], references: [cmsResources.id] }),
}));

export const cmsOpenAppGrantsRelations = relations(cmsOpenAppGrants, ({ one }) => ({
  site: one(cmsSites, { fields: [cmsOpenAppGrants.siteId], references: [cmsSites.id] }),
}));

export const cmsContentTombstonesRelations = relations(cmsContentTombstones, ({ one }) => ({
  site: one(cmsSites, { fields: [cmsContentTombstones.siteId], references: [cmsSites.id] }),
}));

export const cmsSearchWordsRelations = relations(cmsSearchWords, ({ one }) => ({
  site: one(cmsSites, { fields: [cmsSearchWords.siteId], references: [cmsSites.id] }),
}));

export const cmsHotwordGroupsRelations = relations(cmsHotwordGroups, ({ one, many }) => ({
  site: one(cmsSites, { fields: [cmsHotwordGroups.siteId], references: [cmsSites.id] }),
  hotwords: many(cmsHotwords),
}));

export const cmsHotwordsRelations = relations(cmsHotwords, ({ one }) => ({
  site: one(cmsSites, { fields: [cmsHotwords.siteId], references: [cmsSites.id] }),
  group: one(cmsHotwordGroups, { fields: [cmsHotwords.groupId], references: [cmsHotwordGroups.id] }),
}));

// ─── 知识中心（Wiki）──────────────────────────────────────────────────────────
export const wikiSpacesRelations = relations(wikiSpaces, ({ one, many }) => ({
  tenant: one(tenants, { fields: [wikiSpaces.tenantId], references: [tenants.id] }),
  members: many(wikiSpaceMembers),
  docs: many(wikiDocs),
}));

export const wikiSpaceMembersRelations = relations(wikiSpaceMembers, ({ one }) => ({
  space: one(wikiSpaces, { fields: [wikiSpaceMembers.spaceId], references: [wikiSpaces.id] }),
  user: one(users, { fields: [wikiSpaceMembers.userId], references: [users.id] }),
}));

export const wikiDocsRelations = relations(wikiDocs, ({ one, many }) => ({
  space: one(wikiSpaces, { fields: [wikiDocs.spaceId], references: [wikiSpaces.id] }),
  parent: one(wikiDocs, { fields: [wikiDocs.parentId], references: [wikiDocs.id], relationName: 'wikiDocHierarchy' }),
  children: many(wikiDocs, { relationName: 'wikiDocHierarchy' }),
  versions: many(wikiDocVersions),
  docTags: many(wikiDocTags),
  comments: many(wikiComments),
  favorites: many(wikiDocFavorites),
  views: many(wikiDocViews),
  createdByUser: one(users, { fields: [wikiDocs.createdBy], references: [users.id], relationName: 'wikiDocCreatedBy' }),
  updatedByUser: one(users, { fields: [wikiDocs.updatedBy], references: [users.id], relationName: 'wikiDocUpdatedBy' }),
}));

export const wikiDocVersionsRelations = relations(wikiDocVersions, ({ one }) => ({
  doc: one(wikiDocs, { fields: [wikiDocVersions.docId], references: [wikiDocs.id] }),
  author: one(users, { fields: [wikiDocVersions.authorId], references: [users.id] }),
}));

export const wikiTagsRelations = relations(wikiTags, ({ many }) => ({
  docTags: many(wikiDocTags),
}));

export const wikiDocTagsRelations = relations(wikiDocTags, ({ one }) => ({
  doc: one(wikiDocs, { fields: [wikiDocTags.docId], references: [wikiDocs.id] }),
  tag: one(wikiTags, { fields: [wikiDocTags.tagId], references: [wikiTags.id] }),
}));

export const wikiCommentsRelations = relations(wikiComments, ({ one, many }) => ({
  doc: one(wikiDocs, { fields: [wikiComments.docId], references: [wikiDocs.id] }),
  parent: one(wikiComments, { fields: [wikiComments.parentId], references: [wikiComments.id], relationName: 'wikiCommentReplies' }),
  replies: many(wikiComments, { relationName: 'wikiCommentReplies' }),
  author: one(users, { fields: [wikiComments.authorId], references: [users.id] }),
}));

export const wikiDocFavoritesRelations = relations(wikiDocFavorites, ({ one }) => ({
  doc: one(wikiDocs, { fields: [wikiDocFavorites.docId], references: [wikiDocs.id] }),
  user: one(users, { fields: [wikiDocFavorites.userId], references: [users.id] }),
}));

export const wikiDocViewsRelations = relations(wikiDocViews, ({ one }) => ({
  doc: one(wikiDocs, { fields: [wikiDocViews.docId], references: [wikiDocs.id] }),
  user: one(users, { fields: [wikiDocViews.userId], references: [users.id] }),
}));

export const wikiDocSubscriptionsRelations = relations(wikiDocSubscriptions, ({ one }) => ({
  doc: one(wikiDocs, { fields: [wikiDocSubscriptions.docId], references: [wikiDocs.id] }),
  user: one(users, { fields: [wikiDocSubscriptions.userId], references: [users.id] }),
}));

export const wikiReviewRecordsRelations = relations(wikiReviewRecords, ({ one }) => ({
  doc: one(wikiDocs, { fields: [wikiReviewRecords.docId], references: [wikiDocs.id] }),
  actor: one(users, { fields: [wikiReviewRecords.actorId], references: [users.id] }),
}));

export const wikiDocReadReceiptsRelations = relations(wikiDocReadReceipts, ({ one }) => ({
  doc: one(wikiDocs, { fields: [wikiDocReadReceipts.docId], references: [wikiDocs.id] }),
  user: one(users, { fields: [wikiDocReadReceipts.userId], references: [users.id] }),
}));

// ─── 通讯录同步 ───────────────────────────────────────────────────────────────
export const directorySyncSourcesRelations = relations(directorySyncSources, ({ one, many }) => ({
  tenant: one(tenants, { fields: [directorySyncSources.tenantId], references: [tenants.id] }),
  identityProvider: one(tenantIdentityProviders, { fields: [directorySyncSources.identityProviderId], references: [tenantIdentityProviders.id] }),
  runs: many(directorySyncRuns),
  conflicts: many(directorySyncConflicts),
}));

export const directorySyncRunsRelations = relations(directorySyncRuns, ({ one, many }) => ({
  source: one(directorySyncSources, { fields: [directorySyncRuns.sourceId], references: [directorySyncSources.id] }),
  triggeredByUser: one(users, { fields: [directorySyncRuns.triggeredBy], references: [users.id] }),
  items: many(directorySyncRunItems),
}));

export const directorySyncRunItemsRelations = relations(directorySyncRunItems, ({ one }) => ({
  run: one(directorySyncRuns, { fields: [directorySyncRunItems.runId], references: [directorySyncRuns.id] }),
}));

export const directorySyncConflictsRelations = relations(directorySyncConflicts, ({ one }) => ({
  source: one(directorySyncSources, { fields: [directorySyncConflicts.sourceId], references: [directorySyncSources.id] }),
  run: one(directorySyncRuns, { fields: [directorySyncConflicts.runId], references: [directorySyncRuns.id] }),
  resolvedByUser: one(users, { fields: [directorySyncConflicts.resolvedBy], references: [users.id] }),
}));

export const directorySyncUserLinksRelations = relations(directorySyncUserLinks, ({ one }) => ({
  source: one(directorySyncSources, { fields: [directorySyncUserLinks.sourceId], references: [directorySyncSources.id] }),
  user: one(users, { fields: [directorySyncUserLinks.userId], references: [users.id] }),
}));

export const directorySyncDeptLinksRelations = relations(directorySyncDeptLinks, ({ one }) => ({
  source: one(directorySyncSources, { fields: [directorySyncDeptLinks.sourceId], references: [directorySyncSources.id] }),
  department: one(departments, { fields: [directorySyncDeptLinks.departmentId], references: [departments.id] }),
}));

// ─── 应用版本管理 ─────────────────────────────────────────────────────────────
export const clientAppsRelations = relations(clientApps, ({ many }) => ({
  releases: many(appReleases),
  devices: many(clientDevices),
}));

export const clientDevicesRelations = relations(clientDevices, ({ one }) => ({
  app: one(clientApps, { fields: [clientDevices.appId], references: [clientApps.id] }),
}));

export const pushConfigsRelations = relations(pushConfigs, ({ one }) => ({
  app: one(clientApps, { fields: [pushConfigs.appId], references: [clientApps.id] }),
}));

export const pushSendLogsRelations = relations(pushSendLogs, ({ one }) => ({
  config: one(pushConfigs, { fields: [pushSendLogs.configId], references: [pushConfigs.id] }),
  app: one(clientApps, { fields: [pushSendLogs.appId], references: [clientApps.id] }),
}));

export const broadcastCampaignsRelations = relations(broadcastCampaigns, ({ one }) => ({
  creator: one(users, { fields: [broadcastCampaigns.createdBy], references: [users.id] }),
}));

export const appReleasesRelations = relations(appReleases, ({ one, many }) => ({
  app: one(clientApps, { fields: [appReleases.appId], references: [clientApps.id] }),
  artifacts: many(appArtifacts),
}));

export const appArtifactsRelations = relations(appArtifacts, ({ one }) => ({
  release: one(appReleases, { fields: [appArtifacts.releaseId], references: [appReleases.id] }),
  file: one(managedFiles, { fields: [appArtifacts.fileId], references: [managedFiles.id] }),
}));

// ─── IoT 设备管理 ────────────────────────────────────────────────────────────
export const iotProductsRelations = relations(iotProducts, ({ many, one }) => ({
  tenant: one(tenants, { fields: [iotProducts.tenantId], references: [tenants.id] }),
  properties: many(iotProductProperties),
  services: many(iotProductServices),
  events: many(iotProductEvents),
  devices: many(iotDevices),
  alarmRules: many(iotAlarmRules),
}));

export const iotProductPropertiesRelations = relations(iotProductProperties, ({ one }) => ({
  product: one(iotProducts, { fields: [iotProductProperties.productId], references: [iotProducts.id] }),
}));

export const iotProductServicesRelations = relations(iotProductServices, ({ one }) => ({
  product: one(iotProducts, { fields: [iotProductServices.productId], references: [iotProducts.id] }),
}));

export const iotProductEventsRelations = relations(iotProductEvents, ({ one }) => ({
  product: one(iotProducts, { fields: [iotProductEvents.productId], references: [iotProducts.id] }),
}));

export const iotDevicesRelations = relations(iotDevices, ({ one, many }) => ({
  product: one(iotProducts, { fields: [iotDevices.productId], references: [iotProducts.id] }),
  tenant: one(tenants, { fields: [iotDevices.tenantId], references: [tenants.id] }),
  state: one(iotDeviceState, { fields: [iotDevices.id], references: [iotDeviceState.deviceId] }),
  events: many(iotDeviceEvents),
  telemetry: many(iotTelemetry),
  commands: many(iotCommands),
  alarms: many(iotAlarms),
  groupMembers: many(iotDeviceGroupMembers),
}));

export const iotDeviceStateRelations = relations(iotDeviceState, ({ one }) => ({
  device: one(iotDevices, { fields: [iotDeviceState.deviceId], references: [iotDevices.id] }),
}));

export const iotDeviceEventsRelations = relations(iotDeviceEvents, ({ one }) => ({
  device: one(iotDevices, { fields: [iotDeviceEvents.deviceId], references: [iotDevices.id] }),
}));

export const iotTelemetryRelations = relations(iotTelemetry, ({ one }) => ({
  device: one(iotDevices, { fields: [iotTelemetry.deviceId], references: [iotDevices.id] }),
}));

export const iotCommandsRelations = relations(iotCommands, ({ one }) => ({
  device: one(iotDevices, { fields: [iotCommands.deviceId], references: [iotDevices.id] }),
}));

export const iotAlarmRulesRelations = relations(iotAlarmRules, ({ one, many }) => ({
  product: one(iotProducts, { fields: [iotAlarmRules.productId], references: [iotProducts.id] }),
  device: one(iotDevices, { fields: [iotAlarmRules.deviceId], references: [iotDevices.id] }),
  tenant: one(tenants, { fields: [iotAlarmRules.tenantId], references: [tenants.id] }),
  alarms: many(iotAlarms),
}));

export const iotAlarmsRelations = relations(iotAlarms, ({ one }) => ({
  rule: one(iotAlarmRules, { fields: [iotAlarms.ruleId], references: [iotAlarmRules.id] }),
  device: one(iotDevices, { fields: [iotAlarms.deviceId], references: [iotDevices.id] }),
}));

export const iotDeviceGroupsRelations = relations(iotDeviceGroups, ({ one, many }) => ({
  tenant: one(tenants, { fields: [iotDeviceGroups.tenantId], references: [tenants.id] }),
  members: many(iotDeviceGroupMembers),
}));

export const iotDeviceGroupMembersRelations = relations(iotDeviceGroupMembers, ({ one }) => ({
  group: one(iotDeviceGroups, { fields: [iotDeviceGroupMembers.groupId], references: [iotDeviceGroups.id] }),
  device: one(iotDevices, { fields: [iotDeviceGroupMembers.deviceId], references: [iotDevices.id] }),
}));

export const iotTelemetryHourlyRelations = relations(iotTelemetryHourly, ({ one }) => ({
  device: one(iotDevices, { fields: [iotTelemetryHourly.deviceId], references: [iotDevices.id] }),
}));

export const iotFirmwaresRelations = relations(iotFirmwares, ({ one, many }) => ({
  product: one(iotProducts, { fields: [iotFirmwares.productId], references: [iotProducts.id] }),
  file: one(managedFiles, { fields: [iotFirmwares.fileId], references: [managedFiles.id] }),
  tenant: one(tenants, { fields: [iotFirmwares.tenantId], references: [tenants.id] }),
  otaTasks: many(iotOtaTasks),
}));

export const iotOtaTasksRelations = relations(iotOtaTasks, ({ one, many }) => ({
  firmware: one(iotFirmwares, { fields: [iotOtaTasks.firmwareId], references: [iotFirmwares.id] }),
  product: one(iotProducts, { fields: [iotOtaTasks.productId], references: [iotProducts.id] }),
  tenant: one(tenants, { fields: [iotOtaTasks.tenantId], references: [tenants.id] }),
  devices: many(iotOtaTaskDevices),
}));

export const iotOtaTaskDevicesRelations = relations(iotOtaTaskDevices, ({ one }) => ({
  task: one(iotOtaTasks, { fields: [iotOtaTaskDevices.taskId], references: [iotOtaTasks.id] }),
  device: one(iotDevices, { fields: [iotOtaTaskDevices.deviceId], references: [iotDevices.id] }),
}));

export const iotAutomationsRelations = relations(iotAutomations, ({ one, many }) => ({
  product: one(iotProducts, { fields: [iotAutomations.productId], references: [iotProducts.id] }),
  device: one(iotDevices, { fields: [iotAutomations.deviceId], references: [iotDevices.id] }),
  tenant: one(tenants, { fields: [iotAutomations.tenantId], references: [tenants.id] }),
  runs: many(iotAutomationRuns),
}));

export const iotAutomationRunsRelations = relations(iotAutomationRuns, ({ one }) => ({
  automation: one(iotAutomations, { fields: [iotAutomationRuns.automationId], references: [iotAutomations.id] }),
  device: one(iotDevices, { fields: [iotAutomationRuns.deviceId], references: [iotDevices.id] }),
}));

export const iotForwardRulesRelations = relations(iotForwardRules, ({ one, many }) => ({
  product: one(iotProducts, { fields: [iotForwardRules.productId], references: [iotProducts.id] }),
  group: one(iotDeviceGroups, { fields: [iotForwardRules.groupId], references: [iotDeviceGroups.id] }),
  tenant: one(tenants, { fields: [iotForwardRules.tenantId], references: [tenants.id] }),
  logs: many(iotForwardLogs),
}));

export const iotForwardLogsRelations = relations(iotForwardLogs, ({ one }) => ({
  rule: one(iotForwardRules, { fields: [iotForwardLogs.ruleId], references: [iotForwardRules.id] }),
}));

export const iotDeviceLogsRelations = relations(iotDeviceLogs, ({ one }) => ({
  device: one(iotDevices, { fields: [iotDeviceLogs.deviceId], references: [iotDevices.id] }),
}));

export const iotMaintenanceWindowsRelations = relations(iotMaintenanceWindows, ({ one }) => ({
  product: one(iotProducts, { fields: [iotMaintenanceWindows.productId], references: [iotProducts.id] }),
  group: one(iotDeviceGroups, { fields: [iotMaintenanceWindows.groupId], references: [iotDeviceGroups.id] }),
  device: one(iotDevices, { fields: [iotMaintenanceWindows.deviceId], references: [iotDevices.id] }),
  tenant: one(tenants, { fields: [iotMaintenanceWindows.tenantId], references: [tenants.id] }),
}));

export const iotSchedulesRelations = relations(iotSchedules, ({ one, many }) => ({
  product: one(iotProducts, { fields: [iotSchedules.productId], references: [iotProducts.id] }),
  group: one(iotDeviceGroups, { fields: [iotSchedules.groupId], references: [iotDeviceGroups.id] }),
  device: one(iotDevices, { fields: [iotSchedules.deviceId], references: [iotDevices.id] }),
  tenant: one(tenants, { fields: [iotSchedules.tenantId], references: [tenants.id] }),
  runs: many(iotScheduleRuns),
}));

export const iotScheduleRunsRelations = relations(iotScheduleRuns, ({ one }) => ({
  schedule: one(iotSchedules, { fields: [iotScheduleRuns.scheduleId], references: [iotSchedules.id] }),
}));

export const iotDeviceWhitelistRelations = relations(iotDeviceWhitelist, ({ one }) => ({
  product: one(iotProducts, { fields: [iotDeviceWhitelist.productId], references: [iotProducts.id] }),
  device: one(iotDevices, { fields: [iotDeviceWhitelist.deviceId], references: [iotDevices.id] }),
  tenant: one(tenants, { fields: [iotDeviceWhitelist.tenantId], references: [tenants.id] }),
}));

// ─── 企业网盘 ─────────────────────────────────────────────────────────────────
export const driveSpacesRelations = relations(driveSpaces, ({ one, many }) => ({
  owner: one(users, { fields: [driveSpaces.ownerId], references: [users.id] }),
  department: one(departments, { fields: [driveSpaces.departmentId], references: [departments.id] }),
  tenant: one(tenants, { fields: [driveSpaces.tenantId], references: [tenants.id] }),
  members: many(driveSpaceMembers),
  nodes: many(driveNodes),
  tags: many(driveTags),
}));

export const driveSpaceMembersRelations = relations(driveSpaceMembers, ({ one }) => ({
  space: one(driveSpaces, { fields: [driveSpaceMembers.spaceId], references: [driveSpaces.id] }),
}));

export const driveNodesRelations = relations(driveNodes, ({ one, many }) => ({
  space: one(driveSpaces, { fields: [driveNodes.spaceId], references: [driveSpaces.id] }),
  parent: one(driveNodes, { fields: [driveNodes.parentId], references: [driveNodes.id], relationName: 'driveNodeParent' }),
  children: many(driveNodes, { relationName: 'driveNodeParent' }),
  file: one(managedFiles, { fields: [driveNodes.fileId], references: [managedFiles.id], relationName: 'driveNodeFile' }),
  thumbnail: one(managedFiles, { fields: [driveNodes.thumbnailFileId], references: [managedFiles.id], relationName: 'driveNodeThumbnail' }),
  lockedByUser: one(users, { fields: [driveNodes.lockedBy], references: [users.id], relationName: 'driveNodeLockedBy' }),
  deletedByUser: one(users, { fields: [driveNodes.deletedBy], references: [users.id], relationName: 'driveNodeDeletedBy' }),
  createdByUser: one(users, { fields: [driveNodes.createdBy], references: [users.id], relationName: 'driveNodeCreatedBy' }),
  updatedByUser: one(users, { fields: [driveNodes.updatedBy], references: [users.id], relationName: 'driveNodeUpdatedBy' }),
  permissions: many(driveNodePermissions),
  versions: many(driveFileVersions),
  shareLinks: many(driveShareLinks),
  nodeTags: many(driveNodeTags),
  comments: many(driveNodeComments),
  text: one(driveNodeTexts, { fields: [driveNodes.id], references: [driveNodeTexts.nodeId] }),
}));

export const driveNodePermissionsRelations = relations(driveNodePermissions, ({ one }) => ({
  node: one(driveNodes, { fields: [driveNodePermissions.nodeId], references: [driveNodes.id] }),
}));

export const driveFileVersionsRelations = relations(driveFileVersions, ({ one }) => ({
  node: one(driveNodes, { fields: [driveFileVersions.nodeId], references: [driveNodes.id] }),
  file: one(managedFiles, { fields: [driveFileVersions.fileId], references: [managedFiles.id] }),
  author: one(users, { fields: [driveFileVersions.authorId], references: [users.id] }),
}));

export const driveShareLinksRelations = relations(driveShareLinks, ({ one, many }) => ({
  node: one(driveNodes, { fields: [driveShareLinks.nodeId], references: [driveNodes.id] }),
  createdByUser: one(users, { fields: [driveShareLinks.createdBy], references: [users.id] }),
  accessLogs: many(driveShareAccessLogs),
}));

export const driveShareAccessLogsRelations = relations(driveShareAccessLogs, ({ one }) => ({
  share: one(driveShareLinks, { fields: [driveShareAccessLogs.shareId], references: [driveShareLinks.id] }),
}));

export const driveActivitiesRelations = relations(driveActivities, ({ one }) => ({
  node: one(driveNodes, { fields: [driveActivities.nodeId], references: [driveNodes.id] }),
  actor: one(users, { fields: [driveActivities.actorId], references: [users.id] }),
}));

export const driveNodeStarsRelations = relations(driveNodeStars, ({ one }) => ({
  node: one(driveNodes, { fields: [driveNodeStars.nodeId], references: [driveNodes.id] }),
  user: one(users, { fields: [driveNodeStars.userId], references: [users.id] }),
}));

export const driveRecentAccessRelations = relations(driveRecentAccess, ({ one }) => ({
  node: one(driveNodes, { fields: [driveRecentAccess.nodeId], references: [driveNodes.id] }),
  user: one(users, { fields: [driveRecentAccess.userId], references: [users.id] }),
}));

export const driveUploadBindingsRelations = relations(driveUploadBindings, ({ one }) => ({
  space: one(driveSpaces, { fields: [driveUploadBindings.spaceId], references: [driveSpaces.id] }),
  parent: one(driveNodes, { fields: [driveUploadBindings.parentId], references: [driveNodes.id] }),
}));

export const driveTagsRelations = relations(driveTags, ({ one, many }) => ({
  space: one(driveSpaces, { fields: [driveTags.spaceId], references: [driveSpaces.id] }),
  nodeTags: many(driveNodeTags),
}));

export const driveNodeTagsRelations = relations(driveNodeTags, ({ one }) => ({
  node: one(driveNodes, { fields: [driveNodeTags.nodeId], references: [driveNodes.id] }),
  tag: one(driveTags, { fields: [driveNodeTags.tagId], references: [driveTags.id] }),
}));

export const driveNodeCommentsRelations = relations(driveNodeComments, ({ one, many }) => ({
  node: one(driveNodes, { fields: [driveNodeComments.nodeId], references: [driveNodes.id] }),
  author: one(users, { fields: [driveNodeComments.authorId], references: [users.id] }),
  parent: one(driveNodeComments, { fields: [driveNodeComments.parentId], references: [driveNodeComments.id], relationName: 'driveCommentParent' }),
  replies: many(driveNodeComments, { relationName: 'driveCommentParent' }),
}));

export const driveNodeTextsRelations = relations(driveNodeTexts, ({ one }) => ({
  node: one(driveNodes, { fields: [driveNodeTexts.nodeId], references: [driveNodes.id] }),
}));
