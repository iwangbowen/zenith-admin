/**
 * 开放平台事件总线（in-process EventEmitter 薄封装）。
 * 网关/管理端/CMS 发射领域事件，Webhook 订阅者据此向开发者应用投递。
 * Handler 通过 queueMicrotask 异步隔离，单个 handler 抛错不影响其它。
 *
 * 事件分两类路由方式：
 *   - **应用域**（`app.*`）：带 `clientId`，定向投递给该应用自己的订阅
 *   - **站点域**（`cms.*`）：无 clientId，广播给「订阅了该事件且被授权该站点」的应用，
 *     由 `scope.siteId` 收窄范围
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import logger from './logger';
import { formatDateTime } from './datetime';

export interface OpenPlatformEvent {
  /** 事件类型，如 app.call.failed / cms.content.published */
  type: string;
  eventId: string;
  /** 应用域事件的 AppKey（= oauth2_clients.client_id）；站点域事件为 null */
  clientId: string | null;
  /** 事件所属租户；支付等强隔离事件必须显式携带。 */
  tenantId?: number | null;
  /** 站点域 / 空间域事件的归属范围，供订阅按站点（CMS）或网盘空间授权过滤 */
  scope?: { siteId?: number; spaceId?: number };
  occurredAt: string;
  data: Record<string, unknown>;
}

export interface OpenEventInput {
  type: string;
  clientId?: string | null;
  tenantId?: number | null;
  scope?: { siteId?: number; spaceId?: number };
  data?: Record<string, unknown>;
  eventId?: string;
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

  private buildEvent(input: OpenEventInput): OpenPlatformEvent {
    return {
      type: input.type,
      clientId: input.clientId ?? null,
      ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
      ...(input.scope ? { scope: input.scope } : {}),
      eventId: input.eventId ?? randomUUID(),
      occurredAt: formatDateTime(new Date()),
      data: input.data ?? {},
    };
  }

  emit(input: OpenEventInput): void {
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
  async emitAndWait(input: OpenEventInput): Promise<void> {
    const full = this.buildEvent(input);
    const handlers = this.emitter.listeners(ANY);
    if (handlers.length === 0) throw new Error('Open event bus has no registered subscribers');
    await Promise.all(handlers.map((handler) =>
      Promise.resolve((handler as Handler)(full)),
    ));
  }
}

export const openEventBus = new OpenEventBus();
