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
import { and, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type {
  WorkflowEvent,
  WorkflowEventType,
  WorkflowInstanceEventPayload,
  WorkflowNodeEventPayload,
  WorkflowTaskEventPayload,
} from '@zenith/shared';
import { db } from '../db';
import { workflowEventOutbox } from '../db/schema';
import logger from './logger';
import { formatDateTime } from './datetime';

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

  private async dispatchToHandlers(full: WorkflowEvent): Promise<void> {
    const handlers = [
      ...this.emitter.listeners(full.type),
      ...this.emitter.listeners(ANY_CHANNEL),
    ];
    const settled = await Promise.allSettled(handlers.map(async (h) => {
      try {
        await (h as EventHandler)(full);
      } catch (err) {
        logger.error('[workflow-event-bus] handler error', { type: full.type, err });
        throw err;
      }
    }));
    const rejected = settled.find((result) => result.status === 'rejected');
    if (rejected?.status === 'rejected') throw rejected.reason;
  }

  /** 公开：仅派发到进程内订阅者（不写 outbox）。供 event_dispatch 作业 handler 调用。 */
  async dispatchInProcess(full: WorkflowEvent): Promise<void> {
    await this.dispatchToHandlers(full);
  }

  private async persistAndDispatch(full: WorkflowEvent): Promise<void> {
    let outboxId: number | null = null;
    try {
      const [row] = await db.insert(workflowEventOutbox).values({
        eventId: full.eventId,
        eventType: full.type,
        instanceId: 'instanceId' in full ? full.instanceId ?? null : null,
        definitionId: full.definitionId ?? null,
        taskId: 'task' in full ? full.task.id : null,
        payload: full,
        status: 'pending',
        tenantId: full.tenantId ?? null,
      }).onConflictDoNothing({ target: workflowEventOutbox.eventId }).returning({ id: workflowEventOutbox.id });
      outboxId = row?.id ?? null;
    } catch (err) {
      logger.error('[workflow-event-bus] outbox persist failed; dispatching in-memory only', { type: full.type, eventId: full.eventId, err });
    }

    try {
      await this.dispatchToHandlers(full);
      if (outboxId != null) {
        await db.update(workflowEventOutbox).set({
          status: 'success',
          processedAt: new Date(),
          errorMessage: null,
        }).where(and(eqId(outboxId), inArray(workflowEventOutbox.status, ['pending', 'processing', 'failed'])));
      }
    } catch (err) {
      if (outboxId != null) {
        await db.update(workflowEventOutbox).set({
          status: 'failed',
          attempts: sql`${workflowEventOutbox.attempts} + 1`,
          errorMessage: err instanceof Error ? err.message.slice(0, 1024) : String(err).slice(0, 1024),
          nextRetryAt: new Date(Date.now() + 60_000),
        }).where(eqId(outboxId));
      }
    }
  }

  /** 发射事件（先写 outbox，再异步派发；失败事件由恢复任务重放） */
  emit(event: Omit<WorkflowEvent, 'eventId' | 'occurredAt'> & { eventId?: string; occurredAt?: string }): void {
    const full = this.normalize(event);
    void this.persistAndDispatch(full).catch((err) => {
      logger.error('[workflow-event-bus] persist dispatch failed', { type: full.type, eventId: full.eventId, err });
    });
  }

  async replayPending(limit = 100): Promise<{ scanned: number; dispatched: number; failed: number }> {
    const now = new Date();
    const rows = await db.select().from(workflowEventOutbox)
      .where(and(
        inArray(workflowEventOutbox.status, ['pending', 'failed']),
        or(isNull(workflowEventOutbox.nextRetryAt), lte(workflowEventOutbox.nextRetryAt, now)),
      ))
      .orderBy(workflowEventOutbox.id)
      .limit(Math.max(1, Math.min(limit, 500)));

    let dispatched = 0;
    let failed = 0;
    for (const row of rows) {
      const [claimed] = await db.update(workflowEventOutbox)
        .set({ status: 'processing' })
        .where(and(eqId(row.id), inArray(workflowEventOutbox.status, ['pending', 'failed'])))
        .returning({ id: workflowEventOutbox.id });
      if (!claimed) continue;
      try {
        await this.dispatchToHandlers(row.payload as WorkflowEvent);
        await db.update(workflowEventOutbox).set({
          status: 'success',
          processedAt: new Date(),
          errorMessage: null,
          nextRetryAt: null,
        }).where(eqId(row.id));
        dispatched += 1;
      } catch (err) {
        failed += 1;
        await db.update(workflowEventOutbox).set({
          status: 'failed',
          attempts: sql`${workflowEventOutbox.attempts} + 1`,
          errorMessage: err instanceof Error ? err.message.slice(0, 1024) : String(err).slice(0, 1024),
          nextRetryAt: new Date(Date.now() + 60_000),
        }).where(eqId(row.id));
      }
    }
    return { scanned: rows.length, dispatched, failed };
  }
}

function eqId(id: number) {
  return sql`${workflowEventOutbox.id} = ${id}`;
}

export const workflowEventBus = new WorkflowEventBus();

export function getWorkflowEventBusIntrospection(): ReturnType<WorkflowEventBus['introspect']> {
  return workflowEventBus.introspect();
}

export async function replayWorkflowEventOutbox(): Promise<{ scanned: number; dispatched: number; failed: number }> {
  return workflowEventBus.replayPending();
}

/** 仅派发到进程内订阅者（不写 outbox）。供 event_dispatch 作业 handler 使用。 */
export async function dispatchWorkflowEventToHandlers(event: WorkflowEvent): Promise<void> {
  await workflowEventBus.dispatchInProcess(event);
}
