import { registerExport } from '../registry';
import type { AnyExportDefinition } from '../types';
import { usersExportDefinition } from './users';
import { reportDatasetExportDefinition } from './report-dataset';
import { reportPrintExportDefinition } from './report-print';
import { departmentsExportDefinition } from './departments';
import { positionsExportDefinition } from './positions';
import { rolesExportDefinition } from './roles';
import { dictsExportDefinition } from './dicts';
import { tenantsExportDefinition } from './tenants';
import { regionsExportDefinition } from './regions';
import { systemConfigsExportDefinition } from './system-configs';
import { fileStorageConfigsExportDefinition } from './file-storage-configs';
import { cronJobsExportDefinition } from './cron-jobs';
import { processesExportDefinition } from './processes';
import { announcementsExportDefinition } from './announcements';
import { loginLogsExportDefinition } from './login-logs';
import { operationLogsExportDefinition } from './operation-logs';
import { emailSendLogsExportDefinition } from './email-send-logs';
import { smsSendLogsExportDefinition } from './sms-send-logs';
import { membersExportDefinition } from './members';
import { channelSubscribersExportDefinition } from './channel-subscribers';
import { analyticsEventsExportDefinition } from './analytics-events';
import { paymentOrdersExportDefinition } from './payment-orders';
import { paymentRefundsExportDefinition } from './payment-refunds';
import { paymentContractsExportDefinition } from './payment-contracts';
import { workflowInstancesExportDefinition } from './workflow-instances';
import { memberPointTxExportDefinition } from './member-point-transactions';
import { memberWalletTxExportDefinition } from './member-wallet-transactions';
import { memberCouponRecordsExportDefinition } from './member-coupon-records';
import { memberCheckinsExportDefinition } from './member-checkins';
import { memberRechargesExportDefinition } from './member-recharges';
import { memberLoginLogsExportDefinition } from './member-login-logs';
import { chatMessagesExportDefinition } from './chat-messages';
import { userFeedbacksExportDefinition } from './user-feedbacks';
import { reportDqRunsExportDefinition } from './report-dq-runs';
import { reportQueryCostsExportDefinition } from './report-query-costs';
import { reportAssetsExportDefinition } from './report-assets';
import { reportFillRecordsExportDefinition } from './report-fill-records';

let registered = false;

// 各业务域的导出定义（原生 defineExport，含真实 countRows / streamRows / 结构化 columns）
const definitions = [
  usersExportDefinition,
  reportDatasetExportDefinition,
  reportPrintExportDefinition,
  departmentsExportDefinition,
  positionsExportDefinition,
  rolesExportDefinition,
  dictsExportDefinition,
  tenantsExportDefinition,
  regionsExportDefinition,
  systemConfigsExportDefinition,
  fileStorageConfigsExportDefinition,
  cronJobsExportDefinition,
  processesExportDefinition,
  announcementsExportDefinition,
  loginLogsExportDefinition,
  operationLogsExportDefinition,
  emailSendLogsExportDefinition,
  smsSendLogsExportDefinition,
  membersExportDefinition,
  channelSubscribersExportDefinition,
  analyticsEventsExportDefinition,
  paymentOrdersExportDefinition,
  paymentRefundsExportDefinition,
  paymentContractsExportDefinition,
  workflowInstancesExportDefinition,
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
] as unknown as AnyExportDefinition[];

export function registerExportDefinitions(): void {
  if (registered) return;
  for (const definition of definitions) {
    registerExport(definition);
  }
  registered = true;
}
