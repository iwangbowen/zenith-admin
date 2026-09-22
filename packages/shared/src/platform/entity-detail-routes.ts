import type { CanonicalEntityType, CanonicalEntityRef } from './entity-catalog';

/** Register only routes that resolve the exact entity independently of list pagination. */
const ENTITY_DETAIL_ROUTES: Partial<Record<CanonicalEntityType, (key: string) => string>> = {
  'member.wallet-transaction': (key) => `/member/wallets?transactionId=${encodeURIComponent(key)}`,
  'member.vip-renewal': (key) => `/member/members?renewalId=${encodeURIComponent(key)}`,
  'iot.ota-task': (key) => `/iot/ota?tab=tasks&otaTaskId=${encodeURIComponent(key)}`,
  'iot.ota-device': (key) => `/iot/ota?tab=tasks&otaDeviceId=${encodeURIComponent(key)}`,
  'iot.firmware': (key) => `/iot/ota?tab=firmwares&firmwareId=${encodeURIComponent(key)}`,
  'messaging.announcement': (key) => `/system/announcements?announcementId=${encodeURIComponent(key)}`,
  'biz.leave': (key) => `/biz/leave?leaveId=${encodeURIComponent(key)}`,
  'cms.content': (key) => `/cms/contents/edit?id=${encodeURIComponent(key)}`,
  'payment.recon-adjustment': (key) => `/payment/recon?adjustmentId=${encodeURIComponent(key)}`,
  'payment.order': (key) => `/payment/orders?orderId=${encodeURIComponent(key)}`,
  'payment.refund': (key) => `/payment/refunds?refundId=${encodeURIComponent(key)}`,
  'payment.dispute': (key) => `/payment/disputes?disputeId=${encodeURIComponent(key)}`,
  'payment.risk-hit': (key) => `/payment/risk-rules?tab=hits&hitId=${encodeURIComponent(key)}`,
  'payment.risk-review': (key) => `/payment/risk-rules?tab=reviews&reviewId=${encodeURIComponent(key)}`,
  'payment.journal': (key) => `/payment/ledger?tab=journals&journalId=${encodeURIComponent(key)}`,
  'payment.recon-case': (key) => `/payment/recon?caseId=${encodeURIComponent(key)}`,
  'payment.settlement-batch': (key) => `/payment/settlements?batchId=${encodeURIComponent(key)}`,
  'payment.sharing-receiver': (key) => `/payment/sharing?receiverId=${encodeURIComponent(key)}`,
  'payment.sharing-order': (key) => `/payment/sharing?sharingOrderId=${encodeURIComponent(key)}`,
  'payment.sharing-reversal': (key) => `/payment/sharing?reversalId=${encodeURIComponent(key)}`,
  'payment.notify-log': (key) => `/payment/logs?notifyLogId=${encodeURIComponent(key)}`,
  'platform.operation-log': (key) => `/system/operation-logs?operationLogId=${encodeURIComponent(key)}`,
  'notification.outbox': (key) => `/system/notify-policies?tab=dispatches&outboxId=${encodeURIComponent(key)}`,
  'member.member': (key) => `/member/members?memberId=${encodeURIComponent(key)}`,
  'iot.device': (key) => `/iot/devices?deviceId=${encodeURIComponent(key)}`,
  'iot.alarm': (key) => `/iot/alarms?tab=records&alarmId=${encodeURIComponent(key)}`,
  'drive.file': (key) => `/drive?node=${encodeURIComponent(key)}`,
  'workflow.instance': (key) => `/workflow/instance/${encodeURIComponent(key)}`,
  'wiki.document': (key) => `/wiki/docs?docId=${encodeURIComponent(key)}`,
  'tasks.async': (key) => `/system/task-center?taskId=${encodeURIComponent(key)}`,
};

export function canonicalEntityDetailRoute(ref: CanonicalEntityRef): string | undefined {
  if (!/^[1-9]\d*$/.test(ref.key)) return undefined;
  return ENTITY_DETAIL_ROUTES[ref.type]?.(ref.key);
}

