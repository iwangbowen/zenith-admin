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

type EventHandler<E extends WorkflowEvent = WorkflowEvent> = (event: E) => void | Promise<void>;

type EventByType<T extends WorkflowEventType> =
  T extends 'instance.created' | 'instance.approved' | 'instance.rejected' | 'instance.withdrawn'
    ? WorkflowInstanceEventPayload
    : T extends 'node.entered' | 'node.left'
    ? WorkflowNodeEventPayload
    : T extends 'task.created' | 'task.assigned' | 'task.approved' | 'task.rejected' | 'task.skipped' | 'task.transferred'
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

  /** 发射事件（异步隔离，不阻塞调用者） */
  emit(event: Omit<WorkflowEvent, 'eventId' | 'occurredAt'> & { eventId?: string; occurredAt?: string }): void {
    const full: WorkflowEvent = {
      ...event,
      eventId: event.eventId ?? randomUUID(),
      occurredAt: event.occurredAt ?? formatDateTime(new Date()),
    } as WorkflowEvent;

    queueMicrotask(() => {
      const handlers = [
        ...this.emitter.listeners(full.type),
        ...this.emitter.listeners(ANY_CHANNEL),
      ];
      for (const h of handlers) {
        try {
          const ret = (h as EventHandler)(full);
          if (ret instanceof Promise) {
            ret.catch((err) => {
              logger.error('[workflow-event-bus] async handler error', { type: full.type, err });
            });
          }
        } catch (err) {
          logger.error('[workflow-event-bus] sync handler error', { type: full.type, err });
        }
      }
    });
  }
}

export const workflowEventBus = new WorkflowEventBus();
