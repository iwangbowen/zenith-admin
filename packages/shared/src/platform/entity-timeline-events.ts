import type { DomainEventType } from './domain-events';

/**
 * 对象时间线展示的事件标签与筛选项（纯数据，无运行时依赖）。
 *
 * 独立成模块而不是留在 `domain-events.ts`：延迟加载的关联运行时在模块顶层直接读取这些值
 * （契约里的 `queryEnum(ENTITY_TIMELINE_EVENT_TYPES, …)`、`utils/entity-relations.ts` 的
 * `const EVENT_LABELS = ENTITY_TIMELINE_EVENT_LABELS`），而 `domain-events.ts` 依赖各领域常量模块，
 * 会被分到与 `entity-discovery` 互相 import 的共享 chunk，形成跨 chunk 环——此时这些绑定仍是
 * undefined，入口求值即抛 “Cannot convert undefined or null to object”。本模块与
 * `entity-primitives` 同组（见 `packages/web/vite.config.ts`），保证先于关联运行时求值。
 */
export const ENTITY_TIMELINE_EVENT_LABELS = {
  'payment.succeeded': '支付成功', 'payment.closed': '订单关闭', 'payment.failed': '支付失败',
  'refund.succeeded': '退款成功', 'refund.failed': '退款失败',
  'payment.risk.hit': '命中风控规则', 'payment.risk.review.created': '发起风控审核', 'payment.risk.review.decided': '风控审核完成',
  'payment.dispute.replied': '回复支付投诉', 'payment.dispute.resolved': '支付投诉已解决',
  'payment.dispute.refund-requested': '投诉发起退款', 'payment.dispute.refunded': '投诉退款完成', 'payment.dispute.refund-failed': '投诉退款失败',
  'workflow.instance.created': '流程发起', 'workflow.instance.approved': '流程通过',
  'workflow.instance.rejected': '流程驳回', 'workflow.instance.withdrawn': '流程撤回',
  'workflow.instance.returned': '流程退回', 'workflow.task.changed': '审批任务更新',
  'messaging.notification.queued': '通知进入发送队列', 'messaging.notification.dispatched': '通知派发完成', 'messaging.notification.failed': '通知派发失败',
  'tasks.async-task.created': '异步任务创建', 'tasks.async-task.succeeded': '异步任务完成', 'tasks.async-task.failed': '异步任务失败', 'tasks.async-task.cancelled': '异步任务取消',
  'platform.audit.operation': '操作记录',
  'iot.alarm.triggered': '设备触发告警', 'iot.alarm.acknowledged': '设备告警已认领', 'iot.alarm.resolved': '设备告警已恢复',
} as const satisfies Record<DomainEventType | 'platform.audit.operation', string>;

export const ENTITY_TIMELINE_EVENT_TYPES = Object.keys(ENTITY_TIMELINE_EVENT_LABELS) as Array<keyof typeof ENTITY_TIMELINE_EVENT_LABELS>;
export const ENTITY_TIMELINE_EVENT_OPTIONS = ENTITY_TIMELINE_EVENT_TYPES.map((value) => ({ value, label: ENTITY_TIMELINE_EVENT_LABELS[value] }));

/** 未知事件类型不展示标签（与 `getDomainEventDefinition` 同一口径：不发现未知事件）。 */
export function entityTimelineEventLabel(eventType: string): string | undefined {
  return (ENTITY_TIMELINE_EVENT_LABELS as Record<string, string>)[eventType];
}
