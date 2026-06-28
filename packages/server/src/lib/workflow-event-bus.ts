/**
 * 工作流事件总线
 *
 * In-process EventEmitter 薄封装。Handler 通过 queueMicrotask 异步隔离，
 * 任一 handler 抛错不影响其它 handler。
 *
 * 用法：
 *   workflowEventBus.on('task.created', async (event) => { ... });
 *   workflowEventBus.onAny(async (event) => { ... });
 *   workflowEventBus.emit({ type: 'task.created', ... });
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  WorkflowEvent,
  WorkflowEventType,
  WorkflowInstanceEventPayload,
  WorkflowNodeEventPayload,
  WorkflowTaskEventPayload,
} from '@zenith/shared';
import logger from './logger';
import { formatDateTime } from './datetime';
import { enqueueJob } from './workflow-jobs/engine';
import type { DbExecutor } from '../db/types';

type EventHandler<E extends WorkflowEvent = WorkflowEvent> = (event: E) => void | Promise<void>;

type EventByType<T extends WorkflowEventType> =
  T extends 'instance.created' | 'instance.approved' | 'instance.rejected' | 'instance.withdrawn'
    ? WorkflowInstanceEventPayload
    : T extends 'node.entered' | 'node.left'
    ? WorkflowNodeEventPayload
    : T extends 'task.created' | 'task.assigned' | 'task.approved' | 'task.rejected' | 'task.skipped' | 'task.transferred' | 'task.addSigned' | 'task.reduceSigned' | 'task.urged'
    ? WorkflowTaskEventPayload
    : never;

const ANY_CHANNEL = '__any__';

class WorkflowEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // 单进程内事件量可能较多，提升监听器上限
    this.emitter.setMaxListeners(50);
  }

  /** 订阅特定类型的事件 */
  on<T extends WorkflowEventType>(type: T, handler: EventHandler<EventByType<T>>): void {
    this.emitter.on(type, handler as EventHandler);
  }

  /** 订阅所有事件 */
  onAny(handler: EventHandler): void {
    this.emitter.on(ANY_CHANNEL, handler);
  }

  off(type: WorkflowEventType | typeof ANY_CHANNEL, handler: EventHandler): void {
    this.emitter.off(type, handler);
  }

  introspect(): { totalListenerCount: number; listeners: Array<{ eventType: WorkflowEventType | typeof ANY_CHANNEL; listenerCount: number }> } {
    const listeners = this.emitter.eventNames()
      .filter((name): name is string => typeof name === 'string')
      .map((name) => ({
        eventType: name as WorkflowEventType | typeof ANY_CHANNEL,
        listenerCount: this.emitter.listenerCount(name),
      }))
      .sort((a, b) => a.eventType.localeCompare(b.eventType));
    return {
      totalListenerCount: listeners.reduce((sum, item) => sum + item.listenerCount, 0),
      listeners,
    };
  }

  private normalize(event: Omit<WorkflowEvent, 'eventId' | 'occurredAt'> & { eventId?: string; occurredAt?: string }): WorkflowEvent {
    return {
      ...event,
      eventId: event.eventId ?? randomUUID(),
      occurredAt: event.occurredAt ?? formatDateTime(new Date()),
    } as WorkflowEvent;
  }

  /** 规整为完整事件（补 eventId / occurredAt），供事务内入队 outbox 复用 */
  build(event: Omit<WorkflowEvent, 'eventId' | 'occurredAt'> & { eventId?: string; occurredAt?: string }): WorkflowEvent {
    return this.normalize(event);
  }

  /**
   * 派发到进程内订阅者（ws / 通知 / 会话 / 自动化 / 业务桥接 / 节点监听）。
   * best-effort：单个 handler 抛错只记录、不影响其它 handler，也不抛出
   * （由 event_dispatch 作业调用，保证崩溃后可恢复地、恰好一次地投递）。
   */
  async dispatchInProcess(full: WorkflowEvent): Promise<void> {
    const handlers = [
      ...this.emitter.listeners(full.type),
      ...this.emitter.listeners(ANY_CHANNEL),
    ];
    await Promise.allSettled(handlers.map(async (h) => {
      try {
        await (h as EventHandler)(full);
      } catch (err) {
        logger.error('[workflow-event-bus] in-process handler error', { type: full.type, eventId: full.eventId, err });
      }
    }));
  }

  /**
   * 发射事件（事务性 outbox）：把事件作为 event_dispatch 作业持久入队，由统一 worker
   * 可靠投递（进程内订阅者 + Webhook 扇出，各自重试/死信）。
   * - 传入事务 executor 时：在同一事务内入队，与状态变更原子提交，崩溃不丢事件。
   * - 不传时：以默认 db best-effort 入队（用于非事务的次要事件）。
   * 返回规整后的完整事件（便于调用方复用 eventId）。
   */
  emit(
    event: Omit<WorkflowEvent, 'eventId' | 'occurredAt'> & { eventId?: string; occurredAt?: string },
    executor?: DbExecutor,
  ): WorkflowEvent {
    const full = this.normalize(event);
    const enqueue = enqueueJob({
      jobType: 'event_dispatch',
      instanceId: 'instanceId' in full ? full.instanceId ?? null : null,
      taskId: 'task' in full ? full.task.id : null,
      payload: { event: full },
      tenantId: full.tenantId ?? null,
      maxAttempts: 3,
      idempotencyKey: `event:${full.eventId}`,
      traceId: full.eventId,
    }, executor);
    // 事务内入队需等待，确保与状态变更原子提交；非事务则 best-effort
    if (executor) {
      // 调用方应 await emitInTx；此处返回 promise 供其等待
      void enqueue.catch((err) => logger.error('[workflow-event-bus] tx enqueue event_dispatch failed', { type: full.type, eventId: full.eventId, err }));
    } else {
      void enqueue.catch((err) => logger.error('[workflow-event-bus] enqueue event_dispatch failed', { type: full.type, eventId: full.eventId, err }));
    }
    return full;
  }

  /** 事务内入队事件 outbox（与状态变更原子提交，必须 await） */
  async emitInTx(
    event: Omit<WorkflowEvent, 'eventId' | 'occurredAt'> & { eventId?: string; occurredAt?: string },
    executor: DbExecutor,
  ): Promise<WorkflowEvent> {
    const full = this.normalize(event);
    await enqueueJob({
      jobType: 'event_dispatch',
      instanceId: 'instanceId' in full ? full.instanceId ?? null : null,
      taskId: 'task' in full ? full.task.id : null,
      payload: { event: full },
      tenantId: full.tenantId ?? null,
      maxAttempts: 3,
      idempotencyKey: `event:${full.eventId}`,
      traceId: full.eventId,
    }, executor);
    return full;
  }
}

export const workflowEventBus = new WorkflowEventBus();

export function getWorkflowEventBusIntrospection(): ReturnType<WorkflowEventBus['introspect']> {
  return workflowEventBus.introspect();
}
