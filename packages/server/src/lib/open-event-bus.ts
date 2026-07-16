/**
 * 开放平台事件总线（in-process EventEmitter 薄封装）。
 * 网关/管理端发射领域事件，Webhook 订阅者据此向开发者应用投递。
 * Handler 通过 queueMicrotask 异步隔离，单个 handler 抛错不影响其它。
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import logger from './logger';
import { formatDateTime } from './datetime';

export interface OpenPlatformEvent {
  /** 事件类型，如 app.call.failed */
  type: string;
  eventId: string;
  /** 触发事件的应用 AppKey（= oauth2_clients.client_id） */
  clientId: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

type Handler = (event: OpenPlatformEvent) => void | Promise<void>;

const ANY = '__any__';

class OpenEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  onAny(handler: Handler): void {
    this.emitter.on(ANY, handler);
  }

  private buildEvent(input: { type: string; clientId: string; data?: Record<string, unknown>; eventId?: string }): OpenPlatformEvent {
    return {
      type: input.type,
      clientId: input.clientId,
      eventId: input.eventId ?? randomUUID(),
      occurredAt: formatDateTime(new Date()),
      data: input.data ?? {},
    };
  }

  emit(input: { type: string; clientId: string; data?: Record<string, unknown>; eventId?: string }): void {
    const full = this.buildEvent(input);
    for (const handler of this.emitter.listeners(ANY)) {
      queueMicrotask(() => {
        void Promise.resolve((handler as Handler)(full)).catch((err) => {
          logger.error('[open-event-bus] handler error', { type: full.type, err });
        });
      });
    }
  }

  /** 可靠事件调用：等待所有订阅者完成持久化后再返回。 */
  async emitAndWait(input: { type: string; clientId: string; data?: Record<string, unknown>; eventId?: string }): Promise<void> {
    const full = this.buildEvent(input);
    const handlers = this.emitter.listeners(ANY);
    if (handlers.length === 0) throw new Error('Open event bus has no registered subscribers');
    await Promise.all(handlers.map((handler) =>
      Promise.resolve((handler as Handler)(full)),
    ));
  }
}

export const openEventBus = new OpenEventBus();
