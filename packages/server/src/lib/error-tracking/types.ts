import type { AnalyticsEnvironment, AnalyticsEventSource, ErrorLevel, ErrorType, ServerErrorType } from '@zenith/shared/analytics';
import type { NewErrorEvent } from '../../db/schema';

/** 事件行里由「分组 / 来源 / 级别」等公共字段之外的列（原样写入 error_events） */
export type ErrorEventColumns = Omit<
  NewErrorEvent,
  'id' | 'tenantId' | 'groupId' | 'fingerprint' | 'errorType' | 'level' | 'message' | 'release' | 'source' | 'appId' | 'environment' | 'createdAt'
>;

/** 一条待落库的错误事件：前端上报与服务端采集都归一到这个形状再进入 recordErrorEvent */
export interface ErrorEventInput {
  /** 事件与分组的租户归属；服务端异常归平台（null），受影响租户走 event.affectedTenantId */
  readonly tenantId: number | null;
  readonly fingerprint: string;
  readonly source: AnalyticsEventSource;
  readonly appId: string;
  readonly environment: AnalyticsEnvironment;
  readonly errorType: ErrorType;
  readonly level: ErrorLevel;
  /** 已截断到 2000 字符 */
  readonly message: string;
  readonly release: string | null;
  readonly occurredAt: Date;
  /** 影响面统计用的身份键：`u:{userId}` / `m:{memberId}` / `a:{sessionId}`；无身份为 null */
  readonly identity: string | null;
  readonly event: ErrorEventColumns;
}

export interface RecordedError {
  readonly groupId: number;
  /** 本次写入新建了分组（count === 1） */
  readonly isNewGroup: boolean;
  readonly count: number;
}

/** 分组「只累加次数」的聚合更新（风暴限流下保存事件详情之外的部分） */
export interface ErrorGroupBump {
  readonly fingerprint: string;
  readonly count: number;
  readonly lastSeenAt: Date;
}

/** 归一化后的异常：任意 thrown 值都能得到名称 / 消息 / 代码 / 含 cause 链的堆栈 */
export interface NormalizedError {
  readonly name: string;
  readonly message: string;
  readonly code: string | null;
  readonly stack: string | null;
  /** 已知异常形态的结构化细节（PG 的 detail / constraint、系统错误的 syscall / address 等） */
  readonly details: Record<string, unknown> | null;
}

/** 请求快照（已脱敏、已截断），写入 error_events.context.request */
export interface RequestSnapshot {
  readonly method: string;
  readonly url: string;
  readonly route?: string | null;
  readonly status?: number | null;
  readonly ip?: string | null;
  readonly headers: Record<string, string>;
  readonly query?: Record<string, string> | null;
  readonly params?: Record<string, string> | null;
  readonly body?: unknown;
}

export interface JobContext {
  readonly type: string;
  readonly id?: string | number | null;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  /** 本次失败后不再重试（终态） */
  readonly final?: boolean;
}

/** `captureException()` 的上下文 */
export interface CaptureContext {
  readonly kind?: ServerErrorType;
  readonly level?: ErrorLevel;
  /** 人可读的上下文前缀（日志消息 / 场景说明），拼在异常消息前 */
  readonly message?: string;
  /** 显式分组：传入后不再按堆栈计算指纹 */
  readonly fingerprint?: readonly string[];
  readonly request?: RequestSnapshot;
  readonly job?: JobContext;
  readonly extra?: Record<string, unknown>;
  /** 覆盖 ALS 里的链路 / 身份（崩溃哨兵补录等没有请求上下文的场景） */
  readonly correlationId?: string | null;
  readonly userId?: number | null;
  readonly username?: string | null;
  readonly tenantId?: number | null;
  readonly occurredAt?: Date;
  /** 强制采集：跳过 HTTPException < 500 / 客户端中断等内建过滤 */
  readonly force?: boolean;
}
