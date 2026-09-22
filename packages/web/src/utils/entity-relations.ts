import type { CanonicalEntityRef, CanonicalEntityType, DomainEventType, EntityRelationKind } from '@zenith/shared/platform';
import type { TimelineEvent } from '@zenith/shared/core';

const ENTITY_LABELS: Record<CanonicalEntityType, string> = {
  'identity.user': '用户', 'member.member': '会员', 'payment.order': '支付订单', 'payment.refund': '退款',
  'payment.dispute': '支付投诉', 'payment.risk-hit': '风控命中', 'payment.risk-review': '风控审核',
  'payment.journal': '账务凭证', 'payment.recon-case': '对账差异', 'payment.recon-adjustment': '对账调整',
  'payment.sharing-order': '分账单', 'payment.sharing-receiver': '分账接收方', 'payment.sharing-reversal': '分账冲正',
  'payment.settlement-batch': '结算批次', 'payment.notify-log': '渠道回调',
  'workflow.definition': '流程定义', 'workflow.instance': '流程实例', 'workflow.task': '审批任务',
  'workflow.attachment': '审批附件', 'workflow.archive': '审批归档件',
  'drive.file': '文件', 'iot.device': '设备', 'iot.alarm': '设备告警', 'cms.content': '内容',
  'wiki.document': '知识文档', 'messaging.announcement': '公告', 'chat.message': '聊天消息',
  'biz.leave': '请假申请', 'report.dashboard': '仪表盘', 'report.dataset': '数据集',
  'ai.knowledge-base': '知识库', 'tasks.async': '异步任务', 'notification.outbox': '通知',
  'platform.operation-log': '操作审计', 'platform.exception-log': '异常记录',
};

const RELATION_LABELS: Record<string, string> = {
  refunds: '退款记录', workflow: '关联流程', audit: '操作审计', notifications: '通知记录', tasks: '异步任务',
  disputes: '支付投诉', 'risk-hits': '风控命中', 'risk-reviews': '风控审核',
  'payment-orders': '支付订单', alarms: '设备告警', related: '关联内容',
  incoming: '被关联对象', outgoing: '关联对象', subjects: '关联对象', order: '支付订单',
  definition: '流程定义', instance: '流程实例', device: '所属设备', user: '关联用户', member: '关联会员',
  'approval-tasks': '审批任务',
  journals: '账务凭证', 'recon-cases': '对账差异', 'recon-adjustments': '对账调整',
  'sharing-orders': '分账单', receiver: '分账接收方', reversals: '分账冲正', 'sharing-reversals': '分账冲正',
  'settlement-batches': '结算批次', 'notify-logs': '渠道回调', orders: '支付订单',
  case: '对账差异', 'sharing-order': '分账单',
  'workflow-instances': '历次审批', 'business-history': '同一业务的其他审批',
  'business-leave': '原请假单', 'business-content': '原内容', 'business-recon-adjustment': '原对账调整单',
  attachments: '审批附件', archives: '审批归档件',
};

export function entityTypeLabel(type: CanonicalEntityType): string { return ENTITY_LABELS[type]; }

export function entityRelationLabel(labelKey: string, targetTypes?: readonly CanonicalEntityType[]): string {
  if (labelKey === 'relation.common.related') return '人工关联';
  if (labelKey === 'relation.common.subjects') return '来源业务对象';
  const name = labelKey.split('.').at(-1) ?? '';
  return RELATION_LABELS[name] ?? (targetTypes?.length ? targetTypes.map(entityTypeLabel).join('、') : '关联记录');
}

const RELATION_KIND_LABELS: Record<EntityRelationKind, string> = {
  direct: '直接业务关联',
  derived: '业务规则推导',
  causal: '流程或事件触发',
  activity: '操作活动来源',
};

export function entityRelationKindLabel(kind: EntityRelationKind): string {
  return RELATION_KIND_LABELS[kind];
}

