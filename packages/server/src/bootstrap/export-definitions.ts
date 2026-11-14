import { registerExport } from '../lib/export-center/registry';
import { aiFeedbackExportDefinition } from '../services/ai/exports/ai-feedback';
import { paymentReportsExportDefinition } from '../services/payment/exports/payment-reports';
import type { AnyExportDefinition } from '../lib/export-center/types';
import { usersExportDefinition } from '../services/identity/exports/users';
import { reportDatasetExportDefinition } from '../services/report/exports/report-dataset';
import { reportPrintExportDefinition } from '../services/report/exports/report-print';
import { departmentsExportDefinition } from '../services/identity/exports/departments';
import { positionsExportDefinition } from '../services/identity/exports/positions';
import { rolesExportDefinition } from '../services/identity/exports/roles';
import { dictsExportDefinition } from '../services/platform/exports/dicts';
import { tenantsExportDefinition } from '../services/identity/exports/tenants';
import { regionsExportDefinition } from '../services/platform/exports/regions';
import { fileStorageConfigsExportDefinition } from '../services/files/exports/file-storage-configs';
import { cronJobsExportDefinition } from '../services/tasks/exports/cron-jobs';
import { processesExportDefinition } from '../services/ops/exports/processes';
import { announcementsExportDefinition } from '../services/messaging/exports/announcements';
import { loginLogsExportDefinition } from '../services/identity/exports/login-logs';
import { operationLogsExportDefinition } from '../services/platform/exports/operation-logs';
import { apiAccessLogsExportDefinition } from '../services/platform/exports/api-access-logs';
import { emailSendLogsExportDefinition } from '../services/messaging/exports/email-send-logs';
import { smsSendLogsExportDefinition } from '../services/messaging/exports/sms-send-logs';
import { membersExportDefinition } from '../services/member/exports/members';
import { channelSubscribersExportDefinition } from '../services/messaging/exports/channel-subscribers';
import { analyticsEventsExportDefinition } from '../services/analytics/exports/analytics-events';
import { paymentOrdersExportDefinition } from '../services/payment/exports/payment-orders';
import { paymentRefundsExportDefinition } from '../services/payment/exports/payment-refunds';
import { paymentContractsExportDefinition } from '../services/payment/exports/payment-contracts';
import { paymentDisputesExportDefinition } from '../services/payment/exports/payment-disputes';
import { workflowInstancesExportDefinition } from '../services/workflow/exports/workflow-instances';
import { workflowApprovalSheetsExportDefinition } from '../services/workflow/exports/workflow-approval-sheets';
import { memberPointTxExportDefinition } from '../services/member/exports/member-point-transactions';
import { memberWalletTxExportDefinition } from '../services/member/exports/member-wallet-transactions';
import { memberCouponRecordsExportDefinition } from '../services/member/exports/member-coupon-records';
import { memberCheckinsExportDefinition } from '../services/member/exports/member-checkins';
import { memberRechargesExportDefinition } from '../services/member/exports/member-recharges';
import { memberLoginLogsExportDefinition } from '../services/member/exports/member-login-logs';
import { chatMessagesExportDefinition } from '../services/chat/exports/chat-messages';
import { userFeedbacksExportDefinition } from '../services/platform/exports/user-feedbacks';
import { reportDqRunsExportDefinition } from '../services/report/exports/report-dq-runs';
import { reportQueryCostsExportDefinition } from '../services/report/exports/report-query-costs';
import { reportAssetsExportDefinition } from '../services/report/exports/report-assets';
import { reportFillRecordsExportDefinition } from '../services/report/exports/report-fill-records';
import { openApiCallLogsExportDefinition } from '../services/open-platform/exports/open-api-call-logs';
import { cmsContentsExportDefinition } from '../services/cms/exports/cms-contents';
import { cmsStatisticsExportDefinition } from '../services/cms/exports/cms-statistics';
import { cmsFormSubmissionsExportDefinition } from '../services/cms/exports/cms-form-submissions';
import { cmsResourceGovernanceExportDefinition } from '../services/cms/exports/cms-resource-governance';
import { cmsPublishArtifactsExportDefinition } from '../services/cms/exports/cms-publish-artifacts';
import { cmsPublishLogsExportDefinition } from '../services/cms/exports/cms-publish-logs';
import { cmsAdEventsExportDefinition } from '../services/cms/exports/cms-ad-events';
import { cmsSubscriptionsExportDefinition } from '../services/cms/exports/cms-subscriptions';
import { cmsInteractionResponsesExportDefinition } from '../services/cms/exports/cms-interaction-responses';
import { cmsDistributionRunsExportDefinition } from '../services/cms/exports/cms-distribution-runs';
import { monitorAlertEventsExportDefinition } from '../services/platform/exports/monitor-alert-events';
import { shortLinksExportDefinition } from '../services/short-link/exports/short-links';
import { iotDevicesExportDefinition } from '../services/iot/exports/iot-devices';
import { driveActivitiesExportDefinition } from '../services/drive/exports/drive-activities';
import { driveShareAccessLogsExportDefinition } from '../services/drive/exports/drive-share-access-logs';

let registered = false;

// 各业务域的导出定义（原生 defineExport，含真实 countRows / streamRows / 结构化 columns）
const definitions = [
  aiFeedbackExportDefinition,
  paymentReportsExportDefinition,
  usersExportDefinition,
  reportDatasetExportDefinition,
  reportPrintExportDefinition,
  departmentsExportDefinition,
  positionsExportDefinition,
  rolesExportDefinition,
  dictsExportDefinition,
  tenantsExportDefinition,
  regionsExportDefinition,
  fileStorageConfigsExportDefinition,
  cronJobsExportDefinition,
  processesExportDefinition,
  announcementsExportDefinition,
  loginLogsExportDefinition,
  operationLogsExportDefinition,
  apiAccessLogsExportDefinition,
  emailSendLogsExportDefinition,
  smsSendLogsExportDefinition,
  membersExportDefinition,
  channelSubscribersExportDefinition,
  analyticsEventsExportDefinition,
  paymentOrdersExportDefinition,
  paymentRefundsExportDefinition,
  paymentContractsExportDefinition,
  paymentDisputesExportDefinition,
  workflowInstancesExportDefinition,
  workflowApprovalSheetsExportDefinition,
  memberPointTxExportDefinition,
  memberWalletTxExportDefinition,
  memberCouponRecordsExportDefinition,
  memberCheckinsExportDefinition,
  memberRechargesExportDefinition,
  memberLoginLogsExportDefinition,
  chatMessagesExportDefinition,
  userFeedbacksExportDefinition,
  reportDqRunsExportDefinition,
  reportQueryCostsExportDefinition,
  reportAssetsExportDefinition,
  reportFillRecordsExportDefinition,
  openApiCallLogsExportDefinition,
  cmsContentsExportDefinition,
  cmsStatisticsExportDefinition,
  cmsFormSubmissionsExportDefinition,
  cmsResourceGovernanceExportDefinition,
  cmsPublishArtifactsExportDefinition,
  cmsPublishLogsExportDefinition,
  cmsAdEventsExportDefinition,
  cmsSubscriptionsExportDefinition,
  cmsInteractionResponsesExportDefinition,
  cmsDistributionRunsExportDefinition,
  monitorAlertEventsExportDefinition,
  shortLinksExportDefinition,
  iotDevicesExportDefinition,
  driveActivitiesExportDefinition,
  driveShareAccessLogsExportDefinition,
] as unknown as AnyExportDefinition[];

export function registerExportDefinitions(): void {
  if (registered) return;
  for (const definition of definitions) {
    registerExport(definition);
  }
  registered = true;
}
