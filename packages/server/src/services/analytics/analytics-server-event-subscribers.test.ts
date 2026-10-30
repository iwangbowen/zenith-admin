/**
 * paymentEventBus / workflowEventBus → trackServerEvent 订阅桥接单测。
 *
 * 覆盖要点：
 *  1. 注册幂等：重复调用 registerAnalyticsServerEventSubscribers 只挂载一次 onAny 监听器
 *  2. payment 事件 1:1 映射为同名语义事件，复用 eventId/occurredAt/tenantId/userId，
 *     properties 仅含白名单标量字段（orderNo/bizType/bizId/channel/amount[/refundNo/refundAmount]），
 *     不泄露 outTradeNo 等其它字段
 *  3. workflow 事件映射为 `workflow.<type>`，按 instance/node/task 三种载荷分别提取白名单标量字段，
 *     不泄露整个 task/instance 对象（如 formData、大字段）
 *  4. workflow userId 兜底链：actor.userId > instance.initiatorId > task.assigneeId
 *  5. handler 本身不 throw（即使 trackServerEvent 同步抛错也被内部 try/catch 吞掉）
 *
 * Mock 策略：完全 mock payment-event-bus / workflow-event-bus（仅捕获 onAny 注册的 handler，
 * 不触发真实事件总线的下游依赖如 db/redis/workflow-jobs）与 analytics-server-events.service。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentEvent } from '../../lib/payment-event-bus';
import type { WorkflowEvent } from '@zenith/shared/workflow';

const { paymentOnAny, registerWorkflow, trackServerEvent } = vi.hoisted(() => ({
  paymentOnAny: vi.fn(), registerWorkflow: vi.fn(), trackServerEvent: vi.fn(),
}));

vi.mock('../../lib/payment-event-bus', () => ({ paymentEventBus: { onAny: paymentOnAny } }));
vi.mock('../../lib/workflow-event-consumer', () => ({ registerWorkflowEventConsumer: registerWorkflow }));
vi.mock('./analytics-server-events.service', () => ({ trackServerEvent }));

import {
  registerAnalyticsServerEventSubscribers,
  __resetAnalyticsServerEventSubscribersForTest,
} from './analytics-server-event-subscribers';

function paymentHandler(): (e: PaymentEvent) => void {
  return paymentOnAny.mock.calls[0][0];
}

function workflowHandler(): (e: WorkflowEvent) => void {
  return registerWorkflow.mock.calls[0][2];
}

function makePaymentEvent(overrides: Partial<PaymentEvent> = {}): PaymentEvent {
  return {
    eventId: 'pay-evt-1',
    type: 'payment.succeeded',
    occurredAt: '2026-07-05 10:00:00',
    orderNo: 'SO-1001',
    outTradeNo: 'OUT-SECRET-1001', // 不应出现在 properties 中
    bizType: 'member_recharge',
    bizId: 'RC-1',
    channel: 'wechat',
    amount: 1000,
    userId: 5,
    tenantId: 3,
    ...overrides,
  } as PaymentEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetAnalyticsServerEventSubscribersForTest();
});

describe('registerAnalyticsServerEventSubscribers — 注册幂等', () => {
  it('重复调用只挂载一次 onAny 监听器', () => {
    registerAnalyticsServerEventSubscribers();
    registerAnalyticsServerEventSubscribers();
    registerAnalyticsServerEventSubscribers();
    expect(paymentOnAny).toHaveBeenCalledTimes(1);
    expect(registerWorkflow).toHaveBeenCalledTimes(1);
  });
});

describe('payment 订阅：同名映射 + 属性白名单', () => {
  beforeEach(() => registerAnalyticsServerEventSubscribers());

  it('payment.succeeded → 同名事件，复用 eventId/occurredAt/tenantId/userId', () => {
    paymentHandler()(makePaymentEvent());
    expect(trackServerEvent).toHaveBeenCalledWith({
      eventName: 'payment.succeeded',
      eventId: 'pay-evt-1',
      occurredAt: '2026-07-05 10:00:00',
      tenantId: 3,
      userId: 5,
      properties: { orderNo: 'SO-1001', bizType: 'member_recharge', bizId: 'RC-1', channel: 'wechat', amount: 1000 },
    });
  });

  it('properties 不包含 outTradeNo 等非白名单字段', () => {
    paymentHandler()(makePaymentEvent());
    const call = trackServerEvent.mock.calls[0][0];
    expect(call.properties).not.toHaveProperty('outTradeNo');
    expect(Object.keys(call.properties)).toEqual(['orderNo', 'bizType', 'bizId', 'channel', 'amount']);
  });

  it('refund.succeeded → 额外含 refundNo/refundAmount（其余支付事件不含）', () => {
    paymentHandler()(makePaymentEvent({ type: 'refund.succeeded', refundNo: 'RF-1', refundAmount: 500 }));
    const call = trackServerEvent.mock.calls[0][0];
    expect(call.eventName).toBe('refund.succeeded');
    expect(call.properties).toMatchObject({ refundNo: 'RF-1', refundAmount: 500 });
  });

  it('tenantId/userId 缺失时归一化为 null（不透传 undefined）', () => {
    paymentHandler()(makePaymentEvent({ tenantId: undefined, userId: undefined }));
    const call = trackServerEvent.mock.calls[0][0];
    expect(call.tenantId).toBeNull();
    expect(call.userId).toBeNull();
  });

  it('五种 payment/refund 事件类型均能正确映射为同名事件', () => {
    const types: PaymentEvent['type'][] = ['payment.succeeded', 'payment.closed', 'payment.failed', 'refund.succeeded', 'refund.failed'];
    for (const type of types) {
      trackServerEvent.mockClear();
      paymentHandler()(makePaymentEvent({ type }));
      expect(trackServerEvent).toHaveBeenCalledWith(expect.objectContaining({ eventName: type }));
    }
  });

  it('handler 内部即使 trackServerEvent 同步抛错也不向外抛出', () => {
    trackServerEvent.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(() => paymentHandler()(makePaymentEvent())).not.toThrow();
  });
});

describe('workflow 订阅：workflow.<type> 映射 + 属性白名单', () => {
  beforeEach(() => registerAnalyticsServerEventSubscribers());

  function makeInstanceEvent(overrides: Partial<WorkflowEvent> = {}): WorkflowEvent {
    return {
      eventId: 'wf-evt-1',
      type: 'instance.created',
      occurredAt: '2026-07-05 11:00:00',
      instanceId: 100,
      definitionId: 10,
      tenantId: 7,
      actor: { userId: 1, name: '张三' },
      instance: {
        id: 100,
        status: 'pending',
        initiatorId: 2,
        formData: { secret: 'should-not-leak', bigBlob: 'x'.repeat(5000) },
      },
      ...overrides,
    } as unknown as WorkflowEvent;
  }

  function makeNodeEvent(overrides: Partial<WorkflowEvent> = {}): WorkflowEvent {
    return {
      eventId: 'wf-evt-2',
      type: 'node.entered',
      occurredAt: '2026-07-05 11:05:00',
      instanceId: 100,
      definitionId: 10,
      tenantId: 7,
      actor: { userId: 1 },
      nodeKey: 'approve-1',
      nodeName: '经理审批',
      nodeType: 'approval',
      ...overrides,
    } as unknown as WorkflowEvent;
  }

  function makeTaskEvent(overrides: Partial<WorkflowEvent> = {}): WorkflowEvent {
    return {
      eventId: 'wf-evt-3',
      type: 'task.created',
      occurredAt: '2026-07-05 11:10:00',
      instanceId: 100,
      definitionId: 10,
      tenantId: 7,
      task: {
        id: 500,
        nodeKey: 'approve-1',
        status: 'pending',
        assigneeId: 9,
        formData: { secret: 'should-not-leak' },
        attachments: ['huge-file-ref'],
      },
      ...overrides,
    } as unknown as WorkflowEvent;
  }

  it('instance 事件 → eventName=workflow.instance.created，properties 仅含 instanceId/definitionId/status', () => {
    workflowHandler()(makeInstanceEvent());
    expect(trackServerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.instance.created',
        eventId: 'wf-evt-1',
        tenantId: 7,
        userId: 1, // actor.userId 优先
        displayName: '张三',
        properties: { instanceId: 100, definitionId: 10, status: 'pending' },
      }),
    );
    const call = trackServerEvent.mock.calls[0][0];
    expect(call.properties).not.toHaveProperty('formData');
  });

  it('node 事件 → eventName=workflow.node.entered，properties 仅含 instanceId/nodeKey/nodeName/nodeType', () => {
    workflowHandler()(makeNodeEvent());
    expect(trackServerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.node.entered',
        properties: { instanceId: 100, nodeKey: 'approve-1', nodeName: '经理审批', nodeType: 'approval' },
      }),
    );
  });

  it('task 事件 → eventName=workflow.task.created，properties 仅含 instanceId/taskId/nodeKey/status，不泄露 formData/attachments', () => {
    workflowHandler()(makeTaskEvent());
    const call = trackServerEvent.mock.calls[0][0];
    expect(call.eventName).toBe('workflow.task.created');
    expect(call.properties).toEqual({ instanceId: 100, taskId: 500, nodeKey: 'approve-1', status: 'pending' });
    expect(call.properties).not.toHaveProperty('formData');
    expect(call.properties).not.toHaveProperty('attachments');
  });

  it('userId 兜底链：无 actor → task 事件取 task.assigneeId', () => {
    workflowHandler()(makeTaskEvent({ actor: undefined }));
    expect(trackServerEvent).toHaveBeenCalledWith(expect.objectContaining({ userId: 9 }));
  });

  it('userId 兜底链：无 actor → instance 事件取 instance.initiatorId', () => {
    workflowHandler()(makeInstanceEvent({ actor: undefined }));
    expect(trackServerEvent).toHaveBeenCalledWith(expect.objectContaining({ userId: 2 }));
  });

  it('无 actor 且 node 事件（无 instance/task 兜底来源）→ userId 为 null', () => {
    workflowHandler()(makeNodeEvent({ actor: undefined }));
    expect(trackServerEvent).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
  });

  it('handler 内部即使 trackServerEvent 同步抛错也不向外抛出', () => {
    trackServerEvent.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(() => workflowHandler()(makeInstanceEvent())).not.toThrow();
  });

  it('工作流事件类型（15 种，涵盖 instance/node/task 全部载荷）均能映射为 workflow.<type>', () => {
    const instanceTypes = ['instance.created', 'instance.approved', 'instance.rejected', 'instance.withdrawn'];
    const nodeTypes = ['node.entered', 'node.left'];
    const taskTypes = ['task.created', 'task.assigned', 'task.approved', 'task.rejected', 'task.skipped', 'task.transferred', 'task.addSigned', 'task.reduceSigned', 'task.urged'];
    expect(instanceTypes.length + nodeTypes.length + taskTypes.length).toBe(15);

    for (const type of instanceTypes) {
      trackServerEvent.mockClear();
      workflowHandler()(makeInstanceEvent({ type: type as WorkflowEvent['type'] }));
      expect(trackServerEvent).toHaveBeenCalledWith(expect.objectContaining({ eventName: `workflow.${type}` }));
    }
    for (const type of nodeTypes) {
      trackServerEvent.mockClear();
      workflowHandler()(makeNodeEvent({ type: type as WorkflowEvent['type'] }));
      expect(trackServerEvent).toHaveBeenCalledWith(expect.objectContaining({ eventName: `workflow.${type}` }));
    }
    for (const type of taskTypes) {
      trackServerEvent.mockClear();
      workflowHandler()(makeTaskEvent({ type: type as WorkflowEvent['type'] }));
      expect(trackServerEvent).toHaveBeenCalledWith(expect.objectContaining({ eventName: `workflow.${type}` }));
    }
  });
});