/** Register only routes that resolve the exact entity independently of list pagination. */
const ENTITY_DETAIL_ROUTES: Partial<Record<CanonicalEntityType, (key: string) => string>> = {
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
  'drive.file': (key) => `/drive?node=${encodeURIComponent(key)}`,
  'workflow.instance': (key) => `/workflow/instance/${encodeURIComponent(key)}`,
  'wiki.document': (key) => `/wiki/docs?docId=${encodeURIComponent(key)}`,
  'tasks.async': (key) => `/system/task-center?taskId=${encodeURIComponent(key)}`,
};

export function entityDetailRoute(ref: CanonicalEntityRef): string | undefined {
  if (!/^[1-9]\d*$/.test(ref.key)) return undefined;
  return ENTITY_DETAIL_ROUTES[ref.type]?.(ref.key);
}

const EVENT_LABELS = {
  'payment.succeeded': '支付成功', 'payment.closed': '订单关闭', 'payment.failed': '支付失败',
  'refund.succeeded': '退款成功', 'refund.failed': '退款失败',
  'payment.risk.hit': '命中风控规则', 'payment.risk.review.created': '发起风控审核', 'payment.risk.review.decided': '风控审核完成',
  'payment.dispute.replied': '回复支付投诉', 'payment.dispute.resolved': '支付投诉已解决',
  'payment.dispute.refund-requested': '投诉发起退款', 'payment.dispute.refunded': '投诉退款完成', 'payment.dispute.refund-failed': '投诉退款失败',
  'workflow.instance.created': '流程发起', 'workflow.instance.approved': '流程通过',
  'workflow.instance.rejected': '流程驳回', 'workflow.instance.withdrawn': '流程撤回',
  'workflow.instance.returned': '流程退回', 'workflow.task.changed': '审批任务更新',
  'messaging.notification.queued': '通知进入发送队列', 'tasks.async-task.created': '异步任务创建',
  'platform.audit.operation': '操作记录',
} satisfies Record<DomainEventType | 'platform.audit.operation', string>;

const STATUS_LABELS: Record<string, string> = {
  pending: '待处理', processing: '处理中', success: '成功', failed: '失败', refunded: '已退款', refunding: '退款中',
  paying: '支付中', closed: '已关闭', enabled: '启用', disabled: '停用', approved: '已通过', rejected: '已驳回',
  running: '执行中', completed: '已完成', cancelled: '已取消', open: '未处理', resolved: '已解决', acknowledged: '已认领',
  published: '已发布', draft: '草稿', active: '有效', withdrawn: '已撤回', returned: '已退回',
  reversed: '已冲正', settled: '已结算', settling: '结算中', done: '已完成',
};

export function timelineEventLabel(eventType: string): string {
  return Object.prototype.hasOwnProperty.call(EVENT_LABELS, eventType) ? EVENT_LABELS[eventType as keyof typeof EVENT_LABELS] : '业务事件';
}

export function entityStatusLabel(status: string | null | undefined): string | undefined {
  return status ? STATUS_LABELS[status] : undefined;
}

export function timelineEventDescription(event: TimelineEvent): string | undefined {
  if (typeof event.payload.description === 'string') return event.payload.description;
  const parts: string[] = [];
  if (typeof event.payload.orderNo === 'string') parts.push(`订单 ${event.payload.orderNo}`);
  if (typeof event.payload.refundNo === 'string') parts.push(`退款单 ${event.payload.refundNo}`);
  if (typeof event.payload.reviewNo === 'string') parts.push(`审核单 ${event.payload.reviewNo}`);
  if (typeof event.payload.disputeNo === 'string') parts.push(`投诉单 ${event.payload.disputeNo}`);
  if (event.eventType === 'payment.risk.hit') {
    if (event.payload.action === 'block') parts.push('已拦截');
    if (event.payload.action === 'review') parts.push('待人工审核');
  }
  const amount = event.payload.refundAmount ?? event.payload.amount;
  if (typeof amount === 'number' && typeof event.payload.currency === 'string') parts.push(`${(amount / 100).toFixed(2)} ${event.payload.currency}`);
  if (typeof event.payload.status === 'string') {
    const status = entityStatusLabel(event.payload.status);
    if (status) parts.push(status);
  }
  return parts.length ? parts.join(' · ') : undefined;
}
