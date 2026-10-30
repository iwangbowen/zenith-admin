/**
 * 支付 / 工作流事件总线 → 服务端权威语义事件订阅桥接。
 *
 * - paymentEventBus.onAny：5 种支付/退款事件 1:1 映射为同名语义事件。
 * - 工作流领域事件消费者：14 种工作流事件映射为 `workflow.<type>`，由持久化
 *   `event_outbox` / `event_consumer_deliveries` 可靠投递，分析消费者独立确认与重试。
 * - 两条订阅仅提取白名单标量字段进 properties，不落 formData / attachments / 签名等大字段，
 *   也不落任何凭据；handler 本身不 throw（trackServerEvent 内部已吞掉所有异常，两条总线本身
 *   也各自隔离了 handler 异常，双重保险）。
 */
import type { PaymentEvent } from '../../lib/payment-event-bus';
import { paymentEventBus } from '../../lib/payment-event-bus';
import type { WorkflowEvent } from '@zenith/shared/workflow';
import { WORKFLOW_EVENT_TYPES } from '@zenith/shared/workflow';
import { registerWorkflowEventConsumer } from '../../lib/workflow-event-consumer';
import { trackServerEvent } from './analytics-server-events.service';
import logger from '../../lib/logger';

let registered = false;

function mapPaymentProperties(e: PaymentEvent): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    orderNo: e.orderNo,
    bizType: e.bizType,
    bizId: e.bizId,
    channel: e.channel,
    amount: e.amount,
  };
  if (e.refundNo !== undefined) properties.refundNo = e.refundNo;
  if (e.refundAmount !== undefined) properties.refundAmount = e.refundAmount;
  return properties;
}

/** actor.userId 为主来源；缺失时按事件类型从实例发起人 / 任务处理人兜底提取，均为安全标量字段 */
function resolveWorkflowUserId(event: WorkflowEvent): number | null {
  if (event.actor?.userId != null) return event.actor.userId;
  if ('instance' in event) return event.instance.initiatorId ?? null;
  if ('task' in event) return event.task.assigneeId ?? null;
  return null;
}

function mapWorkflowProperties(event: WorkflowEvent): Record<string, unknown> {
  if ('instance' in event) {
    return {
      instanceId: event.instanceId,
      definitionId: event.definitionId,
      status: event.instance.status,
    };
  }
  if ('nodeKey' in event) {
    return {
      instanceId: event.instanceId,
      nodeKey: event.nodeKey,
      nodeName: event.nodeName,
      nodeType: event.nodeType,
    };
  }
  return {
    instanceId: event.instanceId,
    taskId: event.task.id,
    nodeKey: event.task.nodeKey,
    status: event.task.status,
  };
}

/** 幂等注册（重复调用安全），应在 index.ts 与其它事件总线订阅者同区域调用一次 */
export function registerAnalyticsServerEventSubscribers(): void {
  if (registered) return;
  registered = true;

  paymentEventBus.onAny((e) => {
    try {
      trackServerEvent({
        eventName: e.type,
        eventId: e.eventId,
        occurredAt: e.occurredAt,
        tenantId: e.tenantId ?? null,
        userId: e.userId ?? null,
        properties: mapPaymentProperties(e),
      });
    } catch (err) {
      logger.error('[analytics-server-event-subscribers] payment handler error', { type: e.type, err });
    }
  });

  registerWorkflowEventConsumer('workflow.analytics', WORKFLOW_EVENT_TYPES, async (...args) => {
    const event = (args.find((value) => value && typeof value === 'object' && 'type' in value) ?? {}) as WorkflowEvent;
    try {
      trackServerEvent({
        eventName: `workflow.${event.type}`,
        eventId: event.eventId,
        occurredAt: event.occurredAt,
        tenantId: event.tenantId ?? null,
        userId: resolveWorkflowUserId(event),
        displayName: event.actor?.name ?? null,
        properties: mapWorkflowProperties(event),
      });
    } catch (err) {
      logger.error('[analytics-server-event-subscribers] workflow handler error', { type: event.type, err });
    }
    return { outcome: 'completed' };
  });

  logger.info('[analytics-server-event-subscribers] registered payment/workflow -> analytics bridge');
}

/** 仅供测试重置注册状态 */
export function __resetAnalyticsServerEventSubscribersForTest(): void {
  registered = false;
}
