import { sql } from 'drizzle-orm';
import type { HealthCheckResult, HealthStatus } from '@zenith/shared/platform';
import { db } from '../db';
import { invalidationBusState } from './invalidation-bus';
import redis from './redis';

export type InfraHealthChecks = Record<'database' | 'redis' | 'invalidationBus', HealthCheckResult>;

/**
 * 数据库 / Redis / 失效广播三项基础设施探测。api（`/api/health`）与纯 worker（`/health`）探针共用，
 * 各自再按角色追加 scheduler / wsFanout / workers 等项。
 * 失效广播未建立时功能仍可用（缓存退回 TTL 兜底），只作为降级提示，不拉低整体 status。
 */
export async function checkInfraHealth(): Promise<InfraHealthChecks> {
  const checks: Partial<InfraHealthChecks> = {};
  try {
    await db.execute(sql`SELECT 1`);
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }
  try {
    await redis.ping();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'error';
  }
  checks.invalidationBus = invalidationBusState() === 'listening' ? 'ok' : 'degraded';
  return checks as InfraHealthChecks;
}

/** 任一项 error 即整体 degraded；degraded 项不拉低整体状态 */
export function overallHealthStatus(checks: Record<string, HealthCheckResult>): HealthStatus {
  return Object.values(checks).some((v) => v === 'error') ? 'degraded' : 'ok';
}
